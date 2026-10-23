import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("../lib/supabase.js", () => ({ supabase: { rpc } }));
import { getDevicesReport, parseDeviceFilters } from "./report";

describe("device analytics filters", () => {
  beforeEach(() => rpc.mockReset());

  it("passes every validated filter to the versioned report RPC", async () => {
    const filters = parseDeviceFilters(new URLSearchParams("days=30&platform=ios&channel=production&runtime=1.0&launchKind=ota&search=ABC123&offset=50"));
    expect(filters).toEqual({ p_days: 30, p_platform: "ios", p_channel: "production", p_runtime: "1.0", p_offset: 50, p_launch_kind: "ota", p_search: "abc123" });
    rpc.mockResolvedValue({ data: [{ report: { total: 3 } }] });
    expect(await getDevicesReport(filters)).toEqual({ total: 3 });
    expect(rpc).toHaveBeenCalledWith("ota_devices_report_v2", filters);
  });

  it.each(["days=7&days=30", "platform=ios&platform=android", "launchKind=all", "search=%25", "search=abcdef_", `search=${"a".repeat(37)}`, "search=%00", "runtime=%09", "offset=Infinity"])("rejects invalid or nonscalar filters: %s", (query) => {
    expect(() => parseDeviceFilters(new URLSearchParams(query))).toThrow("Invalid filters");
  });

  it("keeps empty optional controls unfiltered", () => {
    expect(parseDeviceFilters(new URLSearchParams("launchKind=&search=%20%20"))).toMatchObject({ p_launch_kind: null, p_search: null });
  });

  it.each([{ error: { message: "database unavailable" } }, { data: [] }])("fails if storage does not return an analytics report", async (result) => {
    rpc.mockResolvedValue(result);
    await expect(getDevicesReport(parseDeviceFilters(new URLSearchParams()))).rejects.toThrow();
  });
});
