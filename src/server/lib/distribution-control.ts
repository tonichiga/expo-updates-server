import { jsonb, supabase } from "./supabase.js";

export const DISTRIBUTION_REASON_MAX_LENGTH = 500;

export type DistributionControlPrincipal = {
  type: "session" | "access-token" | "system";
  id: string;
  label: string;
  role?: string;
};

export type DistributionControlState = {
  blocked: boolean;
  version: number;
  reason: string | null;
  changedAt: string;
  changedBy: DistributionControlPrincipal;
};

export class DistributionControlValidationError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "DistributionControlValidationError";
  }
}

export class DistributionControlConflictError extends Error {
  readonly status = 409;

  constructor() {
    super("Distribution control version conflict. Refresh and try again.");
    this.name = "DistributionControlConflictError";
  }
}

export class OtaDistributionBlockedError extends Error {
  readonly status = 409;

  constructor() {
    super(
      "OTA distribution is globally blocked. Disable the emergency switch before starting distribution.",
    );
    this.name = "OtaDistributionBlockedError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid OTA distribution control ${field}.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`Invalid OTA distribution control ${field}.`);
  }
  return normalized;
}

function parsePrincipal(value: unknown): DistributionControlPrincipal {
  if (!isRecord(value)) {
    throw new Error("Invalid OTA distribution control changed_by.");
  }

  const type = value.type;
  if (
    type !== "session" &&
    type !== "access-token" &&
    type !== "system"
  ) {
    throw new Error("Invalid OTA distribution control principal type.");
  }

  const role =
    typeof value.role === "string" && value.role.trim()
      ? value.role.trim()
      : undefined;

  return {
    type,
    id: requiredString(value.id, "principal id", 200),
    label: requiredString(value.label, "principal label", 200),
    ...(role ? { role } : {}),
  };
}

function parseChangedAt(value: unknown): string {
  const changedAt =
    value instanceof Date
      ? value
      : new Date(requiredString(value, "changed_at", 100));

  if (Number.isNaN(changedAt.getTime())) {
    throw new Error("Invalid OTA distribution control changed_at.");
  }
  return changedAt.toISOString();
}

function parseStateRow(value: unknown): DistributionControlState {
  if (!isRecord(value)) {
    throw new Error("OTA distribution control state is missing.");
  }

  const version = Number(value.version);
  if (
    typeof value.blocked !== "boolean" ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    throw new Error("Invalid OTA distribution control state.");
  }

  const changedAt = parseChangedAt(value.changed_at);

  const reason =
    value.reason === null
      ? null
      : requiredString(
          value.reason,
          "reason",
          DISTRIBUTION_REASON_MAX_LENGTH,
        );
  if (value.blocked && !reason) {
    throw new Error("Blocked OTA distribution state has no reason.");
  }
  if (!value.blocked && reason !== null) {
    throw new Error("Active OTA distribution state must not have a reason.");
  }

  return {
    blocked: value.blocked,
    version,
    reason,
    changedAt,
    changedBy: parsePrincipal(value.changed_by),
  };
}

function validateReason(blocked: boolean, reason: unknown): string | null {
  if (!blocked) {
    return null;
  }
  if (typeof reason !== "string") {
    throw new DistributionControlValidationError(
      "reason is required when OTA distribution is blocked.",
    );
  }
  const normalized = reason.trim();
  if (!normalized) {
    throw new DistributionControlValidationError(
      "reason is required when OTA distribution is blocked.",
    );
  }
  if (
    Array.from(normalized).length > DISTRIBUTION_REASON_MAX_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new DistributionControlValidationError(
      `reason must contain at most ${DISTRIBUTION_REASON_MAX_LENGTH} characters and no control characters.`,
    );
  }
  return normalized;
}

function validatePrincipal(
  principal: DistributionControlPrincipal,
): DistributionControlPrincipal {
  try {
    return parsePrincipal(principal);
  } catch {
    throw new DistributionControlValidationError(
      "principal metadata is invalid.",
    );
  }
}

export async function getDistributionControlState(): Promise<DistributionControlState> {
  const { data, error } = await supabase
    .from("ota_distribution_control")
    .select("blocked,version,reason,changed_at,changed_by")
    .eq("singleton_id", 1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to read OTA distribution control: ${error.message}`,
    );
  }
  return parseStateRow(data);
}

export async function isOtaDistributionBlocked(): Promise<boolean> {
  return (await getDistributionControlState()).blocked;
}

export async function setDistributionControlState(input: {
  blocked: unknown;
  reason?: unknown;
  expectedVersion: unknown;
  principal: DistributionControlPrincipal;
}): Promise<DistributionControlState> {
  if (typeof input.blocked !== "boolean") {
    throw new DistributionControlValidationError(
      "blocked must be a boolean.",
    );
  }
  if (
    typeof input.expectedVersion !== "number" ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 1
  ) {
    throw new DistributionControlValidationError(
      "expectedVersion must be a positive integer.",
    );
  }

  const reason = validateReason(input.blocked, input.reason);
  const principal = validatePrincipal(input.principal);
  const { data, error } = await supabase.rpc(
    "set_ota_distribution_control",
    {
      p_blocked: input.blocked,
      p_reason: reason,
      p_expected_version: input.expectedVersion,
      p_changed_by: jsonb(principal),
    },
  );

  if (error) {
    const message = String(error.message || "");
    if (
      message.toLowerCase().includes("version conflict") ||
      message.includes("40001")
    ) {
      throw new DistributionControlConflictError();
    }
    throw new Error(`Failed to update OTA distribution control: ${message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error("OTA distribution control update returned no state.");
  }
  return parseStateRow(row);
}

export async function assertOtaDistributionAllowed(): Promise<void> {
  if (await isOtaDistributionBlocked()) {
    throw new OtaDistributionBlockedError();
  }
}
