export const UPDATE_POLICY_SCHEMA_VERSION = 1 as const;

export type UpdateDeliveryMode = "manual" | "background";
export type UpdatePolicyGuard = {
  action: string;
  payload?: unknown;
};
export type UpdatePolicyInput = {
  delivery: UpdateDeliveryMode;
  guard: UpdatePolicyGuard | null;
};
export type ManifestUpdatePolicy = {
  schemaVersion: 1;
  policyVersion: number;
  delivery: UpdateDeliveryMode;
  guard?: UpdatePolicyGuard;
};

const MAX_ACTION_LENGTH = 100;
const MAX_PAYLOAD_BYTES = 16 * 1024;
const MAX_PAYLOAD_DEPTH = 10;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

export class UpdatePolicyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpdatePolicyValidationError";
  }
}

function fail(path: string, message: string): never {
  throw new UpdatePolicyValidationError(`${path}: ${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateJsonValue(
  value: unknown,
  path: string,
  depth = 0,
): void {
  if (depth > MAX_PAYLOAD_DEPTH) {
    fail(path, `JSON depth must not exceed ${MAX_PAYLOAD_DEPTH}`);
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "numbers must be finite");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateJsonValue(item, `${path}[${index}]`, depth + 1),
    );
    return;
  }
  if (isObject(value)) {
    Object.entries(value).forEach(([key, item]) =>
      validateJsonValue(item, `${path}.${key}`, depth + 1),
    );
    return;
  }
  fail(path, "must be JSON-serializable");
}

function validatePayload(payload: unknown): void {
  validateJsonValue(payload, "policy.guard.payload");
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    fail("policy.guard.payload", "must be JSON-serializable");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) {
    fail(
      "policy.guard.payload",
      `must not exceed ${MAX_PAYLOAD_BYTES} UTF-8 bytes`,
    );
  }
}

export function validateUpdatePolicy(value: unknown): UpdatePolicyInput {
  if (!isObject(value)) fail("policy", "must be an object");
  if (value.delivery !== "manual" && value.delivery !== "background") {
    fail("policy.delivery", "must be manual or background");
  }

  if (value.guard === null) {
    return { delivery: value.delivery, guard: null };
  }
  if (!isObject(value.guard)) {
    fail("policy.guard", "must be an object or null");
  }

  const action = value.guard.action;
  if (typeof action !== "string") {
    fail("policy.guard.action", "must be a string");
  }
  if (!action.trim()) {
    if (value.guard.payload !== undefined && value.guard.payload !== null) {
      fail("policy.guard.payload", "must be absent when action is empty");
    }
    return { delivery: value.delivery, guard: null };
  }
  if (
    action !== action.trim() ||
    Array.from(action).length > MAX_ACTION_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(action)
  ) {
    fail(
      "policy.guard.action",
      "must be trimmed, contain 1-100 characters, and have no control characters",
    );
  }

  if (value.guard.payload !== undefined && value.guard.payload !== null) {
    validatePayload(value.guard.payload);
  }

  return {
    delivery: value.delivery,
    guard: {
      action,
      ...(value.guard.payload !== undefined && value.guard.payload !== null
        ? { payload: value.guard.payload }
        : {}),
    },
  };
}

export function createManifestUpdatePolicy({
  delivery,
  guard,
  policyVersion,
  onCorrupt,
}: {
  delivery: unknown;
  guard: unknown;
  policyVersion: unknown;
  onCorrupt?: (error: Error) => void;
}): ManifestUpdatePolicy {
  try {
    const validated = validateUpdatePolicy({ delivery, guard });
    if (!Number.isInteger(policyVersion) || (policyVersion as number) < 1) {
      fail("policy.policyVersion", "must be a positive integer");
    }
    return {
      schemaVersion: UPDATE_POLICY_SCHEMA_VERSION,
      policyVersion: policyVersion as number,
      delivery: validated.delivery,
      ...(validated.guard ? { guard: validated.guard } : {}),
    };
  } catch (error: unknown) {
    onCorrupt?.(error as Error);
    return {
      schemaVersion: UPDATE_POLICY_SCHEMA_VERSION,
      policyVersion:
        Number.isInteger(policyVersion) && (policyVersion as number) > 0
          ? (policyVersion as number)
          : 1,
      delivery: "manual",
    };
  }
}
