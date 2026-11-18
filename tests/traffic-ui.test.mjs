import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const src=readFileSync(new URL('../traffic-module.js', import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html', import.meta.url),'utf8');

function element(name='div') {
  return {
    name, children:[], handlers:{}, dataset:{}, disabled:false, value:'all',
    textContent:'', className:'', title:'',
    classList:{add(){},remove(){},toggle(){}},
    addEventListener(type,fn){this.handlers[type]=fn;},
    setAttribute(key,val){this[key]=val;},
    replaceChildren(...children){this.children=[...children];},
    append(...children){this.children.push(...children);},
    click(){this.handlers.click?.();},
  };
}

test('Fahrer-Navigation und Module auf derselben Seite',()=>{
  assert.match(html,/data-drv-tab="traffic"/);
  assert.match(html,/id="tp-traffic-map"/);
  assert.match(html,/id="driver-traffic-panel"/);
  assert.match(html,/id="tp-traffic-freshness"/);
  assert.match(html,/id="tp-traffic-radius"/);
  assert.match(html,/data-filter="planned"/);
  assert.match(html,/href="traffic-module.css"/);
  assert.match(html,/src="traffic-module.js"/);
});

test('Zentraler Feed wird in Fahreransicht gerendert; geplante Baustellen getrennt',async()=>{
  const ids=['driver-traffic-panel','tp-traffic-map','tp-traffic-status','tp-traffic-list','tp-traffic-count','tp-traffic-road','tp-traffic-radius','tp-traffic-freshness','tp-traffic-location-status','tp-traffic-locate','tp-traffic-refresh'];
  const els=Object.fromEntries(ids.map(id=>[id,element()]));
  const filters=['all','warning','closure','roadworks','planned'].map(name=>{
    const el=element('button');el.dataset.filter=name;return el;
  });
  const scripts=[];
  const calls=[];
  const window={};
  const document={
    readyState:'loading',hidden:false,
    head:element('head'),
    getElementById:id=>els[id]||null,
    createElement:element,
    querySelector:()=>null,
    querySelectorAll:selector=>selector.includes('data-filter')?filters:[],
    addEventListener:(type,fn)=>scripts.push({type,fn})
  };
  const cache=new Map();
  const localStorage={getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v)};
  const now=new Date().toISOString();
  const events=[
    {id:'A61-warning-1',kind:'warning',autobahn:'A61',title:'Gefahr an Ausfahrt',detail:'Eine Spur gesperrt',coords:[7.03,50.63],future:false},
    {id:'A565-roadworks-2',kind:'roadworks',autobahn:'A565',title:'Geplante Reparatur',detail:'Nächste Woche',coords:[7.12,50.71],future:true},
  ];
  const NativeDate=Date;
  class FakeDate extends NativeDate {
    static offset=0;
    static now(){return NativeDate.now()+this.offset;}
  }
  const fetch=async(url)=>{
    calls.push(String(url));
    if(String(url).includes('traffic-feed.json'))return {ok:true,json:async()=>({schema:1,generatedAt:now,events,partial:false,failedGroups:[],staleGroups:[]})};
    throw new Error('Keine externe API vorgesehen');
  };
  const navigator={geolocation:{getCurrentPosition(success){success({coords:{longitude:7.031,latitude:50.625}});}}};
  const context={window,document,localStorage,location:{href:'https://sero91ak.github.io/taxipro-dispatch/index.html?mode=driver'},navigator,
    fetch,console:{warn(){},log(){}},setTimeout,clearTimeout,setInterval:()=>1,Date:FakeDate,URL,AbortController};
  runInNewContext(src,context,{filename:'traffic-module.js'});
  scripts.filter(x=>x.type==='DOMContentLoaded').forEach(x=>x.fn());
  assert.ok(window.TaxiTraffic);
  window.TaxiTraffic.activate();
  // Die Karte kann im Test mangels WebGL/CDN fehlen; die Vorfallsliste muss unabhängig laden.
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(calls.filter(x=>x.includes('traffic-feed.json')).length,1);
  assert.equal(els['tp-traffic-list'].children.length,1);
  assert.match(els['tp-traffic-list'].children[0].children[1].children[0].textContent,/Gefahr an Ausfahrt/);
  assert.match(els['tp-traffic-status'].textContent,/Amtliche Autobahnmeldungen/);
  filters[4].click();
  assert.equal(els['tp-traffic-list'].children.length,1);
  assert.match(els['tp-traffic-list'].children[0].children[1].children[0].textContent,/Geplant/);
  els['tp-traffic-radius'].handlers.change({target:{value:'10'}});
  assert.equal(els['tp-traffic-list'].children.length,1,'geplantes Ereignis außerhalb von 10 km ausgeblendet');
  assert.match(els['tp-traffic-list'].children[0].textContent,/Für die Auswahl liegen aktuell keine amtlichen/);
  els['tp-traffic-radius'].handlers.change({target:{value:'25'}});
  assert.equal(els['tp-traffic-list'].children.length,1,'geplantes Ereignis innerhalb von 25 km');
  assert.match(els['tp-traffic-list'].children[0].children[1].children[0].textContent,/Geplant/);
  assert.match(els['tp-traffic-location-status'].textContent,/Kein GPS-Versand/);
  FakeDate.offset = 50 * 60 * 1000;
  els['tp-traffic-refresh'].click();
  await new Promise(resolve=>setTimeout(resolve,70));
  assert.equal(els['tp-traffic-freshness'].dataset.state,'stale','veraltete Daten müssen erkennbar sein');
  assert.match(els['tp-traffic-freshness'].textContent,/VERALTET/);
  window.TaxiTraffic.deactivate();
});
