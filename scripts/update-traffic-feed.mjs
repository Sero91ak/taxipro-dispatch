/**
 * TaxiPro: zentraler, kostenloser Verkehrsdaten-Abruf.
 * Läuft auf GitHub Actions; keine API-Keys oder bezahlten Endpunkte.
 * Veröffentlicht nur amtliche, öffentliche Verkehrsvorfälle (keine Blitzer).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BASE = 'https://verkehr.autobahn.de/o/autobahn';
const ROADS = ['A61','A565','A555','A59','A4','A3'];
const KINDS = ['warning','closure','roadworks'];
const BOUNDS = { minLng:6.25,maxLng:7.85,minLat:50.22,maxLat:51.28 };
const FILE = new URL('../traffic-feed.json', import.meta.url);
const NOW = new Date();
const MAX_PREVIOUS_AGE_MS = 90 * 60 * 1000;
const LIMIT = 4;

function coord(raw) {
  const c = raw?.coordinate ?? raw;
  let lat = Number(c?.lat ?? c?.latitude);
  let lng = Number(c?.long ?? c?.lng ?? c?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const p = String(raw?.point ?? '').split(',');
    lng = Number(p[0]); lat = Number(p[1]);
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lng < BOUNDS.minLng || lng > BOUNDS.maxLng || lat < BOUNDS.minLat || lat > BOUNDS.maxLat) return null;
  return [lng,lat];
}
function clean(value,max=320) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}
function normalize(item,road,kind,index) {
  const coords = coord(item);
  if (!coords) return null;
  const title = clean(item.title || item.subtitle || (kind === 'roadworks' ? 'Baustelle' : 'Verkehrshinweis'),180);
  const d = Array.isArray(item.description) ? item.description.join(' ') : item.description;
  const detail = clean(d || (Array.isArray(item.footer) ? item.footer.join(' ') : item.subtitle),360);
  const id = clean(item.identifier || `${road}:${kind}:${index}:${coords.join(':')}`,160);
  return { id:road+':'+kind+':'+id, autobahn:road, kind, coords, title, detail, future:item.future===true };
}
export { normalize as normalizeIncident, coord as parseIncidentCoord };
function oldFeed() {
  try { return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : null; }
  catch { return null; }
}
async function fetchRoad(road,kind) {
  const timeout = AbortSignal.timeout(12000);
  const url = BASE+'/'+road+'/services/'+kind;
  const response = await fetch(url, {
    signal:timeout,
    headers:{Accept:'application/json','User-Agent':'TaxiPro-TrafficFeed/1.0 (https://github.com/Sero91ak/taxipro-dispatch)'}
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} (${road}/${kind})`);
  const json = await response.json();
  if (!Array.isArray(json?.[kind])) throw new Error('Unerwartetes Datenformat '+road+'/'+kind);
  return json[kind].map((item,i)=>normalize(item,road,kind,i)).filter(Boolean);
}
export async function buildFeed({ fetchGroup=fetchRoad, previous=oldFeed(), now=NOW }={}) {
  const tasks = ROADS.flatMap(road => KINDS.map(kind => ({road,kind,key:road+'/'+kind})));
  const output = new Array(tasks.length);
  let next = 0;
  async function worker() {
    for(;;) {
      const i=next++;
      if (i >= tasks.length) return;
      const t=tasks[i];
      try { output[i] = {ok:true, key:t.key, events:await fetchGroup(t.road,t.kind)}; }
      catch (error) { output[i] = {ok:false,key:t.key,error:clean(error?.message || error,140)}; }
    }
  }
  await Promise.all(Array.from({length:LIMIT},worker));
  const failures=output.filter(r=>!r.ok);
  if (failures.length === tasks.length) throw new Error('Alle amtlichen Quellen fehlgeschlagen: '+failures[0]?.error);
  const previousTime=Date.parse(previous?.generatedAt || '');
  const canFallback=Number.isFinite(previousTime) && now.getTime()-previousTime <= MAX_PREVIOUS_AGE_MS && Array.isArray(previous?.events);
  const known = new Map();
  if(canFallback) for(const x of previous.events) {
    if(!x?.autobahn || !x?.kind || !Array.isArray(x.coords)) continue;
    const key=x.autobahn+'/'+x.kind;
    if(!known.has(key)) known.set(key,[]);
    known.get(key).push(x);
  }
  const staleGroups=[];
  const events=[];
  for(const outcome of output) {
    if(outcome.ok) events.push(...outcome.events.map(x=>({...x,observedAt:now.toISOString()})));
    else if(known.has(outcome.key)) {
      const recent=known.get(outcome.key).filter(x=>{
        const seen=Date.parse(x.observedAt || previous.generatedAt);
        return Number.isFinite(seen) && now.getTime()-seen <= MAX_PREVIOUS_AGE_MS;
      });
      if(recent.length){events.push(...recent);staleGroups.push(outcome.key);}
    }
  }
  const unique = new Map();
  for(const e of events) unique.set(e.id,e);
  return {
    schema:1,
    source:'Autobahn GmbH des Bundes',
    generatedAt:now.toISOString(),
    region:'Meckenheim · Bonn · Rhein-Sieg · Köln',
    roads:ROADS,
    intervals:'Geplanter Abruf alle 15 Minuten; GitHub Actions kann sich verzögern.',
    partial:failures.length>0,
    failedGroups:failures.map(x=>x.key),
    staleGroups,
    events:[...unique.values()].sort((a,b)=>a.autobahn.localeCompare(b.autobahn) || a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title))
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const feed=await buildFeed();
    writeFileSync(FILE,JSON.stringify(feed,null,2)+'\n','utf8');
    console.log('Amtliche Meldungen: '+feed.events.length+' / Fehlende Quellen: '+feed.failedGroups.length+' / Übernommen aus Vorlauf: '+feed.staleGroups.length);
  } catch(error) {
    console.error('Verkehrsdaten konnten nicht aktualisiert werden:',error.message);
    process.exitCode=1;
  }
}
