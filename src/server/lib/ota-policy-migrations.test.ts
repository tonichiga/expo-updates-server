import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const correctiveMigration = readFileSync(
  new URL(
    "../../../docs/migrations/2026-09-01-policy-publication-correction.sql",
    import.meta.url,
  ),
  "utf8",
);
const canonicalSchema = readFileSync(
  new URL("../../../docs/migrations/schema.sql", import.meta.url),
  "utf8",
);

function correctiveUpdate(sql: string): string {
  const start = sql.indexOf("update public.ota_updates u\n");
  const end = sql.indexOf(
    "\n\ncreate trigger trg_ota_updates_lock_published_policy",
    start,
  );

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("OTA policy corrective migration", () => {
  it("does not treat the latest upload pointer as publication evidence", () => {
    expect(correctiveMigration).not.toMatch(
      /where\s+c\.latest_update_id\s*=\s*u\.update_id/i,
    );
  });

  it("preserves drafts with actual publication evidence", () => {
    expect(correctiveMigration).toMatch(
      /where\s+sml\.update_id\s*=\s*u\.update_id/i,
    );
    expect(correctiveMigration).toMatch(
      /where\s+c\.active_update_id\s*=\s*u\.update_id/i,
    );
  });

  it("requires simple Guard defaults before correcting a draft", () => {
    expect(correctiveMigration).toMatch(/u\.guard_action is null/i);
    expect(correctiveMigration).toMatch(/u\.guard_payload is null/i);
    expect(correctiveMigration).not.toMatch(/guard_rules/i);
  });

  it("applies the same correction in schema.sql after the served log exists", () => {
    const servedLogPosition = canonicalSchema.indexOf(
      "create table if not exists public.ota_served_manifest_log",
    );
    const correctionPosition = canonicalSchema.indexOf(
      "update public.ota_updates u\n",
    );

    expect(servedLogPosition).toBeGreaterThanOrEqual(0);
    expect(correctionPosition).toBeGreaterThan(servedLogPosition);
    expect(correctiveUpdate(canonicalSchema)).toBe(
      correctiveUpdate(correctiveMigration),
    );
  });
});
