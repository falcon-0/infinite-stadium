import test from 'node:test';
import assert from 'node:assert/strict';
import {matchState} from './match-stream.js';
import {buildQuestionFacts} from './question-facts.js';
import {directQuestionFacts} from './direct-question-facts.js';

function fixture(){
 const state=matchState({kind:'counter',seed:1041,time:118}),goal=state.events.find(row=>row.type==='shot'&&row.result===true);
 const source={scopeReference:{type:'scope',id:'goal',revision:1},query:{filters:{type:'shot',result:true},aggregate:'list',order:'asc',limit:1,timeFrom:0,timeTo:118},rows:[goal],count:1,scope:{missingFields:{}},entityResolution:{}};
 return {state,packet:{requestComponents:['How did that goal develop'],answerFocus:'event-sequence',requestedForm:'explanation',responseLanguage:'en',observedAt:118,teams:state.metadata.teams,roster:state.frames.at(-1).players,queryResults:[],requestedEvidence:[source],linkedContext:{rows:state.events}}};
}
test('direct actor, official assist and linked buildup use unique existing proofs',()=>{
 const {packet}=fixture(),manifest=buildQuestionFacts(packet);
 for(const [focus,form,kind] of [['event-actor','fact','ordered-event'],['credited-assist','fact','credited-goal-assist'],['event-sequence','explanation','linked-goal-sequence']]){
  const answer=directQuestionFacts(packet,manifest,{focus,form});assert.ok(answer);assert.equal(manifest.facts.find(f=>f.id===answer.composition.factIds[0]).proof.kind,kind);
 }
 const story=manifest.facts.find(f=>f.proof.kind==='linked-goal-sequence');assert.match(story.claim.text,/Cole recovered the ball and passed to R\. Mensah/);assert.match(story.claim.text,/Mensah then passed to A\. Reed, who scored at 01:56/);assert.doesNotMatch(story.claim.text,/foot|forced|pressure/);assert.equal(story.claim.evidence.length,5);
});

test('goal filter aliases preserve the ordered proof, and an inspected story survives irrelevant extra queries',()=>{
 const {packet}=fixture();packet.requestedEvidence[0].query.filters.outcome='goal';
 assert.ok(directQuestionFacts(packet,buildQuestionFacts(packet),{focus:'event-actor',form:'fact'}));
 packet.requestedMoment={reference:{type:'event',id:packet.requestedEvidence[0].rows[0].id,revision:packet.requestedEvidence[0].rows[0].revision}};
 packet.requestedEvidence.push({...structuredClone(packet.requestedEvidence[0]),scopeReference:{type:'scope',id:'extra',revision:1},rows:[]});
 assert.ok(directQuestionFacts(packet,buildQuestionFacts(packet),{focus:'event-sequence',form:'explanation'}));
});

test('a unique credited goal resolves a genuine scorer follow-up without inventing credit for another player or window',()=>{
 const {packet}=fixture();packet.requestedEvidence[0].query.filters={type:'pass',player:'home-7',result:true};packet.requestedEvidence[0].rows=[];
 packet.queryResults=[{scopeReference:{type:'scope',id:'all-goals',revision:1},query:{filters:{type:'shot',result:true},aggregate:'by-team',timeFrom:0,timeTo:118},groups:[{key:'home',count:1},{key:'away',count:0}],count:1,rows:[],truncated:false,scope:{missingFields:{}},entityResolution:{}}];
 packet.conversation=[{question:'Who scored first?',answer:'A. Reed scores at 01:56.',time:118}];
 assert.ok(directQuestionFacts(packet,buildQuestionFacts(packet),{focus:'credited-assist',form:'fact'}));
 for(const mutate of [p=>p.conversation[0].answer='J. Cole recovered the ball.',p=>p.requestedEvidence[0].query.timeTo=60,p=>p.namedPlayerActions=[{player:{id:'away-10'}}],p=>p.linkedContext.rows.push({...p.linkedContext.rows.find(r=>r.type==='shot'&&r.result===true),id:'another-goal',playerId:'away-10',team:'away',assist:undefined})]){
  const bad=structuredClone(packet);mutate(bad);assert.equal(directQuestionFacts(bad,buildQuestionFacts(bad),{focus:'credited-assist',form:'fact'}),null);
 }
});
test('ambiguous or incomplete lookup shapes stay on the reviewed writer path',()=>{
 for(const mutate of [p=>p.requestComponents.push('Who assisted'),p=>p.requestedEvidence.push(structuredClone(p.requestedEvidence[0])),p=>p.requestedEvidence[0].rows=[],p=>p.requestedEvidence[0].query.limit=10]){
  const {packet}=fixture();mutate(packet);assert.equal(directQuestionFacts(packet,buildQuestionFacts(packet),{focus:'event-actor',form:'fact'}),null);
 }
});

test('two facets of one attribute-filtered endpoint can use one proof, with all facets still reviewed',()=>{
 const {packet}=fixture();packet.requestComponents=['Who last shot with their right foot','what happened'];packet.requestedEvidence[0].query.filters.bodyPart='right-foot';
 assert.ok(directQuestionFacts(packet,buildQuestionFacts(packet),{focus:'event-actor',form:'fact'}));
 delete packet.requestedEvidence[0].query.filters.bodyPart;
 assert.equal(directQuestionFacts(packet,buildQuestionFacts(packet),{focus:'event-actor',form:'fact'}),null);
});

test('direct accuracy needs both exact partitions, one resolved subject and the metric permission',()=>{
 const {packet}=fixture();packet.requestComponents=['How accurate was Cole’s passing'];packet.mentionedPlayerResolution=[{status:'resolved',canonicalId:'home-7'}];
 packet.requestedEvidence=[true,false].map((result,index)=>({scopeReference:{type:'scope',id:'passes-'+index,revision:1},query:{filters:{type:'pass',player:'home-7',result},aggregate:'count',timeFrom:0,timeTo:118},count:result?5:1,rows:[],truncated:false,scope:{missingFields:{}},entityResolution:{player:{status:'resolved',canonicalId:'home-7'}}}));
 const options={focus:'player-performance',form:'fact',passAccuracyRequested:true};assert.ok(directQuestionFacts(packet,buildQuestionFacts(packet),options));
 assert.equal(directQuestionFacts(packet,buildQuestionFacts(packet),{...options,passAccuracyRequested:false}),null);
 for(const mutate of [p=>p.mentionedPlayerResolution[0].canonicalId='away-1',p=>p.requestedEvidence[1].query.timeFrom=30,p=>p.requestedEvidence[1].scope.missingFields.result=1,p=>p.requestedEvidence[1].query.filters.result=true]){const bad=structuredClone(packet);mutate(bad);assert.equal(directQuestionFacts(bad,buildQuestionFacts(bad),options),null);}
});
test('broken links, corrected goals and invalid actor relationships cannot produce a goal story',()=>{
 const changes=[rows=>rows.find(r=>r.time===112&&r.type==='pass').cause='missing',rows=>rows.find(r=>r.time===108&&r.type==='pass').receiverId='away-8',rows=>rows.find(r=>r.time===110&&r.type==='receive').playerId='home-7',rows=>{const goal=rows.find(r=>r.time===116&&r.type==='shot');goal.result=false;goal.outcome='saved';},rows=>rows.find(r=>r.time===104&&r.type==='recovery').recoveryKind='segment-start',rows=>rows.find(r=>r.time===108&&r.type==='pass').cause=rows.find(r=>r.time===112&&r.type==='pass').id];
 for(const change of changes){const {packet}=fixture();change(packet.linkedContext.rows);assert.equal(buildQuestionFacts(packet).facts.some(f=>f.proof.kind==='linked-goal-sequence'),false);}
});

test('one complete count skips redundant wording but incomplete and evaluative requests do not',()=>{
 const {packet}=fixture();packet.requestComponents=['How many passes has Northbridge attempted?'];
 packet.requestedEvidence=[{scopeReference:{type:'scope',id:'team-passes',revision:1},query:{filters:{type:'pass',team:'home'},aggregate:'count',timeFrom:0,timeTo:118},count:4,rows:[],truncated:false,scope:{missingFields:{}},entityResolution:{}}];
 const options={form:'fact',focus:'other'},manifest=buildQuestionFacts(packet);
 assert.ok(directQuestionFacts(packet,manifest,options));
 assert.ok(directQuestionFacts(packet,manifest,{...options,focus:'team-assessment'}));
 assert.ok(directQuestionFacts(packet,manifest,{...options,focus:'player-performance'}));
 for(const mutate of [p=>p.requestedEvidence[0].scope.missingFields.player=1,p=>p.requestedEvidence[0].truncated=true,p=>p.requestedEvidence[0].entityResolution.player={status:'absent'},p=>p.requestComponents.push('Were they effective?'),p=>p.requestedEvidence.push(structuredClone(p.requestedEvidence[0]))]){const bad=structuredClone(packet);mutate(bad);assert.equal(directQuestionFacts(bad,buildQuestionFacts(bad),options),null);}
 assert.equal(directQuestionFacts(packet,manifest,{...options,form:'assessment'}),null);
 assert.equal(directQuestionFacts(packet,manifest,{...options,focus:'player-assessment'}),null);
});
