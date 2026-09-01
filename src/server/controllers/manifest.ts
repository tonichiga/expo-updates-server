import NodeFormData from "form-data";
import { toPosixPath } from "../lib/manifest-helpers.js";
import { createSignatureHeaderIfRequested } from "../lib/signing.js";
import { buildRequestContext } from "../lib/common.js";
import { createManifestUpdatePolicy } from "../lib/update-policy";
import { NextRequest } from "next/server.js";
import { resolveEmergencyChannelRedirect } from "../lib/emergency-channel-redirects";
import { getRequestedChannel } from "../manifest/manifest-request";
import {
  buildAssetUrl,
  createExpoClientConfig,
  createMultipartResponse,
  createNoUpdateResponse,
  createSignatureRequest,
  normalizeContentType,
  normalizeFileExtension,
} from "../manifest/manifest-response";
import {
  compareAppVersions,
  debugString,
  getManifestAppVersion,
  isSameOrNewerDate,
  latestExpoManifestDate,
  normalizeExpoManifestDate,
  normalizeId,
} from "../manifest/manifest-values";
import {
  getChannelRow,
  getLatestActiveUpdate,
  getUpdateByUpdateId,
  logServedManifest,
  OtaUpdateRow,
  resolveDeviceBaselineMeta,
  resolveManifestId,
  resolveUpdateIdFromServedManifestId,
} from "../manifest/manifest-repository";
import { isOtaDistributionBlocked } from "../lib/distribution-control";

type ManifestAsset = {
  hash?: string;
  key?: string;
  path?: string;
  fileExtension?: string;
  contentType?: string;
};

type ManifestPayload = {
  id?: string;
  createdAt?: string;
  runtimeVersion?: string;
  assets?: ManifestAsset[];
  launchAsset?: ManifestAsset;
  fileMetadata?: Record<
    string,
    { assets?: Array<{ path?: string; ext?: string }> }
  >;
  extra?: { expoClient?: Record<string, unknown> };
  expoClient?: Record<string, unknown>;
};

const manifestController = async (req: NextRequest) => {
  if (req.method !== "GET") {
    return Response.json({ error: "Expected GET." }, { status: 405 });
  }

  const protocolVersion = parseInt(
    req.headers.get("expo-protocol-version") ?? "0",
    10,
  );
  const platform =
    req.headers.get("expo-platform") ??
    req.nextUrl.searchParams.get("platform");
  const runtimeVersion =
    req.headers.get("expo-runtime-version") ??
    req.nextUrl.searchParams.get("runtime-version");
  const rawCurrentUpdateId = req.headers.get("expo-current-update-id");
  const rawEmbeddedUpdateId = req.headers.get("expo-embedded-update-id");
  const embeddedUpdateId = normalizeId(rawEmbeddedUpdateId);
  const requestedChannel = getRequestedChannel(req);

  try {
    if (await isOtaDistributionBlocked()) {
      return createNoUpdateResponse(req, protocolVersion || 1);
    }
  } catch (error: unknown) {
    console.error(
      "Failed to read OTA distribution control; failing manifest closed:",
      error,
    );
    return createNoUpdateResponse(req, protocolVersion || 1);
  }

  const emergencyRedirect = await resolveEmergencyChannelRedirect({
    requestedChannel,
    runtimeVersion,
    platform,
    embeddedUpdateId,
  });
  const channel = emergencyRedirect?.toChannel || requestedChannel;
  const requestContext = buildRequestContext({
    channel,
    runtimeVersion,
    platform,
  });

  if (channel !== requestedChannel) {
    console.warn(
      `[${new Date().toLocaleTimeString()}] 🚨 Emergency OTA channel redirect rule=${emergencyRedirect?.id || "unknown"} requestedChannel=${requestedChannel} effectiveChannel=${channel} platform=${debugString(
        platform,
      )} runtimeVersion=${debugString(runtimeVersion)} embeddedUpdateId=${debugString(
        embeddedUpdateId,
      )}`,
    );
  }

  console.log(
    `[${new Date().toLocaleTimeString()}] 🧾 Manifest request ${requestContext} protocol=${protocolVersion} deviceCurrentUpdateId=${debugString(
      rawCurrentUpdateId,
    )} deviceEmbeddedUpdateId=${debugString(rawEmbeddedUpdateId)} channelHeader=${debugString(
      req.headers.get("expo-channel-name"),
    )} requestedChannel=${requestedChannel} effectiveChannel=${channel}`,
  );

  if (platform !== "ios" && platform !== "android") {
    return Response.json(
      {
        error: "Unsupported platform. Expected either ios or android.",
      },
      { status: 400 },
    );
  }

  if (!runtimeVersion || typeof runtimeVersion !== "string") {
    return Response.json(
      { error: "No runtimeVersion provided." },
      { status: 400 },
    );
  }

  try {
    const channelRow = await getChannelRow({
      runtimeVersion,
      channel,
      platform,
    });

    console.log(
      `[${new Date().toLocaleTimeString()}] 🗂️ Channel state ${requestContext} latestUpdateId=${debugString(
        channelRow?.latest_update_id,
      )} activeUpdateId=${debugString(
        channelRow?.active_update_id,
      )} activeChangedAt=${channelRow?.active_changed_at ? (normalizeExpoManifestDate(channelRow.active_changed_at) ?? "invalid") : "none"} servedManifestChangedAt=${channelRow?.served_manifest_changed_at ? (normalizeExpoManifestDate(channelRow.served_manifest_changed_at) ?? "invalid") : "none"}`,
    );

    const rollbackUpdateId =
      channelRow?.active_update_id &&
      channelRow.active_update_id !== channelRow.latest_update_id
        ? channelRow.active_update_id
        : null;

    const rollbackMode = Boolean(rollbackUpdateId);

    const selectedUpdateId =
      rollbackUpdateId || channelRow?.latest_update_id || null;

    console.log(
      `[${new Date().toLocaleTimeString()}] 🎯 Channel selection ${requestContext} latestUpdateId=${debugString(
        channelRow?.latest_update_id,
      )} activeUpdateId=${debugString(
        channelRow?.active_update_id,
      )} selectedUpdateId=${debugString(selectedUpdateId)} rollbackMode=${rollbackMode}`,
    );

    if (!selectedUpdateId) {
      console.log(
        `[${new Date().toLocaleTimeString()}] ⏭️ Returning noUpdateAvailable ${requestContext} reason=no-selected-update-id`,
      );
      return createNoUpdateResponse(req, protocolVersion || 1);
    }

    let updateRow = await getUpdateByUpdateId(selectedUpdateId);
    let latestActiveUpdateRow: OtaUpdateRow | null = null;

    if (!updateRow || !updateRow.is_active) {
      latestActiveUpdateRow = await getLatestActiveUpdate({
        runtimeVersion,
        channel,
        platform,
      });
    }

    if ((!updateRow || !updateRow.is_active) && rollbackUpdateId) {
      updateRow = latestActiveUpdateRow;

      console.log(
        `[${new Date().toLocaleTimeString()}] 🔁 Rollback fallback attempted ${requestContext} rollbackUpdateId=${debugString(
          rollbackUpdateId,
        )} fallbackLatestActiveUpdateId=${debugString(latestActiveUpdateRow?.update_id)}`,
      );
    } else if (!rollbackMode && (!updateRow || !updateRow.is_active)) {
      updateRow = latestActiveUpdateRow;

      console.log(
        `[${new Date().toLocaleTimeString()}] 🔁 Latest pointer fallback attempted ${requestContext} pointedLatestUpdateId=${debugString(
          selectedUpdateId,
        )} fallbackLatestActiveUpdateId=${debugString(latestActiveUpdateRow?.update_id)}`,
      );
    }

    console.log(
      `[${new Date().toLocaleTimeString()}] 📄 Selected update row ${requestContext} updateId=${debugString(
        updateRow?.update_id,
      )} createdAt=${normalizeExpoManifestDate(updateRow?.created_at) ?? "none"} platform=${debugString(
        updateRow?.platform,
      )} channel=${debugString(updateRow?.channel)} isActive=${Boolean(
        updateRow?.is_active,
      )}`,
    );

    if (!updateRow || !updateRow.is_active) {
      console.log(
        `[${new Date().toLocaleTimeString()}] ⏭️ Returning noUpdateAvailable ${requestContext} reason=missing-or-inactive-update-row`,
      );
      return createNoUpdateResponse(req, protocolVersion || 1);
    }

    if (
      emergencyRedirect &&
      emergencyRedirect.targetMode === "pinned" &&
      updateRow.update_id.toLowerCase() !== emergencyRedirect.expectedUpdateId
    ) {
      console.error(
        `[${new Date().toLocaleTimeString()}] 🚨 Emergency OTA redirect target mismatch rule=${emergencyRedirect.id} expectedUpdateId=${emergencyRedirect.expectedUpdateId} selectedUpdateId=${updateRow.update_id}`,
      );
      return createNoUpdateResponse(req, protocolVersion || 1);
    }

    const currentUpdateId = normalizeId(rawCurrentUpdateId);
    const embeddedUpdateId = normalizeId(rawEmbeddedUpdateId);
    const selectedUpdateIdNormalized = normalizeId(updateRow.update_id);
    const selectedCreatedAt = normalizeExpoManifestDate(updateRow.created_at);
    const updateInfo =
      updateRow.manifest &&
      typeof updateRow.manifest === "object" &&
      !Array.isArray(updateRow.manifest)
        ? (updateRow.manifest as ManifestPayload)
        : ({} as ManifestPayload);
    const selectedAppVersion = getManifestAppVersion(updateInfo);
    const currentInstalledUpdateMeta = currentUpdateId
      ? await resolveDeviceBaselineMeta(currentUpdateId)
      : null;

    if (embeddedUpdateId && embeddedUpdateId === selectedUpdateIdNormalized) {
      console.log(
        `[${new Date().toLocaleTimeString()}] ⏭️ Returning noUpdateAvailable ${requestContext} reason=embedded-update-id-equals-selected-update-id embeddedUpdateId=${debugString(
          embeddedUpdateId,
        )} selectedUpdateId=${debugString(selectedUpdateIdNormalized)} rollbackMode=${rollbackMode}`,
      );
      return createNoUpdateResponse(req, protocolVersion || 1);
    }

    const embeddedUpdateMeta = embeddedUpdateId
      ? await resolveDeviceBaselineMeta(embeddedUpdateId)
      : null;

    if (embeddedUpdateId && !embeddedUpdateMeta) {
      console.log(
        `[${new Date().toLocaleTimeString()}] ⚠️ Embedded update metadata not found ${requestContext} embeddedUpdateId=${debugString(
          embeddedUpdateId,
        )}`,
      );
    }

    // Cached Expo/prebuild output can reuse an embedded update ID and createdAt
    // across APK version bumps. Registration updates app_version on that same
    // row, so a valid newer app version must override the stale timestamp.
    const embeddedAppVersionComparison =
      embeddedUpdateMeta?.platform === platform
        ? compareAppVersions(embeddedUpdateMeta.app_version, selectedAppVersion)
        : null;
    const currentInstalledAppVersionComparison =
      currentInstalledUpdateMeta?.platform === platform
        ? compareAppVersions(
            currentInstalledUpdateMeta.app_version,
            selectedAppVersion,
          )
        : null;
    const embeddedVersionBlocks = embeddedAppVersionComparison === 1;
    const currentInstalledVersionBlocks =
      currentInstalledAppVersionComparison === 1;

    const embeddedTimestampBlocks = Boolean(
      embeddedUpdateMeta &&
      embeddedUpdateMeta.platform === platform &&
      embeddedUpdateMeta.channel === channel &&
      (embeddedAppVersionComparison === 0 ||
        embeddedAppVersionComparison === null) &&
      isSameOrNewerDate(
        normalizeExpoManifestDate(embeddedUpdateMeta.created_at),
        selectedCreatedAt,
      ),
    );
    const currentInstalledTimestampBlocks = Boolean(
      currentInstalledUpdateMeta &&
      currentInstalledUpdateMeta.platform === platform &&
      currentInstalledUpdateMeta.channel === channel &&
      (currentInstalledAppVersionComparison === 0 ||
        currentInstalledAppVersionComparison === null) &&
      isSameOrNewerDate(
        normalizeExpoManifestDate(currentInstalledUpdateMeta.created_at),
        selectedCreatedAt,
      ),
    );

    const versionBlocksDowngrade =
      embeddedVersionBlocks || currentInstalledVersionBlocks;
    const timestampBlocksDowngrade =
      embeddedTimestampBlocks || currentInstalledTimestampBlocks;

    if (!rollbackMode && (versionBlocksDowngrade || timestampBlocksDowngrade)) {
      const blockingBaseline = embeddedVersionBlocks
        ? "embedded"
        : currentInstalledVersionBlocks
          ? "current-installed"
          : embeddedTimestampBlocks
            ? "embedded"
            : "current-installed";
      const downgradeBlockReason = versionBlocksDowngrade
        ? "app-version"
        : "timestamp";

      console.log(
        `[${new Date().toLocaleTimeString()}] ⏭️ Returning noUpdateAvailable ${requestContext} reason=downgrade-protection blockingReason=${downgradeBlockReason} baseline=${blockingBaseline} embeddedUpdateId=${debugString(
          embeddedUpdateId,
        )} embeddedAppVersion=${debugString(
          embeddedUpdateMeta?.app_version,
        )} embeddedCreatedAt=${debugString(
          normalizeExpoManifestDate(embeddedUpdateMeta?.created_at),
        )} currentInstalledUpdateId=${debugString(
          currentInstalledUpdateMeta?.embedded_update_id,
        )} currentInstalledAppVersion=${debugString(
          currentInstalledUpdateMeta?.app_version,
        )} currentInstalledCreatedAt=${debugString(
          normalizeExpoManifestDate(currentInstalledUpdateMeta?.created_at),
        )} selectedUpdateId=${debugString(
          selectedUpdateIdNormalized,
        )} selectedAppVersion=${debugString(
          selectedAppVersion,
        )} selectedCreatedAt=${selectedCreatedAt ?? "none"} rollbackMode=${rollbackMode}`,
      );
      return createNoUpdateResponse(req, protocolVersion || 1);
    }

    const updateRef = {
      runtimeVersion: updateRow.runtime_version,
      platform: updateRow.platform,
      channel: updateRow.channel,
      createdAtPath: updateRow.created_at_path,
      updateId: updateRow.update_id,
    };

    const platformExportMetadata =
      updateInfo.fileMetadata &&
      typeof updateInfo.fileMetadata === "object" &&
      updateInfo.fileMetadata[platform]
        ? updateInfo.fileMetadata[platform]
        : null;

    // served_manifest_id is a fresh UUID generated by DB trigger on every channel
    // change (deploy, rollback, promote). Using it as manifest id ensures:
    // 1. The update lands in SQLite with a fresh commit_time (active_changed_at),
    //    so LauncherSelectionPolicy always picks it over any stale phantom entries.
    // 2. No PRIMARY KEY conflict — this UUID has never been in the client's SQLite.
    //
    // "noUpdate" matching checks BOTH served_manifest_id AND the raw update_id so
    // that devices already running the target build are not offered a redundant update:
    // - device received the update via a previous served_manifest_id → matches id
    // - device received the update via its original update_id (e.g. first-time deploy
    //   where served_manifest_id happened to equal update_id, or legacy flow) → matches update_id
    const manifestId = normalizeId(channelRow?.served_manifest_id);
    const id = resolveManifestId(manifestId, updateRow.update_id);

    // A normal deploy must remain newer than the embedded update, while a rollback
    // needs the fresh served-manifest timestamp to bypass Expo downgrade protection.
    const createdAt =
      latestExpoManifestDate(
        channelRow?.served_manifest_changed_at,
        channelRow?.active_changed_at,
        updateInfo.createdAt,
        updateRow.created_at,
      ) || new Date().toISOString();

    // Resolve what real update_id the device's currentUpdateId represents.
    // currentUpdateId is always a served_manifest_id (never the raw update_id
    // unless the device was installed before this server was deployed).
    // We look it up in ota_served_manifest_log to find the underlying update_id.
    const resolvedCurrentUpdateId =
      currentInstalledUpdateMeta?.embedded_update_id ||
      (currentUpdateId
        ? await resolveUpdateIdFromServedManifestId(currentUpdateId)
        : null);

    // Match if:
    // 1. currentUpdateId IS the current served_manifest_id (fresh install / same channel state)
    // 2. The resolved update_id equals the target — device already runs this build
    //    via a different served_manifest_id (e.g. rollback back to same version)
    // 3. currentUpdateId IS the raw update_id (legacy / direct)
    const matchesCurrentUpdate =
      currentUpdateId !== null &&
      (currentUpdateId === id ||
        resolvedCurrentUpdateId === updateRow.update_id ||
        currentUpdateId === updateRow.update_id);
    const decisionReason = !currentUpdateId
      ? "device-current-update-id-missing"
      : matchesCurrentUpdate
        ? "device-current-update-id-matches-target"
        : "device-current-update-id-differs-from-target";

    console.log(
      `[${new Date().toLocaleTimeString()}] 🔎 OTA decision ${buildRequestContext(
        {
          channel,
          runtimeVersion,
          platform,
          buildId: updateRef.updateId,
        },
      )} deviceCurrentUpdateId=${currentUpdateId || "none"} servedManifestId=${id || "none"} selectedUpdateId=${selectedUpdateIdNormalized || "none"} action=${
        matchesCurrentUpdate ? "no-update" : "send-update"
      } reason=${decisionReason} rollbackMode=${rollbackMode}`,
    );

    if (matchesCurrentUpdate) {
      console.log(
        `[${new Date().toLocaleTimeString()}] ⏭️ Returning noUpdateAvailable ${buildRequestContext(
          {
            channel,
            runtimeVersion,
            platform,
            buildId: updateRef.updateId,
          },
        )} (current update id matches current channel target)`,
      );
      return createNoUpdateResponse(req, protocolVersion || 1);
    }

    console.log(
      `[${new Date().toLocaleTimeString()}] 🆕 New OTA update found ${buildRequestContext(
        {
          channel,
          runtimeVersion,
          platform,
          buildId: updateRef.updateId,
        },
      )} deviceCurrentUpdateId=${currentUpdateId || "none"} foundUpdateId=${updateRow.update_id} foundCreatedAt=${updateRow.created_at} foundPlatform=${updateRow.platform} foundChannel=${updateRow.channel} reason=${decisionReason}`,
    );

    const assets: Array<Record<string, unknown>> = [];
    const extensionByAssetPath = new Map(
      (platformExportMetadata?.assets || []).map((asset) => [
        toPosixPath(asset.path),
        asset.ext,
      ]),
    );

    const updateAssets = Array.isArray(updateInfo.assets)
      ? updateInfo.assets
      : [];

    for (const asset of updateAssets) {
      const normalizedAssetPath = toPosixPath(asset.path);
      const fileExtension = normalizeFileExtension(
        asset.fileExtension,
        extensionByAssetPath.get(normalizedAssetPath),
      );

      assets.push({
        hash: asset.hash,
        key: asset.key,
        ...(fileExtension ? { fileExtension } : {}),
        contentType: normalizeContentType(
          asset.contentType,
          fileExtension,
          false,
        ),
        url: buildAssetUrl({
          request: req,
          runtimeVersion,
          platform,
          createdAtPath: updateRef.createdAtPath || "",
          channel: updateRef.channel,
          updateId: updateRef.updateId,
          assetPath: normalizedAssetPath,
        }),
      });
    }

    console.log(
      `[${new Date().toLocaleTimeString()}] 📦 Static assets prepared ${buildRequestContext(
        {
          channel,
          runtimeVersion,
          platform,
          buildId: updateRef.updateId,
        },
      )} count=${assets.length}`,
    );

    const launchManifestAsset =
      updateInfo.launchAsset && typeof updateInfo.launchAsset === "object"
        ? updateInfo.launchAsset
        : null;

    if (!launchManifestAsset?.path) {
      return createNoUpdateResponse(req, protocolVersion || 1);
    }

    const launchFileExtension = normalizeFileExtension(
      launchManifestAsset.fileExtension,
      "bundle",
    );

    const launchAsset = {
      hash: launchManifestAsset.hash,
      key: launchManifestAsset.key,
      ...(launchFileExtension ? { fileExtension: launchFileExtension } : {}),
      contentType: normalizeContentType(
        launchManifestAsset.contentType,
        launchFileExtension,
        true,
      ),
      url: buildAssetUrl({
        request: req,
        runtimeVersion,
        platform,
        createdAtPath: updateRef.createdAtPath || "",
        channel: updateRef.channel,
        updateId: updateRef.updateId,
        assetPath: launchManifestAsset.path,
      }),
    };

    console.log(
      `[${new Date().toLocaleTimeString()}] 🚀 Launch asset prepared ${buildRequestContext(
        {
          channel,
          runtimeVersion,
          platform,
          buildId: updateRef.updateId,
        },
      )}`,
    );

    const manifest = {
      id,
      createdAt,
      runtimeVersion: updateInfo.runtimeVersion || updateRow.runtime_version,
      assets,
      launchAsset,
      metadata: {
        channel,
      },
      extra: {
        expoClient: createExpoClientConfig(
          updateInfo.extra?.expoClient || updateInfo.expoClient,
        ),
        updatePolicy: createManifestUpdatePolicy({
          delivery: updateRow.delivery_mode,
          guard: updateRow.guard_action
            ? {
                action: updateRow.guard_action,
                ...(updateRow.guard_payload !== null
                  ? { payload: updateRow.guard_payload }
                  : {}),
              }
            : null,
          policyVersion: updateRow.policy_version,
          onCorrupt: (policyError) =>
            console.error(
              `[${new Date().toLocaleTimeString()}] ⚠️ Corrupt OTA update policy; serving manual policy updateId=${updateRow.update_id}: ${policyError.message}`,
            ),
        }),
      },
    };

    const manifestString = JSON.stringify(manifest);
    let signature: string | null = null;
    try {
      console.log(
        `[${new Date().toLocaleTimeString()}] 📤 Processing signature ${buildRequestContext(
          {
            channel,
            runtimeVersion,
            platform,
            buildId: updateRef.updateId,
          },
        )}...`,
      );
      signature = await createSignatureHeaderIfRequested(
        createSignatureRequest(req),
        manifestString,
      );
      if (signature) {
        console.log(
          `[${new Date().toLocaleTimeString()}] ✅ Manifest will be signed ${buildRequestContext(
            {
              channel,
              runtimeVersion,
              platform,
              buildId: updateRef.updateId,
            },
          )}`,
        );
      } else {
        console.log(
          `[${new Date().toLocaleTimeString()}] ⚪ Manifest will NOT be signed ${buildRequestContext(
            {
              channel,
              runtimeVersion,
              platform,
              buildId: updateRef.updateId,
            },
          )} (no expect-signature header)`,
        );
      }
    } catch (signatureError: unknown) {
      return Response.json(
        { error: (signatureError as Error).message },
        { status: 400 },
      );
    }

    const assetRequestHeaders: Record<string, Record<string, never>> = {};
    [...assets, launchAsset].forEach((asset) => {
      const key = typeof asset.key === "string" ? asset.key : null;
      if (!key) {
        return;
      }
      assetRequestHeaders[key] = {};
    });

    const form = new NodeFormData();
    form.append("manifest", manifestString, {
      contentType: "application/json",
      header: {
        "content-type": "application/json; charset=utf-8",
        ...(signature ? { "expo-signature": signature } : {}),
      },
    });
    form.append("extensions", JSON.stringify({ assetRequestHeaders }), {
      contentType: "application/json",
    });

    const response = createMultipartResponse({
      protocolVersion,
      boundary: form.getBoundary(),
      buffer: new Uint8Array(form.getBuffer()),
    });

    console.log(
      `[${new Date().toLocaleTimeString()}] 📤 Manifest multipart sent ${buildRequestContext(
        {
          channel,
          runtimeVersion,
          platform,
          buildId: updateRef.updateId,
        },
      )} id=${id} protocol=${protocolVersion}`,
    );

    // Log the mapping so future requests can resolve this served_manifest_id
    // back to the real update_id (needed to detect "already on this version").
    logServedManifest({
      servedManifestId: id,
      updateId: updateRow.update_id,
      runtimeVersion,
      channel,
      platform,
      reason: rollbackMode ? "rollback" : "deploy",
    });

    return response;
  } catch (error: unknown) {
    console.error(
      `[${new Date().toLocaleTimeString()}] ❌ Manifest error ${requestContext}:`,
      error,
    );
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
};

export default manifestController;
