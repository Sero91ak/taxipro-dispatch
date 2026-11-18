import test from 'node:test';
import assert from 'node:assert/strict';
import {periodBounds,summarizeTime,berlinMidnight} from '../backend/time-summary.js';

test('Europa/Berlin: Zeitgrenzen berücksichtigen beide Uhrzeitumstellungen',()=>{
 const spring=periodBounds('day','2026-03-29');
 assert.equal(new Date(spring.from).toISOString(),'2026-03-28T23:00:00.000Z');
 assert.equal(new Date(spring.to).toISOString(),'2026-03-29T22:00:00.000Z');
 assert.equal((spring.to-spring.from)/3600000,23);
 const autumn=periodBounds('day','2026-10-25');
 assert.equal(new Date(autumn.from).toISOString(),'2026-10-24T22:00:00.000Z');
 assert.equal(new Date(autumn.to).toISOString(),'2026-10-25T23:00:00.000Z');
 assert.equal((autumn.to-autumn.from)/3600000,25);
});

test('Nachtschicht und Pause werden auf zwei Kalendertage aufgeteilt',()=>{
 const shifts=[{id:'s1',driver_id:'drv',driver_name:'Testfahrer',
  started_at:'2026-11-18T21:00:00.000Z',ended_at:'2026-11-19T02:00:00.000Z'}];
 const breaks=[{id:'b1',shift_id:'s1',started_at:'2026-11-18T22:30:00.000Z',ended_at:'2026-11-18T23:30:00.000Z'}];
 const now=Date.parse('2026-11-22T16:00:00Z');
 const d1=summarizeTime(shifts,breaks,periodBounds('day','2026-11-18'),now);
 const d2=summarizeTime(shifts,breaks,periodBounds('day','2026-11-19'),now);
 assert.equal(d1.grossMs,2*3600000);
 assert.equal(d1.breakMs,30*60000);
 assert.equal(d1.netMs,90*60000);
 assert.equal(d2.grossMs,3*3600000);
 assert.equal(d2.breakMs,30*60000);
 assert.equal(d2.netMs,150*60000);
 const month=summarizeTime(shifts,breaks,periodBounds('month','2026-11-04'),now);
 assert.equal(month.netMs,4*3600000);
 assert.equal(month.byDriver[0].shiftCount,1);
});

test('Laufende Schicht darf niemals über die serverseitige Gegenwart rechnen',()=>{
 const shifts=[{id:'active',driver_id:'drv',started_at:'2026-11-18T10:00:00Z',ended_at:null}];
 const now=Date.parse('2026-11-18T10:30:00Z');
 const b=periodBounds('day','2026-11-18');
 const sum=summarizeTime(shifts,[],b,now);
 assert.equal(sum.grossMs,30*60000);
 assert.equal(sum.activeShifts,1);
});

test('Ungültige Datumsfelder werden abgewiesen',()=>{
 assert.throws(()=>periodBounds('week','2026-11-18'),/Ungültiger Zeitraum/);
 assert.throws(()=>periodBounds('day','2026-02-30'),/Ungültiger Zeitraum/);
 assert.throws(()=>periodBounds('day','../../'),/Ungültiger Zeitraum/);
});
