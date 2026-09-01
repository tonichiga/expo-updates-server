export const UPDATE_POLICY_SCHEMA_VERSION = 1 as const;
export const MAX_UPDATE_POLICY_RULES = 50;

export type UpdateDeliveryMode = "manual" | "background";
export type UpdatePolicyField =
  | "runtimeVersion"
  | "platform"
  | "channel"
  | "buildId"
  | "updateId"
  | "appVersion"
  | "currentUpdateId"
  | "embeddedUpdateId";
export type UpdatePolicyOperator =
  | "equals"
  | "notEquals"
  | "in"
  | "notIn"
  | "exists"
  | "notExists";

export type UpdatePolicyCondition = {
  field: UpdatePolicyField;
  operator: UpdatePolicyOperator;
  value?: string | string[];
};

export type UpdatePolicyRule = {
  id: string;
  enabled: boolean;
  priority: number;
  action: string;
  payload?: unknown;
  groups: Array<{ conditions: UpdatePolicyCondition[] }>;
};

export type UpdatePolicyInput = {
  delivery: UpdateDeliveryMode;
  rules: UpdatePolicyRule[];
};

export type UpdatePolicyContext = Partial<
  Record<UpdatePolicyField, string | null | undefined>
>;

export type ManifestUpdatePolicy = {
  schemaVersion: 1;
  policyVersion: number;
  delivery: UpdateDeliveryMode;
  guard?: { action: string; payload?: unknown };
};

const FIELDS = new Set<UpdatePolicyField>([
  "runtimeVersion",
  "platform",
  "channel",
  "buildId",
  "updateId",
  "appVersion",
  "currentUpdateId",
  "embeddedUpdateId",
]);
const OPERATORS = new Set<UpdatePolicyOperator>([
  "equals",
  "notEquals",
  "in",
  "notIn",
  "exists",
  "notExists",
]);
const LOWERCASE_FIELDS = new Set<UpdatePolicyField>([
  "platform",
  "channel",
  "buildId",
  "updateId",
  "currentUpdateId",
  "embeddedUpdateId",
]);
const MAX_PAYLOAD_BYTES = 16 * 1024;
const MAX_PAYLOAD_DEPTH = 10;
const MAX_VALUE_LENGTH = 500;
const MAX_ARRAY_VALUES = 100;

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
    if (!Number.isFinite(value)) {
      fail(path, "numbers must be finite");
    }
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

function normalizeValue(field: UpdatePolicyField, value: string): string {
  const normalized = value.trim();
  return LOWERCASE_FIELDS.has(field) ? normalized.toLowerCase() : normalized;
}

function validateCondition(
  value: unknown,
  path: string,
): UpdatePolicyCondition {
  if (!isObject(value)) {
    fail(path, "must be an object");
  }
  if (!FIELDS.has(value.field as UpdatePolicyField)) {
    fail(`${path}.field`, "is not supported");
  }
  if (!OPERATORS.has(value.operator as UpdatePolicyOperator)) {
    fail(`${path}.operator`, "is not supported");
  }

  const field = value.field as UpdatePolicyField;
  const operator = value.operator as UpdatePolicyOperator;
  if (operator === "exists" || operator === "notExists") {
    if (value.value !== undefined) {
      fail(`${path}.value`, `must be omitted for ${operator}`);
    }
    return { field, operator };
  }

  if (operator === "equals" || operator === "notEquals") {
    if (typeof value.value !== "string") {
      fail(`${path}.value`, `must be a string for ${operator}`);
    }
    const normalized = normalizeValue(field, value.value);
    if (!normalized || normalized.length > MAX_VALUE_LENGTH) {
      fail(
        `${path}.value`,
        `must be nonempty and at most ${MAX_VALUE_LENGTH} characters`,
      );
    }
    return { field, operator, value: normalized };
  }

  if (
    !Array.isArray(value.value) ||
    value.value.length === 0 ||
    value.value.length > MAX_ARRAY_VALUES
  ) {
    fail(
      `${path}.value`,
      `must contain 1-${MAX_ARRAY_VALUES} string values for ${operator}`,
    );
  }
  const values = value.value.map((item, index) => {
    if (typeof item !== "string") {
      fail(`${path}.value[${index}]`, "must be a string");
    }
    const normalized = normalizeValue(field, item);
    if (!normalized || normalized.length > MAX_VALUE_LENGTH) {
      fail(
        `${path}.value[${index}]`,
        `must be nonempty and at most ${MAX_VALUE_LENGTH} characters`,
      );
    }
    return normalized;
  });
  return { field, operator, value: Array.from(new Set(values)) };
}

export function validateUpdatePolicy(value: unknown): UpdatePolicyInput {
  if (!isObject(value)) {
    fail("policy", "must be an object");
  }
  if (value.delivery !== "manual" && value.delivery !== "background") {
    fail("policy.delivery", "must be manual or background");
  }
  if (
    !Array.isArray(value.rules) ||
    value.rules.length > MAX_UPDATE_POLICY_RULES
  ) {
    fail(
      "policy.rules",
      `must be an array with at most ${MAX_UPDATE_POLICY_RULES} rules`,
    );
  }

  const ids = new Set<string>();
  const priorities = new Set<number>();
  const rules = value.rules.map((ruleValue, ruleIndex): UpdatePolicyRule => {
    const path = `policy.rules[${ruleIndex}]`;
    if (!isObject(ruleValue)) {
      fail(path, "must be an object");
    }
    if (
      typeof ruleValue.id !== "string" ||
      !ruleValue.id.trim() ||
      ruleValue.id.trim().length > 100
    ) {
      fail(`${path}.id`, "must be nonempty and at most 100 characters");
    }
    const id = ruleValue.id.trim();
    if (ids.has(id)) {
      fail(`${path}.id`, "must be unique");
    }
    ids.add(id);
    if (typeof ruleValue.enabled !== "boolean") {
      fail(`${path}.enabled`, "must be a boolean");
    }
    if (
      !Number.isInteger(ruleValue.priority) ||
      (ruleValue.priority as number) < 0
    ) {
      fail(`${path}.priority`, "must be an explicit nonnegative integer");
    }
    const priority = ruleValue.priority as number;
    if (priorities.has(priority)) {
      fail(`${path}.priority`, "must be unique");
    }
    priorities.add(priority);
    if (
      typeof ruleValue.action !== "string" ||
      !ruleValue.action.trim() ||
      ruleValue.action.trim().length > 100
    ) {
      fail(`${path}.action`, "must be nonempty and at most 100 characters");
    }
    if (ruleValue.payload !== undefined) {
      validateJsonValue(ruleValue.payload, `${path}.payload`);
      let serialized: string;
      try {
        serialized = JSON.stringify(ruleValue.payload);
      } catch {
        fail(`${path}.payload`, "must be JSON-serializable");
      }
      if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) {
        fail(
          `${path}.payload`,
          `must not exceed ${MAX_PAYLOAD_BYTES} UTF-8 bytes`,
        );
      }
    }
    if (
      !Array.isArray(ruleValue.groups) ||
      ruleValue.groups.length < 1 ||
      ruleValue.groups.length > 10
    ) {
      fail(`${path}.groups`, "must contain 1-10 OR groups");
    }
    const groups = ruleValue.groups.map((groupValue, groupIndex) => {
      const groupPath = `${path}.groups[${groupIndex}]`;
      if (
        !isObject(groupValue) ||
        !Array.isArray(groupValue.conditions) ||
        groupValue.conditions.length < 1 ||
        groupValue.conditions.length > 20
      ) {
        fail(`${groupPath}.conditions`, "must contain 1-20 AND conditions");
      }
      return {
        conditions: groupValue.conditions.map((condition, conditionIndex) =>
          validateCondition(
            condition,
            `${groupPath}.conditions[${conditionIndex}]`,
          ),
        ),
      };
    });
    return {
      id,
      enabled: ruleValue.enabled,
      priority,
      action: ruleValue.action.trim(),
      ...(ruleValue.payload !== undefined
        ? { payload: ruleValue.payload }
        : {}),
      groups,
    };
  });

  return { delivery: value.delivery, rules };
}

function conditionMatches(
  condition: UpdatePolicyCondition,
  context: UpdatePolicyContext,
): boolean {
  const rawValue = context[condition.field];
  const exists = typeof rawValue === "string" && rawValue.trim().length > 0;
  if (condition.operator === "exists") {
    return exists;
  }
  if (condition.operator === "notExists") {
    return !exists;
  }
  // Missing values never satisfy comparisons, including negative comparisons.
  if (!exists) {
    return false;
  }
  const actual = normalizeValue(condition.field, rawValue);
  if (condition.operator === "equals") {
    return actual === condition.value;
  }
  if (condition.operator === "notEquals") {
    return actual !== condition.value;
  }
  const values = condition.value as string[];
  return condition.operator === "in"
    ? values.includes(actual)
    : !values.includes(actual);
}

export function evaluateUpdatePolicy(
  rules: UpdatePolicyRule[],
  context: UpdatePolicyContext,
): UpdatePolicyRule | null {
  return (
    [...rules]
      .filter((rule) => rule.enabled)
      .sort((a, b) => a.priority - b.priority)
      .find((rule) =>
        rule.groups.some((group) =>
          group.conditions.every((condition) =>
            conditionMatches(condition, context),
          ),
        ),
      ) || null
  );
}

export function createManifestUpdatePolicy({
  delivery,
  rules,
  policyVersion,
  context,
  onCorrupt,
}: {
  delivery: unknown;
  rules: unknown;
  policyVersion: unknown;
  context: UpdatePolicyContext;
  onCorrupt?: (error: Error) => void;
}): ManifestUpdatePolicy {
  try {
    const validated = validateUpdatePolicy({ delivery, rules });
    if (!Number.isInteger(policyVersion) || (policyVersion as number) < 1) {
      fail("policy.policyVersion", "must be a positive integer");
    }
    const match = evaluateUpdatePolicy(validated.rules, context);
    return {
      schemaVersion: UPDATE_POLICY_SCHEMA_VERSION,
      policyVersion: policyVersion as number,
      delivery: validated.delivery,
      ...(match
        ? {
            guard: {
              action: match.action,
              ...(match.payload !== undefined
                ? { payload: match.payload }
                : {}),
            },
          }
        : {}),
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
