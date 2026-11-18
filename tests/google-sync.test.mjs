import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {pullCalendar,pullMaster} from '../backend/google-sync.js';

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
