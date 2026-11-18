/* TaxiPro 2.4: dispatcher command dashboard, customer and trip ledger.
 * Backend first: all live records originate from authenticated Cloudflare API.
 * No patient names or state are stored in LocalStorage or GitHub.
 */
export function createDispatchCenter({request,esc,toast,getUser,getState,refreshMain}) {
 const $=id=>document.getElementById(id);
 const fmtDate=s=>s?new Date(s).toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'}):'—';
 const nowBerlin=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const statusLabel={planned:'Geplant',reported:'Gefahren · gemeldet',confirmed:'Gefahren · geprüft',cancelled:'Storniert',
   approved:'Genehmigt',pending:'In Prüfung',rejected:'Abgelehnt',expired:'Abgelaufen',
   exempt:'Befreit',not_exempt:'Nicht befreit',unknown:'Ungeprüft',missing:'Fehlt',present:'Vorhanden',not_required:'Nicht erforderlich'};
 let pageCache={dashboard:null,customers:null,customer:null,calendar:null,ledger:null};
 let selectedCustomer=null,customersQuery='',periodFrom=nowBerlin().slice(0,8)+'01',periodTo=nowBerlin(),calendarState='review';
 let prefs={density:'compact',nav:'expanded',lastPage:'home',dateFilter:'today'},revision=0,prefSaving=false;
 let dashboardChecked=0;
 const pill=(s,txt)=>'<span class="center-pill state-'+esc(s||'unknown')+'">'+esc(txt||statusLabel[s]||s||'Ungeprüft')+'</span>';
 const iconBtn=(action,label,more='')=>'<button type="button" class="btn center-action" data-center="'+action+'" '+more+'>'+label+'</button>';
 const head=(h,sub,tools='')=>'<div class="center-heading"><div><h2>'+h+'</h2><p>'+sub+'</p></div><div class="center-tools">'+tools+'</div></div>';
 const td=v=>'<td>'+v+'</td>';
 const rows=(ths,items)=>'<div class="center-scroll"><table class="center-table"><thead><tr>'+ths.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+items.join('')+'</tbody></table></div>';
 const text=v=>esc(v??'—');
 const stateDate=s=>s?String(s).slice(0,10):'—';
 const n=x=>Number(x||0).toLocaleString('de-DE');
 const empty=m=>'<div class="center-empty">'+esc(m)+'</div>';
 function front() {
  const d=pageCache.dashboard;
  return '<div class="center-shell">'+
   '<div class="center-welcome"><div><div class="center-eyebrow">TAXIPRO · DISPOSITIONS-COMMAND-CENTER</div>'+
   '<h2>Heute im Überblick</h2><p>Gemeinsamer Stand aus der geschützten TaxiPro-Datenbank · '+esc(nowBerlin())+'</p></div>'+
   '<div class="center-command">'+iconBtn('density','Ansicht: '+(prefs.density==='compact'?'Kompakt':'Komfortabel'))+
   iconBtn('sidebar','Menü '+(prefs.nav==='expanded'?'reduzieren':'ausklappen'))+'</div></div>'+
   '<div id="center-live-root">'+dashboardMarkup(d)+'</div><div class="center-fleet-map center-panel"><div class="center-panel-head"><b>Flottenkarte</b><span class="center-muted">Letzter GPS-Standort mit Zeitstempel</span></div><div id="liveMap" class="map-live"></div></div></div>';
 }
 function dashboardMarkup(d) {
  if(!d)return empty('Das gemeinsame Fahrtenjournal wird geladen. Eine Google-Synchronisierung benötigt separate Firmen-OAuth-Freigaben.');
  const c=d.counts||{},all=(c.planned||0)+(c.reported||0)+(c.confirmed||0);
  const schedule=d.calendarToday||[];
  const metrics=[
   ['Kalendertermine heute',n(schedule.length),'calendar-days','calendar'],
   ['Gefahren · gemeldet',n(c.reported),'route','ledger'],
   ['Fahrten · geprüft',n(c.confirmed),'check-circle-2','ledger'],
   ['Zuordnung offen',n(c.unmatched),'alert-circle','calendar'],
   ['Fahrer im Dienst',n(c.activeDrivers),'car','shifts']
  ];
  const cards=metrics.map(([name,value,icon,tab])=>
   '<button type="button" class="center-metric" data-page="'+tab+'"><small>'+name+'</small><strong>'+value+'</strong>'+
   '<span>'+esc(tab==='calendar'?'Kalenderzuordnung':'Details öffnen')+' →</span></button>').join('');
  const sources=(d.sources||[]);
  const sync=sources.length?sources.map(x=>'<div class="center-source"><b>'+text(x.source)+'</b>'+pill(x.status)+
    '<small>Stand: '+fmtDate(x.last_success_at)+'</small></div>').join(''):
    '<div class="center-source"><b>Google Kalender + Drive</b>'+pill('unknown','Noch nicht appseitig eingerichtet')+
    '<small>ChatGPT-Verbindungen ersetzen keine Server-OAuth-Anbindung.</small></div>';
  const list=(d.latest||[]).slice(0,16).map(r=>'<tr>'+
    td('<b>'+text(r.customer_name)+'</b><small>'+text(r.pickup)+' → '+text(r.destination)+'</small>')+
    td('<b>'+text(r.pickup_time)+'</b>')+td(pill(r.billing_class))+
    td(pill(r.ride_status))+td(text(r.driver_name))+'</tr>').join('');
  return '<div class="center-kpis">'+cards+'</div>'+
    '<div class="center-overview-grid"><section class="center-panel"><div class="center-panel-head"><b>Fahrtenjournal · '+esc(d.date)+'</b>'+
    iconBtn('refresh-home','↻ Neu laden')+'</div>'+
    (list?rows(['Kunde / Strecke','Zeit','Abrechnung','Status','Fahrer'],[list]):
      empty('Noch keine bestätigten Fahrten im neuen Journal. Kalendertermine werden erst nach sicherer Zuordnung übernommen.'))+
    '<div class="center-panel-foot">'+iconBtn('open-ledger','Monatsjournal öffnen')+
    iconBtn('open-calendar','Kalender prüfen')+'</div></section>'+
    '<section class="center-panel"><div class="center-panel-head"><b>Quellverbindungen</b><span class="center-muted">Serverstand</span></div>'+
    '<div class="center-source-list">'+sync+'</div>'+
    '<p class="center-caption">Die App zeigt nur bestätigte Synchronisierungen als aktuell. Beim Ausfall werden bestehende Daten nicht still überschrieben.</p>'+
    '<div class="center-panel-foot">'+iconBtn('open-cases','Kundenakten öffnen')+
    iconBtn('sync-google','Google-Daten jetzt prüfen')+'</div></section></div>'+
    '<section class="center-panel center-space"><div class="center-panel-head"><b>Kalendertermine für heute</b>'+
    '<span class="center-muted">'+n(schedule.length)+' Ereignisse · nicht automatisch gefahren</span></div>'+
    (schedule.length?rows(['Kalendertermin','Kundenakte','Start','Zuordnung'],schedule.slice(0,45).map(x=>
      '<tr>'+td('<b>'+text(x.event_title)+'</b>')+td(text(x.customer_name||'Noch nicht zugeordnet'))+
      td(fmtDate(x.start_at))+td(pill(x.match_state))+'</tr>')):
    empty('Noch keine Kalendereinträge im sicheren Datenabgleich. Dies ist kein Nachweis, dass keine Fahrten geplant sind.'))+
    '<div class="center-panel-foot">'+iconBtn('open-calendar','Alle Zuordnungen prüfen')+'</div></section>';
 }
 function customersView() {
  const list=pageCache.customers?.customers||[];
  return head('Kunden- & Aktenübersicht','KTS, RE, Verordnung, Befreiung und genehmigte Fahrten – pro Kunde eine Akte')+
    '<div class="center-shell"><div class="center-filters"><label class="center-grow">Suche nach Name oder Kunden-ID'+
    '<input id="center-customer-search" autocomplete="off" value="'+esc(customersQuery)+'" placeholder="Kunde oder K0001"></label>'+
    iconBtn('search-customers','Suchen')+iconBtn('refresh-customers','↻ Aktualisieren')+'</div>'+
    '<div class="center-panel"><div class="center-panel-head"><b>Kundenstamm</b><span class="center-muted">'+n(list.length)+' angezeigte Einträge</span></div>'+
    (list.length?rows(['Kundennummer / Name','Abrechnung','Genehmigung','Zuzahlung','Fahrten','Akte'],list.map(x=>
      '<tr>'+td('<b>'+text(x.customer_code||'Ohne K-Nummer')+'</b><small>'+text(x.name)+'</small>')+
      td(pill(x.billing_class))+td(pill(x.approval_status))+td(pill(x.copayment_status))+
      td(n(x.journey_count))+td(iconBtn('open-customer','Akte öffnen','data-id="'+esc(x.id)+'"'))+'</tr>')):
      empty('Keine Kundendaten im sicheren TaxiPro-Datenbestand gefunden.'))+'</div></div>';
 }
 function customerDetails() {
  const d=pageCache.customer,c=d?.customer,rs=d?.routes||[],ls=d?.journeys||[];
  if(!c)return head('Kundenakte','Kunde wird geladen …')+empty('Noch keine Daten.');
  const flags=[
   ['Abrechnung','billing_class',['unknown','KTS','RE','private']],
   ['Verordnung','prescription_status',['unknown','present','missing','expired','not_required']],
   ['Genehmigung','approval_status',['unknown','pending','approved','rejected','expired','not_required']],
   ['Zuzahlung','copayment_status',['unknown','exempt','not_exempt']]
  ];
  const evidence=(d.evidence||[]).slice(0,14).map(ev=>
    '<div class="center-route"><b>'+text(ev.source==='master_approval'?'Genehmigungsbeleg':
      ev.source==='master_prescription'?'Verordnung / Arztbeleg':'Zuzahlung laut Stammdaten')+'</b>'+
    '<small>Referenz: '+text(ev.external_key)+' · '+text(ev.source_status||'Noch nicht geprüft')+
    (ev.valid_until?' · Gültig bis '+text(ev.valid_until):'')+'</small></div>').join('');
  const form=flags.map(([label,key,values])=>'<label>'+label+'<select name="'+key+'">'+
    values.map(v=>'<option value="'+v+'" '+((c[key]||'unknown')===v?'selected':'')+'>'+esc(statusLabel[v]||v)+'</option>').join('')+'</select></label>').join('');
  const routes=rs.map(x=>'<div class="center-route"><b>'+text(x.label)+'</b><small>'+
    text(x.pickup||'Startort nicht dokumentiert')+' → '+text(x.destination||'Ziel nicht dokumentiert')+'</small>'+pill(x.billing_class)+'</div>').join('');
  const journeys=ls.map(x=>'<tr>'+td(text(x.service_date))+
    td(text(x.pickup_time))+td(text(x.pickup)+' → '+text(x.destination))+
    td(text(x.direction))+td(pill(x.billing_class))+td(pill(x.ride_status))+'</tr>');
  return head('Kundenakte · '+text(c.customer_code||'ohne K-Nummer'),
      text(c.name)+' · Eine Akte, mehrere Behandlungsziele, getrennte Fahrtarten',
      iconBtn('back-customers','Zurück')+iconBtn('lookup-contact','Google Kontakte prüfen')+
      iconBtn('print-customer','Unterschriftenzettel erstellen'))+
    '<div class="center-shell"><div class="center-contact-info">'+
    '<span>Telefon laut Masterakte: <b>'+text(c.phone||'Nicht hinterlegt')+'</b></span>'+
    '<span id="center-contact-results" class="center-muted">Google-Kontakte-Suche nur auf Anfrage, keine automatische Identitätszuordnung.</span></div>'+
    '<div class="center-detail-grid"><section class="center-panel">'+
    '<div class="center-panel-head"><b>Dokumentations- & Genehmigungsstatus</b>'+pill(c.approval_status)+'</div>'+
    '<form id="center-case-form" class="center-form">'+form+
    '<label>Genehmigung gültig bis<input name="approval_valid_until" type="date" value="'+esc(c.approval_valid_until||'')+'"></label>'+
    '<label>Verordnung gültig bis<input name="prescription_valid_until" type="date" value="'+esc(c.prescription_valid_until||'')+'"></label>'+
    '<label class="center-full">Vermerk der Zentrale<textarea name="review_note" maxlength="350" rows="2">'+esc(c.review_note||'')+'</textarea></label>'+
    '<button class="btn gold" type="submit">Geprüften Aktenstatus speichern</button></form>'+
    '<p class="center-caption">Nur die Disposition darf die Status bestätigen. Ein vorhandenes Dokument allein beweist keine gültige Genehmigung oder Befreiung.</p>'+
    '<div class="center-panel-head"><b>Quellenhinweise aus Google Drive</b><span class="center-muted">Keine automatische Freigabe</span></div>'+
    '<div class="center-route-list">'+(evidence||empty('Keine zugeordneten Quellenbelege.'))+'</div></section>'+
    '<section class="center-panel"><div class="center-panel-head"><b>Strecken und Einrichtungen</b><span class="center-muted">'+n(rs.length)+' aktiv</span></div>'+
    '<div class="center-route-list">'+(routes||empty('Noch keine konkrete Strecke erfasst.'))+'</div>'+
    '<form id="center-route-form" class="center-form">'+
      '<label>Streckenname<input name="label" maxlength="90" required placeholder="z. B. Marienhospital"></label>'+
      '<label>Fahrtart<select name="billingClass"><option value="unknown">Ungeklärt</option><option value="KTS">KTS</option><option value="RE">RE</option><option value="private">Privat</option></select></label>'+
      '<label class="center-full">Startadresse<input name="pickup" maxlength="180" required></label>'+
      '<label class="center-full">Zieladresse<input name="destination" maxlength="180" required></label>'+
      '<button class="btn" type="submit">Weitere Strecke anlegen</button></form></section></div>'+
    '<div class="center-panel center-space"><div class="center-panel-head"><b>Fahrten für diese Akte</b><span class="center-muted">'+n(ls.length)+' im Zeitraum</span></div>'+
    '<div class="center-filters"><label>Von<input id="center-detail-from" type="date" value="'+esc(periodFrom)+'"></label>'+
    '<label>Bis<input id="center-detail-to" type="date" value="'+esc(periodTo)+'"></label>'+
    iconBtn('refresh-customer','Fahrten anzeigen')+iconBtn('new-ledger-for-customer','Fahrt hinzufügen')+'</div>'+
    (journeys.length?rows(['Datum','Abholung','Start → Ziel','Richtung','KTS / RE','Status'],journeys):empty('Noch keine Journalfahrten im ausgewählten Zeitraum.'))+
    '</div></div>';
 }
 function calendarView(){
  const list=pageCache.calendar?.entries||[];
  const customers=getState()?.customers||[];
  const opts=customers.slice(0,300).map(x=>'<option value="'+esc(x.id)+'">'+text(x.name)+'</option>').join('');
  return head('Kalender-Abgleich','Fahrttermine prüfen, eindeutige Kunden zuordnen und Dubletten verhindern')+
   '<div class="center-shell"><div class="center-panel"><div class="center-panel-head"><b>Zuordnungsprüfung</b>'+
   iconBtn('refresh-calendar','↻ Aktualisieren')+'</div><div class="center-filters"><label>Status'+
   '<select id="center-calendar-state">'+['review','matched','ignored','all'].map(x=>'<option value="'+x+'" '+(calendarState===x?'selected':'')+'>'+({
    review:'Zur Prüfung',matched:'Zugeordnet',ignored:'Ausgeschlossen',all:'Alle'}[x])+'</option>').join('')+'</select></label>'+
   '<span class="center-muted">'+n(list.length)+' Einträge</span></div>'+
   '<div class="center-review-list">'+(list.length?list.map(x=>'<article class="center-review">'+
   '<div><b>'+text(x.event_title)+'</b><small>'+fmtDate(x.start_at)+' · '+text(x.match_reason||'Zuordnung zu prüfen')+'</small>'+
   '<div>'+pill(x.status)+pill(x.match_state)+'</div></div>'+
   '<div class="center-review-action"><select id="center-select-'+esc(x.id)+'"><option value="">Kundenakte auswählen</option>'+opts+'</select>'+
   iconBtn('link-calendar','Kunde zuordnen','data-id="'+esc(x.id)+'"')+
   iconBtn('ignore-calendar','Kein Fahrtermin','data-id="'+esc(x.id)+'"')+'</div></article>').join(''):
   empty('Keine offenen Kalenderzuordnungen. Das bedeutet nicht automatisch, dass der Google-Synchronisierungsdienst aktiv ist.'))+'</div></div></div>';
 }
 function ledgerView(){
  const data=pageCache.ledger?.entries||[];
  const customers=getState()?.customers||[];
  const opts='<option value="">Kundenakte auswählen</option>'+
    customers.map(x=>'<option value="'+esc(x.id)+'">'+text(x.name)+'</option>').join('');
  const journeys=data.map(x=>'<tr>'+td('<b>'+text(x.customer_code||'')+'</b><small>'+text(x.customer_name)+'</small>')+
    td(text(x.service_date)+' · '+text(x.pickup_time))+
    td(text(x.pickup)+' → '+text(x.destination))+
    td(pill(x.billing_class))+td(pill(x.ride_status))+
    td('<div class="center-row-actions">'+
      (x.ride_status==='planned'?iconBtn('ledger-reported','Gefahren melden','data-id="'+esc(x.id)+'"'):'')+
      (x.ride_status==='reported'?iconBtn('ledger-confirm','Prüfen / bestätigen','data-id="'+esc(x.id)+'"'):'')+
      '</div>')+'</tr>');
  return head('Fahrtenjournal','Hin- und Rückfahrten, nach Kunde/Zeitraum gruppiert · kein automatisches „Gefahren“')+
    '<div class="center-shell"><div class="center-panel"><div class="center-filters"><label>Von<input type="date" id="center-ledger-from" value="'+esc(periodFrom)+'"></label>'+
    '<label>Bis<input type="date" id="center-ledger-to" value="'+esc(periodTo)+'"></label>'+
    iconBtn('load-ledger','Zeitraum anzeigen')+'</div>'+
    '<div class="center-panel-head"><b>Fahrten</b><span class="center-muted">'+n(data.length)+' Einträge</span></div>'+
    (journeys.length?rows(['Kunde','Datum & Zeit','Strecke','Abrechnung','Bearbeitung','Aktion'],journeys):
      empty('Für diesen Zeitraum liegen noch keine Fahrten im neuen Journal vor.'))+'</div>'+
    '<div class="center-panel center-space"><div class="center-panel-head"><b>Manuelle Fahrt nachtragen</b></div>'+
    '<form id="center-ledger-form" class="center-form">'+
      '<label class="center-full">Kunde<select name="customerId" required>'+opts+'</select></label>'+
      '<label>Datum<input type="date" name="serviceDate" value="'+esc(nowBerlin())+'" required></label>'+
      '<label>Abholzeit<input type="time" name="pickupTime" required></label>'+
      '<label class="center-full">Start<input name="pickup" required maxlength="180"></label>'+
      '<label class="center-full">Ziel<input name="destination" required maxlength="180"></label>'+
      '<label>Richtung<select name="direction"><option value="unknown">Unbestimmt</option><option value="hin">Hinfahrt</option><option value="rueck">Rückfahrt</option></select></label>'+
      '<label>Abrechnung<select name="billingClass"><option value="unknown">Ungeprüft</option><option value="KTS">KTS</option><option value="RE">RE</option><option value="private">Privat</option></select></label>'+
      '<label>Bearbeitungsstatus<select name="rideStatus"><option value="planned">Geplant</option><option value="reported">Gefahren (gemeldet)</option></select></label>'+
      '<label class="center-full">Notiz / Herkunft<input name="note" maxlength="300"></label>'+
      '<button class="btn gold" type="submit">Fahrt in gemeinsames Journal übernehmen</button></form></div></div>';
 }
 function applyPrefs() {
   document.body.classList.toggle('center-density-compact',prefs.density==='compact');
   document.body.classList.toggle('center-nav-collapsed',prefs.nav==='collapsed');
 }
 async function loadPrefs() {
  try{const v=await request('/api/ui-settings');prefs=v.settings;revision=v.revision;
    selectedCustomer=prefs.selectedCustomerId||null;
    periodFrom=prefs.periodFrom||periodFrom;periodTo=prefs.periodTo||periodTo;
    calendarState=prefs.calendarState||'review';
    if(!selectedCustomer&&prefs.lastPage==='case-detail')prefs.lastPage='cases';
    applyPrefs();}
  catch(e){console.warn('Anzeigeeinstellungen nicht geladen',e.message);}
  return prefs;
 }
 async function savePrefs(patch) {
  if(prefSaving)return;
  prefSaving=true;
  const next={...prefs,...patch};
  try{const d=await request('/api/ui-settings','PATCH',{settings:next,revision});prefs=d.settings;revision=d.revision;applyPrefs();}
  catch(e){
    if(/anderen Gerät|Gleichzeitige/.test(e.message)){
      const latest=await request('/api/ui-settings');prefs=latest.settings;revision=latest.revision;applyPrefs();
      toast('Ansicht wurde auf einem anderen Gerät geändert und aktualisiert.');
    }else toast(e.message);
  }finally{prefSaving=false;}
 }
 async function openPage(page) {if(!getUser()||getUser().role!=='admin')return;
  if(page!==prefs.lastPage)void savePrefs({lastPage:page});
 }
 async function loadDashboard(){
  const at=Date.now();
  if(at-dashboardChecked<9000&&pageCache.dashboard)return;
  dashboardChecked=at;
  try{
    const d=await request('/api/ops/dashboard?date='+nowBerlin());
    pageCache.dashboard=d;
    if($('center-live-root'))$('center-live-root').innerHTML=dashboardMarkup(d);
  }catch(e){if($('center-live-root'))$('center-live-root').innerHTML=empty(e.message);}
 }
 async function loadCustomers(){
   try{const d=await request('/api/ops/customers?q='+encodeURIComponent(customersQuery)+'&limit=100');pageCache.customers=d;replaceView('cases',customersView());}
   catch(e){toast(e.message);}
 }
 async function loadCustomer(){
  if(!selectedCustomer)return;
  try{const d=await request('/api/ops/customers/'+selectedCustomer+'?from='+periodFrom+'&to='+periodTo);
    pageCache.customer=d;replaceView('case-detail',customerDetails());}
  catch(e){toast(e.message);}
 }
 async function loadCalendar(){
  try{const d=await request('/api/ops/calendar?state='+calendarState);pageCache.calendar=d;replaceView('calendar',calendarView());}
  catch(e){toast(e.message);}
 }
 async function loadLedger(){
  try{const d=await request('/api/ops/ledger?from='+periodFrom+'&to='+periodTo);pageCache.ledger=d;replaceView('ledger',ledgerView());}
  catch(e){toast(e.message);}
 }
 const replaceView=(page,html)=>{const root=$('pageView');if(root&&root.dataset.centerPage===page)root.innerHTML=html;};
 async function mount(page) {
  const root=$('pageView');if(root)root.dataset.centerPage=page;
  if(page==='home')await loadDashboard();
  if(page==='cases')await loadCustomers();
  if(page==='case-detail')await loadCustomer();
  if(page==='calendar')await loadCalendar();
  if(page==='ledger')await loadLedger();
 }
 function view(page) {
  if(page==='home')return front();
  if(page==='cases')return customersView();
  if(page==='case-detail')return customerDetails();
  if(page==='calendar')return calendarView();
  if(page==='ledger')return ledgerView();
  return '';
 }
 function eligible(p){return ['home','cases','case-detail','calendar','ledger'].includes(p);}
 function docHtml(model) {
  const h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const body=model.entries.map(x=>'<tr><td>'+h(x.date)+'</td><td>'+h(x.time)+'</td><td>'+h(x.pickup)+'</td><td>'+h(x.destination)+'</td><td>'+h(x.direction==='hin'?'Hin':x.direction==='rueck'?'Rück':'—')+'</td></tr>').join('');
  return '<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Unterschriftszettel</title>'+
    '<style>@page{size:A4;margin:15mm}body{font-family:Arial,sans-serif;color:#102437;font-size:10pt;margin:0}header{text-align:center;border-bottom:2px solid #173d49;padding-bottom:12px;margin-bottom:16px}h1{font-size:19pt;margin:4px 0}h2{font-size:12pt;margin:18px 0 10px}p{margin:6px 0}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8.5pt}th,td{border-bottom:1px solid #b8c6cc;padding:7px 5px;vertical-align:top;overflow-wrap:anywhere}th{background:#e7edf0;text-align:left}th:nth-child(1){width:15%}th:nth-child(2){width:10%}th:nth-child(3),th:nth-child(4){width:29%}th:nth-child(5){width:11%}.signature{margin-top:40px;display:flex;gap:50px}.signature>div{flex:1;border-top:1px solid #173d49;padding-top:6px}.foot{margin-top:22px;font-size:9pt;color:#3c5664}button{margin:20px 0 0;padding:10px 16px}@media print{button{display:none}tr{page-break-inside:avoid}}</style>'+
    '</head><body><header><h1>Taxi Meckenheim GmbH</h1><p>Bestätigung der durchgeführten Fahrten</p></header>'+
    '<p><b>Kunde:</b> '+h(model.customerName)+' &nbsp; <b>Kundennr.:</b> '+h(model.customerId||'—')+'</p>'+
    '<p><b>Zeitraum:</b> '+h(model.periodStart)+' bis '+h(model.periodEnd)+' &nbsp; <b>Fahrten:</b> '+model.entries.length+'</p>'+
    '<h2>Fahrtenübersicht</h2><table><thead><tr><th>Datum</th><th>Zeit</th><th>Abholort</th><th>Ziel</th><th>Fahrt</th></tr></thead><tbody>'+body+'</tbody></table>'+
    '<p class="foot">Die oben aufgeführten Fahrten wurden der unterzeichnenden Person zur Bestätigung vorgelegt.</p>'+
    '<div class="signature"><div>Unterschrift Kunde / berechtigte Person</div></div>'+
    '<button type="button" onclick="window.print()">Drucken / als PDF sichern</button></body></html>';
 }
 async function printCustomer(){
  if(!selectedCustomer)throw Error('Kunde fehlt.');
  const d=await request('/api/ops/signature-sheet?customerId='+selectedCustomer+'&from='+periodFrom+'&to='+periodTo);
  const iframe=document.createElement('iframe');
  iframe.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:99999;background:white';
  iframe.title='Unterschriftszettel – Druckansicht';
  document.body.append(iframe);
  const doc=iframe.contentDocument;
  doc.open();doc.write(docHtml(d));doc.close();
  // Explicit button within preview invokes print; never silently sign a document.
  const close=doc.createElement('button');close.textContent='Vorschau schließen';
  close.style.marginLeft='12px';close.onclick=()=>iframe.remove();
  doc.body.insertBefore(close,doc.body.firstChild);
 }
 async function handleClick(action,el){
  if(action==='density')return savePrefs({density:prefs.density==='compact'?'comfortable':'compact'});
  if(action==='sidebar')return savePrefs({nav:prefs.nav==='expanded'?'collapsed':'expanded'});
  if(action==='refresh-home')return loadDashboard();
  if(action==='sync-google'){
    const status=await request('/api/ops/sources');
    if(!status.connections.calendarConfigured&&!status.connections.masterConfigured)
      throw Error('Google-Quellen in Cloudflare noch nicht autorisiert. Ein ChatGPT-Kontozugriff reicht hierfür nicht.');
    const data=await request('/api/ops/sync','POST',{which:'both'});
    toast('Quellabgleich gestartet und geprüft.');
    dashboardChecked=0;await loadDashboard();return data;
  }
  if(action==='open-ledger'){refreshMain('ledger');return;}
  if(action==='open-calendar'){refreshMain('calendar');return;}
  if(action==='open-cases'||action==='back-customers'){refreshMain('cases');return;}
  if(action==='refresh-customers'||action==='search-customers'){
    customersQuery=$('center-customer-search')?.value||'';return loadCustomers();
  }
  if(action==='open-customer'){selectedCustomer=el.dataset.id;
    await savePrefs({selectedCustomerId:selectedCustomer,lastPage:'case-detail'});
    refreshMain('case-detail');return;}
  if(action==='refresh-customer'){
    periodFrom=$('center-detail-from')?.value||periodFrom;periodTo=$('center-detail-to')?.value||periodTo;
    await savePrefs({periodFrom,periodTo});return loadCustomer();
  }
  if(action==='new-ledger-for-customer'){refreshMain('ledger');return;}
  if(action==='lookup-contact'){
    const c=pageCache.customer?.customer;
    if(!c)throw Error('Kundenakte nicht geöffnet.');
    const result=await request('/api/ops/contacts?q='+encodeURIComponent(c.name));
    const target=$('center-contact-results');
    if(target){
      const matches=(result.contacts||[]).slice(0,10);
      target.innerHTML=matches.length?matches.map(x=>
        '<span class="center-contact-match"><b>'+text(x.name)+'</b> · '+text(x.phone||'Ohne Nummer')+'</span>').join(' '):
        'Kein passender Kontakt gefunden.';
    }
    return;
  }
  if(action==='print-customer')return printCustomer();
  if(action==='refresh-calendar'){calendarState=$('center-calendar-state')?.value||'review';
    await savePrefs({calendarState});return loadCalendar();}
  if(action==='link-calendar'||action==='ignore-calendar'){
    const customerId=$('center-select-'+el.dataset.id)?.value||null;
    if(action==='link-calendar'&&!customerId)throw Error('Kundenakte auswählen.');
    await request('/api/ops/calendar/'+el.dataset.id,'PATCH',
      action==='link-calendar'?{action:'link',customerId}:{action:'ignore'});
    await loadCalendar();return;
  }
  if(action==='load-ledger'){
    periodFrom=$('center-ledger-from')?.value||periodFrom;periodTo=$('center-ledger-to')?.value||periodTo;
    await savePrefs({periodFrom,periodTo});return loadLedger();
  }
  if(action==='ledger-reported'||action==='ledger-confirm'){
    const isConfirmed=action==='ledger-confirm';
    let note=isConfirmed?window.prompt('Prüfnotiz zur tatsächlich gefahrenen Fahrt (mindestens 8 Zeichen):'):null;
    if(isConfirmed&&(!note||note.trim().length<8))throw Error('Bitte eine nachvollziehbare Prüfnotiz eingeben.');
    await request('/api/ops/ledger/'+el.dataset.id,'PATCH',
      {rideStatus:isConfirmed?'confirmed':'reported',note:note||'Von der Zentrale gemeldet'});
    return loadLedger();
  }
 }
 async function handleSubmit(form) {
  const d=Object.fromEntries(new FormData(form).entries());
  if(form.id==='center-case-form'){
    await request('/api/ops/customers/'+selectedCustomer+'/case','PATCH',d);
    toast('Aktenstatus zentral gespeichert.');return loadCustomer();
  }
  if(form.id==='center-route-form'){
    await request('/api/ops/customers/'+selectedCustomer+'/routes','POST',d);
    toast('Weitere Kundenstrecke erfasst.');return loadCustomer();
  }
  if(form.id==='center-ledger-form'){
    await request('/api/ops/ledger','POST',d);toast('Fahrt in der gemeinsamen Akte gespeichert.');
    return loadLedger();
  }
 }
 document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-center]');if(!el)return;
  el.disabled=true;
  try{await handleClick(el.dataset.center,el)}catch(err){toast(err.message)}
  finally{el.disabled=false}
 });
 document.addEventListener('submit',async e=>{
  if(!['center-case-form','center-route-form','center-ledger-form'].includes(e.target.id))return;
  e.preventDefault();
  const btn=e.target.querySelector('button[type=submit]');if(btn)btn.disabled=true;
  try{await handleSubmit(e.target)}catch(err){toast(err.message)}finally{if(btn)btn.disabled=false}
 });
 return {view,mount,eligible,front,openPage,loadPrefs,applyPrefs,savePrefs,getPrefs:()=>prefs,loadDashboard};
}
