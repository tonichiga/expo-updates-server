import { jsonb, supabase, SUPABASE_BUCKET } from "./supabase.js";
import { toPosixPath } from "./manifest-helpers.js";
import {
  UpdateDeliveryMode,
  UpdatePolicyInput,
  UpdatePolicyValidationError,
  validateUpdatePolicy,
} from "./update-policy";
import { getManifestAppVersion, getAppVersionFromFields } from "../manifest/manifest-values";
import { assertOtaDistributionAllowed } from "./distribution-control";
import { changeDistribution } from "./distribution-history";

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
  audience_mode?: "all" | "devices";
  updated_at: string | null;
  disabled_at: string | null;
  assets_count: number;
  launch_asset_path: string | null;
  rolled_back_from_update_id: string | null;
  delivery_mode: UpdateDeliveryMode;
  guard_action: string | null;
  guard_payload: unknown | null;
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

const listColumns = [
  "id",
  "update_id",
  "comment",
  "runtime_version",
  "channel",
  "platform",
  "created_at",
  "created_at_path",
  "storage_base_path",
  "is_active",
  "audience_mode",
  "assets_count",
  "launch_asset_path",
  "delivery_mode",
  "guard_action",
  "policy_version",
  "policy_published_at",
] as const;
type ListRow = Pick<OtaUpdateRow, (typeof listColumns)[number]>;
type ListChannel = Pick<
  OtaChannelRow,
  | "id"
  | "runtime_version"
  | "channel"
  | "platform"
  | "latest_update_id"
  | "active_update_id"
>;
type VersionProjection = { app_version: unknown; legacy_version: unknown };

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
  audienceMode: "all" | "devices";
  isLatest: boolean;
  isRollbackActive: boolean;
  autoDeliveryEnabled: boolean;
  isIgnoredByRollback: boolean;
  launchAssetPath: string | null;
  assetsCount: number;
  deliveryMode: UpdateDeliveryMode;
  hasGuard: boolean;
  policyVersion: number;
  policyPublishedAt: string | null;
  policyEditable: boolean;
};

export type UpdateDetail = UpdateRecord & {
  isNewestInScope: boolean;
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
  q?: string;
  platform?: string;
  channel?: string;
  runtime?: string;
  status?: string;
  audience?: string;
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

function makeUpdateKey(row: ListRow): string {
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
    .order("update_id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load newest update by scope: ${error.message}`);
  }

  return (data as OtaUpdateRow | null) || null;
}

export function mapRowToRecord(
  row: ListRow & { manifest?: unknown },
  channel: ListChannel | null,
  appVersion = getManifestAppVersion(row.manifest),
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
    appVersion,
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
    audienceMode: row.audience_mode === "devices" ? "devices" : "all",
    isLatest,
    isRollbackActive,
    autoDeliveryEnabled: !rollbackActiveAtScope,
    isIgnoredByRollback,
    launchAssetPath: row.launch_asset_path,
    assetsCount: row.assets_count,
    deliveryMode: row.delivery_mode === "background" ? "background" : "manual",
    hasGuard:
      typeof row.guard_action === "string" && row.guard_action.length > 0,
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
    guard: row.guard_action
      ? {
          action: row.guard_action,
          ...(row.guard_payload !== null ? { payload: row.guard_payload } : {}),
        }
      : null,
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
      guard_action: policy.guard?.action || null,
      guard_payload:
        policy.guard?.payload !== undefined
          ? jsonb(policy.guard.payload)
          : null,
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

function makeScopeFromRow(row: ListRow): Scope {
  return {
    runtimeVersion: row.runtime_version,
    channel: row.channel,
    platform: row.platform,
  };
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

// A server may cap each PostgREST response below our requested batch size.
// Advance on the unique indexed key until the next query is empty.
async function* readHistory<T extends { id: string | number }>(
  table: "ota_updates" | "ota_update_channels",
  columns: string,
) {
  let cursor: string | number | undefined;
  for (;;) {
    const query = supabase.from(table).select(columns).order("id").limit(200);
    if (cursor !== undefined) query.gt("id", cursor);
    const { data, error } = await query.execute();
    if (error) throw new Error(`Failed to fetch ${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    if (!rows.length) return;
    yield rows;
    cursor = rows[rows.length - 1].id;
  }
}

function scopeKey(
  row: Pick<OtaUpdateRow, "runtime_version" | "channel" | "platform">,
) {
  return JSON.stringify([row.runtime_version, row.channel, row.platform]);
}

function matchesRelease(
  item: UpdateRecord,
  options: ListOptions,
  search: string,
) {
  if (options.platform && item.platform !== options.platform) return false;
  if (options.channel && item.channel !== options.channel) return false;
  if (options.runtime && item.runtimeVersion !== options.runtime) return false;
  if (options.audience && item.audienceMode !== options.audience) return false;
  if (options.status === "rollback") {
    if (!item.isRollbackActive) return false;
  } else if (
    options.status &&
    options.status !== (item.policyEditable ? "draft" : item.status)
  ) {
    return false;
  }
  return (
    !search ||
    [
      item.comment,
      item.updateId,
      item.appVersion,
      item.runtimeVersion,
      item.channel,
    ].some((value) => value?.toLowerCase().includes(search))
  );
}

export async function getUpdatesPage(options: ListOptions) {
  const search = options.q?.trim().toLowerCase() || "";
  const channelsByScope = new Map<string, ListChannel>();
  for await (const batch of readHistory<ListChannel>(
    "ota_update_channels",
    "id,runtime_version,channel,platform,latest_update_id,active_update_id",
  )) {
    for (const channel of batch)
      channelsByScope.set(scopeKey(channel), channel);
  }

  const matching: UpdateRecord[] = [];
  const scopes = new Map<string, Scope>();
  const channels = new Set<string>();
  const runtimes = new Set<string>();
  const columns = [
    ...listColumns,
    "app_version:manifest->extra->expoClient->version",
    "legacy_version:manifest->expoClient->version",
  ].join(",");
  for await (const batch of readHistory<ListRow & VersionProjection>(
    "ota_updates",
    columns,
  )) {
    for (const row of batch) {
      const key = scopeKey(row);
      scopes.set(key, makeScopeFromRow(row));
      channels.add(row.channel);
      runtimes.add(row.runtime_version);
      const item = mapRowToRecord(
        row,
        channelsByScope.get(key) ?? null,
        getAppVersionFromFields(row.app_version, row.legacy_version),
      );
      if (matchesRelease(item, options, search)) matching.push(item);
    }
  }

  const rollbackLockByScope = Array.from(scopes, ([key, scope]) => {
    const channel = channelsByScope.get(key);
    const rollbackActive =
      Boolean(channel?.active_update_id) &&
      channel?.active_update_id !== channel?.latest_update_id;
    return {
      ...scope,
      scopeKey: `${scope.runtimeVersion}::${scope.channel}::${scope.platform}`,
      rollbackActive,
      autoDeliveryEnabled: !rollbackActive,
      activeUpdateId: channel?.active_update_id ?? null,
      latestUpdateId: channel?.latest_update_id ?? null,
    };
  });

  const sorted = sortUpdates(matching, options.sortBy, options.order);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / options.pageSize));
  const page = Math.min(Math.max(1, options.page), totalPages);
  const start = (page - 1) * options.pageSize;
  const end = start + options.pageSize;

  return {
    items: sorted.slice(start, end),
    filters: { channels: [...channels].sort(), runtimes: [...runtimes].sort() },
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
    isNewestInScope: newestRow?.update_id === row.update_id,
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
  // Retire the row under the distribution lock before removing its assets,
  // so it cannot be restored concurrently while storage cleanup is in flight.
  await changeDistribution(updateId, "retire");

  let removedFiles = 0;
  const bucket = row.storage_bucket || SUPABASE_BUCKET;
  const basePath = toPosixPath(row.storage_base_path || "");

  if (basePath) {
    const files = await listAllFilesRecursive(bucket, basePath);
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

  await changeDistribution(updateId, "delete");
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
  if (!nextJson || typeof nextJson !== "object" || Array.isArray(nextJson)) {
    throw new Error("content must be a JSON object");
  }

  const content = nextJson as Record<string, unknown>;

  if (
    fileName === "channel-latest.json" ||
    (fileName === "update-meta.json" && content.isActive !== false)
  ) {
    await assertOtaDistributionAllowed();
  }

  const updateId = extractUpdateIdFromKey(key);
  const row = await getUpdateRowById(updateId);

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
    if (typeof content.isActive !== "boolean")
      throw new Error("update-meta.json requires an explicit boolean isActive.");
    await changeDistribution(updateId, content.isActive ? "activate" : "stop");
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
  if (scopeKey(channelTarget) !== scopeKey(row))
    throw new Error("The channel target must belong to the same scope.");
  await changeDistribution(channelTarget.update_id, "select-latest");

  return {
    path: `${channelTarget.runtime_version}/${channelTarget.platform}/channels/${channelTarget.channel}/latest.json`,
  };
}

export async function rollbackToUpdateByKey(
  key: string,
  options?: RollbackOptions,
) {
  await assertOtaDistributionAllowed();
  const result = await changeDistribution(extractUpdateIdFromKey(key), "rollback");
  return { ...result, reason: options?.reason || "rollback" };
}

export async function promoteLatestByKey(key: string) {
  await assertOtaDistributionAllowed();
  return changeDistribution(extractUpdateIdFromKey(key), "promote");
}

export async function setUpdateDisabledByKey(key: string, disabled: boolean) {
  if (!disabled) await assertOtaDistributionAllowed();
  return changeDistribution(extractUpdateIdFromKey(key), disabled ? "stop" : "activate");
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
