/**
 * TaxiPro Dispatch 2.0 API - Cloudflare Workers + D1
 * Zero paid dependencies; server-authoritative access control.
 * Staging implementation: do not upload patient documents or use for live
 * healthcare operations before legal/security review and deployment tests.
 */
const encoder = new TextEncoder();
const ID = () => crypto.randomUUID();
const timestamp = () => new Date().toISOString();
const hex = bytes => Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
const sha = async s => hex(await crypto.subtle.digest('SHA-256', encoder.encode(s)));
const safeText = (v, max = 160) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const okDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T12:00:00Z'));
const okTime = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const minExpiration = () => new Date(Date.now() + 12 * 3600000).toISOString();
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const randomToken = () => b64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(salt), iterations: 310000, hash: 'SHA-256' }, key, 256);
  return hex(bits);
}
function err(status, message) { return Object.assign(new Error(message), { status }); }
function requireAdmin(u) { if (u.role !== 'admin') throw err(403, 'Nicht berechtigt.'); }
function requireDriver(u) { if (u.role !== 'driver') throw err(403, 'Nur für Fahrer.'); }
async function parse(req) {
  if (Number(req.headers.get('content-length') || '0') > 16000) throw err(413, 'Anfrage zu groß.');
  if (!(req.headers.get('content-type') || '').includes('application/json')) throw err(415, 'JSON erforderlich.');
  let body;
  try { body = await req.json(); } catch { throw err(400, 'Ungültiges JSON.'); }
  if (!body || Array.isArray(body) || typeof body !== 'object' || JSON.stringify(body).length > 16000) throw err(400, 'Ungültige Anfrage.');
  return body;
}
async function getUser(req, db) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ') || auth.length > 200) throw err(401, 'Anmeldung erforderlich.');
  const token = auth.slice(7).trim();
  if (!/^[a-zA-Z0-9_-]{35,100}$/.test(token)) throw err(401, 'Anmeldung erforderlich.');
  const hash = await sha(token);
  const user = await db.prepare(`SELECT u.id, u.username, u.display_name, u.role, u.active, s.token_hash
        FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE s.token_hash=? AND s.expires_at>?`).bind(hash, timestamp()).first();
  if (!user || !user.active) throw err(401, 'Sitzung abgelaufen.');
  return user;
}
const audit = (db, actor, event, entity = '', details = '') => db.prepare('INSERT INTO audit (id,actor_id,event,entity_id,details,created_at) VALUES (?,?,?,?,?,?)').bind(ID(), actor, event, entity, details.slice(0, 300), timestamp()).run();
async function session(db, u) {
  const token = randomToken();
  await db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').bind(await sha(token), u.id, minExpiration(), timestamp()).run();
  return { token, user: { id: u.id, username: u.username, displayName: u.display_name, role: u.role } };
}
async function login(req, env) {
  const data = await parse(req);
  const username = safeText(data.username, 80).toLowerCase();
  const password = typeof data.password === 'string' ? data.password : '';
  if (!/^[a-z0-9._-]{3,40}$/.test(username) || password.length < 1) throw err(401, 'Zugangsdaten ungültig.');
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const key = await sha(ip + ':' + username);
  const blocked = await env.DB.prepare('SELECT attempts,until_at FROM auth_attempts WHERE id=?').bind(key).first();
  if (blocked && blocked.attempts >= 7 && blocked.until_at > timestamp()) throw err(429, 'Zu viele Versuche. Später erneut versuchen.');
  const u = await env.DB.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').bind(username).first();
  let valid = false;
  if (u) valid = (await passwordHash(password, u.salt)) === u.password_hash && u.active === 1;
  if (!valid) {
    const since = blocked && blocked.until_at > timestamp() ? blocked.attempts : 0;
    await env.DB.prepare(`INSERT INTO auth_attempts(id,attempts,until_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET attempts=excluded.attempts,until_at=excluded.until_at`)
      .bind(key, since + 1, new Date(Date.now() + 15 * 60000).toISOString()).run();
    throw err(401, 'Zugangsdaten ungültig.');
  }
  await env.DB.prepare('DELETE FROM auth_attempts WHERE id=?').bind(key).run();
  return session(env.DB, u);
}
async function bootstrap(req, env) {
  if (!env.BOOTSTRAP_SECRET || env.BOOTSTRAP_SECRET.length < 32) throw err(503, 'Einrichtung gesperrt.');
  const { setupSecret, username, displayName, password } = await parse(req);
  const suppliedHash = await sha(String(setupSecret || ''));
  if (suppliedHash !== await sha(env.BOOTSTRAP_SECRET)) throw err(403, 'Einrichtung nicht möglich.');
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  if (count.n !== 0) throw err(409, 'Administrator bereits vorhanden.');
  const login = safeText(username, 40).toLowerCase(), name = safeText(displayName, 90);
  if (!/^[a-z0-9._-]{3,40}$/.test(login) || !name || typeof password !== 'string' || password.length < 14 || password.length > 128) throw err(400, 'Namen und Passwort (14–128 Zeichen) prüfen.');
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const u = { id: ID(), username: login, display_name: name, role: 'admin' };
  await env.DB.prepare('INSERT INTO users(id,username,display_name,role,salt,password_hash,active,created_at) VALUES(?,?,?,?,?,?,1,?)')
    .bind(u.id,u.username,u.display_name,u.role,salt,await passwordHash(password,salt),timestamp()).run();
  return { created: true };
}
async function addDriver(req, env, actor) {
  requireAdmin(actor);
  const { username, displayName, password } = await parse(req);
  const login = safeText(username, 40).toLowerCase(), name = safeText(displayName, 90);
  if (!/^[a-z0-9._-]{3,40}$/.test(login) || !name || typeof password !== 'string' || password.length < 12 || password.length > 128) throw err(400,'Benutzername, Anzeigename oder Passwort ungültig (mind. 12 Zeichen).');
  const salt = b64(crypto.getRandomValues(new Uint8Array(16))),id=ID();
  try {
    await env.DB.prepare('INSERT INTO users(id,username,display_name,role,salt,password_hash,active,created_at) VALUES(?,?,?,\'driver\',?,?,1,?)')
      .bind(id,login,name,salt,await passwordHash(password,salt),timestamp()).run();
  } catch { throw err(409, 'Benutzername bereits vorhanden.'); }
  await audit(env.DB,actor.id,'driver.created',id,login);
  return { id,username:login,displayName:name,role:'driver' };
}
async function addCustomer(req,env,u) {
  requireAdmin(u);
  const d=await parse(req);
  const name=safeText(d.name,120),pickup=safeText(d.pickup,200),destination=safeText(d.destination,200);
  const kind=safeText(d.kind,40)||'Rechnungsfahrt';
  if(!name||!pickup||!destination||!['Krankenfahrt','Rechnungsfahrt','Serienfahrt','Barfahrt'].includes(kind))throw err(400,'Kundenangaben unvollständig.');
  const id=ID();
  await env.DB.prepare('INSERT INTO customers(id,name,pickup,destination,kind,signature_required,created_at) VALUES(?,?,?,?,?,?,?)')
    .bind(id,name,pickup,destination,kind,d.signatureRequired===true?1:0,timestamp()).run();
  await audit(env.DB,u.id,'customer.created',id);
  return {id};
}
async function addRide(req,env,u){
  requireAdmin(u);const d=await parse(req);
  if(!okDate(d.date)||!okTime(d.time)||!['hin','rueck'].includes(d.direction)||!['Krankenfahrt','Rechnungsfahrt','Serienfahrt','Barfahrt'].includes(d.kind))throw err(400,'Fahrtart, Datum oder Uhrzeit ungültig.');
  const pickup=safeText(d.pickup,200),destination=safeText(d.destination,200);
  if(!pickup||!destination)throw err(400,'Adressen fehlen.');
  const driver=await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='driver' AND active=1").bind(d.driverId).first();
  const customer=await env.DB.prepare('SELECT id FROM customers WHERE id=? AND active=1').bind(d.customerId).first();
  if(!driver||!customer)throw err(400,'Fahrer oder Kunde unbekannt.');
  const id=ID();await env.DB.prepare('INSERT INTO rides(id,customer_id,driver_id,ride_date,ride_time,pickup,destination,kind,direction,signature_required,status,assigned_at) VALUES(?,?,?,?,?,?,?,?,?,?,\'assigned\',?)')
    .bind(id,d.customerId,d.driverId,d.date,d.time,pickup,destination,d.kind,d.direction,d.signatureRequired===true?1:0,timestamp()).run();
  await audit(env.DB,u.id,'ride.assigned',id);
  return {id};
}
async function changeRide(req,env,u,id){
  const d=await parse(req);const action=safeText(d.action,20);
  const ride=await env.DB.prepare('SELECT id,driver_id,status FROM rides WHERE id=?').bind(id).first();
  if(!ride)throw err(404,'Auftrag nicht gefunden.');
  if(u.role==='driver'&&ride.driver_id!==u.id)throw err(403,'Auftrag nicht zugewiesen.');
  let prev,next,col;
  if(action==='accept'&&u.role==='driver'){prev='assigned';next='accepted';col='accepted_at'}
  else if(action==='complete'&&u.role==='driver'){prev='accepted';next='done';col='completed_at'}
  else if(action==='cancel'&&u.role==='admin'){prev=ride.status;next='cancelled';col=null;if(!['assigned','accepted'].includes(prev))throw err(409,'Auftrag kann nicht storniert werden.');}
  else throw err(403,'Ungültiger Statuswechsel.');
  const q=col?`UPDATE rides SET status=?, ${col}=? WHERE id=? AND status=?`:'UPDATE rides SET status=? WHERE id=? AND status=?';
  const result=col?await env.DB.prepare(q).bind(next,timestamp(),id,prev).run():await env.DB.prepare(q).bind(next,id,prev).run();
  if(!result.meta?.changes)throw err(409,'Auftrag wurde inzwischen geändert. Bitte neu laden.');
  await audit(env.DB,u.id,'ride.'+action,id);
  return {id,status:next};
}
async function shift(req,env,u){
  requireDriver(u);const { action }=await parse(req);const d=env.DB;
  if(action==='start'){
    const existing=await d.prepare('SELECT id FROM shifts WHERE driver_id=? AND ended_at IS NULL').bind(u.id).first();
    if(existing)throw err(409,'Eine Schicht läuft bereits.');
    const id=ID();try{await d.prepare('INSERT INTO shifts(id,driver_id,started_at) VALUES(?,?,?)').bind(id,u.id,timestamp()).run()}catch{throw err(409,'Eine Schicht läuft bereits.')}
    await audit(d,u.id,'shift.started',id);return {id,started:true};
  }
  if(action==='end'){
    const existing=await d.prepare('SELECT id FROM shifts WHERE driver_id=? AND ended_at IS NULL').bind(u.id).first();
    if(!existing)throw err(409,'Keine aktive Schicht.');
    const opened=await d.prepare('SELECT id FROM shift_breaks WHERE shift_id=? AND ended_at IS NULL').bind(existing.id).first();
    if(opened)throw err(409,'Laufende Pause zuerst beenden.');
    await d.prepare('UPDATE shifts SET ended_at=? WHERE id=? AND ended_at IS NULL').bind(timestamp(),existing.id).run();
    await d.prepare('DELETE FROM positions WHERE driver_id=?').bind(u.id).run();
    await audit(d,u.id,'shift.ended',existing.id);return {id:existing.id,ended:true};
  }
  throw err(400,'Unbekannte Schichtaktion.');
}
async function correctShift(req,env,u,id){
  requireAdmin(u);const d=await parse(req);
  const started=new Date(d.startedAt),ended=new Date(d.endedAt),reason=safeText(d.reason,300);
  if(!Number.isFinite(+started)||!Number.isFinite(+ended)||ended<=started||ended-started>24*3600000||reason.length<10)throw err(400,'Zeitwerte oder Begründung ungültig.');
  const entry=await env.DB.prepare('SELECT * FROM shifts WHERE id=? AND ended_at IS NOT NULL').bind(id).first();
  if(!entry)throw err(404,'Abgeschlossene Schicht nicht gefunden.');
  const changedAt=timestamp();
  // D1 batch runs these statements in one database transaction: no unlogged correction.
  await env.DB.batch([
    env.DB.prepare('INSERT INTO shift_adjustments(id,shift_id,actor_id,previous_start,previous_end,new_start,new_end,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(ID(),id,u.id,entry.started_at,entry.ended_at,started.toISOString(),ended.toISOString(),reason,changedAt),
    env.DB.prepare('UPDATE shifts SET original_started_at=COALESCE(original_started_at,started_at),original_ended_at=COALESCE(original_ended_at,ended_at),started_at=?,ended_at=?,adjusted_by=?,adjusted_at=?,adjustment_reason=? WHERE id=? AND ended_at IS NOT NULL')
      .bind(started.toISOString(),ended.toISOString(),u.id,changedAt,reason,id),
    env.DB.prepare('INSERT INTO audit(id,actor_id,event,entity_id,details,created_at) VALUES(?,?,?,?,?,?)')
      .bind(ID(),u.id,'shift.corrected',id,JSON.stringify({before:[entry.started_at,entry.ended_at],after:[started.toISOString(),ended.toISOString()],reason}).slice(0,300),changedAt)
  ]);
  return {id,corrected:true};
}
async function updatePosition(req,env,u){
  requireDriver(u);const d=await parse(req),lat=Number(d.latitude),lng=Number(d.longitude),accuracy=d.accuracy==null?null:Number(d.accuracy);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180||(accuracy!=null&&(!Number.isFinite(accuracy)||accuracy<0||accuracy>50000)))throw err(400,'Koordinaten ungültig.');
  const active=await env.DB.prepare('SELECT id FROM shifts WHERE driver_id=? AND ended_at IS NULL').bind(u.id).first();
  if(!active)throw err(409,'Ortung nur während einer aktiven Schicht.');
  await env.DB.prepare('INSERT INTO positions(driver_id,latitude,longitude,accuracy,reported_at) VALUES(?,?,?,?,?) ON CONFLICT(driver_id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,accuracy=excluded.accuracy,reported_at=excluded.reported_at')
    .bind(u.id,lat,lng,accuracy,timestamp()).run();
  return {received:true};
}
async function sendMessage(req,env,u){
  const d=await parse(req),body=safeText(d.body,1000),recipient=safeText(d.recipientId,80)||null;
  if(!body)throw err(400,'Nachricht leer.');
  if(recipient){
    const target=await env.DB.prepare('SELECT role FROM users WHERE id=? AND active=1').bind(recipient).first();
    if(!target||u.role==='driver'&&target.role!=='admin')throw err(403,'Empfänger nicht berechtigt.');
  }
  const id=ID();await env.DB.prepare('INSERT INTO messages(id,sender_id,recipient_id,body,created_at) VALUES(?,?,?,?,?)').bind(id,u.id,recipient,body,timestamp()).run();
  return {id};
}

// The server creates trips from explicit recurring templates, never from calendar inference.
async function addSeries(req,env,u){
 requireAdmin(u);const d=await parse(req);
 const weekdayArray=Array.isArray(d.weekdays)?[...new Set(d.weekdays.map(Number))]:[];
 const start=safeText(d.startDate,10),end=safeText(d.endDate,10),time=safeText(d.outboundTime,5),ret=safeText(d.returnTime,5)||null;
 const pickup=safeText(d.pickup,200),dest=safeText(d.destination,200),kind=safeText(d.kind,40);
 if(!okDate(start)||!okDate(end)||end<start||Date.parse(end)-Date.parse(start)>366*86400000||!weekdayArray.length||weekdayArray.some(n=>!Number.isInteger(n)||n<0||n>6)||!okTime(time)||(ret&&!okTime(ret))||!pickup||!dest||!['Krankenfahrt','Rechnungsfahrt','Serienfahrt','Barfahrt'].includes(kind))throw err(400,'Serienfahrt unvollständig oder ungültig.');
 const driver=await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='driver' AND active=1").bind(d.driverId).first();
 const customer=await env.DB.prepare('SELECT id FROM customers WHERE id=? AND active=1').bind(d.customerId).first();
 if(!driver||!customer)throw err(400,'Kunde oder Fahrer nicht gefunden.');
 const id=ID();await env.DB.prepare(`INSERT INTO recurring_orders(id,customer_id,driver_id,start_date,end_date,weekdays,outbound_time,return_time,pickup,destination,kind,signature_required,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
 .bind(id,d.customerId,d.driverId,start,end,weekdayArray.sort().join(','),time,ret,pickup,dest,kind,d.signatureRequired===true?1:0,timestamp()).run();
 await audit(env.DB,u.id,'series.created',id);return {id};
}
async function generateSeries(req,env,u){
 requireAdmin(u);const d=await parse(req),from=safeText(d.from,10),to=safeText(d.to,10),seriesId=safeText(d.seriesId,80);
 if(!okDate(from)||!okDate(to)||to<from||Date.parse(to)-Date.parse(from)>30*86400000||!seriesId)throw err(400,'Maximal 31 aufeinanderfolgende Tage pro Erstellung.');
 const series=await env.DB.prepare('SELECT * FROM recurring_orders WHERE id=? AND active=1').bind(seriesId).first();
 if(!series)throw err(404,'Serienfahrt nicht gefunden.');
 let created=0,existing=0;
 const days=new Set(series.weekdays.split(',').map(Number));
 for(let n=Date.parse(from+'T12:00:00Z');n<=Date.parse(to+'T12:00:00Z');n+=86400000){
  const date=new Date(n).toISOString().slice(0,10);if(date<series.start_date||date>series.end_date||!days.has(new Date(n).getUTCDay()))continue;
  for(const direction of series.return_time?['hin','rueck']:['hin']){
   const backward=direction==='rueck';const id=ID();
   const result=await env.DB.prepare(`INSERT OR IGNORE INTO rides(id,customer_id,driver_id,ride_date,ride_time,pickup,destination,kind,direction,signature_required,status,assigned_at,recurring_order_id) VALUES(?,?,?,?,?,?,?,?,?,?,'assigned',?,?)`)
    .bind(id,series.customer_id,series.driver_id,date,backward?series.return_time:series.outbound_time,backward?series.destination:series.pickup,backward?series.pickup:series.destination,series.kind,direction,series.signature_required,timestamp(),series.id).run();
   if(result.meta?.changes)created++;else existing++;
  }
 }
 await audit(env.DB,u.id,'series.generated',series.id,`${from}...${to}: ${created} neu, ${existing} vorhanden`);
 return {created,existing,from,to};
}
async function breakAction(req,env,u){
 requireDriver(u);const {action}=await parse(req),db=env.DB;
 const shift=await db.prepare('SELECT id FROM shifts WHERE driver_id=? AND ended_at IS NULL').bind(u.id).first();
 if(!shift)throw err(409,'Keine aktive Schicht.');
 if(action==='start'){
  const opened=await db.prepare('SELECT id FROM shift_breaks WHERE shift_id=? AND ended_at IS NULL').bind(shift.id).first();
  if(opened)throw err(409,'Eine Pause läuft bereits.');
  const id=ID();try{await db.prepare('INSERT INTO shift_breaks(id,shift_id,driver_id,started_at) VALUES(?,?,?,?)').bind(id,shift.id,u.id,timestamp()).run()}catch{throw err(409,'Eine Pause läuft bereits.')}
  await audit(db,u.id,'break.started',id);return {id,active:true};
 }
 if(action==='end'){
  const opened=await db.prepare('SELECT id FROM shift_breaks WHERE shift_id=? AND ended_at IS NULL').bind(shift.id).first();
  if(!opened)throw err(409,'Keine laufende Pause.');
  await db.prepare('UPDATE shift_breaks SET ended_at=? WHERE id=? AND ended_at IS NULL').bind(timestamp(),opened.id).run();
  await audit(db,u.id,'break.ended',opened.id);return {id:opened.id,active:false};
 }
 throw err(400,'Unbekannte Pausenaktion.');
}
async function resetDriver(req,env,u,id){
 requireAdmin(u);const {password,active}=await parse(req);const target=await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='driver'").bind(id).first();
 if(!target)throw err(404,'Fahrer nicht gefunden.');
 if(typeof password==='string'){
  if(password.length<12||password.length>128)throw err(400,'Neues Passwort muss 12–128 Zeichen enthalten.');
  const salt=b64(crypto.getRandomValues(new Uint8Array(16)));
  await env.DB.batch([env.DB.prepare('UPDATE users SET salt=?,password_hash=? WHERE id=?').bind(salt,await passwordHash(password,salt),id),env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id)]);
  await audit(env.DB,u.id,'driver.password_reset',id);return {ok:true,passwordReset:true};
 }
 if(typeof active==='boolean'){
  if(!active){const shift=await env.DB.prepare('SELECT id FROM shifts WHERE driver_id=? AND ended_at IS NULL').bind(id).first();if(shift)throw err(409,'Bitte zuerst die aktive Schicht beenden.');}
  await env.DB.batch([env.DB.prepare('UPDATE users SET active=? WHERE id=?').bind(active?1:0,id),env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id)]);
  await audit(env.DB,u.id,'driver.status_changed',id,active?'activated':'deactivated');return {ok:true,active};
 }
 throw err(400,'Änderung fehlt.');
}
async function state(db,u){
  const base={me:{id:u.id,username:u.username,displayName:u.display_name,role:u.role}};
  if(u.role==='admin'){
    base.drivers=(await db.prepare("SELECT id,username,display_name,active FROM users WHERE role='driver' ORDER BY display_name").all()).results;
    base.customers=(await db.prepare('SELECT * FROM customers WHERE active=1 ORDER BY name LIMIT 300').all()).results;
    base.rides=(await db.prepare('SELECT r.*,c.name AS customer_name,u.display_name AS driver_name FROM rides r JOIN customers c ON c.id=r.customer_id JOIN users u ON u.id=r.driver_id ORDER BY r.ride_date DESC,r.ride_time DESC LIMIT 300').all()).results;
    base.shifts=(await db.prepare('SELECT s.*,u.display_name AS driver_name FROM shifts s JOIN users u ON u.id=s.driver_id ORDER BY s.started_at DESC LIMIT 200').all()).results;
    base.adjustments=(await db.prepare('SELECT a.*,u.display_name AS actor_name FROM shift_adjustments a JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 300').all()).results;
    base.series=(await db.prepare('SELECT o.*,c.name AS customer_name,u.display_name AS driver_name FROM recurring_orders o JOIN customers c ON c.id=o.customer_id JOIN users u ON u.id=o.driver_id WHERE o.active=1 ORDER BY o.start_date DESC LIMIT 120').all()).results;
    base.positions=(await db.prepare('SELECT p.*,u.display_name AS driver_name FROM positions p JOIN users u ON u.id=p.driver_id WHERE EXISTS (SELECT 1 FROM shifts s WHERE s.driver_id=p.driver_id AND s.ended_at IS NULL)').all()).results;
  } else {
    base.rides=(await db.prepare('SELECT r.*,c.name AS customer_name FROM rides r JOIN customers c ON c.id=r.customer_id WHERE r.driver_id=? ORDER BY r.ride_date DESC,r.ride_time DESC LIMIT 100').bind(u.id).all()).results;
    base.shifts=(await db.prepare('SELECT * FROM shifts WHERE driver_id=? ORDER BY started_at DESC LIMIT 100').bind(u.id).all()).results;
  }
  if(u.role==='admin')base.breaks=(await db.prepare('SELECT b.* FROM shift_breaks b JOIN shifts s ON s.id=b.shift_id ORDER BY b.started_at DESC LIMIT 600').all()).results;
  else base.breaks=(await db.prepare('SELECT * FROM shift_breaks WHERE driver_id=? ORDER BY started_at DESC LIMIT 200').bind(u.id).all()).results;
  base.team=(await db.prepare('SELECT id,username,display_name,role FROM users WHERE active=1 ORDER BY display_name LIMIT 100').all()).results;
  base.messages=(await db.prepare(`SELECT m.*,u.display_name AS sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE (m.recipient_id IS NULL OR m.sender_id=? OR m.recipient_id=?) ORDER BY m.created_at DESC LIMIT 100`).bind(u.id,u.id).all()).results.reverse();
  return base;
}
export default {
  async fetch(req,env){
    const origin=req.headers.get('origin');const allow=origin && env.APP_ORIGIN && origin===env.APP_ORIGIN;
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
    if(allow){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Headers']='authorization,content-type';headers['Access-Control-Allow-Methods']='GET,POST,PATCH,OPTIONS';headers['Access-Control-Max-Age']='600'}
    const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
    if(req.method==='OPTIONS')return new Response(null,{status:allow?204:403,headers});
    if(origin&&!allow)return respond({error:'Origin nicht freigegeben.'},403);
    if(!env.DB)return respond({error:'Datenbank nicht konfiguriert.'},503);
    let path;try{path=new URL(req.url).pathname}catch{return respond({error:'Ungültige URL.'},400)}
    if(path==='/health'&&req.method==='GET')return respond({status:'ok',service:'taxipro-v2-api'});
    try{
      if(path==='/api/bootstrap'&&req.method==='POST')return respond(await bootstrap(req,env),201);
      if(path==='/api/login'&&req.method==='POST')return respond(await login(req,env));
      const u=await getUser(req,env.DB);
      if(path==='/api/me'&&req.method==='GET')return respond({id:u.id,username:u.username,displayName:u.display_name,role:u.role});
      if(path==='/api/logout'&&req.method==='POST'){
        const hash=await sha(req.headers.get('authorization').slice(7).trim());
        await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(hash).run();return respond({ok:true});
      }
      if(path==='/api/state'&&req.method==='GET')return respond(await state(env.DB,u));
      if(path==='/api/users'&&req.method==='POST')return respond(await addDriver(req,env,u),201);
      if(path==='/api/series'&&req.method==='POST')return respond(await addSeries(req,env,u),201);
      if(path==='/api/series/generate'&&req.method==='POST')return respond(await generateSeries(req,env,u));
      if(path==='/api/breaks'&&req.method==='POST')return respond(await breakAction(req,env,u));
      const userMatch=path.match(/^\/api\/users\/([a-f0-9-]{36})$/);
      if(userMatch&&req.method==='PATCH')return respond(await resetDriver(req,env,u,userMatch[1]));
      if(path==='/api/customers'&&req.method==='POST')return respond(await addCustomer(req,env,u),201);
      if(path==='/api/rides'&&req.method==='POST')return respond(await addRide(req,env,u),201);
      const rideMatch=path.match(/^\/api\/rides\/([a-f0-9-]{36})$/);
      if(rideMatch&&req.method==='PATCH')return respond(await changeRide(req,env,u,rideMatch[1]));
      if(path==='/api/shifts'&&req.method==='POST')return respond(await shift(req,env,u));
      const shiftMatch=path.match(/^\/api\/shifts\/([a-f0-9-]{36})$/);
      if(shiftMatch&&req.method==='PATCH')return respond(await correctShift(req,env,u,shiftMatch[1]));
      if(path==='/api/position'&&req.method==='POST')return respond(await updatePosition(req,env,u));
      if(path==='/api/messages'&&req.method==='POST')return respond(await sendMessage(req,env,u),201);
      if(path==='/api/export'&&req.method==='GET'){
        requireAdmin(u);return respond({exportedAt:timestamp(),...await state(env.DB,u)});
      }
      return respond({error:'Endpunkt nicht gefunden.'},404);
    }catch(e){
      const code=e.status && e.status>=400&&e.status<=499?e.status:500;
      if(code===500)console.error('TaxiPro backend error',String(e?.message||'unknown').slice(0,120));
      return respond({error:code===500?'Interner Fehler.':e.message},code);
    }
  }
};