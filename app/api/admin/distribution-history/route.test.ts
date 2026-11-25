import { NextRequest, NextResponse } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const access = vi.hoisted(() => vi.fn());
const scopes = vi.hoisted(() => vi.fn());
const change = vi.hoisted(() => vi.fn());
vi.mock("@/src/server/lib/admin-api", () => ({ requireAdminAccess: access }));
vi.mock("@/src/server/lib/distribution-history", async (original) => ({
  ...(await original<typeof import("@/src/server/lib/distribution-history")>()),
  getDistributionHistory: scopes, changeDistribution: change,
}));

import { DistributionHistoryConflictError } from "@/src/server/lib/distribution-history";
import { GET } from "./route";
import { POST } from "./restore/route";

const id = "11111111-1111-4111-8111-111111111111";
const url = "http://localhost/api/admin/distribution-history";
const post = (body: unknown) => new NextRequest(url + "/restore", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  access.mockResolvedValue({ type: "session", role: "operator" });
  scopes.mockResolvedValue([]);
});

it.each([
  [{ type: "session", role: "viewer" }, false],
  [{ type: "session", role: "operator" }, true],
  [{ type: "access-token", scopes: ["updates:read"] }, false],
])("reads history with the principal's write capability", async (principal, canWrite) => {
  access.mockResolvedValue(principal);
  const req = new NextRequest(url);
  expect(await (await GET(req)).json()).toEqual({ canWrite, scopes: [] });
  expect(access).toHaveBeenCalledWith(req, "updates:read");
});

it("requires write permission before parsing or applying a restore", async () => {
  access.mockResolvedValue(NextResponse.json({}, { status: 403 }));
  const req = post({ updateId: id, expectedRevision: "0" });
  expect((await POST(req)).status).toBe(403);
  expect(access).toHaveBeenCalledWith(req, "updates:write");
  expect(change).not.toHaveBeenCalled();
});

it.each([{ updateId: id }, { updateId: "invalid", expectedRevision: "17" }])("rejects an invalid restore", async (body) => {
  expect((await POST(post(body))).status).toBe(400);
  expect(change).not.toHaveBeenCalled();
});

it("passes the observed revision to the database and signals a conflict on stale history", async () => {
  change.mockRejectedValue(new DistributionHistoryConflictError("Refresh."));
  expect((await POST(post({ updateId: id, expectedRevision: "17" }))).status).toBe(409);
  expect(change).toHaveBeenCalledWith(id, "restore", "17");
});
