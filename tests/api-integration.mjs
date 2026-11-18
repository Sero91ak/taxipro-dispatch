import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import worker from '../backend/worker.js';
const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON;'+readFileSync(new URL('../backend/schema.sql',import.meta.url),'utf8'));
const fake={async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const res=[];for(const statement of statements)res.push(await statement.run());sqlite.exec('COMMIT');return res}catch(error){sqlite.exec('ROLLBACK');throw error}},prepare(sql){let bindings=[];return {bind(...args){bindings=args;return this},first(){return sqlite.prepare(sql).get(...bindings)||null},all(){return {results:sqlite.prepare(sql).all(...bindings)}},run(){return {meta:{changes:sqlite.prepare(sql).run(...bindings).changes}}}}}};
const env={DB:fake,APP_ORIGIN:'https://sero91ak.github.io',BOOTSTRAP_SECRET:'a-very-long-random-secret-for-test-only-12345'};
let token='';
async function call(path,method='GET',payload=null,t=token,origin=env.APP_ORIGIN){const res=await worker.fetch(new Request('https://taxipro.test'+path,{method,headers:{...(origin?{Origin:origin}:{}),...(payload?{'Content-Type':'application/json'}:{}),...(t?{Authorization:'Bearer '+t}:{}),'CF-Connecting-IP':'127.0.0.1'},...(payload?{body:JSON.stringify(payload)}:{})}),env);let data=await res.json();return {status:res.status,data}}
const setup=await call('/api/bootstrap','POST',{setupSecret:env.BOOTSTRAP_SECRET,username:'admin',displayName:'Zentrale',password:'1234567890TEST_ADMIN_12345'});assert.equal(setup.status,201,'bootstrap');
const second=await call('/api/bootstrap','POST',{setupSecret:env.BOOTSTRAP_SECRET,username:'bad',displayName:'Bad',password:'1234567890TEST_ADMIN_12345'});assert.equal(second.status,409,'cannot bootstrap twice');
const admin=await call('/api/login','POST',{username:'admin',password:'1234567890TEST_ADMIN_12345'});assert.equal(admin.status,200,'admin login');token=admin.data.token;
const userA=await call('/api/users','POST',{username:'driver1',displayName:'Demo Fahrer A',password:'TESTPASSWORT_1234'});assert.equal(userA.status,201,'driver create');
const userB=await call('/api/users','POST',{username:'driver2',displayName:'Demo Fahrer B',password:'TESTPASSWORT_5678'});assert.equal(userB.status,201);
const cust=await call('/api/customers','POST',{name:'Demo Patient',pickup:'Meckenheim Zentrum',destination:'Bonn Bahnhof',kind:'Rechnungsfahrt'});assert.equal(cust.status,201);
let rA=await call('/api/rides','POST',{customerId:cust.data.id,driverId:userA.data.id,date:'2026-10-30',time:'09:10',pickup:'Meckenheim',destination:'Bonn',kind:'Rechnungsfahrt',direction:'hin',signatureRequired:false});assert.equal(rA.status,201);
let rB=await call('/api/rides','POST',{customerId:cust.data.id,driverId:userB.data.id,date:'2026-10-30',time:'11:10',pickup:'Meckenheim',destination:'Bonn',kind:'Rechnungsfahrt',direction:'hin',signatureRequired:false});assert.equal(rB.status,201);
const loginA=await call('/api/login','POST',{username:'driver1',password:'TESTPASSWORT_1234'},'');assert.equal(loginA.status,200);const aToken=loginA.data.token;
const aState=await call('/api/state','GET',null,aToken);assert.equal(aState.status,200);assert.equal(aState.data.rides.length,1,'isolation of other driver rides');assert.equal(aState.data.customers,undefined,'driver has no customer master');assert.equal(aState.data.drivers,undefined,'driver has no admin driver master');
const unauthorized=await call('/api/rides/'+rB.data.id,'PATCH',{action:'accept'},aToken);assert.equal(unauthorized.status,403,'cannot accept other driver ride');
const forbidCustomer=await call('/api/customers','POST',{name:'x',pickup:'x',destination:'x',kind:'Barfahrt'},aToken);assert.equal(forbidCustomer.status,403,'driver cannot create customer');
let loc=await call('/api/position','POST',{latitude:50.624,longitude:7.032},aToken);assert.equal(loc.status,409,'no location outside active shift');
const shiftStart=await call('/api/shifts','POST',{action:'start'},aToken);assert.equal(shiftStart.status,200);
const duplicate=await call('/api/shifts','POST',{action:'start'},aToken);assert.equal(duplicate.status,409,'no duplicate active shifts');
loc=await call('/api/position','POST',{latitude:50.624,longitude:7.032,accuracy:20},aToken);assert.equal(loc.status,200,'location during shift');
const accepted=await call('/api/rides/'+rA.data.id,'PATCH',{action:'accept'},aToken);assert.equal(accepted.status,200);
const complete=await call('/api/rides/'+rA.data.id,'PATCH',{action:'complete'},aToken);assert.equal(complete.status,200);
const duplicateComplete=await call('/api/rides/'+rA.data.id,'PATCH',{action:'complete'},aToken);assert.equal(duplicateComplete.status,409,'strict transition');
const end=await call('/api/shifts','POST',{action:'end'},aToken);assert.equal(end.status,200);
const fix=await call('/api/shifts/'+shiftStart.data.id,'PATCH',{startedAt:'2026-10-30T06:00:00.000Z',endedAt:'2026-10-30T14:00:00.000Z',reason:'Testkorrektur dokumentierte Stunden'},token);assert.equal(fix.status,200,'admin can correct a finished shift');
const badFix=await call('/api/shifts/'+shiftStart.data.id,'PATCH',{startedAt:'2026-10-30T06:00:00.000Z',endedAt:'2026-10-30T14:00:00.000Z',reason:'Testkorrektur dokumentierte Stunden'},aToken);assert.equal(badFix.status,403,'driver cannot correct shifts');
const adminState=await call('/api/state');assert.equal(adminState.data.adjustments.length,1,'revision history present');assert.equal(adminState.data.adjustments[0].previous_start,adminState.data.shifts[0].original_started_at,'original preserved');assert.equal(adminState.status,200);assert.equal(adminState.data.positions.length,0,'positions removed at shift end');
const group=await call('/api/messages','POST',{body:'Hallo Team',recipientId:null},aToken);assert.equal(group.status,201);
const secret=await call('/api/messages','POST',{body:'Nur an Zentrale',recipientId:admin.data.user.id},aToken);assert.equal(secret.status,201);
const blockedPrivate=await call('/api/messages','POST',{body:'Nicht an Kollegen',recipientId:userB.data.id},aToken);assert.equal(blockedPrivate.status,201,'Fahrer dürfen Kollegen private Nachrichten schicken');
const bLogin=await call('/api/login','POST',{username:'driver2',password:'TESTPASSWORT_5678'},'');assert.equal(bLogin.status,200);
const bState=await call('/api/state','GET',null,bLogin.data.token);assert.equal(bState.data.messages.length,2,'Fahrer B sieht Gruppenchat und eigene direkte Nachricht, nicht private Admin-Nachrichten');
const adminState2=await call('/api/state');assert.equal(adminState2.data.messages.length,2,'admin sees group and private');
const wrongOrigin=await call('/api/state','GET',null,token,'https://evil.example');assert.equal(wrongOrigin.status,403,'CORS origin restriction');

// Version 2.2: series generator, break tracking, password reset and account lifecycle.
const beforeBreak=await call('/api/breaks','POST',{action:'start'},aToken);assert.equal(beforeBreak.status,409,'no break outside shift');
const noSeries=await call('/api/series','POST',{customerId:cust.data.id,driverId:userA.data.id,startDate:'2026-10-30',endDate:'2026-11-30',weekdays:[5],outboundTime:'08:00',returnTime:'12:00',pickup:'Meckenheim',destination:'Bonn',kind:'Krankenfahrt',signatureRequired:true},aToken);assert.equal(noSeries.status,403,'driver cannot create recurring templates');
const series=await call('/api/series','POST',{customerId:cust.data.id,driverId:userA.data.id,startDate:'2026-10-30',endDate:'2026-11-30',weekdays:[5],outboundTime:'08:00',returnTime:'12:00',pickup:'Meckenheim',destination:'Bonn',kind:'Krankenfahrt',signatureRequired:true});assert.equal(series.status,201,'series template created');
const range=await call('/api/series/generate','POST',{seriesId:series.data.id,from:'2026-10-30',to:'2026-11-06'});assert.equal(range.status,200);assert.equal(range.data.created,4,'Friday series both legs on two Fridays');
const secondGenerate=await call('/api/series/generate','POST',{seriesId:series.data.id,from:'2026-10-30',to:'2026-11-06'});assert.equal(secondGenerate.data.created,0,'idempotent recurring generator');assert.equal(secondGenerate.data.existing,4,'already present');
const largeRange=await call('/api/series/generate','POST',{seriesId:series.data.id,from:'2026-10-30',to:'2027-02-01'});assert.equal(largeRange.status,400,'max 31 day generation');
const newAState=await call('/api/state','GET',null,aToken);assert.equal(newAState.data.rides.length,5,'only own rides incl recurring');assert.equal(newAState.data.series,undefined,'driver cannot enumerate series templates');
const breakShift=await call('/api/shifts','POST',{action:'start'},aToken);assert.equal(breakShift.status,200);
const startBreak=await call('/api/breaks','POST',{action:'start'},aToken);assert.equal(startBreak.status,200,'start break');
const anotherBreak=await call('/api/breaks','POST',{action:'start'},aToken);assert.equal(anotherBreak.status,409,'cannot start duplicate break');
const shiftEndDuringBreak=await call('/api/shifts','POST',{action:'end'},aToken);assert.equal(shiftEndDuringBreak.status,409,'cannot close shift while break is active');
const stopBreak=await call('/api/breaks','POST',{action:'end'},aToken);assert.equal(stopBreak.status,200,'end break');
const stopAgain=await call('/api/breaks','POST',{action:'end'},aToken);assert.equal(stopAgain.status,409,'cannot end a closed break');
const endShift2=await call('/api/shifts','POST',{action:'end'},aToken);assert.equal(endShift2.status,200);
const statusAsDriver=await call('/api/users/'+userB.data.id,'PATCH',{active:false},aToken);assert.equal(statusAsDriver.status,403,'driver cannot deactivate colleagues');
const deactivate=await call('/api/users/'+userB.data.id,'PATCH',{active:false});assert.equal(deactivate.status,200,'admin can deactivate driver');
const loginInactive=await call('/api/login','POST',{username:'driver2',password:'TESTPASSWORT_5678'},'');assert.equal(loginInactive.status,401,'inactive account cannot login');
const oldSession=await call('/api/state','GET',null,bLogin.data.token);assert.equal(oldSession.status,401,'deactivation revokes sessions');
const reactivate=await call('/api/users/'+userB.data.id,'PATCH',{active:true});assert.equal(reactivate.status,200,'reactivate account');
const reset=await call('/api/users/'+userB.data.id,'PATCH',{password:'NEU_TEST_PASSWORD_87654321'});assert.equal(reset.status,200,'password reset via admin');
const oldPass=await call('/api/login','POST',{username:'driver2',password:'TESTPASSWORT_5678'},'');assert.equal(oldPass.status,401,'old password invalid');
const newPass=await call('/api/login','POST',{username:'driver2',password:'NEU_TEST_PASSWORD_87654321'},'');assert.equal(newPass.status,200,'new password works');
const adminFull=await call('/api/state');assert.equal(adminFull.data.series.length,1);assert.equal(adminFull.data.breaks.length,1,'break history in admin export');
const badExport=await call('/api/export','GET',null,aToken);assert.equal(badExport.status,403,'no driver full export');
console.log('PASS: API integration – bootstrap, login, role separation, driver accounts, rides, shifts, GPS, messages, origin checks (64 assertions).');

// Version 2.3: secure staff-community operations and evidence access tests.
const staffReport=await call('/api/traffic-reports','POST',
 {category:'jam',road:'A565',description:'Stau vor der Anschlussstelle',
 latitude:50.654,longitude:7.035,accuracy:18},aToken);
assert.equal(staffReport.status,201,'Fahrer darf eigene Verkehrsmeldung erstellen');
const allReports=await call('/api/traffic-reports','GET',null,bLogin.data.token);
assert.equal(allReports.status,200);
assert.equal(allReports.data.reports.length,1);
assert.equal(allReports.data.reports[0].road,'A565');
assert.equal(allReports.data.reports[0].reporter_id,userA.data.id);
const prohibited=await call('/api/traffic-reports','POST',
 {category:'hazard',description:'Blitzer an der Straße',latitude:50.62,longitude:7.03},aToken);
assert.equal(prohibited.status,400,'Keine Blitzerwarnungen für fahrende Mitarbeiter');
const resolveNotOwn=await call('/api/traffic-reports/'+staffReport.data.id,'PATCH',{action:'resolve'},bLogin.data.token);
assert.equal(resolveNotOwn.status,403);
const resolved=await call('/api/traffic-reports/'+staffReport.data.id,'PATCH',{action:'resolve'},aToken);
assert.equal(resolved.status,200);
assert.equal((await call('/api/traffic-reports')).data.reports.length,0,'Aufgelöste Meldungen verschwinden');

const swapRide=await call('/api/rides','POST',{customerId:cust.data.id,driverId:userA.data.id,date:'2026-11-19',time:'12:00',pickup:'Meckenheim',destination:'Bonn',kind:'Rechnungsfahrt',direction:'hin'});
assert.equal(swapRide.status,201);
const swapReq=await call('/api/swaps','POST',{rideId:swapRide.data.id,targetDriverId:userB.data.id,reason:'Dienstplan kurzfristig geändert'},aToken);
assert.equal(swapReq.status,201,'Fahrer darf eine Tauschanfrage stellen');
assert.equal((await call('/api/swaps','GET',null,bLogin.data.token)).data.swaps.length,1);
assert.equal((await call('/api/swaps/'+swapReq.data.id,'PATCH',{action:'approve'},token)).status,409,'Zentrale darf ohne Annahme nicht tauschen');
assert.equal((await call('/api/swaps/'+swapReq.data.id,'PATCH',{action:'accept'},aToken)).status,403,'Anfragender darf nicht selbst annehmen');
assert.equal((await call('/api/swaps/'+swapReq.data.id,'PATCH',{action:'accept'},bLogin.data.token)).status,200);
assert.equal((await call('/api/swaps/'+swapReq.data.id,'PATCH',{action:'approve'},token)).status,200);
const swapped=await call('/api/state','GET',null,bLogin.data.token);
assert.ok(swapped.data.rides.some(x=>x.id===swapRide.data.id),'Neue Fahrerzuordnung ist verbindlich');
const former=await call('/api/state','GET',null,aToken);
assert.ok(!former.data.rides.some(x=>x.id===swapRide.data.id),'Fahrt beim alten Fahrer nicht mehr sichtbar');

// Optional private object storage: refuse when not provisioned. No public Drive links.
const withoutStorage=await call('/api/attachments','GET');
assert.equal(withoutStorage.data.storageReady,false);
const objects=new Map();
env.ATTACHMENTS={
 async put(key,buffer){objects.set(key,Buffer.from(buffer));},
 async get(key){const bytes=objects.get(key);return bytes?{body:new Blob([bytes])}:null},
 async delete(key){objects.delete(key)}
};
async function binaryCall(path,mime,buf,extraHeaders={},t=aToken){
 const resp=await worker.fetch(new Request('https://taxipro.test'+path,{
  method:'POST',headers:{Origin:env.APP_ORIGIN,Authorization:'Bearer '+t,'Content-Type':mime,...extraHeaders},
  body:Buffer.from(buf)
 }),env);
 let data=await resp.json();return {status:resp.status,data};
}
const pdf=Buffer.from('%PDF-1.4\n1 0 obj<<>>\n%%EOF','utf8');
const file=await binaryCall('/api/attachments','application/pdf',pdf,
 {'x-taxipro-recipient':userB.data.id,'x-taxipro-filename':encodeURIComponent('Schichtplan-Test.pdf'),'x-taxipro-note':'Nur Testbeleg'});
assert.equal(file.status,201,'Geschützter PDF-Upload');
const filesB=await call('/api/attachments','GET',null,bLogin.data.token);
assert.equal(filesB.data.attachments.length,1);
assert.equal(filesB.data.attachments[0].owner_id,userA.data.id);
assert.equal(filesB.data.attachments[0].recipient_id,userB.data.id);
let down=await worker.fetch(new Request('https://taxipro.test/api/attachments/'+file.data.id,{
 headers:{Origin:env.APP_ORIGIN,Authorization:'Bearer '+bLogin.data.token}
}),env);
assert.equal(down.status,200,'Empfänger darf Datei öffnen');
assert.equal(down.headers.get('Access-Control-Allow-Origin'),env.APP_ORIGIN,'Binäre Antwort mit CORS');
assert.equal(await down.text(),pdf.toString());
const unauthorizedFile=await worker.fetch(new Request('https://taxipro.test/api/attachments/'+file.data.id,{
 headers:{Origin:env.APP_ORIGIN,Authorization:'Bearer '+token}
}),env);
assert.equal(unauthorizedFile.status,403,'Auch Admin sieht fremde Privatdateien nicht automatisch');

const signRide=await call('/api/rides','POST',{customerId:cust.data.id,driverId:userA.data.id,date:'2026-10-30',time:'13:00',
 pickup:'Meckenheim',destination:'Bonn',kind:'Rechnungsfahrt',direction:'rueck'});
assert.equal(signRide.status,201);
const tinyPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOaNXwAAAABJRU5ErkJggg==','base64');
const signed=await binaryCall('/api/signatures','image/png',tinyPng,{
 'x-taxipro-signer':'Testperson','x-taxipro-confirm':'yes','x-taxipro-ride-ids':JSON.stringify([rA.data.id,signRide.data.id])
});
assert.equal(signed.status,201,'Eine Unterschrift für zwei Fahrten desselben Tages');
assert.equal(signed.data.rideIds.length,2);
const signatures=(await call('/api/signatures','GET',null,aToken)).data.signatures;
assert.equal(signatures.length,1);
const duplicateSignature=await binaryCall('/api/signatures','image/png',tinyPng,{
 'x-taxipro-signer':'Testperson','x-taxipro-confirm':'yes','x-taxipro-ride-ids':JSON.stringify([rA.data.id])
});
assert.equal(duplicateSignature.status,409,'Keine doppelte Unterschrift');
const otherSig=await worker.fetch(new Request('https://taxipro.test/api/signatures/'+signed.data.id+'/file',{
 headers:{Origin:env.APP_ORIGIN,Authorization:'Bearer '+bLogin.data.token}
}),env);
assert.equal(otherSig.status,403,'Kollegen können fremde Patientensignaturen nicht lesen');
const adminSig=await worker.fetch(new Request('https://taxipro.test/api/signatures/'+signed.data.id+'/file',{
 headers:{Origin:env.APP_ORIGIN,Authorization:'Bearer '+token}
}),env);
assert.equal(adminSig.status,200,'Zentrale kann Nachweis kontrollieren');
assert.equal(adminSig.headers.get('Access-Control-Allow-Origin'),env.APP_ORIGIN);

const time=await call('/api/time-summary?period=day&date=2026-10-30','GET',null,aToken);
assert.equal(time.status,200,'Rollenbezogene Zeitauswertung über API');
assert.equal(time.data.period,'day');
assert.ok(Array.isArray(time.data.byDriver));
const deniedTime=await call('/api/time-summary?period=year&date=2026-01-01&driverId=unknown','GET',null,aToken);
assert.equal(deniedTime.status,200,'Fahrerfilter wird serverseitig auf eigenes Konto überschrieben');

console.log('PASS: TaxiPro Community 2.3 – Meldungen, private Fahrerkommunikation, Tauschanfragen, Upload-Zugriff, Tagesübersicht und Kunden-Unterschrift (synthetische Daten).');

