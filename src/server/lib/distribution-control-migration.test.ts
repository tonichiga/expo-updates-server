import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    "docs/migrations/2026-09-02-ota-distribution-control.sql",
  ),
  "utf8",
);

const canonicalSchemaSql = readFileSync(
  resolve(process.cwd(), "docs/migrations/schema.sql"),
  "utf8",
);

describe.each([
  ["distribution-control migration", migrationSql],
  ["canonical schema", canonicalSchemaSql],
])("%s database guard", (_name, sql) => {
  it("serializes switch writes and guarded mutations on one transaction lock", () => {
    expect(sql).toContain(
      "pg_catalog.pg_advisory_xact_lock(20260902, 1)",
    );
    expect(sql).toContain(
      "before insert or update or delete on public.ota_distribution_control",
    );
    expect(sql).toContain("before insert on public.ota_updates");
    expect(sql).toContain(
      "before update of is_active on public.ota_updates",
    );
    expect(sql).toContain(
      "on public.ota_update_channels\nfor each statement",
    );

    const rpc = sql.slice(
      sql.indexOf(
        "create or replace function public.set_ota_distribution_control(",
      ),
    );
    expect(rpc).toContain(
      "perform public.lock_ota_distribution_control();",
    );
    expect(sql).toContain(
      "perform public.assert_ota_distribution_mutation_allowed(",
    );
    expect(sql).toMatch(
      /from public\.ota_distribution_control\s+where singleton_id = 1\s+for share;/,
    );
    expect(rpc).toMatch(
      /from public\.ota_distribution_control\s+where singleton_id = 1\s+for update;/,
    );
  });

  it("guards activation while leaving deactivation and inactive inserts alone", () => {
    expect(sql).toContain("tg_op = 'INSERT' and not new.is_active");
    expect(sql).toContain(
      "new.is_active and not old.is_active",
    );
    expect(sql).toContain(
      "before insert or update on public.ota_updates",
    );
  });

  it("guards every channel field that can alter effective distribution", () => {
    for (const field of [
      "runtime_version",
      "channel",
      "platform",
      "latest_update_id",
      "latest_created_at",
      "latest_created_at_path",
      "active_update_id",
      "active_changed_at",
      "served_manifest_id",
      "served_manifest_changed_at",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `new\\.${field}\\s+is distinct from old\\.${field}`,
        ),
      );
    }
    expect(sql).toContain(
      "new.latest_update_id is null and new.active_update_id is null",
    );
  });

  it("raises a stable database error for blocked distribution", () => {
    expect(sql).toContain("errcode = 'P0OTA'");
    expect(sql).toContain("OTA_DISTRIBUTION_BLOCKED:");
  });
});
