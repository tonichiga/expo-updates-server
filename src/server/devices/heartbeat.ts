import { deviceIdPattern } from "./audience";
import { jsonb, supabase } from "../lib/supabase.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type Heartbeat = {
  deviceId?: string;
  installationId: string; eventId: string; sequence: number; observedAt: string;
  platform: "ios" | "android"; channel: string; runtimeVersion: string;
  updateId: string | null; nativeVersion: string | null; nativeBuild: string | null;
  isEmbeddedLaunch: boolean; isEmergencyLaunch: boolean;
};
function shortString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
}
export function parseHeartbeat(value: unknown): Heartbeat {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid heartbeat");
  const v = value as Record<string, unknown>;
  if ((v.deviceId !== undefined && (typeof v.deviceId !== "string" || !deviceIdPattern.test(v.deviceId))) ||
    typeof v.installationId !== "string" || !uuid.test(v.installationId) ||
    typeof v.eventId !== "string" || !uuid.test(v.eventId) ||
    !Number.isSafeInteger(v.sequence) || Number(v.sequence) < 1 ||
    typeof v.observedAt !== "string" || !Number.isFinite(Date.parse(v.observedAt)) || new Date(v.observedAt).toISOString() !== v.observedAt ||
    (v.platform !== "ios" && v.platform !== "android") ||
    !shortString(v.channel, 64) || !/^[a-z0-9][a-z0-9._-]*$/.test(v.channel) ||
    !shortString(v.runtimeVersion, 100) ||
    !(v.updateId === null || (typeof v.updateId === "string" && uuid.test(v.updateId))) ||
    !(v.nativeVersion === null || shortString(v.nativeVersion, 100)) ||
    !(v.nativeBuild === null || shortString(v.nativeBuild, 100)) ||
    typeof v.isEmbeddedLaunch !== "boolean" || typeof v.isEmergencyLaunch !== "boolean") throw new Error("Invalid heartbeat");
  return {
    ...(typeof v.deviceId === "string" ? { deviceId: v.deviceId } : {}),
    installationId: v.installationId.toLowerCase(), eventId: v.eventId.toLowerCase(), sequence: Number(v.sequence), observedAt: v.observedAt,
    platform: v.platform as Heartbeat["platform"], channel: v.channel, runtimeVersion: v.runtimeVersion,
    updateId: typeof v.updateId === "string" ? v.updateId.toLowerCase() : null,
    nativeVersion: v.nativeVersion as string | null, nativeBuild: v.nativeBuild as string | null,
    isEmbeddedLaunch: v.isEmbeddedLaunch, isEmergencyLaunch: v.isEmergencyLaunch,
  };
}
class BodyTooLarge extends Error {}
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new BodyTooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function recordHeartbeat(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return Response.json({ error: "Expected application/json" }, { status: 415 });
  }
  let event: Heartbeat;
  try { event = parseHeartbeat(await readBody(request)); }
  catch (error) { return Response.json({ error: "Invalid heartbeat" }, { status: error instanceof BodyTooLarge ? 413 : 400 }); }
  try {
    const { data, error } = await supabase.rpc("ota_record_heartbeat", { p_event: jsonb(event) });
    if (error) {
      if (error.message.includes("HEARTBEAT_SEQUENCE_CONFLICT")) return Response.json({ error: "Sequence conflict" }, { status: 409 });
      throw new Error(error.message);
    }
    if (!["accepted", "duplicate", "stale"].includes(data?.[0]?.result)) throw new Error("Invalid heartbeat result");
    return Response.json({ status: data[0].result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Heartbeat storage failed", error);
    return Response.json({ error: "Heartbeat storage unavailable" }, { status: 503 });
  }
}
