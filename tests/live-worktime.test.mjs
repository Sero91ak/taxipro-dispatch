import test from 'node:test';
import assert from 'node:assert/strict';
import {activeShiftDurations} from '../v2/live-worktime.js';

const min=60000;
test('Driver dashboard subtracts real pauses from gross duty, no double counting',()=>{
 const shift={id:'shift-a',started_at:'2026-11-18T08:00:00Z',ended_at:null};
 const breaks=[
  {shift_id:'shift-a',started_at:'2026-11-18T09:00:00Z',ended_at:'2026-11-18T09:15:00Z'},
  {shift_id:'shift-a',started_at:'2026-11-18T09:10:00Z',ended_at:'2026-11-18T09:25:00Z'},
  {shift_id:'shift-b',started_at:'2026-11-18T08:00:00Z',ended_at:null},
  {shift_id:'shift-a',started_at:'2026-11-18T10:30:00Z',ended_at:null}
 ];
 const t=activeShiftDurations(shift,breaks,Date.parse('2026-11-18T11:00:00Z'));
 assert.equal(t.grossMs,180*min);
 assert.equal(t.breakMs,55*min,'Merged 25-minute break plus 30-minute running break');
 assert.equal(t.netMs,125*min);
 assert.equal(t.paused,true);
});
test('Time calculations are absolute; DST transition does not invent or lose an hour',()=>{
 const shift={id:'dst',started_at:'2026-03-29T00:30:00Z',ended_at:'2026-03-29T03:30:00Z'};
 const breaks=[{shift_id:'dst',started_at:'2026-03-29T01:30:00Z',ended_at:'2026-03-29T02:00:00Z'}];
 const t=activeShiftDurations(shift,breaks);
 assert.equal(t.grossMs,180*min);
 assert.equal(t.breakMs,30*min);
 assert.equal(t.netMs,150*min);
 assert.equal(t.paused,false);
});
test('Pauses outside the shift are clamped, never negative or duplicated',()=>{
 const shift={id:'closed',started_at:'2026-11-18T08:00:00Z',ended_at:'2026-11-18T09:00:00Z'};
 const breaks=[
  {shift_id:'closed',started_at:'2026-11-18T07:30:00Z',ended_at:'2026-11-18T08:10:00Z'},
  {shift_id:'closed',started_at:'2026-11-18T08:50:00Z',ended_at:'2026-11-18T10:00:00Z'}
 ];
 const t=activeShiftDurations(shift,breaks);
 assert.equal(t.grossMs,60*min);
 assert.equal(t.breakMs,20*min);
 assert.equal(t.netMs,40*min);
});
test('No current shift or malformed time yields a harmless zero display',()=>{
 assert.deepEqual(activeShiftDurations(null),{grossMs:0,breakMs:0,netMs:0,paused:false});
 assert.equal(activeShiftDurations({id:'x',started_at:'invalid'}).grossMs,0);
 assert.equal(activeShiftDurations({id:'x',started_at:'2026-11-18T10:00:00Z'},[],Date.parse('2026-11-18T09:00:00Z')).netMs,0);
});
