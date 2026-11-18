/**
 * TaxiPro Arbeitszeit-Auswertung (Europe/Berlin).
 * Schicht- und Pausenereignisse sind serverzeitgestempelt; Laufzeiten werden
 * aus den Originalereignissen berechnet, nicht vom Client zurückgeschrieben.
 * Auch Nachtschichten und Sommer-/Winterzeitwechsel werden aufgeteilt.
 */
const TZ = 'Europe/Berlin';
const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});
const DAY = 86400000;
const validDate = s => {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
  const [y,m,d]=s.split('-').map(Number);
  const dt=new Date(Date.UTC(y,m-1,d));
  return dt.getUTCFullYear()===y&&dt.getUTCMonth()+1===m&&dt.getUTCDate()===d;
};
function localOffsetAt(epoch) {
  const parts=Object.fromEntries(fmt.formatToParts(new Date(epoch)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  const wall=Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second);
  return wall-Math.floor(epoch/1000)*1000;
}
export function berlinMidnight(y,m,d) {
  const naive=Date.UTC(y,m-1,d);
  let guess=naive;
  for(let i=0;i<3;i++)guess=naive-localOffsetAt(guess);
  return guess;
}
export function periodBounds(period,date) {
  if(!['day','month','year'].includes(period)||!validDate(date))throw new Error('Ungültiger Zeitraum.');
  const [y,m,d]=date.split('-').map(Number);
  const start=period==='day'?[y,m,d]:period==='month'?[y,m,1]:[y,1,1];
  const end=period==='day'?[y,m,d+1]:period==='month'?[y,m+1,1]:[y+1,1,1];
  return {period,date,from:berlinMidnight(...start),to:berlinMidnight(...end),timezone:TZ};
}
const millisOf = iso => {const n=Date.parse(iso||'');return Number.isFinite(n)?n:null};
const overlap = (a,b,c,d) => Math.max(0,Math.min(b,d)-Math.max(a,c));
export function summarizeTime(shifts,breaks,bounds,nowMs=Date.now()) {
  const from=bounds.from,to=Math.min(bounds.to,nowMs),perShift=new Map();
  const perDriver=new Map();
  let grossMs=0,breakMs=0,activeShifts=0,shiftCount=0;
  for(const s of shifts) {
    const started=millisOf(s.started_at);
    const ended=s.ended_at?millisOf(s.ended_at):nowMs;
    if(started===null||ended===null||ended<started)continue;
    const included=overlap(started,ended,from,to);
    if(included===0)continue;
    const entry={id:s.id,driverId:s.driver_id,driverName:s.driver_name||'',grossMs:included,breakMs:0,active:!s.ended_at,startedAt:s.started_at,endedAt:s.ended_at||null};
    perShift.set(s.id,entry);
    if(!s.ended_at)activeShifts++;
    grossMs+=included;shiftCount++;
  }
  for(const b of breaks) {
    const shift=perShift.get(b.shift_id);
    if(!shift)continue;
    const begin=millisOf(b.started_at);
    const end=b.ended_at?millisOf(b.ended_at):nowMs;
    if(begin===null||end===null||end<begin)continue;
    const related=shifts.find(s=>s.id===b.shift_id);
    if(!related)continue;
    const shiftStart=millisOf(related.started_at);
    const shiftEnd=related.ended_at?millisOf(related.ended_at):nowMs;
    const part=Math.max(0,overlap(Math.max(begin,shiftStart),Math.min(end,shiftEnd),from,to));
    shift.breakMs+=part;
    breakMs+=part;
  }
  const items=[...perShift.values()].map(x=>({...x,breakMs:Math.min(x.breakMs,x.grossMs),netMs:Math.max(0,x.grossMs-x.breakMs)}));
  breakMs=items.reduce((s,x)=>s+x.breakMs,0);
  for(const x of items) {
    if(!perDriver.has(x.driverId))perDriver.set(x.driverId,{driverId:x.driverId,driverName:x.driverName,shiftCount:0,grossMs:0,breakMs:0,netMs:0});
    const d=perDriver.get(x.driverId);
    d.shiftCount++;d.grossMs+=x.grossMs;d.breakMs+=x.breakMs;d.netMs+=x.netMs;
  }
  return {
    period:bounds.period,date:bounds.date,timezone:TZ,from:new Date(bounds.from).toISOString(),
    until:new Date(bounds.to).toISOString(),computedAt:new Date(nowMs).toISOString(),
    shiftCount,activeShifts,grossMs,breakMs,netMs:Math.max(0,grossMs-breakMs),
    byDriver:[...perDriver.values()].sort((a,b)=>a.driverName.localeCompare(b.driverName)),
    shifts:items.sort((a,b)=>b.startedAt.localeCompare(a.startedAt))
  };
}
export async function fetchTimeSummary(db,user,search,nowMs=Date.now()) {
  const period=search.get('period')||'month';
  const date=search.get('date')||new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(nowMs));
  const bounds=periodBounds(period,date);
  const filterId=user.role==='driver'?user.id:search.get('driverId')||null;
  if(filterId&&!/^[a-f0-9-]{36}$/i.test(filterId))throw Object.assign(new Error('Fahrer-ID ungültig.'),{status:400});
  const ending=new Date(Math.min(bounds.to,nowMs)).toISOString(),beginning=new Date(bounds.from).toISOString();
  const selectShifts='SELECT s.*,u.display_name AS driver_name FROM shifts s JOIN users u ON u.id=s.driver_id WHERE s.started_at<? AND (s.ended_at IS NULL OR s.ended_at>?)'+(filterId?' AND s.driver_id=?':'')+' ORDER BY s.started_at DESC';
  const selectBreaks='SELECT b.* FROM shift_breaks b JOIN shifts s ON s.id=b.shift_id WHERE b.started_at<? AND (b.ended_at IS NULL OR b.ended_at>?)'+(filterId?' AND b.driver_id=?':'')+' ORDER BY b.started_at DESC';
  const bind=filterId?[ending,beginning,filterId]:[ending,beginning];
  const [shifts,breaks]=await Promise.all([
    db.prepare(selectShifts).bind(...bind).all(),
    db.prepare(selectBreaks).bind(...bind).all()
  ]);
  return summarizeTime(shifts.results||[],breaks.results||[],bounds,nowMs);
}
