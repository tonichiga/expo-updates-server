import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  blocked: false,
  readError: null as Error | null,
  tableReads: 0,
  downloads: 0,
}));

vi.mock("../lib/distribution-control", () => ({
  isOtaDistributionBlocked: vi.fn(async () => {
    if (state.readError) throw state.readError;
    return state.blocked;
  }),
}));

vi.mock("../lib/supabase.js", () => ({
  SUPABASE_BUCKET: "updates",
  supabase: {
    from: () => {
      state.tableReads += 1;
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      };
    },
    storage: {
      from: () => ({
        download: async () => {
          state.downloads += 1;
          return { data: null, error: { message: "missing" } };
        },
      }),
    },
  },
}));

async function requestAsset() {
  const { default: assetsController } = await import("./assets");
  return assetsController(
    new NextRequest(
      "https://updates.example.com/api/assets?runtimeVersion=1&platform=ios&channel=production&updateId=11111111-1111-4111-8111-111111111111&assetPath=bundle.js",
    ),
  );
}

describe("GET /api/assets distribution gate", () => {
  beforeEach(() => {
    vi.resetModules();
    state.blocked = false;
    state.readError = null;
    state.tableReads = 0;
    state.downloads = 0;
  });

  it("returns no-store 503 before update lookup when globally blocked", async () => {
    state.blocked = true;

    const response = await requestAsset();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.tableReads).toBe(0);
    expect(state.downloads).toBe(0);
  });

  it("fails closed before lookup when global state cannot be read", async () => {
    state.readError = new Error("database unavailable");

    const response = await requestAsset();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.tableReads).toBe(0);
  });

  it("preserves the existing lookup path while distribution is active", async () => {
    const response = await requestAsset();

    expect(response.status).toBe(404);
    expect(state.tableReads).toBe(1);
  });
});
