import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const tokenAuth = vi.hoisted(() => ({
  result: null as
    | null
    | {
        id: string;
        name: string;
        scopes: string[];
      },
}));

const sessionAuth = vi.hoisted(() => ({
  result: null as
    | null
    | {
        id: string;
        username: string;
        role: "admin" | "operator" | "viewer";
      },
}));

const getUpdatesPage = vi.hoisted(() =>
  vi.fn(async () => ({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    rollbackLockByScope: [],
  })),
);

const setUpdateDisabledByKey = vi.hoisted(() =>
  vi.fn(async () => ({ updated: true, disabled: true })),
);

vi.mock("@/src/server/lib/admin-access-tokens", () => ({
  authenticateAccessToken: vi.fn(async () => tokenAuth.result),
}));

vi.mock("@/src/server/lib/admin-auth", () => ({
  getAdminSessionFromRequest: vi.fn(async () => sessionAuth.result),
}));

vi.mock("@/src/server/lib/admin-updates", () => ({
  getUpdatesPage,
  setUpdateDisabledByKey,
  decodeUpdateKey: (value: string) => value,
  normalizePage: () => 1,
  normalizePageSize: () => 20,
  normalizeSortBy: () => "createdAt",
  normalizeSortOrder: () => "desc",
}));

function makeRequest(token?: string) {
  return new NextRequest("https://updates.example.com/api/admin/updates", {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
}

describe("GET /api/admin/updates authorization", () => {
  beforeEach(() => {
    tokenAuth.result = null;
    sessionAuth.result = null;
    getUpdatesPage.mockClear();
    setUpdateDisabledByKey.mockClear();
  });

  it("rejects an unauthenticated request", async () => {
    const { GET } = await import("./route");
    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(getUpdatesPage).not.toHaveBeenCalled();
  });

  it("accepts a bearer token with updates:read scope", async () => {
    tokenAuth.result = {
      id: "token-id",
      name: "CI",
      scopes: ["updates:read"],
    };
    const { GET } = await import("./route");
    const response = await GET(makeRequest("ota_test_token"));

    expect(response.status).toBe(200);
    expect(getUpdatesPage).toHaveBeenCalledOnce();
  });

  it("rejects a bearer token without updates:read scope", async () => {
    tokenAuth.result = {
      id: "token-id",
      name: "Read redirects",
      scopes: ["redirects:read"],
    };
    const { GET } = await import("./route");
    const response = await GET(makeRequest("ota_test_token"));

    expect(response.status).toBe(403);
    expect(getUpdatesPage).not.toHaveBeenCalled();
  });

  it("allows a viewer session to read updates", async () => {
    sessionAuth.result = {
      id: "user-id",
      username: "viewer",
      role: "viewer",
    };
    const { GET } = await import("./route");
    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    expect(getUpdatesPage).toHaveBeenCalledOnce();
  });

  it("rejects a viewer session for update mutations", async () => {
    sessionAuth.result = {
      id: "user-id",
      username: "viewer",
      role: "viewer",
    };
    const { POST } = await import(
      "./[encodedKey]/deactivate/route"
    );
    const request = new NextRequest(
      "https://updates.example.com/api/admin/updates/update-id/deactivate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ disabled: true }),
      },
    );
    const response = await POST(request, {
      params: Promise.resolve({ encodedKey: "update-id" }),
    });

    expect(response.status).toBe(403);
    expect(setUpdateDisabledByKey).not.toHaveBeenCalled();
  });
});
