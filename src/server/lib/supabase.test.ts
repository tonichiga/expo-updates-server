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

  it.each([
    ["empty", []],
    [
      "non-empty",
      [
        {
          id: "rule-1",
          enabled: true,
          priority: 1,
          action: "confirm",
          groups: [],
        },
      ],
    ],
  ])(
    "serializes wrapped %s JSONB arrays but preserves PostgreSQL arrays",
    async (_case, rules) => {
      const { jsonb, supabase } = await import("./supabase.js");

      await supabase
        .from("ota_updates")
        .update({
          guard_rules: jsonb(rules),
          scopes: ["updates:read", "updates:write"],
        })
        .eq("update_id", "update-id")
        .execute();

      expect(poolQuery).toHaveBeenCalledWith(
        expect.stringContaining(
          "SET guard_rules = $1, scopes = $2 WHERE update_id = $3",
        ),
        [
          JSON.stringify(rules),
          ["updates:read", "updates:write"],
          "update-id",
        ],
      );
    },
  );

  it.each([
    ["empty", []],
    [
      "non-empty",
      [{ id: "rule-1", enabled: true, priority: 1 }],
    ],
  ])(
    "unwraps wrapped %s JSONB arrays for Supabase without changing plain arrays",
    async (_case, rules) => {
      vi.resetModules();
      process.env.DATABASE_PROVIDER = "supabase";
      process.env.SUPABASE_URL = "https://example.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
      const { jsonb, supabase } = await import("./supabase.js");

      await supabase
        .from("ota_updates")
        .update({
          guard_rules: jsonb(rules),
          scopes: ["updates:read"],
        })
        .execute();

      expect(supabaseUpdate).toHaveBeenCalledWith({
        guard_rules: rules,
        scopes: ["updates:read"],
      });
    },
  );
});
