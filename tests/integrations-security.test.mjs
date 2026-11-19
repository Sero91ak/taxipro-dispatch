import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleIntegrations,integrationStatus,deliverGenericPush} from '../backend/integrations.js';

const ADMIN={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',role:'admin'};
const DRIVER={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',role:'driver'};
const SECOND={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',role:'driver'};
const APP_ID='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SUB_ID='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('PRAGMA foreign_keys=ON;'+readFileSync(new URL('../backend/schema.sql',import.meta.url),'utf8'));
 for(const u of [ADMIN,DRIVER,SECOND])sql.prepare(
  'INSERT INTO users(id,username,display_name,role,salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?)'
 ).run(u.id,u.id.slice(0,8),'Test',u.role,'salt','hash',new Date().toISOString());
 const db={prepare(query){let args=[];return{
  bind(...xs){args=xs;return this;},
  first(){return sql.prepare(query).get(...args)||null;},
  all(){return {results:sql.prepare(query).all(...args)};},
  run(){return {meta:{changes:sql.prepare(query).run(...args).changes}};}
 }}};
 return {sql,db};
}
const path=(p,method='GET',body=null)=>new Request('https://taxipro.test'+p,{
 method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})
});
test('Google, OneSignal and Claude must report unavailable without separate credentials',async()=>{
 const {sql,db}=setup(),env={DB:db};
 const status=integrationStatus(env,ADMIN);
 assert.equal(status.google.taxiCalendar,false);
 assert.equal(status.google.masterSheets,false);
 assert.equal(status.google.contacts,false);
 assert.equal(status.oneSignal.ready,false);
 assert.equal(status.claude.ready,false);
 assert.equal(integrationStatus(env,DRIVER).google,undefined,'Driver must not see admin Google connectors');
 const result=await handleIntegrations(path('/api/integrations/status'),env,DRIVER,'/api/integrations/status');
 assert.equal(result.data.oneSignal.appId,null);
 await assert.rejects(handleIntegrations(path('/api/integrations/push','POST',{subscriptionId:SUB_ID}),env,DRIVER,'/api/integrations/push'),e=>e.status===503);
 await assert.rejects(handleIntegrations(path('/api/integrations/claude-summary','POST',{action:'daily_overview',date:'2026-11-18'}),env,ADMIN,'/api/integrations/claude-summary'),e=>e.status===503);
 sql.close();
});
test('OneSignal push uses server-mapped subscriptions and never includes chat or patient data',async()=>{
 const {sql,db}=setup();
 const env={DB:db,PUSH_ENABLED:'true',TAXIPRO_ONESIGNAL_APP_ID:APP_ID,TAXIPRO_ONESIGNAL_REST_API_KEY:'synthetic',
  PUSH_DAILY_MAX_REQUESTS:'1'};
 const saved=await handleIntegrations(path('/api/integrations/push','POST',{subscriptionId:SUB_ID}),
  env,DRIVER,'/api/integrations/push');
 assert.equal(saved.data.registered,true);
 const original=globalThis.fetch,seen=[];
 globalThis.fetch=async(url,options)=>{seen.push({url,body:JSON.parse(options.body),headers:options.headers});
  return new Response(JSON.stringify({id:'synthetic'}),{status:200})};
 try{
  const first=await deliverGenericPush(env,db,{senderId:ADMIN.id,recipientId:DRIVER.id,type:'message'});
  assert.equal(first.sent,true);
  assert.equal(seen.length,1);
  assert.equal(seen[0].url,'https://api.onesignal.com/notifications');
  assert.deepEqual(seen[0].body.include_subscription_ids,[SUB_ID]);
  assert.equal(seen[0].body.contents.de,'Neue Nachricht in TaxiPro.');
  assert.equal(seen[0].body.include_aliases,undefined,'No unverified external_id identity');
  assert.ok(!JSON.stringify(seen[0].body).includes('Patient'));
  const after=await deliverGenericPush(env,db,{senderId:ADMIN.id,recipientId:DRIVER.id});
  assert.equal(after.reason,'daily_budget');
  assert.equal(seen.length,1,'No second provider call after hard cap');
 }finally{globalThis.fetch=original}
 const removed=await handleIntegrations(path('/api/integrations/push/'+SUB_ID,'DELETE'),
  env,DRIVER,'/api/integrations/push/'+SUB_ID);
 assert.equal(removed.data.removed,true);
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM taxi_push_subscriptions').get().n,0);
 sql.close();
});
test('Claude sends only aggregate counts after explicit key AND hard budget; drivers denied',async()=>{
 const {sql,db}=setup();
 const env={DB:db,CLAUDE_ENABLED:'true',ANTHROPIC_API_KEY:'test-only-secret',
  ANTHROPIC_MODEL:'test-synthetic-model',CLAUDE_DAILY_MAX_REQUESTS:'1'};
 const req=path('/api/integrations/claude-summary','POST',{action:'daily_overview',date:'2026-11-18'});
 await assert.rejects(handleIntegrations(req.clone(),env,DRIVER,'/api/integrations/claude-summary'),
  e=>e.status===403);
 const original=globalThis.fetch,body=[];
 globalThis.fetch=async(url,options)=>{
  body.push({url,payload:JSON.parse(options.body)});
  return new Response(JSON.stringify({content:[{type:'text',text:'Neutrale Tagesübersicht.'}]}),{status:200});
 };
 try{
  const summary=await handleIntegrations(req.clone(),env,ADMIN,'/api/integrations/claude-summary');
  assert.equal(summary.data.anonymized,true);
  assert.equal(body.length,1);
  assert.equal(body[0].url,'https://api.anthropic.com/v1/messages');
  assert.ok(!body[0].payload.messages[0].content.includes('Testkunde'));
  assert.ok(!body[0].payload.messages[0].content.includes('Patient'));
  await assert.rejects(handleIntegrations(req.clone(),env,ADMIN,'/api/integrations/claude-summary'),
   e=>e.status===429);
  assert.equal(body.length,1,'No paid request beyond limit');
 }finally{globalThis.fetch=original}
 sql.close();
});

test('Google status reveals real checkpoint health only to dispatcher, not just OAuth readiness',async()=>{
 const {sql,db}=setup(),stamp='2026-11-19T07:00:00.000Z';
 sql.prepare(`INSERT INTO sync_checkpoints(source,last_attempt_at,last_success_at,status,last_error,items_seen)
  VALUES(?,?,?,?,?,?)`).run('google_calendar_taxi',stamp,stamp,'ok','',37);
 sql.prepare(`INSERT INTO sync_checkpoints(source,last_attempt_at,last_success_at,status,last_error,items_seen)
  VALUES(?,?,?,?,?,?)`).run('google_master',stamp,null,'error','OAuth test failure',0);
 const env={DB:db};
 const admin=await handleIntegrations(path('/api/integrations/status'),env,ADMIN,'/api/integrations/status');
 assert.equal(admin.data.google.taxiCalendar,false,'Credentials still absent, regardless of stale checkpoints');
 assert.equal(admin.data.googleSync.calendar.status,'ok');
 assert.equal(admin.data.googleSync.calendar.lastSuccessAt,stamp);
 assert.equal(admin.data.googleSync.calendar.itemsSeen,37);
 assert.equal(admin.data.googleSync.master.status,'error');
 assert.equal(admin.data.googleSync.master.lastSuccessAt,null);
 assert.equal(JSON.stringify(admin.data).includes('OAuth test failure'),false,'No provider errors or secrets leaked');
 const driver=await handleIntegrations(path('/api/integrations/status'),env,DRIVER,'/api/integrations/status');
 assert.equal(driver.data.google,undefined);
 assert.equal(driver.data.googleSync,undefined);
 sql.close();
});
