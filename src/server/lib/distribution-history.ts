import { supabase } from "./supabase.js";
import { OtaDistributionBlockedError } from "./distribution-control";

type Release = {
  updateId: string;
  appVersion: string | null;
  comment: string | null;
  createdAt: string;
  activatedAt: string | null;
};

type HistoryRow = {
  id: number;
  runtime_version: string;
  channel: string;
  platform: "ios" | "android";
  revision: string;
  current_release: Release | null;
  previous_release: Release | null;
};

function releaseLink(release: Release | null) {
  return (
    release && {
      ...release,
      encodedKey: Buffer.from(release.updateId).toString("base64url"),
    }
  );
}

export async function getDistributionHistory() {
  const scopes: Array<{
    runtimeVersion: string;
    platform: HistoryRow["platform"];
    channel: string;
    revision: string;
    current: ReturnType<typeof releaseLink>;
    previous: ReturnType<typeof releaseLink>;
  }> = [];
  let cursor = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("ota_distribution_history")
      .select(
        "id,runtime_version,channel,platform,revision,current_release,previous_release",
      )
      .neq("revision", "0")
      .gt("id", cursor)
      .order("id")
      .limit(200)
      .execute();
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as HistoryRow[];
    if (!rows.length) return scopes;
    for (const row of rows)
      scopes.push({
        runtimeVersion: row.runtime_version,
        channel: row.channel,
        platform: row.platform,
        revision: row.revision,
        current: releaseLink(row.current_release),
        previous: releaseLink(row.previous_release),
      });
    cursor = rows[rows.length - 1].id;
  }
}

export class DistributionHistoryConflictError extends Error {}

export async function changeDistribution(
  updateId: string,
  action:
    | "activate"
    | "stop"
    | "restore"
    | "rollback"
    | "promote"
    | "select-latest"
    | "retire"
    | "delete",
  revision: string | null = null,
) {
  const { data, error } = await supabase.rpc("ota_change_distribution", {
    p_update: updateId,
    p_action: action,
    p_revision: revision,
  });
  if (error?.message.includes("OTA_DISTRIBUTION_BLOCKED"))
    throw new OtaDistributionBlockedError();
  if (error?.message.includes("DISTRIBUTION_CONFLICT:"))
    throw new DistributionHistoryConflictError(
      error.message.split("DISTRIBUTION_CONFLICT:")[1].trim(),
    );
  if (error || !data?.[0]?.result)
    throw new Error(error?.message || "Missing distribution result.");
  return data[0].result;
}
