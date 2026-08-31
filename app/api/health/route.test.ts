import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        limit: () => ({
          execute: async () => ({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

describe("GET /api/health", () => {
  it("reports readiness when the database is available", async () => {
    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      checks: { database: "ok" },
    });
  });
});
