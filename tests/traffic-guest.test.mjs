import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = name => readFileSync(new URL('../'+name, import.meta.url),'utf8');
const guest=read('traffic.html');
const driver=read('index.html');
const home=read('home.html');
const sw=read('service-worker.js');
const trafficJs=read('traffic-module.js');

test('Traffic Gastmodus hat alle für das öffentliche Verkehrsmodul notwendigen DOM-Knoten',()=>{
  for(const id of ['driver-traffic-panel','tp-traffic-status','tp-traffic-freshness','tp-traffic-road','tp-traffic-radius','tp-traffic-locate','tp-traffic-refresh','tp-traffic-map','tp-traffic-filters','tp-traffic-count','tp-traffic-list','tp-traffic-location-status']){
    assert.match(guest,new RegExp('id="'+id+'"'),id+' fehlt');
  }
  for(const mode of ['all','warning','closure','roadworks','planned'])
    assert.match(guest,new RegExp('data-filter="'+mode+'"'),mode+' fehlt');
  assert.match(guest,/traffic-module\.css/);
  assert.match(guest,/traffic-module\.js/);
  assert.match(guest,/TaxiTraffic\.activate\(\)/);
  assert.match(trafficJs,/window\.TaxiTraffic = \{ activate, deactivate \}/);
});

test('Gastseite verwendet nur öffentliche Daten und keine Fahrer-Authentifizierung',()=>{
  assert.doesNotMatch(guest,/localStorage|tp_driver_|tp_public_sync_url|driverLoginByToken|driverLoginByPin|GoogleDriveSync|\bfetchGoogleDriveSync\b/);
  assert.doesNotMatch(guest,/series-system\.js|backend\/worker\.js|taxi-meckenheim-app\.html|<iframe/);
  assert.match(guest,/href="\.\/driver\.html"/);
  assert.match(guest,/href="\.\/home\.html"/);
  assert.match(guest,/Fahrtaufträge, Personen- und Mitarbeiterdaten/);
});

test('Fahrer-PIN bleibt für Fahrten aktiv; Verkehrs-Gastzugang ist leicht auffindbar',()=>{
  assert.match(driver,/id="driver-login"/);
  assert.match(driver,/function driverLoginByPin\(/);
  assert.match(driver,/href="\.\/traffic\.html"/);
  assert.match(home,/href="traffic\.html"/);
  assert.match(home,/Verkehrskarte · Ohne PIN/);
});

test('PWA-Cache berücksichtigt Gastseite und erneuerte Versionsnummer',()=>{
  assert.match(sw,/taxipro-dispatch-v32-safety/);
  assert.match(sw,/'\.\/traffic\.html'/);
  assert.match(sw,/url\.pathname\.endsWith\('\.html'\)/);
});
