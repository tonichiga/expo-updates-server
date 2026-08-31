import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireAdminAccess = vi.hoisted(() => vi.fn());
const listEmergencyRedirects = vi.hoisted(() =>
  vi.fn(async () => [{ id: "redirect-id", name: "Recovery" }]),
);
const createEmergencyRedirect = vi.hoisted(() =>
  vi.fn(async (input) => ({ id: "redirect-id", ...input })),
);

vi.mock("@/src/server/lib/admin-api", () => ({
  requireAdminAccess,
}));

vi.mock("@/src/server/lib/emergency-channel-redirects", () => ({
  EmergencyRedirectValidationError: class extends Error {},
  listEmergencyRedirects,
  createEmergencyRedirect,
}));

describe("/api/admin/emergency-redirects", () => {
  it("lists redirects for a principal with redirects:read", async () => {
    requireAdminAccess.mockResolvedValue({
      type: "session",
      id: "user-id",
      username: "viewer",
      role: "viewer",
    });
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "https://updates.example.com/api/admin/emergency-redirects",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [{ id: "redirect-id", name: "Recovery" }],
    });
    expect(requireAdminAccess).toHaveBeenCalledWith(
      expect.any(NextRequest),
      "redirects:read",
    );
  });

  it("creates a redirect for a principal with redirects:write", async () => {
    requireAdminAccess.mockResolvedValue({
      type: "session",
      id: "user-id",
      username: "operator",
      role: "operator",
    });
    const input = {
      name: "Recovery",
      enabled: true,
      embeddedUpdateId: "55555555-5555-4555-8555-555555555555",
      runtimeVersion: "2.0.0",
      platform: "android",
      fromChannel: "beta",
      toChannel: "production",
      targetMode: "follow",
      expectedUpdateId: null,
    };
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest(
        "https://updates.example.com/api/admin/emergency-redirects",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      ),
    );

    expect(response.status).toBe(201);
    expect(createEmergencyRedirect).toHaveBeenCalledWith(input);
    expect(requireAdminAccess).toHaveBeenCalledWith(
      expect.any(NextRequest),
      "redirects:write",
    );
  });
});
