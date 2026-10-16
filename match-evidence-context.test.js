import test from 'node:test';
import assert from 'node:assert/strict';
import {matchState} from './match-stream.js';
import {linkedMatchEvidence} from './match-evidence-context.js';
const state=time=>matchState({kind:'sustained',seed:17,time});
test('historical shot context retrieves its actual pass and reception without relying on recent play',()=>{
 const context=linkedMatchEvidence(state(118),['comparison-sustained-17-shot-16']);
 assert.ok(context.rows.some(e=>e.id==='comparison-sustained-17-pass-10'&&e.result===true));
 assert.ok(context.rows.some(e=>e.type==='receive'&&e.passId==='comparison-sustained-17-pass-10'));
 assert.ok(context.rows.some(e=>e.id==='comparison-sustained-17-recovery-0'));
 assert.ok(!context.rows.some(e=>e.id==='comparison-sustained-17-pass-90'));
});
test('linked evidence retains the currently received correction and excludes future and withdrawn rows',()=>{
 const root='comparison-sustained-17-shot-96';
 const before=linkedMatchEvidence(state(96),[root]);assert.equal(before.rows.find(e=>e.id===root).revision,1);assert.ok(before.rows.every(e=>e.time<=96&&e.arrivedAt<=96));
 const after=linkedMatchEvidence(state(98),[root]);assert.equal(after.rows.find(e=>e.id===root).outcome,'saved');assert.equal(after.rows.find(e=>e.id===root).revision,2);
 const deleted=state(98);deleted.events.find(e=>e.id===root).operation='delete';assert.deepEqual(linkedMatchEvidence(deleted,[root]).rows,[]);
});
test('linked context is bounded and does not mutate source state',()=>{
 const source=state(118),before=structuredClone(source),roots=source.events.map(e=>e.id);
 const context=linkedMatchEvidence(source,roots,{maxEvents:2});assert.ok(context.rows.length<=2);assert.equal(context.truncated,true);assert.deepEqual(source,before);
 assert.throws(()=>linkedMatchEvidence(source,roots,{maxEvents:100}));
});

test('an explicitly requested deeper goal context reaches the recovery without removing event or depth bounds',()=>{
 const source=matchState({kind:'counter',seed:1041,time:118}),root='comparison-counter-1041-shot-116';
 const context=linkedMatchEvidence(source,[root],{maxDepth:6,maxEvents:16});assert.ok(context.rows.some(row=>row.id==='comparison-counter-1041-recovery-104'));assert.ok(context.rows.length<=16);assert.throws(()=>linkedMatchEvidence(source,[root],{maxDepth:7}));
});
