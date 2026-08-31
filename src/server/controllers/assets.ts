import path from "path";
import { supabase, SUPABASE_BUCKET } from "../lib/supabase.js";
import { toPosixPath } from "../lib/manifest-helpers.js";
import { Buffer } from "buffer";
import { NextRequest } from "next/server.js";

type OtaUpdateRow = {
  update_id: string;
  runtime_version: string;
  channel: string;
  platform: "ios" | "android";
  storage_bucket: string;
  storage_base_path: string;
  manifest: Record<string, unknown>;
};

function buildAssetRequestContext({
  runtimeVersion,
  platform,
  updateId,
  channel,
}) {
  return `channel=${channel || "unknown"} runtime=${runtimeVersion || "unknown"} platform=${platform || "unknown"} updateId=${updateId || "unknown"}`;
}

function normalizeContentType(
  contentType: string | undefined,
  isLaunchAsset: boolean,
) {
  if (isLaunchAsset) {
    return "application/javascript";
  }

  if (contentType && contentType !== "application/octet-stream") {
    return contentType;
  }

  return contentType || "application/octet-stream";
}

async function getUpdateById(updateId: string): Promise<OtaUpdateRow | null> {
  const { data, error } = await supabase
    .from("ota_updates")
    .select("*")
    .eq("update_id", updateId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load update row: ${error.message}`);
  }

  return (data as OtaUpdateRow | null) || null;
}

const assetsController = async (req: NextRequest) => {
  if (req.method !== "GET") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const searchParams = req.nextUrl.searchParams;

  const runtimeVersion = searchParams.get("runtimeVersion");
  const platform = searchParams.get("platform");
  const channel = searchParams.get("channel");
  const updateId = searchParams.get("updateId") || searchParams.get("buildId");
  const assetPath = searchParams.get("assetPath");

  if (platform !== "ios" && platform !== "android") {
    return Response.json(
      {
        error: 'No platform provided. Expected "ios" or "android".',
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

  if (!updateId || typeof updateId !== "string") {
    return Response.json({ error: "No updateId provided." }, { status: 400 });
  }

  if (!assetPath || typeof assetPath !== "string") {
    return Response.json({ error: "No assetPath provided." }, { status: 400 });
  }

  try {
    const updateRow = await getUpdateById(updateId);
    if (!updateRow) {
      return Response.json(
        { error: `Update not found: ${updateId}` },
        { status: 404 },
      );
    }

    if (
      updateRow.platform !== platform ||
      updateRow.runtime_version !== runtimeVersion ||
      (channel && updateRow.channel !== channel)
    ) {
      return Response.json(
        { error: "Update does not match requested runtime/platform/channel" },
        { status: 404 },
      );
    }

    const requestContext = buildAssetRequestContext({
      runtimeVersion,
      platform,
      updateId,
      channel: updateRow.channel,
    });

    const manifest =
      updateRow.manifest &&
      typeof updateRow.manifest === "object" &&
      !Array.isArray(updateRow.manifest)
        ? updateRow.manifest
        : {};

    const normalizedAssetPath = toPosixPath(assetPath);
    const launchAsset =
      manifest.launchAsset && typeof manifest.launchAsset === "object"
        ? (manifest.launchAsset as Record<string, unknown>)
        : null;
    const launchAssetPath = toPosixPath(String(launchAsset?.path || ""));

    const assets = Array.isArray(manifest.assets)
      ? (manifest.assets as Array<Record<string, unknown>>)
      : [];

    const isLaunchAsset = normalizedAssetPath === launchAssetPath;
    const assetMetadata = isLaunchAsset
      ? launchAsset
      : assets.find(
          (asset) =>
            toPosixPath(String(asset.path || "")) === normalizedAssetPath,
        ) || null;

    if (!assetMetadata) {
      return Response.json(
        {
          error: `Asset metadata not found for path: ${normalizedAssetPath}`,
        },
        { status: 404 },
      );
    }

    const storagePath = toPosixPath(
      path.posix.join(updateRow.storage_base_path, normalizedAssetPath),
    );
    const storageBucket = updateRow.storage_bucket || SUPABASE_BUCKET;

    console.log(
      `[${new Date().toLocaleTimeString()}] 📥 /api/assets ${requestContext} assetPath=${normalizedAssetPath} launch=${isLaunchAsset}`,
    );

    const { data, error } = await supabase.storage
      .from(storageBucket)
      .download(storagePath);

    if (error || !data) {
      return Response.json(
        {
          error: `Asset not found: ${storagePath}`,
          details: error?.message,
        },
        { status: 404 },
      );
    }

    const contentType = normalizeContentType(
      typeof assetMetadata.contentType === "string"
        ? assetMetadata.contentType
        : undefined,
      isLaunchAsset,
    );

    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log(
      `[${new Date().toLocaleTimeString()}] 📦 Asset sent ${requestContext}`,
      JSON.stringify(
        {
          assetPath: normalizedAssetPath,
          contentType,
          bytes: buffer.length,
        },
        null,
        2,
      ),
    );

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": buffer.length.toString(),
      },
    });
  } catch (error: unknown) {
    console.error(
      `[${new Date().toLocaleTimeString()}] ❌ Asset error runtime=${runtimeVersion || "unknown"} platform=${platform || "unknown"} updateId=${updateId || "unknown"}:`,
      error,
    );
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
};

export default assetsController;
