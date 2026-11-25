// Run against an empty disposable database owned by the connection role.
// OTA_TEST_DATABASE_URL=... node scripts/tests/public-distribution-history.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { writeDatabaseRecords } from "../../templates/expo-app/scripts/ota-publish/api/database-client.mjs";

if (!process.env.OTA_TEST_DATABASE_URL) throw new Error("Set OTA_TEST_DATABASE_URL to an empty disposable database");
const db = new Pool({ connectionString: process.env.OTA_TEST_DATABASE_URL, max: 4, statement_timeout: 15000 });
const schema = await readFile(new URL("../../docs/migrations/schema.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../../docs/migrations/2026-11-25-public-distribution-history.sql", import.meta.url), "utf8");
const marker = schema.indexOf(migration.trim());
assert.ok(marker > 0, "Migration must match the canonical schema");
const runtime = "history-" + randomUUID();
const device = "c".repeat(64);
const changes = (id, action, rev = null) => db.query("select * from ota_change_distribution($1,$2,$3)", [id, action, rev]);
const history = async () => (await db.query("select * from ota_distribution_history where runtime_version=$1", [runtime])).rows[0];
const eligible = async (identity = null) => (await db.query("select update_id from ota_latest_eligible_update($1,'test','ios',null,$2)", [runtime, identity])).rows[0]?.update_id;
let count = 0;
function artifact() {
  const id = randomUUID();
  return {
    id, updateId: id, runtimeVersion: runtime, channel: "test", platform: "ios", assets: [],
    launchAsset: { path: "bundle.js" }, createdAt: new Date(Date.UTC(2024, 0, 1, 0, ++count)).toISOString(),
    createdAtPath: id, storageBucket: "fixture", storageBasePath: id, comment: "Fixture",
  };
}
const publish = async () => {
  const u = artifact();
  await writeDatabaseRecords(db, u, u);
  return u;
};
try {
  assert.equal((await db.query("select to_regclass('public.ota_updates') as existing")).rows[0].existing, null,
    "Refusing a database with OTA tables");
  await db.query(schema.slice(0, marker));
  const dormant = await publish();
  const legacyA = await publish();
  const legacyB = await publish();
  await db.query("update ota_updates set is_active=true,disabled_at=null where update_id=$1", [legacyA.id]);
  await db.query("select * from ota_replace_audience($1,'devices','[]',$2,1)", [legacyB.id, JSON.stringify([device])]);
  await db.query("update ota_updates set is_active=true,disabled_at=null where update_id=$1", [legacyB.id]);
  await db.query("select * from ota_replace_audience($1,'all','[]','[]',2)", [legacyB.id]);
  await db.query("update ota_update_channels set latest_update_id=$1 where runtime_version=$2", [legacyB.id, runtime]);
  assert.equal((await db.query("select count(*)::int as n from ota_updates where is_active")).rows[0].n, 2);

  await db.query(migration);
  await db.query(migration);
  const baseline = await history();
  assert.equal(baseline.current_release.updateId, legacyB.id);
  assert.equal(baseline.current_release.activatedAt, null);
  assert.equal(baseline.previous_release, null, "historical public audiences cannot be inferred on upgrade");
  assert.equal((await db.query("select count(*)::int as n from ota_public_distribution_events")).rows[0].n, 1);
  assert.equal((await db.query("select is_active from ota_updates where update_id=$1", [legacyA.id])).rows[0].is_active, false);
  await assert.rejects(changes(dormant.id, "restore", baseline.revision), /DISTRIBUTION_CONFLICT/);

  const smoke = await publish();
  await db.query("select * from ota_replace_audience($1,'devices','[]',$2,1)", [smoke.id, JSON.stringify([device])]);
  await changes(smoke.id, "activate");
  assert.equal((await history()).revision, baseline.revision);
  assert.equal(await eligible(device), smoke.id);
  const b = await publish();
  await changes(b.id, "activate");
  await writeDatabaseRecords(db, b, b);
  assert.equal(await eligible(), b.id, "publisher retry must leave the active release intact");
  for (let i = 0; i < 5; i++) await publish();
  assert.equal((await history()).previous_release.updateId, legacyB.id);
  await changes(b.id, "stop");
  assert.equal(await eligible(), undefined);
  const stopped = await history();
  assert.equal(stopped.current_release, null);
  assert.equal(stopped.previous_release.updateId, legacyB.id);
  await db.query("update ota_distribution_control set blocked=true,reason='private test' where singleton_id=1");
  await publish(); // draft uploads during an incident cannot touch serving pointers
  await assert.rejects(changes(legacyB.id, "restore", stopped.revision), /OTA_DISTRIBUTION_BLOCKED/);
  assert.equal((await history()).revision, stopped.revision);
  await db.query("update ota_distribution_control set blocked=false,reason=null where singleton_id=1");
  const results = await Promise.allSettled([
    changes(legacyB.id, "restore", stopped.revision), changes(legacyB.id, "restore", stopped.revision),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(results.find((r) => r.status === "rejected").reason.message, /DISTRIBUTION_CONFLICT/);
  const restored = await history();
  assert.equal(restored.current_release.updateId, legacyB.id);
  assert.ok(restored.current_release.activatedAt);
  assert.equal(restored.previous_release.updateId, b.id);
  assert.equal(await eligible(), legacyB.id);
  assert.equal(await eligible(device), smoke.id, "public restoration leaves the smoke audience intact");
  await db.query("select * from ota_replace_audience($1,'devices','[]',$2,1)", [b.id, JSON.stringify([device])]);
  await assert.rejects(changes(b.id, "restore", restored.revision), /DISTRIBUTION_CONFLICT/);
  await changes(legacyB.id, "retire");
  await assert.rejects(changes(legacyB.id, "activate"), /being deleted/);
  await changes(legacyB.id, "retire"); // a failed storage request can retry cleanup
  await changes(legacyB.id, "delete");
  await assert.rejects(changes(legacyB.id, "restore", restored.revision), /no longer exists/);
  assert.equal(await eligible(), undefined);
  assert.equal((await history()).current_release, null);
  console.log("PASS: duplicate legacy public rows, honest baseline, inactive publication and retry, scoped smoke, public replacement/stop, blocked/stale/concurrent restore, deletion and changed audience");
} finally {
  await db.end();
}
