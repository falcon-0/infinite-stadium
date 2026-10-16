import test from 'node:test';
import assert from 'node:assert/strict';
import {integratedMatch,integratedFeed} from './match-stream.js';
import {producerStorageKey,emptyProducerReview,loadProducerReview,saveProducerReview,updateProducerReview,addProducerStory,decideProducerStory,moveProducerStory,paceProducerStory,producerExportStatus,exportProducerRundown} from './producer-review.js';
const preferences={kind:'extended',seed:17,audience:'newcomer',language:'en',favoriteClub:null,favoritePlayer:null};
function fixture(time=330){const b=integratedMatch({...preferences,time});return {time,matchId:b.state.metadata.id,events:new Map(b.state.events.map(e=>[e.id,e])),eventHistory:new Map(b.state.events.map(e=>[`${e.id}@${e.revision}`,e])),positions:new Map(b.state.frames.map(e=>[e.id,e])),positionHistory:new Map(integratedFeed(preferences.kind,preferences.seed).frames.filter(f=>f.time<=time&&f.arrivedAt<=time).map(f=>[`${f.id}@${f.revision}`,f])),recap:new Map(b.recap.entries.map(e=>[e.id,e]))};}
const story=(state,n=0)=>[...state.recap.values()][n];
const approve=(store,item,state)=>decideProducerStory(store,item.id,'approved','Reviewed recorded facts.',state,preferences);
function memory(initial=null){let raw=initial;return {getItem:key=>key===producerStorageKey?raw:null,setItem:(key,value)=>{assert.equal(key,producerStorageKey);raw=value;},read:()=>raw};}

test('three items support two human approvals, rejection, reorder, bounded pacing and current-only export',()=>{
 const state=fixture(),store=emptyProducerReview(),items=[0,1,2].map(n=>addProducerStory(store,story(state,n),state,preferences));
 approve(store,items[0],state);approve(store,items[1],state);assert.throws(()=>decideProducerStory(store,items[2].id,'rejected','',state,preferences),/rejection reason/);
 decideProducerStory(store,items[2].id,'rejected','Repeats the previous story.',state,preferences);moveProducerStory(store,items[1].id,-1);paceProducerStory(store,items[1].id,10);
 assert.throws(()=>paceProducerStory(store,items[0].id,31),/1–30/);
 const output=exportProducerRundown(store,state,preferences);assert.equal(output.document.publishing,false);assert.equal(output.document.synthetic,true);assert.equal(output.document.segments.length,2);assert.equal(output.document.segments[0].reviewId,items[1].id);assert.equal(output.document.timing.durationSeconds,16);assert.equal(output.document.segments[0].humanDecision.decision,'approved');assert.match(output.script,/\[0–10s\]/);assert.equal(store.items[2].audit[0].reason,'Repeats the previous story.');
});

test('a corrected earlier goal invalidates transitive score dependencies and keeps unrelated approvals',()=>{
 const state=fixture(),store=emptyProducerReview();const early=addProducerStory(store,story(state,0),state,preferences),later=addProducerStory(store,story(state,4),state,preferences);approve(store,early,state);approve(store,later,state);
 const output=exportProducerRundown(store,state,preferences),ledger=store.exports[0];assert.equal(producerExportStatus(ledger,store).status,'current');
 const goalId=story(state,2).anchorId;assert.ok(later.dependencies.some(d=>d.id===goalId));assert.ok(!early.dependencies.some(d=>d.id===goalId));
 state.events.set(goalId,{...state.events.get(goalId),revision:99,result:false});updateProducerReview(store,state,preferences);
 assert.equal(early.status,'approved');assert.equal(later.status,'superseded');assert.equal(later.decision,'approved');assert.equal(later.audit.length,1);assert.equal(later.text,output.document.segments[1].text);assert.deepEqual(producerExportStatus(ledger,store).affected,[later.id]);assert.equal(exportProducerRundown(store,state,preferences).document.segments.length,1);
});

test('same revision content mutation cannot retain approval, and restored old evidence needs renewed review',()=>{
 const state=fixture(),store=emptyProducerReview(),item=addProducerStory(store,story(state),state,preferences);approve(store,item,state);const original=state.events.get(item.anchorId);state.events.set(item.anchorId,{...original,player:'Changed scorer'});updateProducerReview(store,state,preferences);assert.equal(item.status,'superseded');assert.throws(()=>approve(store,item,state),/current story/);
 state.events.set(item.anchorId,original);updateProducerReview(store,state,preferences);assert.equal(item.status,'superseded');const replacement=addProducerStory(store,story(state),state,preferences,{replaces:item.id});assert.equal(replacement.status,'pending');assert.equal(item.audit.length,1);
});

test('actual withdrawal marks dependent story withdrawn and preserves original decision without invented replacement',()=>{
 const state=fixture(),store=emptyProducerReview(),item=addProducerStory(store,story(state),state,preferences);approve(store,item,state);state.events.delete(item.anchorId);state.eventHistory.set(`${item.anchorId}@99`,{id:item.anchorId,revision:99,time:28,arrivedAt:330,operation:'delete'});updateProducerReview(store,state,preferences);assert.equal(item.status,'withdrawn');assert.equal(item.decision,'approved');assert.throws(()=>exportProducerRundown(store,state,preferences),/Approve at least/);assert.throws(()=>addProducerStory(store,story(state),state,preferences),/evidence is unavailable/);
});

test('backward time, future dependencies, changed fixture and preferences never expose active approvals',()=>{
 for(const change of [s=>{s.time=329;},s=>{s.events.set(story(s).anchorId,{...s.events.get(story(s).anchorId),arrivedAt:999});},s=>{s.matchId='other-match';}]){
  const state=fixture(),store=emptyProducerReview(),item=addProducerStory(store,story(state),state,preferences);approve(store,item,state);change(state);assert.throws(()=>exportProducerRundown(store,state,preferences),/Approve at least/);assert.equal(item.status,'superseded');
 }
 const state=fixture(),store=emptyProducerReview(),item=addProducerStory(store,story(state),state,preferences);approve(store,item,state);updateProducerReview(store,state,{...preferences,language:'fr'});assert.equal(item.status,'superseded');
});

test('canonical scene/metric body change and unavailable candidate withhold approval independently of event IDs',()=>{
 const state=fixture(),store=emptyProducerReview(),entry=story(state),item=addProducerStory(store,entry,state,preferences);approve(store,item,state);state.recap.set(entry.id,{...entry,metrics:entry.metrics.map((m,index)=>index?m:{...m,value:m.value+1})});updateProducerReview(store,state,preferences);assert.equal(item.status,'superseded');
 const second=fixture(),store2=emptyProducerReview(),item2=addProducerStory(store2,story(second),second,preferences);approve(store2,item2,second);second.recap.clear();updateProducerReview(store2,second,preferences);assert.equal(item2.status,'superseded');assert.match(item2.reason,/candidate set/);
});

test('reload retains decisions and audit but requires current evidence before any active approval',()=>{
 const state=fixture(),store=emptyProducerReview(),item=addProducerStory(store,story(state),state,preferences);approve(store,item,state);const storage=memory();assert.equal(saveProducerReview(store,storage),true);const loaded=loadProducerReview(storage);assert.equal(loaded.store.items[0].decision,'approved');assert.equal(loaded.store.items[0].status,'superseded');assert.equal(loaded.store.items[0].audit.length,1);
 updateProducerReview(loaded.store,state,preferences);assert.equal(loaded.store.items[0].status,'approved');state.events.set(item.anchorId,{...state.events.get(item.anchorId),revision:99});assert.throws(()=>exportProducerRundown(loaded.store,state,preferences),/Approve at least/);
});

test('malformed, oversized and denied local storage safely start empty and cannot manufacture approvals',()=>{
 for(const raw of ['{broken',JSON.stringify({schema:'other'}),'x'.repeat(2000001)])assert.equal(loadProducerReview(memory(raw)).store.items.length,0);
 const state=fixture(),store=emptyProducerReview(),item=addProducerStory(store,story(state),state,preferences);approve(store,item,state);
 for(const mutate of [s=>{s.items[0].audit=[];},s=>{s.items[0].text='Tampered claim';},s=>{s.items[0].pacing=99;},s=>{s.items.push(s.items[0]);},s=>{s.nextId=1;}]){const bad=structuredClone(store);mutate(bad);assert.equal(loadProducerReview(memory(JSON.stringify(bad))).store.items.length,0);}
 const storage={getItem(){throw new Error('Denied');},setItem(){throw new Error('Denied');}};assert.equal(loadProducerReview(storage).store.items.length,0);assert.equal(saveProducerReview(store,storage),false);
});

test('bounded export ledger names stay unique beyond twenty exports and carry only approved segments',()=>{
 const state=fixture(),store=emptyProducerReview(),item=addProducerStory(store,story(state),state,preferences);approve(store,item,state);const names=[];for(let i=0;i<23;i++)names.push(exportProducerRundown(store,state,preferences).filename);assert.equal(new Set(names).size,23);assert.equal(store.exports.length,20);
});

test('an unchanged later received clock preserves approvals without unnecessary model work',()=>{
 const state=fixture(),store=emptyProducerReview(),item=addProducerStory(store,story(state),state,preferences);approve(store,item,state);state.time=331;updateProducerReview(store,state,preferences);assert.equal(item.status,'approved');assert.equal(exportProducerRundown(store,state,preferences).document.observedAt,331);
});

test('same-revision frame ball mutation invalidates approval even when recomputed narrative text is unchanged',()=>{
 const state=fixture(),store=emptyProducerReview(),entry=story(state),item=addProducerStory(store,entry,state,preferences);approve(store,item,state);
 const dependency=item.dependencies.find(d=>d.type==='frame');assert.ok(dependency);const key=`${dependency.id}@${dependency.revision}`,old=state.positionHistory.get(key),changed={...old,ball:{...old.ball,x:old.ball.x+0.25}};
 const feed=integratedFeed(preferences.kind,preferences.seed);feed.frames=feed.frames.map(f=>f.id===dependency.id&&f.revision===dependency.revision?changed:f);
 const recomputed=integratedMatch({...preferences,time:state.time},feed),newEntry=recomputed.recap.entries.find(e=>e.anchorId===item.anchorId);assert.equal(newEntry.text,item.text);
 state.recap=new Map(recomputed.recap.entries.map(e=>[e.id,e]));state.positionHistory.set(key,changed);
 updateProducerReview(store,state,preferences);assert.equal(item.status,'superseded');assert.match(item.reason,/frame .* changed/);assert.throws(()=>exportProducerRundown(store,state,preferences),/Approve at least/);
});

test('received frame history supports pruned scenes but missing required bodies fail capture and export',()=>{
 const state=fixture(),entry=story(state);assert.ok(entry.evidence.some(r=>r.type==='frame'&&!state.positions.has(r.id)));
 const store=emptyProducerReview(),item=addProducerStory(store,entry,state,preferences);approve(store,item,state);assert.ok(exportProducerRundown(store,state,preferences).document.segments[0].dependencies.some(d=>d.type==='frame'));
 const frame=item.dependencies.find(d=>d.type==='frame');state.positionHistory.delete(`${frame.id}@${frame.revision}`);state.positions.delete(frame.id);updateProducerReview(store,state,preferences);assert.equal(item.status,'superseded');assert.match(item.reason,/frame .* unavailable/);assert.throws(()=>addProducerStory(emptyProducerReview(),entry,state,preferences),/evidence is unavailable/);
 const fallback=fixture();fallback.positions=new Map([...fallback.positionHistory.values()].reduce((map,f)=>{if(!map.has(f.id)||map.get(f.id).revision<f.revision)map.set(f.id,f);return map;},new Map()));delete fallback.positionHistory;assert.doesNotThrow(()=>addProducerStory(emptyProducerReview(),story(fallback),fallback,preferences));
});

test('future higher frame revisions do not invalidate until actually received',()=>{
 const state=fixture(),store=emptyProducerReview(),item=addProducerStory(store,story(state),state,preferences);approve(store,item,state);const dep=item.dependencies.find(d=>d.type==='frame'),original=state.positionHistory.get(`${dep.id}@${dep.revision}`);
 const future={...original,revision:dep.revision+1,arrivedAt:state.time+2,ball:{...original.ball,x:original.ball.x+1}};state.positionHistory.set(`${future.id}@${future.revision}`,future);updateProducerReview(store,state,preferences);assert.equal(item.status,'approved');state.time+=2;updateProducerReview(store,state,preferences);assert.equal(item.status,'superseded');assert.match(item.reason,/frame .* changed/);
});

test('current-position conflict with same received history revision cannot retain an approval',()=>{
 const state=fixture(),store=emptyProducerReview(),item=addProducerStory(store,story(state,4),state,preferences);approve(store,item,state);const dep=item.dependencies.find(d=>d.type==='frame'&&state.positions.has(d.id));assert.ok(dep);const frame=state.positions.get(dep.id);state.positions.set(dep.id,{...frame,ball:{...frame.ball,y:frame.ball.y+1}});updateProducerReview(store,state,preferences);assert.equal(item.status,'superseded');
});

test('export ledger compares pacing, approved order and human decision, while pending candidates do not affect it',()=>{
 const state=fixture(),store=emptyProducerReview(),one=addProducerStory(store,story(state),state,preferences),two=addProducerStory(store,story(state,1),state,preferences);approve(store,one,state);approve(store,two,state);exportProducerRundown(store,state,preferences);const first=store.exports.at(-1);
 addProducerStory(store,story(state,2),state,preferences);assert.equal(producerExportStatus(first,store).status,'current');
 paceProducerStory(store,one.id,15);assert.equal(producerExportStatus(first,store).status,'needs-replacement');assert.deepEqual(producerExportStatus(first,store).affected,[one.id]);
 exportProducerRundown(store,state,preferences);const paced=store.exports.at(-1);moveProducerStory(store,two.id,-1);assert.equal(producerExportStatus(paced,store).status,'needs-replacement');assert.deepEqual(new Set(producerExportStatus(paced,store).affected),new Set([one.id,two.id]));
 exportProducerRundown(store,state,preferences);const ordered=store.exports.at(-1);approve(store,one,state);assert.equal(producerExportStatus(ordered,store).status,'needs-replacement');assert.deepEqual(producerExportStatus(ordered,store).affected,[one.id]);
 const storage=memory();saveProducerReview(store,storage);const reloaded=loadProducerReview(storage).store;updateProducerReview(reloaded,state,preferences);assert.equal(producerExportStatus(reloaded.exports.at(-1),reloaded).status,'needs-replacement');
});

test('old reviews retain their audit but cannot regain approval without exact frame evidence',()=>{
 const state=fixture(),store=emptyProducerReview(),item=addProducerStory(store,story(state),state,preferences);approve(store,item,state);exportProducerRundown(store,state,preferences);
 item.dependencies=item.dependencies.filter(d=>d.type==='event').map(({type,...d})=>d);delete item.evidenceContract;delete store.exports[0].rundownFingerprint;
 const storage=memory(JSON.stringify(store)),loaded=loadProducerReview(storage).store;assert.equal(loaded.items.length,1);assert.equal(loaded.items[0].audit[0].decision,'approved');updateProducerReview(loaded,state,preferences);assert.equal(loaded.items[0].status,'superseded');assert.match(loaded.items[0].reason,/exact frame evidence/);assert.equal(producerExportStatus(loaded.exports[0],loaded).status,'needs-replacement');assert.throws(()=>exportProducerRundown(loaded,state,preferences),/Approve at least/);
 saveProducerReview(loaded,storage);const again=loadProducerReview(storage).store;assert.equal(again.items.length,1);updateProducerReview(again,state,preferences);assert.equal(again.items[0].status,'superseded');assert.doesNotThrow(()=>addProducerStory(again,story(state),state,preferences,{replaces:item.id}));
});

test('storage rejects incomplete typed frame dependencies and malformed export snapshots',()=>{
 const state=fixture(),store=emptyProducerReview(),item=addProducerStory(store,story(state),state,preferences);approve(store,item,state);exportProducerRundown(store,state,preferences);
 const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
 const mutations=[s=>{s.items[0].dependencies=s.items[0].dependencies.filter(d=>d.type!=='frame');},s=>{s.items[0].dependencies[0].type='metric';},s=>{const snapshot=JSON.parse(s.exports[0].rundownFingerprint);snapshot[0].pacing=31;s.exports[0].rundownFingerprint=JSON.stringify(canonical(snapshot));},s=>{const snapshot=JSON.parse(s.exports[0].rundownFingerprint);snapshot[0].unexpected='discard me';s.exports[0].rundownFingerprint=JSON.stringify(canonical(snapshot));}];
 for(const mutate of mutations){const copy=structuredClone(store);mutate(copy);assert.equal(loadProducerReview(memory(JSON.stringify(copy))).store.items.length,0);}
});
