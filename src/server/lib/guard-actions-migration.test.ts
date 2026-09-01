import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../docs/migrations/2026-09-01-p1-guard-actions.sql",
    import.meta.url,
  ),
  "utf8",
);
const schema = readFileSync(
  new URL("../../../docs/migrations/schema.sql", import.meta.url),
  "utf8",
);

describe("guard action catalog migration", () => {
  it.each([
    ["migration", migration],
    ["canonical schema", schema],
  ])("defines the portable validated catalog in the %s", (_name, sql) => {
    expect(sql).toMatch(
      /create table if not exists public\.ota_guard_actions/i,
    );
    expect(sql).toMatch(/id uuid primary key default gen_random_uuid\(\)/i);
    expect(sql).toMatch(/action_key = btrim\(action_key\)/i);
    expect(sql).toMatch(/char_length\(action_key\) between 1 and 100/i);
    expect(sql).toMatch(/action_key !~ '\[\[:cntrl:\]\]'/i);
    expect(sql).toMatch(
      /create unique index if not exists idx_ota_guard_actions_action_key/i,
    );
    expect(sql).toMatch(
      /values \('ota-force-store-update'\)\s+on conflict \(action_key\) do nothing/i,
    );
  });

  it("does not couple catalog entries to policy rules", () => {
    const table = migration.slice(
      migration.indexOf("create table"),
      migration.indexOf("create unique index"),
    );
    expect(table).not.toMatch(/foreign key|references/i);
  });

  it("keeps the migration and canonical schema definitions identical", () => {
    const catalogSql = (sql: string) => {
      const start = sql.indexOf(
        "create table if not exists public.ota_guard_actions",
      );
      const endMarker = "on conflict (action_key) do nothing;";
      const end = sql.indexOf(endMarker, start) + endMarker.length;
      return sql.slice(start, end);
    };

    expect(catalogSql(schema)).toBe(catalogSql(migration));
  });
});
