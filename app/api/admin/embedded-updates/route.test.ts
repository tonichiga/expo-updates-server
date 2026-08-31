import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireAdminAccess = vi.hoisted(() => vi.fn());
const registerEmbeddedUpdate = vi.hoisted(() =>
  vi.fn(async (input) => ({
    ...input,
    isEmbedded: true,
    insertedAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
  })),
);

vi.mock("@/src/server/lib/admin-api", () => ({
  requireAdminAccess,
}));

vi.mock("@/src/server/lib/admin-embedded-updates", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@/src/server/lib/admin-embedded-updates")
    >();
  return {
    ...original,
    listEmbeddedUpdates: vi.fn(async () => []),
    registerEmbeddedUpdate,
  };
});

describe("POST /api/admin/embedded-updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers an embedded update with updates:write access", async () => {
    requireAdminAccess.mockResolvedValue({
      type: "access-token",
      id: "token-id",
      name: "mobile-builds",
      scopes: ["updates:write"],
    });
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest(
        "https://updates.example.com/api/admin/embedded-updates",
        {
          method: "POST",
          headers: {
            authorization: "Bearer ota-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            id: "55555555-5555-4555-8555-555555555555",
            createdAt: "2026-01-01T00:00:00Z",
            channel: "Production",
            platform: "ios",
          }),
        },
      ),
    );

    expect(response.status).toBe(201);
    expect(requireAdminAccess).toHaveBeenCalledWith(
      expect.any(NextRequest),
      "updates:write",
    );
    expect(registerEmbeddedUpdate).toHaveBeenCalledWith({
      embeddedUpdateId: "55555555-5555-4555-8555-555555555555",
      createdAt: "2026-01-01T00:00:00.000Z",
      channel: "production",
      platform: "ios",
    });
  });

  it("rejects invalid registration payloads", async () => {
    requireAdminAccess.mockResolvedValue({
      type: "access-token",
      id: "token-id",
      name: "mobile-builds",
      scopes: ["updates:write"],
    });
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest(
        "https://updates.example.com/api/admin/embedded-updates",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: "not-a-uuid",
            createdAt: "invalid",
            channel: "production",
            platform: "ios",
          }),
        },
      ),
    );

    expect(response.status).toBe(400);
    expect(registerEmbeddedUpdate).not.toHaveBeenCalled();
  });
});
