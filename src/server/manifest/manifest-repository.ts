import { supabase } from "../lib/supabase.js";

export type OtaUpdateRow = {
  update_id: string;
  build_id: string;
  runtime_version: string;
  channel: string;
  platform: "ios" | "android";
  created_at: string | Date;
  created_at_path: string;
  storage_base_path: string;
  is_active: boolean;
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
};

let hasServedManifestLogTable: boolean | null = null;

function isMissingServedManifestLogTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message =
    "message" in error && typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";

  return (
    message.includes("ota_served_manifest_log") &&
    message.includes("does not exist")
  );
}

export function resolveManifestId(
  servedManifestId: string | null,
  updateId: string,
): string {
  return hasServedManifestLogTable === true && servedManifestId
    ? servedManifestId
    : updateId;
}

export async function resolveUpdateIdFromServedManifestId(
  servedManifestId: string,
): Promise<string | null> {
  if (hasServedManifestLogTable === false) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("ota_served_manifest_log")
      .select("update_id")
      .eq("served_manifest_id", servedManifestId)
      .maybeSingle();

    if (isMissingServedManifestLogTableError(error)) {
      hasServedManifestLogTable = false;
      return null;
    }

    if (error || !data) {
      if (hasServedManifestLogTable === null) {
        hasServedManifestLogTable = true;
      }
      return null;
    }

    hasServedManifestLogTable = true;
    return (data as { update_id: string }).update_id || null;
  } catch (error: unknown) {
    if (isMissingServedManifestLogTableError(error)) {
      hasServedManifestLogTable = false;
    }
    return null;
  }
}

export function logServedManifest({
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
}): void {
  if (hasServedManifestLogTable === false) {
    return;
  }

  supabase
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
    .then(({ error }) => {
      if (isMissingServedManifestLogTableError(error)) {
        hasServedManifestLogTable = false;
        return;
      }

      if (!error && hasServedManifestLogTable === null) {
        hasServedManifestLogTable = true;
      }

      if (
        error &&
        !error.message?.includes("duplicate") &&
        !error.message?.includes("unique")
      ) {
        console.warn(
          `[${new Date().toLocaleTimeString()}] ⚠️ Failed to log served manifest: ${error.message}`,
        );
      }
    })
    .catch(() => undefined);
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
    .select("embedded_update_id,created_at,channel,platform")
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
}: {
  runtimeVersion: string;
  channel: string;
  platform: "ios" | "android";
}): Promise<OtaUpdateRow | null> {
  const { data, error } = await supabase
    .from("ota_updates")
    .select("*")
    .eq("runtime_version", runtimeVersion)
    .eq("channel", channel)
    .eq("platform", platform)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load latest active update row: ${error.message}`,
    );
  }

  return (data as OtaUpdateRow | null) || null;
}
