import type { UpdatePolicy, UpdatePolicyGuard } from "./admin-types";

export const behaviors = [
  "manual",
  "background",
  "required",
  "immediate",
  "store",
  "custom",
] as const;
export type PolicyBehavior = (typeof behaviors)[number];
export type PolicyDraft = {
  behavior: PolicyBehavior;
  delivery: UpdatePolicy["delivery"];
  action: string;
  payload: string;
};

const required = "ota-force-update";
const store = "ota-force-store-update";
export const isBuiltInAction = (action: string) =>
  action === required || action === store;

export function draftFromPolicy(
  policy: Pick<UpdatePolicy, "delivery" | "guard">,
): PolicyDraft {
  const { guard, delivery } = policy;
  let behavior: PolicyBehavior = delivery;
  if (guard) {
    behavior =
      guard.action === required
        ? delivery === "background"
          ? "immediate"
          : "required"
        : guard.action === store
          ? "store"
          : "custom";
  }
  return {
    behavior,
    delivery,
    action: guard?.action ?? "",
    payload:
      guard?.payload == null ? "" : JSON.stringify(guard.payload, null, 2),
  };
}

export function chooseBehavior(
  current: PolicyDraft,
  behavior: PolicyBehavior,
): PolicyDraft {
  if (behavior === current.behavior) return current;
  if (behavior === "required" || behavior === "immediate") {
    return {
      behavior,
      delivery: behavior === "immediate" ? "background" : "manual",
      action: required,
      payload: current.action === required ? current.payload : "",
    };
  }
  const delivery =
    behavior === "manual" || behavior === "background"
      ? behavior
      : current.delivery;
  const action = behavior === "store" ? store : "";
  return { behavior, delivery, action, payload: "" };
}

export function policyFromDraft(
  draft: PolicyDraft,
): Pick<UpdatePolicy, "delivery" | "guard"> {
  let guard: UpdatePolicyGuard | null = null;
  if (draft.behavior !== "manual" && draft.behavior !== "background") {
    if (!draft.action) throw new Error("Select or create a Guard action.");
    try {
      guard = {
        action: draft.action,
        ...(draft.payload.trim() ? { payload: JSON.parse(draft.payload) } : {}),
      };
    } catch {
      throw new Error("Guard payload must be valid JSON.");
    }
  }
  return { delivery: draft.delivery, guard };
}

// Only offer structured inputs when editing a link can preserve every other field.
export function storePayloadObject(
  payload: string,
): Record<string, unknown> | null {
  try {
    const value = payload.trim() ? JSON.parse(payload) : {};
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    return ["url", "iosUrl", "androidUrl"].every(
      (key) => value[key] === undefined || typeof value[key] === "string",
    )
      ? value
      : null;
  } catch {
    return null;
  }
}

export function setStoreLink(
  fields: Record<string, unknown>,
  key: string,
  value: string,
) {
  const next = { ...fields };
  if (value) next[key] = value;
  else delete next[key];
  return Object.keys(next).length ? JSON.stringify(next, null, 2) : "";
}

export function validStoreLink(payload: string, platform?: string): boolean {
  try {
    const fields = JSON.parse(payload);
    if (!fields || typeof fields !== "object") return false;
    const link = fields[(platform || "") + "Url"] || fields.url;
    if (typeof link !== "string") return false;
    const url = new URL(link);
    return /^(https|market|itms-apps):\/\//i.test(link) && Boolean(url.host);
  } catch {
    return false;
  }
}
