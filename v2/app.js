import {createOperations} from './community-ui.js';
import {createDispatchCenter} from './master-dashboard.js';
/* TaxiPro Dispatch 2.0 – production shell (Cloudflare Worker API required)
 * All authorization is enforced on the server. This UI deliberately does not
 * pretend to protect driver data by hiding menu items.
 */
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const apiBase = String(window.TAXIPRO_API_URL || '').replace(/\/$/,'');
let auth = sessionStorage.getItem('taxipro_v2_session') || '', me=null, db=null, page='home', map=null,watch=null,locationLast=0,poll=null, calendarDate=todaySafe(), rideFilter='all';
function todaySafe(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
let dispatchCustomer=null,dispatchRoutes=[],dispatchCustomerSeq=0;
const ops=createOperations({
  request,toast,esc,fmt,getSession:()=>auth,getBase:()=>apiBase,getMe:()=>me,getDb:()=>db,
  rerender:async()=>{await refresh();render();}
});
const office=createDispatchCenter({
  request,esc,toast,getUser:()=>me,getState:()=>db,refreshMain:page=>{render(page);if(me?.role==='admin')office.openPage(page);}
});
const APIOK=/^https:\/\/[^/]+/.test(apiBase);
const now = () => new Date();
const today = () => todaySafe();
const fmt = d => d ? new Date(d).toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'}) : '—';
const duration = ms => {const n=Math.max(0,Math.floor(ms/1000));return [Math.floor(n/3600),Math.floor(n/60)%60,n%60].map(v=>String(v).padStart(2,'0')).join(':')};
const statusText={assigned:'Zugewiesen',accepted:'Angenommen',done:'Abgeschlossen',cancelled:'Storniert'};
const badge = s=>'<span class="pill-status '+esc(s)+'">'+esc(statusText[s]||s)+'</span>';
const title=(name,subtitle,action='')=>'<div class="head"><div><h2>'+name+'</h2><p>'+subtitle+'</p></div>'+action+'</div>';
const card=(name,body,header='')=>'<section class="card"><div class="card-title"><b>'+name+'</b>'+header+'</div>'+body+'</section>';
const field=(label,id,type='text',val='',other='')=>'<div class="field"><label for="'+id+'">'+esc(label)+'</label><input id="'+id+'" type="'+type+'" value="'+esc(val)+'" '+other+' required></div>';
const opts = arr=>arr.map(([id,name])=>'<option value="'+esc(id)+'">'+esc(name)+'</option>').join('');
const table=(cols,rows)=>'<div class="table-wrap"><table class="tbl"><thead><tr>'+cols.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
const row=(values)=>'<tr>'+values.map(x=>'<td>'+x+'</td>').join('')+'</tr>';
function toast(msg){const el=$('toast');el.textContent=msg;el.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>el.style.display='none',4000)}
function notice(text){return '<div class="noticebox">'+text+'</div>'}
async function request(path,method='GET',payload){
 if(!APIOK)throw new Error('API noch nicht eingerichtet.');
 let result;try{result=await fetch(apiBase+path,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},...(payload?{body:JSON.stringify(payload)}:{}),cache:'no-store'})}catch{throw new Error('Keine Verbindung zum Backend.')}let data;try{data=await result.json()}catch{throw new Error('Ungültige Serverantwort.')}
 if(!result.ok){if(result.status===401&&auth){logout(false);throw new Error('Sitzung abgelaufen. Bitte erneut anmelden.')}throw new Error(data.error||'Serverfehler '+result.status)}return data;
}
function loggedIn(){return !!me&&!!auth}
function loginView(){ $('loginScreen').classList.add('active');$('appScreen').classList.remove('active');$('setupNotice').textContent=APIOK?'Sichere API konfiguriert. Bitte mit deinem Konto anmelden.':'Der geschützte Backend-Dienst ist noch nicht eingerichtet. Die sichere Anmeldung ist daher absichtlich gesperrt. Die interaktive Design-Demo kannst du bereits öffnen.';$('loginForm').querySelector('button').disabled=!APIOK }
function logout(remote=true){if(remote&&auth)request('/api/logout','POST',{}).catch(()=>{});auth='';me=null;db=null;sessionStorage.removeItem('taxipro_v2_session');stopGPS();clearInterval(poll);poll=null;loginView()}
async function signIn(){const username=$('user').value.trim(),password=$('password').value;$('loginError').textContent='';try{const a=await request('/api/login','POST',{username,password});auth=a.token;sessionStorage.setItem('taxipro_v2_session',auth);me=a.user;$('password').value='';await init()}catch(e){$('loginError').textContent=e.message;auth='';sessionStorage.removeItem('taxipro_v2_session')}}
let syncBusy=false,unsavedUpdates=false;
async function init(){
 try{
  me=await request('/api/me');
  await refresh();
  await office.loadPrefs();
  page=office.getPrefs().lastPage||'home';
  $('loginScreen').classList.remove('active');$('appScreen').classList.add('active');
  $('sidebarName').textContent=me.displayName+' · '+me.username;
  $('roleLabel').textContent=me.role==='admin'?'DISPONENTENZENTRALE':'MEIN FAHRERBEREICH';
  render();
  if(!poll)poll=setInterval(()=>{if(document.visibilityState==='visible'&&loggedIn())void syncLive();},45000);
 }catch(e){logout(false);$('loginError').textContent=e.message;}
}
function isEditingNow(){
 const active=document.activeElement;
 return !!document.querySelector('dialog[open]') ||
   !!document.querySelector('#pageView form[data-dirty="true"]') ||
   !!(active&&active.matches('input,textarea,select,[contenteditable="true"]')&&active.closest('#pageView'));
}
document.addEventListener('input',e=>{
 const form=e.target.closest?.('#pageView form');
 if(form)form.dataset.dirty='true';
});
function connectionInterrupted(message){
 if(!loggedIn())return;
 $('serverStatus').textContent='● VERBINDUNG UNTERBROCHEN';
 $('serverStatus').setAttribute('data-connection','offline');
 $('syncLabel').textContent='Letzter Stand – '+String(message||'Netzwerk prüfen').slice(0,80);
}
async function syncLive(){
 if(syncBusy||!loggedIn())return;
 syncBusy=true;
 const previousState=JSON.stringify(db);
 try{
  await refresh();
  const changed=previousState!==JSON.stringify(db);
  if(changed||unsavedUpdates){
   if(isEditingNow()){
    unsavedUpdates=true;
    $('syncLabel').textContent='Neuer Stand verfügbar · nach Speichern / Seitenwechsel';
   }else{
    unsavedUpdates=false;render();
   }
  }else if(!isEditingNow()&&me.role==='admin'&&office.eligible(page)){
   // Calendar and customer files are read on a separate authenticated API.
   // Refresh those cards without recreating the entire navigation or GPS map.
   await office.mount(page);
  }
 }catch(e){connectionInterrupted(e.message);}
 finally{syncBusy=false;}
}
window.addEventListener('online',()=>{if(loggedIn())void syncLive();});
window.addEventListener('offline',()=>connectionInterrupted('Internetverbindung fehlt'));
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState==='visible'&&loggedIn())void syncLive();
});
async function refresh(){
 const previous=db;const current=await request('/api/state');
 db=current;
 if(me)ops.onRefresh(previous,db,me);
 $('syncLabel').textContent='Synchronisiert: '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
 $('serverStatus').textContent='● VERBUNDEN';
 $('serverStatus').setAttribute('data-connection','online');
}
function menu(){
 const admin=[
  ['disposition','DISPOSITION',[
   ['home','◈','Dashboard'],['dispatch','↗','Auftrag erstellen'],['daily','▦','Tageskontrolle'],
   ['rides','▤','Fahreraufträge'],['series','↻','Serienfahrten']]],
  ['kunden','KUNDEN & ABRECHNUNG',[
   ['cases','♙','Kundenakten'],['ledger','▤','Fahrtenjournal'],
   ['calendar','▦','Kalenderprüfung'],['import-review','◎','Dublettenprüfung'],['customers','＋','Kunden hinzufügen']]],
  ['team','TEAM & ZEITEN',[
   ['drivers','♟','Fahrer verwalten'],['shifts','◷','Schichten'],['worktime','◴','Zeitauswertung'],['swaps','⇄','Fahrertausch']]],
  ['kommunikation','KOMMUNIKATION',[
   ['traffic','⚠','Verkehrskarte'],['chat','✉','Nachrichten'],['files','⇧','Dokumente'],['signatures','✍','Unterschriften']]]
 ];
 const driver=[
  ['fahrten','MEIN DIENST',[
   ['home','▦','Meine Fahrten'],['shifts','◷','Schicht & Pause'],['worktime','◴','Meine Arbeitszeiten']]],
  ['unterwegs','UNTERWEGS',[
   ['traffic','⚠','Verkehr'],['swaps','⇄','Fahrertausch']]],
  ['community','MITARBEITERBEREICH',[
   ['chat','✉','Nachrichten'],['files','⇧','Dokumente'],['signatures','✍','Unterschriften']]]
 ];
 const list=me?.role==='admin'?admin:driver,nav=$('appNav');
 if(!nav)return;
 const selected=page==='case-detail'?'cases':page;
 const scroll=nav.scrollTop;
 nav.setAttribute('aria-label',me.role==='admin'?'Disponenten-Navigation':'Fahrer-Navigation');
 nav.innerHTML=list.map(([key,heading,links])=>
  '<div class="nav-group" data-section="'+key+'"><div class="nav-section-title">'+esc(heading)+'</div>'+
  links.map(([target,icon,label])=>
   '<button type="button" class="'+(selected===target?'active':'')+'" data-page="'+target+
   '" aria-label="'+esc(label)+'"'+(selected===target?' aria-current="page"':'')+'>'+
   '<span class="ico" aria-hidden="true">'+esc(icon)+'</span><span class="nav-text">'+esc(label)+'</span></button>'
  ).join('')+'</div>').join('');
 nav.scrollTop=scroll;
}
function render(p){if(p)page=p;if(!loggedIn()||!db)return;if(map&&typeof map.remove==='function'){map.remove();map=null}if(me.role==='driver'&&!['home','shifts','chat','traffic','files','swaps','worktime','signatures'].includes(page))page='home';$('crumb').textContent=page;$('heading').textContent=({home:me.role==='admin'?'Flottenübersicht':'Meine Aufträge',dispatch:'Disposition',rides:'Fahrtenjournal',customers:'Kundenstamm',drivers:'Fahrerverwaltung',shifts:'Arbeitszeiten',chat:'Messenger',daily:'Tageskontrolle',series:'Serienfahrten',cases:'Kundenakten',calendar:'Kalenderprüfung','import-review':'Dublettenprüfung',ledger:'Fahrtenjournal', 'case-detail':'Kundenakte',traffic:'Verkehrszentrale',files:'Dokumente',swaps:'Fahrertausch',worktime:'Arbeitszeitberichte',signatures:'Unterschriften'})[page]||'TaxiPro';menu();let html;try{
 html=me.role==='admin'&&office.eligible(page)
   ?office.view(page)
   :({home:me.role==='admin'?adminHome:driverHome,dispatch:dispatch,rides:rides,customers:customers,drivers:drivers,shifts:shifts,chat:chat,daily:daily,series:series})[page]?.()||ops.view(page,db);
}catch(e){html=notice('Anzeige konnte nicht geladen werden: '+esc(e.message))}
$('pageView').innerHTML=page==='chat'?html+ops.chatExtra(db):html;
ops.mount(page).catch(e=>toast(e.message));
if(me.role==='admin'&&office.eligible(page))office.mount(page).catch(e=>toast(e.message));
if(page==='home'&&me.role==='admin')setTimeout(buildMap,30);if(page==='dispatch'){dispatchCustomer=null;dispatchRoutes=[];if($('rc')?.value)loadDispatchCustomer($('rc').value);}if(page==='series')bindSeries();if(page==='shifts'&&me.role==='admin')bindCorrection();if(page==='chat'){let el=$('messages');if(el)el.scrollTop=el.scrollHeight}}
function activeShift(uid=me.id){return (db.shifts||[]).find(s=>s.driver_id===uid&&!s.ended_at)}
function sHours(uid,days){const recent=Date.now()-days*86400000;return (db.shifts||[]).filter(s=>(!uid||s.driver_id===uid)&&Date.parse(s.started_at)>=recent).reduce((sum,s)=>sum+(Date.parse(s.ended_at||new Date().toISOString())-Date.parse(s.started_at)),0)}
function adminHome(){const drivers=db.drivers||[],rides=db.rides||[],active=(db.shifts||[]).filter(s=>!s.ended_at),positions=db.positions||[];return title('Heute im Blick','Disposition, Fahrzeuge und Fahrer in einer Oberfläche','<div class="actions"><button class="btn" id="backupExport">⇩ Export</button><button class="btn gold" data-page="dispatch">+ Auftrag anlegen</button></div>')+
 '<div class="stats"><div class="stat"><small>Fahrer im Dienst</small><strong>'+active.length+' / '+drivers.length+'</strong><span>Schicht läuft</span></div><div class="stat"><small>Fahrten heute</small><strong>'+rides.filter(r=>r.ride_date===today()).length+'</strong><span>Geplant und gefahren</span></div><div class="stat"><small>Angenommene Fahrten</small><strong>'+rides.filter(r=>r.status==='accepted').length+'</strong><span>Aktuell offen</span></div><div class="stat"><small>Erforderliche Unterschriften</small><strong>'+rides.filter(r=>r.signature_required&&r.status!=='cancelled').length+'</strong><span>Unterschriftenerfassung noch nicht aktiv</span></div></div>'+
 '<div class="main-grid">'+card('Flottenkarte · Live-Meldungen','<div id="liveMap" class="map-live"></div><div class="card-body"><span class="small">Nur letzter gemeldeter Standort mit Zeitstempel. Positionsübertragung nur bei geöffneter Fahrer-PWA und aktivem GPS.</span></div>','<span class="small">OpenFreeMap</span>')+
 card('Fahrerübersicht','<div class="fleet">'+drivers.map(d=>{const isWorking=active.some(s=>s.driver_id===d.id),pos=positions.find(p=>p.driver_id===d.id),busy=rides.some(r=>r.driver_id===d.id&&r.status==='accepted'),stale=pos&&Date.now()-Date.parse(pos.reported_at)>120000;return '<div class="fleet-item"><div class="avatar">🚕</div><div class="grow"><div class="primary">'+esc(d.display_name)+'</div><div class="secondary">'+(!isWorking?'Nicht im Dienst':busy?'Besetzt':'Im Dienst · frei')+' · '+(pos?(stale?'Letzte Position ':'GPS-Meldung ')+fmt(pos.reported_at):'Keine GPS-Meldung')+'</div></div></div>'}).join('')+'</div>')+'</div>'+card('Nächste Aufträge',table(['Kunde','Fahrer','Zeit','Status'],rides.slice(0,10).map(r=>row([esc(r.customer_name),esc(r.driver_name),esc(r.ride_date+' '+r.ride_time),badge(r.status)]))))}
function buildMap(){if(map&&typeof map.remove==='function'){map.remove();map=null}const el=$('liveMap');if(!el)return;const positions=db.positions||[];if(!window.maplibregl){el.textContent='Kartenbibliothek nicht verfügbar.';return}try{map=new maplibregl.Map({container:el,style:'https://tiles.openfreemap.org/styles/liberty',center:[7.032,50.624],zoom:12,pitch:36});map.addControl(new maplibregl.NavigationControl(),'top-right');positions.forEach(p=>{const age=Date.now()-Date.parse(p.reported_at),stale=age>120000;const mark=document.createElement('div');mark.textContent='🚕';mark.style.cssText='font-size:22px;background:'+(stale?'#8c96a7':'#51d6ac')+';border:2px solid white;border-radius:12px;padding:4px';new maplibregl.Marker({element:mark}).setLngLat([p.longitude,p.latitude]).setPopup(new maplibregl.Popup().setText(p.driver_name+' · '+(stale?'Letzter Standort: ':'Aktuelle Meldung: ')+fmt(p.reported_at))).addTo(map)})}catch(e){el.textContent='Karte konnte nicht geladen werden.'}}
function dispatch(){return title('Auftrag zuweisen','Neuer Fahrauftrag auf das Smartphone des Fahrers')+notice('Aufträge werden in der Datenbank gespeichert. Die Fahrer-App prüft bei geöffneter App regelmäßig neue Zuweisungen. Echte Push-Nachrichten sind noch nicht eingerichtet.')+card('Fahrt anlegen','<div class="card-body"><form id="newRideForm" class="form-grid">'+
'<div class="field wide"><label for="rcSearch">Kunde nach Name oder Kunden-ID suchen</label>'+
'<div class="center-lookup-row"><input id="rcSearch" type="search" autocomplete="off" placeholder="Name oder Kundennummer (K0001)" maxlength="70">'+
'<button type="button" class="btn" data-find-customer="1">Suchen</button></div>'+
'<div class="small">Auch Kunden außerhalb der ersten angezeigten Stammdatensätze suchen.</div></div>'+
'<div class="field"><label for="rc">Kunde</label><select id="rc" required>'+opts((db.customers||[]).map(c=>[c.id,c.name]))+'</select></div><div class="field"><label>Fahrer</label><select id="rd" required>'+opts((db.drivers||[]).filter(d=>d.active).map(d=>[d.id,d.display_name]))+'</select></div><div class="field"><label>Fahrtart</label><select id="rk"><option>Krankenfahrt</option><option>Rechnungsfahrt</option><option>Serienfahrt</option><option>Barfahrt</option></select></div><div class="field"><label>Fahrtrichtung</label><select id="rdir"><option value="hin">Hinfahrt</option><option value="rueck">Rückfahrt</option></select></div><div class="field wide"><label for="rcRoute">Strecke dieses Kunden</label>'+
'<select id="rcRoute"><option value="">Stammadresse / Strecke manuell wählen</option></select>'+
'<div id="routeHint" class="small">Mehrere Krankenhausziele können über die Kundenakte hinterlegt werden.</div></div>'+field('Abholadresse','rfrom')+field('Zieladresse','rto')+field('Datum','rdate','date',today())+field('Abholzeit','rtime','time','12:30')+'<div class="field wide"><label><input type="checkbox" id="rsig" style="width:auto"> Unterschrift erforderlich (wird nur vorgemerkt)</label></div><div class="field wide"><button class="btn gold">↗ Auftrag zuweisen</button></div></form></div>')}
function fillCustomer(){
 const rc=$('rc');if(!rc)return;
 const c=dispatchCustomer?.id===rc.value?dispatchCustomer:(db.customers||[]).find(c=>c.id===rc.value);
 if(!c)return;
 const option=dispatchRoutes.find(r=>r.id===$('rcRoute')?.value);
 const from=(option?.pickup||c.pickup||'').trim(),to=(option?.destination||c.destination||'').trim();
 const returnTrip=$('rdir')?.value==='rueck';
 $('rfrom').value=returnTrip?to:from;
 $('rto').value=returnTrip?from:to;
 const kind=option?.billing_class==='RE'?'Rechnungsfahrt':option?.billing_class==='KTS'?'Krankenfahrt':
   option?.billing_class==='private'?'Barfahrt':c.kind;
 if(['Krankenfahrt','Rechnungsfahrt','Serienfahrt','Barfahrt'].includes(kind))$('rk').value=kind;
 $('rsig').checked=!!c.signature_required;
 const hint=$('routeHint');
 if(hint)hint.textContent=option
   ?'Gewählte Strecke: '+option.label+(from&&to?'':' · Start oder Ziel bitte ergänzen')
   :from&&to?'Stammstrecke ausgewählt.': 'Bitte Start- und Zieladresse sorgfältig ergänzen.';
}
async function loadDispatchCustomer(customerId){
 if(!customerId||!$('rc'))return;
 const seq=++dispatchCustomerSeq;
 try{
  const detail=await request('/api/ops/customers/'+encodeURIComponent(customerId));
  if(seq!==dispatchCustomerSeq||$('rc')?.value!==customerId)return;
  dispatchCustomer=detail.customer;dispatchRoutes=detail.routes||[];
  const selector=$('rcRoute');
  if(selector){
   selector.innerHTML='<option value="">Stammadresse / Strecke manuell wählen</option>'+
     dispatchRoutes.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.label)+' · '+esc(r.destination||'Ziel fehlt')+'</option>').join('');
   const complete=dispatchRoutes.find(r=>r.is_primary&&r.pickup&&r.destination)||
     dispatchRoutes.find(r=>r.pickup&&r.destination);
   if(complete)selector.value=complete.id;
  }
  fillCustomer();
 }catch(e){toast('Strecken konnten nicht geladen werden: '+e.message);}
}
async function findDispatchCustomer(){
 const q=$('rcSearch')?.value.trim()||'';
 if(q.length<2){toast('Bitte mindestens zwei Zeichen des Namens oder eine Kundennummer eingeben.');return}
 const result=await request('/api/ops/customers?q='+encodeURIComponent(q)+'&limit=100');
 const found=result.customers||[];
 if(!found.length){toast('Kein eindeutiger Eintrag. Kundenakte oder Dublettenprüfung öffnen.');return}
 const selector=$('rc');if(!selector)return;
 selector.innerHTML=opts(found.map(c=>[c.id,(c.customer_code?c.customer_code+' · ':'')+c.name]));
 selector.value=found[0].id;
 dispatchCustomer=null;dispatchRoutes=[];
 await loadDispatchCustomer(selector.value);
 toast(found.length===100?'100 Treffer angezeigt – bitte die Suche eingrenzen.':found.length+' Kundentreffer gefunden.');
}
function rides(){const r=db.rides||[];return title('Fahrtenjournal','Zuordnung, Statuswechsel und Nachweise', '<button class="btn gold" data-page="dispatch">+ Neue Fahrt</button>')+card('Aufträge',table(['Kunde & Strecke','Termin','Fahrer','Status','Aktionen'],r.map(x=>row(['<b>'+esc(x.customer_name)+'</b><br>'+esc(x.pickup)+' → '+esc(x.destination)+'<br><span class="small">'+esc(x.direction)+' · '+esc(x.kind)+'</span>',esc(x.ride_date+' '+x.ride_time),esc(x.driver_name),badge(x.status),x.status==='assigned'||x.status==='accepted'?'<button class="btn" data-cancel="'+esc(x.id)+'">Stornieren</button>':'—']))))}
function series(){
 const data=db.series||[];
 return title('Serienfahrten und Wiederholungen','Regelmäßige Termine und getrennte Hin-/Rückfahrten automatisiert planen')+
 notice('Neue Serien werden zuerst als Vorlage gespeichert. Mit „Termine erzeugen“ legst du anschließend den gewünschten Zeitraum an. Wiederholtes Erzeugen legt keine Duplikate an.')+
 card('Serienauftrag anlegen','<div class="card-body"><form id="seriesForm" class="form-grid">'+
 '<div class="field"><label>Kunde</label><select id="sc" required>'+opts((db.customers||[]).map(c=>[c.id,c.name]))+'</select></div>'+
 '<div class="field"><label>Fahrer</label><select id="sd" required>'+opts((db.drivers||[]).filter(d=>d.active).map(d=>[d.id,d.display_name]))+'</select></div>'+
 '<div class="field"><label>Fahrtart</label><select id="sk"><option>Krankenfahrt</option><option>Rechnungsfahrt</option><option>Serienfahrt</option><option>Barfahrt</option></select></div>'+
 '<div class="field"><label>Wochentage (Mehrfachauswahl)</label><select id="sw" multiple required size="7">'+opts([['1','Montag'],['2','Dienstag'],['3','Mittwoch'],['4','Donnerstag'],['5','Freitag'],['6','Samstag'],['0','Sonntag']])+'</select></div>'+
 field('Startdatum','sstart','date',today())+field('Enddatum','send','date',today())+
 field('Hinfahrt, Uhrzeit','sout','time','08:00')+'<div class="field"><label>Rückfahrt (leer = nur Hinfahrt)</label><input type="time" id="sret"></div>'+
 field('Abholadresse','spick')+field('Zieladresse','sdest')+
 '<div class="field wide"><label><input type="checkbox" id="ssign" style="width:auto"> Unterschrift je Fahrt erforderlich (Status nur vorgemerkt)</label></div>'+
 '<div class="field wide"><button class="btn gold">Serienvorlage speichern</button></div></form></div>')+
 '<div class="section-gap">'+card('Vorhandene Serienvorlagen',data.length?table(['Kunde','Tage','Strecke / Zeiten','Fahrer','Aktionszeitraum'],data.map(o=>row([esc(o.customer_name),esc(o.weekdays),esc(o.pickup)+' → '+esc(o.destination)+'<br>'+esc(o.outbound_time)+(o.return_time?' / '+esc(o.return_time):''),esc(o.driver_name),'<div class="actions"><input aria-label="Von" type="date" id="sf_'+esc(o.id)+'" value="'+esc(o.start_date)+'" style="max-width:120px"><input aria-label="Bis" type="date" id="st_'+esc(o.id)+'" value="'+esc(o.start_date)+'" style="max-width:120px"><button class="btn" data-series-generate="'+esc(o.id)+'">Termine erzeugen</button></div>']))) : '<div class="empty">Noch keine Serienvorlagen vorhanden.</div>')+'</div></div>';
}
function bindSeries(){const c=$('sc');if(!c)return;const fill=()=>{const cust=(db.customers||[]).find(x=>x.id===c.value);if(cust){$('spick').value=cust.pickup;$('sdest').value=cust.destination;$('sk').value=cust.kind;$('ssign').checked=!!cust.signature_required}};c.addEventListener('change',fill);fill()}

function customers(){const data=db.customers||[];return title('Kundenstamm','Zentrale Adressen und Unterschriftenregeln')+card('Neuen Kunden registrieren','<div class="card-body"><form id="customerForm" class="form-grid">'+field('Kundenname','cname')+field('Abholadresse','cpickup')+field('Standardziel','cdest')+'<div class="field"><label>Fahrtart</label><select id="ckind"><option>Krankenfahrt</option><option>Rechnungsfahrt</option><option>Serienfahrt</option><option>Barfahrt</option></select></div><div class="field wide"><label><input type="checkbox" id="csign" style="width:auto"> Unterschrift erforderlich</label></div><div class="field wide"><button class="btn gold">Kunde speichern</button></div></form></div>')+'<div class="section-gap">'+card('Registrierte Kunden',table(['Name','Abholadresse','Ziel','Fahrtart'],data.map(c=>row([esc(c.name),esc(c.pickup),esc(c.destination),esc(c.kind)]))))+'</div>'}
function drivers(){return title('Fahrerverwaltung','Private Konten: Passwörter sind auch für Administratoren nicht auslesbar')+card('Fahrer anlegen','<div class="card-body"><form id="driverForm" class="form-grid">'+field('Vollständiger Anzeigename','dname')+field('Login-Name (a–z, 0–9, Punkt, - und _)','duser')+field('Temporäres Passwort (mind. 12 Zeichen)','dpass','password','','minlength="12"')+'<div class="field wide"><button class="btn gold">Fahrerzugang erstellen</button></div></form></div>')+'<div class="section-gap">'+card('Fahreraccounts',table(['Name','Login','Aktiv'],(db.drivers||[]).map(d=>row([esc(d.display_name),esc(d.username),'<span class="actions">'+(d.active?'Aktiv':'Gesperrt')+' <button class="btn" data-driver-reset="'+esc(d.id)+'">Passwort neu</button><button class="btn" data-driver-toggle="'+esc(d.id)+'" data-active="'+(d.active?'0':'1')+'">'+(d.active?'Sperren':'Aktivieren')+'</button></span>']))))+'</div>'+notice('Passwörter sind nie auslesbar. Administratoren können Zugänge sperren und ein neues Kennwort setzen. Aktive Schichten müssen vor einer Sperrung beendet werden.')}
function driverHome(){const rides=db.rides||[],open=rides.filter(r=>r.status!=='done'&&r.status!=='cancelled');return title('Meine Fahraufträge','Persönlich zugewiesene Fahrten', '<button class="btn" data-page="shifts">Meine Schicht ↗</button>')+notice('Deine Fahrten werden nur angezeigt, wenn du angemeldet bist. Wenn du eine externe Navigations-App öffnest, kann die GPS-Übertragung deiner Web-App pausieren.')+card('Offene Aufträge',open.length?open.map(r=>'<div class="card-trip"><div class="sub-header"><b>'+esc(r.customer_name)+' · '+esc(r.ride_time)+' Uhr</b>'+badge(r.status)+'</div><div class="small">'+esc(r.kind)+' · '+esc(r.direction==='hin'?'Hinfahrt':'Rückfahrt')+'</div><p style="font-size:13px;line-height:1.8">'+esc(r.pickup)+'<br>↓<br>'+esc(r.destination)+'</p>'+(r.signature_required?'<p class="small">✍ Unterschrift erforderlich – digitale Signatur noch nicht freigeschaltet.</p>':'')+'<div class="actions"><button class="btn" data-nav="'+esc(r.id)+'">↗ Navigation</button>'+(r.status==='assigned'?'<button class="btn gold" data-ride="'+esc(r.id)+'" data-action="accept">Annehmen</button>':'')+(r.status==='accepted'?'<button class="btn green" data-ride="'+esc(r.id)+'" data-action="complete">Fahrt abschließen</button>':'')+'</div></div>').join(''):'<div class="empty">Keine offenen Aufträge.</div>')+'<div class="card-body small">Abgeschlossene Aufträge: '+rides.filter(r=>r.status==='done').length+'</div>'}

function daily(){
  const all=db.rides||[],day=calendarDate,rs=all.filter(r=>r.ride_date===day),groups=new Map();
  rs.forEach(r=>{const key=r.customer_id;let g=groups.get(key);if(!g){g={customer:r.customer_name,hin:[],rueck:[]};groups.set(key,g)};g[r.direction==='rueck'?'rueck':'hin'].push(r)});
  const completed=rs.filter(r=>r.status==='done').length,open=rs.filter(r=>r.status!=='done'&&r.status!=='cancelled').length;
  const outstanding=rs.filter(r=>r.signature_required&&r.status==='done').length;
  const blocked=[...groups.values()].filter(g=>g.hin.some(r=>r.status==='done')&&!g.rueck.some(r=>r.status==='done')).length;
  const heading=title('Tageskontrolle','Hin- und Rückfahrten nach Kunde und Datum – ohne doppelte Kalendereinträge');
  const bar='<div class="command-bar"><div class="field"><label for="dailyDate">Kontrolltag</label><input id="dailyDate" type="date" value="'+esc(day)+'"></div><button class="btn" data-today="1">Heute</button><button class="btn" onclick="window.print()">Tagesliste / PDF</button></div>';
  const stats='<div class="stats"><div class="stat"><small>Geplante Fahrten</small><strong>'+rs.length+'</strong><span>Für den gewählten Tag</span></div><div class="stat"><small>Abgeschlossen</small><strong>'+completed+'</strong><span>Fahrten bestätigt</span></div><div class="stat"><small>Offene Aufträge</small><strong>'+open+'</strong><span>Noch nicht abgeschlossen</span></div><div class="stat"><small>Belege prüfen</small><strong>'+outstanding+'</strong><span>Digitale Unterschrift noch nicht aktiviert</span></div></div>';
  const alerts=blocked?'<div class="noticebox">'+blocked+' Kunde(n) mit abgeschlossener Hinfahrt, aber noch keiner abgeschlossenen Rückfahrt. Eine Rückfahrt wird nur als fehlend markiert, falls sie tatsächlich vorgesehen ist.</div>':'';
  const content=[...groups.values()].map(g=>{
    const cell=(rides,k)=>rides.length?rides.map(r=>'<div class="pair-leg"><div class="wrap"><b>'+esc(k)+'</b>'+badge(r.status)+'</div><span class="small">'+esc(r.ride_time)+' · '+esc(r.driver_name)+' · '+esc(r.pickup)+' → '+esc(r.destination)+'</span>'+(r.signature_required?'<span class="evidence">Unterschrift: im Echtbetrieb noch nicht erfasst</span>':'')+'</div>').join(''):'<div class="pair-leg missing">Keine '+k.toLowerCase()+' erfasst</div>';
    return '<article class="pair-card"><div class="pair-header"><b>'+esc(g.customer)+'</b><span class="tag">'+(g.hin.length+g.rueck.length)+' Fahrt(en)</span></div><div class="pair-grid">'+cell(g.hin,'Hinfahrt')+cell(g.rueck,'Rückfahrt')+'</div></article>'
  }).join('')||'<div class="empty">Für diesen Tag sind keine Fahrten vorhanden.</div>';
  return heading+bar+stats+alerts+'<div class="day-list">'+content+'</div>'+notice('Die Zuordnung erfolgt über Kunden-ID und Datum. Eine fehlende Rückfahrt beweist nicht, dass sie vertraglich vorgesehen war. Digitale KTS-Signaturen werden erst nach abgesicherter Einführung als „erfasst“ ausgewiesen.');
}

function shifts(){const current=activeShift(),all=db.shifts||[],uid=me.role==='driver'?me.id:null,millis=sHours(uid,7),breaks=db.breaks||[],openBreak=breaks.find(b=>current&&b.shift_id===current.id&&!b.ended_at);return title(me.role==='admin'?'Schichtkarten':'Meine Schicht','Bruttoarbeitszeit, echte Pausenbuchungen und Änderungsprotokoll')+'<div class="op-actions" style="margin:0 0 15px"><button type="button" class="btn" data-page="worktime">▦ Tages-, Monats- und Jahresauswertung</button></div>'+(me.role==='driver'?'<div class="driver-panel"><div class="shift-summary"><h2>Aktuelle Schicht</h2><strong id="liveShift" class="mono">'+duration(current?Date.now()-Date.parse(current.started_at):0)+'</strong><p class="small">'+(current?'Begonnen: '+fmt(current.started_at):'Keine aktive Schicht')+'</p><div class="actions"><button class="btn '+(current?'red':'gold')+'" data-shift="'+(current?'end':'start')+'">'+(current?'■ Schicht beenden':'▶ Schicht beginnen')+'</button><button class="btn" data-break="'+(openBreak?'end':'start')+'" '+(!current?'disabled':'')+'>'+(openBreak?'▶ Pause beenden':'Ⅱ Pause beginnen')+'</button><button class="btn" id="gpsBtn" data-gps="toggle" '+(!current?'disabled':'')+'>'+(watch===null?'⌖ GPS freigeben':'◉ GPS beenden')+'</button></div><p class="small">Standort nur während der Schicht und bei aktiver App, freiwillig startbar und jederzeit stoppbar.</p></div></div>':'')+
 '<div class="stats section-gap"><div class="stat"><small>Schichten im Verlauf</small><strong>'+all.length+'</strong><span>Vorhandene Einträge</span></div><div class="stat"><small>Letzte 7 Tage</small><strong>'+duration(millis).slice(0,5)+'</strong><span>Bruttozeit</span></div><div class="stat"><small>Aktive Schichten</small><strong>'+all.filter(s=>!s.ended_at).length+'</strong><span>Zurzeit laufend</span></div><div class="stat"><small>Bericht</small><strong style="font-size:16px">PDF</strong><span>Über Drucken</span></div></div>'+card('Arbeitszeitnachweis',table(['Fahrer','Beginn','Ende','Bruttodauer'],all.map(x=>row([esc(x.driver_name||me.displayName),fmt(x.started_at),fmt(x.ended_at),x.ended_at?duration(Date.parse(x.ended_at)-Date.parse(x.started_at)):'Laufend']))),'<button class="btn" onclick="window.print()">Drucken / PDF</button>')+card('Erfasste Pausen',table(['Fahrer-ID','Beginn','Ende','Dauer'],breaks.slice(0,120).map(b=>row([esc(b.driver_id.slice(0,8)),fmt(b.started_at),fmt(b.ended_at),b.ended_at?duration(Date.parse(b.ended_at)-Date.parse(b.started_at)):'Läuft'])))) + notice('Arbeitszeit wird als Brutto-Schichtzeit angezeigt; die tatsächlich erfassten Pausen stehen separat darunter. Für rechtlich korrekte Nettozeiten und Sonderfälle ist eine Abnahme erforderlich. Admin-Korrekturen brauchen eine Begründung.')+(me.role==='admin'?shiftCorrectionPanel():'')}

function localDateTime(value){if(!value)return '';const d=new Date(value);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')+'T'+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
function shiftCorrectionPanel(){
 const completed=(db.shifts||[]).filter(x=>x.ended_at),history=db.adjustments||[];
 return '<div class="two section-gap">'+card('Abgeschlossene Schicht korrigieren','<div class="card-body"><form id="correctionForm" class="form-grid"><div class="field wide"><label>Schichtkarte</label><select id="correctionShift" required>'+opts(completed.map(x=>[x.id,(x.driver_name||'Fahrer')+' · '+fmt(x.started_at)]))+'</select></div><div class="field"><label>Beginn</label><input type="datetime-local" required id="correctFrom"></div><div class="field"><label>Ende</label><input type="datetime-local" required id="correctTo"></div><div class="field wide"><label>Begründung (mindestens 10 Zeichen)</label><textarea id="correctReason" required minlength="10" maxlength="300" rows="3" placeholder="Z. B. Ende laut Fahrtauftrag um 17:30 Uhr bestätigt."></textarea></div><div class="field wide"><button class="btn gold" type="submit" '+(completed.length?'':'disabled')+'>Korrektur protokollieren</button></div></form><p class="small">Nur Administratoren dürfen korrigieren. Frühere Werte bleiben in einer unveränderlichen Änderungshistorie.</p></div>')+card('Korrekturhistorie',history.length?'<div class="table-wrap">'+table(['Zeitpunkt','Fahrer / Schicht','Vorher','Nachher','Begründung'],history.slice(0,25).map(a=>row([fmt(a.created_at),esc((db.shifts||[]).find(s=>s.id===a.shift_id)?.driver_name||a.shift_id.slice(0,8)),fmt(a.previous_start)+' – '+fmt(a.previous_end),fmt(a.new_start)+' – '+fmt(a.new_end),esc(a.reason)])))+'</div>':'<div class="empty">Noch keine nachträglichen Änderungen.</div>')+'</div>';
}
function bindCorrection(){const el=$('correctionShift');if(!el)return;const fill=()=>{const s=(db.shifts||[]).find(s=>s.id===el.value);if(!s)return;$('correctFrom').value=localDateTime(s.started_at);$('correctTo').value=localDateTime(s.ended_at)};el.addEventListener('change',fill);fill()}

function chat(){return title('Messenger','Team, vertrauliche Direktnachrichten an Kollegen oder Zentrale, PDF- und Bildanhänge')+
    '<div class="op-actions" style="margin:0 0 14px">'+
    '<button type="button" class="btn" data-operation="notify">🔔 Hinweise bei offener App erlauben</button></div>'+card('Teamkommunikation','<div id="messages" class="msg-panel">'+(db.messages||[]).map(m=>'<div class="message '+(m.sender_id===me.id?'mine':'')+'"><b>'+esc(m.sender_name)+'</b><br>'+esc(m.body)+'<small>'+fmt(m.created_at)+(m.recipient_id?' · Privat':' · Team')+'</small></div>').join('')+'</div><form id="chatForm" class="chat-form"><select id="recipient" class="btn" style="max-width:190px">'+opts([['','Team-Gruppe'],...(db.team||[]).filter(u=>u.id!==me.id).map(u=>[u.id,u.display_name])])+'</select><input id="msgBody" maxlength="1000" required placeholder="Nachricht …"><button class="btn gold">Senden</button></form>')}
function stopGPS(){if(watch!==null&&navigator.geolocation)navigator.geolocation.clearWatch(watch);watch=null}
function toggleGPS(){if(watch!==null){stopGPS();render('shifts');toast('GPS-Ortung beendet.');return}if(!activeShift()){toast('Erst eine Schicht starten.');return}if((db.breaks||[]).some(x=>!x.ended_at&&x.driver_id===me.id)){toast('Während einer Pause bleibt die GPS-Übertragung deaktiviert.');return}if(!navigator.geolocation){toast('GPS nicht verfügbar.');return}watch=navigator.geolocation.watchPosition(async pos=>{if(Date.now()-locationLast<45000||document.visibilityState!=='visible')return;locationLast=Date.now();try{await request('/api/position','POST',{latitude:pos.coords.latitude,longitude:pos.coords.longitude,accuracy:pos.coords.accuracy})}catch(e){toast(e.message)}},e=>{stopGPS();toast(e.code===1?'Standortberechtigung fehlt.':'Standort kann nicht ermittelt werden.')},{enableHighAccuracy:true,maximumAge:20000,timeout:20000});render('shifts');toast('GPS aktiviert – nur bei geöffneter App zuverlässig.')}
async function transaction(path,method,payload,after){try{await request(path,method,payload);await refresh();render(after||page);toast('Gespeichert.')}catch(e){toast(e.message)}}
function securePasswordDialog(title,confirmTwice=false){
 return new Promise(resolve=>{
  const d=document.createElement('dialog');d.className='password-dialog';
  const form=document.createElement('form');form.method='dialog';
  const header=document.createElement('h2');header.textContent=title;
  const text=document.createElement('p');text.textContent='Das Kennwort wird verdeckt eingegeben und nicht im Browser gespeichert.';
  const input=document.createElement('input');input.type='password';input.required=true;input.minLength=12;input.maxLength=128;input.autocomplete='new-password';input.placeholder='Kennwort eingeben';
  const again=document.createElement('input');again.type='password';again.required=confirmTwice;again.minLength=12;again.maxLength=128;again.autocomplete='new-password';again.placeholder='Kennwort wiederholen';if(!confirmTwice)again.hidden=true;
  const error=document.createElement('p');error.style.color='#ff9ba9';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='btn';cancel.textContent='Abbrechen';
  const submit=document.createElement('button');submit.type='submit';submit.className='btn gold';submit.textContent='Bestätigen';
  const buttons=document.createElement('div');buttons.className='actions';buttons.append(cancel,submit);
  form.append(header,text,input,again,error,buttons);d.append(form);document.body.append(d);
  let closed=false;const finish=v=>{if(closed)return;closed=true;d.close();d.remove();resolve(v)};
  cancel.onclick=()=>finish(null);d.addEventListener('cancel',e=>{e.preventDefault();finish(null)});
  form.addEventListener('submit',e=>{e.preventDefault();if(input.value.length< (confirmTwice?14:12)){error.textContent='Kennwort zu kurz.';return}if(confirmTwice&&input.value!==again.value){error.textContent='Eingaben stimmen nicht überein.';return}finish(input.value)});
  d.showModal();input.focus();
 });
}
async function exportData(){
 try{
  if(!crypto.subtle)throw new Error('Verschlüsselung nicht verfügbar. HTTPS benötigt.');
  const pass=await securePasswordDialog('Backup-Passwort festlegen (mindestens 14 Zeichen)',true);
  if(pass===null)return;
  const data=await request('/api/export');
  const encoder=new TextEncoder(),salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const secret=await crypto.subtle.importKey('raw',encoder.encode(pass),'PBKDF2',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},secret,{name:'AES-GCM',length:256},false,['encrypt']);
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(JSON.stringify(data)));
  const b64=bytes=>btoa(String.fromCharCode(...bytes));
  const blob=new Blob([JSON.stringify({format:'taxipro-backup-1',cipher:'AES-256-GCM',kdf:'PBKDF2-SHA256',iterations:310000,salt:b64(salt),iv:b64(iv),data:b64(new Uint8Array(cipher))})],{type:'application/json'});
  const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='taxipro-verschluesselt-'+today()+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1500);
  toast('Verschlüsseltes Backup gespeichert. Passphrase sicher aufbewahren!');
 }catch(e){toast(e.message)}
}
$('loginForm').addEventListener('submit',e=>{e.preventDefault();signIn()});$('refreshBtn').onclick=()=>refresh().then(render).catch(e=>toast(e.message));$('logoutBtn').onclick=()=>logout();$('mobileMenu').onclick=()=>$('appNav').classList.toggle('open');
document.addEventListener('click',e=>{const find=e.target.closest('[data-find-customer]');if(find){find.disabled=true;findDispatchCustomer().catch(err=>toast(err.message)).finally(()=>find.disabled=false);return}
 const nav=e.target.closest('[data-page]');if(nav){render(nav.dataset.page);if(me?.role==='admin')office.openPage(nav.dataset.page);$('appNav').classList.remove('open');return}
 const todayButton=e.target.closest('[data-today]');if(todayButton){calendarDate=today();render('daily');return}
 const change=e.target.closest('[data-ride]');if(change){transaction('/api/rides/'+change.dataset.ride,'PATCH',{action:change.dataset.action});return}
 const cancel=e.target.closest('[data-cancel]');if(cancel){if(confirm('Diesen Auftrag wirklich stornieren?'))transaction('/api/rides/'+cancel.dataset.cancel,'PATCH',{action:'cancel'});return}
 const shift=e.target.closest('[data-shift]');if(shift){if(shift.dataset.shift==='end'&&(db.breaks||[]).some(b=>!b.ended_at&&b.driver_id===me.id)){toast('Bitte zuerst die Pause beenden.');return}transaction('/api/shifts','POST',{action:shift.dataset.shift});if(shift.dataset.shift==='end')stopGPS();return}
 const rest=e.target.closest('[data-break]');if(rest){if(rest.dataset.break==='start')stopGPS();transaction('/api/breaks','POST',{action:rest.dataset.break},'shifts');return}
 const sg=e.target.closest('[data-series-generate]');if(sg){const id=sg.dataset.seriesGenerate,from=$('sf_'+id)?.value,to=$('st_'+id)?.value;if(!from||!to){toast('Bitte Anfang und Ende wählen.');return}transaction('/api/series/generate','POST',{seriesId:id,from,to},'series');return}
 const ureset=e.target.closest('[data-driver-reset]');if(ureset){securePasswordDialog('Neues Fahrer-Passwort setzen').then(pw=>{if(pw!==null&&confirm('Alte Sitzungen abmelden und Passwort ersetzen?'))transaction('/api/users/'+ureset.dataset.driverReset,'PATCH',{password:pw},'drivers')});return}
 const utoggle=e.target.closest('[data-driver-toggle]');if(utoggle){const active=utoggle.dataset.active==='1';if(!confirm('Fahreraccount '+(active?'reaktivieren':'sperren')+'?'))return;transaction('/api/users/'+utoggle.dataset.driverToggle,'PATCH',{active},'drivers');return}
 const gps=e.target.closest('[data-gps]');if(gps){toggleGPS();return}
 const back=e.target.closest('#backupExport');if(back){exportData();return}const navbtn=e.target.closest('[data-nav]');if(navbtn){const r=(db.rides||[]).find(x=>x.id===navbtn.dataset.nav);if(r)window.open('https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(r.destination),'_blank','noopener,noreferrer')}});
document.addEventListener('change',e=>{if(e.target.id==='dailyDate'){calendarDate=e.target.value;render('daily')}if(e.target.id==='rc'){dispatchCustomer=null;dispatchRoutes=[];loadDispatchCustomer(e.target.value)}
 if(e.target.id==='rcRoute'||e.target.id==='rdir')fillCustomer()});
document.addEventListener('submit',e=>{if(e.target.id==='newRideForm'){e.preventDefault();transaction('/api/rides','POST',{customerId:$('rc').value,driverId:$('rd').value,kind:$('rk').value,direction:$('rdir').value,pickup:$('rfrom').value.trim(),destination:$('rto').value.trim(),date:$('rdate').value,time:$('rtime').value,signatureRequired:$('rsig').checked},'rides')}
 if(e.target.id==='seriesForm'){e.preventDefault();const w=[...$('sw').selectedOptions].map(o=>Number(o.value));transaction('/api/series','POST',{customerId:$('sc').value,driverId:$('sd').value,kind:$('sk').value,weekdays:w,startDate:$('sstart').value,endDate:$('send').value,outboundTime:$('sout').value,returnTime:$('sret').value,pickup:$('spick').value.trim(),destination:$('sdest').value.trim(),signatureRequired:$('ssign').checked},'series')}
 if(e.target.id==='driverForm'){e.preventDefault();transaction('/api/users','POST',{username:$('duser').value.trim(),displayName:$('dname').value.trim(),password:$('dpass').value},'drivers')}
 if(e.target.id==='customerForm'){e.preventDefault();transaction('/api/customers','POST',{name:$('cname').value.trim(),pickup:$('cpickup').value.trim(),destination:$('cdest').value.trim(),kind:$('ckind').value,signatureRequired:$('csign').checked},'customers')}
 if(e.target.id==='correctionForm'){e.preventDefault();const id=$('correctionShift').value;const a=new Date($('correctFrom').value),b=new Date($('correctTo').value);if(!Number.isFinite(+a)||!Number.isFinite(+b)||b<=a){toast('Bitte gültige Uhrzeiten angeben.');return}if(!confirm('Diese nachträgliche Schichtänderung mit Begründung dauerhaft protokollieren?'))return;transaction('/api/shifts/'+id,'PATCH',{startedAt:a.toISOString(),endedAt:b.toISOString(),reason:$('correctReason').value.trim()},'shifts')}
 if(e.target.id==='chatForm'){e.preventDefault();transaction('/api/messages','POST',{recipientId:$('recipient').value||null,body:$('msgBody').value.trim()},'chat')}});
setInterval(()=>{const v=$('liveShift');if(v&&me&&db){const current=activeShift();v.textContent=duration(current?Date.now()-Date.parse(current.started_at):0)}$('clock').textContent=new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})},1000);
window.addEventListener('pagehide',stopGPS);
if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
if(auth&&APIOK)init();else loginView();
