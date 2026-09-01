import { jsonb, supabase, SUPABASE_BUCKET } from "./supabase.js";
import { toPosixPath } from "./manifest-helpers.js";
import {
  UpdateDeliveryMode,
  UpdatePolicyInput,
  UpdatePolicyValidationError,
  validateUpdatePolicy,
} from "./update-policy";
import { getManifestAppVersion } from "../manifest/manifest-values";

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

/**
 * Records served_manifest_id → update_id mapping so manifest controller can
 * resolve what real update a device is running from its currentUpdateId.
 * Fire-and-forget: errors are logged but never thrown.
 */
function logServedManifestMapping({
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
          `[admin-updates] Failed to log served manifest mapping: ${error.message}`,
        );
      }
    })
    .catch(() => {
      /* ignore */
    });
}

type UpdateStatus = "active" | "disabled";

type UpdateMetaState = {
  isActive: boolean;
  updatedAt: string | null;
  disabledAt: string | null;
};

export type OtaUpdateRow = {
  id: string;
  update_id: string;
  build_id: string;
  comment: string | null;
  runtime_version: string;
  channel: string;
  platform: "ios" | "android";
  created_at: string;
  created_at_path: string;
  storage_bucket: string;
  storage_base_path: string;
  is_active: boolean;
  updated_at: string | null;
  disabled_at: string | null;
  assets_count: number;
  launch_asset_path: string | null;
  rolled_back_from_update_id: string | null;
  delivery_mode: UpdateDeliveryMode;
  guard_rules: unknown;
  policy_version: number;
  policy_published_at: string | null;
  manifest: Record<string, unknown>;
  inserted_at: string;
  modified_at: string;
};

export type OtaChannelRow = {
  id: number;
  runtime_version: string;
  channel: string;
  platform: "ios" | "android";
  latest_update_id: string | null;
  latest_created_at: string | null;
  latest_created_at_path: string | null;
  active_update_id: string | null;
  active_changed_at: string | null;
  served_manifest_id: string;
  served_manifest_changed_at: string;
  inserted_at: string;
  modified_at: string;
};

export type UpdateRecord = {
  key: string;
  encodedKey: string;
  appVersion: string | null;
  comment: string | null;
  runtimeVersion: string;
  platform: "ios" | "android";
  createdAtPath: string;
  channel: string;
  stage: string;
  updateId: string;
  prefix: string;
  updateInfoPath: string;
  updateMetaPath: string;
  metadataPath: string;
  channelLatestPath: string;
  createdAt: string | null;
  status: UpdateStatus;
  isLatest: boolean;
  isRollbackActive: boolean;
  autoDeliveryEnabled: boolean;
  isIgnoredByRollback: boolean;
  launchAssetPath: string | null;
  assetsCount: number;
  deliveryMode: UpdateDeliveryMode;
  guardCount: number;
  policyVersion: number;
  policyPublishedAt: string | null;
  policyEditable: boolean;
};

export type UpdateDetail = UpdateRecord & {
  updateInfo: Record<string, unknown>;
  updateMeta: UpdateMetaState;
  metadata: Record<string, unknown> | null;
  channelLatest: Record<string, unknown> | null;
};

type SortField =
  | "createdAt"
  | "runtimeVersion"
  | "platform"
  | "channel"
  | "stage"
  | "status"
  | "updateId";

type SortOrder = "asc" | "desc";

type ListOptions = {
  page: number;
  pageSize: number;
  sortBy: SortField;
  order: SortOrder;
};

type Scope = {
  runtimeVersion: string;
  channel: string;
  platform: "ios" | "android";
};

type RollbackOptions = {
  reason?: string;
};

function parseDate(value: string | null): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function ensureUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function extractUpdateIdFromKey(key: string): string {
  if (ensureUuid(key)) {
    return key;
  }

  const tail = key.split("/").filter(Boolean).at(-1) || "";
  if (!ensureUuid(tail)) {
    throw new Error("Invalid update key format.");
  }

  return tail;
}

function makeUpdateKey(row: OtaUpdateRow): string {
  return `${row.runtime_version}/${row.platform}/${row.channel}/${row.update_id}`;
}

function mapUpdateMeta(row: OtaUpdateRow): UpdateMetaState {
  return {
    isActive: row.is_active,
    updatedAt: row.updated_at,
    disabledAt: row.disabled_at,
  };
}

function channelLatestToJson(
  channel: OtaChannelRow | null,
  newestUpdateId?: string | null,
  newestCreatedAt?: string | null,
): Record<string, unknown> | null {
  if (!channel) {
    return null;
  }

  return {
    runtimeVersion: channel.runtime_version,
    channel: channel.channel,
    platform: channel.platform,
    latestUpdateId: channel.latest_update_id,
    latestCreatedAt: channel.latest_created_at,
    latestCreatedAtPath: channel.latest_created_at_path,
    activeUpdateId: channel.active_update_id,
    activeChangedAt: channel.active_changed_at,
    newestUpdateId: newestUpdateId || null,
    newestCreatedAt: newestCreatedAt || null,
    servedManifestId: channel.served_manifest_id,
    servedManifestChangedAt: channel.served_manifest_changed_at,
  };
}

async function getNewestUpdateByScope(
  scope: Scope,
): Promise<OtaUpdateRow | null> {
  const { data, error } = await supabase
    .from("ota_updates")
    .select("*")
    .eq("runtime_version", scope.runtimeVersion)
    .eq("channel", scope.channel)
    .eq("platform", scope.platform)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load newest update by scope: ${error.message}`);
  }

  return (data as OtaUpdateRow | null) || null;
}

export function mapRowToRecord(
  row: OtaUpdateRow,
  channel: OtaChannelRow | null,
): UpdateRecord {
  const key = makeUpdateKey(row);
  const isLatest = channel?.latest_update_id === row.update_id;
  const rollbackActiveAtScope =
    Boolean(channel?.active_update_id) &&
    channel?.active_update_id !== channel?.latest_update_id;
  const isRollbackActive =
    rollbackActiveAtScope && channel?.active_update_id === row.update_id;
  const isIgnoredByRollback =
    rollbackActiveAtScope && channel?.active_update_id !== row.update_id;

  const status: UpdateStatus = row.is_active ? "active" : "disabled";

  return {
    key,
    encodedKey: encodeUpdateKey(row.update_id),
    appVersion: getManifestAppVersion(row.manifest),
    comment: row.comment,
    runtimeVersion: row.runtime_version,
    platform: row.platform,
    createdAtPath: row.created_at_path,
    channel: row.channel,
    stage: "-",
    updateId: row.update_id,
    prefix: row.storage_base_path,
    updateInfoPath: `${row.storage_base_path}/update-info.json`,
    updateMetaPath: `${row.storage_base_path}/update-meta.json`,
    metadataPath: `${row.storage_base_path}/metadata.json`,
    channelLatestPath: `${row.runtime_version}/${row.platform}/channels/${row.channel}/latest.json`,
    createdAt: row.created_at,
    status,
    isLatest,
    isRollbackActive,
    autoDeliveryEnabled: !rollbackActiveAtScope,
    isIgnoredByRollback,
    launchAssetPath: row.launch_asset_path,
    assetsCount: row.assets_count,
    deliveryMode:
      row.delivery_mode === "background" ? "background" : "manual",
    guardCount: Array.isArray(row.guard_rules)
      ? row.guard_rules.filter(
          (rule) =>
            rule &&
            typeof rule === "object" &&
            (rule as { enabled?: unknown }).enabled === true,
        ).length
      : 0,
    policyVersion:
      Number.isInteger(row.policy_version) && row.policy_version > 0
        ? row.policy_version
        : 1,
    policyPublishedAt: row.policy_published_at || null,
    policyEditable: !row.is_active && !row.policy_published_at,
  };
}

export type UpdatePolicyRecord = UpdatePolicyInput & {
  policyVersion: number;
  publishedAt: string | null;
  editable: boolean;
};

export class UpdatePolicyConflictError extends Error {}
export class UpdatePolicyPublishedError extends Error {}

export function assertExpectedPolicyVersion(
  expectedPolicyVersion: unknown,
  currentPolicyVersion?: number,
): asserts expectedPolicyVersion is number {
  if (
    !Number.isInteger(expectedPolicyVersion) ||
    (expectedPolicyVersion as number) < 1
  ) {
    throw new UpdatePolicyValidationError(
      "expectedPolicyVersion must be a positive integer.",
    );
  }
  if (
    currentPolicyVersion !== undefined &&
    expectedPolicyVersion !== currentPolicyVersion
  ) {
    throw new UpdatePolicyConflictError(
      `Policy version conflict. Current version is ${currentPolicyVersion}.`,
    );
  }
}

function rowToPolicy(row: OtaUpdateRow): UpdatePolicyRecord {
  const validated = validateUpdatePolicy({
    delivery: row.delivery_mode,
    rules: row.guard_rules,
  });
  return {
    ...validated,
    policyVersion: row.policy_version,
    publishedAt: row.policy_published_at,
    editable: !row.is_active && !row.policy_published_at,
  };
}

export async function getUpdatePolicyByKey(
  key: string,
): Promise<UpdatePolicyRecord> {
  return rowToPolicy(await getUpdateRowById(extractUpdateIdFromKey(key)));
}

export async function replaceUpdatePolicyByKey(
  key: string,
  input: unknown,
  expectedPolicyVersion: unknown,
): Promise<UpdatePolicyRecord> {
  assertExpectedPolicyVersion(expectedPolicyVersion);
  const updateId = extractUpdateIdFromKey(key);
  const row = await getUpdateRowById(updateId);
  if (row.is_active || row.policy_published_at) {
    throw new UpdatePolicyPublishedError(
      "Update policy is immutable after publication.",
    );
  }
  assertExpectedPolicyVersion(expectedPolicyVersion, row.policy_version);

  const policy = validateUpdatePolicy(input);
  const { data, error } = await supabase
    .from("ota_updates")
    .update({
      delivery_mode: policy.delivery,
      guard_rules: jsonb(policy.rules),
      policy_version: row.policy_version + 1,
    })
    .eq("update_id", updateId)
    .eq("is_active", false)
    .eq("policy_version", row.policy_version)
    .is("policy_published_at", null)
    .select("*")
    .maybeSingle();

  if (error) {
    if (error.message?.toLowerCase().includes("immutable")) {
      throw new UpdatePolicyPublishedError(
        "Update policy is immutable after publication.",
      );
    }
    throw new Error(`Failed to update policy: ${error.message}`);
  }
  if (!data) {
    const current = await getUpdateRowById(updateId);
    if (current.is_active || current.policy_published_at) {
      throw new UpdatePolicyPublishedError(
        "Update policy is immutable after publication.",
      );
    }
    throw new UpdatePolicyConflictError(
      `Policy version conflict. Current version is ${current.policy_version}.`,
    );
  }
  return rowToPolicy(data as OtaUpdateRow);
}

function compareValues(a: string | number, b: string | number): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function sortUpdates(
  items: UpdateRecord[],
  sortBy: SortField,
  order: SortOrder,
): UpdateRecord[] {
  const multiplier = order === "asc" ? 1 : -1;

  return [...items].sort((a, b) => {
    let valueA: string | number;
    let valueB: string | number;

    if (sortBy === "createdAt") {
      valueA = parseDate(a.createdAt);
      valueB = parseDate(b.createdAt);
    } else {
      valueA = a[sortBy] as string | number;
      valueB = b[sortBy] as string | number;
    }

    const result = compareValues(valueA, valueB) * multiplier;
    if (result !== 0) {
      return result;
    }

    return compareValues(a.key, b.key) * multiplier;
  });
}

async function listPageInBucket(
  bucket: string,
  prefix: string,
  offset: number,
  limit = 1000,
) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(prefix, { limit, offset, sortBy: { column: "name", order: "asc" } });

  if (error) {
    throw new Error(
      `Failed to list ${bucket}:${prefix || "<root>"}: ${error.message}`,
    );
  }

  return data || [];
}

async function listAllEntriesInBucket(
  bucket: string,
  prefix: string,
): Promise<Array<{ name: string; id?: string | null }>> {
  const merged: Array<{ name: string; id?: string | null }> = [];
  const limit = 1000;
  let offset = 0;

  for (;;) {
    const items = await listPageInBucket(bucket, prefix, offset, limit);
    merged.push(...items);
    if (items.length < limit) {
      break;
    }
    offset += limit;
  }

  return merged;
}

function isLikelyFolder(entry: { name: string; id?: string | null }): boolean {
  return entry.id === null || entry.id === undefined;
}

async function listAllFilesRecursive(
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const entries = await listAllEntriesInBucket(bucket, prefix);
  const files: string[] = [];

  for (const entry of entries) {
    const childPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (isLikelyFolder(entry)) {
      const nestedFiles = await listAllFilesRecursive(bucket, childPath);
      files.push(...nestedFiles);
    } else {
      files.push(childPath);
    }
  }

  return files;
}

async function getChannelRow(scope: Scope): Promise<OtaChannelRow | null> {
  const { data, error } = await supabase
    .from("ota_update_channels")
    .select("*")
    .eq("runtime_version", scope.runtimeVersion)
    .eq("channel", scope.channel)
    .eq("platform", scope.platform)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load ota_update_channels row: ${error.message}`);
  }

  return (data as OtaChannelRow | null) || null;
}

async function upsertChannelRow(
  scope: Scope,
  payload: Partial<OtaChannelRow>,
): Promise<OtaChannelRow> {
  const { data, error } = await supabase
    .from("ota_update_channels")
    .upsert(
      {
        runtime_version: scope.runtimeVersion,
        channel: scope.channel,
        platform: scope.platform,
        ...payload,
      },
      {
        onConflict: "runtime_version,channel,platform",
      },
    )
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to upsert ota_update_channels row: ${error?.message}`,
    );
  }

  return data as OtaChannelRow;
}

async function clearRollbackForOtherRuntimes(scope: Scope) {
  const { error } = await supabase
    .from("ota_update_channels")
    .update({
      active_update_id: null,
      active_changed_at: new Date().toISOString(),
    })
    .eq("channel", scope.channel)
    .eq("platform", scope.platform)
    .neq("runtime_version", scope.runtimeVersion)
    .not("active_update_id", "is", null)
    .execute();

  if (error) {
    throw new Error(
      `Failed to clear rollback for other runtimes: ${error.message}`,
    );
  }
}

async function getLatestRuntimeForChannelPlatform(params: {
  channel: string;
  platform: "ios" | "android";
}): Promise<string | null> {
  const { data, error } = await supabase
    .from("ota_update_channels")
    .select("runtime_version, latest_created_at")
    .eq("channel", params.channel)
    .eq("platform", params.platform)
    .not("latest_update_id", "is", null)
    .order("latest_created_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to resolve latest runtime for channel/platform: ${error.message}`,
    );
  }

  return data?.runtime_version || null;
}

async function getUpdateRowById(updateId: string): Promise<OtaUpdateRow> {
  const { data, error } = await supabase
    .from("ota_updates")
    .select("*")
    .eq("update_id", updateId)
    .single();

  if (error || !data) {
    throw new Error(`Update not found: ${updateId}`);
  }

  return data as OtaUpdateRow;
}

async function getUpdateRowsByScope(scope: Scope): Promise<OtaUpdateRow[]> {
  const { data, error } = await supabase
    .from("ota_updates")
    .select("*")
    .eq("runtime_version", scope.runtimeVersion)
    .eq("channel", scope.channel)
    .eq("platform", scope.platform)
    .order("created_at", { ascending: false })
    .execute();

  if (error) {
    throw new Error(`Failed to load updates by scope: ${error.message}`);
  }

  return (data || []) as OtaUpdateRow[];
}

function makeScopeFromRow(row: OtaUpdateRow): Scope {
  return {
    runtimeVersion: row.runtime_version,
    channel: row.channel,
    platform: row.platform,
  };
}

async function recalculateChannelPointers(scope: Scope) {
  const rows = await getUpdateRowsByScope(scope);
  const latestActive = rows.find((row) => row.is_active) || null;

  const existingChannelRow = await getChannelRow(scope);
  const existingRollbackId = existingChannelRow?.active_update_id || null;
  const hasValidRollback =
    Boolean(existingRollbackId) &&
    existingRollbackId !== latestActive?.update_id &&
    rows.some((row) => row.update_id === existingRollbackId && row.is_active);

  const nextRollbackId = hasValidRollback ? existingRollbackId : null;
  const now = new Date().toISOString();

  const payload: Partial<OtaChannelRow> = {
    latest_update_id: latestActive?.update_id || null,
    latest_created_at: latestActive?.created_at || null,
    latest_created_at_path: latestActive?.created_at_path || null,
    active_update_id: nextRollbackId,
    active_changed_at:
      nextRollbackId !== (existingChannelRow?.active_update_id || null)
        ? now
        : existingChannelRow?.active_changed_at || now,
  };

  const channelRow = await upsertChannelRow(scope, payload);
  return { channelRow, latestActive, rollbackId: nextRollbackId };
}

async function assignRollbackForScope(
  scope: Scope,
  rollbackUpdateId: string | null,
) {
  const rows = await getUpdateRowsByScope(scope);
  const latestActive = rows.find((row) => row.is_active) || null;

  const validRollback =
    rollbackUpdateId &&
    rows.some((row) => row.update_id === rollbackUpdateId && row.is_active)
      ? rollbackUpdateId
      : null;

  const normalizedRollback =
    validRollback && validRollback !== latestActive?.update_id
      ? validRollback
      : null;

  const channelRow = await upsertChannelRow(scope, {
    latest_update_id: latestActive?.update_id || null,
    latest_created_at: latestActive?.created_at || null,
    latest_created_at_path: latestActive?.created_at_path || null,
    active_update_id: normalizedRollback,
    active_changed_at: new Date().toISOString(),
  });

  return { channelRow, latestActive, rollbackId: normalizedRollback };
}

function extractMetadataFromManifest(
  manifest: Record<string, unknown>,
): Record<string, unknown> | null {
  const metadata = manifest.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return null;
}

function parseUpdateMetaContent(content: Record<string, unknown>): {
  is_active: boolean;
  updated_at: string;
  disabled_at: string | null;
} {
  const now = new Date().toISOString();
  const nextIsActive = content.isActive !== false;

  return {
    is_active: nextIsActive,
    updated_at: now,
    disabled_at: nextIsActive ? null : now,
  };
}

function buildLatestPayload(row: OtaUpdateRow, reason: string) {
  return {
    id: row.update_id,
    updateId: row.update_id,
    buildId: row.build_id,
    runtimeVersion: row.runtime_version,
    channel: row.channel,
    platform: row.platform,
    createdAt: row.created_at,
    createdAtPath: row.created_at_path,
    isActive: row.is_active,
    updatedAt: row.updated_at,
    reason,
  };
}

export function encodeUpdateKey(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

export function decodeUpdateKey(value: string): string {
  return Buffer.from(value, "base64url").toString("utf-8");
}

export function parseUpdateKey(key: string) {
  return {
    updateId: extractUpdateIdFromKey(key),
  };
}

export async function getUpdatesPage(options: ListOptions) {
  const { data, error } = await supabase
    .from("ota_updates")
    .select("*")
    .order("created_at", { ascending: false })
    .execute();

  if (error) {
    throw new Error(`Failed to fetch ota_updates: ${error.message}`);
  }

  const rows = (data || []) as OtaUpdateRow[];
  const scopeKeys = Array.from(
    new Set(
      rows.map(
        (row) => `${row.runtime_version}::${row.channel}::${row.platform}`,
      ),
    ),
  );

  const channelsByScope = new Map<string, OtaChannelRow | null>();
  await Promise.all(
    scopeKeys.map(async (scopeKey) => {
      const [runtimeVersion, channel, platform] = scopeKey.split("::");
      const channelRow = await getChannelRow({
        runtimeVersion,
        channel,
        platform: platform as "ios" | "android",
      });
      channelsByScope.set(scopeKey, channelRow);
    }),
  );

  const allUpdates = rows.map((row) => {
    const scopeKey = `${row.runtime_version}::${row.channel}::${row.platform}`;
    const channelRow = channelsByScope.get(scopeKey) || null;
    return mapRowToRecord(row, channelRow);
  });

  const rollbackLockByScope = scopeKeys.map((scopeKey) => {
    const [runtimeVersion, channel, platform] = scopeKey.split("::");
    const channelRow = channelsByScope.get(scopeKey) || null;
    const rollbackActive =
      Boolean(channelRow?.active_update_id) &&
      channelRow?.active_update_id !== channelRow?.latest_update_id;

    return {
      scopeKey,
      runtimeVersion,
      channel,
      platform: platform as "ios" | "android",
      rollbackActive,
      autoDeliveryEnabled: !rollbackActive,
      activeUpdateId: channelRow?.active_update_id || null,
      latestUpdateId: channelRow?.latest_update_id || null,
    };
  });

  const sorted = sortUpdates(allUpdates, options.sortBy, options.order);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / options.pageSize));
  const page = Math.min(Math.max(1, options.page), totalPages);
  const start = (page - 1) * options.pageSize;
  const end = start + options.pageSize;

  return {
    items: sorted.slice(start, end),
    total,
    page,
    pageSize: options.pageSize,
    totalPages,
    rollbackLockByScope,
  };
}

export async function getUpdateDetailByKey(key: string): Promise<UpdateDetail> {
  const updateId = extractUpdateIdFromKey(key);
  const row = await getUpdateRowById(updateId);
  const scope = makeScopeFromRow(row);
  const channelRow = await getChannelRow(scope);
  const newestRow = await getNewestUpdateByScope(scope);
  const record = mapRowToRecord(row, channelRow);

  const manifest =
    row.manifest &&
    typeof row.manifest === "object" &&
    !Array.isArray(row.manifest)
      ? row.manifest
      : {};

  return {
    ...record,
    updateInfo: manifest,
    updateMeta: mapUpdateMeta(row),
    metadata: extractMetadataFromManifest(manifest),
    channelLatest: channelLatestToJson(
      channelRow,
      newestRow?.update_id || null,
      newestRow?.created_at || null,
    ),
  };
}

export async function deleteUpdateByKey(
  key: string,
): Promise<{ removedFiles: number }> {
  const updateId = extractUpdateIdFromKey(key);
  const row = await getUpdateRowById(updateId);
  const scope = makeScopeFromRow(row);

  let removedFiles = 0;
  const bucket = row.storage_bucket || SUPABASE_BUCKET;
  const basePath = toPosixPath(row.storage_base_path || "");

  if (basePath) {
    const files = await listAllFilesRecursive(bucket, basePath).catch(() => []);
    removedFiles = files.length;

    if (files.length > 0) {
      const batchSize = 100;
      for (let index = 0; index < files.length; index += batchSize) {
        const batch = files.slice(index, index + batchSize);
        const { error } = await supabase.storage.from(bucket).remove(batch);
        if (error) {
          throw new Error(`Failed to remove files: ${error.message}`);
        }
      }
    }
  }

  const { error: deleteError } = await supabase
    .from("ota_updates")
    .delete()
    .eq("update_id", updateId)
    .execute();

  if (deleteError) {
    throw new Error(`Failed to delete ota_updates row: ${deleteError.message}`);
  }

  await recalculateChannelPointers(scope);

  return { removedFiles };
}

export async function updateJsonFileByKey(
  key: string,
  fileName:
    | "update-info.json"
    | "update-meta.json"
    | "metadata.json"
    | "channel-latest.json",
  nextJson: unknown,
) {
  const updateId = extractUpdateIdFromKey(key);
  const row = await getUpdateRowById(updateId);
  const scope = makeScopeFromRow(row);

  if (!nextJson || typeof nextJson !== "object" || Array.isArray(nextJson)) {
    throw new Error("content must be a JSON object");
  }

  const content = nextJson as Record<string, unknown>;

  if (fileName === "update-info.json") {
    const assets = Array.isArray(content.assets) ? content.assets : [];
    const launchAssetPath =
      content.launchAsset && typeof content.launchAsset === "object"
        ? ((content.launchAsset as { path?: string }).path ?? null)
        : null;

    const { error } = await supabase
      .from("ota_updates")
      .update({
        manifest: content,
        assets_count: assets.length,
        launch_asset_path: launchAssetPath,
        updated_at: new Date().toISOString(),
      })
      .eq("update_id", updateId)
      .execute();

    if (error) {
      throw new Error(`Failed to update manifest: ${error.message}`);
    }

    return { path: `${row.storage_base_path}/update-info.json` };
  }

  if (fileName === "metadata.json") {
    const currentManifest =
      row.manifest && typeof row.manifest === "object" ? row.manifest : {};

    const nextManifest = {
      ...currentManifest,
      metadata: content,
    };

    const { error } = await supabase
      .from("ota_updates")
      .update({
        manifest: nextManifest,
        updated_at: new Date().toISOString(),
      })
      .eq("update_id", updateId)
      .execute();

    if (error) {
      throw new Error(
        `Failed to update metadata in manifest: ${error.message}`,
      );
    }

    return { path: `${row.storage_base_path}/metadata.json` };
  }

  if (fileName === "update-meta.json") {
    const parsedMeta = parseUpdateMetaContent(content);

    const { error } = await supabase
      .from("ota_updates")
      .update({
        ...parsedMeta,
        ...(parsedMeta.is_active && !row.policy_published_at
          ? { policy_published_at: parsedMeta.updated_at }
          : {}),
      })
      .eq("update_id", updateId)
      .execute();

    if (error) {
      throw new Error(`Failed to update ota meta fields: ${error.message}`);
    }

    await recalculateChannelPointers(scope);
    return { path: `${row.storage_base_path}/update-meta.json` };
  }

  const channelTargetIdRaw =
    (typeof content.updateId === "string" && content.updateId) ||
    (typeof content.id === "string" && content.id) ||
    (typeof content.buildId === "string" && content.buildId) ||
    null;

  if (!channelTargetIdRaw || !ensureUuid(channelTargetIdRaw)) {
    throw new Error(
      "channel-latest.json content must include valid updateId/id/buildId",
    );
  }

  const channelTarget = await getUpdateRowById(channelTargetIdRaw);
  const channelScope = makeScopeFromRow(channelTarget);
  const currentChannelRow = await getChannelRow(channelScope);
  const rollbackActive =
    Boolean(currentChannelRow?.active_update_id) &&
    currentChannelRow?.active_update_id !== currentChannelRow?.latest_update_id;

  if (rollbackActive) {
    throw new Error(
      "Rollback is active. New updates are ignored until rollback is disabled via Promote.",
    );
  }

  await upsertChannelRow(channelScope, {
    latest_update_id: channelTarget.update_id,
    latest_created_at: channelTarget.created_at,
    latest_created_at_path: channelTarget.created_at_path,
    active_update_id: null,
    active_changed_at: new Date().toISOString(),
  });

  return {
    path: `${channelTarget.runtime_version}/${channelTarget.platform}/channels/${channelTarget.channel}/latest.json`,
  };
}

export async function rollbackToUpdateByKey(
  key: string,
  options?: RollbackOptions,
) {
  const updateId = extractUpdateIdFromKey(key);
  const row = await getUpdateRowById(updateId);
  const scope = makeScopeFromRow(row);
  const now = new Date().toISOString();

  const latestRuntime = await getLatestRuntimeForChannelPlatform({
    channel: row.channel,
    platform: row.platform,
  });

  if (latestRuntime && latestRuntime !== row.runtime_version) {
    throw new Error(
      `Rollback is allowed only for runtimeVersion=${latestRuntime}. Selected update runtimeVersion=${row.runtime_version}`,
    );
  }

  const currentChannel = await getChannelRow(scope);
  const currentServedUpdateId =
    currentChannel?.active_update_id ||
    currentChannel?.latest_update_id ||
    null;

  if (!currentServedUpdateId) {
    throw new Error(
      "Rollback is not available: no active update is currently served for this scope.",
    );
  }

  if (currentServedUpdateId === updateId) {
    throw new Error(
      "Rollback is not available for the currently served update.",
    );
  }

  const currentServedRow = await getUpdateRowById(currentServedUpdateId);
  if (!currentServedRow.is_active) {
    throw new Error(
      "Rollback is not available: currently served update is not active.",
    );
  }

  const currentServedCreatedAt = parseDate(
    currentServedRow.created_at || currentServedRow.created_at_path,
  );
  const targetCreatedAt = parseDate(row.created_at || row.created_at_path);
  if (currentServedCreatedAt <= targetCreatedAt) {
    throw new Error(
      "Rollback is allowed only when a newer active update exists in the same scope.",
    );
  }

  const { error: deactivateOthersError } = await supabase
    .from("ota_updates")
    .update({
      is_active: false,
      updated_at: now,
      disabled_at: now,
    })
    .eq("runtime_version", scope.runtimeVersion)
    .eq("channel", scope.channel)
    .eq("platform", scope.platform)
    .neq("update_id", updateId)
    .eq("is_active", true)
    .execute();

  if (deactivateOthersError) {
    throw new Error(
      `Failed to deactivate other active updates in scope: ${deactivateOthersError.message}`,
    );
  }

  const { error: activationError } = await supabase
    .from("ota_updates")
    .update({
      is_active: true,
      updated_at: now,
      disabled_at: null,
      policy_published_at: row.policy_published_at || now,
    })
    .eq("update_id", updateId)
    .execute();

  if (activationError) {
    throw new Error(
      `Failed to activate rollback target: ${activationError.message}`,
    );
  }

  await supabase
    .from("ota_updates")
    .update({
      rolled_back_from_update_id:
        currentServedUpdateId && currentServedUpdateId !== updateId
          ? currentServedUpdateId
          : null,
      updated_at: now,
    })
    .eq("update_id", updateId)
    .execute();

  const refreshed = await getUpdateRowById(updateId);
  const newestRow = await getNewestUpdateByScope(scope);
  const rollbackLatestRow = newestRow || currentServedRow;

  await clearRollbackForOtherRuntimes(scope);

  const channelRow = await upsertChannelRow(scope, {
    // Keep latest pointer on the newest update in scope.
    latest_update_id: rollbackLatestRow.update_id,
    latest_created_at: rollbackLatestRow.created_at,
    latest_created_at_path: rollbackLatestRow.created_at_path,
    // Enable rollback mode by pinning active pointer to an older update.
    active_update_id: refreshed.update_id,
    active_changed_at: now,
  });

  // Pre-populate the mapping so the first device request after rollback
  // can immediately resolve served_manifest_id → update_id without a cold miss.
  if (channelRow.served_manifest_id) {
    logServedManifestMapping({
      servedManifestId: channelRow.served_manifest_id,
      updateId: refreshed.update_id,
      runtimeVersion: scope.runtimeVersion,
      channel: scope.channel,
      platform: scope.platform,
      reason: "rollback",
    });
  }

  return {
    ...buildLatestPayload(refreshed, options?.reason || "rollback"),
    activeChangedAt: channelRow.active_changed_at,
    rollbackAssigned:
      Boolean(channelRow.active_update_id) &&
      channelRow.active_update_id !== channelRow.latest_update_id,
  };
}

export async function promoteLatestByKey(key: string) {
  const updateId = extractUpdateIdFromKey(key);
  const row = await getUpdateRowById(updateId);
  const scope = makeScopeFromRow(row);

  const channelRow = await getChannelRow(scope);
  const latestUpdateId = channelRow?.latest_update_id || null;
  const rollbackActive =
    Boolean(channelRow?.active_update_id) &&
    channelRow?.active_update_id !== channelRow?.latest_update_id;

  if (!latestUpdateId) {
    throw new Error("Cannot promote: latest update is not set for this scope.");
  }

  if (latestUpdateId !== row.update_id) {
    throw new Error("Promote is allowed only on the latest update.");
  }

  if (!rollbackActive) {
    throw new Error("Promote is not available because rollback is not active.");
  }

  const promoteNow = new Date().toISOString();

  const { error: deactivateOthersError } = await supabase
    .from("ota_updates")
    .update({
      is_active: false,
      updated_at: promoteNow,
      disabled_at: promoteNow,
    })
    .eq("runtime_version", scope.runtimeVersion)
    .eq("channel", scope.channel)
    .eq("platform", scope.platform)
    .neq("update_id", latestUpdateId)
    .eq("is_active", true)
    .execute();

  if (deactivateOthersError) {
    throw new Error(
      `Failed to deactivate active updates during promote: ${deactivateOthersError.message}`,
    );
  }

  const { error: activateLatestError } = await supabase
    .from("ota_updates")
    .update({
      is_active: true,
      updated_at: promoteNow,
      disabled_at: null,
      policy_published_at: row.policy_published_at || promoteNow,
    })
    .eq("update_id", latestUpdateId)
    .execute();

  if (activateLatestError) {
    throw new Error(
      `Failed to activate latest update during promote: ${activateLatestError.message}`,
    );
  }

  const updatedChannel = await upsertChannelRow(scope, {
    latest_update_id: channelRow?.latest_update_id || row.update_id,
    latest_created_at: channelRow?.latest_created_at || row.created_at,
    latest_created_at_path:
      channelRow?.latest_created_at_path || row.created_at_path,
    active_update_id: null,
    active_changed_at: promoteNow,
  });

  // Pre-populate the mapping so the first device request after promote
  // can immediately resolve served_manifest_id → update_id without a cold miss.
  if (updatedChannel.served_manifest_id && updatedChannel.latest_update_id) {
    logServedManifestMapping({
      servedManifestId: updatedChannel.served_manifest_id,
      updateId: updatedChannel.latest_update_id,
      runtimeVersion: scope.runtimeVersion,
      channel: scope.channel,
      platform: scope.platform,
      reason: "promote",
    });
  }

  return {
    promoted: true,
    latestUpdateId: updatedChannel.latest_update_id,
    activeUpdateId: updatedChannel.active_update_id,
    rollbackActive: false,
  };
}

export async function setUpdateDisabledByKey(key: string, disabled: boolean) {
  const updateId = extractUpdateIdFromKey(key);
  const row = await getUpdateRowById(updateId);
  const scope = makeScopeFromRow(row);
  const now = new Date().toISOString();

  const scopeChannelRow = await getChannelRow(scope);
  const rollbackActive =
    Boolean(scopeChannelRow?.active_update_id) &&
    scopeChannelRow?.active_update_id !== scopeChannelRow?.latest_update_id;
  const newestRow = await getNewestUpdateByScope(scope);
  const isNewestInScope = newestRow?.update_id === updateId;

  if (!disabled) {
    if (!isNewestInScope) {
      throw new Error(
        "Direct activation is allowed only for the newest update in scope. Use Rollback for older updates.",
      );
    }

    if (rollbackActive) {
      throw new Error(
        "Direct activation is unavailable while rollback mode is active. Use Promote on the newest update.",
      );
    }

    const { error: deactivateOthersError } = await supabase
      .from("ota_updates")
      .update({
        is_active: false,
        updated_at: now,
        disabled_at: now,
      })
      .eq("runtime_version", scope.runtimeVersion)
      .eq("channel", scope.channel)
      .eq("platform", scope.platform)
      .neq("update_id", updateId)
      .eq("is_active", true)
      .execute();

    if (deactivateOthersError) {
      throw new Error(
        `Failed to deactivate other active updates in scope: ${deactivateOthersError.message}`,
      );
    }
  }

  const { error } = await supabase
    .from("ota_updates")
    .update({
      is_active: !disabled,
      updated_at: now,
      disabled_at: disabled ? now : null,
      ...(!disabled && !row.policy_published_at
        ? { policy_published_at: now }
        : {}),
    })
    .eq("update_id", updateId)
    .execute();

  if (error) {
    throw new Error(`Failed to change update active state: ${error.message}`);
  }

  const currentChannel = await getChannelRow(scope);
  const shouldClearRollback =
    disabled && currentChannel?.active_update_id === updateId;

  const { channelRow, latestActive, rollbackId } = shouldClearRollback
    ? await assignRollbackForScope(scope, null)
    : await recalculateChannelPointers(scope);

  return {
    updated: true,
    disabled,
    state: disabled ? "disabled" : "active",
    fallbackApplied: Boolean(latestActive),
    activeUpdateId: channelRow.active_update_id,
    latestUpdateId: channelRow.latest_update_id,
    rollbackActive: Boolean(rollbackId),
  };
}

export function normalizeSortBy(value: string | null): SortField {
  const allowed: SortField[] = [
    "createdAt",
    "runtimeVersion",
    "platform",
    "channel",
    "stage",
    "status",
    "updateId",
  ];

  if (value && allowed.includes(value as SortField)) {
    return value as SortField;
  }

  return "createdAt";
}

export function normalizeSortOrder(value: string | null): SortOrder {
  return value === "asc" ? "asc" : "desc";
}

export function normalizePage(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.floor(parsed);
}

export function normalizePageSize(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 20;
  }
  return Math.min(100, Math.floor(parsed));
}

export function toStoragePath(value: string): string {
  return toPosixPath(value);
}
