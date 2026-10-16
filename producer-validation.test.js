import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProducerStories} from './producer-validation.js';
import {integratedMatch,matchState,integratedFeed} from './match-stream.js';
import {createInvestigationTools} from './investigation-tools.js';
import {storyFacts} from './story-facts.js';
import {renderFactStory} from './fact-renderer.js';
import {emptyProducerReview,addValidatedProducerStory,producerValidationRequests,updateProducerReview,decideProducerStory,exportProducerRundown,producerExportStatus,producerPreview,moveProducerStory,paceProducerStory,loadProducerReview,saveProducerReview} from './producer-review.js';

const preferences={kind:'extended',seed:17,audience:'newcomer',language:'en',favoriteClub:null,favoritePlayer:null};
const request=(anchorId,reviewId='new')=>({anchorId,reviewId,source:'recorded'});
function state(time,feed){const b=integratedMatch({...preferences,time},feed),full=matchState({...preferences,time},feed);return {time,matchId:b.state.metadata.id,events:new Map(full.events.map(e=>[e.id,e])),eventHistory:new Map(full.events.map(e=>[e.id,e])),positions:new Map(full.frames.map(f=>[f.id,f])),recap:new Map(b.recap.entries.map(e=>[e.id,e]))};}
function check(store,s,options){s.producerValidation=validateProducerStories({preferences,time:s.time,items:producerValidationRequests(store)},options);updateProducerReview(store,s,preferences);return s;}
function add(store,s,anchorId){const validation=validateProducerStories({preferences,time:s.time,items:[request(anchorId)]});assert.equal(validation.failures.length,0);const item=addValidatedProducerStory(store,validation.stories[0],validation,s,preferences);check(store,s);return item;}
const approve=(store,item,s)=>decideProducerStory(store,item.id,'approved','Checked the canonical story.',s,preferences);
function aiDraft(time=32){
 const anchorId='extended-17-0-shot',registry=createInvestigationTools({...preferences,time,anchorId});
 const outputs=Object.fromEntries(['get_event_sequence','score_at_moment'].map(name=>[name,registry.execute(name,{})]));
 const catalog=storyFacts(outputs,registry.scope),selectedFacts=['moment','goal-score-change','recovery-before-shot'].map(kind=>catalog.facts.find(f=>f.kind===kind));
 const selectedFactIds=selectedFacts.map(f=>f.id),rendered=renderFactStory(catalog,selectedFactIds,preferences);
 return {status:'draft',evidenceSource:'integrated-match',anchorId,key:registry.key,audience:preferences.audience,language:preferences.language,selectedFactIds,selectedFacts,claims:rendered.claims,authorship:{selection:'azure-model',wording:'application-fact-templates'}};
}

test('saved rank-evicted story remains approved after advancement and storage reload',()=>{
 const store=emptyProducerReview(),early=state(80),item=add(store,early,'extended-17-1-shot');approve(store,item,early);
 const later=state(362);assert.ok(![...later.recap.values()].some(e=>e.anchorId===item.anchorId));check(store,later);assert.equal(item.status,'approved');
 let raw;const storage={getItem:()=>raw,setItem:(_key,v)=>{raw=v;}};saveProducerReview(store,storage);
 const loaded=loadProducerReview(storage).store;assert.equal(loaded.items[0].status,'superseded');check(loaded,later);assert.equal(loaded.items[0].status,'approved');
 assert.equal(exportProducerRundown(loaded,later,preferences).document.segments[0].anchorId,item.anchorId);
});

test('recorded validation matches existing canonical entry without a clock-only key change',()=>{
 const s=state(80),id='extended-17-1-shot',first=validateProducerStories({preferences,time:80,items:[request(id)]}).stories[0];
 const original=[...s.recap.values()].find(e=>e.anchorId===id);for(const field of ['key','text','evidence','metrics'])assert.deepEqual(first.entry[field],original[field]);
 const later=validateProducerStories({preferences,time:362,items:[request(id)]}).stories[0];assert.equal(first.decisionKey,later.decisionKey);
});

test('newly received older window member changes decision identity even if wording and old references match',()=>{
 const id='extended-17-1-shot',input={preferences,time:80,items:[request(id)]},before=validateProducerStories(input).stories[0];
 const stateFactory=input=>{const s=matchState(input);s.events.push({id:'late-unknown-action',revision:1,time:50,arrivedAt:80,type:'flight',team:'away',player:'Synthetic player'});return s;};
 const after=validateProducerStories(input,{stateFactory}).stories[0];assert.notEqual(after.decisionKey,before.decisionKey);
});

test('one changed earlier goal invalidates dependent story while an unrelated earlier approval survives',()=>{
 const store=emptyProducerReview(),s=state(330),early=add(store,s,'extended-17-0-shot'),later=add(store,s,'extended-17-10-shot');approve(store,early,s);approve(store,later,s);
 const exported=exportProducerRundown(store,s,preferences),feed=structuredClone(integratedFeed('extended',17));
 const changed=feed.events.filter(e=>e.id==='extended-17-5-shot').sort((a,b)=>b.revision-a.revision)[0];changed.result=false;
 const now=state(330,feed);check(store,now,{stateFactory:input=>matchState(input,feed)});
 assert.equal(early.status,'approved');assert.equal(later.status,'superseded');assert.equal(producerPreview(store,now,preferences).segments.length,1);
 assert.equal(exported.document.segments.length,2);
});

test('canonical AI story enters pending queue and revalidates without inference',()=>{
 const draft=aiDraft(),s=state(32),store=emptyProducerReview(),result=validateProducerStories({preferences,time:32,items:[{reviewId:'ai-new',anchorId:draft.anchorId,source:'ai',draft}]});
 assert.deepEqual(result.failures,[]);const item=addValidatedProducerStory(store,result.stories[0],result,s,preferences);assert.equal(item.status,'pending');assert.equal(item.source,'ai');
 check(store,s);approve(store,item,s);assert.equal(item.status,'approved');assert.equal(exportProducerRundown(store,s,preferences).document.segments[0].text,draft.claims.map(c=>c.text).join(' '));
});

test('changed, withheld or incompletely cited model draft yields no queueable story',()=>{
 for(const mutate of [d=>{d.status='withheld';},d=>{d.claims[0].text='Invented goal.';},d=>{d.claims[1].evidence=[];},d=>{d.selectedFacts[0].values.player='Changed';},d=>{d.key='old-key';}]){
  const draft=aiDraft();mutate(draft);const result=validateProducerStories({preferences,time:32,items:[{reviewId:'ai-new',anchorId:draft.anchorId,source:'ai',draft}]});assert.equal(result.stories.length,0);assert.equal(result.failures.length,1);
 }
});

test('preview matches exported text order pacing and changes when selection or pacing changes',()=>{
 const store=emptyProducerReview(),s=state(80),a=add(store,s,'extended-17-0-shot'),b=add(store,s,'extended-17-1-shot');approve(store,a,s);approve(store,b,s);
 moveProducerStory(store,b.id,-1);paceProducerStory(store,b.id,12);const preview=producerPreview(store,s,preferences),output=exportProducerRundown(store,s,preferences);
 assert.deepEqual(preview.segments.map(({text,timing,reviewId})=>({text,timing,reviewId})),output.document.segments.map(({text,timing,reviewId})=>({text,timing,reviewId})));
 paceProducerStory(store,b.id,8);assert.notEqual(producerPreview(store,s,preferences).fingerprint,preview.fingerprint);
});

test('stored canonical approvals fail closed without fresh complete server validation',()=>{
 const store=emptyProducerReview(),s=state(80),item=add(store,s,'extended-17-1-shot');approve(store,item,s);
 exportProducerRundown(store,s,preferences);
 s.time=81;updateProducerReview(store,s,preferences);assert.equal(item.status,'checking');assert.throws(()=>exportProducerRundown(store,s,preferences),/Approve at least/);
 assert.equal(producerExportStatus(store.exports[0],store).status,'checking-evidence');assert.equal(item.invalidated,null);
 check(store,s);assert.equal(item.status,'approved');
});

test('unavailable saved AI fact selection offers only an explicitly recorded pending replacement',()=>{
 const draft=aiDraft(),s=state(32),store=emptyProducerReview(),initial=validateProducerStories({preferences,time:32,items:[{reviewId:'ai',anchorId:draft.anchorId,source:'ai',draft}]});
 const old=addValidatedProducerStory(store,initial.stories[0],initial,s,preferences);check(store,s);approve(store,old,s);
 const requests=producerValidationRequests(store);requests[0].selectedFactIds=['fact-no-longer-current'];
 const current=validateProducerStories({preferences,time:32,items:requests});assert.equal(current.stories.length,0);assert.equal(current.failures[0].replacement.source,'recorded');
 s.producerValidation=current;updateProducerReview(store,s,preferences);assert.equal(old.status,'superseded');assert.ok(old.invalidated);assert.equal(old.source,'ai');
 const recorded=validateProducerStories({preferences,time:32,items:[request(old.anchorId,'replacement')]});
 const replacement=addValidatedProducerStory(store,recorded.stories[0],recorded,s,preferences,{replaces:old.id});assert.equal(replacement.decision,'pending');assert.equal(replacement.source,'recorded');assert.equal(replacement.replaces,old.id);
});

test('validation rejects invalid preferences and request shapes before handling stories',()=>{
 for(const p of [{...preferences,language:'xx'},{...preferences,audience:'unknown'},{...preferences,unexpected:true}])assert.throws(()=>validateProducerStories({preferences:p,time:32,items:[]}));
 assert.throws(()=>validateProducerStories({preferences,time:32,items:[{...request('id'),approval:'approved'}]}));
});
