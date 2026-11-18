import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleOps} from '../backend/ops.js';

function createDb(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec('PRAGMA foreign_keys=ON;'+readFileSync(new URL('../backend/schema.sql',import.meta.url),'utf8'));
 const db={
  prepare(sql){
   let args=[];
   return {
    bind(...v){args=v;return this;},
    first(){return sqlite.prepare(sql).get(...args)||null;},
    all(){return {results:sqlite.prepare(sql).all(...args)};},
    run(){return {meta:{changes:sqlite.prepare(sql).run(...args).changes}};}
   };
  }
 };
 return {sqlite,db};
}
test('Google manuelle Sync-Nachfrage prüft BEIDE Quellen einzeln und spart Abrufkontingente',async()=>{
 const {sqlite,db}=createDb(),stamp=new Date().toISOString();
 const admin={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',role:'admin'};
 const request=which=>new Request('https://worker.test/api/ops/sync',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({which})
 });
 sqlite.prepare("INSERT INTO sync_checkpoints(source,last_attempt_at,status) VALUES(?,?,'ok')")
  .run('google_master',stamp);
 await assert.rejects(handleOps(request('both'),{DB:db},admin,'/api/ops/sync'),
  e=>e.status===429&&/Mastertabelle/.test(e.message));
 sqlite.prepare('DELETE FROM sync_checkpoints').run();
 sqlite.prepare("INSERT INTO sync_checkpoints(source,last_attempt_at,status) VALUES(?,?,'ok')")
  .run('google_calendar_taxi',stamp);
 await assert.rejects(handleOps(request('both'),{DB:db},admin,'/api/ops/sync'),
  e=>e.status===429&&/Taxi-Kalender/.test(e.message));
 await assert.rejects(handleOps(request('calendar'),{DB:db},{...admin,role:'driver'},'/api/ops/sync'),
  e=>e.status===403);
 sqlite.close();
});
