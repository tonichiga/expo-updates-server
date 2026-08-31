import { randomUUID } from "node:crypto";
import { supabase } from "./supabase.js";

export type EmergencyRedirectPlatform = "android" | "ios";
export type EmergencyRedirectTargetMode = "pinned" | "follow";

export type EmergencyChannelRedirect = {
  id: string;
  name: string;
  enabled: boolean;
  embeddedUpdateId: string;
  runtimeVersion: string;
  platform: EmergencyRedirectPlatform;
  fromChannel: string;
  toChannel: string;
  targetMode: EmergencyRedirectTargetMode;
  expectedUpdateId: string | null;
  createdAt: string;
  modifiedAt: string;
};

export type EmergencyChannelRedirectInput = Omit<
  EmergencyChannelRedirect,
  "id" | "createdAt" | "modifiedAt"
>;

type EmergencyChannelRedirectRow = {
  id: string;
  name: string;
  enabled: boolean;
  embedded_update_id: string;
  runtime_version: string;
  platform: EmergencyRedirectPlatform;
  from_channel: string;
  to_channel: string;
  target_mode: EmergencyRedirectTargetMode;
  expected_update_id: string | null;
  created_at: string;
  modified_at: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class EmergencyRedirectValidationError extends Error {}

function requiredString(
  input: Record<string, unknown>,
  field: string,
): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new EmergencyRedirectValidationError(
      `${field} must be a non-empty string`,
    );
  }
  return value.trim();
}

export function parseEmergencyRedirectInput(
  value: unknown,
): EmergencyChannelRedirectInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EmergencyRedirectValidationError(
      "Emergency redirect must be a JSON object",
    );
  }

  const input = value as Record<string, unknown>;
  const name = requiredString(input, "name");
  const embeddedUpdateId = requiredString(
    input,
    "embeddedUpdateId",
  ).toLowerCase();
  const runtimeVersion = requiredString(input, "runtimeVersion");
  const fromChannel = requiredString(input, "fromChannel").toLowerCase();
  const toChannel = requiredString(input, "toChannel").toLowerCase();
  const platform = input.platform;
  const targetMode = input.targetMode;
  const enabled = input.enabled;
  const expectedUpdateId =
    typeof input.expectedUpdateId === "string" && input.expectedUpdateId.trim()
      ? input.expectedUpdateId.trim().toLowerCase()
      : null;

  if (name.length > 120) {
    throw new EmergencyRedirectValidationError(
      "name must contain at most 120 characters",
    );
  }
  if (!UUID_PATTERN.test(embeddedUpdateId)) {
    throw new EmergencyRedirectValidationError(
      "embeddedUpdateId must be a UUID",
    );
  }
  if (platform !== "android" && platform !== "ios") {
    throw new EmergencyRedirectValidationError(
      "platform must be android or ios",
    );
  }
  if (fromChannel === toChannel) {
    throw new EmergencyRedirectValidationError(
      "fromChannel and toChannel must differ",
    );
  }
  if (targetMode !== "pinned" && targetMode !== "follow") {
    throw new EmergencyRedirectValidationError(
      "targetMode must be pinned or follow",
    );
  }
  if (typeof enabled !== "boolean") {
    throw new EmergencyRedirectValidationError("enabled must be boolean");
  }
  if (targetMode === "pinned" && !expectedUpdateId) {
    throw new EmergencyRedirectValidationError(
      "expectedUpdateId is required in pinned mode",
    );
  }
  if (expectedUpdateId && !UUID_PATTERN.test(expectedUpdateId)) {
    throw new EmergencyRedirectValidationError(
      "expectedUpdateId must be a UUID",
    );
  }

  return {
    name,
    enabled,
    embeddedUpdateId,
    runtimeVersion,
    platform,
    fromChannel,
    toChannel,
    targetMode,
    expectedUpdateId,
  };
}

function mapRow(row: EmergencyChannelRedirectRow): EmergencyChannelRedirect {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    embeddedUpdateId: row.embedded_update_id,
    runtimeVersion: row.runtime_version,
    platform: row.platform,
    fromChannel: row.from_channel,
    toChannel: row.to_channel,
    targetMode: row.target_mode,
    expectedUpdateId: row.expected_update_id,
    createdAt: row.created_at,
    modifiedAt: row.modified_at,
  };
}

function toRow(
  id: string,
  input: EmergencyChannelRedirectInput,
): EmergencyChannelRedirectRow {
  const now = new Date().toISOString();
  return {
    id,
    name: input.name,
    enabled: input.enabled,
    embedded_update_id: input.embeddedUpdateId,
    runtime_version: input.runtimeVersion,
    platform: input.platform,
    from_channel: input.fromChannel,
    to_channel: input.toChannel,
    target_mode: input.targetMode,
    expected_update_id: input.expectedUpdateId,
    created_at: now,
    modified_at: now,
  };
}

export async function resolveEmergencyChannelRedirect({
  requestedChannel,
  runtimeVersion,
  platform,
  embeddedUpdateId,
}: {
  requestedChannel: string;
  runtimeVersion: string | null;
  platform: string | null;
  embeddedUpdateId: string | null;
}): Promise<EmergencyChannelRedirect | null> {
  if (
    !runtimeVersion ||
    (platform !== "android" && platform !== "ios") ||
    !embeddedUpdateId
  ) {
    return null;
  }

  const { data, error } = await supabase
    .from("ota_emergency_redirects")
    .select("*")
    .eq("enabled", true)
    .eq("embedded_update_id", embeddedUpdateId.toLowerCase())
    .eq("runtime_version", runtimeVersion)
    .eq("platform", platform)
    .eq("from_channel", requestedChannel)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve emergency redirect: ${error.message}`);
  }

  return data ? mapRow(data as EmergencyChannelRedirectRow) : null;
}

export async function listEmergencyRedirects(): Promise<
  EmergencyChannelRedirect[]
> {
  const { data, error } = await supabase
    .from("ota_emergency_redirects")
    .select("*")
    .order("modified_at", { ascending: false })
    .execute();

  if (error) {
    throw new Error(`Failed to list emergency redirects: ${error.message}`);
  }

  return ((data || []) as EmergencyChannelRedirectRow[]).map(mapRow);
}

export async function createEmergencyRedirect(
  value: unknown,
): Promise<EmergencyChannelRedirect> {
  const input = parseEmergencyRedirectInput(value);
  const row = toRow(randomUUID(), input);
  const { data, error } = await supabase
    .from("ota_emergency_redirects")
    .upsert(row, { onConflict: "id" })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create emergency redirect: ${error?.message}`);
  }

  return mapRow(data as EmergencyChannelRedirectRow);
}

async function getEmergencyRedirectRow(
  id: string,
): Promise<EmergencyChannelRedirectRow> {
  const { data, error } = await supabase
    .from("ota_emergency_redirects")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    throw new Error(`Emergency redirect not found: ${id}`);
  }

  return data as EmergencyChannelRedirectRow;
}

export async function updateEmergencyRedirect(
  id: string,
  patch: unknown,
): Promise<EmergencyChannelRedirect> {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new EmergencyRedirectValidationError("Patch must be a JSON object");
  }

  const current = mapRow(await getEmergencyRedirectRow(id));
  const input = parseEmergencyRedirectInput({
    ...current,
    ...(patch as Record<string, unknown>),
  });
  const { data, error } = await supabase
    .from("ota_emergency_redirects")
    .update({
      name: input.name,
      enabled: input.enabled,
      embedded_update_id: input.embeddedUpdateId,
      runtime_version: input.runtimeVersion,
      platform: input.platform,
      from_channel: input.fromChannel,
      to_channel: input.toChannel,
      target_mode: input.targetMode,
      expected_update_id: input.expectedUpdateId,
      modified_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to update emergency redirect: ${error?.message}`);
  }

  return mapRow(data as EmergencyChannelRedirectRow);
}

export async function deleteEmergencyRedirect(id: string): Promise<void> {
  const { error } = await supabase
    .from("ota_emergency_redirects")
    .delete()
    .eq("id", id)
    .execute();

  if (error) {
    throw new Error(`Failed to delete emergency redirect: ${error.message}`);
  }
}
