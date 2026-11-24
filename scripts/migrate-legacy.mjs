// In-place upgrade of the distribution-control generation of the legacy schema.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Client } from "pg";

const migrations = [
  "2026-10-16-manifest-identity",
  "2026-10-19-device-heartbeat",
  "2026-10-22-device-analytics",
  "2026-10-22-device-version-metadata",
  "2026-10-22-device-targeting",
  "2026-10-22-device-targeting-activation",
];

export async function upgradeLegacy(client, { apply = false } = {}) {
  await client.query("begin isolation level repeatable read");
  try {
    await client.query("set local lock_timeout = '5s'");
    // Keep both public IDs, file references, policies, rollback pins and epochs
    // under the same transaction as the DDL. Full release JSON stays in SQL.
    const snapshots = [
      ["ota_updates", "update_id"],
      ["ota_update_channels", "id"],
      ["ota_emergency_redirects", "id"],
      ["ota_embedded_updates", "embedded_update_id"],
      ["ota_distribution_control", "singleton_id"],
    ];
    for (const [table] of snapshots) {
      await client.query(
        `create temporary table before_${table} on commit drop as select * from public.${table}`,
      );
    }
    for (const migration of migrations) {
      const sql = await readFile(
        new URL("../docs/migrations/" + migration + ".sql", import.meta.url),
        "utf8",
      );
      // The standalone migration files have their own transaction wrappers.
      // Strip only a verified outer pair so failures roll the entire upgrade back.
      const match = /^(?:\s*--[^\n]*\n)*\s*begin;([\s\S]*)\bcommit;\s*$/i.exec(
        sql,
      );
      if (!match)
        throw new Error("Unexpected transaction wrapper in " + migration);
      await client.query(match[1]);
    }
    const counts = {};
    for (const [table, key] of snapshots) {
      // Materializing a pre-upgrade row type lets new columns take defaults
      // while comparing every previously existing column, including manifests.
      const result = await client.query(`select count(*)::int as total,
        count(*) filter (where a.${key} is null or b.${key} is null or
          to_jsonb(b) is distinct from to_jsonb(jsonb_populate_record(null::pg_temp.before_${table}, to_jsonb(a))))::int as changed
        from pg_temp.before_${table} b full join public.${table} a using (${key})`);
      if (result.rows[0].changed)
        throw new Error("Existing records changed in " + table);
      counts[table] = result.rows[0].total;
    }
    await client.query(apply ? "commit" : "rollback");
    return counts;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const [mode, ...extra] = process.argv.slice(2);
  if (
    !["--rehearse", "--apply"].includes(mode) ||
    extra.length ||
    !process.env.DATABASE_URL
  ) {
    throw new Error(
      "Set DATABASE_URL explicitly. Use --rehearse on a restored copy or --apply for the in-place upgrade.",
    );
  }
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: ["true", "1", "require"].includes(process.env.DATABASE_SSL)
      ? { rejectUnauthorized: false }
      : undefined,
  });
  try {
    await client.connect();
    console.log(
      mode === "--apply" ? "Committed" : "Rehearsed and rolled back",
      await upgradeLegacy(client, { apply: mode === "--apply" }),
    );
  } finally {
    await client.end();
  }
}
