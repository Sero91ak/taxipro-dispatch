import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleCommunity} from '../backend/community.js';
import {createOperations} from '../v2/community-ui.js';

const sqlite=new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON;'+readFileSync(new URL('../backend/schema.sql',import.meta.url),'utf8'));
function dbAdapter() {
 return {async batch(stmts){sqlite.exec('BEGIN IMMEDIATE');try{const a=[];for(const x of stmts)a.push(await x.run());sqlite.exec('COMMIT');return a}catch(e){sqlite.exec('ROLLBACK');throw e}},
  prepare(sql){let binds=[];return {bind(...xs){binds=xs;return this},async first(){return sqlite.prepare(sql).get(...binds)||null},
   async all(){return {results:sqlite.prepare(sql).all(...binds)}},async run(){return {meta:{changes:sqlite.prepare(sql).run(...binds).changes}}}}}};
}
const db=dbAdapter();
const admin={id:'11111111-1111-4111-8111-111111111111',role:'admin'},
 a={id:'22222222-2222-4222-8222-222222222222',role:'driver'},
 b={id:'33333333-3333-4333-8333-333333333333',role:'driver'};
for(const u of [admin,a,b]){
 sqlite.prepare('INSERT INTO users(id,username,display_name,role,salt,password_hash,active,created_at) VALUES(?,?,?,?,?,?,1,?)')
   .run(u.id,u.id.slice(0,8),'Test '+u.role,u.role,'salt','hash',new Date().toISOString());
}
const customer='44444444-4444-4444-8444-444444444444',ride='55555555-5555-4555-8555-555555555555';
sqlite.prepare('INSERT INTO customers(id,name,pickup,destination,kind,created_at) VALUES(?,?,?,?,?,?)')
 .run(customer,'Testkunde','Meckenheim','Bonn','Barfahrt',new Date().toISOString());
sqlite.prepare(`INSERT INTO rides(id,customer_id,driver_id,ride_date,ride_time,pickup,destination,kind,direction,status,assigned_at)
 VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(ride,customer,a.id,'2026-11-18','14:00','Meckenheim','Bonn','Barfahrt','hin','assigned',new Date().toISOString());
const env={DB:db};
const jsonReq=(method,path,data)=>new Request('https://test.invalid'+path,{method,
 headers:{'Content-Type':'application/json'},...data?{body:JSON.stringify(data)}:{}});
const call=(method,path,data,u)=>handleCommunity(jsonReq(method,path,data),env,u,path);
async function fails(p,status){
 await assert.rejects(p,e=>e.status===status);
}
test('Interne Berichte: GPS, Autorisierung, rechtlicher Radar-Filter und Ablauf',async()=>{
 const report=await call('POST','/api/traffic-reports',{category:'jam',road:'A565',description:'Stau am Autobahndreieck',latitude:50.6,longitude:7.03},a);
 assert.equal(report.status,201);
 const row=(await call('GET','/api/traffic-reports',null,b)).reports[0];
 assert.equal(row.road,'A565');
 assert.equal(row.reporter_id,a.id);
 await fails(call('POST','/api/traffic-reports',{category:'jam',description:'Radar an Autobahn',latitude:50.6,longitude:7.03},b),400);
 await fails(call('PATCH','/api/traffic-reports/'+report.data.id,{action:'resolve'},b),403);
 const closed=await call('PATCH','/api/traffic-reports/'+report.data.id,{action:'resolve'},a);
 assert.equal(closed.data.resolved,true);
 assert.equal((await call('GET','/api/traffic-reports',null,a)).reports.length,0);
 const msg=sqlite.prepare('SELECT body FROM messages WHERE sender_id=?').get(a.id);
 assert.match(msg.body,/Verkehr:/);
});
test('Fahrertausch benötigt Fahrerannahme und Disponentenfreigabe',async()=>{
 const s=await call('POST','/api/swaps',{rideId:ride,targetDriverId:b.id,reason:'Tausch mit Kollege'},a);
 assert.equal(s.status,201);
 const target=(await call('GET','/api/swaps',null,b)).swaps[0];
 assert.equal(target.requester_id,a.id);
 await fails(call('PATCH','/api/swaps/'+s.data.id,{action:'approve'},admin),409);
 await fails(call('PATCH','/api/swaps/'+s.data.id,{action:'accept'},a),403);
 assert.equal((await call('PATCH','/api/swaps/'+s.data.id,{action:'accept'},b)).data.status,'accepted');
 assert.equal((await call('PATCH','/api/swaps/'+s.data.id,{action:'approve'},admin)).data.status,'approved');
 const rec=sqlite.prepare('SELECT driver_id FROM rides WHERE id=?').get(ride);
 assert.equal(rec.driver_id,b.id);
});
test('Dateien: privatautorisierte Downloads, keine öffentlichen Links',async()=>{
 const store=new Map();
 env.ATTACHMENTS={
  async put(key,body){store.set(key,body)},
  async get(key){return store.has(key)?{body:new Blob([store.get(key)])}:null},
  async delete(key){store.delete(key)}
 };
 const pdf=new Blob(['%PDF-1.4\nTAXIPRO TEST - NO PERSON DATA'],{type:'application/pdf'});
 const path='/api/attachments';
 const response=await handleCommunity(new Request('https://test.invalid'+path,{method:'POST',
  headers:{'Content-Type':'application/pdf','x-taxipro-recipient':a.id,
   'x-taxipro-filename':encodeURIComponent('test-fahrt.pdf'),'x-taxipro-note':'Pruefung'},body:pdf
 }),env,admin,path);
 assert.equal(response.status,201);
 const id=response.data.id;
 const file=await call('GET','/api/attachments/'+id,null,a);
 assert.ok(file.response instanceof Response);
 assert.equal(file.response.status,200);
 assert.match(await file.response.text(),/TAXIPRO TEST/);
 await fails(call('GET','/api/attachments/'+id,null,b),403);
});
test('UI stellt vertrauliche Funktionen nur innerhalb des Rollenportals dar',()=>{
 const handlers=[];
 const before=globalThis.document;
 globalThis.document={addEventListener:(type,fn)=>handlers.push(type)};
 try{
 const o=createOperations({
  request:async()=>({}),toast(){},esc:s=>String(s),fmt:s=>String(s),
  getSession:()=>'',getBase:()=>'',getMe:()=>a,getDb:()=>({}),rerender:async()=>{}
 });
 const state={trafficReports:[],attachments:[],swaps:[],rides:[],team:[],signatures:[]};
 for(const page of ['traffic','files','swaps','worktime','signatures']){
  assert.ok(o.view(page,state).length>60,page);
 }
 assert.match(o.view('traffic',state),/GPS/);
 assert.match(o.view('files',state),/Empfänger/);
 assert.match(o.view('worktime',state),/Monatsübersicht/);
 }finally{globalThis.document=before}
});
