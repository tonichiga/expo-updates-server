// Explicit test DB only. All fixture changes are rolled back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
if (!process.env.OTA_TEST_DATABASE_URL) throw new Error('Set OTA_TEST_DATABASE_URL');
const db = new Client({ connectionString: process.env.OTA_TEST_DATABASE_URL });
await db.connect();
const scope = `target-${randomUUID()}`, pub = randomUUID(), privateId = randomUUID(), device = 'a'.repeat(64), install = randomUUID();
const event = { installationId: install, deviceId: device, platform: 'android', channel: scope, runtimeVersion: scope, eventId: randomUUID(), sequence: 1, observedAt: new Date().toISOString(), updateId: null, nativeVersion: '1', nativeBuild: '1', isEmbeddedLaunch: true, isEmergencyLaunch: false };
const send = async (e) => (await db.query('select * from ota_record_heartbeat($1)', [e])).rows[0].result;
const latest = async (i = null, d = null, runtime = scope, platform = 'android', channel = scope) => (await db.query('select update_id from ota_latest_eligible_update($1,$2,$3,$4,$5)', [runtime, channel, platform, i, d])).rows[0]?.update_id;
async function fails(sql, args, pattern) {
  await db.query('savepoint expected_failure');
  await assert.rejects(db.query(sql, args), pattern);
  await db.query('rollback to savepoint expected_failure');
}
try {
  await db.query('begin');
  for (const [id, date] of [[pub,'2026-10-20'],[privateId,'2026-10-21']]) await db.query(`insert into ota_updates(update_id,build_id,runtime_version,channel,platform,created_at,created_at_path,storage_bucket,storage_base_path,is_active,manifest) values($1,$1,$2,$2,'android',$3,'fixture','fixture','fixture',false,'{}')`, [id,scope,date]);
  await db.query('select * from ota_replace_audience($1,$2,$3,$4,$5)', [privateId,'devices',JSON.stringify([install]),JSON.stringify([device]),1]);
  await db.query('update ota_updates set is_active=true where update_id=$1', [pub]);
  await db.query('update ota_updates set is_active=true where update_id=$1', [privateId]);
  assert.equal(await latest(), pub); assert.equal(await latest(null,'b'.repeat(64)), pub);
  assert.equal(await latest(install), privateId); assert.equal(await latest(null,device), privateId);
  assert.equal(await latest(null,device,scope+'-other'), undefined); assert.equal(await latest(null,device,scope,'ios'), undefined); assert.equal(await latest(null,device,scope,'android',scope+'-other'), undefined);
  await fails('select * from ota_replace_audience($1,$2,$3,$4,$5)',[privateId,'all','[]','[]',1],/AUDIENCE_CONFLICT/);
  await fails('select * from ota_replace_audience($1,$2,$3,$4,$5)',[privateId,'devices','[]','[]',2],/INVALID_AUDIENCE/);
  assert.equal(await send(event),'accepted'); assert.equal(await send({...event,deviceId:'b'.repeat(64)}),'duplicate');
  assert.equal(await send({...event,sequence:2,eventId:randomUUID(),deviceId:undefined}),'accepted');
  assert.equal((await db.query('select device_id from ota_device_state where installation_id=$1',[install])).rows[0].device_id,device);
  const nextInstall=randomUUID(); await send({...event,installationId:nextInstall,eventId:randomUUID()});
  const rows=(await db.query('select installation_id from ota_device_state where device_id=$1 and channel=$2',[device,scope])).rows;
  assert.equal(rows.length,2,'Reinstall preserves the audience identity without merging installation analytics');
  await db.query('select * from ota_replace_audience($1,$2,$3,$4,$5)',[privateId,'all','[]','[]',2]);
  assert.equal(await latest(),privateId,'Widening exposes same artifact to everyone');
  await db.query(`update ota_distribution_control set blocked=true,reason='targeting regression' where singleton_id=1`);
  await fails('select * from ota_replace_audience($1,$2,$3,$4,$5)',[privateId,'devices',JSON.stringify([install]),'[]',3],/OTA_DISTRIBUTION_BLOCKED/);
  console.log('PASS: selected/anonymous/fallback/scope/widening, audience CAS and global block, reinstall identity and duplicate heartbeat isolation.');
} finally { await db.query('rollback'); await db.end(); }
