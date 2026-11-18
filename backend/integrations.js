/**
 * TaxiPro vendor adapters (confidential-by-design).
 *
 * Browser never receives OneSignal REST key, Claude API key or Google OAuth
 * credentials. The browser never chooses notification recipients.
 * PII is never passed to external AI or embedded in lock-screen push.
 */
import {isGoogleConfigured} from './google-sync.js';
const error=(status,message)=>Object.assign(new Error(message),{status});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const iso=()=>new Date().toISOString();
const daily=(env,key)=>Math.max(0,Math.min(500,Math.floor(Number(env[key]||0)||0)));
const pushReady=env=>env.PUSH_ENABLED==='true' &&
  uuid.test(String(env.TAXIPRO_ONESIGNAL_APP_ID||'')) &&
  !!env.TAXIPRO_ONESIGNAL_REST_API_KEY;
const claudeReady=env=>env.CLAUDE_ENABLED==='true' &&
  !!env.ANTHROPIC_API_KEY && !!env.ANTHROPIC_MODEL &&
  daily(env,'CLAUDE_DAILY_MAX_REQUESTS')>0;
async function input(req){
 if(!String(req.headers.get('content-type')||'').includes('application/json'))
   throw error(415,'JSON ist erforderlich.');
 if(Number(req.headers.get('content-length')||0)>3000)throw error(413,'Anfrage zu groß.');
 let d;try{d=await req.json()}catch{throw error(400,'Ungültige JSON-Anfrage.')}
 if(!d||typeof d!=='object'||Array.isArray(d)||JSON.stringify(d).length>3000)
   throw error(400,'Ungültige Daten.');
 return d;
}
export function integrationStatus(env,u){
 const admin=u.role==='admin';
 return {
  google:admin?{
   taxiCalendar:isGoogleConfigured(env,'calendar'),
   masterSheets:isGoogleConfigured(env,'sheets'),
   contacts:isGoogleConfigured(env,'contacts')
  }:undefined,
  oneSignal:{ready:pushReady(env),appId:pushReady(env)?env.TAXIPRO_ONESIGNAL_APP_ID:null,
    dailyLimit:admin?daily(env,'PUSH_DAILY_MAX_REQUESTS'):undefined},
  claude:{ready:admin&&claudeReady(env),
    dailyLimit:admin?daily(env,'CLAUDE_DAILY_MAX_REQUESTS'):undefined},
  warning:'Konfiguration allein ist keine erfolgreiche Verbindung. Den letzten Quellenabgleich gesondert prüfen.'
 };
}
/**
 * Atomic cap for vendor API requests. Failed sends still consume a slot,
 * preventing an outage/retry storm from triggering additional billing.
 */
async function claimBudget(db,provider,limit){
 if(!Number.isSafeInteger(limit)||limit<=0)return false;
 const day=iso().slice(0,10);
 const row=await db.prepare(`INSERT INTO integration_daily_limits(provider,day_utc,requests_used)
   VALUES(?,?,1) ON CONFLICT(provider,day_utc) DO UPDATE SET
     requests_used=requests_used+1 WHERE requests_used<? RETURNING requests_used`)
  .bind(provider,day,limit).first();
 return !!row;
}
async function pushSubscription(req,env,u){
 if(!pushReady(env))throw error(503,'Eigene TaxiPro-OneSignal-App nicht eingerichtet.');
 const d=await input(req);
 const sub=String(d.subscriptionId||'').trim();
 if(!uuid.test(sub))throw error(400,'Ungültige Push-Subscription-ID.');
 // OneSignal Web SDK identity verification may be unavailable; use opaque
 // subscription IDs bound to authenticated TaxiPro accounts, no external_id.
 const stamp=iso();
 await env.DB.prepare(`INSERT INTO taxi_push_subscriptions(subscription_id,user_id,confirmed_at,enabled)
 VALUES(?,?,?,1) ON CONFLICT(subscription_id) DO UPDATE SET user_id=excluded.user_id,
 confirmed_at=excluded.confirmed_at,enabled=1`).bind(sub,u.id,stamp).run();
 return {registered:true};
}
async function removeSubscription(env,u,id){
 if(!uuid.test(id))throw error(400,'Push-Subscription-ID ungültig.');
 const r=await env.DB.prepare('DELETE FROM taxi_push_subscriptions WHERE subscription_id=? AND user_id=?')
  .bind(id,u.id).run();
 return {removed:(r.meta?.changes||0)>0};
}
export async function deliverGenericPush(env,db,{senderId,recipientId=null,type='message'}={}){
 if(!pushReady(env))return {sent:false,reason:'disabled'};
 const max=daily(env,'PUSH_DAILY_MAX_REQUESTS');
 if(!max)return {sent:false,reason:'budget_disabled'};
 const where=recipientId?'u.id=? AND u.id!=?':'u.id!=?';
 const args=recipientId?[recipientId,senderId]:[senderId];
 const result=await db.prepare(`SELECT DISTINCT p.subscription_id
   FROM taxi_push_subscriptions p JOIN users u ON u.id=p.user_id
   WHERE p.enabled=1 AND u.active=1 AND ${where} ORDER BY p.confirmed_at DESC LIMIT 500`)
   .bind(...args).all();
 const ids=(result.results||[]).map(x=>x.subscription_id);
 if(!ids.length)return {sent:false,reason:'no_subscriptions'};
 let attempted=0;
 for(let i=0;i<ids.length;i+=100){
  if(!await claimBudget(db,'onesignal_push',max))return {sent:attempted>0,reason:'daily_budget',attempted};
  const payload={
   app_id:env.TAXIPRO_ONESIGNAL_APP_ID,
   target_channel:'push',
   include_subscription_ids:ids.slice(i,i+100),
   headings:{de:'TaxiPro · Mitarbeiterbereich'},
   contents:{de:type==='traffic'?'Neue Verkehrsmeldung in TaxiPro.':'Neue Nachricht in TaxiPro.'},
   url:'https://sero91ak.github.io/taxipro-dispatch/v2/app.html'
  };
  // Never put message text, patient names, routes, phone numbers or GPS
  // into notification payloads, including click URLs.
  const r=await fetch('https://api.onesignal.com/notifications',{
   method:'POST',headers:{'Authorization':'Key '+env.TAXIPRO_ONESIGNAL_REST_API_KEY,
     'Content-Type':'application/json'},
   body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)
  });
  if(!r.ok)return {sent:false,reason:'provider_error',attempted};
  attempted++;
 }
 return {sent:true,attempted};
}
/**
 * Claude supports ONLY a generic numerical dispatch report. No arbitrary
 * prompts, customer records, patient descriptions or protected attachments.
 */
async function claudeSummary(req,env,u){
 if(u.role!=='admin')throw error(403,'Nur die Disposition darf KI-Berichte auslösen.');
 if(!claudeReady(env))throw error(503,'Claude ist kostenpflichtig und noch nicht ausdrücklich freigeschaltet.');
 const d=await input(req);
 if(d.action!=='daily_overview'||!/^\d{4}-\d{2}-\d{2}$/.test(d.date))
  throw error(400,'Nur eine anonymisierte Tagesübersicht ist zulässig.');
 // A strictly aggregate query. No external user text or personal data.
 const rows=await env.DB.prepare(`SELECT status,COUNT(*) AS total FROM rides
   WHERE ride_date=? GROUP BY status`).bind(d.date).all();
 const counts=Object.fromEntries((rows.results||[]).map(x=>[x.status,Number(x.total)]));
 if(!await claimBudget(env.DB,'anthropic_claude',daily(env,'CLAUDE_DAILY_MAX_REQUESTS')))
  throw error(429,'Claude-Tageslimit erreicht. Es werden keine weiteren kostenpflichtigen Anfragen versendet.');
 const prompt=`Erstelle eine sehr kompakte, professionelle deutsche Disponenten-Zusammenfassung allein anhand
   aggregierter Zahlen. Keine erfundenen Details oder Fahrzeiten. Datum ${d.date}.
   Zugewiesen: ${counts.assigned||0}. Angenommen: ${counts.accepted||0}.
   Gefahren gemeldet: ${counts.done||0}. Storniert: ${counts.cancelled||0}.
   Keine personenbezogenen Daten oder medizinische Angaben vorhanden.`;
 const response=await fetch('https://api.anthropic.com/v1/messages',{
   method:'POST',headers:{'Content-Type':'application/json',
     'x-api-key':env.ANTHROPIC_API_KEY,
     'anthropic-version':env.ANTHROPIC_API_VERSION||'2023-06-01'},
   body:JSON.stringify({model:env.ANTHROPIC_MODEL,max_tokens:220,
     messages:[{role:'user',content:prompt}]}),
   signal:AbortSignal.timeout(15000)
 });
 if(!response.ok)throw error(503,'Claude-Anfrage konnte nicht ausgeführt werden.');
 const answer=await response.json();
 return {text:(answer.content||[]).filter(x=>x.type==='text')
    .map(x=>x.text).join('\n').slice(0,1600),
   anonymized:true,billedRequest:true};
}
export async function handleIntegrations(req,env,u,path){
 if(path==='/api/integrations/status'&&req.method==='GET')
  return {data:integrationStatus(env,u)};
 if(path==='/api/integrations/push'&&req.method==='POST')
  return {data:await pushSubscription(req,env,u)};
 const match=path.match(/^\/api\/integrations\/push\/([0-9a-f-]{36})$/i);
 if(match&&req.method==='DELETE')return {data:await removeSubscription(env,u,match[1])};
 if(path==='/api/integrations/claude-summary'&&req.method==='POST')
  return {data:await claudeSummary(req,env,u)};
 return null;
}
