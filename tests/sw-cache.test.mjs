import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const script=readFileSync(new URL('../service-worker.js',import.meta.url),'utf8');

async function runFetch(path,{offline=false}={}) {
  const listeners=new Map();
  const putCalls=[];
  const cached={ok:true,from:'old',clone(){return this}};
  const fresh={ok:true,from:'new',clone(){return {...this}}};
  const self={
    addEventListener(type,handler){listeners.set(type,handler);},
    skipWaiting(){},clients:{claim(){return Promise.resolve()}}
  };
  const caches={
    match:async()=>cached,
    open:async()=>({put:async(req,res)=>{putCalls.push({url:req.url,from:res.from});}}),
    keys:async()=>[]
  };
  const context={self,caches,location:{origin:'https://sero91ak.github.io'},URL,Response,
    fetch:async()=>{if(offline)throw Error('offline');return fresh;},console};
  runInNewContext(script,context,{filename:'service-worker.js'});
  let response=null;
  const e={request:{method:'GET',url:'https://sero91ak.github.io/taxipro-dispatch/'+path},
    respondWith(p){response=p;}};
  listeners.get('fetch')(e);
  return {res:await response,putCalls};
}
test('Verkehrsdaten werden neu geladen und nicht aus altem SW-Cache ausgeliefert',async()=>{
  for(const name of ['traffic-module.js','traffic-module.css','traffic-feed.json','index.html']) {
    const {res,putCalls}=await runFetch(name);
    assert.equal(res.from,'new',name+' muss online aktuell sein');
    assert.equal(putCalls.length,1,name+' muss neuen Cache schreiben');
  }
});
test('Offline-Betrieb: vorhandener Cache statt weißer Seite',async()=>{
  for(const name of ['traffic-module.js','traffic-feed.json','driver.html']) {
    const {res}=await runFetch(name,{offline:true});
    assert.equal(res.from,'old');
  }
});
test('Cache-Version für bestehende installierte Geräte erhöht',()=>{
  assert.match(script,/taxipro-dispatch-v32-safety/);
});
