// Run against a disposable PostgreSQL database with the identity migration applied.
// OTA_TEST_DATABASE_URL=postgresql://... node scripts/tests/manifest-identity-concurrency.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";

if (!process.env.OTA_TEST_DATABASE_URL) {
  throw new Error("OTA_TEST_DATABASE_URL must point to a disposable test database.");
}

const pool = new Pool({
  connectionString: process.env.OTA_TEST_DATABASE_URL,
  max: 3,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
});
const scope = `identity-concurrency-${randomUUID()}`;
const updates = [randomUUID(), randomUUID()];
const firstSeen = "2026-01-01T00:00:00.000Z";
const upsert = `INSERT INTO public.ota_served_manifest_log
  (served_manifest_id, update_id, runtime_version, channel, platform, created_at)
  VALUES ($1, $2, $3, $3, 'android', $4)
  ON CONFLICT (served_manifest_id) DO UPDATE SET
    update_id = excluded.update_id, created_at = excluded.created_at`;

async function exerciseConcurrentRetry(winner, contender, conflicting) {
  const manifestId = randomUUID();
  const contenderPid = (await contender.query("select pg_backend_pid() as pid")).rows[0].pid;
  let pending;
  await winner.query("begin");
  try {
    await winner.query(upsert, [manifestId, updates[0], scope, firstSeen]);
    pending = contender.query(upsert, [
      manifestId,
      updates[Number(conflicting)],
      scope,
      "2026-02-01T00:00:00.000Z",
    ]).then(() => ({ ok: true }), (error) => ({ ok: false, error }));

    // Verify actual lock contention instead of relying on query launch order.
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const { rows } = await pool.query(
        "select wait_event_type from pg_stat_activity where pid = $1",
        [contenderPid],
      );
      if (rows[0]?.wait_event_type === "Lock") {
        waiting = true;
        break;
      }
      await delay(20);
    }
    assert.ok(waiting, "Concurrent upsert must wait for the first writer");
    await winner.query("commit");
    const result = await pending;
    if (conflicting) {
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "23514");
      assert.match(result.error.message, /^OTA_MANIFEST_IDENTITY_CONFLICT:/);
    } else {
      assert.equal(result.ok, true, result.error?.message);
    }

    const { rows } = await pool.query(
      "select update_id, created_at from public.ota_served_manifest_log where served_manifest_id = $1",
      [manifestId],
    );
    assert.equal(rows[0].update_id, updates[0]);
    assert.equal(rows[0].created_at.toISOString(), firstSeen);
  } finally {
    await winner.query("rollback");
    if (pending) await pending;
  }
}

try {
  for (const id of updates) {
    await pool.query(
      `INSERT INTO public.ota_updates (
        update_id, build_id, runtime_version, channel, platform, created_at,
        created_at_path, storage_bucket, storage_base_path, manifest
      ) VALUES ($1, $1, $2, $2, 'android', now(), 'test', 'test', 'test', '{}')`,
      [id, scope],
    );
  }
  const winner = await pool.connect();
  try {
    const contender = await pool.connect();
    try {
      await exerciseConcurrentRetry(winner, contender, false);
      await exerciseConcurrentRetry(winner, contender, true);
      console.log("PASS: concurrent identical retry and conflicting upsert preserve identity and first-seen time.");
    } finally {
      contender.release();
    }
  } finally {
    winner.release();
  }
} finally {
  try {
    await pool.query("delete from public.ota_updates where update_id = any($1::uuid[])", [updates]);
  } finally {
    await pool.end();
  }
}
