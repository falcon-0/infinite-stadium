import test from 'node:test';
import assert from 'node:assert/strict';
import {requiredStoryTools,storyRequirements,validateRequiredStoryFacts} from './story-requirements.js';
import {createInvestigationTools} from './investigation-tools.js';
import {storyFacts} from './story-facts.js';
import {renderFactStory} from './fact-renderer.js';
import {matchState,matchExplanation,integratedFeed} from './match-stream.js';

function received(input){
 const registry=createInvestigationTools(input),sequence=registry.execute('get_event_sequence',{});
 const tools=requiredStoryTools(sequence,input.anchorId),outputs=Object.fromEntries(tools.map(name=>[name,registry.execute(name,{})]));
 const catalog=storyFacts(outputs,registry.scope);return {registry,sequence,tools,outputs,catalog,requirements:storyRequirements(catalog,input.anchorId)};
}
const central={kind:'central',seed:17,time:8,anchorId:'central-17-shot'};

test('confirmed first goal requires event and score foundations and its recorded lead consequence',()=>{
 const f=received(central);assert.deepEqual(f.tools,['get_event_sequence','score_at_moment']);
 assert.deepEqual(f.requirements.requiredKinds,['moment','goal-score-change']);assert.equal(f.requirements.ambiguity,null);
 const goal=f.catalog.facts.find(fact=>fact.id===f.requirements.requiredFactIds[1]);
 assert.equal(goal.values.effect,'took-lead');assert.equal(goal.values.beforeHome,0);assert.equal(goal.values.afterHome,1);
 assert.equal(validateRequiredStoryFacts(f.requirements.requiredFactIds,f.requirements),true);
 assert.throws(()=>validateRequiredStoryFacts([f.requirements.requiredFactIds[0]],f.requirements),/supported goal score change/);
});

test('extended equalizer and later lead each require their own supported score change',()=>{
 for(const [time,phase,effect,before,after] of [[180,5,'equalized',[1,0],[1,1]],[330,10,'took-lead',[1,1],[2,1]]]){
  const f=received({kind:'extended',seed:17,time,anchorId:`extended-17-${phase}-shot`});
  const goal=f.catalog.facts.find(fact=>fact.id===f.requirements.requiredFactIds[1]);
  assert.equal(goal.values.effect,effect);assert.deepEqual([goal.values.beforeHome,goal.values.beforeAway],before);assert.deepEqual([goal.values.afterHome,goal.values.afterAway],after);
  assert.ok(goal.evidence.some(ref=>ref.id==='extended-17-0-shot'),'Whole score support includes the earlier goal');
 }
});

test('non-goals and pending passes require only the received moment',()=>{
 for(const input of [{kind:'central',seed:17,time:2,anchorId:'central-17-pass'},
  {kind:'extended',seed:17,time:60,anchorId:'extended-17-1-shot'}]){
  const f=received(input);assert.deepEqual(f.tools,['get_event_sequence']);assert.deepEqual(f.requirements.requiredKinds,['moment']);assert.equal(f.requirements.ambiguity,null);
 }
 const f=received(central),sequence=structuredClone(f.sequence);sequence.events.find(e=>e.id===central.anchorId).result=null;
 assert.deepEqual(requiredStoryTools(sequence,central.anchorId),['get_event_sequence']);
 const catalog=storyFacts({get_event_sequence:sequence},sequence.scope);assert.equal(storyRequirements(catalog,central.anchorId).ambiguity,null);
});

test('simultaneous received goals suppress consequence and disclose unavailable meaning rather than invent order',()=>{
 const feed=integratedFeed('central',17),original=feed.events.find(e=>e.id===central.anchorId);
 feed.events.push({...original,id:'simultaneous-away-goal',team:'away',player:'D. Silva',playerId:'A10',result:true});
 const state=matchState(central,feed),explanation=matchExplanation(state,central.anchorId),scope={anchorId:central.anchorId,eventTime:8,observedAt:8};
 const sequence={scope,events:explanation.sequence,references:explanation.evidence.filter(ref=>ref.type==='event')};
 const goals=state.events.filter(event=>event.type==='shot'&&event.result===true);
 const score={scope,goals,score:{home:1,away:1},references:goals.map(event=>({type:'event',id:event.id,revision:event.revision}))};
 assert.deepEqual(requiredStoryTools(sequence,central.anchorId),['get_event_sequence','score_at_moment']);
 const catalog=storyFacts({get_event_sequence:sequence,score_at_moment:score},scope),requirements=storyRequirements(catalog,central.anchorId);
 assert.equal(catalog.facts.some(f=>f.kind==='goal-score-change'),false);assert.equal(requirements.ambiguity,'goal-score-change-unavailable');
 assert.deepEqual(requirements.requiredKinds,['moment']);assert.equal(validateRequiredStoryFacts(requirements.requiredFactIds,requirements),true);
});

test('omitted score evidence discloses missing confirmed-goal meaning without creating a fake fact',()=>{
 const f=received(central),catalog=storyFacts({get_event_sequence:f.sequence},f.registry.scope);
 const requirements=storyRequirements(catalog,central.anchorId);
 assert.deepEqual(requirements.requiredKinds,['moment']);assert.equal(requirements.ambiguity,'goal-score-change-unavailable');
 assert.equal(requirements.requiredFactIds.length,1);assert.ok(!catalog.facts.some(fact=>fact.kind==='goal-score-change'));
});

test('malformed, stale, future, missing and mismatched anchors fail closed',()=>{
 const f=received(central);
 for(const mutate of [sequence=>sequence.scope.anchorId='other',sequence=>sequence.scope.observedAt=7,
  sequence=>sequence.events=sequence.events.filter(e=>e.id!==central.anchorId),
  sequence=>sequence.events.push({...sequence.events.find(e=>e.id===central.anchorId)}),
  sequence=>sequence.events.find(e=>e.id===central.anchorId).operation='delete',
  sequence=>sequence.events.find(e=>e.id===central.anchorId).arrivedAt=9,
  sequence=>sequence.events.find(e=>e.id===central.anchorId).revision++,
  sequence=>sequence.references=sequence.references.filter(ref=>ref.id!==central.anchorId)]){
  const sequence=structuredClone(f.sequence);mutate(sequence);assert.throws(()=>requiredStoryTools(sequence,central.anchorId),RangeError);
 }
 assert.throws(()=>requiredStoryTools(null,central.anchorId),RangeError);
});

test('unsupported score consequences and unrelated catalogs cannot become mandatory meaning',()=>{
 const f=received(central);
 for(const mutate of [catalog=>catalog.scope.anchorId='other',catalog=>catalog.facts=catalog.facts.filter(f=>f.kind!=='moment'),
  catalog=>catalog.facts.find(f=>f.kind==='goal-score-change').values.afterHome=2,
  catalog=>catalog.facts.find(f=>f.kind==='goal-score-change').values.effect='decisive-winner',
  catalog=>catalog.facts.find(f=>f.kind==='goal-score-change').evidence=[],
  catalog=>catalog.facts.push({...catalog.facts.find(f=>f.kind==='goal-score-change'),id:'another-change'})]){
  const catalog=structuredClone(f.catalog);mutate(catalog);assert.throws(()=>storyRequirements(catalog,central.anchorId),RangeError);
 }
});

test('requirements are detached, never auto-append missing choices and render chronology without causes in all languages',()=>{
 const f=received(central),before=structuredClone(f.catalog),selected=[f.requirements.requiredFactIds[0]],snapshot=[...selected];
 assert.throws(()=>validateRequiredStoryFacts(selected,f.requirements),RangeError);assert.deepEqual(selected,snapshot);
 for(const language of ['en','es','fr','pt']){
  const rendered=renderFactStory(f.catalog,f.requirements.requiredFactIds,{language,audience:'newcomer'});
  assert.equal(rendered.claims.length,2);assert.deepEqual(rendered.claims[1].evidence,f.catalog.facts.find(f=>f.kind==='goal-score-change').evidence);
  assert.equal(f.catalog.facts.find(f=>f.kind==='goal-score-change').values.effect,'took-lead');
 }
 f.requirements.requiredFactIds[0]='changed';assert.deepEqual(f.catalog,before);
 assert.throws(()=>validateRequiredStoryFacts(['duplicate','duplicate'],{requiredFactIds:['duplicate']}),RangeError);
});
