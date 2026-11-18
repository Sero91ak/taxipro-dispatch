/* TaxiPro 2.3 – staff community and worktime UI.
 * Only used behind the authenticated Cloudflare API in v2/app.html.
 * No paid maps, geocoder or radar-warning services.
 */
export function createOperations({request,toast,esc,fmt,getSession,getBase,getMe,getDb,rerender}) {
  const $ = id => document.getElementById(id);
  const nf = n => Math.max(0,Math.round(Number(n)||0)).toLocaleString('de-DE');
  const clock = ms => { const n=Math.max(0,Math.floor((Number(ms)||0)/60000)); return Math.floor(n/60)+' Std. '+String(n%60).padStart(2,'0')+' Min.'; };
  const localDate = () => {
    const p=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    return /^\d{4}-\d{2}-\d{2}$/.test(p)?p:new Date().toISOString().slice(0,10);
  };
  const roadList=['A61','A565','A555','A59','A4','A3'];
  const typeLabels={jam:'🚗 Stau',accident:'💥 Unfall',roadworks:'🚧 Baustelle',closure:'⛔ Sperrung',hazard:'⚠️ Gefahr'};
  let map=null, mapMarkers=[], mapEvents=[], point=null, pointMarker=null, officialEvents=[],officialLoaded=0,officialGenerated=0;
  let date=localDate(),period='day',timeData=null,timeLoading=false,openedSignature=false,seenMessages=null,seenReports=null;
  let tripFocus=null;
  const formButton=(id,text)=>'<button type="button" class="btn" data-operation="'+id+'">'+text+'</button>';
  const button=(action,attrs,label)=>'<button type="button" class="btn" data-operation="'+action+'" '+attrs+'>'+label+'</button>';
  function roleUser(u){return getMe()?.role==='admin' || getMe()?.id===u;}
  function title(name,sub) {return '<header class="head"><div><h2>'+name+'</h2><p>'+sub+'</p></div></header>';}
  function escapeDate(d){return esc(d?.slice(0,16)||'');}
  function setTripFocus(ride){
    if(!ride){tripFocus=null;return false;}
    const user=getMe();
    if(!user||user.role!=='driver'||ride.driver_id!==user.id)return false;
    tripFocus={
      id:String(ride.id||'').slice(0,50),
      customerName:String(ride.customer_name||'').slice(0,120),
      pickup:String(ride.pickup||'').slice(0,200),
      destination:String(ride.destination||'').slice(0,200),
      date:String(ride.ride_date||'').slice(0,10),
      time:String(ride.ride_time||'').slice(0,5)
    };
    return true;
  }
  function trafficView(db) {
    const data=db.trafficReports||[];
    const cards=data.slice(0,70).map(x=>
      '<article class="op-message"><div class="op-flex"><b>'+esc(typeLabels[x.category]||x.category)+'</b><small>'+esc(x.road||'Straße nicht benannt')+'</small></div>'+
      '<p>'+esc(x.description)+'</p><small>'+esc(x.reporter_name)+' · '+fmt(x.observed_at)+' · Meldung von Mitarbeitern, nicht amtlich verifiziert</small>'+
      (roleUser(x.reporter_id)?'<div class="op-actions">'+button('resolve-report','data-id="'+esc(x.id)+'"','Als erledigt markieren')+'</div>':'')+'</article>'
    ).join('');
    const focus=tripFocus&&getMe()?.role==='driver'?
      '<section class="card op-trip-focus"><div class="card-title"><b>Ausgewählter Fahrauftrag · '+esc(tripFocus.date)+' · '+esc(tripFocus.time)+'</b>'+
      '<small>Fahrtdaten ausschließlich im angemeldeten Mitarbeiterbereich</small></div>'+
      '<div class="op-trip-route"><div><small>Abholung</small><b>'+esc(tripFocus.pickup)+'</b></div>'+
      '<div class="op-trip-arrow" aria-hidden="true">→</div>'+
      '<div><small>Ziel</small><b>'+esc(tripFocus.destination)+'</b></div></div>'+
      '<p class="op-caption">Die interne Karte zeigt offizielle Verkehrsereignisse und Teamhinweise. Sie bietet derzeit keine berechnete Routenführung oder Abbiegeanweisungen.</p></section>':'';
    return title('Verkehr & Community','Amtliche Autobahndaten und von Mitarbeitenden gemeldete Gefahrenstellen')+
      focus+'<div class="op-grid"><section class="card op-mapcard"><div class="card-title"><b>Live-Verkehrskarte</b><small>OpenFreeMap / Autobahn GmbH</small></div>'+
      '<div id="ops-map" class="op-map" role="region" aria-label="Interne Verkehrskarte"></div>'+
      '<div id="ops-map-note" class="op-note">Karte, offizielle Meldungen und eigene Teammarkierungen werden geladen …</div>'+
      '<p class="op-caption">Gelb = Amtlich · Türkis = Team. GPS ist nur auf Anfrage verfügbar. Keine Radar- oder Polizeikontrollwarnung.</p></section>'+
      '<section class="card"><div class="card-title"><b>Eine Verkehrslage melden</b><small>Standort angeben oder auf die Karte tippen</small></div>'+
      '<form id="op-traffic-form" class="op-form"><label>Art der Meldung<select id="op-traffic-type"><option value="jam">Stau</option><option value="accident">Unfall</option><option value="roadworks">Baustelle</option><option value="closure">Sperrung</option><option value="hazard">Gefahrenstelle</option></select></label>'+
      '<label>Autobahn oder Straße<input id="op-traffic-road" maxlength="45" placeholder="z. B. A565 oder L261"></label>'+
      '<label>Beschreibung<textarea id="op-traffic-description" maxlength="500" rows="4" required placeholder="Wo genau? Fahrtrichtung, Ausfahrt, Situation, seit wann …"></textarea></label>'+
      '<div class="op-flex">'+formButton('my-location','⌖ Meinen Standort wählen')+'<span id="op-point-label" class="op-muted">Noch kein Ort gewählt</span></div>'+
      '<button class="btn gold" type="submit">Verkehrsmeldung an das Team senden</button></form>'+
      '<p class="op-caption">Die Meldung erscheint mit einem Kartenpunkt und zusätzlich im Gruppenchat. Sie erhält eine Ablaufzeit und kann wieder geschlossen werden. Nur während eines sicheren Halts melden.</p></section></div>'+
      '<section class="card op-section"><div class="card-title"><b>Interne aktuelle Meldungen</b><small>'+nf(data.length)+' aktiv</small></div>'+
      '<div class="op-list">'+(cards||'<div class="empty">Noch keine aktuellen Teammeldungen.</div>')+'</div></section>';
  }
  function recipientOptions(db){
    const me=getMe();
    return '<option value="">Empfänger auswählen</option>'+
      (db.team||[]).filter(u=>u.id!==me.id).map(u=>'<option value="'+esc(u.id)+'">'+esc(u.display_name)+' · '+(u.role==='admin'?'Zentrale':'Fahrer')+'</option>').join('');
  }
  function uploadView(db) {
    const files=db.attachments||[];
    return '<section class="card op-section"><div class="card-title"><b>Private Dateien senden</b><small>Nur persönlich berechtigte Empfänger</small></div>'+
      '<form id="op-upload-form" class="op-form op-inset"><label>Empfänger<select id="op-file-to" required>'+recipientOptions(db)+'</select></label>'+
      '<label>PDF oder Bild (maximal 5 MB)<input id="op-file" type="file" accept=".pdf,application/pdf,image/png,image/jpeg,image/webp" required></label>'+
      '<label>Betreff / Inhalt<input id="op-file-note" maxlength="240" placeholder="z. B. Schichtdokument, Fahrtbeleg"></label>'+
      '<button class="btn gold" type="submit">Geschützt hochladen und zustellen</button></form>'+
      '<p class="op-caption">Dateien liegen ausschließlich im privaten, serverseitig berechtigten Speicher, sofern er eingerichtet ist. Sie sind nicht als öffentliche Drive-Links verfügbar. Zugriff ausschließlich Sender und Empfänger.</p>'+
      '</section>'+
      '<section class="card op-section"><div class="card-title"><b>Empfangene und gesendete Dokumente</b><small>'+nf(files.length)+'</small></div>'+
      '<div class="op-list">'+(files.length?files.slice(0,150).map(f=>
        '<div class="op-file"><div><b>'+(f.pinned?'📌 ':'')+esc(f.filename)+'</b><small>'+esc(f.owner_name)+' → '+esc(f.recipient_name)+' · '+fmt(f.created_at)+' · '+nf(f.bytes/1024)+' KB</small>'+
        (f.note?'<p>'+esc(f.note)+'</p>':'')+'</div><div class="op-actions">'+button('pin-file','data-id="'+esc(f.id)+'" data-pinned="'+(f.pinned?'1':'0')+'"',f.pinned?'Lösen':'Anheften')+button('download-file','data-id="'+esc(f.id)+'" data-name="'+esc(f.filename)+'"','Datei öffnen / herunterladen')+'</div></div>'
      ).join(''):'<div class="empty">Noch keine privaten Anhänge. Für die Übermittlung muss der private Cloud-Dateispeicher eingerichtet sein.</div>')+'</div></section>';
  }
  function filesView(db){return title('Dokumente & Austausch','Vertrauliche Dokumente mit eindeutiger Sender- und Empfängerzuordnung')+uploadView(db);}
  function chatExtra(db){return '<div class="op-section">'+uploadView(db)+'</div>';}
  function swapsView(db){
    const me=getMe(),rides=(db.rides||[]).filter(x=>me.role==='driver'&&x.driver_id===me.id&&x.status==='assigned');
    const targets=(db.team||[]).filter(x=>x.role==='driver'&&x.id!==me.id);
    const pending=db.swaps||[];
    const create=me.role==='driver'
      ?'<section class="card"><div class="card-title"><b>Fahrtentausch anfragen</b><small>Zentrale muss abschließend zustimmen</small></div>'+
        '<form id="op-swap-form" class="op-form op-inset"><label>Meine noch nicht angetretene Fahrt<select id="op-swap-ride" required>'+
        '<option value="">Fahrt wählen</option>'+rides.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.ride_date)+' · '+esc(r.ride_time)+' · '+esc(r.pickup)+' → '+esc(r.destination)+'</option>').join('')+
        '</select></label><label>Kollege<select id="op-swap-target" required><option value="">Fahrer wählen</option>'+
        targets.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.display_name)+'</option>').join('')+'</select></label>'+
        '<label>Begründung<input id="op-swap-reason" maxlength="300" placeholder="Bitte Einsatzgrund angeben"></label>'+
        '<button class="btn gold" type="submit">Tauschanfrage senden</button></form></section>':'';
    const cards=pending.slice(0,90).map(w=>{
      const actions=[];
      if(me.id===w.target_driver_id&&w.status==='requested'){
        actions.push(button('swap-accept','data-id="'+esc(w.id)+'"','Annehmen'));
        actions.push(button('swap-decline','data-id="'+esc(w.id)+'"','Ablehnen'));
      }
      if(me.id===w.requester_id&&w.status==='requested')actions.push(button('swap-cancel','data-id="'+esc(w.id)+'"','Zurückziehen'));
      if(me.role==='admin'&&w.status==='accepted'){
        actions.push(button('swap-approve','data-id="'+esc(w.id)+'"','Tausch genehmigen'));
        actions.push(button('swap-reject','data-id="'+esc(w.id)+'"','Ablehnen'));
      }
      return '<article class="op-message"><div class="op-flex"><b>'+esc(w.requester_name)+' → '+esc(w.target_name)+'</b><span class="tag">'+esc(w.status)+'</span></div>'+
        '<p>'+esc(w.ride_date)+' · '+esc(w.ride_time)+' · '+esc(w.pickup)+' → '+esc(w.destination)+'</p>'+
        (w.reason?'<small>'+esc(w.reason)+'</small>':'')+
        (actions.length?'<div class="op-actions">'+actions.join('')+'</div>':'')+'</article>';
    }).join('');
    return title('Fahrtentausch','Anfrage → Zustimmung des Kollegen → verbindliche Disponentenfreigabe')+
      create+'<section class="card op-section"><div class="card-title"><b>Tauschanfragen</b><small>'+nf(pending.length)+'</small></div>'+
      '<div class="op-list">'+(cards||'<div class="empty">Keine Tauschanfragen vorhanden.</div>')+'</div></section>';
  }
  function timeView(db) {
    return title('Arbeitszeit · Tag / Monat / Jahr','Serverberechnete Arbeitszeiten und echte Pausenerfassung – Europe/Berlin')+
      '<section class="card"><div class="op-time-form"><label>Auswertung<select id="op-time-period"><option value="day" '+(period==='day'?'selected':'')+'>Tagesübersicht</option><option value="month" '+(period==='month'?'selected':'')+'>Monatsübersicht</option><option value="year" '+(period==='year'?'selected':'')+'>Jahresübersicht</option></select></label>'+
      '<label>Bezugsdatum<input type="date" id="op-time-date" value="'+esc(date)+'"></label>'+
      '<button type="button" class="btn" data-operation="load-time">Bericht aktualisieren</button></div>'+
      '<div id="op-time-results">'+timeResults()+'</div></section>'+
      '<p class="op-caption">Rechenbasis sind bestätigte Server-Zeitstempel für Start, Pause, Pausenende und Schichtende. Nacht- und Wochenendzeiten sowie Zeitumstellungen werden auf die jeweiligen Kalendertage verteilt. Die Nettozeit wird ohne Zuschlags- oder Tarifbewertung berechnet.</p>';
  }
  function timeResults() {
    if(timeLoading)return '<div class="empty">Arbeitszeiten werden sicher vom Server geladen …</div>';
    if(!timeData)return '<div class="empty">Bitte Bericht laden. Für den Echtbetrieb ist das Cloud-Backend erforderlich.</div>';
    const d=timeData;
    return '<div class="op-kpis"><div><small>Bruttozeit</small><strong>'+clock(d.grossMs)+'</strong></div>'+
      '<div><small>Pause</small><strong>'+clock(d.breakMs)+'</strong></div><div><small>Nettozeit</small><strong>'+clock(d.netMs)+'</strong></div>'+
      '<div><small>Schichten</small><strong>'+nf(d.shiftCount)+'</strong></div></div>'+
      '<div class="op-list">'+(d.byDriver||[]).map(x=>
        '<div class="op-file"><div><b>'+esc(x.driverName||'Fahrer')+'</b><small>'+nf(x.shiftCount)+' Schichten · Brutto '+clock(x.grossMs)+' · Pause '+clock(x.breakMs)+'</small></div><strong>'+clock(x.netMs)+'</strong></div>'
      ).join('')+'</div>'+
      '<div class="op-actions">'+formButton('print-time','Drucken / als PDF sichern')+'</div>'+
      '<p class="op-caption">Stand der Berechnung: '+fmt(d.computedAt)+'. Laufende Schichten werden bis zum letzten Serverabgleich berechnet.</p>';
  }
  function signaturesView(db) {
    const me=getMe(),rides=(db.rides||[]).filter(x=>x.signature_required&&x.status!=='cancelled');
    const groups=new Map();
    for(const r of rides){
      const key=r.customer_id+'|'+r.ride_date;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(r);
    }
    const records=db.signatures||[],signedRides=new Set(records.flatMap(x=>String(x.ride_ids||'').split(',')));
    const sections=[...groups.values()].slice(0,60).map(group=>{
      const remaining=group.filter(x=>!signedRides.has(x.id));
      const name=group[0].customer_name||'Kunde';
      return '<article class="op-message"><div class="op-flex"><b>'+esc(name)+' · '+esc(group[0].ride_date)+'</b><span class="tag">'+nf(group.length)+' Fahrt(en)</span></div>'+
        '<p>'+group.map(x=>esc(x.ride_time)+' '+esc(x.direction==='hin'?'Hinfahrt':'Rückfahrt')+' · '+esc(x.status)).join('<br>')+'</p>'+
        (remaining.length&&me.role==='driver'?
          button('start-signature','data-rides="'+esc(remaining.slice(0,12).map(x=>x.id).join(','))+'"','Für '+remaining.length+' Fahrt(en) unterschreiben lassen'):
          '<small>Keine offene Signatur auf dieser Karte oder nur Administratorzugriff.</small>')+'</article>';
    });
    return title('Digitale Unterschriften','Eine sichtbare Kundenbestätigung für mehrere Fahrten desselben Tages')+
      '<p class="op-caption">Die unterzeichnende Person sieht Fahrtenliste und Bestätigungstext vor der Unterschrift. Ein gesicherter Dateispeicher ist erforderlich. Die Übernahme in Krankenkassen-Abrechnungen muss gesondert geprüft werden.</p>'+
      '<section class="card"><div class="card-title"><b>Unterschriftsfähige Fahrten</b></div><div class="op-list">'+(sections.join('')||'<div class="empty">Keine Fahrten mit Unterschriftspflicht vorhanden.</div>')+'</div></section>'+
      '<section class="card op-section"><div class="card-title"><b>Gesicherte Nachweise</b></div><div class="op-list">'+(records.length?records.slice(0,80).map(x=>
        '<div class="op-file"><div><b>'+esc(x.signer_name)+'</b><small>'+fmt(x.created_at)+' · '+String(x.ride_ids||'').split(',').length+' Fahrt(en)</small></div>'+
        button('download-signature','data-id="'+esc(x.id)+'"','Nachweis öffnen')+'</div>').join(''):
        '<div class="empty">Noch keine digital erfassten Unterschriften.</div>')+'</div></section>';
  }
  function view(page,db) {
    if(page==='traffic')return trafficView(db);
    if(page==='files')return filesView(db);
    if(page==='swaps')return swapsView(db);
    if(page==='worktime')return timeView(db);
    if(page==='signatures')return signaturesView(db);
    return '';
  }
  async function officialData() {
    if(officialLoaded&&Date.now()-officialLoaded<15*60000)return;
    officialLoaded=Date.now();
    try {
      const res=await fetch('../traffic-feed.json',{cache:'no-store'});
      if(!res.ok)throw Error('Amtliche Datei nicht erreichbar');
      const j=await res.json();
      officialEvents=(j.events||[]).filter(x=>!x.future&&Array.isArray(x.coords));
      officialGenerated=Date.parse(j.generatedAt)||0;
    }catch {
      officialEvents=[];
      officialGenerated=0;
    }
  }
  function mapPoints(db) {
    if(!map||!window.maplibregl)return;
    for(const marker of mapMarkers)marker.remove();
    mapMarkers=[];
    const mk=(coords,html,color,title,desc)=>{
      const el=document.createElement('div');
      el.className='op-pin';
      el.textContent=html;
      el.style.borderColor=color;
      const content=document.createElement('div');
      const strong=document.createElement('strong');strong.textContent=title;
      const p=document.createElement('p');p.textContent=desc;
      content.append(strong,p);
      const marker=new maplibregl.Marker({element:el}).setLngLat(coords)
        .setPopup(new maplibregl.Popup({maxWidth:'280px'}).setDOMContent(content)).addTo(map);
      mapMarkers.push(marker);
    };
    officialEvents.slice(0,230).forEach(x=>{
      mk(x.coords,x.kind==='roadworks'?'🚧':x.kind==='closure'?'⛔':'⚠️','#e2a64e',x.autobahn+' · '+x.title,x.detail||'Amtliche Autobahnmeldung');
    });
    (db.trafficReports||[]).slice(0,150).forEach(x=>{
      mk([x.longitude,x.latitude],x.category==='jam'?'🚗':'⚠️','#55ead1',(x.road||'Straße')+' · '+(typeLabels[x.category]||x.category),
        x.description+' · Mitarbeiterbericht, nicht amtlich bestätigt');
    });
    const note=$('ops-map-note');
    if(note)note.textContent='Aktiv: '+(db.trafficReports||[]).length+' Team-Meldungen · '+officialEvents.length+
      ' amtliche Meldungen (Stand: '+(officialGenerated?fmt(new Date(officialGenerated).toISOString()):'nicht verfügbar')+').';
  }
  async function mount(page) {
    if(page==='traffic'){
      const el=$('ops-map');
      if(!el)return;
      if(map&&map.getContainer()!==el){try{map.remove()}catch{}map=null;mapMarkers=[];pointMarker=null;}
      await officialData();
      if(!map&&window.maplibregl) {
        try {
          map=new maplibregl.Map({container:el,style:'https://tiles.openfreemap.org/styles/liberty',
            center:[7.033,50.627],zoom:10.5});
          map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
          map.on('click',ev=>{
            point={latitude:ev.lngLat.lat,longitude:ev.lngLat.lng,accuracy:null};
            if(pointMarker)pointMarker.remove();
            const div=document.createElement('div');div.className='op-select-pin';div.textContent='◎';
            pointMarker=new maplibregl.Marker({element:div}).setLngLat(ev.lngLat).addTo(map);
            const label=$('op-point-label');if(label)label.textContent='Kartenpunkt ausgewählt ('+point.latitude.toFixed(4)+', '+point.longitude.toFixed(4)+')';
          });
          map.once('load',()=>{map?.resize();mapPoints(getDb())});
          map.on('error',e=>console.warn('TaxiPro Team-Karte:',e.error));
        }catch(e){el.textContent='Karte momentan nicht verfügbar. Die Meldungen darunter sind weiterhin lesbar.';}
      } else if(map) mapPoints(getDb());
      else el.textContent='Kartenbibliothek nicht verfügbar. Meldungen weiterhin lesbar.';
      return;
    }
    if(map) {try{map.remove()}catch{}map=null;mapMarkers=[];pointMarker=null;}
    if(page==='worktime'&&!timeData&&!timeLoading)await fetchTime();
  }
  async function fetchTime() {
    const el=$('op-time-results');
    if(!el)return;
    timeLoading=true;el.innerHTML=timeResults();
    try{timeData=await request('/api/time-summary?period='+encodeURIComponent(period)+'&date='+encodeURIComponent(date));}
    catch(e){timeData=null;toast(e.message);}
    finally{timeLoading=false;if($('op-time-results'))$('op-time-results').innerHTML=timeResults();}
  }
  function getLocation() {
    return new Promise((resolve,reject)=>{
      if(!navigator.geolocation)return reject(new Error('GPS auf dem Gerät nicht verfügbar.'));
      navigator.geolocation.getCurrentPosition(pos=>resolve({
        latitude:pos.coords.latitude,longitude:pos.coords.longitude,accuracy:pos.coords.accuracy
      }),()=>reject(new Error('Standort nicht freigegeben. Du kannst auf der Karte einen Punkt auswählen.')),
      {enableHighAccuracy:true,maximumAge:30000,timeout:15000});
    });
  }
  async function privateUpload() {
    const file=$('op-file')?.files?.[0];
    const recipient=$('op-file-to')?.value;
    const name=file?.name||'';
    if(!recipient||!file)throw new Error('Empfänger und Dokument auswählen.');
    if(file.size>5*1024*1024)throw new Error('Datei überschreitet 5 MB.');
    if(!['application/pdf','image/png','image/jpeg','image/webp'].includes(file.type))
      throw new Error('Nur PDF, PNG, JPEG oder WebP zulässig.');
    const response=await fetch(getBase()+'/api/attachments',{
      method:'POST',headers:{Authorization:'Bearer '+getSession(),'Content-Type':file.type,
      'x-taxipro-recipient':recipient,'x-taxipro-filename':encodeURIComponent(name),
      'x-taxipro-note':encodeURIComponent($('op-file-note')?.value||'')},body:file
    });
    let body;try{body=await response.json()}catch{throw new Error('Ungültige Serverantwort.')}
    if(!response.ok)throw new Error(body.error||'Dateiübermittlung fehlgeschlagen.');
    toast('Datei geschützt zugestellt.');
    await rerender();
  }
  async function download(path,name) {
    const response=await fetch(getBase()+path,{headers:{Authorization:'Bearer '+getSession()},cache:'no-store'});
    if(!response.ok){
      let body={};try{body=await response.json()}catch{}
      throw new Error(body.error||'Datei nicht verfügbar.');
    }
    const blob=await response.blob(),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=name;a.style.display='none';document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),40000);
  }
  async function showSignature(rideList) {
    if(openedSignature)return;
    const rides=(getDb().rides||[]).filter(x=>rideList.includes(x.id));
    if(!rides.length)throw new Error('Keine unterschriftsfähigen Fahrten gefunden.');
    const dialog=document.createElement('dialog');dialog.className='op-sign-dialog';
    dialog.innerHTML='<div class="op-sign-head"><h2>Fahrtbestätigung</h2><button type="button" class="btn" id="op-sign-close">✕ Schließen</button></div>'+
      '<p>Die unterzeichnende Person bestätigt die folgende Fahrtenliste mit ihrer eigenhändigen Unterschrift:</p>'+
      '<div class="op-sign-trips">'+rides.map(x=>'<p><b>'+esc(x.ride_date)+' · '+esc(x.ride_time)+'</b> · '+esc(x.pickup)+' → '+esc(x.destination)+'</p>').join('')+'</div>'+
      '<label class="op-sign-label">Name der unterzeichnenden Person<input id="op-signer" maxlength="120" placeholder="Vor- und Nachname"></label>'+
      '<label class="op-sign-label">Unterschrift auf dem Bildschirm<canvas id="op-sign-canvas" width="600" height="180" aria-label="Handschriftliche Unterschrift"></canvas></label>'+
      '<label class="op-sign-confirm"><input id="op-sign-consent" type="checkbox"> Ich bestätige, dass die genannten Fahrten zur Unterschrift vorgelegt wurden und die unterzeichnende Person den Inhalt sehen konnte.</label>'+
      '<div class="op-actions"><button type="button" class="btn" id="op-sign-clear">Neu zeichnen</button><button type="button" class="btn gold" id="op-sign-send">Unterschrift gesichert ablegen</button></div>';
    document.body.append(dialog);
    dialog.showModal();openedSignature=true;
    const canvas=dialog.querySelector('#op-sign-canvas'),ctx=canvas.getContext('2d');
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.strokeStyle='#152334';ctx.lineWidth=3;ctx.lineJoin='round';ctx.lineCap='round';
    let drawing=false,strokes=0;
    const coords=e=>{const rect=canvas.getBoundingClientRect();return {
      x:(e.clientX-rect.left)*canvas.width/rect.width,y:(e.clientY-rect.top)*canvas.height/rect.height
    }};
    canvas.style.touchAction='none';
    canvas.addEventListener('pointerdown',e=>{drawing=true;canvas.setPointerCapture(e.pointerId);const p=coords(e);ctx.beginPath();ctx.moveTo(p.x,p.y);});
    canvas.addEventListener('pointermove',e=>{if(!drawing)return;const p=coords(e);ctx.lineTo(p.x,p.y);ctx.stroke();strokes++;});
    const stop=()=>drawing=false;canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);
    dialog.querySelector('#op-sign-close').onclick=()=>dialog.close();
    dialog.querySelector('#op-sign-clear').onclick=()=>{ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);strokes=0;};
    dialog.addEventListener('close',()=>{openedSignature=false;dialog.remove()});
    dialog.querySelector('#op-sign-send').onclick=async()=>{
      const signer=dialog.querySelector('#op-signer').value.trim(),consent=dialog.querySelector('#op-sign-consent').checked;
      if(signer.length<2||!consent||strokes<5){toast('Name, Bestätigung und tatsächliche Unterschrift erforderlich.');return;}
      const btn=dialog.querySelector('#op-sign-send');btn.disabled=true;
      try{
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        if(!blob||blob.size>350000)throw Error('Signaturbild zu groß oder konnte nicht erzeugt werden.');
        const res=await fetch(getBase()+'/api/signatures',{method:'POST',headers:{
          Authorization:'Bearer '+getSession(),'Content-Type':'image/png',
          'x-taxipro-signer':signer,'x-taxipro-confirm':'yes',
          'x-taxipro-ride-ids':JSON.stringify(rides.map(x=>x.id))
        },body:blob});
        const answer=await res.json();
        if(!res.ok)throw Error(answer.error||'Unterschrift konnte nicht gespeichert werden.');
        dialog.close();toast('Unterschrift mit Fahrtenliste sicher gespeichert.');await rerender();
      }catch(e){toast(e.message)}finally{btn.disabled=false;}
    };
  }
  async function runOperation(action,node) {
    if(action==='my-location'){
      try{point=await getLocation();const label=$('op-point-label');if(label)label.textContent='GPS: '+point.latitude.toFixed(4)+', '+point.longitude.toFixed(4);map?.flyTo({center:[point.longitude,point.latitude],zoom:13})}
      catch(e){toast(e.message)}return;
    }
    if(action==='load-time'){await fetchTime();return;}
    if(action==='print-time'){window.print();return;}
    if(action==='notify'){
      if(!('Notification' in window)){toast('Systembenachrichtigungen hier nicht verfügbar.');return;}
      const p=await Notification.requestPermission();
      toast(p==='granted'?'Hinweise bei geöffneter App erlaubt.':'Benachrichtigungen nicht erlaubt.');return;
    }
    if(action==='pin-file'){
      await request('/api/attachments/'+node.dataset.id+'/pin','PATCH',{pinned:node.dataset.pinned!=='1'});
      await rerender();toast('Dokumentenübersicht aktualisiert.');return;
    }
    if(action==='download-file'||action==='download-signature'){
      await download(action==='download-file'?'/api/attachments/'+node.dataset.id:'/api/signatures/'+node.dataset.id+'/file',
        action==='download-file'?(node.dataset.name||'Datei.pdf'):'fahrtunterschrift.png');return;
    }
    if(action==='start-signature'){await showSignature((node.dataset.rides||'').split(','));return;}
    const decisions={ 'swap-accept':'accept','swap-decline':'decline','swap-cancel':'cancel','swap-approve':'approve','swap-reject':'reject' };
    if(decisions[action]){
      if(action==='swap-approve'&&!confirm('Fahrerzuordnung endgültig an den anderen Fahrer übertragen?'))return;
      await request('/api/swaps/'+node.dataset.id,'PATCH',{action:decisions[action]});await rerender();return;
    }
    if(action==='resolve-report'){
      await request('/api/traffic-reports/'+node.dataset.id,'PATCH',{action:'resolve'});await rerender();return;
    }
  }
  function initListeners() {
    document.addEventListener('click',async e=>{
      const el=e.target.closest('[data-operation]');
      if(!el)return;
      try{await runOperation(el.dataset.operation,el)}catch(err){toast(err.message)}
    });
    document.addEventListener('submit',async e=>{
      if(!['op-traffic-form','op-upload-form','op-swap-form'].includes(e.target.id))return;
      e.preventDefault();
      const btn=e.target.querySelector('button[type="submit"]');if(btn)btn.disabled=true;
      try{
        if(e.target.id==='op-traffic-form'){
          const where=point||await getLocation();
          await request('/api/traffic-reports','POST',{category:$('op-traffic-type').value,road:$('op-traffic-road').value,
            description:$('op-traffic-description').value,latitude:where.latitude,longitude:where.longitude,accuracy:where.accuracy});
          point=null;toast('Die Verkehrsmeldung wurde an das Team übermittelt.');
          await rerender();
        } else if(e.target.id==='op-upload-form')await privateUpload();
        else {
          await request('/api/swaps','POST',{rideId:$('op-swap-ride').value,targetDriverId:$('op-swap-target').value,reason:$('op-swap-reason').value});
          toast('Tauschanfrage gesendet. Sie muss bestätigt und von der Zentrale genehmigt werden.');
          await rerender();
        }
      }catch(err){toast(err.message)}finally{if(btn)btn.disabled=false}
    });
    document.addEventListener('change',e=>{
      if(e.target.id==='op-time-period')period=e.target.value;
      if(e.target.id==='op-time-date')date=e.target.value;
    });
  }
  function onRefresh(oldDb,newDb,me) {
    const messages=newDb?.messages||[],reports=newDb?.trafficReports||[];
    if(seenMessages===null){seenMessages=new Set(messages.map(x=>x.id));seenReports=new Set(reports.map(x=>x.id));return;}
    const newMsg=messages.find(x=>!seenMessages.has(x.id)&&x.sender_id!==me.id);
    const newRep=reports.find(x=>!seenReports.has(x.id)&&x.reporter_id!==me.id);
    seenMessages=new Set(messages.map(x=>x.id));seenReports=new Set(reports.map(x=>x.id));
    if(newMsg)sendNotification('TaxiPro · Neue Teamnachricht',newMsg.sender_name+': '+newMsg.body.slice(0,100));
    else if(newRep)sendNotification('TaxiPro · Verkehrsmeldung',newRep.road+': '+newRep.description.slice(0,100));
  }
  function sendNotification(title,body) {
    if(!('Notification' in window)||Notification.permission!=='granted'||document.visibilityState!=='visible')return;
    navigator.serviceWorker?.ready.then(reg=>reg.showNotification(title,{body,tag:'taxipro-community',icon:'icons/icon-192.png'}))
      .catch(()=>{});
  }
  initListeners();
  return {view,mount,chatExtra,onRefresh,fetchTime,setTripFocus};
}
