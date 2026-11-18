/**
 * TaxiPro community API module. All endpoints require a verified server-side
 * session from worker.js; do not expose this API from GitHub Pages.
 *
 * Public map data is separate from staff-only report/attachment/ride records.
 * No active radar/police-enforcement warnings are implemented.
 */
const TYPES = new Set(['jam','accident','roadworks','closure','hazard']);
const EXPIRY = {jam:120,accident:180,roadworks:24*60,closure:12*60,hazard:90};
const MIME = new Set(['application/pdf','image/jpeg','image/png','image/webp']);
const UUID = /^[a-f0-9-]{36}$/i;
const MAX_BYTES = 5 * 1024 * 1024;
const ID = () => crypto.randomUUID();
const NOW = () => new Date().toISOString();
const text = (v,max=280) => typeof v==='string'?v.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,max):'';
const error = (status,message) => Object.assign(new Error(message),{status});
const dateMinutes = (m) => new Date(Date.now()+m*60000).toISOString();
async function json(req) {
  if(Number(req.headers.get('content-length')||0)>18000)throw error(413,'Anfrage zu groß.');
  if(!(req.headers.get('content-type')||'').includes('application/json'))throw error(415,'JSON erforderlich.');
  let data;try{data=await req.json()}catch{throw error(400,'Ungültiges JSON.')}
  if(!data||typeof data!=='object'||Array.isArray(data)||JSON.stringify(data).length>18000)throw error(400,'Ungültige Anfrage.');
  return data;
}
async function audit(db,u,event,id,extra='') {
  await db.prepare('INSERT INTO audit(id,actor_id,event,entity_id,details,created_at) VALUES(?,?,?,?,?,?)')
    .bind(ID(),u.id,event,id,extra.slice(0,300),NOW()).run();
}
function coord(v,max,kind) {
  const n=Number(v);
  if(v===null||v===''||v===undefined||!Number.isFinite(n)||Math.abs(n)>max)throw error(400,kind+' ungültig.');
  return n;
}
export async function listReports(db) {
  const now=NOW();
  const q=await db.prepare(`SELECT t.id,t.reporter_id,u.display_name AS reporter_name,t.category,t.road,t.description,
    t.latitude,t.longitude,t.accuracy,t.observed_at,t.expires_at,t.created_at,t.status
    FROM traffic_reports t JOIN users u ON u.id=t.reporter_id
    WHERE t.status='active' AND t.expires_at>?
    ORDER BY t.created_at DESC LIMIT 300`).bind(now).all();
  return (q.results||[]);
}
async function createReport(req,env,u) {
  const body=await json(req);
  const category=text(body.category,30);
  if(!TYPES.has(category))throw error(400,'Nur Stau, Unfall, Baustelle, Sperrung oder Gefahr erlaubt.');
  const lat=coord(body.latitude,90,'Breitengrad'),lng=coord(body.longitude,180,'Längengrad');
  // Intended service area: Germany. No speculative pin based on street names.
  if(lat<47||lat>55.2||lng<5.5||lng>15.6)throw error(400,'Standort außerhalb des Einsatzgebietes.');
  const description=text(body.description,500),road=text(body.road,45);
  if(description.length<5)throw error(400,'Bitte die Verkehrslage genauer beschreiben.');
  if(/\b(blitzer|radar|lasermessung|geschwindigkeitskontrolle|polizeikontrolle|messwagen|speedcam)\b/i.test(description+' '+road))
    throw error(400,'Meldungen über Geschwindigkeitskontrollen werden nicht als Fahrerwarnung verbreitet.');
  const accuracy=body.accuracy==null?null:coord(body.accuracy,10000,'GPS-Genauigkeit');
  if(accuracy!==null&&accuracy<0)throw error(400,'GPS-Genauigkeit ungültig.');
  const id=ID(),now=NOW(),expires=dateMinutes(EXPIRY[category]);
  await env.DB.prepare(`INSERT INTO traffic_reports(id,reporter_id,category,road,description,latitude,longitude,accuracy,status,observed_at,expires_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,'active',?,?,?,?)`).bind(id,u.id,category,road,description,lat,lng,accuracy,now,expires,now,now).run();
  await env.DB.prepare('INSERT INTO messages(id,sender_id,recipient_id,body,created_at) VALUES(?,?,?,?,?)')
    .bind(ID(),u.id,null,'🚧 Verkehr: '+(road?road+' · ':'')+description.slice(0,440)+' (Details auf der internen Verkehrskarte)',now).run();
  await audit(env.DB,u,'traffic.created',id,category+' '+road);
  return {id,category,expiresAt:expires};
}
async function resolveReport(req,env,u,id) {
  const d=await json(req);
  if(d.action!=='resolve')throw error(400,'Nur als erledigt kennzeichnen möglich.');
  const existing=await env.DB.prepare('SELECT reporter_id,status FROM traffic_reports WHERE id=?').bind(id).first();
  if(!existing)throw error(404,'Meldung nicht gefunden.');
  if(u.role!=='admin'&&existing.reporter_id!==u.id)throw error(403,'Nur die meldende Person oder Zentrale darf schließen.');
  if(existing.status!=='active')throw error(409,'Meldung ist bereits geschlossen.');
  const result=await env.DB.prepare("UPDATE traffic_reports SET status='resolved',updated_at=? WHERE id=? AND status='active'").bind(NOW(),id).run();
  if(!result.meta?.changes)throw error(409,'Meldung wurde inzwischen geschlossen.');
  await audit(env.DB,u,'traffic.resolved',id);
  return {id,resolved:true};
}
export async function listSwaps(db,u) {
  const clause=u.role==='admin'?'':'WHERE w.requester_id=? OR w.target_driver_id=?';
  const q=`SELECT w.*,r.ride_date,r.ride_time,r.pickup,r.destination,
    a.display_name AS requester_name,b.display_name AS target_name
    FROM shift_swap_requests w JOIN rides r ON r.id=w.ride_id
    JOIN users a ON a.id=w.requester_id JOIN users b ON b.id=w.target_driver_id
    ${clause} ORDER BY w.created_at DESC LIMIT 200`;
  const stmt=db.prepare(q);
  return (await (u.role==='admin'?stmt:stmt.bind(u.id,u.id)).all()).results||[];
}
async function createSwap(req,env,u) {
  if(u.role!=='driver')throw error(403,'Tauschanfrage nur durch Fahrer.');
  const d=await json(req),id=text(d.rideId,64),target=text(d.targetDriverId,64);
  if(!UUID.test(id)||!UUID.test(target)||target===u.id)throw error(400,'Fahrt oder Ziel-Fahrer ungültig.');
  const ride=await env.DB.prepare("SELECT id,driver_id,status FROM rides WHERE id=?").bind(id).first();
  if(!ride||ride.driver_id!==u.id||ride.status!=='assigned')throw error(403,'Nur eigene noch nicht angetretene Fahrten sind tauschbar.');
  const driver=await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='driver' AND active=1").bind(target).first();
  if(!driver)throw error(404,'Ziel-Fahrer nicht aktiv.');
  const reqId=ID();
  try {
    await env.DB.prepare("INSERT INTO shift_swap_requests(id,ride_id,requester_id,target_driver_id,reason,status,created_at) VALUES(?,?,?,?,?,'requested',?)")
      .bind(reqId,id,u.id,target,text(d.reason,300),NOW()).run();
  } catch {throw error(409,'Für diese Fahrt liegt bereits eine offene Anfrage vor.');}
  await audit(env.DB,u,'swap.requested',reqId,id);
  return {id:reqId,status:'requested'};
}
async function changeSwap(req,env,u,id) {
  const d=await json(req),action=text(d.action,20);
  const w=await env.DB.prepare('SELECT * FROM shift_swap_requests WHERE id=?').bind(id).first();
  if(!w)throw error(404,'Tauschanfrage unbekannt.');
  const mapping={
    accept:{from:'requested',to:'accepted',role:'target'},
    decline:{from:'requested',to:'declined',role:'target'},
    cancel:{from:'requested',to:'cancelled',role:'requester'},
    reject:{from:'accepted',to:'rejected',role:'admin'},
    approve:{from:'accepted',to:'approved',role:'admin'}
  };
  const step=mapping[action];
  if(!step||w.status!==step.from)throw error(409,'Unzulässiger Statuswechsel.');
  if(step.role==='target'&&u.id!==w.target_driver_id||step.role==='requester'&&u.id!==w.requester_id||step.role==='admin'&&u.role!=='admin')
    throw error(403,'Nicht berechtigt.');
  const now=NOW();
  if(action==='approve') {
    const ride=await env.DB.prepare("SELECT driver_id,status FROM rides WHERE id=?").bind(w.ride_id).first();
    if(!ride||ride.driver_id!==w.requester_id||ride.status!=='assigned')throw error(409,'Fahrt ist nicht mehr tauschbar.');
    // D1 batch is atomic; the guarded updates are not a substitute for a
    // read-checked transaction under concurrent writes, so reject stale states first.
    await env.DB.batch([
      env.DB.prepare("UPDATE rides SET driver_id=? WHERE id=? AND driver_id=? AND status='assigned'")
        .bind(w.target_driver_id,w.ride_id,w.requester_id),
      env.DB.prepare("UPDATE shift_swap_requests SET status='approved',approved_at=?,approved_by=? WHERE id=? AND status='accepted'")
        .bind(now,u.id,id)
    ]);
  } else {
    const col=action==='accept'||action==='decline'?'responded_at':'approved_at';
    const q="UPDATE shift_swap_requests SET status=?, "+col+"=? WHERE id=? AND status=?";
    const result=await env.DB.prepare(q).bind(step.to,now,id,step.from).run();
    if(!result.meta?.changes)throw error(409,'Anfrage wurde inzwischen geändert.');
  }
  await audit(env.DB,u,'swap.'+action,id,w.ride_id);
  return {id,status:step.to};
}
function fileMime(req) {
  const mime=(req.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(!MIME.has(mime))throw error(415,'Nur PDF, JPEG, PNG und WebP erlaubt.');
  return mime;
}
function decodeName(req) {
  const val=req.headers.get('x-taxipro-filename')||'';
  let filename;
  try {filename=decodeURIComponent(val)}catch {throw error(400,'Dateiname ungültig.')}
  filename=text(filename.replace(/[\\/]/g,'_').replace(/[<>:"|?*]/g,'_'),120);
  if(!filename||filename.startsWith('.'))throw error(400,'Dateiname fehlt.');
  return filename;
}
function byteSignature(data,mime) {
  const b=new Uint8Array(data.slice(0,16));
  if(mime==='application/pdf')return String.fromCharCode(...b.slice(0,5))==='%PDF-';
  if(mime==='image/png')return b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71&&b[4]===13&&b[5]===10;
  if(mime==='image/jpeg')return b[0]===255&&b[1]===216&&b[2]===255;
  if(mime==='image/webp')return String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP';
  return false;
}
async function rawContent(req,max=MAX_BYTES) {
  const len=Number(req.headers.get('content-length')||0);
  if(len>max)throw error(413,'Datei überschreitet 5 MB.');
  const body=await req.arrayBuffer();
  if(body.byteLength<16||body.byteLength>max)throw error(413,'Dateigröße unzulässig.');
  return body;
}
function requireObjectStore(env) {
  if(!env.ATTACHMENTS)throw error(503,'Geschützter Dateispeicher noch nicht eingerichtet.');
  return env.ATTACHMENTS;
}
async function fileUpload(req,env,u) {
  const store=requireObjectStore(env);
  const recipient=text(req.headers.get('x-taxipro-recipient'),60);
  if(!UUID.test(recipient)||recipient===u.id)throw error(400,'Gültigen anderen Empfänger wählen.');
  const target=await env.DB.prepare('SELECT id FROM users WHERE id=? AND active=1').bind(recipient).first();
  if(!target)throw error(404,'Empfänger unbekannt.');
  const filename=decodeName(req),mime=fileMime(req),data=await rawContent(req);
  if(!byteSignature(data,mime))throw error(415,'Dateityp und Dateiinhalte stimmen nicht überein.');
  let note='';try{note=text(decodeURIComponent(req.headers.get('x-taxipro-note')||''),240)}catch{throw error(400,'Dateibeschreibung ungültig.')}
  const id=ID(),key='staff/'+id,created=NOW();
  await store.put(key,data,{httpMetadata:{contentType:mime},customMetadata:{owner:u.id,recipient}});
  try {
    await env.DB.prepare('INSERT INTO attachments(id,owner_id,recipient_id,filename,mime_type,bytes,object_key,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(id,u.id,recipient,filename,mime,data.byteLength,key,note,created).run();
  } catch(e) {await store.delete(key).catch(()=>{});throw e;}
  await audit(env.DB,u,'attachment.sent',id,filename);
  return {id,filename,mimeType:mime,bytes:data.byteLength,recipientId:recipient,createdAt:created};
}
export async function listFiles(db,u) {
  const result=await db.prepare(`SELECT a.id,a.owner_id,a.recipient_id,a.filename,a.mime_type,a.bytes,a.note,a.created_at,
    o.display_name AS owner_name,r.display_name AS recipient_name,
    CASE WHEN ap.attachment_id IS NULL THEN 0 ELSE 1 END AS pinned
    FROM attachments a
    JOIN users o ON o.id=a.owner_id JOIN users r ON r.id=a.recipient_id
    LEFT JOIN attachment_pins ap ON ap.attachment_id=a.id AND ap.user_id=?
    WHERE a.owner_id=? OR a.recipient_id=?
    ORDER BY pinned DESC, a.created_at DESC LIMIT 200`).bind(u.id,u.id,u.id).all();
  return result.results||[];
}
async function pinAttachment(req,env,u,id) {
  const input=await json(req);
  if(typeof input.pinned!=='boolean')throw error(400,'Anheften muss wahr oder falsch sein.');
  const a=await env.DB.prepare('SELECT owner_id,recipient_id FROM attachments WHERE id=?').bind(id).first();
  if(!a)throw error(404,'Datei nicht gefunden.');
  if(a.owner_id!==u.id&&a.recipient_id!==u.id)throw error(403,'Nicht berechtigt.');
  if(input.pinned){
    await env.DB.prepare('INSERT INTO attachment_pins(user_id,attachment_id,pinned_at) VALUES(?,?,?) ON CONFLICT(user_id,attachment_id) DO UPDATE SET pinned_at=excluded.pinned_at').bind(u.id,id,NOW()).run();
  }else{
    await env.DB.prepare('DELETE FROM attachment_pins WHERE user_id=? AND attachment_id=?').bind(u.id,id).run();
  }
  await audit(env.DB,u,'attachment.pin',id,input.pinned?'pinned':'unpinned');
  return {id,pinned:input.pinned};
}
async function fileDownload(env,u,id) {
  const store=requireObjectStore(env);
  const row=await env.DB.prepare('SELECT owner_id,recipient_id,object_key,filename,mime_type FROM attachments WHERE id=?').bind(id).first();
  if(!row)throw error(404,'Datei nicht gefunden.');
  if(row.owner_id!==u.id&&row.recipient_id!==u.id)throw error(403,'Datei nicht freigegeben.');
  const object=await store.get(row.object_key);
  if(!object)throw error(404,'Datei nicht mehr verfügbar.');
  const basename=row.filename.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100);
  return new Response(object.body,{headers:{
    'Content-Type':row.mime_type,
    'Content-Disposition':'attachment; filename="'+basename+'"',
    'X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':'sandbox',
    'Cache-Control':'private, no-store'
  }});
}
async function signatureUpload(req,env,u) {
  if(u.role!=='driver')throw error(403,'Unterschriften nur durch den zugewiesenen Fahrer.');
  const store=requireObjectStore(env);
  if(fileMime(req)!=='image/png')throw error(415,'Unterschrift muss als PNG vorliegen.');
  const signer=text(req.headers.get('x-taxipro-signer'),120);
  const confirm=req.headers.get('x-taxipro-confirm')==='yes';
  if(signer.length<2||!confirm)throw error(400,'Unterzeichner und bestätigter Hinweis erforderlich.');
  let rideIds;
  try {rideIds=JSON.parse(req.headers.get('x-taxipro-ride-ids')||'[]')}catch{throw error(400,'Fahrtliste ungültig.')}
  if(!Array.isArray(rideIds)||rideIds.length<1||rideIds.length>12||rideIds.some(x=>!UUID.test(x))||new Set(rideIds).size!==rideIds.length)
    throw error(400,'1 bis 12 eindeutige Fahrtkennungen erforderlich.');
  const rows=[];
  for(const rideId of rideIds) {
    const ride=await env.DB.prepare('SELECT id,customer_id,driver_id,ride_date,status FROM rides WHERE id=?').bind(rideId).first();
    if(!ride||ride.driver_id!==u.id||ride.status==='cancelled')throw error(403,'Fahrt nicht zugewiesen oder storniert.');
    rows.push(ride);
  }
  if(rows.some(x=>x.customer_id!==rows[0].customer_id||x.ride_date!==rows[0].ride_date))
    throw error(400,'Nur Fahrten desselben Kunden und desselben Tages gemeinsam unterschreiben.');
  const already=await env.DB.prepare('SELECT ride_id FROM ride_signature_links WHERE ride_id IN ('+rideIds.map(()=>'?').join(',')+')').bind(...rideIds).all();
  if((already.results||[]).length)throw error(409,'Mindestens eine Fahrt ist bereits unterschrieben.');
  const image=await rawContent(req,350000);
  if(!byteSignature(image,'image/png'))throw error(415,'Ungültige PNG-Unterschrift.');
  const id=ID(),key='signature/'+id,created=NOW();
  const confirmation='Bestätigung der auf dem Bildschirm aufgeführten Beförderungsleistungen durch die unterzeichnende Person; keine automatische Anerkennung durch Krankenkassen.';
  await store.put(key,image,{httpMetadata:{contentType:'image/png'}});
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO ride_signatures(id,driver_id,customer_id,signer_name,consent_text,object_key,created_at) VALUES(?,?,?,?,?,?,?)')
        .bind(id,u.id,rows[0].customer_id,signer,confirmation,key,created),
      ...rideIds.map(ride=>env.DB.prepare('INSERT INTO ride_signature_links(signature_id,ride_id) VALUES(?,?)').bind(id,ride))
    ]);
  }catch(e){await store.delete(key).catch(()=>{});throw e;}
  await audit(env.DB,u,'ride.signature',id,rideIds.join(','));
  return {id,rideIds,createdAt:created,signerName:signer};
}
export async function listSignatures(db,u) {
  const clause=u.role==='admin'?'':'WHERE s.driver_id=?';
  const stmt=db.prepare(`SELECT s.id,s.driver_id,s.customer_id,s.signer_name,s.created_at,group_concat(l.ride_id) AS ride_ids
    FROM ride_signatures s LEFT JOIN ride_signature_links l ON l.signature_id=s.id
    ${clause} GROUP BY s.id ORDER BY s.created_at DESC LIMIT 150`);
  const res=await (u.role==='admin'?stmt:stmt.bind(u.id)).all();
  return res.results||[];
}
async function signatureDownload(env,u,id) {
  const store=requireObjectStore(env);
  const sig=await env.DB.prepare('SELECT driver_id,object_key FROM ride_signatures WHERE id=?').bind(id).first();
  if(!sig)throw error(404,'Unterschrift nicht gefunden.');
  if(u.role!=='admin'&&sig.driver_id!==u.id)throw error(403,'Nicht berechtigt.');
  const object=await store.get(sig.object_key);
  if(!object)throw error(404,'Bild nicht mehr verfügbar.');
  return new Response(object.body,{headers:{
    'Content-Type':'image/png','Content-Disposition':'attachment; filename="fahrt-unterschrift.png"',
    'X-Content-Type-Options':'nosniff','Content-Security-Policy':'sandbox','Cache-Control':'private, no-store'
  }});
}
/** Return undefined if route not owned. Objects follow the outer JSON responder; Response bodies are directly returned. */
export async function handleCommunity(req,env,u,path) {
  const url=new URL(req.url),m=req.method;
  if(path==='/api/traffic-reports'&&m==='GET')return {reports:await listReports(env.DB)};
  if(path==='/api/traffic-reports'&&m==='POST')return {status:201,data:await createReport(req,env,u)};
  const rep=path.match(/^\/api\/traffic-reports\/([a-f0-9-]{36})$/i);
  if(rep&&m==='PATCH')return {data:await resolveReport(req,env,u,rep[1])};
  if(path==='/api/swaps'&&m==='GET')return {swaps:await listSwaps(env.DB,u)};
  if(path==='/api/swaps'&&m==='POST')return {status:201,data:await createSwap(req,env,u)};
  const swap=path.match(/^\/api\/swaps\/([a-f0-9-]{36})$/i);
  if(swap&&m==='PATCH')return {data:await changeSwap(req,env,u,swap[1])};
  if(path==='/api/attachments'&&m==='GET')return {attachments:await listFiles(env.DB,u),storageReady:!!env.ATTACHMENTS};
  if(path==='/api/attachments'&&m==='POST')return {status:201,data:await fileUpload(req,env,u)};
  const attached=path.match(/^\/api\/attachments\/([a-f0-9-]{36})$/i);
  if(attached&&m==='GET')return {response:await fileDownload(env,u,attached[1])};
  const pinnedFile=path.match(/^\/api\/attachments\/([a-f0-9-]{36})\/pin$/i);
  if(pinnedFile&&m==='PATCH')return {data:await pinAttachment(req,env,u,pinnedFile[1])};
  if(path==='/api/signatures'&&m==='GET')return {signatures:await listSignatures(env.DB,u),storageReady:!!env.ATTACHMENTS};
  if(path==='/api/signatures'&&m==='POST')return {status:201,data:await signatureUpload(req,env,u)};
  const signed=path.match(/^\/api\/signatures\/([a-f0-9-]{36})\/file$/i);
  if(signed&&m==='GET')return {response:await signatureDownload(env,u,signed[1])};
  return undefined;
}
