import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleOps} from '../backend/ops.js';
import {createDispatchCenter} from '../v2/master-dashboard.js';

const sqlite=new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON;'+readFileSync(new URL('../backend/schema.sql',import.meta.url),'utf8'));
const db={prepare(sql){let args=[];return {
  bind(...items){args=items;return this;},
  async first(){return sqlite.prepare(sql).get(...args)||null;},
  async all(){return {results:sqlite.prepare(sql).all(...args)};},
  async run(){return {meta:{changes:sqlite.prepare(sql).run(...args).changes}};}
}},async batch(stmts){sqlite.exec('BEGIN IMMEDIATE');try{
 const res=[];for(const x of stmts)res.push(await x.run());
 sqlite.exec('COMMIT');return res;
 }catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const admin={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',role:'admin'};
const driver={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',role:'driver'};
const customer='cccccccc-cccc-4ccc-8ccc-cccccccccccc',stamp='2026-11-18T08:00:00.000Z';
for(const [user,name] of [[admin,'Disponent'],[driver,'Fahrer']]){
 sqlite.prepare("INSERT INTO users(id,username,display_name,role,salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?)")
  .run(user.id,name,name,user.role,'salt','hash',stamp);
}
sqlite.prepare("INSERT INTO customers(id,name,pickup,destination,kind,created_at) VALUES(?,?,?,?,?,?)")
  .run(customer,'Testkunde','','','Rechnungsfahrt',stamp);
sqlite.prepare("INSERT INTO customer_source_links(source,source_account,external_key,customer_id,first_seen_at,last_seen_at) VALUES('master_sheet','google_master',?,?,?,?)")
  .run('K0042',customer,stamp,stamp);
const env={DB:db};
async function api(path,method='GET',body=null,u=admin){
 const req=new Request('https://worker.test'+path,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 const route=await handleOps(req,env,u,new URL(req.url).pathname);
 return route?.data??route;
}
async function denies(p,status){await assert.rejects(p,e=>e.status===status);}
test('Alle berechtigten Geräte lesen dieselben Journalzahlen',async()=>{
 const before=await api('/api/ops/dashboard?date=2026-11-18');
 assert.equal(before.counts.customers,1);
 assert.equal(before.counts.confirmed,0);
 const a=await api('/api/ops/ledger','POST',{customerId:customer,serviceDate:'2026-11-18',
  pickupTime:'08:00',pickup:'Meckenheim',destination:'Bonn',direction:'hin',billingClass:'KTS',rideStatus:'reported'});
 const b=await api('/api/ops/ledger','POST',{customerId:customer,serviceDate:'2026-11-18',
  pickupTime:'16:00',pickup:'Bonn',destination:'Meckenheim',direction:'rueck',billingClass:'KTS',rideStatus:'confirmed',note:'Durch Zentrale geprüft'});
 const after=await api('/api/ops/dashboard?date=2026-11-18');
 assert.equal(after.counts.reported,1);
 assert.equal(after.counts.confirmed,1);
 assert.equal(after.latest.length,2);
 await api('/api/ops/ledger/'+a.id,'PATCH',{rideStatus:'confirmed',note:'Fahrer hat Fahrt bestätigt'});
 const next=await api('/api/ops/dashboard?date=2026-11-18');
 assert.equal(next.counts.confirmed,2);
 const doc=await api('/api/ops/signature-sheet?customerId='+customer+'&from=2026-11-18&to=2026-11-18');
 assert.equal(doc.customerId,'K0042');
 assert.equal(doc.entries.length,2);
});
test('Status und Kundendaten nur für Disponenten, nachvollziehbare Änderungen',async()=>{
 await denies(api('/api/ops/customers','GET',null,driver),403);
 await denies(api('/api/ops/dashboard','GET',null,driver),403);
 await denies(api('/api/ops/signature-sheet?customerId='+customer+'&from=2026-11-18&to=2026-11-18','GET',null,driver),403);
 const resp=await api('/api/ops/customers/'+customer+'/case','PATCH',{
  billing_class:'KTS',prescription_status:'present',approval_status:'pending',
  copayment_status:'unknown',review_note:'Belege vollständig prüfen'});
 assert.equal(resp.ok,true);
 const one=await api('/api/ops/customers/'+customer);
 assert.equal(one.customer.approval_status,'pending');
 assert.equal(one.customer.copayment_status,'unknown');
 const log=sqlite.prepare("SELECT count(*) as n FROM audit WHERE event='customer.case_reviewed'").get();
 assert.equal(log.n,1);
});
test('Kalendereinträge werden nicht ohne manuelle Bestätigung als Fahrt gezählt',async()=>{
 const event='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 sqlite.prepare(`INSERT INTO calendar_imports(id,source_account,calendar_id,provider_event_id,start_at,event_title,
  status,match_state,customer_id,imported_at) VALUES(?,?,?,?,? ,?,'confirmed','review',NULL,?)`)
  .run(event,'taxi','primary','event42','2026-11-18T07:00:00.000Z','Kunde Fahrt',stamp);
 const prior=await api('/api/ops/calendar?state=review');
 assert.equal(prior.entries.length,1);
 await api('/api/ops/calendar/'+event,'PATCH',{action:'link',customerId:customer});
 const rel=await api('/api/ops/calendar?state=matched');
 assert.equal(rel.entries.length,1);
 const linked=await api('/api/ops/customers/'+customer);
 assert.equal(linked.journeys.length,2,'Link erzeugt keine unbestätigte Doppel-Fahrt');
 await denies(api('/api/ops/ledger','POST',{customerId:customer,calendarImportId:event,serviceDate:'2026-11-18',
  pickupTime:'08:00',pickup:'',destination:'Bonn'}),400);
});
test('Einstellungen sind pro Benutzer identisch auf allen Geräten, mit Konfliktschutz',async()=>{
 const fresh=await api('/api/ui-settings');
 assert.equal(fresh.revision,0);
 const saved=await api('/api/ui-settings','PATCH',{revision:0,settings:{density:'compact',nav:'collapsed',lastPage:'cases'}});
 assert.equal(saved.revision,1);
 const fromSecondDevice=await api('/api/ui-settings');
 assert.equal(fromSecondDevice.settings.lastPage,'cases');
 await denies(api('/api/ui-settings','PATCH',{revision:0,settings:{lastPage:'home'}}),409);
 const driverPrefs=await api('/api/ui-settings','GET',null,driver);
 assert.equal(driverPrefs.revision,0);
});
test('Kompaktes Command Center hat Kundenakte, Kalenderprüfung und Monatsjournal',()=>{
 const before=globalThis.document;
 globalThis.document={addEventListener(){}};
 try{
 const ui=createDispatchCenter({
  request:async()=>({}),esc:x=>String(x),toast(){},getUser:()=>admin,
  getState:()=>({customers:[]}),refreshMain(){}
 });
 for(const page of ['home','cases','calendar','ledger','case-detail'])
   assert.ok(ui.view(page).length>100,page);
 assert.match(ui.view('home'),/liveMap/);
 assert.match(ui.view('cases'),/genehmigte Fahrten/);
 assert.match(ui.view('ledger'),/Manuelle Fahrt/);
 }finally{globalThis.document=before;}
});
