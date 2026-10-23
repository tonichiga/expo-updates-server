// Use only a disposable database with the heartbeat migration applied.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
if (!process.env.OTA_TEST_DATABASE_URL) throw new Error('Set OTA_TEST_DATABASE_URL to a disposable database');
const pool = new Pool({ connectionString: process.env.OTA_TEST_DATABASE_URL, max: 3, statement_timeout: 10000 });
const scope = `heartbeat-${randomUUID()}`;
const installationId = randomUUID();
const concurrentId = randomUUID();
const updateId = randomUUID();
const launchId = randomUUID();
const launchId2 = randomUUID();
const base = { installationId, eventId: randomUUID(), sequence: 1, observedAt: new Date().toISOString(), platform: 'android', channel: scope, runtimeVersion: scope, nativeVersion: '1.0', nativeBuild: '1', updateId: launchId, isEmbeddedLaunch: false, isEmergencyLaunch: false };
const record = async (event, db = pool) => (await db.query('select * from ota_record_heartbeat($1::jsonb)', [JSON.stringify(event)])).rows[0].result;
const state = async () => (await pool.query('select * from ota_device_state where installation_id=$1', [installationId])).rows[0];
const transitions = async () => Number((await pool.query('select count(*) as n from ota_device_transitions where installation_id=$1', [installationId])).rows[0].n);
try {
  assert.equal(await record(base), 'accepted');
  assert.equal((await state()).launch_kind, 'unknown');
  const first = await state();
  assert.equal(await record(base), 'duplicate');
  await assert.rejects(() => record({ ...base, sequence: 0 }), /INVALID_SEQUENCE/);
  await assert.rejects(() => record({ ...base, eventId: randomUUID() }), /HEARTBEAT_SEQUENCE_CONFLICT/);
  assert.equal((await state()).last_seen_at.toISOString(), first.last_seen_at.toISOString());
  await pool.query(`insert into ota_updates(update_id,build_id,runtime_version,channel,platform,created_at,created_at_path,storage_bucket,storage_base_path,manifest,comment)
    values($1,$1,$2,$2,'android',now(),'test','test','test','{}','Smoke test')`, [updateId, scope]);
  for (const id of [launchId, launchId2]) await pool.query(`insert into ota_served_manifest_log(served_manifest_id,update_id,runtime_version,channel,platform) values($1,$2,$3,$3,'android')`, [id, updateId, scope]);
  assert.equal(await record({ ...base, sequence: 2, eventId: randomUUID() }), 'accepted');
  assert.equal((await state()).resolved_update_id, updateId);
  assert.equal(await transitions(), 2);
  assert.equal(await record({ ...base, sequence: 3, eventId: randomUUID(), updateId: launchId2 }), 'accepted');
  assert.equal(await transitions(), 2, 'Epoch rotation of same artifact is not a version transition');
  assert.equal(await record({ ...base, sequence: 2 }), 'stale');
  // Assert both exclusions while a matching artifact and mapping still exist.
  await record({ ...base, installationId: concurrentId, eventId: randomUUID(), isEmbeddedLaunch: true });
  let isolated = (await pool.query('select * from ota_device_state where installation_id=$1', [concurrentId])).rows[0];
  assert.equal(isolated.launch_kind, 'embedded'); assert.equal(isolated.resolved_update_id, null);
  await record({ ...base, installationId: concurrentId, sequence: 2, eventId: randomUUID(), channel: 'other' });
  isolated = (await pool.query('select * from ota_device_state where installation_id=$1', [concurrentId])).rows[0];
  assert.equal(isolated.launch_kind, 'unknown'); assert.equal(isolated.resolved_update_id, null);
  await pool.query('delete from ota_device_transitions where installation_id=$1', [concurrentId]);
  await pool.query('delete from ota_device_state where installation_id=$1', [concurrentId]);
  await pool.query('delete from ota_updates where update_id=$1', [updateId]);
  await record({ ...base, sequence: 4, eventId: randomUUID(), updateId: launchId2 });
  assert.equal((await state()).resolved_update_id, updateId, 'Deleted artifacts retain snapshot');
  assert.equal((await state()).current_update_id, null);
  assert.equal(await transitions(), 2);
  await record({ ...base, sequence: 5, eventId: randomUUID(), isEmbeddedLaunch: true });
  assert.equal((await state()).launch_kind, 'embedded');
  assert.equal((await state()).resolved_update_id, null);
  assert.equal(await transitions(), 3);
  await record({ ...base, sequence: 6, eventId: randomUUID(), channel: 'other', isEmbeddedLaunch: false });
  assert.equal((await state()).launch_kind, 'unknown', 'Scope mismatch must not resolve');
  await record({ ...base, sequence: 7, eventId: randomUUID(), isEmbeddedLaunch: true, nativeBuild: '2' });
  const report = (await pool.query('select * from ota_devices_report(7,null,$1,null,0)', [scope])).rows[0].report;
  assert.equal(report.total, 1); assert.equal(report.devices.length, 1); assert.equal(report.versions[0].installations, 1);
  await pool.query("update ota_device_state set last_seen_at=now()-interval '8 days' where installation_id=$1", [installationId]);
  const staleReport = (await pool.query('select * from ota_devices_report(7,null,$1,null,0)', [scope])).rows[0].report;
  assert.equal(staleReport.total, 0);
  const winner = await pool.connect(); const contender = await pool.connect();
  let pending;
  try {
    await winner.query('begin');
    const event = { ...base, installationId: concurrentId, eventId: randomUUID() };
    assert.equal(await record(event, winner), 'accepted');
    const pid = (await contender.query('select pg_backend_pid() as pid')).rows[0].pid;
    pending = record({ ...event, sequence: 2, eventId: randomUUID() }, contender);
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      if ((await pool.query('select wait_event_type from pg_stat_activity where pid=$1', [pid])).rows[0].wait_event_type === 'Lock') { waiting = true; break; }
      await delay(20);
    }
    assert.ok(waiting, 'Concurrent registration must wait for first writer');
    await winner.query('commit'); assert.equal(await pending, 'accepted');
    const row = (await pool.query('select last_sequence from ota_device_state where installation_id=$1', [concurrentId])).rows[0];
    assert.equal(Number(row.last_sequence), 2);
    assert.equal(Number((await pool.query('select count(*) as n from ota_device_transitions where installation_id=$1', [concurrentId])).rows[0].n), 1);
  } finally { await winner.query('rollback'); if (pending) await pending; winner.release(); contender.release(); }
  console.log('PASS: atomic registration, duplicate/stale/conflict, mapping, epoch rotation, deletion, scope, embedded, statistics, concurrent first registration.');
} finally {
  await pool.query('delete from ota_device_transitions where installation_id=any($1)', [[installationId, concurrentId]]);
  await pool.query('delete from ota_device_state where installation_id=any($1)', [[installationId, concurrentId]]);
  await pool.query('delete from ota_updates where update_id=$1', [updateId]);
  await pool.end();
}
