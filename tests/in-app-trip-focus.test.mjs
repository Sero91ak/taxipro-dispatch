import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createOperations} from '../v2/community-ui.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const app=readFileSync(new URL('../v2/app.js',import.meta.url),'utf8');
function setup(){
 const user={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',role:'driver'};
 const ops=createOperations({
  request:async()=>({}),toast:()=>{},esc,fmt:x=>x,
  getSession:()=>'',getBase:()=>'',getMe:()=>user,getDb:()=>({trafficReports:[]}),
  rerender:async()=>{}
 });
 return {ops,user};
}
test('Existing TaxiPro map shows own selected trip information without external navigation',()=>{
 const {ops,user}=setup();
 const trip={id:'1',driver_id:user.id,ride_date:'2026-11-20',ride_time:'09:30',
  customer_name:'Fiktiver Testkunde',pickup:'Meckenheim <Test>',
  destination:'Klinik Bonn & Haus 2'};
 assert.equal(ops.setTripFocus(trip),true);
 const html=ops.view('traffic',{trafficReports:[]});
 assert.match(html,/Ausgewählter Fahrauftrag/);
 assert.match(html,/Meckenheim &lt;Test&gt;/);
 assert.match(html,/Klinik Bonn &amp; Haus 2/);
 assert.match(html,/keine berechnete Routenführung/);
 assert.match(html,/id="ops-map"/,'Original embedded map preserved');
 assert.doesNotMatch(html,/<iframe/,'No external traffic embedded as iframe');
 assert.doesNotMatch(app,/google\.com\/maps\/dir\/\?api=1/,'Driver navigation does not jump to Google Maps');
});
test('Other driver trips are denied and focus is cleared on logout',()=>{
 const {ops,user}=setup();
 const own={id:'2',driver_id:user.id,ride_date:'2026-11-20',ride_time:'10:00',
  pickup:'Meine Startadresse',destination:'Mein Ziel'};
 assert.equal(ops.setTripFocus(own),true);
 assert.equal(ops.setTripFocus({...own,driver_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  pickup:'Fremde Adresse'}),false);
 const html=ops.view('traffic',{trafficReports:[]});
 assert.match(html,/Meine Startadresse/);
 assert.doesNotMatch(html,/Fremde Adresse/);
 assert.equal(ops.setTripFocus(null),false);
 assert.doesNotMatch(ops.view('traffic',{trafficReports:[]}),/Meine Startadresse/);
});
