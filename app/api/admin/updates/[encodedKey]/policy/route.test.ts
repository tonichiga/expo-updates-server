import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({
  scopes: [] as string[],
}));
const getPolicy = vi.hoisted(() =>
  vi.fn(async () => ({
    delivery: "manual",
    guard: null,
    policyVersion: 1,
    publishedAt: null,
    editable: true,
  })),
);
const replacePolicy = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/lib/admin-access-tokens", () => ({
  authenticateAccessToken: vi.fn(async () => ({
    id: "token",
    name: "test",
    scopes: auth.scopes,
  })),
}));
vi.mock("@/src/server/lib/admin-auth", () => ({
  getAdminSessionFromRequest: vi.fn(async () => null),
}));
vi.mock("@/src/server/lib/admin-updates", () => ({
  decodeUpdateKey: (value: string) => value,
  getUpdatePolicyByKey: getPolicy,
  replaceUpdatePolicyByKey: replacePolicy,
  UpdatePolicyConflictError: class UpdatePolicyConflictError extends Error {},
  UpdatePolicyPublishedError: class UpdatePolicyPublishedError extends Error {},
}));

const context = {
  params: Promise.resolve({ encodedKey: "encoded-update" }),
};
function request(method = "GET", body?: unknown) {
  return new NextRequest(
    "https://updates.example.com/api/admin/updates/encoded-update/policy",
    {
      method,
      headers: {
        authorization: "Bearer ota_test",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
}

describe("update policy API", () => {
  beforeEach(() => {
    auth.scopes = [];
    getPolicy.mockClear();
    replacePolicy.mockReset();
  });

  it("requires updates:read for GET", async () => {
    const { GET } = await import("./route");
    expect((await GET(request(), context)).status).toBe(403);
    expect(getPolicy).not.toHaveBeenCalled();

    auth.scopes = ["updates:read"];
    expect((await GET(request(), context)).status).toBe(200);
    expect(getPolicy).toHaveBeenCalledWith("encoded-update");
  });

  it("requires updates:write for PUT", async () => {
    auth.scopes = ["updates:read"];
    const { PUT } = await import("./route");
    const response = await PUT(
      request("PUT", { delivery: "manual", guard: null }),
      context,
    );
    expect(response.status).toBe(403);
    expect(replacePolicy).not.toHaveBeenCalled();
  });

  it("performs complete replacement with optimistic policy version", async () => {
    auth.scopes = ["updates:write"];
    const guard = {
      action: "require-confirmation",
      payload: { message: "Ready" },
    };
    replacePolicy.mockResolvedValueOnce({
      delivery: "background",
      guard,
      policyVersion: 4,
      publishedAt: null,
      editable: true,
    });
    const { PUT } = await import("./route");
    const response = await PUT(
      request("PUT", {
        delivery: "background",
        guard,
        expectedPolicyVersion: 3,
      }),
      context,
    );
    expect(response.status).toBe(200);
    expect(replacePolicy).toHaveBeenCalledWith(
      "encoded-update",
      { delivery: "background", guard },
      3,
    );
  });

  it.each([
    ["missing", undefined],
    ["zero", 0],
    ["fractional", 1.5],
  ])("returns 400 for a %s expected policy version", async (_case, version) => {
    auth.scopes = ["updates:write"];
    const { PUT } = await import("./route");
    const response = await PUT(
      request("PUT", {
        delivery: "manual",
        guard: null,
        ...(version === undefined
          ? {}
          : { expectedPolicyVersion: version }),
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(replacePolicy).not.toHaveBeenCalled();
  });

  it("returns 409 for publication and stale version conflicts", async () => {
    auth.scopes = ["updates:write"];
    const { PUT } = await import("./route");
    const { UpdatePolicyPublishedError, UpdatePolicyConflictError } =
      await import("@/src/server/lib/admin-updates");

    replacePolicy.mockRejectedValueOnce(
      new UpdatePolicyPublishedError("published"),
    );
    expect(
      (
        await PUT(
          request("PUT", {
            delivery: "manual",
            guard: null,
            expectedPolicyVersion: 1,
          }),
          context,
        )
      ).status,
    ).toBe(409);

    replacePolicy.mockRejectedValueOnce(
      new UpdatePolicyConflictError("conflict"),
    );
    expect(
      (
        await PUT(
          request("PUT", {
            delivery: "manual",
            guard: null,
            expectedPolicyVersion: 1,
          }),
          context,
        )
      ).status,
    ).toBe(409);
  });
});
