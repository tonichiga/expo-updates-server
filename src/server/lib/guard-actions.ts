import { supabase } from "./supabase.js";

export type GuardAction = {
  id: string;
  actionKey: string;
  createdAt: string;
};

type GuardActionRow = {
  id: string;
  action_key: string;
  created_at: string;
};

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class GuardActionValidationError extends Error {}

export function parseGuardActionInput(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GuardActionValidationError(
      "Guard action must be a JSON object",
    );
  }

  const actionKey = (value as Record<string, unknown>).actionKey;
  if (typeof actionKey !== "string") {
    throw new GuardActionValidationError("actionKey must be a string");
  }

  const normalized = actionKey.trim();
  if (normalized.length < 1 || normalized.length > 100) {
    throw new GuardActionValidationError(
      "actionKey must contain between 1 and 100 characters",
    );
  }
  if (CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw new GuardActionValidationError(
      "actionKey must not contain control characters",
    );
  }

  return normalized;
}

export function parseGuardActionId(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new GuardActionValidationError("id must be a UUID");
  }
  return value.toLowerCase();
}

function mapRow(row: GuardActionRow): GuardAction {
  return {
    id: row.id,
    actionKey: row.action_key,
    createdAt: row.created_at,
  };
}

export async function listGuardActions(): Promise<GuardAction[]> {
  const { data, error } = await supabase
    .from("ota_guard_actions")
    .select("id,action_key,created_at")
    .order("action_key", { ascending: true })
    .execute();

  if (error) {
    throw new Error(`Failed to list guard actions: ${error.message}`);
  }

  return ((data || []) as GuardActionRow[]).map(mapRow);
}

export async function createGuardAction(value: unknown): Promise<GuardAction> {
  const actionKey = parseGuardActionInput(value);
  const { data, error } = await supabase
    .from("ota_guard_actions")
    .upsert(
      { action_key: actionKey },
      { onConflict: "action_key" },
    )
    .select("id,action_key,created_at")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create guard action: ${error?.message}`);
  }

  return mapRow(data as GuardActionRow);
}

export async function deleteGuardAction(id: string): Promise<void> {
  const normalizedId = parseGuardActionId(id);
  const { error } = await supabase
    .from("ota_guard_actions")
    .delete()
    .eq("id", normalizedId)
    .execute();

  if (error) {
    throw new Error(`Failed to delete guard action: ${error.message}`);
  }
}
