import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const poolQuery = vi.hoisted(() =>
  vi.fn(async (sql: string, params: unknown[]) => {
    void sql;
    void params;
    return {
      rows: [] as Array<Record<string, unknown>>,
    };
  }),
);
const supabaseUpdate = vi.hoisted(() => vi.fn());
const supabaseUpsert = vi.hoisted(() => vi.fn());

const supabaseBuilder = vi.hoisted(() => {
  const builder = {
    update(payload: unknown) {
      supabaseUpdate(payload);
      return builder;
    },
    upsert(payload: unknown) {
      supabaseUpsert(payload);
      return builder;
    },
    eq() {
      return builder;
    },
    select() {
      return builder;
    },
    maybeSingle() {
      return Promise.resolve({ data: null, error: null });
    },
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve({ data: null, error: null }).then(resolve);
    },
  };
  return builder;
});
const supabaseRpcCalls = vi.hoisted(
  () =>
    [] as Array<{
    functionName: string;
    params: Record<string, unknown>;
    }>,
);

vi.mock("pg", () => ({
  Pool: class Pool {
    query(sql: string, params: unknown[]) {
      return poolQuery(sql, params);
    }
  },
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => supabaseBuilder,
    rpc(functionName: string, params: Record<string, unknown>) {
      supabaseRpcCalls.push({ functionName, params });
      return Promise.resolve({ data: [], error: null });
    },
  }),
}));

describe("common database abstraction", () => {
  const originalProvider = process.env.DATABASE_PROVIDER;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    vi.resetModules();
    poolQuery.mockClear();
    supabaseUpdate.mockClear();
    supabaseUpsert.mockClear();
    supabaseRpcCalls.length = 0;
    process.env.DATABASE_PROVIDER = "pg";
    process.env.DATABASE_URL = "postgres://local/test";
  });

  afterEach(() => {
    if (originalProvider === undefined) {
      delete process.env.DATABASE_PROVIDER;
    } else {
      process.env.DATABASE_PROVIDER = originalProvider;
    }
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    if (originalSupabaseUrl === undefined) {
      delete process.env.SUPABASE_URL;
    } else {
      process.env.SUPABASE_URL = originalSupabaseUrl;
    }
    if (originalSupabaseKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseKey;
    }
  });

  it("translates null and boolean values to PostgreSQL IS clauses", async () => {
    const { supabase } = await import("./supabase.js");

    await supabase
      .from("ota_updates")
      .select("*")
      .is("policy_published_at", null)
      .is("is_active", false)
      .execute();

    expect(poolQuery).toHaveBeenCalledWith(
      "SELECT * FROM ota_updates WHERE policy_published_at IS NULL AND is_active IS FALSE",
      [],
    );
  });

  it("serializes wrapped JSONB payloads but preserves PostgreSQL arrays", async () => {
    const payload = { message: "Ready" };
    const { jsonb, supabase } = await import("./supabase.js");

    await supabase
      .from("ota_updates")
      .update({
        guard_payload: jsonb(payload),
        scopes: ["updates:read", "updates:write"],
      })
      .eq("update_id", "update-id")
      .execute();

    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining(
        "SET guard_payload = $1, scopes = $2 WHERE update_id = $3",
      ),
      [
        JSON.stringify(payload),
        ["updates:read", "updates:write"],
        "update-id",
      ],
    );
  });

  it("unwraps JSONB payloads for Supabase without changing plain arrays", async () => {
    const payload = { message: "Ready" };
    vi.resetModules();
    process.env.DATABASE_PROVIDER = "supabase";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    const { jsonb, supabase } = await import("./supabase.js");

    await supabase
      .from("ota_updates")
      .update({
        guard_payload: jsonb(payload),
        scopes: ["updates:read"],
      })
      .execute();

    expect(supabaseUpdate).toHaveBeenCalledWith({
      guard_payload: payload,
      scopes: ["updates:read"],
    });
  });

  it("calls PostgreSQL functions with validated named parameters", async () => {
    vi.stubEnv("DATABASE_PROVIDER", "pg");
    vi.stubEnv("DATABASE_URL", "postgres://example");
    const { jsonb, supabase } = await import("./supabase.js");

    await supabase.rpc("set_ota_distribution_control", {
      p_blocked: true,
      p_changed_by: jsonb({ id: "operator" }),
    });

    expect(poolQuery).toHaveBeenCalledWith(
      "SELECT * FROM public.set_ota_distribution_control(p_blocked => $1, p_changed_by => $2)",
      [true, '{"id":"operator"}'],
    );
  });

  it("unwraps JSON parameters for Supabase RPC", async () => {
    vi.stubEnv("DATABASE_PROVIDER", "supabase");
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    const { jsonb, supabase } = await import("./supabase.js");

    await supabase.rpc("set_ota_distribution_control", {
      p_changed_by: jsonb({ id: "operator" }),
    });

    expect(supabaseRpcCalls[0]).toEqual({
      functionName: "set_ota_distribution_control",
      params: { p_changed_by: { id: "operator" } },
    });
  });
});
