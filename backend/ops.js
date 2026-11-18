/**
 * TaxiPro 2.4 secure customer-and-journey API.
 * All calls are after worker.js session verification. Never expose to GitHub Pages unauthenticated.
 */
import {displayPrefs,berlinServiceDate,signatureSheetModel} from './reconcile.js';
import {syncSources,isGoogleConfigured,searchGoogleContacts} from './google-sync.js';
import {berlinMidnight} from './time-summary.js';

const uuid=()=>crypto.randomUUID();
const now=()=>new Date().toISOString();
const requireAdmin=u=>{if(u.role!=='admin')throw Object.assign(new Error('Nur für Disponenten.'),{status:403});};
const bad=(code,msg)=>Object.assign(new Error(msg),{status:code});
const t=(v,n=200)=>typeof v==='string'?v.trim().slice(0,n):'';
const dt=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T12:00:00Z'));
const validId=v=>/^[a-f0-9-]{36}$/i.test(v);
async function parse(req){
  if(!(req.headers.get('content-type')||'').includes('application/json'))throw bad(415,'JSON erforderlich.');
  if(Number(req.headers.get('content-length')||0)>12000)throw bad(413,'Anfrage zu groß.');
  let d;try{d=await req.json()}catch{throw bad(400,'Ungültiges JSON.')}
  if(!d||typeof d!=='object'||Array.isArray(d)||JSON.stringify(d).length>12000)throw bad(400,'Ungültige Daten.');
  return d;
}
async function log(db,user,event,id='',details=''){
  await db.prepare('INSERT INTO audit(id,actor_id,event,entity_id,details,created_at) VALUES(?,?,?,?,?,?)')
    .bind(uuid(),user.id,event,id,t(details,300),now()).run();
}
const numberLimit=(raw,max)=>Math.max(1,Math.min(max,Number(raw)||max));
async function dashboard(db,u,search){
  requireAdmin(u);
  const date=search.get('date')||berlinServiceDate(now());
  if(!dt(date))throw bad(400,'Datum ungültig.');
  const daily=await db.prepare(`SELECT ride_status,COUNT(*) AS n FROM journey_ledger WHERE service_date=? GROUP BY ride_status`).bind(date).all();
  const statuses=Object.fromEntries((daily.results||[]).map(r=>[r.ride_status,r.n]));
  const [yr,mon,day]=date.split('-').map(Number);
  const calendarStart=new Date(berlinMidnight(yr,mon,day)).toISOString();
  const calendarEnd=new Date(berlinMidnight(yr,mon,day+1)).toISOString();
  const [total,unmatched,sync,active,latest,calendarToday]=await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM customers WHERE active=1').first(),
    db.prepare("SELECT COUNT(*) AS n FROM calendar_imports WHERE match_state='review' AND status!='cancelled'").first(),
    db.prepare('SELECT * FROM sync_checkpoints ORDER BY source').all(),
    db.prepare('SELECT COUNT(*) AS n FROM shifts WHERE ended_at IS NULL').first(),
    db.prepare(`SELECT l.id,l.service_date,l.pickup_time,l.pickup,l.destination,l.direction,l.ride_status,l.billing_class,
      c.name AS customer_name,c.id AS customer_id,u.display_name AS driver_name
      FROM journey_ledger l JOIN customers c ON c.id=l.customer_id
      LEFT JOIN users u ON u.id=l.driver_id WHERE l.service_date=? ORDER BY l.pickup_time,l.id LIMIT 120`).bind(date).all(),
    db.prepare(`SELECT i.id,i.start_at,i.event_title,i.match_state,i.status,i.customer_id,c.name AS customer_name
      FROM calendar_imports i LEFT JOIN customers c ON c.id=i.customer_id
      WHERE i.start_at>=? AND i.start_at<? AND i.status!='cancelled'
      ORDER BY i.start_at,i.id LIMIT 120`).bind(calendarStart,calendarEnd).all()
  ]);
  return {date,counts:{customers:total?.n||0,unmatched:unmatched?.n||0,activeDrivers:active?.n||0,
    planned:statuses.planned||0,reported:statuses.reported||0,confirmed:statuses.confirmed||0,cancelled:statuses.cancelled||0},
    latest:(latest.results||[]),calendarToday:(calendarToday.results||[]),sources:(sync.results||[])};
}
async function customers(db,u,search){
  requireAdmin(u);
  const query=t(search.get('q')||'',70),limit=numberLimit(search.get('limit'),100);
  const q=`SELECT c.id,c.name,c.pickup,c.destination,c.kind,c.signature_required,
       x.external_key AS customer_code, s.billing_class,s.prescription_status,s.approval_status,
       s.copayment_status,s.approval_valid_until,s.prescription_valid_until,s.phone,
       (SELECT COUNT(*) FROM journey_ledger l WHERE l.customer_id=c.id) AS journey_count
       FROM customers c LEFT JOIN customer_source_links x ON x.customer_id=c.id AND x.source='master_sheet'
       LEFT JOIN customer_case_status s ON s.customer_id=c.id
       WHERE c.active=1 AND (?='' OR c.name LIKE ? OR x.external_key LIKE ?)
       ORDER BY c.name,c.id LIMIT ?`;
  const like='%'+query.replace(/[%_]/g,'')+'%';
  const result=await db.prepare(q).bind(query,like,like,limit).all();
  return {customers:result.results||[]};
}
async function customerDetail(db,u,id,search){
  requireAdmin(u);
  const customer=await db.prepare(`SELECT c.*,x.external_key AS customer_code,s.billing_class,s.prescription_status,
    s.approval_status,s.copayment_status,s.approval_valid_until,s.prescription_valid_until,
    s.phone,s.external_document_reference,s.review_note,s.reviewed_at,s.updated_at
    FROM customers c LEFT JOIN customer_source_links x ON x.customer_id=c.id AND x.source='master_sheet'
    LEFT JOIN customer_case_status s ON s.customer_id=c.id WHERE c.id=? AND c.active=1`).bind(id).first();
  if(!customer)throw bad(404,'Kunde nicht gefunden.');
  const routes=await db.prepare('SELECT * FROM customer_routes WHERE customer_id=? AND active=1 ORDER BY is_primary DESC,label LIMIT 60').bind(id).all();
  const from=search.get('from')||new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  const to=search.get('to')||new Date().toISOString().slice(0,10);
  if(!dt(from)||!dt(to)||from>to)throw bad(400,'Zeitraum ungültig.');
  const journeys=await db.prepare(`SELECT l.*,u.display_name AS driver_name FROM journey_ledger l
      LEFT JOIN users u ON u.id=l.driver_id WHERE l.customer_id=? AND l.service_date BETWEEN ? AND ?
      ORDER BY l.service_date,l.pickup_time LIMIT 700`).bind(id,from,to).all();
  const evidence=await db.prepare(`SELECT source,external_key,source_status,valid_from,valid_until,document_in_drive,observed_at
    FROM customer_source_evidence WHERE customer_id=? ORDER BY observed_at DESC LIMIT 100`).bind(id).all();
  return {customer,routes:routes.results||[],journeys:journeys.results||[],evidence:evidence.results||[],from,to};
}
async function updateCase(req,db,u,id){
  requireAdmin(u);const d=await parse(req);
  const existing=await db.prepare('SELECT id FROM customers WHERE id=? AND active=1').bind(id).first();
  if(!existing)throw bad(404,'Kunde nicht gefunden.');
  const values={
    billing_class:['KTS','RE','private','unknown'],prescription_status:['unknown','present','missing','expired','not_required'],
    approval_status:['unknown','pending','approved','rejected','expired','not_required'],
    copayment_status:['unknown','exempt','not_exempt']
  };
  const current=await db.prepare('SELECT * FROM customer_case_status WHERE customer_id=?').bind(id).first();
  const fields={};
  for(const [key,valid] of Object.entries(values)){
    const value=d[key]??current?.[key]??valid[0];
    if(!valid.includes(value))throw bad(400,'Statusfeld ungültig: '+key);
    fields[key]=value;
  }
  for(const name of ['approval_valid_until','prescription_valid_until']){
    const value=d[name]===undefined?current?.[name]||null:d[name]||null;
    if(value&&!dt(value))throw bad(400,'Gültigkeit ungültig: '+name);
    fields[name]=value;
  }
  fields.review_note=d.review_note===undefined?current?.review_note||'':t(d.review_note,350);
  // Do not accept a user-supplied public Drive sharing URL.
  const stamp=now();
  await db.prepare(`INSERT INTO customer_case_status(customer_id,billing_class,prescription_status,approval_status,copayment_status,
      approval_valid_until,prescription_valid_until,review_note,reviewed_at,reviewed_by,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(customer_id) DO UPDATE SET billing_class=excluded.billing_class,
       prescription_status=excluded.prescription_status,approval_status=excluded.approval_status,
       copayment_status=excluded.copayment_status,approval_valid_until=excluded.approval_valid_until,
       prescription_valid_until=excluded.prescription_valid_until,review_note=excluded.review_note,
       reviewed_at=excluded.reviewed_at,reviewed_by=excluded.reviewed_by,updated_at=excluded.updated_at`)
    .bind(id,fields.billing_class,fields.prescription_status,fields.approval_status,fields.copayment_status,
      fields.approval_valid_until,fields.prescription_valid_until,fields.review_note,stamp,u.id,stamp).run();
  await log(db,u,'customer.case_reviewed',id);
  return {ok:true,reviewedAt:stamp};
}
async function addRoute(req,db,u,id){
  requireAdmin(u);const d=await parse(req);
  const owner=await db.prepare('SELECT id FROM customers WHERE id=? AND active=1').bind(id).first();
  if(!owner)throw bad(404,'Kunde nicht gefunden.');
  const label=t(d.label,90),pickup=t(d.pickup,180),destination=t(d.destination,180);
  const bill=t(d.billingClass,30)||'unknown';
  if(!label||!pickup||!destination||!['KTS','RE','private','unknown'].includes(bill))throw bad(400,'Streckenangaben unvollständig.');
  const key=uuid(),stamp=now();
  await db.prepare(`INSERT INTO customer_routes(id,customer_id,label,pickup,destination,billing_class,is_primary,source,created_at,updated_at)
    VALUES(?,?,?,?,?,?,0,'manual',?,?)`).bind(key,id,label,pickup,destination,bill,stamp,stamp).run();
  await log(db,u,'customer.route_created',key,id);
  return {id:key};
}

async function importConflicts(db,u) {
  requireAdmin(u);
  const entries=await db.prepare(`SELECT external_key,proposed_name,candidate_customer_ids,seen_at,status
    FROM customer_import_conflicts WHERE status='review' ORDER BY seen_at DESC LIMIT 120`).all();
  const result=[];
  for(const c of entries.results||[]) {
    let candidates=[];try{candidates=JSON.parse(c.candidate_customer_ids||'[]')}catch{}
    const available=[];
    for(const id of candidates.slice(0,15)){
      const row=await db.prepare("SELECT id,name FROM customers WHERE id=? AND active=1").bind(id).first();
      if(row)available.push(row);
    }
    result.push({externalKey:c.external_key,proposedName:c.proposed_name,candidates:available,seenAt:c.seen_at});
  }
  return {conflicts:result};
}
async function resolveImportConflict(req,db,u,externalKey) {
  requireAdmin(u);
  if(!/^K[0-9]{4,6}$/.test(externalKey))throw bad(400,'Kunden-ID ungültig.');
  const d=await parse(req),action=t(d.action,20);
  if(!['link','separate'].includes(action))throw bad(400,'Importaktion ungültig.');
  const row=await db.prepare("SELECT * FROM customer_import_conflicts WHERE external_key=? AND status='review'").bind(externalKey).first();
  if(!row)throw bad(404,'Offener Importkonflikt nicht gefunden.');
  let customerId=d.customerId;
  if(action==='link') {
    if(!validId(customerId))throw bad(400,'Passenden Kunden manuell auswählen.');
    const existing=await db.prepare('SELECT id FROM customers WHERE id=? AND active=1').bind(customerId).first();
    if(!existing)throw bad(404,'Kundenakte existiert nicht.');
  } else customerId=uuid();
  const stamp=now();
  try{
    await db.batch([
      ...(action==='separate'?[db.prepare("INSERT INTO customers(id,name,pickup,destination,kind,created_at) VALUES(?,?,'','','Rechnungsfahrt',?)")
        .bind(customerId,row.proposed_name,stamp)]:[]),
      db.prepare(`INSERT INTO customer_source_links(source,source_account,external_key,customer_id,first_seen_at,last_seen_at)
        VALUES('master_sheet','google_master',?,?,?,?)`).bind(externalKey,customerId,stamp,stamp),
      db.prepare("UPDATE customer_import_conflicts SET status=?,resolved_at=?,resolved_by=? WHERE external_key=? AND status='review'")
        .bind(action==='link'?'linked':'separate',stamp,u.id,externalKey),
      db.prepare('INSERT INTO audit(id,actor_id,event,entity_id,details,created_at) VALUES(?,?,?,?,?,?)')
        .bind(uuid(),u.id,'master.conflict_'+action,customerId,externalKey,stamp)
    ]);
  }catch(e){throw bad(409,'Importkonflikt wurde bereits bearbeitet. Bitte neu laden.');}
  return {externalKey,customerId,resolved:true,action};
}
async function calendarReview(db,u,search){
  requireAdmin(u);
  const state=search.get('state')||'review';
  if(!['review','matched','ignored','all'].includes(state))throw bad(400,'Filter ungültig.');
  const q=`SELECT i.id,i.source_account,i.calendar_id,i.provider_event_id,i.start_at,i.end_at,i.event_title,
      i.description_excerpt,i.location_excerpt,i.status,i.match_state,i.customer_id,i.match_reason,
      i.event_url,c.name AS customer_name FROM calendar_imports i LEFT JOIN customers c ON c.id=i.customer_id
      WHERE (?='all' OR i.match_state=?) ORDER BY i.start_at DESC LIMIT 200`;
  const rows=await db.prepare(q).bind(state,state).all();
  return {entries:rows.results||[]};
}
async function linkCalendar(req,db,u,id){
  requireAdmin(u);const d=await parse(req),action=t(d.action,15);
  if(!['link','ignore'].includes(action))throw bad(400,'Aktion ungültig.');
  const event=await db.prepare('SELECT * FROM calendar_imports WHERE id=?').bind(id).first();
  if(!event)throw bad(404,'Kalendereintrag nicht gefunden.');
  if(event.match_state==='matched'&&action==='link'&&event.customer_id===d.customerId)return {alreadyMatched:true};
  if(action==='ignore'){
    await db.prepare("UPDATE calendar_imports SET match_state='ignored',customer_id=NULL,match_reason='Manuell ausgeschlossen' WHERE id=?").bind(id).run();
    await log(db,u,'calendar.ignored',id);return {ignored:true};
  }
  if(!validId(d.customerId))throw bad(400,'Kunden-ID fehlt.');
  const customer=await db.prepare('SELECT id FROM customers WHERE id=? AND active=1').bind(d.customerId).first();
  if(!customer)throw bad(404,'Kunde nicht gefunden.');
  await db.prepare("UPDATE calendar_imports SET match_state='matched',customer_id=?,match_reason='Disponent bestätigt' WHERE id=?")
    .bind(d.customerId,id).run();
  await log(db,u,'calendar.linked',id,d.customerId);
  return {id,customerId:d.customerId,linked:true,rideCreated:false};
}
async function createLedger(req,db,u){
  requireAdmin(u);const d=await parse(req);
  const customerId=t(d.customerId,80);
  if(!validId(customerId))throw bad(400,'Kunde wählen.');
  const customer=await db.prepare('SELECT id FROM customers WHERE id=? AND active=1').bind(customerId).first();
  if(!customer)throw bad(404,'Kunde nicht gefunden.');
  const date=t(d.serviceDate,10),time=t(d.pickupTime,5),pickup=t(d.pickup,180),dest=t(d.destination,180);
  const direction=t(d.direction,10)||'unknown',billing=t(d.billingClass,20)||'unknown';
  const status=t(d.rideStatus,20)||'planned';
  if(!dt(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||!pickup||!dest||
     !['hin','rueck','unknown'].includes(direction)||
     !['KTS','RE','private','unknown'].includes(billing)||
     !['planned','reported','confirmed'].includes(status))throw bad(400,'Fahrtangaben unvollständig.');
  if(status==='confirmed'&&t(d.note,300).length<8)
    throw bad(400,'Direkte Bestätigung benötigt eine dokumentierte Prüfnotiz.');
  const calendarId=d.calendarImportId||null;
  if(calendarId&&!validId(calendarId))throw bad(400,'Kalender-ID ungültig.');
  if(calendarId){
    const event=await db.prepare('SELECT customer_id,match_state,status FROM calendar_imports WHERE id=?').bind(calendarId).first();
    if(!event||event.customer_id!==customerId||event.match_state!=='matched'||event.status==='cancelled')
      throw bad(409,'Kalenderfahrt muss zuerst dem richtigen Kunden zugeordnet werden.');
  }
  const key=uuid(),stamp=now();
  try{
    await db.prepare(`INSERT INTO journey_ledger(id,customer_id,calendar_import_id,service_date,pickup_time,pickup,destination,
      direction,billing_class,ride_status,operator_note,driver_id,recorded_at,updated_at,verified_at,verified_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(key,customerId,calendarId,date,time,pickup,dest,direction,billing,status,t(d.note,300),
       d.driverId&&validId(d.driverId)?d.driverId:null,stamp,stamp,status==='confirmed'?stamp:null,status==='confirmed'?u.id:null).run();
  }catch(e){if(String(e.message).includes('UNIQUE'))throw bad(409,'Die Fahrt ist bereits im Journal erfasst.');throw e;}
  await log(db,u,'journey.created',key,date+' '+status);
  return {id:key,rideStatus:status};
}
async function ledgerList(db,u,search){
  requireAdmin(u);
  const from=search.get('from')||berlinServiceDate(now()),to=search.get('to')||from;
  const id=search.get('customerId')||null;
  if(!dt(from)||!dt(to)||from>to||id&&!validId(id))throw bad(400,'Filter ungültig.');
  const query=`SELECT l.*,c.name AS customer_name,x.external_key AS customer_code
    FROM journey_ledger l JOIN customers c ON c.id=l.customer_id
    LEFT JOIN customer_source_links x ON x.customer_id=c.id AND x.source='master_sheet'
    WHERE l.service_date BETWEEN ? AND ? AND (? IS NULL OR l.customer_id=?)
    ORDER BY l.service_date,l.pickup_time LIMIT 1800`;
  const r=await db.prepare(query).bind(from,to,id,id).all();
  return {entries:r.results||[],from,to};
}
async function updateLedger(req,db,u,id){
  requireAdmin(u);const d=await parse(req),status=t(d.rideStatus,20),note=t(d.note,300);
  if(!['planned','reported','confirmed','cancelled'].includes(status))throw bad(400,'Status ungültig.');
  const existing=await db.prepare('SELECT ride_status FROM journey_ledger WHERE id=?').bind(id).first();
  if(!existing)throw bad(404,'Fahrt nicht gefunden.');
  if(existing.ride_status==='cancelled'&&status!=='cancelled')throw bad(409,'Stornierte Fahrten zuerst manuell prüfen.');
  if(status==='confirmed'&&note.length<8)throw bad(400,'Bestätigung benötigt eine kurze Prüfnotiz.');
  const timestamp=now();
  await db.prepare(`UPDATE journey_ledger SET ride_status=?,operator_note=?,updated_at=?,
    verified_at=?,verified_by=? WHERE id=?`)
    .bind(status,note,timestamp,status==='confirmed'?timestamp:null,status==='confirmed'?u.id:null,id).run();
  await log(db,u,'journey.status',id,status);
  return {id,rideStatus:status};
}
async function printData(db,u,search) {
  requireAdmin(u);
  const id=search.get('customerId');
  if(!validId(id))throw bad(400,'Kunde wählen.');
  const from=search.get('from'),to=search.get('to');
  if(!dt(from)||!dt(to)||from>to)throw bad(400,'Zeitraum ungültig.');
  const c=await db.prepare(`SELECT c.id,c.name,x.external_key FROM customers c
    LEFT JOIN customer_source_links x ON x.customer_id=c.id AND x.source='master_sheet'
    WHERE c.id=? AND c.active=1`).bind(id).first();
  if(!c)throw bad(404,'Kunde nicht gefunden.');
  const q=await db.prepare(`SELECT * FROM journey_ledger WHERE customer_id=? AND service_date BETWEEN ? AND ?
    AND ride_status IN ('reported','confirmed') AND direction IN ('hin','rueck')
    ORDER BY service_date,pickup_time LIMIT 150`)
    .bind(id,from,to).all();
  if(!(q.results||[]).length)throw bad(404,'Keine gemeldeten oder bestätigten Fahrten im Zeitraum.');
  const selected=(q.results||[]).filter(x=>x.pickup&&x.destination);
  return signatureSheetModel({id:c.id,name:c.name,externalKey:c.external_key},selected);
}
async function readPrefs(db,u){
  const row=await db.prepare('SELECT settings_json,revision,updated_at FROM user_display_settings WHERE user_id=?').bind(u.id).first();
  let settings={};try{settings=JSON.parse(row?.settings_json||'{}')}catch{}
  return {settings:displayPrefs(settings),revision:row?.revision||0,updatedAt:row?.updated_at||null};
}
async function savePrefs(req,db,u){
  const d=await parse(req),settings=displayPrefs(d.settings),version=Number(d.revision);
  if(!Number.isInteger(version)||version<0)throw bad(400,'Revision erforderlich.');
  const row=await db.prepare('SELECT revision FROM user_display_settings WHERE user_id=?').bind(u.id).first();
  if((row?.revision||0)!==version)throw bad(409,'Einstellungen auf einem anderen Gerät geändert. Bitte neu laden.');
  const stamp=now(),json=JSON.stringify(settings);
  if(row){
    const change=await db.prepare('UPDATE user_display_settings SET settings_json=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=?')
      .bind(json,stamp,u.id,version).run();
    if(!change.meta?.changes)throw bad(409,'Gleichzeitige Änderung; bitte neu laden.');
  }else{
    try{await db.prepare('INSERT INTO user_display_settings(user_id,settings_json,revision,updated_at) VALUES(?,?,1,?)')
      .bind(u.id,json,stamp).run()}catch{throw bad(409,'Einstellungen wurden gleichzeitig auf einem anderen Gerät erstellt.');}
  }
  return {settings,revision:version+1,updatedAt:stamp};
}
export async function handleOps(req,env,u,path){
  const db=env.DB,search=new URL(req.url).searchParams,m=req.method;
  if(path==='/api/ops/contacts'&&m==='GET'){
    requireAdmin(u);
    return {data:await searchGoogleContacts(env,search.get('q'))};
  }
  if(path==='/api/ops/sources'&&m==='GET'){
    requireAdmin(u);
    const rows=await db.prepare('SELECT * FROM sync_checkpoints ORDER BY source').all();
    return {data:{sources:rows.results||[],connections:{
      calendarConfigured:!!isGoogleConfigured(env,'calendar'),
      masterConfigured:!!isGoogleConfigured(env,'sheets'),
      contactsConfigured:!!isGoogleConfigured(env,'contacts')
    }}};
  }
  if(path==='/api/ops/sync'&&m==='POST'){
    requireAdmin(u);
    const d=await parse(req),which=t(d.which,12)||'both';
    if(!['both','calendar','master'].includes(which))throw bad(400,'Quelle unbekannt.');
    const state=await db.prepare("SELECT last_attempt_at FROM sync_checkpoints WHERE source=?").bind(which==='master'?'google_master':'google_calendar_taxi').first();
    if(state?.last_attempt_at&&Date.now()-Date.parse(state.last_attempt_at)<4*60000)
       throw bad(429,'Letzter Abgleich ist weniger als vier Minuten her.');
    const result=await syncSources(db,env,which);
    await log(db,u,'sync.requested','',which);
    return {data:result};
  }
  if(path==='/api/ops/dashboard'&&m==='GET')return {data:await dashboard(db,u,search)};
  if(path==='/api/ops/customers'&&m==='GET')return {data:await customers(db,u,search)};
  const customer=path.match(/^\/api\/ops\/customers\/([a-f0-9-]{36})$/i);
  if(customer&&m==='GET')return {data:await customerDetail(db,u,customer[1],search)};
  const caseRoute=path.match(/^\/api\/ops\/customers\/([a-f0-9-]{36})\/case$/i);
  if(caseRoute&&m==='PATCH')return {data:await updateCase(req,db,u,caseRoute[1])};
  const route=path.match(/^\/api\/ops\/customers\/([a-f0-9-]{36})\/routes$/i);
  if(route&&m==='POST')return {status:201,data:await addRoute(req,db,u,route[1])};
  if(path==='/api/ops/master-conflicts'&&m==='GET')return {data:await importConflicts(db,u)};
  const conflicted=path.match(/^\/api\/ops\/master-conflicts\/(K[0-9]{4,6})$/i);
  if(conflicted&&m==='PATCH')return {data:await resolveImportConflict(req,db,u,conflicted[1].toUpperCase())};
  if(path==='/api/ops/calendar'&&m==='GET')return {data:await calendarReview(db,u,search)};
  const review=path.match(/^\/api\/ops\/calendar\/([a-f0-9-]{36})$/i);
  if(review&&m==='PATCH')return {data:await linkCalendar(req,db,u,review[1])};
  if(path==='/api/ops/ledger'&&m==='GET')return {data:await ledgerList(db,u,search)};
  if(path==='/api/ops/ledger'&&m==='POST')return {status:201,data:await createLedger(req,db,u)};
  const ledger=path.match(/^\/api\/ops\/ledger\/([a-f0-9-]{36})$/i);
  if(ledger&&m==='PATCH')return {data:await updateLedger(req,db,u,ledger[1])};
  if(path==='/api/ops/signature-sheet'&&m==='GET')return {data:await printData(db,u,search)};
  if(path==='/api/ui-settings'&&m==='GET')return {data:await readPrefs(db,u)};
  if(path==='/api/ui-settings'&&m==='PATCH')return {data:await savePrefs(req,db,u)};
  return undefined;
}
