import { parseDictionary } from "structured-headers";

export const installationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const deviceIdPattern = /^[0-9a-f]{64}$/;
export type Audience = {
  audience_mode: "all" | "devices";
  audience_installation_ids: string[];
  audience_device_ids: string[];
  audience_version: number;
};
export type RequestIdentity = {
  installationId: string | null;
  deviceId: string | null;
};

export function readRequestIdentity(headers: Headers): RequestIdentity {
  const anonymous = { installationId: null, deviceId: null };
  const raw = headers.get("expo-extra-params");
  if (!raw || raw.length > 8192) return anonymous;
  try {
    const params = parseDictionary(raw);
    const installation = params.get("installation_id")?.[0];
    const device = params.get("device_id")?.[0];
    return {
      installationId:
        typeof installation === "string" &&
        installationIdPattern.test(installation.toLowerCase())
          ? installation.toLowerCase()
          : null,
      deviceId:
        typeof device === "string" && deviceIdPattern.test(device)
          ? device
          : null,
    };
  } catch {
    return anonymous;
  }
}

export function eligibleForAudience(
  row: Partial<Audience>,
  identity: RequestIdentity,
): boolean {
  if (row.audience_mode === "all") return true;
  if (row.audience_mode !== "devices") return false;
  return Boolean(
    (identity.installationId &&
      row.audience_installation_ids?.includes(identity.installationId)) ||
    (identity.deviceId && row.audience_device_ids?.includes(identity.deviceId)),
  );
}

export function parseAudience(value: unknown): Audience {
  if (!value || typeof value !== "object") throw new Error("Invalid audience");
  const v = value as Record<string, unknown>;
  const ids = (key: string, pattern: RegExp): string[] => {
    const list = v[key];
    if (
      !Array.isArray(list) ||
      list.length > 100 ||
      list.some((id) => typeof id !== "string" || !pattern.test(id))
    )
      throw new Error("Invalid target IDs (maximum 100 per type)");
    return [...new Set(list)];
  };
  const installations = ids("audience_installation_ids", installationIdPattern);
  const devices = ids("audience_device_ids", deviceIdPattern);
  if (
    (v.audience_mode !== "all" && v.audience_mode !== "devices") ||
    !Number.isSafeInteger(v.audience_version) ||
    Number(v.audience_version) < 1
  )
    throw new Error("Invalid audience mode or version");
  if (
    v.audience_mode === "devices" &&
    installations.length + devices.length === 0
  )
    throw new Error("Select at least one device or installation");
  return {
    audience_mode: v.audience_mode,
    audience_installation_ids: installations,
    audience_device_ids: devices,
    audience_version: Number(v.audience_version),
  };
}
