import { supabase } from "./supabase.js";

export type EmbeddedUpdateRow = {
  embedded_update_id: string;
  app_version?: string | null;
  created_at: string;
  channel: string;
  platform: "ios" | "android";
  is_embedded: boolean;
  inserted_at: string;
  modified_at: string;
};

export type EmbeddedUpdateRecord = {
  embeddedUpdateId: string;
  appVersion: string | null;
  createdAt: string;
  channel: string;
  platform: "ios" | "android";
  isEmbedded: boolean;
  insertedAt: string;
  modifiedAt: string;
};

export type RegisterEmbeddedUpdateInput = {
  embeddedUpdateId: string;
  appVersion: string | null;
  createdAt: string;
  channel: string;
  platform: "ios" | "android";
};

export class EmbeddedUpdateValidationError extends Error {}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHANNEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function parseRegisterEmbeddedUpdateInput(
  value: unknown,
): RegisterEmbeddedUpdateInput {
  if (!value || typeof value !== "object") {
    throw new EmbeddedUpdateValidationError("JSON body is required");
  }

  const input = value as Record<string, unknown>;
  const embeddedUpdateId = String(
    input.embeddedUpdateId || input.id || "",
  ).trim();
  const createdAt = String(input.createdAt || "").trim();
  const channel = String(input.channel || "").trim().toLowerCase();
  const platform = String(input.platform || "").trim().toLowerCase();
  const appVersion =
    typeof input.appVersion === "string" && input.appVersion.trim()
      ? input.appVersion.trim()
      : null;

  if (!UUID_PATTERN.test(embeddedUpdateId)) {
    throw new EmbeddedUpdateValidationError(
      "embeddedUpdateId must be a valid UUID",
    );
  }
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) {
    throw new EmbeddedUpdateValidationError(
      "createdAt must be a valid ISO datetime",
    );
  }
  if (!CHANNEL_PATTERN.test(channel)) {
    throw new EmbeddedUpdateValidationError(
      "channel must contain only lowercase letters, numbers, dots, underscores or hyphens",
    );
  }
  if (platform !== "ios" && platform !== "android") {
    throw new EmbeddedUpdateValidationError(
      "platform must be ios or android",
    );
  }

  return {
    embeddedUpdateId,
    appVersion,
    createdAt: new Date(createdAt).toISOString(),
    channel,
    platform,
  };
}

export function mapEmbeddedUpdateRow(
  row: EmbeddedUpdateRow,
): EmbeddedUpdateRecord {
  return {
    embeddedUpdateId: row.embedded_update_id,
    appVersion: row.app_version || null,
    createdAt: row.created_at,
    channel: row.channel,
    platform: row.platform,
    isEmbedded: row.is_embedded,
    insertedAt: row.inserted_at,
    modifiedAt: row.modified_at,
  };
}

export function buildEmbeddedUpdateUpsertRow(
  input: RegisterEmbeddedUpdateInput,
) {
  return {
    embedded_update_id: input.embeddedUpdateId,
    created_at: input.createdAt,
    channel: input.channel,
    platform: input.platform,
    is_embedded: true,
    ...(input.appVersion ? { app_version: input.appVersion } : {}),
  };
}

export async function registerEmbeddedUpdate(
  input: RegisterEmbeddedUpdateInput,
): Promise<EmbeddedUpdateRecord> {
  const row = buildEmbeddedUpdateUpsertRow(input);
  const { data, error } = await supabase
    .from("ota_embedded_updates")
    .upsert(row, {
      onConflict: "embedded_update_id",
      defaultToNull: false,
    })
    .select(
      "embedded_update_id,app_version,created_at,channel,platform,is_embedded,inserted_at,modified_at",
    )
    .single();

  if (error) {
    throw new Error(`Failed to register embedded update: ${error.message}`);
  }

  const saved = data as EmbeddedUpdateRow;
  return mapEmbeddedUpdateRow(saved);
}

export async function listEmbeddedUpdates(): Promise<EmbeddedUpdateRecord[]> {
  const { data, error } = await supabase
    .from("ota_embedded_updates")
    .select(
      "embedded_update_id,app_version,created_at,channel,platform,is_embedded,inserted_at,modified_at",
    )
    .order("created_at", { ascending: false })
    .execute();

  if (error) {
    throw new Error(`Failed to fetch embedded updates: ${error.message}`);
  }

  return ((data || []) as EmbeddedUpdateRow[]).map(mapEmbeddedUpdateRow);
}

export async function deleteEmbeddedUpdateById(embeddedUpdateId: string) {
  const { error } = await supabase
    .from("ota_embedded_updates")
    .delete()
    .eq("embedded_update_id", embeddedUpdateId)
    .execute();

  if (error) {
    throw new Error(`Failed to delete embedded update: ${error.message}`);
  }

  return { deletedId: embeddedUpdateId };
}
