import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => vi.fn());
const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/src/server/lib/admin-api", () => ({ requireAdminSession: auth }));
vi.mock("@/src/server/lib/supabase.js", () => ({ supabase: db }));
import { DELETE, GET, PUT } from "./route";

const user = { id: "admin-a", role: "admin" };
const target = {
  platform: "ios",
  target_kind: "device",
  target_id: "a".repeat(64),
};
const payload = { ...target, name: "Personal phone", user_id: "admin-b" };
const request = (method = "GET", body?: unknown) =>
  new NextRequest(
    "http://test/api/admin/device-favorites?platform=ios&user_id=admin-b",
    {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );

describe("personal audience favorites", () => {
  const state = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
  };
  const favorites = {
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    execute: vi.fn(),
  };
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue(user);
    db.from.mockImplementation((name) =>
      name === "ota_device_state" ? state : favorites,
    );
    state.maybeSingle.mockResolvedValue({
      data: { device_id: target.target_id },
    });
    favorites.execute.mockResolvedValue({ error: null });
    db.rpc.mockResolvedValue({ data: [] });
  });

  it("derives owner from the session on every access", async () => {
    const list = await GET(request());
    expect(list.headers.get("cache-control")).toContain("no-store");
    expect(db.rpc).toHaveBeenCalledWith("ota_list_device_favorites", {
      p_user: user.id,
      p_platform: "ios",
    });
    expect((await PUT(request("PUT", payload))).status).toBe(200);
    expect(favorites.upsert).toHaveBeenCalledWith(
      { ...payload, user_id: user.id },
      { onConflict: "user_id,platform,target_kind,target_id" },
    );
    expect((await DELETE(request("DELETE", payload))).status).toBe(200);
    expect(favorites.eq.mock.calls).toEqual([
      ["user_id", user.id],
      ["platform", "ios"],
      ["target_kind", "device"],
      ["target_id", target.target_id],
    ]);
  });

  it.each([
    { platform: "macos" },
    { target_kind: "other" },
    { target_kind: "installation" },
    { target_id: "" },
    { name: "" },
    { name: " padded " },
    { name: "abc\n123" },
    { name: "x".repeat(81) },
  ])("rejects invalid input before querying targets: %j", async (invalid) => {
    expect((await PUT(request("PUT", { ...payload, ...invalid }))).status).toBe(
      400,
    );
    expect(db.from).not.toHaveBeenCalled();
  });

  it("lets registration disappear without losing the ability to remove a favorite", async () => {
    state.maybeSingle.mockResolvedValueOnce({ data: null });
    expect((await PUT(request("PUT", payload))).status).toBe(404);
    expect(favorites.upsert).not.toHaveBeenCalled();
    expect((await DELETE(request("DELETE", target))).status).toBe(200);
    expect(state.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("distinguishes storage errors from missing targets without leaking database details", async () => {
    const internal = { error: { message: "internal detail" } };
    state.maybeSingle.mockResolvedValueOnce(internal);
    db.rpc.mockResolvedValueOnce(internal);
    favorites.execute.mockResolvedValueOnce(internal);
    for (const res of [
      await GET(request()),
      await PUT(request("PUT", payload)),
      await DELETE(request("DELETE", target)),
    ]) {
      expect(res.status).toBe(503);
      expect(await res.text()).not.toContain("internal detail");
    }
  });
  it("requires a signed-in account and rejects viewer mutations before parsing", async () => {
    auth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }));
    expect((await GET(request())).status).toBe(401);
    auth.mockResolvedValue(NextResponse.json({}, { status: 403 }));
    expect((await PUT(request("PUT", payload))).status).toBe(403);
    expect((await DELETE(request("DELETE", target))).status).toBe(403);
    expect(
      auth.mock.calls
        .slice(1)
        .every(([, roles]) => roles.join() === "admin,operator"),
    ).toBe(true);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
