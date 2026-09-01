import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../docs/migrations/2026-09-01-p2-simplify-ota-guard-policy.sql",
    import.meta.url,
  ),
  "utf8",
);
const schema = readFileSync(
  new URL("../../../docs/migrations/schema.sql", import.meta.url),
  "utf8",
);
const runbook = readFileSync(
  new URL("../../../docs/ota-update-policy.md", import.meta.url),
  "utf8",
);

describe("simple update policy migration", () => {
  it.each([
    ["production migration", migration],
    ["canonical schema", schema],
  ])("defines the simple model in the %s", (_name, sql) => {
    expect(sql).toMatch(/guard_action text null/i);
    expect(sql).toMatch(/guard_payload jsonb null/i);
    expect(sql).toMatch(/guard_action = btrim\(guard_action\)/i);
    expect(sql).toMatch(/char_length\(guard_action\) between 1 and 100/i);
    expect(sql).toMatch(/guard_action !~ '\[\[:cntrl:\]\]'/i);
    expect(sql).toMatch(
      /guard_payload is null or guard_action is not null/i,
    );
    expect(sql).toMatch(/drop column if exists guard_rules/i);
  });

  it("replaces the immutability trigger with both simple Guard columns", () => {
    expect(migration).toMatch(
      /drop trigger if exists trg_ota_updates_lock_published_policy/i,
    );
    expect(migration).toMatch(
      /new\.guard_action is distinct from old\.guard_action/i,
    );
    expect(migration).toMatch(
      /new\.guard_payload is distinct from old\.guard_payload/i,
    );
    expect(migration).toMatch(
      /create trigger trg_ota_updates_lock_published_policy/i,
    );
  });

  it("does not migrate old rule data", () => {
    expect(migration).not.toMatch(
      /insert\s+into|jsonb_array|jsonb_path|guard_rules\s*->/i,
    );
  });

  it("has no rule column in the fresh ota_updates definition", () => {
    const table = schema.slice(
      schema.indexOf("create table if not exists public.ota_updates"),
      schema.indexOf("-- Keep schema.sql safe as an upgrade path"),
    );
    expect(table).not.toMatch(/guard_rules/);
  });

  it("documents the required existing-installation order and skip condition", () => {
    const catalog = runbook.indexOf(
      "2026-09-01-p1-guard-actions.sql",
    );
    const simplification = runbook.indexOf(
      "2026-09-01-p2-simplify-ota-guard-policy.sql",
    );
    const correction = runbook.indexOf(
      "2026-09-01-policy-publication-correction.sql",
    );

    expect(catalog).toBeGreaterThanOrEqual(0);
    expect(simplification).toBeGreaterThan(catalog);
    expect(correction).toBeGreaterThan(simplification);
    expect(runbook).toMatch(
      /already successfully ran[\s\S]*verified that no drafts[\s\S]*may skip the third step/i,
    );
    expect(runbook).toMatch(
      /correction must run third[\s\S]*guard_action[\s\S]*guard_payload/i,
    );
  });

  it("keeps relevant migration basenames in dependency-safe lexical order", () => {
    const dependencyOrder = [
      "2026-09-01-ota-update-policy.sql",
      "2026-09-01-p1-guard-actions.sql",
      "2026-09-01-p2-simplify-ota-guard-policy.sql",
      "2026-09-01-policy-publication-correction.sql",
    ];

    expect([...dependencyOrder].sort()).toEqual(dependencyOrder);
  });
});
