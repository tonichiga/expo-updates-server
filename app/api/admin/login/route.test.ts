import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({
  user: null as
    | null
    | {
        id: string;
        username: string;
        role: "admin" | "operator" | "viewer";
      },
}));

vi.mock("@/src/server/lib/admin-auth", () => ({
  validateAdminCredentials: vi.fn(async () => auth.user),
  createAdminSession: vi.fn(async () => "otas_session-secret"),
  getSessionCookieName: () => "ota_admin_session",
  getSessionCookieMaxAge: () => 60 * 60 * 24 * 7,
}));

function makeRequest(username: string, password: string) {
  return new NextRequest("https://updates.example.com/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

describe("POST /api/admin/login", () => {
  beforeEach(() => {
    auth.user = null;
  });

  it("creates an opaque session cookie for a database user", async () => {
    auth.user = {
      id: "user-id",
      username: "anton",
      role: "admin",
    };
    const { POST } = await import("./route");
    const response = await POST(makeRequest("anton", "strong-password"));

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(
      "ota_admin_session=otas_session-secret",
    );
  });

  it("rejects invalid database credentials", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest("anton", "wrong-password"));

    expect(response.status).toBe(401);
  });
});
