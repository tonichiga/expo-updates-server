import { supabase } from "../lib/supabase.js";
import type { DevicesReport } from "./report-types";

export function parseDeviceFilters(params: URLSearchParams) {
  for (const name of ["days", "offset", "platform", "channel", "runtime", "launchKind", "search"]) {
    if (params.getAll(name).length > 1) throw new Error("Invalid filters");
  }
  const days = Number(params.get("days") || 7);
  const offset = Number(params.get("offset") || 0);
  const platform = params.get("platform") || null;
  const channel = params.get("channel") || null;
  const runtime = params.get("runtime") || null;
  const launchKind = params.get("launchKind") || null;
  const search = params.get("search")?.trim().toLowerCase() || null;
  if (![1, 7, 30].includes(days) || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000 ||
    (platform !== null && !["ios", "android"].includes(platform)) ||
    (channel !== null && (channel.length > 64 || !/^[a-z0-9][a-z0-9._-]*$/.test(channel))) ||
    (runtime !== null && (runtime.length > 100 || runtime.trim() !== runtime || /[\x00-\x1f\x7f]/.test(runtime))) ||
    (launchKind !== null && !["ota", "embedded", "unknown"].includes(launchKind)) ||
    (search !== null && !/^[a-f0-9-]{1,36}$/.test(search))) throw new Error("Invalid filters");
  return { p_days: days, p_platform: platform, p_channel: channel, p_runtime: runtime, p_offset: offset, p_launch_kind: launchKind, p_search: search };
}
export async function getDevicesReport(filters: ReturnType<typeof parseDeviceFilters>): Promise<DevicesReport> {
  const { data, error } = await supabase.rpc("ota_devices_report_v2", filters);
  if (error || !data?.[0]?.report) throw new Error(error?.message || "Missing report");
  return data[0].report as DevicesReport;
}
