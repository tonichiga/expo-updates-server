// Run against a disposable database after schema.sql. Never use a production URL.
// OTA_TEST_DATABASE_URL=... node scripts/tests/device-analytics.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

if (!process.env.OTA_TEST_DATABASE_URL) throw new Error('Set OTA_TEST_DATABASE_URL to a disposable database');
const pool = new Pool({ connectionString: process.env.OTA_TEST_DATABASE_URL, max: 4, statement_timeout: 10000 });
const ids = Array.from({ length: 10 }, () => randomUUID());
const scope = `analytics-${randomUUID()}`;
const base = {
  installationId: ids[0], platform: 'android', channel: scope, runtimeVersion: scope,
  eventId: randomUUID(), sequence: 1, observedAt: '2020-01-01T00:00:00.000Z',
  updateId: null, nativeVersion: '1.0', nativeBuild: '1', isEmbeddedLaunch: true, isEmergencyLaunch: false,
};
const send = async (patch = {}, connection = pool) => (await connection.query(
  'select * from ota_record_heartbeat($1::jsonb)', [JSON.stringify({ ...base, ...patch })],
)).rows[0].result;
const report = async (patch = {}) => {
  const p = { days: 7, platform: null, channel: scope, runtime: null, offset: 0, kind: null, search: null, ...patch };
  return (await pool.query('select * from ota_devices_report_v2($1,$2,$3,$4,$5,$6,$7)',
    [p.days, p.platform, p.channel, p.runtime, p.offset, p.kind, p.search])).rows[0].report;
};
const facts = async (id = ids[0]) => (await pool.query(
  'select d.*,activity_date::text as activity_date from ota_device_activity_daily d where installation_id=$1 order by d.activity_date', [id],
)).rows;
const metadata = (await pool.query('select * from ota_device_analytics_metadata')).rows[0];
try {
  const empty = await report();
  assert.equal(empty.total, 0);
  assert.equal(empty.activity.length, 7);
  assert.equal(empty.activity.at(-1).coverage, 'partial');
  assert.equal(empty.activity.at(-1).activeInstallations, 0);
  assert.equal(empty.activity[0].activeInstallations, null, 'Do not manufacture activity before collection');

  assert.equal(await send(), 'accepted');
  const first = await facts();
  assert.equal(first.length, 1);
  assert.equal(first[0].activity_date, empty.activity.at(-1).date, 'Use receipt UTC day, not client timestamp');
  assert.equal(await send(), 'duplicate');
  assert.deepEqual(await facts(), first, 'Duplicate cannot update daily facts');
  assert.equal(await send({ sequence: 2, eventId: randomUUID(), isEmbeddedLaunch: false, runtimeVersion: 'changed', isEmergencyLaunch: true }), 'accepted');
  assert.equal(await send(), 'stale');
  const updated = await facts();
  assert.equal(updated.length, 1);
  assert.equal(updated[0].launch_kind, 'unknown');
  assert.equal(updated[0].first_received_at.toISOString(), first[0].first_received_at.toISOString());
  const cohort = (await pool.query('select * from ota_device_activity_cohorts where installation_id=$1', [ids[0]])).rows[0];
  assert.equal(cohort.launch_kind, 'embedded', 'Entry segmentation must stay immutable');
  assert.equal(cohort.runtime_version, scope);

  const current = await report({ kind: 'unknown', search: ids[0].slice(0, 8) });
  assert.equal(current.total, 1);
  assert.equal(current.summary.emergencyInstallations, 1);
  assert.equal(current.activity.at(-1).activeInstallations, 1);
  assert.equal(current.activity.at(-1).newInstallations, 1);
  assert.equal(current.cohorts.length, 0, 'Retention filters use entry state, not latest state');
  assert.equal(current.adoptionCohorts[0].unknownInstallations, 1);
  assert.equal((await report({ kind: 'embedded' })).cohorts[0].cells[0].rate, 1);
  assert.equal((await report({ offset: 50 })).devices.length, 0);
  assert.equal((await report({ offset: 50 })).summary.activeInstallations, 1, 'Pagination cannot alter aggregate counts');
  assert.deepEqual(current.options.launchKinds, ['embedded', 'unknown']);

  // A pre-existing instrumented installation has no historical daily/cohort data.
  await send({ installationId: ids[1], eventId: randomUUID() });
  await pool.query('delete from ota_device_activity_daily where installation_id=$1', [ids[1]]);
  await pool.query('delete from ota_device_activity_cohorts where installation_id=$1', [ids[1]]);
  await pool.query("update ota_device_state set first_seen_at=now()-interval '50 days' where installation_id=$1", [ids[1]]);
  await send({ installationId: ids[1], sequence: 2, eventId: randomUUID() });
  assert.equal((await facts(ids[1])).length, 1);
  assert.equal((await pool.query('select count(*)::int as n from ota_device_activity_cohorts where installation_id=$1', [ids[1]])).rows[0].n, 0);
  assert.equal((await report()).adoptionCohorts.reduce((sum, c) => sum + c.installations, 0), 2);

  // Synthetic historical facts validate the aggregation without backdating real receipts.
  await pool.query("update ota_device_analytics_metadata set collection_started_at=((now() at time zone 'UTC')::date-40)::timestamp at time zone 'UTC'");
  const firstDay = (await pool.query("select ((now() at time zone 'UTC')::date-10)::text as day")).rows[0].day;
  for (const id of [ids[2], ids[3]]) {
    await pool.query(`insert into ota_device_activity_cohorts(installation_id,platform,first_observed_at,channel,runtime_version,launch_kind)
      values($1,'android',$2::date::timestamp at time zone 'UTC',$3,$3,'embedded')`, [id, firstDay, scope]);
    await pool.query(`insert into ota_device_activity_daily(activity_date,installation_id,platform,channel,runtime_version,launch_kind,
      emergency_launch,first_received_at,last_received_at) values($1,$2,'android',$3,$3,'embedded',false,now(),now())`, [firstDay, id, scope]);
  }
  // The retained member changed scope: return activity is still retention of the entry cohort.
  await pool.query(`insert into ota_device_activity_daily(activity_date,installation_id,platform,channel,runtime_version,launch_kind,
    emergency_launch,first_received_at,last_received_at) values($1::date+7,$2,'android','other','other','unknown',false,now(),now())`, [firstDay, ids[2]]);
  const historical = await report({ days: 1 });
  const week = (await pool.query("select date_trunc('week',$1::date)::date::text as day", [firstDay])).rows[0].day;
  const row = historical.cohorts.find(c => c.weekStart === week);
  assert.equal(row.installations, 2, 'Retention cohort horizon is independent of one-day chart filter');
  assert.equal(row.cells.find(c => c.day === 7).eligibleInstallations, 2);
  assert.equal(row.cells.find(c => c.day === 7).retainedInstallations, 1);
  assert.equal(row.cells.find(c => c.day === 7).rate, 0.5);
  assert.equal(row.cells.find(c => c.day === 1).rate, 0, 'A complete eligible day without a return is zero');
  assert.equal(row.cells.find(c => c.day === 14).rate, null, 'Immature observation windows are unknown');
  assert.equal(historical.coverage.cohortWindowDays, 90);
  assert.equal((await report({ days: 30 })).activity[0].activeInstallations, 0, 'Covered day without facts is a real zero');

  // D30 can mature even when the activity chart only shows seven days.
  await pool.query(`insert into ota_device_activity_cohorts(installation_id,platform,first_observed_at,channel,runtime_version,launch_kind)
    values($1,'android',((now() at time zone 'UTC')::date-32)::timestamp at time zone 'UTC',$2,$2,'embedded')`, [ids[4], scope]);
  const mature = (await report()).cohorts.find(c => c.cells.find(cell => cell.day === 30).eligibleInstallations > 0);
  assert.equal(mature.cells.find(c => c.day === 30).rate, 0);

  // Two concurrent accepted events still produce one daily installation fact.
  const outcomes = await Promise.all([
    send({ installationId: ids[5], sequence: 1, eventId: randomUUID() }),
    send({ installationId: ids[5], sequence: 2, eventId: randomUUID() }),
  ]);
  assert.ok(outcomes.includes('accepted'));
  assert.equal((await facts(ids[5])).length, 1);

  await pool.query(`insert into ota_device_activity_daily(activity_date,installation_id,platform,channel,runtime_version,launch_kind,
    emergency_launch,first_received_at,last_received_at)
    select (now() at time zone 'UTC')::date - days,$1,'android',$2,$2,'unknown',false,now(),now() from unnest(array[89,90]) days`, [ids[6], scope]);
  await pool.query("update ota_device_analytics_metadata set last_pruned_on=(now() at time zone 'UTC')::date-1");
  await send({ installationId: ids[7], eventId: randomUUID() });
  assert.equal((await facts(ids[6])).length, 1, 'Prune deletes day90 and retains day89');
  console.log('PASS: daily acceptance/deduplication, snapshot/entry segmentation, honest coverage, filters/options/KPIs, adoption, mature retention, concurrent writes, bounded retention.');
} finally {
  await pool.query('delete from ota_device_activity_daily where installation_id=any($1)', [ids]);
  await pool.query('delete from ota_device_activity_cohorts where installation_id=any($1)', [ids]);
  await pool.query('delete from ota_device_transitions where installation_id=any($1)', [ids]);
  await pool.query('delete from ota_device_state where installation_id=any($1)', [ids]);
  await pool.query('update ota_device_analytics_metadata set collection_started_at=$1,last_pruned_on=$2', [metadata.collection_started_at, metadata.last_pruned_on]);
  await pool.end();
}
