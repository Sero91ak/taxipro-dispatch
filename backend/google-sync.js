/**
 * TaxiPro Google READ-ONLY bridge.
 *
 * All OAuth refresh tokens are private Cloudflare Worker secrets, not ChatGPT
 * connector tokens. Calendar and Sheets may belong to DIFFERENT Google accounts.
 * No source edits, no patient documents, no notes or IDs sent to GitHub.
 */
import {masterCustomers,matchCalendarCustomer,normalizedGoogleEvent,berlinServiceDate} from './reconcile.js';

const fresh=()=>new Date().toISOString(),ID=()=>crypto.randomUUID();
const fail=(code,m)=>Object.assign(new Error(m),{status:code});
const SCOPES={
 calendar:['GOOGLE_TAXI_CLIENT_ID','GOOGLE_TAXI_CLIENT_SECRET','GOOGLE_TAXI_REFRESH_TOKEN','GOOGLE_TAXI_CALENDAR_ID'],
 sheets:['GOOGLE_MASTER_CLIENT_ID','GOOGLE_MASTER_CLIENT_SECRET','GOOGLE_MASTER_REFRESH_TOKEN','GOOGLE_MASTER_SHEET_ID'],
 contacts:['GOOGLE_CONTACTS_CLIENT_ID','GOOGLE_CONTACTS_CLIENT_SECRET','GOOGLE_CONTACTS_REFRESH_TOKEN']
};
export function isGoogleConfigured(env,source){
 return (SCOPES[source]||[]).every(k=>typeof env[k]==='string'&&env[k].trim());
}
async function token(env,source) {
 if(!isGoogleConfigured(env,source))return null;
 const prefix=source==='calendar'?'GOOGLE_TAXI_':source==='contacts'?'GOOGLE_CONTACTS_':'GOOGLE_MASTER_';
 const form=new URLSearchParams({
   client_id:env[prefix+'CLIENT_ID'],client_secret:env[prefix+'CLIENT_SECRET'],
   refresh_token:env[prefix+'REFRESH_TOKEN'],grant_type:'refresh_token'
 });
 const r=await fetch('https://oauth2.googleapis.com/token',{
   method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:form,signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw fail(503,'Google-OAuth-Aktualisierung fehlgeschlagen (HTTP '+r.status+').');
 const data=await r.json();
 if(!data?.access_token||typeof data.access_token!=='string')throw fail(503,'Google-Zugang nicht verfügbar.');
 return data.access_token;
}
async function googleJSON(url,accessToken){
 if(!url.startsWith('https://www.googleapis.com/')&&!url.startsWith('https://people.googleapis.com/'))
    throw fail(500,'Google-Endpunkt nicht zugelassen.');
 const r=await fetch(url,{headers:{Authorization:'Bearer '+accessToken},signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw fail(503,'Google-Quelle nicht erreichbar (HTTP '+r.status+').');
 const d=await r.json();
 if(!d||typeof d!=='object')throw fail(503,'Google-Quelle lieferte ungültiges Format.');
 return d;
}
async function setCheckpoint(db,source,status,error='',count=0) {
 const stamp=fresh();
 await db.prepare(`INSERT INTO sync_checkpoints(source,last_attempt_at,last_success_at,status,last_error,items_seen)
  VALUES(?,?,?, ?,?,?)
  ON CONFLICT(source) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,
  last_success_at=CASE WHEN excluded.status='ok' THEN excluded.last_success_at ELSE sync_checkpoints.last_success_at END,
  status=excluded.status,last_error=excluded.last_error,items_seen=excluded.items_seen`)
  .bind(source,stamp,status==='ok'?stamp:null,status,error.slice(0,120),count).run();
}
function mergeColumns(...groups){
 const max=Math.max(...groups.map(g=>g.length));
 return Array.from({length:max},(_,i)=>groups.flatMap(g=>g[i]||[]));
}
async function batchValues(sheetId,ranges,accessToken){
 const url=new URL('https://www.googleapis.com/sheets/v4/spreadsheets/'+encodeURIComponent(sheetId)+'/values:batchGet');
 for(const r of ranges)url.searchParams.append('ranges',r);
 url.searchParams.set('valueRenderOption','FORMATTED_VALUE');
 const response=await googleJSON(url.href,accessToken);
 if(!Array.isArray(response.valueRanges))throw fail(503,'Google Sheets Antwort nicht vollständig.');
 return ranges.map((r,i)=>response.valueRanges[i]?.values||[]);
}
export async function pullMaster(db,env) {
 const source='google_master';
 if(!isGoogleConfigured(env,'sheets')){
  await setCheckpoint(db,source,'unconfigured','Google-Drive-OAuth für TaxiPro nicht eingerichtet.');
  return {configured:false,created:0};
 }
 await setCheckpoint(db,source,'running');
 let count=0,created=0,changed=0;
 try{
  const access=await token(env,'sheets'),sid=env.GOOGLE_MASTER_SHEET_ID;
  const [names,phones,copays,targets,approvalKeys,approvalDates,approvalStatuses,rxKeys,rxDates]=await batchValues(sid,[
    "'Kundenstamm'!A1:C1001","'Kundenstamm'!I1:I1001","'Kundenstamm'!L1:L1001","'Kundenstamm'!O1:O1001",
    "'Genehmigungen'!A1:B1001","'Genehmigungen'!F1:G1001","'Genehmigungen'!N1:N1001",
    "'Verordnungen'!A1:B1001","'Verordnungen'!J1:K1001"
  ],access);
  const vals=mergeColumns(names,phones,copays,targets);
  vals[0]=['Kunden-ID','Nachname','Vorname','Telefon','Zuzahlung/Befreiung','Stammziel / Einrichtung'];
  const imported=masterCustomers(vals);count=imported.length;
  for(const row of imported){
    let linked=await db.prepare("SELECT customer_id FROM customer_source_links WHERE source='master_sheet' AND source_account='google_master' AND external_key=?")
      .bind(row.externalKey).first();
    let customerId=linked?.customer_id;
    const stamp=fresh();
    if(!customerId){
      customerId=ID();
      await db.batch([
        db.prepare("INSERT INTO customers(id,name,pickup,destination,kind,created_at) VALUES(? ,?,'','','Rechnungsfahrt',?)")
          .bind(customerId,row.name,stamp),
        db.prepare("INSERT INTO customer_source_links(source,source_account,external_key,customer_id,first_seen_at,last_seen_at) VALUES('master_sheet','google_master',?,?,?,?)")
          .bind(row.externalKey,customerId,stamp,stamp),
        db.prepare("INSERT INTO customer_case_status(customer_id,phone,updated_at) VALUES(?,?,?)")
          .bind(customerId,row.phone.slice(0,60),stamp)
      ]);
      created++;
    } else {
      // Do not overwrite manually corrected names or reviewed classifications.
      const caseRow=await db.prepare("SELECT phone FROM customer_case_status WHERE customer_id=?").bind(customerId).first();
      if(!caseRow)await db.prepare("INSERT INTO customer_case_status(customer_id,phone,updated_at) VALUES(?,?,?)")
        .bind(customerId,row.phone.slice(0,60),stamp).run();
      else if(!caseRow.phone&&row.phone)await db.prepare("UPDATE customer_case_status SET phone=?,updated_at=? WHERE customer_id=?")
        .bind(row.phone.slice(0,60),stamp,customerId).run();
    }
    if(row.primaryTarget){
      const exists=await db.prepare("SELECT id FROM customer_routes WHERE customer_id=? AND destination=? AND source='master_sheet'")
        .bind(customerId,row.primaryTarget.slice(0,180)).first();
      if(!exists){
        await db.prepare(`INSERT INTO customer_routes(id,customer_id,label,pickup,destination,billing_class,
          is_primary,source,created_at,updated_at) VALUES(?,?,'Stammziel aus Drive','',?,'unknown',1,'master_sheet',?,?)`)
          .bind(ID(),customerId,row.primaryTarget.slice(0,180),stamp,stamp).run();
        changed++;
      }
    }
    if(row.copaymentSourceText){
      await db.prepare(`INSERT INTO customer_source_evidence(source,external_key,customer_id,source_status,observed_at)
       VALUES('master_copayment',?,?,?,?)
       ON CONFLICT(source,external_key) DO UPDATE SET source_status=excluded.source_status,observed_at=excluded.observed_at`)
       .bind(row.externalKey,customerId,row.copaymentSourceText.slice(0,120),stamp).run();
    }
  }
  // Read only administrative validity columns: no diagnoses, insurance IDs, scans or prescription text.
  for(const [kind,keys,dates,statuses] of [
    ['master_approval',approvalKeys,approvalDates,approvalStatuses],
    ['master_prescription',rxKeys,rxDates,null]
  ]){
    for(let i=1;i<keys.length;i++){
      const line=keys[i]||[],code=String(line[1]||'').trim().toUpperCase();
      const key=String(line[0]||'').slice(0,70);
      if(!key||!/^K[0-9]{4,6}$/.test(code))continue;
      const link=await db.prepare("SELECT customer_id FROM customer_source_links WHERE source='master_sheet' AND source_account='google_master' AND external_key=?").bind(code).first();
      if(!link)continue;
      const d=dates[i]||[],safeDate=v=>{
        const s=String(v||'').trim();const parts=s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        return parts?parts[3]+'-'+parts[2]+'-'+parts[1]:/^\d{4}-\d{2}-\d{2}$/.test(s)?s:null;
      };
      const value=kind==='master_approval'?String(statuses?.[i]?.[0]||'').slice(0,120):'Verordnung vorhanden – Gültigkeit separat prüfen';
      await db.prepare(`INSERT INTO customer_source_evidence(source,external_key,customer_id,source_status,valid_from,valid_until,observed_at)
       VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(source,external_key) DO UPDATE SET source_status=excluded.source_status,
         valid_from=excluded.valid_from,valid_until=excluded.valid_until,observed_at=excluded.observed_at`)
       .bind(kind,key,link.customer_id,value,safeDate(d[0]),safeDate(d[1]),fresh()).run();
    }
  }
  await setCheckpoint(db,source,'ok','',count);
  return {configured:true,created,records:count,routeSuggestions:changed};
 }catch(e){
  await setCheckpoint(db,source,'error','Verbindung oder Tabellenstruktur prüfen.');
  throw e;
 }
}
export async function pullCalendar(db,env){
 const source='google_calendar_taxi';
 if(!isGoogleConfigured(env,'calendar')){
  await setCheckpoint(db,source,'unconfigured','Taxi-Kalender OAuth noch nicht eingerichtet.');
  return {configured:false,seen:0};
 }
 await setCheckpoint(db,source,'running');
 let seen=0,updated=0;
 try{
  const access=await token(env,'calendar'),calendarId=env.GOOGLE_TAXI_CALENDAR_ID;
  const min=new Date(Date.now()-7*86400000).toISOString(),max=new Date(Date.now()+35*86400000).toISOString();
  let next=null,pages=0;
  const customerRows=await db.prepare(`SELECT c.id,c.name,x.external_key FROM customers c LEFT JOIN customer_source_links x
    ON x.customer_id=c.id AND x.source='master_sheet' WHERE c.active=1 LIMIT 2000`).all();
  const customers=(customerRows.results||[]).map(x=>({id:x.id,name:x.name,externalKey:x.external_key}));
  do{
    const url=new URL('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(calendarId)+'/events');
    url.searchParams.set('timeMin',min);url.searchParams.set('timeMax',max);
    url.searchParams.set('singleEvents','true');url.searchParams.set('showDeleted','true');
    url.searchParams.set('maxResults','250');
    if(next)url.searchParams.set('pageToken',next);
    const data=await googleJSON(url.href,access);
    if(!Array.isArray(data.items))throw fail(503,'Kalender lieferte keine gültige Ereignisliste.');
    for(const raw of data.items){
      const event=normalizedGoogleEvent(raw,'google_taxi',calendarId);
      if(!event)continue;
      seen++;
      const old=await db.prepare(`SELECT id,source_updated_at,event_title,start_at,status,match_state
        FROM calendar_imports WHERE source_account=? AND calendar_id=? AND provider_event_id=?`)
        .bind(event.sourceAccount,calendarId,event.providerEventId).first();
      if(old&&old.source_updated_at===event.updatedAt&&old.event_title===event.title&&old.start_at===event.startAt&&old.status===event.status)
        continue;
      const match=old?null:matchCalendarCustomer({summary:event.title,description:event.description},customers);
      const key=old?.id||ID();
      await db.prepare(`INSERT INTO calendar_imports(id,source_account,calendar_id,provider_event_id,start_at,end_at,
       event_title,description_excerpt,location_excerpt,event_url,source_color,source_updated_at,status,
       match_state,customer_id,match_reason,imported_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(source_account,calendar_id,provider_event_id) DO UPDATE SET
         start_at=excluded.start_at,end_at=excluded.end_at,event_title=excluded.event_title,
         description_excerpt=excluded.description_excerpt,location_excerpt=excluded.location_excerpt,
         event_url=excluded.event_url,source_color=excluded.source_color,source_updated_at=excluded.source_updated_at,
         status=excluded.status,imported_at=excluded.imported_at`)
       .bind(key,event.sourceAccount,calendarId,event.providerEventId,event.startAt,event.endAt,event.title,
         event.description,event.location,event.eventUrl,event.color,event.updatedAt,event.status,
         match?.state||'review',match?.customerId||null,match?.reason||'',fresh()).run();
      updated++;
    }
    next=data.nextPageToken||null;pages++;
    if(pages>=8&&next)throw fail(503,'Kalender enthält mehr Ereignisse als das sichere Abfragelimit; Zeitraum aufteilen.');
  }while(next);
  await setCheckpoint(db,source,'ok','',seen);
  return {configured:true,seen,updated};
 }catch(e){await setCheckpoint(db,source,'error','Kalenderautorisierung oder Datenumfang prüfen.');throw e;}
}
export async function syncSources(db,env,which='both'){
 const result={};
 if(which==='both'||which==='master')result.master=await pullMaster(db,env);
 if(which==='both'||which==='calendar')result.calendar=await pullCalendar(db,env);
 return result;
}

/**
 * On-demand directory search; never persist or disclose private contacts
 * outside the authenticated dispatcher session.
 * Requires Google People API with contacts.readonly OAuth scope.
 */
export async function searchGoogleContacts(env,query) {
 if(!isGoogleConfigured(env,'contacts'))throw fail(503,'Google-Kontakte-OAuth für TaxiPro nicht eingerichtet.');
 const q=String(query||'').trim().slice(0,80);
 if(q.length<3||/[\u0000-\u001f]/.test(q))throw fail(400,'Bitte mindestens drei Zeichen eingeben.');
 const access=await token(env,'contacts');
 const url=new URL('https://people.googleapis.com/v1/people:searchContacts');
 url.searchParams.set('query',q);url.searchParams.set('readMask','names,phoneNumbers');
 url.searchParams.set('pageSize','10');
 const data=await googleJSON(url.href,access);
 return {contacts:(Array.isArray(data.results)?data.results:[]).slice(0,10).map(x=>({
  resourceId:String(x.person?.resourceName||'').slice(0,100),
  name:String(x.person?.names?.[0]?.displayName||'').slice(0,120),
  phone:String(x.person?.phoneNumbers?.[0]?.value||'').slice(0,60)
 })).filter(x=>x.name)};
}
