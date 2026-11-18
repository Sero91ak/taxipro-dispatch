import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const dispatch=read('dispatch.html'),driver=read('driver.html');
const configs=read('v2/config.js');
const oldSw=read('service-worker.js');
const entryManifest=JSON.parse(read('manifest.json'));
const driverManifest=JSON.parse(read('manifest-driver.json'));
const v2Manifest=JSON.parse(read('v2/manifest.webmanifest'));

function gateScript(html,type){
 const first=html.indexOf('(function(){');
 const begin=html.indexOf('  var ready=',first);
 const ending=type==='dispatch'
   ?html.indexOf('  try{localStorage.setItem',begin)
   :html.indexOf('  var p=new URLSearchParams(location.search)',begin);
 assert.ok(first>=0&&begin>first&&ending>begin,'Existing app entrypoint gate missing');
 return '(function(){'+html.slice(begin,ending)+'})();';
}
function runGate(type,{enabled,api,search=''}) {
 const redirects=[];
 const ctx={
  window:{TAXIPRO_ENABLE_UPGRADED_ENTRIES:enabled,TAXIPRO_API_URL:api},
  location:{search,replace:url=>redirects.push(url)},
  URLSearchParams
 };
 runInNewContext(gateScript(type==='driver'?driver:dispatch,type),ctx,{timeout:1000});
 return redirects;
}
test('Never change installed PWA identities, names or original start links',()=>{
 assert.equal(entryManifest.id,'./dispatch.html');
 assert.match(entryManifest.start_url,/^\.\/dispatch\.html/);
 assert.equal(driverManifest.id,'./driver.html');
 assert.match(driverManifest.start_url,/^\.\/driver\.html/);
 assert.equal(v2Manifest.id,'./app.html');
 assert.match(dispatch,/<link rel="manifest" href="manifest\.json"/);
 assert.match(driver,/<link rel="manifest" href="manifest-driver\.json"/);
});
test('Legacy apps do not redirect without explicit Cloudflare opt-in and HTTPS',()=>{
 for(const role of ['dispatch','driver']){
  for(const [enabled,api] of [
   [false,'https://example.workers.dev'],[false,''],[true,''],[true,'http://example.workers.dev']
  ])assert.deepEqual(runGate(role,{enabled,api}),[],role+' disabled or invalid backend');
 }
 assert.match(configs,/TAXIPRO_API_URL\s*=\s*''/);
 assert.match(configs,/TAXIPRO_ENABLE_UPGRADED_ENTRIES\s*=\s*false/);
});
test('After explicit authorized activation, original entrypoints lead only to same protected TaxiPro workspace',()=>{
 for(const role of ['dispatch','driver']){
  const links=runGate(role,{enabled:true,api:'https://test-company.workers.dev',
     search:'?t=never-expose&pin=not-a-real-pin'});
  assert.deepEqual(links,['v2/app.html']);
  assert.ok(!links[0].includes('never-expose'),'Old login tokens not forwarded');
  assert.ok(!links[0].includes('pin='),'Old PIN not forwarded');
  assert.deepEqual(runGate(role,{enabled:true,api:'https://test-company.workers.dev',
     search:'?install=1'}),[],'Installer retains original PWA identity');
 }
});
test('Original dispatcher/driver features and recovery navigation remain present',()=>{
 assert.match(dispatch,/index\.html\?mode=dispatch&source=pwa/);
 assert.match(driver,/qs\.set\('mode','driver'\)/);
 assert.match(driver,/tp_driver_token/);
 assert.match(dispatch,/window\.openDispatchApp/);
 assert.match(driver,/window\.openDriverApp/);
});
test('Legacy service worker does not persist sensitive URLs or remove the nested workspace cache',()=>{
 for(const field of ["'t'","'token'","'p'","'pin'","'boot'","'gd'","'sy'","'pu'"])
   assert.ok(oldSw.includes('url.searchParams.has('+field+')'),field);
 assert.ok(oldSw.includes("k.startsWith('taxipro-dispatch-')"));
 assert.ok(!oldSw.includes("keys.filter((k) => k !== CACHE)"));
});
