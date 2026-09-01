import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const requireAdminAccess = vi.hoisted(() => vi.fn());
const principalHasScope = vi.hoisted(() => vi.fn());
const getState = vi.hoisted(() => vi.fn());
const setState = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/lib/admin-api", () => ({
  requireAdminAccess,
  principalHasScope,
}));

vi.mock("@/src/server/lib/distribution-control", () => {
  class DistributionControlValidationError extends Error {
    readonly status = 400;
  }
  class DistributionControlConflictError extends Error {
    readonly status = 409;
  }
  return {
    DistributionControlValidationError,
    DistributionControlConflictError,
    getDistributionControlState: getState,
    setDistributionControlState: setState,
  };
});

const currentState = {
  blocked: false,
  version: 3,
  reason: null,
  changedAt: "2026-09-02T00:00:00.000Z",
  changedBy: { type: "system", id: "migration", label: "Migration" },
};

describe("/api/admin/distribution-control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const principal = {
      type: "session",
      id: "operator-id",
      username: "operator",
      role: "operator",
    };
    requireAdminAccess.mockResolvedValue(principal);
    principalHasScope.mockReturnValue(true);
    getState.mockResolvedValue(currentState);
    setState.mockResolvedValue({
      ...currentState,
      blocked: true,
      version: 4,
      reason: "INC-42",
    });
  });

  it("requires updates:read and reports viewer write capability", async () => {
    principalHasScope.mockReturnValue(false);
    const { GET } = await import("./route");
    const request = new NextRequest(
      "https://updates.example.com/api/admin/distribution-control",
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ canWrite: false });
    expect(requireAdminAccess).toHaveBeenCalledWith(request, "updates:read");
  });

  it("requires updates:write and records session principal metadata", async () => {
    const { PUT } = await import("./route");
    const request = new NextRequest(
      "https://updates.example.com/api/admin/distribution-control",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          blocked: true,
          reason: "INC-42",
          expectedVersion: 3,
        }),
      },
    );

    const response = await PUT(request);

    expect(response.status).toBe(200);
    expect(setState).toHaveBeenCalledWith({
      blocked: true,
      reason: "INC-42",
      expectedVersion: 3,
      principal: {
        type: "session",
        id: "operator-id",
        label: "operator",
        role: "operator",
      },
    });
    expect(requireAdminAccess).toHaveBeenCalledWith(request, "updates:write");
  });

  it("returns auth responses and optimistic conflicts with correct status", async () => {
    requireAdminAccess.mockResolvedValueOnce(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    );
    const { GET, PUT } = await import("./route");
    const forbidden = await GET(
      new NextRequest(
        "https://updates.example.com/api/admin/distribution-control",
      ),
    );
    expect(forbidden.status).toBe(403);

    const { DistributionControlConflictError } = await import(
      "@/src/server/lib/distribution-control"
    );
    setState.mockRejectedValueOnce(
      new DistributionControlConflictError(),
    );
    const conflict = await PUT(
      new NextRequest(
        "https://updates.example.com/api/admin/distribution-control",
        {
          method: "PUT",
          body: JSON.stringify({
            blocked: false,
            expectedVersion: 2,
          }),
        },
      ),
    );
    expect(conflict.status).toBe(409);
  });

  it("returns 400 for malformed JSON and 500 for state read failures", async () => {
    const { GET, PUT } = await import("./route");
    const invalid = await PUT(
      new NextRequest(
        "https://updates.example.com/api/admin/distribution-control",
        { method: "PUT", body: "{" },
      ),
    );
    expect(invalid.status).toBe(400);

    getState.mockRejectedValueOnce(new Error("database down"));
    const failed = await GET(
      new NextRequest(
        "https://updates.example.com/api/admin/distribution-control",
      ),
    );
    expect(failed.status).toBe(500);
  });
});
