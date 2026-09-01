import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const requireAdminAccess = vi.hoisted(() => vi.fn());
const listGuardActions = vi.hoisted(() =>
  vi.fn(async () => [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      actionKey: "alpha",
      createdAt: "2026-09-01T00:00:00.000Z",
    },
  ]),
);
const createGuardAction = vi.hoisted(() => vi.fn());
const ValidationError = vi.hoisted(() => class extends Error {});

vi.mock("@/src/server/lib/admin-api", () => ({
  requireAdminAccess,
}));
vi.mock("@/src/server/lib/guard-actions", () => ({
  listGuardActions,
  createGuardAction,
  GuardActionValidationError: ValidationError,
}));

function request(method = "GET", body?: unknown) {
  return new NextRequest(
    "https://updates.example.com/api/admin/guard-actions",
    {
      method,
      ...(body
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    },
  );
}

describe("/api/admin/guard-actions", () => {
  beforeEach(() => {
    requireAdminAccess.mockReset();
    createGuardAction.mockReset();
  });

  it("requires updates:read and reports viewer mutation authorization", async () => {
    requireAdminAccess.mockResolvedValueOnce(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    const { GET } = await import("./route");
    expect((await GET(request())).status).toBe(403);

    requireAdminAccess.mockResolvedValueOnce({
      type: "session",
      id: "viewer-id",
      username: "viewer",
      role: "viewer",
    });
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: await listGuardActions(),
      canWrite: false,
    });
    expect(requireAdminAccess).toHaveBeenLastCalledWith(
      expect.any(NextRequest),
      "updates:read",
    );
  });

  it("reports token write scope independently of read authorization", async () => {
    requireAdminAccess.mockResolvedValue({
      type: "access-token",
      id: "token-id",
      name: "token",
      scopes: ["updates:read", "updates:write"],
    });
    const { GET } = await import("./route");
    await expect((await GET(request())).json()).resolves.toMatchObject({
      canWrite: true,
    });
  });

  it("requires updates:write and returns the create-or-get result", async () => {
    const item = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      actionKey: "same-action",
      createdAt: "2026-09-01T00:00:00.000Z",
    };
    requireAdminAccess.mockResolvedValue({
      type: "session",
      id: "operator-id",
      username: "operator",
      role: "operator",
    });
    createGuardAction.mockResolvedValue(item);
    const { POST } = await import("./route");
    const first = await POST(request("POST", { actionKey: "same-action" }));
    const second = await POST(request("POST", { actionKey: "same-action" }));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    await expect(first.json()).resolves.toEqual(item);
    await expect(second.json()).resolves.toEqual(item);
    expect(requireAdminAccess).toHaveBeenLastCalledWith(
      expect.any(NextRequest),
      "updates:write",
    );
  });

  it("returns 400 for invalid catalog input", async () => {
    requireAdminAccess.mockResolvedValue({
      type: "session",
      id: "operator-id",
      username: "operator",
      role: "operator",
    });
    createGuardAction.mockRejectedValue(new ValidationError("invalid"));
    const { POST } = await import("./route");
    expect((await POST(request("POST", { actionKey: "" }))).status).toBe(400);
  });
});
