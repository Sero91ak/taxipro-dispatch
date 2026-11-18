/**
 * TaxiPro 2.4 – live time display for an existing shift.
 * Server /api/time-summary remains authoritative for payroll and month reports.
 * This stateless helper makes second-by-second gross/net/break timers coherent
 * on both the driver home and shift page, including overlapping corrections.
 */
export function activeShiftDurations(shift,breaks=[],asOf=Date.now()){
 const empty={grossMs:0,breakMs:0,netMs:0,paused:false};
 if(!shift||!shift.started_at)return empty;
 const from=Date.parse(shift.started_at);
 const until=shift.ended_at?Date.parse(shift.ended_at):Number(asOf);
 if(!Number.isFinite(from)||!Number.isFinite(until)||until<from)return empty;
 const grossMs=Math.max(0,until-from);
 const intervals=[];
 let paused=false;
 for(const item of breaks||[]){
  if(item.shift_id!==shift.id)continue;
  const begin=Date.parse(item.started_at);
  const end=item.ended_at?Date.parse(item.ended_at):until;
  if(!Number.isFinite(begin)||!Number.isFinite(end))continue;
  if(!item.ended_at&&!shift.ended_at)paused=true;
  const a=Math.max(from,begin),b=Math.min(until,end);
  if(b>a)intervals.push([a,b]);
 }
 // Union intervals so a corrected or duplicate break never subtracts twice.
 intervals.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 let breakMs=0,first=null,last=null;
 for(const [a,b] of intervals){
  if(first===null){first=a;last=b;continue;}
  if(a<=last)last=Math.max(last,b);
  else{breakMs+=last-first;first=a;last=b;}
 }
 if(first!==null)breakMs+=last-first;
 breakMs=Math.min(grossMs,breakMs);
 return {grossMs,breakMs,netMs:grossMs-breakMs,paused};
}
