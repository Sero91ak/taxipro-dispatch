import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {pullCalendar,pullMaster,isGoogleConfigured,googleOAuthSource} from '../backend/google-sync.js';

function setup(){
  const sql=new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON;'+readFileSync(new URL('../backend/schema.sql',import.meta.url),'utf8'));
  const db={prepare(query){let args=[];return {
    bind(...vals){args=vals;return this},
    async run(){return {meta:{changes:sql.prepare(query).run(...args).changes}}},
    async first(){return sql.prepare(query).get(...args)||null},
    async all(){return {results:sql.prepare(query).all(...args)}}
  }}};
  return {sql,db};
}
test('Unkonfigurierte Google-Konten melden transparenten Status statt still Daten vorzutäuschen',async()=>{
  const {db,sql}=setup();
  const calendar=await pullCalendar(db,{});
  const master=await pullMaster(db,{});
  assert.deepEqual(calendar,{configured:false,seen:0});
  assert.deepEqual(master,{configured:false,created:0});
  const statuses=sql.prepare('SELECT source,status FROM sync_checkpoints ORDER BY source').all();
  assert.deepEqual(statuses.map(x=>[x.source,x.status]),[
    ['google_calendar_taxi','unconfigured'],['google_master','unconfigured']
  ]);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM calendar_imports').get().n,0);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM customers').get().n,0);
});
test('Google-Storno ohne Startdatum markiert alten Termin als storniert',async()=>{
  const {db,sql}=setup();
  const old='2026-11-10T12:00:00.000Z',id='00000000-0000-4000-8000-000000000011';
  sql.prepare(`INSERT INTO calendar_imports(id,source_account,calendar_id,provider_event_id,start_at,event_title,status,match_state,imported_at)
    VALUES(?,'google_taxi','test-calendar','recurrence-item',?,'Testfahrt','confirmed','review',?)`).run(id,old,old);
  const env={
    GOOGLE_TAXI_CLIENT_ID:'test-oauth-client',GOOGLE_TAXI_CLIENT_SECRET:'test-not-real',
    GOOGLE_TAXI_REFRESH_TOKEN:'test-not-real',GOOGLE_TAXI_CALENDAR_ID:'test-calendar'
  };
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url)=>{
    const target=String(url);
    if(target==='https://oauth2.googleapis.com/token')return new Response(JSON.stringify({access_token:'test-only-token'}),{
      status:200,headers:{'Content-Type':'application/json'}
    });
    if(target.startsWith('https://www.googleapis.com/calendar/v3/calendars/test-calendar/events?'))
      return new Response(JSON.stringify({items:[{id:'recurrence-item',status:'cancelled'}]}),{
        status:200,headers:{'Content-Type':'application/json'}
      });
    throw Error('Unexpected external endpoint');
  };
  try{
    const res=await pullCalendar(db,env);
    assert.equal(res.configured,true);
    assert.equal(res.updated,1);
    const event=sql.prepare('SELECT status FROM calendar_imports WHERE id=?').get(id);
    assert.equal(event.status,'cancelled');
    const checkpoint=sql.prepare('SELECT status,items_seen FROM sync_checkpoints WHERE source=?').get('google_calendar_taxi');
    assert.equal(checkpoint.status,'ok');
  }finally{globalThis.fetch=originalFetch;}
});

test('Primary Google OAuth links one account to the selected shared taxi calendar and master sheet',async()=>{
 const {db,sql}=setup();
 const env={
  GOOGLE_PRIMARY_CLIENT_ID:'primary-test-client',
  GOOGLE_PRIMARY_CLIENT_SECRET:'synthetic-private',
  GOOGLE_PRIMARY_REFRESH_TOKEN:'synthetic-private-token',
  GOOGLE_TAXI_CALENDAR_ID:'shared-taxi-calendar',
  GOOGLE_MASTER_SHEET_ID:'selected-master-sheet',
  // Even if an old Taxi OAuth bundle remains, the explicit primary account wins.
  GOOGLE_TAXI_CLIENT_ID:'legacy-client',
  GOOGLE_TAXI_CLIENT_SECRET:'legacy-secret',
  GOOGLE_TAXI_REFRESH_TOKEN:'legacy-token'
 };
 assert.equal(googleOAuthSource(env,'calendar'),'primary');
 assert.equal(googleOAuthSource(env,'sheets'),'primary');
 assert.equal(googleOAuthSource(env,'contacts'),'primary');
 assert.equal(isGoogleConfigured(env,'calendar'),true);
 assert.equal(isGoogleConfigured(env,'sheets'),true);
 assert.equal(isGoogleConfigured(env,'contacts'),true);
 assert.equal(isGoogleConfigured({...env,GOOGLE_MASTER_SHEET_ID:''},'sheets'),false);
 assert.equal(isGoogleConfigured({...env,GOOGLE_TAXI_CALENDAR_ID:''},'calendar'),false);
 const originalFetch=globalThis.fetch;
 const calls=[];
 globalThis.fetch=async(url,opts)=>{
  const target=String(url);calls.push(target);
  if(target==='https://oauth2.googleapis.com/token'){
   const body=new URLSearchParams(String(opts?.body||''));
   assert.equal(body.get('client_id'),'primary-test-client');
   assert.equal(body.get('refresh_token'),'synthetic-private-token');
   return new Response(JSON.stringify({access_token:'synthetic-test-access-token'}),{status:200});
  }
  if(target.startsWith('https://www.googleapis.com/calendar/v3/calendars/shared-taxi-calendar/events?')){
   assert.equal(opts.headers.Authorization,'Bearer synthetic-test-access-token');
   return new Response(JSON.stringify({items:[]}),{status:200});
  }
  throw Error('Unexpected provider request: '+target);
 };
 try{
  const result=await pullCalendar(db,env);
  assert.deepEqual(result,{configured:true,seen:0,updated:0});
  assert.equal(calls.length,2);
  assert.equal(sql.prepare('SELECT status FROM sync_checkpoints WHERE source=?').get('google_calendar_taxi').status,'ok');
 }finally{globalThis.fetch=originalFetch;sql.close();}
});
test('Legacy source-specific OAuth remains compatible without mandatory personal-account secrets',()=>{
 const legacy={GOOGLE_TAXI_CLIENT_ID:'taxi',GOOGLE_TAXI_CLIENT_SECRET:'secret',
   GOOGLE_TAXI_REFRESH_TOKEN:'refresh',GOOGLE_TAXI_CALENDAR_ID:'calendar'};
 assert.equal(googleOAuthSource(legacy,'calendar'),'legacy');
 assert.equal(isGoogleConfigured(legacy,'calendar'),true);
 assert.equal(isGoogleConfigured(legacy,'sheets'),false);
 assert.equal(isGoogleConfigured(legacy,'contacts'),false);
});
