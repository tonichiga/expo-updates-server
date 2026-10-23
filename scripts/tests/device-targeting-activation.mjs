// Use an EMPTY disposable database after schema.sql. Never uses environment files.
// OTA_TEST_DATABASE_URL=... node scripts/tests/device-targeting-activation.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
if (!process.env.OTA_TEST_DATABASE_URL) throw new Error('Set OTA_TEST_DATABASE_URL to an empty disposable database');
const db = new Pool({ connectionString: process.env.OTA_TEST_DATABASE_URL, max: 4, statement_timeout: 10000 });
const scope = `activation-${randomUUID()}`, pub = randomUUID(), target = randomUUID();
const device = 'a'.repeat(64);
const active = async (connection = db) => (await connection.query('select update_id from ota_updates where runtime_version=$1 and is_active order by update_id', [scope])).rows.map(r => r.update_id).sort();
const expectedBoth = [pub, target].sort();
async function failing(connection, sql, args, pattern) {
  await connection.query('savepoint expected_failure');
  await assert.rejects(connection.query(sql, args), pattern);
  await connection.query('rollback to savepoint expected_failure');
}
async function waitForLock(pid) {
  for (let i = 0; i < 100; i++) {
    const row = (await db.query('select wait_event_type from pg_stat_activity where pid=$1', [pid])).rows[0];
    if (row?.wait_event_type === 'Lock') return;
    await delay(10);
  }
  throw new Error('Contender did not wait for the distribution lock');
}
async function changeWhileActivating(mode, expected) {
  const owner = await db.connect(), contender = await db.connect();
  let pending;
  try {
    await owner.query('begin');
    const version = (await owner.query('select audience_version from ota_updates where update_id=$1', [target])).rows[0].audience_version;
    await owner.query('select * from ota_replace_audience($1,$2,$3,$4,$5)', [target, mode, '[]', JSON.stringify(mode === 'devices' ? [device] : []), version]);
    const pid = (await contender.query('select pg_backend_pid() as pid')).rows[0].pid;
    pending = contender.query('update ota_updates set is_active=true,disabled_at=null where update_id=$1', [target]);
    await waitForLock(pid);
    await owner.query('commit');
    await pending;
    assert.deepEqual(await active(), expected, `Activation must use the committed ${mode} audience after waiting`);
  } finally {
    await owner.query('rollback');
    if (pending) await pending.catch(() => {});
    owner.release(); contender.release();
  }
}
try {
  assert.deepEqual((await db.query("select action_key from ota_guard_actions where action_key in ('ota-force-update','ota-force-store-update') order by action_key")).rows.map(r => r.action_key), ['ota-force-store-update','ota-force-update']);
  assert.equal((await db.query('select count(*)::int as n from ota_updates')).rows[0].n, 0,
    'Refusing a database containing releases: use an empty disposable database');
  for (const [id, date] of [[pub,'2026-10-20'],[target,'2026-10-21']]) {
    await db.query(`insert into ota_updates(update_id,build_id,runtime_version,channel,platform,created_at,created_at_path,storage_bucket,storage_base_path,manifest) values($1,$1,$2,$2,'android',$3::timestamptz,$3::text,'fixture','fixture','{}')`, [id, scope, date]);
  }
  await db.query('update ota_updates set is_active=true,disabled_at=null where update_id=$1', [pub]);
  await db.query(`insert into ota_update_channels(runtime_version,channel,platform,latest_update_id,latest_created_at,latest_created_at_path) select runtime_version,channel,platform,update_id,created_at,created_at_path from ota_updates where update_id=$1`, [target]);
  await changeWhileActivating('devices', expectedBoth);
  await db.query('update ota_updates set is_active=false where update_id=$1', [target]);
  await changeWhileActivating('all', [target]);

  // Failed activation must roll back peer deactivation in the same statement.
  const tx = await db.connect();
  try {
    await tx.query('begin');
    await tx.query('update ota_updates set is_active=true,disabled_at=null where update_id=$1', [pub]);
    await failing(tx, 'update ota_updates set is_active=true,disabled_at=now() where update_id=$1', [target], /ota_updates_active_dates_chk/);
    assert.deepEqual(await active(tx), [pub]);
    await tx.query('rollback');

    // Widening keeps public fallback; subsequent public activation restores the
    // normal single-release behavior, including direct update-meta writes.
    await tx.query('begin');
    await tx.query('update ota_updates set is_active=true,disabled_at=null where update_id=$1', [pub]);
    await tx.query("select * from ota_replace_audience($1,'devices','[]',$2,(select audience_version from ota_updates where update_id=$1))", [target, JSON.stringify([device])]);
    await tx.query('update ota_updates set is_active=true,disabled_at=null where update_id=$1', [target]);
    assert.deepEqual(await active(tx), expectedBoth);
    await tx.query("select * from ota_replace_audience($1,'all','[]','[]',(select audience_version from ota_updates where update_id=$1))", [target]);
    assert.deepEqual(await active(tx), expectedBoth);
    await tx.query('update ota_updates set is_active=true,disabled_at=null where update_id=$1', [target]);
    assert.deepEqual(await active(tx), [target]);
    await tx.query('rollback');

    // Incident repair: global stop must still permit removal of a selected OTA.
    await tx.query('begin');
    await tx.query('update ota_updates set is_active=true,disabled_at=null where update_id=$1', [pub]);
    await tx.query("select * from ota_replace_audience($1,'devices','[]',$2,(select audience_version from ota_updates where update_id=$1))", [target, JSON.stringify([device])]);
    await tx.query('update ota_updates set is_active=true,disabled_at=null where update_id=$1', [target]);
    await tx.query("update ota_distribution_control set blocked=true,reason='activation regression' where singleton_id=1");
    await tx.query('update ota_updates set is_active=false,disabled_at=now() where update_id=$1', [target]);
    await tx.query(`update ota_update_channels c set latest_update_id=u.update_id,latest_created_at=u.created_at,latest_created_at_path=u.created_at_path,active_update_id=null from ota_updates u where c.runtime_version=$1 and u.update_id=$2`, [scope, pub]);
    assert.deepEqual(await active(tx), [pub]);
    await failing(tx, 'update ota_updates set is_active=true,disabled_at=null where update_id=$1', [target], /OTA_DISTRIBUTION_BLOCKED/);
    await failing(tx, 'update ota_update_channels set latest_update_id=$1 where runtime_version=$2', [target, scope], /OTA_DISTRIBUTION_BLOCKED/);
    await tx.query('rollback');

    // Clearing a live rollback remains blocked; disabling it permits cleanup.
    await tx.query('begin');
    await tx.query('update ota_updates set is_active=true,disabled_at=null where update_id=$1', [pub]);
    await tx.query("select * from ota_replace_audience($1,'devices','[]',$2,(select audience_version from ota_updates where update_id=$1))", [target, JSON.stringify([device])]);
    await tx.query('update ota_updates set is_active=true,disabled_at=null where update_id=$1', [target]);
    await tx.query('update ota_update_channels set active_update_id=$1 where runtime_version=$2', [pub, scope]);
    await tx.query("update ota_distribution_control set blocked=true,reason='rollback regression' where singleton_id=1");
    await failing(tx, 'update ota_update_channels set active_update_id=null where runtime_version=$1', [scope], /OTA_DISTRIBUTION_BLOCKED/);
    await tx.query('update ota_updates set is_active=false,disabled_at=now() where update_id=$1', [pub]);
    await tx.query('update ota_update_channels set active_update_id=null where runtime_version=$1', [scope]);
    assert.deepEqual(await active(tx), [target]);
    await tx.query('rollback');
  } finally { await tx.query('rollback'); tx.release(); }
  console.log('PASS: concurrent audience/activation serialization, atomic activation failure, public/targeted/widening semantics, blocked deactivation cleanup and promotion rejection.');
} finally {
  await db.query('delete from ota_update_channels where runtime_version=$1', [scope]);
  await db.query('delete from ota_updates where runtime_version=$1', [scope]);
  await db.end();
}
