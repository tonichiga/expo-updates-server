import { Audience, RequestIdentity } from "../devices/audience";
import { supabase } from "../lib/supabase.js";
import { UpdateDeliveryMode } from "../lib/update-policy";
import { getManifestAppVersion } from "./manifest-values";

export type OtaUpdateRow = Partial<Audience> & {
  update_id: string;
  build_id: string;
  runtime_version: string;
  channel: string;
  platform: "ios" | "android";
  created_at: string | Date;
  created_at_path: string;
  storage_base_path: string;
  is_active: boolean;
  delivery_mode: UpdateDeliveryMode;
  guard_action: string | null;
  guard_payload: unknown | null;
  policy_version: number;
  policy_published_at: string | Date | null;
  manifest: Record<string, unknown>;
};

export type OtaChannelRow = {
  latest_update_id: string | null;
  active_update_id: string | null;
  active_changed_at: string | Date | null;
  served_manifest_id: string;
  served_manifest_changed_at: string | Date;
};

export type EmbeddedUpdateMeta = {
  embedded_update_id: string;
  created_at: string | Date;
  channel: string;
  platform: "ios" | "android";
  app_version: string | null;
};

export async function resolveUpdateIdFromServedManifestId(
  servedManifestId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("ota_served_manifest_log")
    .select("update_id")
    .eq("served_manifest_id", servedManifestId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve served manifest: ${error.message}`);
  }
  return (data as { update_id: string } | null)?.update_id || null;
}

export async function recordServedManifest({
  servedManifestId,
  updateId,
  runtimeVersion,
  channel,
  platform,
  reason,
}: {
  servedManifestId: string;
  updateId: string;
  runtimeVersion: string;
  channel: string;
  platform: string;
  reason: string;
}): Promise<void> {
  // The database rejects reassignment of an existing ID to another update.
  // Await this write before returning a manifest to a device.
  const { error } = await supabase
    .from("ota_served_manifest_log")
    .upsert(
      {
        served_manifest_id: servedManifestId,
        update_id: updateId,
        runtime_version: runtimeVersion,
        channel,
        platform,
        reason,
      },
      { onConflict: "served_manifest_id" },
    )
    .execute();

  if (error) {
    throw new Error(`Failed to record served manifest: ${error.message}`);
  }
}

export async function getChannelRow({
  runtimeVersion,
  channel,
  platform,
}: {
  runtimeVersion: string;
  channel: string;
  platform: "ios" | "android";
}): Promise<OtaChannelRow | null> {
  const { data, error } = await supabase
    .from("ota_update_channels")
    .select(
      "latest_update_id,active_update_id,active_changed_at,served_manifest_id,served_manifest_changed_at",
    )
    .eq("runtime_version", runtimeVersion)
    .eq("channel", channel)
    .eq("platform", platform)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load channel state: ${error.message}`);
  }

  return (data as OtaChannelRow | null) || null;
}

export async function getUpdateByUpdateId(
  updateId: string,
): Promise<OtaUpdateRow | null> {
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

async function getEmbeddedUpdateMetaById(
  embeddedUpdateId: string,
): Promise<EmbeddedUpdateMeta | null> {
  const { data, error } = await supabase
    .from("ota_embedded_updates")
    .select("embedded_update_id,created_at,channel,platform,app_version")
    .eq("embedded_update_id", embeddedUpdateId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load embedded update row: ${error.message}`);
  }

  return (data as EmbeddedUpdateMeta | null) || null;
}

async function resolveDeviceUpdateRow(
  deviceUpdateId: string,
): Promise<OtaUpdateRow | null> {
  const directUpdate = await getUpdateByUpdateId(deviceUpdateId);
  if (directUpdate) {
    return directUpdate;
  }

  const resolvedUpdateId =
    await resolveUpdateIdFromServedManifestId(deviceUpdateId);
  if (!resolvedUpdateId || resolvedUpdateId === deviceUpdateId) {
    return null;
  }

  return getUpdateByUpdateId(resolvedUpdateId);
}

function toEmbeddedUpdateMeta(updateRow: OtaUpdateRow): EmbeddedUpdateMeta {
  return {
    embedded_update_id: updateRow.update_id,
    created_at: updateRow.created_at,
    channel: updateRow.channel,
    platform: updateRow.platform,
    app_version: getManifestAppVersion(updateRow.manifest),
  };
}

export async function resolveDeviceBaselineMeta(
  deviceUpdateId: string,
): Promise<EmbeddedUpdateMeta | null> {
  const otaUpdate = await resolveDeviceUpdateRow(deviceUpdateId);
  return otaUpdate
    ? toEmbeddedUpdateMeta(otaUpdate)
    : getEmbeddedUpdateMetaById(deviceUpdateId);
}

export async function getLatestActiveUpdate({
  runtimeVersion,
  channel,
  platform,
  identity,
}: {
  runtimeVersion: string;
  channel: string;
  platform: "ios" | "android";
  identity: RequestIdentity;
}): Promise<OtaUpdateRow | null> {
  const { data, error } = await supabase.rpc("ota_latest_eligible_update", {
    p_runtime: runtimeVersion,
    p_channel: channel,
    p_platform: platform,
    p_installation: identity.installationId,
    p_device: identity.deviceId,
  });
  if (error)
    throw new Error(`Failed to load eligible update: ${error.message}`);
  return data?.[0] || null;
}
