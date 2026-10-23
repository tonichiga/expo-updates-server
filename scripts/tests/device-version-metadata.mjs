// OTA_TEST_DATABASE_URL=... node scripts/tests/device-version-metadata.mjs
// Disposable/test database only. All fixtures and edits are rolled back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
if (!process.env.OTA_TEST_DATABASE_URL) throw new Error('Set OTA_TEST_DATABASE_URL to a test database');
const db=new Client({connectionString:process.env.OTA_TEST_DATABASE_URL});
await db.connect();
const scope=`versions-${randomUUID()}`;
const updateId=randomUUID();
const event={installationId:randomUUID(),platform:'android',channel:scope,runtimeVersion:scope,eventId:randomUUID(),sequence:1,observedAt:new Date().toISOString(),updateId,nativeVersion:'9.9.9',nativeBuild:'1',isEmbeddedLaunch:false,isEmergencyLaunch:false};
async function report(){return (await db.query('select * from ota_devices_report_v2(7,null,$1)',[scope])).rows[0].report;}
async function send(value){await db.query('select * from ota_record_heartbeat($1::jsonb)',[JSON.stringify(value)]);}
try{
 await db.query('begin');
 await db.query(`insert into ota_updates(update_id,build_id,runtime_version,channel,platform,created_at,created_at_path,storage_bucket,storage_base_path,comment,manifest) values($1,$1,$2,$2,'android',now(),'fixture','fixture','fixture','NOT A VERSION',$3::jsonb)`,[updateId,scope,JSON.stringify({extra:{expoClient:{version:' 2.3.4 '}},expoClient:{version:'1.0.0'}})]);
 await send(event);
 let version=(await report()).versions[0];
 assert.equal(version.app_version,'2.3.4');assert.equal(version.native_version,'9.9.9');assert.equal(version.update_label,'NOT A VERSION');
 await db.query('update ota_updates set manifest=$1::jsonb where update_id=$2',[JSON.stringify({extra:{expoClient:{version:42}},expoClient:{version:' 1.2.3 '}}),updateId]);
 assert.equal((await report()).versions[0].app_version,'1.2.3');
 await db.query('update ota_updates set manifest=$1::jsonb where update_id=$2',[JSON.stringify({expoClient:{version:42}}),updateId]);
 assert.equal((await report()).versions[0].app_version,null,'Do not substitute native version or message for missing OTA metadata');
 await send({...event,installationId:randomUUID(),eventId:randomUUID(),runtimeVersion:scope+'-other'});
 assert.equal((await report()).versions.find(v=>v.launch_kind==='unknown').app_version,null,'Never resolve version metadata across runtime scopes');
 const embeddedId=randomUUID();
 await db.query(`insert into ota_embedded_updates(embedded_update_id,app_version,created_at,channel,platform) values($1,'3.0.0',now(),$2,'android')`,[embeddedId,scope]);
 await send({...event,installationId:randomUUID(),eventId:randomUUID(),updateId:embeddedId,isEmbeddedLaunch:true});
 assert.equal((await report()).versions.find(v=>v.launch_kind==='embedded').app_version,'3.0.0');
 console.log('PASS: manifest version precedence, malformed metadata fallback, no message/native substitution for OTA, runtime isolation, embedded version.');
}finally{await db.query('rollback');await db.end();}
