import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), from: vi.fn(), eq: vi.fn(), single: vi.fn() }));
vi.mock("@/src/server/lib/admin-api", () => ({ requireAdminSession: mocks.session }));
vi.mock("@/src/server/lib/supabase.js", () => ({ supabase: { from: mocks.from } }));
import { GET } from "./route";
const deviceId = "a".repeat(64);
const request = (id = deviceId) => new NextRequest(`http://test/api/admin/device-targets?platform=android&deviceId=${id}`);

describe("exact device name lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ role: "viewer" });
    mocks.from.mockReturnValue({ select: () => ({ eq: mocks.eq }) });
    mocks.eq.mockReturnValue({ maybeSingle: mocks.single });
    mocks.single.mockResolvedValue({ data: { device_id: deviceId, name: "My old phone" }, error: null });
  });
  it("retrieves a named device without requiring it in the recent installation list", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ deviceId, name: "My old phone" });
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("ota_named_devices");
    expect(mocks.eq).toHaveBeenCalledWith("device_id", deviceId);
  });
  it("distinguishes an unnamed device from an unavailable database", async () => {
    mocks.single.mockResolvedValueOnce({ data: null, error: null });
    expect(await (await GET(request())).json()).toEqual({ deviceId, name: null });
    mocks.single.mockResolvedValueOnce({ data: null, error: { message: "sensitive database detail" } });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Device name unavailable" });
  });
  it("rejects malformed IDs before querying the database", async () => {
    expect((await GET(request("invalid"))).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("requires a session before revealing a name", async () => {
    mocks.session.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await GET(request())).status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
