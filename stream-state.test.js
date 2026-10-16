import test from 'node:test';
import assert from 'node:assert/strict';
import {broadcastFrame} from './broadcast.js';
import {emptyStream,applyStream} from './stream-state.js';
import {integratedFeed} from './match-stream.js';
import {catchup} from './catchup.js';

test('fresh seek history gives the same corrected catch-up as continuous replay',()=>{
 const input={kind:'extended',seed:17},feed=integratedFeed('extended',17);
 const snapshot=broadcastFrame({...input,time:122},null,feed);
 const seek=applyStream(emptyStream(),snapshot.message);
 const result=catchup(seek.eventHistory.values(),122,92);
 assert.equal(result.counts.actions,4);assert.equal(result.counts.shots,1);assert.equal(result.counts.completedPasses,1);
 assert.equal(result.baselineComplete,true);assert.deepEqual(result.scoreAtSince,{home:1,away:0});
 assert.match(result.highlights.find(e=>e.anchorId==='extended-17-3-shot').text,/off target/);
 assert.deepEqual(result.countsEvidence.shots,[{type:'event',id:'extended-17-3-shot',revision:2}]);
 assert.ok(snapshot.message.events.history.every(e=>e.time<=122&&e.arrivedAt<=122));
 let continuous=emptyStream(),previous=null;
 for(let time=0;time<=122;time++){
  const frame=broadcastFrame({...input,time},previous,feed);
  continuous=applyStream(continuous,frame.message);previous=frame.bundle;
  if(time)assert.equal(frame.message.events.history,undefined);
 }
 assert.deepEqual(catchup(continuous.eventHistory.values(),122,92),result);
 const legacy=structuredClone(snapshot.message);delete legacy.events.history;
 assert.equal(catchup(applyStream(emptyStream(),legacy).eventHistory.values(),122,92).baselineComplete,false);
});

test('history cannot leak future revisions or conflict with the active snapshot',()=>{
 const initial=broadcastFrame({kind:'central',seed:17,time:10}).message;
 const saved=structuredClone(initial),empty=emptyStream();
 for(const history of [null,{},Array(10001).fill({})]){
  assert.throws(()=>applyStream(empty,{...initial,events:{...initial.events,history}}),/history/);
 }
 const future=structuredClone(initial);future.events.history[0].arrivedAt=11;
 assert.throws(()=>applyStream(empty,future),/not arrived/);
 const conflict=structuredClone(initial);conflict.events.history.push({...conflict.events.history[0],player:'Different player'});
 assert.throws(()=>applyStream(empty,conflict),/Conflicting contents/);
 const orphan=structuredClone(initial);orphan.events.history.push({...orphan.events.history[0],id:'orphan'});
 assert.throws(()=>applyStream(empty,orphan),/conflicts with current snapshot/);
 const mismatched=structuredClone(initial);mismatched.events.history.at(-1).revision=99;
 assert.throws(()=>applyStream(empty,mismatched),/conflicts with current snapshot/);
 assert.equal(empty.eventHistory.size,0);assert.deepEqual(initial,saved);
 const received=applyStream(empty,initial);
 const replayed=applyStream(received,{...initial,time:11});
 assert.equal(replayed.eventHistory.size,received.eventHistory.size);
 assert.equal(received.time,10);
 initial.events.history[0].player='Mutated transport';
 assert.notEqual([...received.eventHistory.values()][0].player,'Mutated transport');
});

test('a tracking revision cannot silently change coordinates, timing or roster under the same identity',()=>{
 const initial=broadcastFrame({kind:'central',seed:17,time:8}).message;
 const state=applyStream(emptyStream(),initial),frame=[...state.positions.values()].at(-1),saved=structuredClone(frame);
 for(const change of [f=>f.ball.x++,f=>f.players[0].x++,f=>f.players[0].id='unknown',f=>f.arrivedAt--]){
  const incoming=structuredClone(initial);incoming.positions.upserts=[structuredClone(frame)];change(incoming.positions.upserts[0]);
  assert.throws(()=>applyStream(state,incoming),/position revision|Invalid received/);
  assert.deepEqual(state.positions.get(frame.id),saved);
 }
 const reordered=structuredClone(initial);reordered.positions.upserts=[Object.fromEntries(Object.entries(frame).reverse())];
 assert.deepEqual(applyStream(state,reordered).positions.get(frame.id),frame);
});

test('tracking corrections advance revisions and replayed older coordinates cannot replace them',()=>{
 const first=broadcastFrame({kind:'central',seed:17,time:8});
 const old=applyStream(emptyStream(),first.message),repair=broadcastFrame({kind:'central',seed:17,time:10},first.bundle);
 const corrected=applyStream(old,repair.message),changed=[...corrected.positions.values()].find(f=>f.revision===2);
 assert.ok(changed);
 const replay=structuredClone(repair.message);replay.positions.upserts=[old.positions.get(changed.id)];
 assert.deepEqual(applyStream(corrected,replay).positions.get(changed.id),changed);
});
test('browser materializes received corrections, overlay expiry and recap changes across the extended stream',()=>{
 let browser=emptyStream(),previous=null;
 for(let time=0;time<=362;time++){
  const {bundle,message}=broadcastFrame({kind:'extended',seed:17,time,audience:'analyst'} ,previous);
  const old=browser;browser=applyStream(browser,message);previous=bundle;
  assert.deepEqual([...browser.events.values()].sort((a,b)=>a.id.localeCompare(b.id)),[...bundle.state.events].sort((a,b)=>a.id.localeCompare(b.id)));
  assert.deepEqual([...browser.positions.values()].sort((a,b)=>a.id.localeCompare(b.id)),[...bundle.state.frames].sort((a,b)=>a.id.localeCompare(b.id)));
  assert.deepEqual([...browser.recap.values()].sort((a,b)=>a.id.localeCompare(b.id)),[...bundle.recap.entries].sort((a,b)=>a.id.localeCompare(b.id)));
  assert.deepEqual([...browser.overlays.values()].sort((a,b)=>a.id.localeCompare(b.id)),[...bundle.recap.overlays].sort((a,b)=>a.id.localeCompare(b.id)));
  assert.equal(old.time,Math.max(0,time-1));
 }
 assert.deepEqual(browser.score,{home:2,away:1});
 // The last goal's 20-second overlay can remain active at the 362s
 // observation horizon; completion must not discard valid timed content.
 assert.ok([...browser.overlays.values()].every(e=>e.timing.expiresAt>362));
});
test('browser reset is required for rewinds and different fixtures; future evidence is rejected',()=>{
 const current=broadcastFrame({kind:'central',seed:17,time:10}).message;
 const state=applyStream(emptyStream(),current);
 assert.throws(()=>applyStream(state,broadcastFrame({kind:'central',seed:17,time:8}).message),/rewinding/);
 assert.throws(()=>applyStream(state,broadcastFrame({kind:'wide',seed:17,time:10}).message),/switching/);
 const future=structuredClone(current);future.events.upserts[0].arrivedAt=11;
 assert.throws(()=>applyStream(emptyStream(),future),/not arrived/);
 assert.equal(applyStream(emptyStream(),broadcastFrame({kind:'central',seed:17,time:8}).message).time,8);
});

test('received tombstones preserve exact revision history and withdrawn goals cannot enter catch-up',()=>{
 const input={kind:'extended',seed:17},feed=integratedFeed(input.kind,input.seed);
 const goal=feed.events.find(e=>e.id==='extended-17-0-shot'&&e.revision===2);
 const deletion={...goal,revision:3,arrivedAt:32,operation:'delete'};
 const messages={...feed,events:[...feed.events,deletion]};
 const before=broadcastFrame({...input,time:29},null,messages);
 const original=applyStream(emptyStream(),before.message);
 const correctedFrame=broadcastFrame({...input,time:30},before.bundle,messages);
 const corrected=applyStream(original,correctedFrame.message);
 const deletedFrame=broadcastFrame({...input,time:32},correctedFrame.bundle,messages);
 const deleted=applyStream(corrected,deletedFrame.message);
 assert.ok(deleted.eventHistory.has(`${goal.id}@1`));assert.ok(deleted.eventHistory.has(`${goal.id}@2`));
 assert.deepEqual(deleted.eventHistory.get(`${goal.id}@3`),deletion);
 assert.equal(deleted.events.has(goal.id),false);assert.equal(corrected.events.has(goal.id),true);
 assert.equal(original.eventHistory.has(`${goal.id}@2`),false);assert.equal(corrected.eventHistory.has(`${goal.id}@3`),false);
 const result=catchup(deleted.eventHistory.values(),32,25);
 assert.equal(result.counts.goals,0);assert.deepEqual(result.scoreNow,{home:0,away:0});
 assert.ok(!result.highlights.some(h=>h.anchorId===goal.id));
 const seek=applyStream(emptyStream(),broadcastFrame({...input,time:32},null,messages).message);
 assert.equal(catchup(seek.eventHistory.values(),32,25).counts.goals,0);
 assert.deepEqual([...seek.eventHistory.values()].filter(e=>e.id===goal.id),messages.events.filter(e=>e.id===goal.id));
 deletedFrame.message.events.withdrawalRecords[0].reason='Mutated transport packet';
 assert.equal(deleted.eventHistory.get(`${goal.id}@3`).reason,deletion.reason);
 const next=applyStream(deleted,broadcastFrame({...input,time:33},deletedFrame.bundle,messages).message);
 assert.deepEqual(next.eventHistory.get(`${goal.id}@3`),deletion);
});

test('stale updates cannot revive an actually withdrawn revision, and legacy withdrawals invent no evidence',()=>{
 const initial=broadcastFrame({kind:'central',seed:17,time:10}).message;
 const state=applyStream(emptyStream(),initial),goal=[...state.events.values()].find(e=>e.type==='shot');
 const deletion={...goal,revision:3,arrivedAt:11,operation:'delete'};
 const delta=structuredClone(initial);delta.time=11;delta.events={upserts:[],withdrawals:[goal.id],withdrawalRecords:[deletion]};
 const deleted=applyStream(state,delta);
 const stale=structuredClone(delta);stale.time=12;stale.events={upserts:[goal],withdrawals:[],withdrawalRecords:[]};
 assert.equal(applyStream(deleted,stale).events.has(goal.id),false);
 const conflicting=structuredClone(stale);conflicting.events.upserts=[{...deletion,operation:'upsert'}];
 assert.throws(()=>applyStream(deleted,conflicting),/Conflicting contents/);
 const legacy=structuredClone(delta);legacy.events={upserts:[],withdrawals:[goal.id]};
 const omitted=applyStream(state,legacy);
 assert.equal(omitted.events.has(goal.id),false);assert.ok(![...omitted.eventHistory.values()].some(e=>e.id===goal.id));
 assert.ok(![...omitted.eventHistory.values()].some(e=>e.operation==='delete'));
 assert.ok(state.eventHistory.has(`${goal.id}@2`));
 const future=structuredClone(delta);future.events.withdrawalRecords[0].arrivedAt=12;
 assert.throws(()=>applyStream(state,future),/not arrived/);
 const fabricated=structuredClone(delta);delete fabricated.events.withdrawalRecords[0].revision;
 assert.throws(()=>applyStream(state,fabricated),/Invalid received/);
});
