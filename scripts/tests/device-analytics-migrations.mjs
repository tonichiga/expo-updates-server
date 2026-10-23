// Requires an EMPTY disposable PostgreSQL database owned by its connection role.
// OTA_TEST_DATABASE_URL=... node scripts/tests/device-analytics-migrations.mjs [--fresh]
// No environment files, fixed credentials, or CREATE DATABASE privilege are used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Pool } from 'pg';

if (!process.env.OTA_TEST_DATABASE_URL) throw new Error('Set OTA_TEST_DATABASE_URL to an empty disposable database');
if (process.argv.slice(2).some(arg => arg !== '--fresh')) throw new Error('Only --fresh is supported');
const fresh = process.argv.includes('--fresh');
const schema = readFileSync(new URL('../../docs/migrations/schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../docs/migrations/2026-10-22-device-analytics.sql', import.meta.url), 'utf8');
const versionMigration = readFileSync(new URL('../../docs/migrations/2026-10-22-device-version-metadata.sql', import.meta.url), 'utf8');
assert.ok(schema.includes(versionMigration.trim()), 'Canonical version metadata SQL must match migration');
const targetingMigration = readFileSync(new URL('../../docs/migrations/2026-10-22-device-targeting.sql', import.meta.url), 'utf8');
const activationMigration = readFileSync(new URL('../../docs/migrations/2026-10-22-device-targeting-activation.sql', import.meta.url), 'utf8');
assert.ok(schema.includes(targetingMigration.trim()), 'Canonical targeting SQL must match migration');
assert.ok(schema.includes(activationMigration.trim()), 'Canonical activation SQL must match migration');
const marker = '-- Daily device analytics (2026-10-22).';
assert.ok(schema.includes(marker), 'Canonical schema must contain the analytics migration marker');
assert.ok(schema.split(marker)[1].trimStart().startsWith(migration.trim()), 'Canonical analytics SQL must match the standalone migration');
const pool = new Pool({ connectionString: process.env.OTA_TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
const event = {
  installationId: randomUUID(), platform: 'ios', channel: 'analytics-upgrade-test', runtimeVersion: 'analytics-upgrade-test',
  eventId: randomUUID(), sequence: 1, observedAt: new Date().toISOString(), updateId: null,
  nativeVersion: '1', nativeBuild: '1', isEmbeddedLaunch: true, isEmergencyLaunch: false,
};
const send = async (value) => pool.query('select * from ota_record_heartbeat($1::jsonb)', [JSON.stringify(value)]);
let installed = false;
try {
  assert.equal((await pool.query("select count(*)::int as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')")).rows[0].n, 0,
    'Refusing a nonempty OTA database: use an empty disposable database');
  await pool.query(fresh ? schema : schema.split(marker)[0]);
  installed = true;
  let original;
  if (!fresh) {
    await send(event);
    original = (await pool.query('select to_jsonb(s) as state from ota_device_state s where installation_id=$1', [event.installationId])).rows[0].state;
    await pool.query(migration);
  await pool.query(versionMigration);
  }
  const coverage = (await pool.query('select collection_started_at from ota_device_analytics_metadata')).rows[0].collection_started_at.toISOString();
  await pool.query(migration);
  await pool.query(versionMigration);
  assert.equal((await pool.query('select collection_started_at from ota_device_analytics_metadata')).rows[0].collection_started_at.toISOString(), coverage);
  if (!fresh) {
    assert.deepEqual((await pool.query('select to_jsonb(s) as state from ota_device_state s where installation_id=$1', [event.installationId])).rows[0].state, original);
    assert.equal((await pool.query('select count(*)::int as n from ota_device_activity_daily')).rows[0].n, 0);
    assert.equal((await pool.query('select count(*)::int as n from ota_device_activity_cohorts')).rows[0].n, 0);
    let report = (await pool.query('select * from ota_devices_report_v2()')).rows[0].report;
    assert.equal(report.total, 1); assert.equal(report.cohorts.length, 0); assert.equal(report.adoptionCohorts[0].installations, 1);
    await send({ ...event, sequence: 2, eventId: randomUUID() });
    report = (await pool.query('select * from ota_devices_report_v2()')).rows[0].report;
    assert.equal(report.activity.at(-1).activeInstallations, 1);
    assert.equal(report.cohorts.length, 0, 'An existing installation is not a new retention-cohort member');
  }
  await pool.query(targetingMigration);
  await pool.query(activationMigration);
  await pool.query(activationMigration);
  console.log(`PASS: ${fresh ? 'fresh canonical schema' : 'upgrade preserving existing state without backfill'}, SQL parity, and repeat migration preserving collection start.`);
} finally {
  if (installed) {
    for (const table of ['ota_device_activity_daily', 'ota_device_activity_cohorts', 'ota_device_transitions', 'ota_device_state']) {
      if ((await pool.query('select to_regclass($1) as name', [`public.${table}`])).rows[0].name) {
        await pool.query(`delete from public.${table} where installation_id=$1`, [event.installationId]);
      }
    }
  }
  await pool.end();
}

for (const test of ['./device-analytics.mjs', './device-version-metadata.mjs', './device-targeting-activation.mjs', './device-targeting.mjs']) {
  const regression = spawnSync(process.execPath, [new URL(test, import.meta.url).pathname], {
    env: process.env, stdio: 'inherit',
  });
  if (regression.error) throw regression.error;
  if (regression.status !== 0) { process.exitCode = regression.status || 1; break; }
}
