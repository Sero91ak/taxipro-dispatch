import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeed, normalizeIncident, parseIncidentCoord } from '../scripts/update-traffic-feed.mjs';

const when = new Date('2026-11-18T12:00:00.000Z');
const item = (lat='50.625',lng='7.031',future=false)=>({
  identifier:'ref-1',title:'Achtung Fahrbahn',description:['Fahrbahn eingeschränkt'],
  coordinate:{lat,long:lng},future
});

test('alle 18 amtlichen Quellen; valide Koordinaten und Ankündigungen',async()=>{
  const calls=[];
  const feed=await buildFeed({ now:when, previous:null, fetchGroup:async(road,kind)=>{
    calls.push(road+'/'+kind);
    const raw=road==='A61'&&kind==='warning'
      ? [item(),item('52.520','13.405'),{identifier:'bad',coordinate:{lat:'n/a',long:'7'},title:'Ungültig'}]
      : road==='A565'&&kind==='roadworks' ? [item('50.70','7.12',true)] : [];
    return raw.map((x,i)=>normalizeIncident(x,road,kind,i)).filter(Boolean);
  }});
  assert.equal(calls.length,18);
  assert.equal(feed.events.length,2);
  assert.equal(feed.events.find(x=>x.autobahn==='A565').future,true);
  assert.deepEqual(feed.events.find(x=>x.autobahn==='A61').coords,[7.031,50.625]);
  assert.equal(feed.partial,false);
  assert.deepEqual(feed.failedGroups,[]);
  assert.equal(feed.generatedAt,when.toISOString());
  assert.ok(feed.events.every(x=>x.observedAt===when.toISOString()));
});

test('teilweise ausgefallene Quellen: frische Vorlaufdaten, keine dauerhafte Veralterung',async()=>{
  const old={generatedAt:new Date(when-15*60*1000).toISOString(),
    events:[{id:'A61:warning:prev',autobahn:'A61',kind:'warning',coords:[7.03,50.62],
      title:'Altmeldung',detail:'',future:false,observedAt:new Date(when-15*60*1000).toISOString()}]};
  const fn=async(road,kind)=>{if(road==='A61'&&kind==='warning')throw Error('Unterbrochen');return []};
  const first=await buildFeed({now:when,previous:old,fetchGroup:fn});
  assert.equal(first.partial,true);
  assert.deepEqual(first.failedGroups,['A61/warning']);
  assert.deepEqual(first.staleGroups,['A61/warning']);
  assert.equal(first.events.length,1);
  assert.equal(first.events[0].observedAt,old.events[0].observedAt,'Beobachtungszeit erhalten');
  const muchLater=new Date(when.getTime()+100*60*1000);
  const second=await buildFeed({now:muchLater,previous:first,fetchGroup:fn});
  assert.equal(second.events.length,0,'alte Meldungen müssen verschwinden');
  assert.deepEqual(second.staleGroups,[]);
});

test('vollständiger API-Ausfall führt zu Fehler, keine Schein-Aktualisierung',async()=>{
  await assert.rejects(
    buildFeed({now:when,previous:null,fetchGroup:async()=>{throw Error('Offline')}}),
    /Alle amtlichen Quellen fehlgeschlagen/
  );
});

test('Freitext wird begrenzt und ASCII-Kontrollzeichen entfernt',async()=>{
  const feed=await buildFeed({now:when,previous:null,fetchGroup:async(road,kind)=>
    road==='A61'&&kind==='warning'?[normalizeIncident({...item(),title:'x'.repeat(900)+'\x01',description:['A\nB']},road,kind,0)]:[]});
  assert.equal(feed.events[0].title.length,180);
  assert.equal(feed.events[0].detail,'A B');
});
