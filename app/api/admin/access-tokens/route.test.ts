import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const persisted = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
}));

vi.mock("@/src/server/lib/admin-auth", () => ({
  getAdminSessionFromRequest: () => ({
    id: "admin-id",
    username: "admin",
    role: "admin",
  }),
}));

vi.mock("@/src/server/lib/supabase.js", () => {
  class Query {
    upsert(row: Record<string, unknown>) {
      persisted.row = row;
      return this;
    }

    select() {
      return this;
    }

    single() {
      return Promise.resolve({ data: persisted.row, error: null });
    }
  }

  return {
    supabase: {
      from() {
        return new Query();
      },
    },
  };
});

describe("POST /api/admin/access-tokens", () => {
  beforeEach(() => {
    persisted.row = null;
  });

  it("returns a token once and stores only its hash", async () => {
    const { POST } = await import("./route");
    const request = new NextRequest(
      "https://updates.example.com/api/admin/access-tokens",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Deployment CI",
          scopes: ["updates:read", "updates:write"],
        }),
      },
    );

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.token).toMatch(/^ota_[A-Za-z0-9_-]+$/);
    expect(body.tokenRecord).toMatchObject({
      name: "Deployment CI",
      scopes: ["updates:read", "updates:write"],
    });
    expect(persisted.row?.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(persisted.row?.token_hash).not.toBe(body.token);
    expect(persisted.row).not.toHaveProperty("token");
  });
});
