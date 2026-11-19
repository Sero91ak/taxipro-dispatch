/**
 * TaxiPro 2.4 canonical matching rules.
 * This module must not fetch external data, write to Google, or infer completed
 * journeys from mere calendar appointments. It returns reviewable suggestions.
 */
const normalize=s=>String(s??'').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g,'').replace(/ß/g,'ss')
  .toLocaleLowerCase('de-DE').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const STOP=new Set(['herr','frau','dr','prof','taxi','re','kts','fahrt','fahrten','patient','kunde','abholung','nr','bonn','meckenheim','zum','zur','von','nach','und']);
const isToken=t=>t.length>=3&&!STOP.has(t)&&!/^[0-9]+$/.test(t);
export const normalizeName=normalize;
/** Candidate duplicates must be reviewed, never silently merged. */
export function possibleExistingCustomers(name,existing=[]) {
 const key=normalize(name).split(' ').filter(isToken).sort().join('|');
 if(!key)return [];
 return existing.filter(c=>normalize(c.name).split(' ').filter(isToken).sort().join('|')===key)
   .map(c=>({id:c.id,name:c.name}));
}
export const customerCode=s=>{
  const m=String(s??'').toUpperCase().match(/(?:^|[^A-Z0-9])(K[0-9]{4})(?=$|[^A-Z0-9])/);
  return m?.[1]||null;
};
export function matchCalendarCustomer(event,customers=[]) {
  const hay=normalize([event.summary||event.title||'',event.description||''].join(' '));
  const code=customerCode([event.summary||event.title||'',event.description||''].join(' '));
  if(code){
    const selected=customers.filter(x=>x.externalKey===code||x.customerCode===code);
    if(selected.length===1)return {state:'matched',customerId:selected[0].id,reason:'Eindeutige Kunden-ID '+code};
    return {state:'review',customerId:null,reason:selected.length>1?'Doppelte Kunden-ID':'Unbekannte Kunden-ID '+code};
  }
  if(!hay)return {state:'review',customerId:null,reason:'Keine erkennbaren Personenangaben'};
  const words=new Set(hay.split(' ').filter(isToken));
  const candidates=customers.filter(x=>{
    const tokens=normalize(x.name).split(' ').filter(isToken);
    // A single family name is not sufficient evidence of identity.
    return tokens.length>=2 && new Set(tokens).size>=2 && tokens.every(t=>words.has(t));
  });
  if(candidates.length!==1)return {state:'review',customerId:null,
    reason:candidates.length>1?'Mehrere mögliche Kunden':'Kein zweifelsfrei eindeutiger vollständiger Name'};
  return {state:'review',customerId:candidates[0].id,reason:'Möglicher Namensmatch – vor Zuordnung durch Disponenten prüfen'};
}
export function classifyBilling(value) {
  const s=' '+String(value??'').toUpperCase().replace(/[^A-Z0-9]+/g,' ')+' ';
  if(s.includes(' KTS ')&&s.includes(' RE '))return 'unknown';
  if(s.includes(' KTS '))return 'KTS';
  if(s.includes(' RE '))return 'RE';
  return 'unknown';
}
export function masterCustomers(values=[]) {
  if(!Array.isArray(values)||!values.length)return [];
  const h=values[0].map(v=>String(v??'').trim().toLocaleLowerCase('de-DE'));
  const col=name=>h.indexOf(name.toLocaleLowerCase('de-DE'));
  const idx={id:col('Kunden-ID'),last:col('Nachname'),first:col('Vorname'),
    phone:col('Telefon'),target:col('Stammziel / Einrichtung'),copayment:col('Zuzahlung/Befreiung')};
  if(idx.id<0||idx.last<0)throw new Error('Kundenstamm: Spalten Kunden-ID und Nachname fehlen.');
  const seen=new Set();
  return values.slice(1).map(row=>{
    const val=k=>idx[k]<0?'':String(row[idx[k]]??'').trim();
    const externalKey=val('id').toUpperCase();
    if(!externalKey)return null;
    if(!/^K[0-9]{4,6}$/.test(externalKey))return null;
    if(seen.has(externalKey))throw new Error('Kunden-ID doppelt: '+externalKey);
    seen.add(externalKey);
    const name=[val('last'),val('first')].filter(Boolean).join(' ').trim();
    return name?{externalKey,name,phone:val('phone'),primaryTarget:val('target'),
      copaymentSourceText:val('copayment')}:null;
  }).filter(Boolean);
}
export function sourceApprovalSuggestion(values=[]) {
  if(!values.length)return [];
  const heads=values[0].map(x=>String(x??'').toLowerCase().trim());
  const ix=x=>heads.indexOf(x.toLowerCase());
  const id=ix('Kunden-ID'),status=ix('Prüfstatus'),expiry=ix('Gültig bis'),document=ix('Dokumentlink');
  if(id<0)return [];
  return values.slice(1).filter(row=>row[id]).map(row=>({
    externalKey:String(row[id]).trim(),sourceStatus:status<0?'':String(row[status]??'').trim(),
    validUntil:expiry<0?'':String(row[expiry]??'').trim(),
    hasDocument:document>=0&&!!String(row[document]??'').trim()
  }));
}
export function normalizedGoogleEvent(ev,account,calendarId) {
  if(!ev||typeof ev!=='object'||!ev.id)return null;
  const start=ev.start?.dateTime;
  if(!start||!Number.isFinite(Date.parse(start)))return null; // all-day != ride
  const title=String(ev.summary??'').slice(0,240);
  if(!title.trim())return null;
  const status=['confirmed','tentative','cancelled'].includes(ev.status)?ev.status:'confirmed';
  return {
    sourceAccount:account,calendarId,providerEventId:String(ev.id).slice(0,255),
    startAt:new Date(start).toISOString(),
    endAt:ev.end?.dateTime&&Number.isFinite(Date.parse(ev.end.dateTime))?new Date(ev.end.dateTime).toISOString():null,
    title,description:String(ev.description??'').slice(0,300),
    location:String(ev.location??'').slice(0,200),
    eventUrl:String(ev.htmlLink??'').slice(0,500),
    color:ev.colorId?String(ev.colorId).slice(0,6):null,
    status,updatedAt:ev.updated&&Number.isFinite(Date.parse(ev.updated))?new Date(ev.updated).toISOString():null,
    billingSuggestion:classifyBilling(title+' '+String(ev.description??'').slice(0,300))
  };
}
export function berlinServiceDate(iso) {
  const d=new Date(iso);
  if(!Number.isFinite(+d))throw Error('Ungültiges Datum');
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
}
export function displayPrefs(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Einstellungen ungültig.');
  const result={density:'compact',nav:'expanded',lastPage:'home',dateFilter:'today',
    selectedCustomerId:null,periodFrom:null,periodTo:null,calendarState:'review'};
  const allowed={
    density:['compact','comfortable'],nav:['expanded','collapsed'],
    lastPage:['home','dispatch','series','daily','rides','customers','drivers','shifts','worktime','traffic','chat','files','swaps','signatures','cases','case-detail','calendar','ledger','import-review','integrations'],
    dateFilter:['today','week','month']
  };
  for(const [key,choices] of Object.entries(allowed))if(input[key]!==undefined){
    if(!choices.includes(input[key]))throw Error('Einstellung '+key+' ungültig.');
    result[key]=input[key];
  }
  if(input.selectedCustomerId!==undefined&&input.selectedCustomerId!==null){
    if(typeof input.selectedCustomerId!=='string'||!/^[a-f0-9-]{36}$/i.test(input.selectedCustomerId))
      throw Error('Ausgewählter Kunde ungültig.');
    result.selectedCustomerId=input.selectedCustomerId;
  }
  for(const key of ['periodFrom','periodTo']){
    if(input[key]!==undefined&&input[key]!==null){
      if(typeof input[key]!=='string'||!/^\\d{4}-\\d{2}-\\d{2}$/.test(input[key]))
        throw Error('Zeitraum-Einstellung ungültig.');
      result[key]=input[key];
    }
  }
  if(input.calendarState!==undefined){
    if(!['review','matched','ignored','all'].includes(input.calendarState))
      throw Error('Kalenderfilter ungültig.');
    result.calendarState=input.calendarState;
  }
  return result;
}
export function signatureSheetModel(customer,rows,options={}) {
  if(!customer?.name||!Array.isArray(rows)||!rows.length)throw Error('Kunde und Fahrten erforderlich.');
  if(rows.length>150)throw Error('Maximal 150 Fahrten je Unterschriftszettel.');
  const dates=rows.map(r=>String(r.service_date||''));
  if(dates.some(x=>!/^\d{4}-\d{2}-\d{2}$/.test(x)))throw Error('Fahrtdatum ungültig.');
  if(rows.some(r=>r.customer_id!==customer.id||r.ride_status==='cancelled'))
    throw Error('Fremde oder stornierte Fahrten nicht drucken.');
  return {company:'Taxi Meckenheim GmbH',customerId:customer.externalKey||null,
    customerName:customer.name,
    periodStart:dates.reduce((a,b)=>a<b?a:b),periodEnd:dates.reduce((a,b)=>a>b?a:b),
    entries:rows.slice().sort((a,b)=>a.service_date.localeCompare(b.service_date)||a.pickup_time.localeCompare(b.pickup_time))
    .map(r=>({date:r.service_date,serviceDate:r.service_date,time:r.pickup_time,pickup:r.pickup,destination:r.destination,
      direction:r.direction,recordStatus:r.ride_status})),
    note:String(options.note||'').slice(0,300)};
}
