import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const requireAdminAccess = vi.hoisted(() => vi.fn());
const deleteGuardAction = vi.hoisted(() => vi.fn(async () => undefined));
const ValidationError = vi.hoisted(() => class extends Error {});

vi.mock("@/src/server/lib/admin-api", () => ({
  requireAdminAccess,
}));
vi.mock("@/src/server/lib/guard-actions", () => ({
  deleteGuardAction,
  GuardActionValidationError: ValidationError,
}));

const request = new NextRequest(
  "https://updates.example.com/api/admin/guard-actions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  { method: "DELETE" },
);
const context = {
  params: Promise.resolve({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  }),
};

describe("DELETE /api/admin/guard-actions/[id]", () => {
  beforeEach(() => {
    requireAdminAccess.mockReset();
    deleteGuardAction.mockClear();
  });

  it("requires updates:write", async () => {
    requireAdminAccess.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    const { DELETE } = await import("./route");
    expect((await DELETE(request, context)).status).toBe(403);
    expect(deleteGuardAction).not.toHaveBeenCalled();
  });

  it("is idempotent and policy-independent", async () => {
    requireAdminAccess.mockResolvedValue({
      type: "session",
      id: "operator-id",
      username: "operator",
      role: "operator",
    });
    const { DELETE } = await import("./route");
    expect((await DELETE(request, context)).status).toBe(200);
    expect((await DELETE(request, context)).status).toBe(200);
    expect(deleteGuardAction).toHaveBeenCalledTimes(2);
    expect(deleteGuardAction).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(requireAdminAccess).toHaveBeenLastCalledWith(
      expect.any(NextRequest),
      "updates:write",
    );
  });
});
