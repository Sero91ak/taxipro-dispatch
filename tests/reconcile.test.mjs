import test from 'node:test';
import assert from 'node:assert/strict';
import {matchCalendarCustomer,customerCode,classifyBilling,masterCustomers,
 normalizedGoogleEvent,berlinServiceDate,signatureSheetModel,displayPrefs,possibleExistingCustomers} from '../backend/reconcile.js';

const customers=[
 {id:'abc',name:'Müller Petra',externalKey:'K0011'},
 {id:'def',name:'Müller Martin',externalKey:'K0012'},
 {id:'ghi',name:'Müller Petra',externalKey:'K0108'}
];
test('Feste Kunden-ID hat Vorrang vor Namen; unbekannte Kennung erzwingt Prüfung',()=>{
 assert.deepEqual(matchCalendarCustomer({summary:'K0012 Abholung'} ,customers),
   {state:'matched',customerId:'def',reason:'Eindeutige Kunden-ID K0012'});
 assert.equal(matchCalendarCustomer({summary:'K0999 Fahrt'},customers).state,'review');
 assert.equal(customerCode('K0012 → Bonn'),'K0012');
 assert.equal(customerCode('MK0012'),null);
});
test('Namensabgleich bleibt Vorschlag, gleiche Namen niemals automatisch bestätigen',()=>{
 assert.equal(matchCalendarCustomer({summary:'Petra Müller Richtung Klinik'},customers).state,'review');
 assert.equal(matchCalendarCustomer({summary:'Müller Bonn'},customers).state,'review');
 const unique=matchCalendarCustomer({summary:'Martin Müller · Meckenheim'},customers);
 assert.equal(unique.state,'review');
 assert.equal(unique.customerId,'def');
});
test('Dubletten-Schutz erkennt gleiche Namen auch bei vertauschtem Vor-/Nachnamen',()=>{
 const found=possibleExistingCustomers('Petra Müller',[{id:'1',name:'Müller Petra'},{id:'2',name:'Müller Peter'}]);
 assert.equal(found.length,1);
 assert.equal(found[0].id,'1');
});
test('KTS und RE nur aus expliziter Kennzeichnung, keine Farb- oder Zielannahme',()=>{
 assert.equal(classifyBilling('08:00 Muster · KTS'),'KTS');
 assert.equal(classifyBilling('Muster RE 08:00'),'RE');
 assert.equal(classifyBilling('Muster Klinik'),'unknown');
 assert.equal(classifyBilling('KTS und RE'),'unknown');
});
test('Master-Sheet: IDs und Spalten werden stabil verarbeitet; Nummerndubletten blockieren',()=>{
 const rows=[['Kunden-ID','Nachname','Vorname','Telefon','Zuzahlung/Befreiung','Stammziel / Einrichtung'],
   ['K0011','Müller','Petra','0123','Befreit','Marienhospital'],
   ['K0012','Müller','Martin','','Nicht befreit','Waldkrankenhaus']];
 const out=masterCustomers(rows);
 assert.equal(out.length,2);
 assert.equal(out[0].externalKey,'K0011');
 assert.equal(out[0].primaryTarget,'Marienhospital');
 assert.equal(out[0].copaymentSourceText,'Befreit');
 assert.throws(()=>masterCustomers([...rows,rows[1]]),/doppelt/);
});
test('Termine werden nicht ohne Kalenderzeit oder ohne Identität übernommen',()=>{
 assert.equal(normalizedGoogleEvent({id:'x',summary:'Urlaub',start:{date:'2026-11-18'}},'taxi','primary'),null);
 const e=normalizedGoogleEvent({id:'ev1',summary:'K0012 KTS',start:{dateTime:'2026-11-18T08:00:00+01:00'},
  end:{dateTime:'2026-11-18T08:30:00+01:00'}},'taxi','primary');
 assert.equal(e.billingSuggestion,'KTS');
 assert.equal(berlinServiceDate(e.startAt),'2026-11-18');
});
test('Ein Unterschriftszettel erfasst mehrere Fahrten aber keine fremde/stornierte Fahrt',()=>{
 const rows=[
  {customer_id:'abc',service_date:'2026-11-18',pickup_time:'16:00',pickup:'Bonn',destination:'Meckenheim',direction:'rueck',ride_status:'confirmed'},
  {customer_id:'abc',service_date:'2026-11-18',pickup_time:'08:00',pickup:'Meckenheim',destination:'Bonn',direction:'hin',ride_status:'reported'}
 ];
 const print=signatureSheetModel({id:'abc',name:'Testkundin',externalKey:'K0011'},rows);
 assert.equal(print.entries.length,2);
 assert.equal(print.entries[0].direction,'hin');
 assert.equal(print.customerId,'K0011');
 assert.throws(()=>signatureSheetModel({id:'abc',name:'Testkundin'},[rows[0],{...rows[1],customer_id:'def'}]),/Fremde/);
});
test('Anzeigeeinstellungen nur aus erprobter Whitelist',()=>{
 assert.equal(displayPrefs({density:'compact',lastPage:'calendar'}).lastPage,'calendar');
 assert.throws(()=>displayPrefs({lastPage:'../../'}),/ungültig/);
 assert.equal(displayPrefs({extra:'secret'}).extra,undefined);
});
