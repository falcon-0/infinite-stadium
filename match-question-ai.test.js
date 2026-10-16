import test from 'node:test';
import assert from 'node:assert/strict';
import {answerMatchQuestionAI,reviewCoverageMatches,requestComponents,resolveNumericReview,reviewRequestAdequacy} from './match-question-ai.js';
import {executeMatchQuery} from './match-query.js';
import {matchState} from './match-stream.js';
import {footballKnowledgeCatalog,retrieveFootballKnowledge} from './football-knowledge.js';
import {projectReviewEvidence} from './question-evidence-check.js';
import {passQuerySelectionPermission,passQueryOutcomeAllowed} from './pass-query-permissions.js';
import {actionOutcome,checkActionEvidence} from './action-evidence.js';

test('a numeric explanation without its count scope repairs without repeating action quantities',async()=>{
 const question={kind:'sustained',seed:1042,time:98,question:'Why did he shoot instead of slipping it to a teammate?'};let shot;
 const mock=sequenceTransport([
  {requestedForm:'explanation',mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'shot'},aggregate:'list',order:'desc',limit:1}]}},
  packet=>{shot=packet.matchFacts.facts.find(f=>f.selection.kind==='ordered-event'&&f.selection.metric==='attempts');return {scope:'match',composition:{mode:'explanation',factIds:[shot.id],claim:{text:'Reed took three shots, showing his role as the shooter.',kind:'interpretation',evidence:[],dependsOn:[0]}},followUp:''};},
  (_packet,body)=>{
   const modes=resolvedWireSchema(body).properties.composition.anyOf;
   assert.ok(modes.filter(mode=>mode.properties.claim).every(mode=>(mode.properties.claim.anyOf||[mode.properties.claim]).every(claim=>/Do not repeat them/.test(claim.properties.text.description))));
   return {scope:'match',composition:{mode:'explanation',factIds:[shot.id],claim:{text:'His passing options and reasoning are not recorded, so I cannot tell why he shot instead of passing.',kind:'limitation',evidence:[],dependsOn:[]}},followUp:''};
  },{decision:'approve',reason:'Actual action and unavailable reason are distinguished.'}
 ]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher,canRepair:()=>true});
 assert.equal(result.execution.modelCalls,4);assert.equal(result.execution.repairs,1);assert.doesNotMatch(result.answer,/three shots/);assert.match(result.answer,/cannot tell why/);
});

test('unsupported shot motives repair to the actual action and a specific unknown reason',async()=>{
 const question={kind:'sustained',seed:1042,time:98,question:'Why did he shoot instead of slipping it to a teammate?'};
 let shot;
 const mock=sequenceTransport([
  {requestedForm:'explanation',mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'shot'},aggregate:'list',order:'desc',limit:1}]}},
  packet=>{
   shot=packet.matchFacts.facts.find(f=>f.selection.kind==='ordered-event'&&f.selection.metric==='attempts');assert.ok(shot);
   return {scope:'match',composition:{mode:'explanation',factIds:[shot.id],claim:{text:'He chose to shoot because he is the primary shooter.',kind:'interpretation',evidence:[],dependsOn:[0]}},followUp:''};
  },(_packet,body)=>{
   const schema=resolvedWireSchema(body);
   assert.ok(schema.properties.composition.anyOf.filter(mode=>mode.properties.claim).every(mode=>mode.properties.claim.properties.kind.enum.length===1&&mode.properties.claim.properties.kind.enum[0]==='limitation'));
   return {scope:'match',composition:{mode:'explanation',factIds:[shot.id],claim:{text:'A. Reed took a shot at 01:36 which was saved. I can tell you what happened, but not why he shot instead of passing: his passing options and reasoning are not recorded.',kind:'limitation',evidence:[],dependsOn:[]}},followUp:''};
  },{decision:'approve',reason:'The actual shot and specific unavailable reason answer the request without invented motives.'}
 ]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher,canRepair:()=>true});
 assert.equal(result.execution.modelCalls,4);assert.equal(result.execution.repairs,1);
 assert.ok(result.claims.some(claim=>claim.text===shot.claim.text));assert.match(result.answer,/not why he shot/);
 assert.doesNotMatch(result.answer,/chose|primary shooter/);assert.equal(result.proseNormalizations[0].removedTextVerified,false);
});
const input={kind:'sustained',seed:17,time:96,question:'How did he miss that?',anchorId:'comparison-sustained-17-shot-96'};
const config={url:'https://example.invalid/completions',deployment:'test',key:'test-only'};
const ref={type:'event',id:input.anchorId,revision:1};

test('player passing accuracy selects a verified confirmed-outcome profile without a repeated opinion',async()=>{
 const mock=sequenceTransport([
  {answerFocus:'player-performance',explanationTarget:'none',requestedForm:'fact',mentionedPlayers:['J. Cole'],decision:{kind:'queries',queries:[{filters:{type:'pass',player:'home-7',result:true},aggregate:'count'},{filters:{type:'pass',player:'home-7',result:false},aggregate:'count'}]}},

  packet=>({decision:'approve',requestCheck:{status:'answered',requestedInformation:packet.evidence.question,responseIntent:{purpose:'assessment',needsAssessment:true,needsExplicitCorrection:false,needsMeasurementLimitation:false,reason:'The measured completion rate directly answers accuracy.'},coverage:packet.requestComponents.map(requestSpan=>({requestSpan,claimIndices:[0],answerForm:'assessment',requestedAction:'pass',temporalRelation:'none',relationAnchorClaimIndex:null,relationSourceLinkIndex:null,relationEntityBinding:'none'})),reason:'Correct complete confirmed-outcome ratio.'}})
 ]);
 const result=await answerMatchQuestionAI({kind:'sustained',seed:1048,time:118,question:'How accurate has Cole’s passing been?'},{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,2);assert.equal(result.claims.length,1);assert.match(result.answer,/100%.*5 of 5.*confirmed/);
});

test('false-action repair selects one zero-action proof and cannot add unasked chronology',async()=>{
 let zero;
 const mock=sequenceTransport([
  {answerFocus:'event-sequence',explanationTarget:'decision-rationale',requestedForm:'explanation',mentionedPlayers:['J. Cole'],decision:{kind:'queries',queries:[{filters:{type:'shot',player:'home-7'},aggregate:'count'}]}},
  packet=>{zero=packet.matchFacts.facts.find(f=>f.selection.kind==='count'&&f.selection.metric==='attempts'&&f.selection.subjectId==='home-7');assert.ok(zero);return {premiseCheck:{questionAssumption:'Cole missed a penalty',recordedAction:'Cole has no shots',conclusion:'contradicted'},scope:'match',composition:{mode:'explanation',factIds:[zero.id],claim:{text:'Cole has 0 shots on target, so there is no penalty miss to explain.',kind:'interpretation',evidence:[],dependsOn:[0]}},followUp:''};},
  (_packet,body)=>{assert.deepEqual(resolvedWireSchema(body).properties.composition.anyOf.map(m=>m.properties.mode.enum[0]),['no-action-correction']);return {premiseCheck:{questionAssumption:'Cole missed a penalty',recordedAction:'Cole has no shots',conclusion:'contradicted'},scope:'match',composition:{mode:'no-action-correction',factIds:[zero.id]},followUp:''};},
  {decision:'approve',reason:'Complete zero-shot scope and direct correction.',checks:[{claimIndex:0,actors:[],inventedFacts:[],counts:[],supported:true,reason:'Canonical zero-shot scope.'},{claimIndex:1,actors:[{name:'J. Cole',action:'shot',individualAction:true}],inventedFacts:[],counts:[],supported:true,reason:'Simulate the real reviewer misclassifying an application-proved negation as a positive action.'}]}
 ]);
 const result=await answerMatchQuestionAI({kind:'sustained',seed:1048,time:118,question:'Why did Cole miss that penalty?'},{config,fetcher:mock.fetcher,canRepair:()=>true});assert.equal(result.execution.modelCalls,4);assert.match(result.answer,/J\. Cole did not take that shot/);assert.doesNotMatch(result.answer,/last|Reed|target/);assert.equal(result.claimProvenance.at(-1).modelGenerated,false);
});

test('a provisional player pick is concise and must use that player’s own contribution',async()=>{
 for(const wrong of [false,true]){
  const question={kind:'counter',seed:1041,time:118,question:'Who has been the best player so far?'};
  const mock=sequenceTransport([
   {answerFocus:'player-assessment',explanationTarget:'none',requestedForm:'assessment',mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'shot'},aggregate:'by-player'}]}},
   (packet,body)=>{assert.deepEqual(resolvedWireSchema(body).properties.composition.anyOf.map(mode=>mode.properties.mode.enum[0]),['player-pick']);const goal=packet.matchFacts.facts.find(f=>f.selection.kind==='event'&&f.selection.eventType==='shot'&&f.claim.text.includes('scores'));return {scope:'match',composition:{mode:'player-pick',playerId:wrong?'away-10':'home-10',factIds:[goal.id]},followUp:''};},
   {decision:'approve',reason:'A provisional pick with received contribution evidence.'}
  ]);
  if(wrong)await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}),error=>error.code==='question-invalid-fact-selection');
  else {const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.claims.length,2);assert.equal(result.execution.modelCalls,3);assert.match(result.answer,/My pick so far is A\. Reed/);assert.equal(result.aiSelectedJudgment.playerId,'home-10');assert.equal(result.claimProvenance.at(-1).modelGenerated,false);}
 }
});

test('an attacking assessment uses shooting evidence rather than a reception proxy',async()=>{
 for(const wrong of [false,true]){
  const mock=sequenceTransport([
   {answerFocus:'team-attacking-assessment',explanationTarget:'none',requestedForm:'assessment',mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'receive'},aggregate:'by-team',timeFrom:85,timeTo:115}]}},
   (packet,body)=>{assert.equal(resolvedWireSchema(body).properties.composition.anyOf.length,1);const fact=packet.matchFacts.facts.find(f=>f.selection.kind==='team-comparison'&&f.selection.metric===(wrong?'receptions':'shotsOnTarget')&&f.selection.timeFrom===85);assert.ok(fact);return {scope:'match',composition:{mode:'facts',factIds:[fact.id]},followUp:''};},
   {decision:'approve',reason:'The recent measured attacking activity is level.'}
  ]);
  const input={kind:'duel',seed:1011,time:115,question:'Who is pushing more in the last 30 seconds?'};
  if(wrong)await assert.rejects(answerMatchQuestionAI(input,{config,fetcher:mock.fetcher}),error=>error.code==='question-invalid-fact-selection');
  else {const result=await answerMatchQuestionAI(input,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.equal(result.claims.length,1);assert.match(result.answer,/level/);}
 }
});

test('single actor, credited assist and linked sequence lookups keep independent review in two calls',async()=>{
 for(const [focus,form,target,question] of [['event-actor','fact','none','Who scored first?'],['credited-assist','fact','none','Who supplied the assist?'],['event-sequence','explanation','observed-sequence','How did that goal develop?']]){
  const mock=sequenceTransport([{answerFocus:focus,explanationTarget:target,requestedForm:form,mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'shot',result:true},aggregate:'list',order:'asc',limit:1}]}},{decision:'approve',reason:'The unique received goal and requested role are supported.'}]);
  const result=await answerMatchQuestionAI({kind:'counter',seed:1041,time:118,question},{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,2);assert.equal(result.execution.repairs,0);assert.equal(result.claims.length,1);assert.match(result.answer,focus==='credited-assist'?/Mensah.*assist/:focus==='event-sequence'?/Cole recovered.*Mensah.*Reed/:/Reed.*01:56/);if(focus==='event-sequence'){assert.equal(result.moments.length,1);assert.equal(result.evidence.length,5);}
 }
});

test('a best-player request cannot be satisfied by an approved team comparison alone',()=>{
 const review={requestCheck:{responseIntent:{purpose:'assessment',needsAssessment:true,needsExplicitCorrection:false,needsMeasurementLimitation:false},coverage:[{claimIndices:[0],answerForm:'assessment',requestedAction:'other'}]}};
 const answer={claims:[{kind:'observation',text:'Northbridge leads on shots on target.',evidence:[]}]},selection={proofs:[{kind:'team-comparison',assessmentBounds:'this-measure-only'}]};
 assert.ok(reviewRequestAdequacy(review,answer,{answerFocus:'player-assessment',roster:[],queryResults:[]},{canonicalFactSelection:selection}).some(issue=>/assessment/.test(issue.reason)));
 assert.deepEqual(reviewRequestAdequacy(review,answer,{answerFocus:'team-assessment',roster:[],queryResults:[]},{canonicalFactSelection:selection}),[]);
});

test('schema-grounded unknown intent is selected in three calls with the actual shot and no invented prose',async()=>{
 const question={kind:'sustained',seed:1042,time:98,question:'Why did he shoot instead of slipping it to a teammate?'};
 const mock=sequenceTransport([
  {explanationTarget:'decision-rationale',requestedForm:'explanation',mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'shot'},aggregate:'list',order:'desc',limit:1}]}},
  (packet,body)=>{assert.deepEqual(resolvedWireSchema(body).properties.composition.anyOf.map(mode=>mode.properties.mode.enum[0]),['known-limitation']);assert.equal(resolvedWireSchema(body).$defs,undefined);const shot=packet.matchFacts.facts.find(f=>f.selection.kind==='ordered-event'&&f.selection.metric==='attempts'),limitation=packet.matchFacts.facts.find(f=>f.selection.kind==='capability-limitation');assert.ok(shot&&limitation);return {scope:'match',composition:{mode:'known-limitation',contextFactIds:[shot.id],limitationFactId:limitation.id},followUp:''};},
  {decision:'approve',reason:'The saved shot and specific unavailable reasoning answer the question.'}
 ]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.equal(result.execution.repairs,0);assert.match(result.answer,/saved/);assert.match(result.answer,/can't tell what the player intended/);assert.equal(result.claims.at(-1).kind,'limitation');assert.equal(result.provenance.modelGenerated,false);
});

test('known limitations cannot use a statistic as action context or an event as the limitation proof',async()=>{
 const question={kind:'sustained',seed:1042,time:98,question:'Why did he shoot?'};
 for(const invalidContext of [true,false]){
  const mock=sequenceTransport([
   {requestedForm:'explanation',mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'shot'},aggregate:'list',order:'desc',limit:1}]}},
   packet=>{const limitation=packet.matchFacts.facts.find(f=>f.selection.kind==='capability-limitation'),count=packet.matchFacts.facts.find(f=>f.selection.kind==='count'),event=packet.matchFacts.facts.find(f=>f.selection.kind==='ordered-event');assert.ok(limitation&&count&&event);return {scope:'match',composition:{mode:'known-limitation',contextFactIds:[invalidContext?count.id:event.id],limitationFactId:invalidContext?limitation.id:event.id},followUp:''};}
  ]);
  await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}),error=>error.code==='question-invalid-fact-selection');assert.equal(mock.count(),2);
 }
});

test('a reviewed false premise can leave the fast rationale format for one grounded correction',async()=>{
 const question={kind:'sustained',seed:1042,time:98,question:'Why did Cole shoot instead of passing?'};let shot;
 const mock=sequenceTransport([
  {explanationTarget:'decision-rationale',requestedForm:'explanation',mentionedPlayers:['J. Cole'],decision:{kind:'queries',queries:[{filters:{type:'shot'},aggregate:'list',order:'desc',limit:1}]}},
  packet=>{shot=packet.matchFacts.facts.find(f=>f.selection.kind==='ordered-event'&&f.selection.metric==='attempts');const limitation=packet.matchFacts.facts.find(f=>f.selection.kind==='capability-limitation');return {scope:'match',composition:{mode:'known-limitation',contextFactIds:[shot.id],limitationFactId:limitation.id},followUp:''};},
  {decision:'withhold',reason:'The question assumes Cole shot; the actual actor needs an explicit correction.'},
  (_packet,body)=>{assert.ok(resolvedWireSchema(body).properties.composition.anyOf.some(mode=>mode.properties.mode.enum.includes('explanation')));return {scope:'match',premiseCheck:{questionAssumption:'Cole took this shot.',recordedAction:'Reed took this shot.',conclusion:'contradicted'},composition:{mode:'explanation',factIds:[shot.id],claim:{text:'It was Reed who shot, not Cole; his reason for shooting rather than passing is unknown.',kind:'interpretation',evidence:[],dependsOn:[0]}},followUp:''};},
  {decision:'approve',reason:'The actual actor is corrected with a supported specific uncertainty.'}
 ]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher,canRepair:()=>true});assert.equal(result.execution.modelCalls,5);assert.equal(result.execution.repairs,1);assert.match(result.answer,/not Cole/);
});
const wireQueries=packet=>[...(packet.requestedEvidence||[]),...(packet.queryResults||[])];

test('review coverage must quote actual request and final answer, not a removed limitation',()=>{
 const question='Explain the buildup and what we cannot tell.';
 const answer={claims:[{text:'Cole passed to Reed, who shot.'}]};
 const review=coverage=>({requestCheck:{coverage}});
 assert.equal(reviewCoverageMatches(review([{requestSpan:'Explain the buildup',answerSpan:'Cole passed to Reed'},{requestSpan:'what we cannot tell',answerSpan:'His intentions are unknown.'}]),answer,question),false);
 assert.equal(reviewCoverageMatches(review([{requestSpan:'Explain the buildup',answerSpan:'Cole passed to Reed'}]),answer,question),false,'An explicit second request component cannot be silently omitted');
 assert.equal(reviewCoverageMatches(review([{requestSpan:'invented question',answerSpan:'Cole passed to Reed'}]),answer,question),false);
 assert.equal(reviewCoverageMatches(review([]),answer,question),false);
 assert.deepEqual(requestComponents('J. Cole is playing well. How many shots has he had?'),['How many shots has he had']);
 assert.deepEqual(requestComponents('For an analyst, reconstruct the move. Distinguish facts from unknowns.'),['reconstruct the move','Distinguish facts from unknowns']);
});

test('coverage requires each exact server component once, without whole-question or partial-span substitutes',()=>{
 const question='Which team leads, and how large is the gap?';
 const components=requestComponents(question);assert.equal(components.length,2);
 const answer={claims:[{text:'Northbridge leads by one completed pass.'}]};
 const coverage=components.map(requestSpan=>({requestSpan,answerSpan:answer.claims[0].text}));
 const review=coverage=>({requestCheck:{coverage}});
 assert.equal(reviewCoverageMatches(review(coverage),answer,question),true);
 assert.equal(reviewCoverageMatches(review([{requestSpan:question,answerSpan:answer.claims[0].text}]),answer,question),false);
 assert.equal(reviewCoverageMatches(review([coverage[0],coverage[0]]),answer,question),false);
 assert.equal(reviewCoverageMatches(review([{...coverage[0],requestSpan:'Which team'},coverage[1]]),answer,question),false);
 assert.equal(reviewCoverageMatches(review([...coverage,coverage[0]]),answer,question),false);
 assert.equal(reviewCoverageMatches(review([coverage[0],{...coverage[1],answerSpan:'An answer not actually published.'}]),answer,question),false);
});

test('embedded questions after contextual punctuation retain every requested attribute',()=>{
 for(const punctuation of ['—','–',':',' - '])assert.deepEqual(requestComponents(`About that delivery ${punctuation} which foot contacted it, and is its velocity measured?`),['which foot contacted it','is its velocity measured']);
 assert.deepEqual(requestComponents('The player is over there. Which foot contacted it, and is its velocity measured?'),['Which foot contacted it','is its velocity measured']);
});

test('whole-request assessment intent cannot be erased by per-component fact classifications',()=>{
 const answer={scope:'match',claims:[{kind:'observation',text:'Two recorded actions.',evidence:[]}]},packet={queryResults:[],roster:[]};
 const review={requestCheck:{responseIntent:{purpose:'assessment',needsAssessment:true,needsExplicitCorrection:false,needsMeasurementLimitation:false},coverage:[{answerForm:'fact',requestedAction:'other',claimIndices:[0]}]}};
 assert.match(reviewRequestAdequacy(review,answer,packet)[0].reason,/qualified assessment/);
 const withJudgment={...answer,claims:[...answer.claims,{kind:'interpretation',text:'A qualified contribution, with broader impact unknown.',evidence:[]}]};assert.ok(reviewRequestAdequacy(review,withJudgment,packet).length,'An uncovered paragraph cannot supply the declared intent');const covered=structuredClone(review);covered.requestCheck.coverage[0].claimIndices=[0,1];assert.deepEqual(reviewRequestAdequacy(covered,withJudgment,packet),[]);
 for(const [flag,expected] of [['needsExplicitCorrection','premise correction'],['needsMeasurementLimitation','measurement limitation']]){
  const check=structuredClone(review);check.requestCheck.responseIntent={purpose:'mixed',needsAssessment:false,needsExplicitCorrection:false,needsMeasurementLimitation:false,[flag]:true};assert.match(reviewRequestAdequacy(check,answer,packet)[0].reason,new RegExp(expected));
 }
});

test('one covered interpretation can supply a qualified assessment and reviewed measurement limitation without a second paragraph',()=>{
 const answer={scope:'match',claims:[{kind:'observation',text:'The shot was saved.',evidence:[]},{kind:'interpretation',text:'The move produced a threat, although its chance quality is not measured.',evidence:[]}]};
 const review={requestCheck:{responseIntent:{purpose:'mixed',needsAssessment:true,needsExplicitCorrection:false,needsMeasurementLimitation:true},coverage:[{answerForm:'assessment',requestedAction:'other',claimIndices:[0,1]},{answerForm:'unavailable-measurement',requestedAction:'other',claimIndices:[1]}]}};
 assert.deepEqual(reviewRequestAdequacy(review,answer,{queryResults:[],roster:[]}),[]);
 const missing=structuredClone(review);missing.requestCheck.coverage.forEach(part=>part.claimIndices=[0]);assert.ok(reviewRequestAdequacy(missing,answer,{queryResults:[],roster:[]}).length,'The qualification must be a covered model-authored paragraph, not adjacent facts');
});

test('indexed coverage references existing final claims once per component and rejects malformed attribution',()=>{
 const question='Which team leads, and how large is the gap?',components=requestComponents(question);
 const answer={claims:[{text:'Northbridge leads.'},{text:'The margin is one completed pass.'}]};
 const coverage=components.map((requestSpan,index)=>({requestSpan,claimIndices:[index]}));
 const review=value=>({requestCheck:{coverage:value}});
 assert.equal(reviewCoverageMatches(review(coverage),answer,question),true);
 assert.equal(reviewCoverageMatches(review(components.map(requestSpan=>({requestSpan,claimIndices:[0,1]}))),answer,question),true);
 for(const claimIndices of [[],[0,0],[-1],[2],[0.5],['0'],null])assert.equal(reviewCoverageMatches(review([{...coverage[0],claimIndices},coverage[1]]),answer,question),false,JSON.stringify(claimIndices));
 for(const value of [[coverage[0]],[coverage[0],coverage[0]],[{...coverage[0],requestSpan:'Which team'},coverage[1]],[{...coverage[0],answerSpan:'Northbridge leads.'},coverage[1]]])assert.equal(reviewCoverageMatches(review(value),answer,question),false);
 assert.equal(reviewCoverageMatches(review(coverage),{claims:[{text:''},answer.claims[1]]},question),false);
});

test('internal evidence IDs cannot leak into a released fan answer',async()=>{
 const bad={scope:'match',claims:[{text:`Reed missed according to ${input.anchorId}.`,kind:'observation',evidence:[ref]}],followUp:''};
 const mock=directTransport({draft:bad,queries:[]},{decision:'approve'});
 await assert.rejects(answerMatchQuestionAI(input,{config,fetcher:mock.fetcher}),error=>error.code==='question-withheld'&&/internal evidence/.test(error.message));
 assert.equal(mock.count(),1);
});

test('a general numerical football definition needs no match count proof',async()=>{
 const definition={scope:'general',claims:[{text:'A brace means a player scores two goals in a game.',kind:'general',evidence:[]}],followUp:''};
 const mock=directTransport({draft:definition,queries:[]},{decision:'approve'});
 const result=await answerMatchQuestionAI({...input,question:'What is a brace?'},{config,fetcher:mock.fetcher});
 assert.equal(result.scope,'general');assert.match(result.answer,/two goals/);assert.deepEqual(result.evidence,[]);
});

function operationEnvelope(question,{operator='difference',metric='completedPasses',subjects=['home','away'],timeFrom=0,timeTo=question.time}={}){
 return {mentionedPlayers:[],operationPlan:{version:1,obligations:[{id:'requested-operation',requestSpan:question.question,operator,metric,subjects,timeFrom,timeTo}]},draft:null,queries:[]};
}
const resolvedWireSchema=body=>{
 const root=body.response_format.json_schema.schema;
 const resolve=value=>Array.isArray(value)?value.map(resolve):value&&typeof value==='object'?value.$ref?resolve(root.$defs[value.$ref.replace('#/$defs/','')]):Object.fromEntries(Object.entries(value).map(([key,item])=>[key,resolve(item)])):value;
 return resolve(root);
};
const decisionBranch=(body,kind)=>resolvedWireSchema(body).properties.decision.anyOf.find(branch=>branch.properties.kind.enum.includes(kind));
const operationProperties=(body,operator)=>decisionBranch(body,'operation')?.properties.plan.properties.obligations.items.anyOf.find(branch=>branch.properties.operator.enum.includes(operator))?.properties;
function sequenceTransport(values,inspect=()=>{}){
 let calls=0;
 return {count:()=>calls,fetcher:async(_url,options)=>{
  const body=JSON.parse(options.body),packet=JSON.parse(body.messages.at(-1).content);inspect(packet,calls,body);
  assert.ok(calls<values.length,'No unexpected extra model call');
  const source=values[calls++],value=typeof source==='function'?source(packet,body):source;
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reviewFixture(value,body))}}],usage:{prompt_tokens:100,completion_tokens:20}})};
 }};
}

test('the actual first wire chooses one plan and never asks for authored prose',async()=>{
 const question={kind:'interrupted',seed:8341,time:100,question:'Compare the first and latest shots.'};
 const plan=operationEnvelope(question,{operator:'orderedEndpoints',metric:'attempts',subjects:[]}).operationPlan;
 const mock=directTransport({mentionedPlayers:[],decision:{kind:'operation',plan}},{decision:'approve'},(packet,call,body)=>{
  if(call)return;
  const schema=body.response_format.json_schema.schema;
  assert.deepEqual(schema.required,['answerFocus','explanationTarget','requestedForm','mentionedPlayers','decision']);assert.equal(schema.properties.draft,undefined);assert.equal(schema.properties.queries,undefined);
  const [operation,queries]=schema.properties.decision.anyOf;
  assert.deepEqual(operation.required,['kind','plan']);assert.equal(operation.properties.queries,undefined);assert.equal(operation.additionalProperties,false);
  assert.deepEqual(queries.required,['kind','queries']);assert.equal(queries.properties.plan,undefined);assert.equal(queries.additionalProperties,false);
  assert.equal(queries.properties.queries.maxItems,3);
  assert.match(body.messages[0].content,/Plan evidence only/);
  assert.doesNotMatch(body.messages[0].content,/Fill this INTERNAL field|Choose the shortest useful answer shape|Return ONLY JSON|Answer the actual free-form question/);
  assert.equal(operationProperties(body,'orderedEndpoints').metric.enum.includes('shotsOnTarget'),false);
  assert.equal(packet.allowedOperationMetrics.includes('attempts'),true);
 });
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.proofs[0].values.latest.actor.label,'D. Silva');assert.equal(mock.count(),2);
});

test('conflicting old or new operation/query routes are rejected rather than prioritized',async()=>{
 const question={kind:'interrupted',seed:8341,time:100,question:'Compare the first and latest shots.'};
 const legacy=operationEnvelope(question,{operator:'orderedEndpoints',metric:'attempts',subjects:[]});
 const queries=[{filters:{type:'shot'},aggregate:'list'}];
 for(const first of [{...legacy,queries},{mentionedPlayers:[],decision:{kind:'operation',plan:legacy.operationPlan,queries}},{mentionedPlayers:[],decision:{kind:'queries',queries},operationPlan:legacy.operationPlan},{mentionedPlayers:[],decision:{kind:'operation',plan:{version:1,obligations:[]}}}]){
  const mock=directTransport(first);await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}),error=>error.code==='question-invalid-operation');assert.equal(mock.count(),1);
 }
});

test('restrictive operation metrics require a supported request qualifier before execution',async()=>{
 for(const questionText of ['Compare the first and latest shots.','Compare all shots, not just shots on target.','Was the first shot on target?']){
  const question={kind:'interrupted',seed:8341,time:100,question:questionText};
  const plan=operationEnvelope(question,{operator:'orderedEndpoints',metric:'shotsOnTarget',subjects:[]}).operationPlan;
  const mock=directTransport({mentionedPlayers:[],decision:{kind:'operation',plan}});
  await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}),error=>error.code==='question-invalid-operation');assert.equal(mock.count(),1);
 }
 const question={kind:'interrupted',seed:8341,time:100,question:'Compare the first and latest shots on target.'};
 const plan=operationEnvelope(question,{operator:'orderedEndpoints',metric:'shotsOnTarget',subjects:[]}).operationPlan;
 const mock=directTransport({mentionedPlayers:[],decision:{kind:'operation',plan}},{decision:'approve'},(_packet,call,body)=>{
  if(!call)assert.ok(operationProperties(body,'orderedEndpoints').metric.enum.includes('shotsOnTarget'));
 });
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.proofs[0].metric,'shotsOnTarget');assert.equal(result.proofs[0].values.count,1);assert.equal(mock.count(),2);
});

test('exclusive queries route writes general and roster answers only after planning',async()=>{
 for(const rosterFact of [false,true]){
  const question={kind:'sustained',seed:17,time:20,question:rosterFact?'What team does J. Cole play for?':'What is a low block?'};let calls=0;
  const fetcher=async(_url,options)=>{
   const body=JSON.parse(options.body),packet=JSON.parse(body.messages.at(-1).content);let value;
   if(calls===0)value={mentionedPlayers:rosterFact?['J. Cole']:[],decision:{kind:'queries',queries:[]}};
   else if(calls===1){
    assert.equal(body.response_format.json_schema.name,'match_answer');
    const text=rosterFact?'J. Cole plays for Northbridge.':'A low block is a compact defensive shape near the team’s own goal.';
    const evidence=rosterFact?[packet.queryResults.find(q=>q.query.filters.player==='J. Cole').scopeReference]:[];
    value={scope:rosterFact?'match':'general',claims:[{text,kind:rosterFact?'observation':'general',evidence}],followUp:''};
   }else{assert.equal(calls,2);value={decision:'approve'};}
   calls++;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reviewFixture(value,body))}}],usage:{prompt_tokens:100,completion_tokens:20}})};
  };
  const result=await answerMatchQuestionAI(question,{config,fetcher});assert.equal(calls,3);assert.equal(result.provenance.modelGenerated,true);assert.deepEqual(result.execution.stages.map(s=>s.stage),['answer-or-query','answer-after-query','review']);assert.deepEqual(result.execution.usage,{promptTokens:300,completionTokens:60});assert.deepEqual(result.moments,[]);
 }
});

test('general knowledge has an exclusive wire route and no hidden match or player-lookup context',async()=>{
 const question={...input,question:'Explain offside simply.',language:'en',conversation:[{question:'What is an attacking phase?',answer:'A period when a team attacks.',time:90}]};let calls=0;
 const answer={scope:'general',claims:[{text:'An offside position alone is not an offense; active involvement is also required.',kind:'general',evidence:[]}],followUp:''};
 const fetcher=async(_url,options)=>{
  const body=JSON.parse(options.body),packet=JSON.parse(body.messages.at(-1).content);let value;
  if(!calls){
   assert.deepEqual(decisionBranch(body,'general').required,['kind','concepts']);assert.equal(decisionBranch(body,'general').additionalProperties,false);
   value={mentionedPlayers:['Messi'],decision:{kind:'general'}};
  }else if(calls===1){
   assert.deepEqual(Object.keys(packet).sort(),['question','viewerProfile','requestComponents','responseLanguage','previousQuestion','conversation'].sort());
   assert.deepEqual(packet.conversation,question.conversation);assert.match(body.messages[0].content,/This is a general football explanation/);value=answer;
  }else{
   for(const field of ['roster','teams','score','limits','pendingOutcomeContext','mentionedPlayerResolution'])assert.equal(packet.evidence[field],undefined,field);
   assert.deepEqual(packet.evidence.queryResults,[]);assert.deepEqual(packet.evidence.linkedContext.rows,[]);
   value={decision:'approve'};
  }
  calls++;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reviewFixture(value,body))}}]})};
 };
 const result=await answerMatchQuestionAI(question,{config,fetcher});assert.equal(calls,3);assert.equal(result.scope,'general');assert.deepEqual(result.evidence,[]);assert.deepEqual(result.moments,[]);assert.equal(result.provenance.modelGenerated,true);
 for(const decision of [{kind:'general',queries:[]},{kind:'general',plan:{version:1,obligations:[]}}]){
  const bad=directTransport({mentionedPlayers:[],decision});await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:bad.fetcher}),error=>error.code==='question-invalid-operation');assert.equal(bad.count(),1);
 }
});

test('selected rule knowledge is identical for selection and review with honest separate source metadata',async()=>{
 const question={...input,question:'What makes an offside position an offense?'};
 const facts=retrieveFootballKnowledge(['offside']);let writerKnowledge;
 const answer={scope:'general',claims:[{text:'An offside position alone is not an offense; active involvement is also required.',kind:'general',evidence:[],dependsOn:[]}],followUp:''};
 const mock=sequenceTransport([{mentionedPlayers:[],decision:{kind:'general',concepts:['offside']}},{factIds:['offside.involvement']},{decision:'approve'}],(packet,call,body)=>{
  if(!call){assert.deepEqual(packet.footballKnowledgeCatalog,footballKnowledgeCatalog);assert.equal(decisionBranch(body,'general').properties.concepts.maxItems,3);assert.equal(body.response_format.json_schema.schema.properties.mentionedPlayers.items.maxLength,100);}
  else if(call===1){writerKnowledge=packet.footballKnowledge;assert.deepEqual(writerKnowledge,facts);assert.equal(packet.queryResults,undefined);assert.equal(packet.roster,undefined);}
  else{assert.deepEqual(packet.footballKnowledge,writerKnowledge);assert.deepEqual(packet.evidence.queryResults,[]);}
 });
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});
 assert.equal(mock.count(),3);assert.deepEqual(result.knowledgeSources,facts.sources);assert.equal(result.knowledgeReference.contentHash,facts.contentHash);assert.deepEqual(result.knowledgeReference.conceptIds,['offside']);
 assert.match(result.knowledgeReference.attribution,/selection alone does not verify/i);assert.equal(result.provenance.modelGenerated,false);assert.equal(result.provenance.source,'verified-rule-facts');assert.equal(result.answer,facts.concepts[0].facts.find(fact=>fact.id==='offside.involvement').text);assert.deepEqual(result.evidence,[]);assert.deepEqual(result.moments,[]);
 for(const concepts of [['unknown-law'],['offside','offside'],['offside','goal','var','fouls'],[42],null]){
  const invalid=directTransport({mentionedPlayers:[],decision:{kind:'general',concepts}});
  await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:invalid.fetcher}),error=>error.code==='question-invalid-operation');assert.equal(invalid.count(),1);
 }
});

test('interpretations can lead or follow their directly grounded observations without invented citations',async()=>{
 for(const leads of [false,true]){
  const observation={text:'Reed shot off target.',kind:'observation',evidence:[ref],dependsOn:[]};
  const interpretation={text:'Reed’s attempt was unsuccessful.',kind:'interpretation',evidence:[],dependsOn:[leads?1:0]};
  const candidate={scope:'match',claims:leads?[interpretation,observation]:[observation,interpretation],followUp:''};
  const trace=[{claimIndex:leads?0:1,observationIndices:[leads?1:0]}];
  const mock=directTransport({draft:candidate,queries:[]},{decision:'approve'},(packet,call)=>{
   if(call){assert.deepEqual(packet.claimDependencies,trace);assert.deepEqual(packet.answer.claims[leads?0:1].evidence,[ref]);}
  });
  const answer=await answerMatchQuestionAI(input,{config,fetcher:mock.fetcher});assert.deepEqual(answer.claimDependencies,trace);assert.deepEqual(answer.claims[leads?0:1].evidence,[ref]);assert.equal(answer.provenance.modelGenerated,true);assert.equal(mock.count(),2);
  assert.deepEqual(interpretation.evidence,[],'Do not mutate the received model answer');
 }
});

test('dependency references cannot form cycles, target unsupported claim kinds or rescue missing direct evidence',async()=>{
 const observation={text:'Reed shot off target.',kind:'observation',evidence:[ref]};
 const interpretation={text:'Reed’s attempt was unsuccessful.',kind:'interpretation',evidence:[],dependsOn:[1]};
 const invalidClaims=[
  [{...interpretation,dependsOn:[0]},observation],
  [{...interpretation,dependsOn:[1,1]},observation],
  [{...interpretation,dependsOn:[2]},observation],
  [{...interpretation,dependsOn:['1']},observation],
  [{...interpretation,dependsOn:null},observation],
  [interpretation,{...observation,evidence:[]}],
  [interpretation,{...observation,kind:'general'}],
  [interpretation,{...observation,kind:'limitation'}],
  [interpretation,{...interpretation,dependsOn:[0]}],
  [{...observation,dependsOn:[1]},observation],
  [interpretation,{...observation,evidence:[{...ref,revision:99}]}]
 ];
 for(const claims of invalidClaims){const mock=directTransport({draft:{scope:'match',claims,followUp:''},queries:[]});await assert.rejects(answerMatchQuestionAI(input,{config,fetcher:mock.fetcher}));assert.equal(mock.count(),1);}
 const unsupported=directTransport({draft:{scope:'match',claims:[{...interpretation,text:'Reed had a 90% chance of scoring.'},observation],followUp:''},queries:[]});
 await assert.rejects(answerMatchQuestionAI(input,{config,fetcher:unsupported.fetcher}),error=>error.code==='question-withheld');assert.equal(unsupported.count(),1);
});

test('one structural planning correction uses three-call headroom and preserves canonical results',async()=>{
 const question={kind:'sustained',seed:8341,time:110,question:'Which side has completed more passes?'};
 const invalid=operationEnvelope(question,{subjects:['home','all']}),valid=operationEnvelope(question);let budgetRequirement;
 const mock=sequenceTransport([invalid,valid,{decision:'approve'}],(packet,call,body)=>{
  if(call===1){assert.equal(body.response_format.json_schema.name,'match_answer_or_query');assert.deepEqual(packet.rejectedPlan,invalid);assert.match(packet.planningError,/restriction/);assert.doesNotMatch(body.messages[0].content,/A useful rules definition|An absent recorded action/);}
 });
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher,canRepair:required=>{budgetRequirement=required;return true;}});
 assert.equal(budgetRequirement,3);assert.equal(result.proofs[0].values.absoluteMargin,1);assert.equal(result.execution.planningRepairs,1);assert.equal(result.execution.repairs,1);assert.equal(result.execution.modelCalls,3);
 assert.deepEqual(result.execution.stages.map(stage=>stage.stage),['answer-or-query','planning-repair','review']);assert.deepEqual(result.execution.usage,{promptTokens:300,completionTokens:60});
 const repeat=sequenceTransport([invalid,invalid]);await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:repeat.fetcher,canRepair:()=>true}),error=>error.code==='question-invalid-operation');assert.equal(repeat.count(),2);
});

test('malformed player references can be replanned once without exceeding the five-call shared ceiling',async()=>{
 const question={...input,question:'What is a low block?'};
 const invalid={mentionedPlayers:['X'.repeat(101)],decision:{kind:'general',concepts:[]}},valid={mentionedPlayers:[],decision:{kind:'general',concepts:[]}};
 const good={scope:'general',claims:[{text:'A low block is a compact defensive shape close to the team’s own goal.',kind:'general',evidence:[]}],followUp:''};
 const bad={scope:'match',claims:[{text:'Reed scored.',kind:'observation',evidence:[]}],followUp:''};
 const limits=[];
 const mock=sequenceTransport([invalid,valid,bad,good,{decision:'approve'}]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher,canRepair:required=>{limits.push(required);return true;}});
 assert.deepEqual(limits,[3,2]);assert.equal(mock.count(),5);assert.equal(result.execution.modelCalls,5);assert.equal(result.execution.planningRepairs,1);assert.equal(result.execution.repairs,2);
 const withheld=sequenceTransport([invalid,valid,good,{decision:'withhold',reason:'The answer does not fulfill the request.'}]);let checks=0;
 await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:withheld.fetcher,canRepair:()=>{checks++;return true;}}),error=>error.code==='question-withheld');assert.equal(withheld.count(),4);assert.equal(checks,1,'No two-call prose repair fits after four calls');
 let calls=0;
 await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:async()=>{calls++;throw Error('network stopped');},canRepair:()=>{throw Error('Transport failures cannot request repair');}}),error=>error.code==='azure-network');assert.equal(calls,1);
});

test('zero-query match misplanning cannot cite a hidden preload and can ask a grounded clarification',async()=>{
 for(const fabricate of [false,true]){
  let calls=0;
  const fetcher=async(_url,options)=>{
   const body=JSON.parse(options.body),packet=JSON.parse(body.messages.at(-1).content);let value;
   if(!calls)value={mentionedPlayers:[],decision:{kind:'queries',queries:[]}};
   else if(calls===1){assert.equal(packet.queryResults,undefined);assert.equal(packet.limits,undefined);assert.equal(packet.score,undefined);value=fabricate?draft:{scope:'clarify',claims:[{text:'Which moment do you mean?',kind:'limitation',evidence:[]}],followUp:''};}
   else value={decision:'approve',requestCheck:{requestedInformation:input.question,status:'clarification',reason:'The planner did not retrieve the requested moment.'}};
   calls++;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reviewFixture(value,body))}}]})};
  };
  if(fabricate){await assert.rejects(answerMatchQuestionAI(input,{config,fetcher}),/unavailable or outdated/);assert.equal(calls,2);}
  else{const result=await answerMatchQuestionAI(input,{config,fetcher});assert.equal(result.scope,'clarify');assert.equal(result.status,'limited');assert.equal(calls,3);}
 }
});

test('exclusive queries route retains the five-call ceiling with one reviewed repair',async()=>{
 const question={kind:'quiet',seed:17,time:20,question:'What is a low block?'};
 const bad={scope:'general',claims:[{text:'A low block is always perfect.',kind:'general',evidence:[]}],followUp:''};
 const good={scope:'general',claims:[{text:'A low block is a compact defensive shape near the team’s own goal.',kind:'general',evidence:[]}],followUp:''};
 let calls=0,repairChecks=0;
 const fetcher=async(_url,options)=>{
  const body=JSON.parse(options.body),values=[{mentionedPlayers:[],decision:{kind:'queries',queries:[]}},bad,{decision:'withhold',reason:'Unsupported universal assessment.'},good,{decision:'approve'}];
  assert.ok(calls<5);const value=reviewFixture(values[calls++],body);
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:100,completion_tokens:20}})};
 };
 const result=await answerMatchQuestionAI(question,{config,fetcher,canRepair:()=>{repairChecks++;return true;}});
 assert.equal(calls,5);assert.equal(repairChecks,1);assert.equal(result.execution.repairs,1);assert.equal(result.answer,good.claims[0].text);
 assert.deepEqual(result.execution.stages.map(stage=>stage.stage),['answer-or-query','answer-after-query','review','repair','review']);
 assert.deepEqual(result.execution.usage,{promptTokens:500,completionTokens:100});
});

test('planner schema binds canonical subject IDs and distinguishes all attempts from on-target filtering',async()=>{
 const question={kind:'interrupted',seed:8341,time:100,question:'Compare the first and latest shots.'};
 const mock=directTransport(operationEnvelope(question,{operator:'orderedEndpoints',metric:'attempts',subjects:[]}),{decision:'approve'},(packet,call,body)=>{
  if(call)return;
  const properties=operationProperties(body,'orderedEndpoints');
  assert.deepEqual(properties.subjects.anyOf,[{type:'array',minItems:0,maxItems:0,items:{type:'string'}}]);
  assert.match(properties.subjects.description,/\[\] for the whole match/);
  assert.match(properties.metric.description,/attempts means ALL shots/);assert.match(properties.metric.description,/blocked, off-target/);
  assert.match(properties.metric.description,/shotsOnTarget means ONLY confirmed goals and saved shots/);
  assert.match(body.messages[0].content,/Global orderedEndpoints use subjects:\[\]/);
 });
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});
 assert.equal(result.proofs[0].metric,'attempts');assert.equal(result.proofs[0].values.latest.actor.label,'D. Silva');assert.equal(mock.count(),2);
});

test('qualitative, roster and unary requests cannot select an unrelated typed operation',async()=>{
 for(const questionText of ['Why did Cole not pass there?','Who has been the standout so far, and why?','Is Messi playing for either side?','Who last played a pass with the left foot?','What is the passing accuracy for each side?']){
  const question={kind:'sustained',seed:8341,time:110,question:questionText};let body;
  const mock=directTransport(operationEnvelope(question,{metric:'attempts'}),{decision:'approve'},(_packet,call,request)=>{if(!call)body=request;});
  await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}),error=>error.code==='question-invalid-operation');
  assert.equal(mock.count(),1);
  if(questionText.includes('passing accuracy'))assert.deepEqual(decisionBranch(body,'operation').properties.plan.properties.obligations.items.anyOf.map(branch=>branch.properties.operator.enum),[['ratio']]);
  else assert.equal(decisionBranch(body,'operation'),undefined);
  assert.ok(decisionBranch(body,'queries'));
 }
});

test('operation subjects and topical metrics are constrained before execution, including duplicate subjects',async()=>{
 const global={kind:'interrupted',seed:8341,time:100,question:'Compare the first and latest shots.'};
 const comparison={kind:'sustained',seed:8341,time:110,question:'Which side has completed more passes, and by how many?'};
 const named={...global,question:'Compare Silva’s first and latest shots.'};
 for(const [question,options] of [[global,{operator:'orderedEndpoints',metric:'attempts',subjects:['away-10']}],[comparison,{subjects:['home-7','home-8']}],[comparison,{subjects:['home','home']}],[comparison,{metric:'attempts'}],[named,{operator:'orderedEndpoints',metric:'attempts',subjects:['home-10']}]]){
  const mock=directTransport(operationEnvelope(question,options));
  await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}),error=>error.code==='question-invalid-operation');assert.equal(mock.count(),1);
 }
 const approved=directTransport(operationEnvelope(named,{operator:'orderedEndpoints',metric:'attempts',subjects:['away-10']}),{decision:'approve'},(_packet,call,body)=>{
  if(call)return;
  const properties=operationProperties(body,'orderedEndpoints');
  assert.deepEqual(properties.subjects.anyOf.map(scope=>scope.items.enum||[]),[[],['away-10']]);
  assert.deepEqual(properties.timeFrom.enum,[0]);assert.deepEqual(properties.timeTo.enum,[100]);
 });
 const result=await answerMatchQuestionAI(named,{config,fetcher:approved.fetcher});
 assert.ok(result.proofs[0].subjects.every(subject=>subject.id==='away-10'));assert.equal(approved.count(),2);
});

test('explicit operation windows remain available while ambiguous temporal scope uses query planning',async()=>{
 const question={kind:'sustained',seed:8341,time:110,question:'In the last 30 seconds, which side has had more shots?'};
 const mock=directTransport(operationEnvelope(question,{metric:'attempts',timeFrom:80}),{decision:'approve'},(_packet,call,body)=>{
  if(!call)assert.equal(operationProperties(body,'difference').timeFrom.enum,undefined);
 });
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.deepEqual(result.proofs[0].window,{from:80,to:110});
 const ambiguous={...question,question:'Which side has had more shots recently?'};let schema;
 const invalid=directTransport(operationEnvelope(ambiguous,{metric:'attempts',timeFrom:80}),{},(_packet,call,body)=>{if(!call)schema=body;});
 await assert.rejects(answerMatchQuestionAI(ambiguous,{config,fetcher:invalid.fetcher}),error=>error.code==='question-invalid-operation');assert.equal(decisionBranch(schema,'operation'),undefined);
});

test('plain count and list queries cannot carry grouped sorting or bounds in the wire or runtime',async()=>{
 for(const aggregate of ['count','list']){
  const question={kind:'sustained',seed:8341,time:110,question:'What is the passing accuracy for each side?'};let request;
  const mock=directTransport({mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'pass'},aggregate,groupCount:{min:0},groupOrder:'count-desc'}]}},{},(_packet,call,body)=>{if(!call)request=body;});
  await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}),/lookup/);assert.equal(mock.count(),1);
  const [plain,grouped]=decisionBranch(request,'queries').properties.queries.items.anyOf;
  assert.deepEqual(plain.properties.groupCount,{type:'null'});assert.deepEqual(plain.properties.groupOrder,{type:'null'});
  assert.deepEqual(plain.properties.aggregate.anyOf[0].enum,['list','count']);assert.deepEqual(grouped.properties.aggregate.enum,['by-player','by-team','by-assister']);
  assert.ok(grouped.properties.groupCount.anyOf.some(schema=>schema.type==='object'));
 }
});

test('query event IDs require actual moment deixis and cannot narrow a broad request',async()=>{
 const broad={kind:'sustained',seed:17,time:96,anchorId:input.anchorId,question:'What is the passing accuracy for each side?'};let firstBody;
 const invalid=directTransport({mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{id:input.anchorId,type:'pass'},aggregate:'count'}]}},{},(_packet,call,body)=>{if(!call)firstBody=body;});
 await assert.rejects(answerMatchQuestionAI(broad,{config,fetcher:invalid.fetcher}),/lookup/);assert.equal(invalid.count(),1);
 for(const schema of decisionBranch(firstBody,'queries').properties.queries.items.anyOf)assert.deepEqual(schema.properties.filters.anyOf[0].properties.id,{type:'null'});
 let calls=0,writerPacket;
 const fetcher=async(_url,options)=>{
  const body=JSON.parse(options.body),packet=JSON.parse(body.messages.at(-1).content);let value;
  if(!calls){
   assert.equal(body.max_completion_tokens,900);
   const variants=decisionBranch(body,'queries').properties.queries.items.anyOf;
   for(const schema of variants.slice(0,-1))assert.deepEqual(schema.properties.filters.anyOf[0].properties.id,{type:'null'});
   const inspection=variants.at(-1);assert.deepEqual(inspection.properties.filters.properties.id.enum,[input.anchorId]);
   for(const [field,schema] of Object.entries(inspection.properties.filters.properties))if(field!=='id')assert.deepEqual(schema,{type:'null'});
   value={mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{id:input.anchorId},aggregate:'list'}]}};
  }else if(calls===1){writerPacket=packet;value=draft;}else value={decision:'approve'};
  calls++;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reviewFixture(value,body))}}]})};
 };
 const result=await answerMatchQuestionAI(input,{config,fetcher});assert.equal(calls,3);assert.equal(result.status,'answered');
 assert.equal(writerPacket.requestedEvidence[0].query.filters.id,input.anchorId);
});

test('both typed and prose review schemas require exactly the server-defined request spans',async()=>{
 const comparison={kind:'sustained',seed:8341,time:110,question:'Which side has completed more passes, and how large is the difference?'};
 const general={...comparison,question:'What is a low block, and why is it used?'};
 const definition={scope:'general',claims:[{text:'A low block is a compact defensive shape near the team’s own goal, used to restrict space behind defenders.',kind:'general',evidence:[]}],followUp:''};
 for(const [question,envelope] of [[comparison,operationEnvelope(comparison)],[general,{operationPlan:null,mentionedPlayers:[],draft:definition,queries:[]}]]){
  const components=requestComponents(question.question);assert.equal(components.length,2);
  const mock=directTransport(envelope,{decision:'approve'},(_packet,call,body)=>{
   if(!call)return;
   const coverage=body.response_format.json_schema.schema.properties.requestCheck.properties.coverage;
   assert.equal(coverage.minItems,2);assert.equal(coverage.maxItems,2);
   assert.deepEqual(coverage.items.properties.requestSpan.enum,components);
   assert.deepEqual(coverage.items.required,['requestSpan','claimIndices','answerForm','requestedAction','temporalRelation','relationAnchorClaimIndex','relationEntityBinding','relationSourceLinkIndex']);assert.equal(coverage.items.properties.answerSpan,undefined);
   assert.deepEqual(coverage.items.properties.claimIndices.items.enum,[0]);assert.equal(coverage.items.properties.claimIndices.maxItems,1);
  });
  const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(mock.count(),2);
  assert.equal(result.provenance.modelGenerated,question===general);
 }
});

test('typed reviewer whole-question and duplicate spans fail even when canonical facts are correct',async()=>{
 const question={kind:'sustained',seed:8341,time:110,question:'Which side has completed more passes, and how large is the difference?'};
 for(const duplicate of [false,true]){
  const mock=directTransport(operationEnvelope(question),packet=>{
   const requestSpan=duplicate?packet.requestComponents[0]:question.question;
   const part={requestSpan,answerSpan:packet.answer.claims[0].text};
   return {decision:'approve',reason:'Incorrect coverage shape.',requestCheck:{requestedInformation:question.question,status:'answered',coverage:duplicate?[part,part]:[part],reason:'All counts correct.'}};
  });
  await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}),error=>error.code==='question-withheld');assert.equal(mock.count(),2);
 }
});

test('typed difference returns explicit verified margin and truthful provenance in two actual calls',async()=>{
 const question={kind:'sustained',seed:8341,time:110,question:'Which side has completed more passes so far, and by how many?'};
 const envelope=operationEnvelope(question);
 envelope.draft={scope:'match',claims:[{text:'Northbridge completed 99 passes.',kind:'observation',evidence:[]}],followUp:''};
 const mock=directTransport(envelope,{decision:'approve',reason:'The operation answers both the comparison and requested margin.',checks:[{claimIndex:0,actors:[{name:'Fictional actor',action:'pass',individualAction:true}],counts:[{text:'99 passes',value:99,scopeReference:{type:'scope',id:'model-invented-count',revision:1},groupKey:'home'}],inventedFacts:[],supported:true,reason:'Canonical facts answer the operation.'}]},(packet,call)=>{
  if(!call)return;
  assert.equal(packet.canonicalFacts,true);assert.equal(packet.operationPlan.obligations[0].operator,'difference');
  assert.equal(packet.operationProofs[0].values.absoluteMargin,1);
  assert.equal(packet.operationProofs[0].values.left.count,5);assert.equal(packet.operationProofs[0].values.right.count,4);
  assert.equal(packet.answer.claims.some(claim=>claim.text.includes('99')),false,'Premature prose must be discarded');
  for(const ref of packet.answer.claims.flatMap(claim=>claim.evidence))assert.ok(packet.evidence.queryResults.some(query=>query.scopeReference.id===ref.id),'Reviewer references must resolve in its projected evidence');
 });
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});
 assert.equal(mock.count(),2);assert.equal(result.execution.modelCalls,2);assert.equal(result.execution.repairs,0);
 assert.equal(result.proofs[0].values.absoluteMargin,1);assert.equal(result.proofs[0].values.leader,'home');
 assert.match(result.answer,/5/);assert.match(result.answer,/4/);assert.match(result.answer,/1/);assert.doesNotMatch(result.answer,/99|Fictional/);
 assert.equal(result.provenance.source,'verified-operation-facts');assert.equal(result.provenance.modelGenerated,false);assert.equal(result.provenance.aiInterpreted,true);
 assert.equal(result.observedAt,110);assert.equal(result.matchId,'spatial-match-sustained-8341');assert.match(result.key,/^question:/);
 assert.deepEqual(result.execution.stages.map(stage=>stage.stage),['answer-or-query','review']);
 assert.deepEqual(result.execution.usage,{promptTokens:200,completionTokens:40});
 assert.ok(result.evidence.every(ref=>ref.id.startsWith('match-query-')),'Final evidence must retain canonical scope IDs');
 assert.deepEqual(result.moments,[]);
});

test('passing accuracy is computed from resolved pass outcomes with pending passes disclosed and canonical provenance',async()=>{
 const question={kind:'sustained',seed:84621,time:110,question:'What is the passing accuracy for each side?'};
 const snapshot=matchState(question),expected=['home','away'].map(id=>{
  const passes=snapshot.events.filter(event=>event.type==='pass'&&event.team===id);
  const completed=passes.filter(event=>event.result===true).length,failed=passes.filter(event=>event.result===false).length,pending=passes.filter(event=>event.result===null).length;
  return {id,completed,failed,pending,numerator:completed,denominator:completed+failed,ratio:completed/(completed+failed)};
 });
 assert.deepEqual(expected.map(({completed,failed,pending})=>[completed,failed,pending]),[[5,0,1],[4,2,0]]);
 let reviewed;
 const mock=directTransport(operationEnvelope(question,{operator:'ratio',metric:'passCompletionRate'}),{decision:'approve'},(packet,call,body)=>{
  if(!call){
   assert.deepEqual(operationProperties(body,'ratio').metric.enum,['passCompletionRate']);
   assert.equal(operationProperties(body,'difference'),undefined);assert.equal(operationProperties(body,'orderedEndpoints'),undefined);
   assert.match(body.messages[0].content,/completed\/\(completed\+failed\)/);assert.match(body.messages[0].content,/passing accuracy ratio3/);
  }else{
   reviewed=packet;assert.equal(packet.canonicalFacts,true);assert.equal(packet.operationProofs[0].operator,'ratio');
   assert.equal(packet.evidence.queryResults.length,3);
   assert.ok(packet.answer.claims.flatMap(claim=>claim.evidence).every(ref=>packet.evidence.queryResults.some(query=>query.scopeReference.id===ref.id)));
  }
 });
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}),proof=result.proofs[0];
 assert.equal(mock.count(),2);assert.equal(result.execution.modelCalls,2);assert.equal(result.execution.repairs,0);
 assert.deepEqual(proof.values.teams.map(({id,completed,failed,pending,numerator,denominator,ratio})=>({id,completed,failed,pending,numerator,denominator,ratio})),expected);
 assert.equal(proof.values.definition,'completed/(completed+failed)');assert.equal(proof.values.pendingExcluded,true);
 assert.deepEqual(proof.values.teams.map(team=>team.displayPercent),['100','66.7']);
 assert.equal(proof.evidence.length,3);assert.ok(result.evidence.every(ref=>ref.id.startsWith('match-query-')));
 assert.match(result.answer,/100%/);assert.match(result.answer,/66\.7%/);assert.match(result.answer,/1 awaiting an outcome/);
 assert.equal(result.provenance.source,'verified-operation-facts');assert.equal(result.provenance.modelGenerated,false);assert.equal(result.provenance.aiInterpreted,true);
 assert.deepEqual(result.execution.usage,{promptTokens:200,completionTokens:40});assert.deepEqual(result.moments,[]);
 assert.deepEqual(reviewed.operationProofs[0].values,proof.values);
});

test('ratio coverage uses claim identity without copying or corrupting canonical numbers',async()=>{
 const question={kind:'sustained',seed:84621,time:110,question:'What is the passing accuracy for each side?'};
 for(const indexed of [false,true]){
  const mock=directTransport(operationEnvelope(question,{operator:'ratio',metric:'passCompletionRate'}),packet=>({decision:'approve',requestCheck:{requestedInformation:question.question,status:'answered',reason:'The canonical ratio answers both teams.',coverage:[{requestSpan:packet.requestComponents[0],...(indexed?{claimIndices:[0]}:{answerSpan:packet.answer.claims[0].text.replace('5 completed of 5','\t6 completed of 5')})}]}}));
  if(indexed){const answer=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.match(answer.answer,/5 completed of 5/);assert.doesNotMatch(answer.answer,/6 completed of 5/);assert.equal(answer.provenance.modelGenerated,false);}
  else await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}),error=>error.code==='question-withheld');
  assert.equal(mock.count(),2);
 }
});

test('valid claim indices never override a semantic relevance rejection',async()=>{
 const question={kind:'sustained',seed:8341,time:110,question:'Which team has completed more passes?'};
 const mock=directTransport(operationEnvelope(question),packet=>({decision:'approve',requestCheck:{requestedInformation:question.question,status:'not-answered',reason:'These claims do not fulfill the requested context.',coverage:packet.requestComponents.map(requestSpan=>({requestSpan,claimIndices:[0]}))}}));
 await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}),error=>error.code==='question-withheld');assert.equal(mock.count(),2);
});

test('zero resolved passes produce no percentage and ratio cannot switch metric or player scope',async()=>{
 const question={kind:'quiet',seed:84621,time:0,question:'What is the passing accuracy for each side?'};
 const mock=directTransport(operationEnvelope(question,{operator:'ratio',metric:'passCompletionRate'}),{decision:'approve'});
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});
 for(const team of result.proofs[0].values.teams){assert.equal(team.denominator,0);assert.equal(team.ratio,null);assert.equal(team.percentage,null);assert.equal(team.displayPercent,null);}
 assert.doesNotMatch(result.answer,/\d\s*%/);assert.equal(result.provenance.modelGenerated,false);assert.equal(mock.count(),2);
 for(const options of [{operator:'ratio',metric:'completedPasses'},{operator:'difference',metric:'passCompletionRate'},{operator:'ratio',metric:'passCompletionRate',subjects:['home-7']}]){
  const invalid=directTransport(operationEnvelope(question,options));
  await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:invalid.fetcher}),error=>error.code==='question-invalid-operation');assert.equal(invalid.count(),1);
 }
 const single={...question,time:110,question:'What is Northbridge’s passing accuracy?'};
 const selected=directTransport(operationEnvelope(single,{operator:'ratio',metric:'passCompletionRate',subjects:['home']}),{decision:'approve'});
 const answer=await answerMatchQuestionAI(single,{config,fetcher:selected.fetcher});assert.deepEqual(answer.proofs[0].values.teams.map(team=>team.id),['home']);assert.equal(selected.count(),2);
});

test('writer and reviewer receive applicability and epistemic policies without adding them to the planner',async()=>{
 for(const questionText of ['What is offside?','Why did Cole not pass there?']){
  const question={kind:'sustained',seed:17,time:90,question:questionText};let calls=0;
  const definition={scope:'general',claims:[{text:'An offside position alone is not an offense; active involvement is also required.',kind:'general',evidence:[]}],followUp:''};
  const limitation={scope:'match',claims:[{text:'I cannot tell why Cole did not pass from the recorded actions.',kind:'limitation',evidence:[]}],followUp:''};
  const fetcher=async(_url,options)=>{
   const body=JSON.parse(options.body);let value;
   if(calls===0){assert.doesNotMatch(body.messages[0].content,/A useful rules definition|An absent recorded action/);value={mentionedPlayers:[],decision:{kind:'queries',queries:[]}};}
   else{
    assert.match(body.messages[0].content,/additional action or involvement/);assert.match(body.messages[0].content,/An absent recorded action does not prove absence of possession, control, time, options or opportunity/);
    assert.match(body.messages[0].content,/45 words or fewer/);value=calls===1?(questionText.startsWith('What')?definition:limitation):{decision:'approve'};
   }
   calls++;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reviewFixture(value,body))}}]})};
  };
  const result=await answerMatchQuestionAI(question,{config,fetcher});assert.equal(calls,3);assert.equal(result.provenance.modelGenerated,true);
 }
});

test('typed comparisons preserve reversed operands, ties and explicitly requested player subjects',async()=>{
 const question={kind:'sustained',seed:8341,time:110,question:'Compare the teams’ completed pass totals and their difference.'};
 for(const [subjects,time,counts,leader] of [[['away','home'],110,[4,5],'home'],[['home','away'],0,[0,0],null],[['home-7','home-8'],110,[4,1],'home-7']]){
  const request={...question,time,...(subjects[0]==='home-7'?{question:'Compare Cole and Mensah in completed pass totals and their difference.'}:{})},mock=directTransport(operationEnvelope(request,{subjects}),{decision:'approve'});
  const result=await answerMatchQuestionAI(request,{config,fetcher:mock.fetcher}),values=result.proofs[0].values;
  assert.deepEqual([values.left.count,values.right.count],counts);assert.equal(values.signedDelta,counts[0]-counts[1]);assert.equal(values.leader,leader);assert.equal(values.tie,counts[0]===counts[1]);assert.equal(mock.count(),2);
 }
});

test('a single operation binds a bad model source span to the full question with an audit trace',async()=>{
 const question={kind:'sustained',seed:8341,time:110,question:'Which side has completed more passes so far, and by how many?'};
 const envelope=operationEnvelope(question);envelope.operationPlan.obligations[0].requestSpan='0..110';
 const mock=directTransport(envelope,{decision:'approve'},(packet,call)=>{
  if(!call)return;
  assert.equal(packet.operationPlan.obligations[0].requestSpan,question.question);
  assert.equal(packet.operationProofs[0].requestSpan,question.question);
  assert.equal(packet.operationPlanNormalization[0].original,'0..110');
  assert.equal(packet.evidence.question,question.question);
 });
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});
 assert.equal(result.proofs[0].values.absoluteMargin,1);assert.equal(result.proofs[0].requestSpan,question.question);
 assert.equal(result.operationPlanNormalization[0].original,'0..110');assert.equal(result.operationPlanNormalization[0].applied,question.question);
 assert.equal(envelope.operationPlan.obligations[0].requestSpan,'0..110','Keep the received model object unchanged');assert.equal(mock.count(),2);
});

test('normalizing a single source span cannot license an omitted qualitative request',async()=>{
 const question={kind:'sustained',seed:8341,time:110,question:'Compare the completed pass counts and explain why the teams differ.'};
 const envelope=operationEnvelope(question);envelope.operationPlan.obligations[0].requestSpan='0..110';
 const mock=directTransport(envelope,{decision:'withhold',reason:'The whole question additionally requires an explanation.',requestCheck:{requestedInformation:'Difference and explanation',status:'not-answered',coverage:[],reason:'The why component is not answered.'}},(packet,call)=>{
  if(call)assert.equal(packet.operationPlan.obligations[0].requestSpan,question.question);
 });
 await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}),error=>error.code==='question-invalid-operation');assert.equal(mock.count(),1);
});

test('multiple operation spans stay strict and single-span normalization never repairs invalid metrics',async()=>{
 const question={kind:'sustained',seed:8341,time:110,question:'Compare the teams’ completed passes and attempts.'};
 for(const multiple of [true,false]){
  const envelope=operationEnvelope(question);envelope.operationPlan.obligations[0].requestSpan='0..110';
  if(multiple)envelope.operationPlan.obligations.push({...envelope.operationPlan.obligations[0],id:'second',metric:'attempts'});
  else envelope.operationPlan.obligations[0].metric='invented-pressure';
  const mock=directTransport(envelope);
  await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}),error=>error.code==='question-invalid-operation');assert.equal(mock.count(),1);
 }
});

test('typed endpoints render both actual global outcomes and preserve a pending latest revision',async()=>{
 for(const [question,firstName,lastName,pending] of [
  [{kind:'interrupted',seed:8341,time:100,question:'Compare the first attempt with the latest one.'},'A. Reed','D. Silva',false],
  [{kind:'counter',seed:9193,time:116,question:'How did the earliest and latest attempts end?'},'D. Silva','A. Reed',true]
 ]){
  const mock=directTransport(operationEnvelope(question,{operator:'orderedEndpoints',metric:'attempts',subjects:[]}),{decision:'approve'});
  const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});
  assert.ok(result.answer.includes(firstName));assert.ok(result.answer.includes(lastName));
  assert.equal(result.proofs[0].values.first.actor.label,firstName);assert.equal(result.proofs[0].values.latest.actor.label,lastName);
  assert.equal(result.moments.length,2);assert.equal(mock.count(),2);
  if(pending){assert.match(result.answer,/pending|await|unknown|unconfirmed/i);assert.equal(result.proofs[0].values.latest.event.revision,1);}
  else{assert.match(result.answer,/saved/i);assert.match(result.answer,/blocked/i);}
 }
});

test('malformed supplied operation plans fail before review rather than falling back to prose',async()=>{
 const question={kind:'sustained',seed:8341,time:110,question:'Compare the teams’ completed pass counts.'};
 for(const mutate of [plan=>({...plan,version:99}),plan=>({...plan,obligations:[{...plan.obligations[0],operator:'run-code'}]}),plan=>({...plan,obligations:[{...plan.obligations[0],subjects:['home','Messi']}]}),plan=>({...plan,obligations:[{...plan.obligations[0],timeTo:999}]}),()=>({})]){
  const envelope=operationEnvelope(question);envelope.operationPlan=mutate(envelope.operationPlan);const mock=directTransport(envelope);
  await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}),error=>error.code==='question-invalid-operation');assert.equal(mock.count(),1);
 }
});

test('a relevant proof is insufficient when operation selection omits a qualitative request',async()=>{
 const question={kind:'sustained',seed:8341,time:110,question:'Compare the completed pass counts and explain why the teams differ.'};
 const mock=directTransport(operationEnvelope(question),{decision:'withhold',reason:'The computed difference does not explain why.',requestCheck:{requestedInformation:'Comparison and causal explanation',status:'not-answered',coverage:[],reason:'The causal component is missing.'}});
 await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher,canRepair:()=>false}),error=>error.code==='question-invalid-operation');
 assert.equal(mock.count(),1);
});

test('an unrequested narrowed operation window is rejected before execution and review',async()=>{
 const question={kind:'sustained',seed:8341,time:110,question:'Which side has completed more passes and what is the margin?'};
 const mock=directTransport(operationEnvelope(question,{timeTo:20}),{decision:'withhold',reason:'The request concerns the whole observed passage.',requestCheck:{requestedInformation:'Completed pass difference',status:'not-answered',coverage:[],reason:'Wrong window selected.'}});
 await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}),error=>error.code==='question-invalid-operation');assert.equal(mock.count(),1);
});

test('typed facts cannot bypass an explicit semantic warning inside a contradictory approval',async()=>{
 const question={kind:'sustained',seed:8341,time:110,question:'Which side has completed more passes and what is the margin?'};
 const mock=directTransport(operationEnvelope(question),{decision:'approve',reason:'Contradictory approval.',checks:[{claimIndex:0,actors:[],counts:[],inventedFacts:['The operation does not represent the intended comparison.'],supported:true,reason:'A semantic warning still requires withholding.'}]});
 await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}),error=>error.code==='question-withheld');assert.equal(mock.count(),2);
});

test('empty complete endpoint scope produces verified absence rather than an invented action',async()=>{
 const question={kind:'quiet',seed:2969,time:120,question:'Compare the first and last attempts.'};
 const mock=directTransport(operationEnvelope(question,{operator:'orderedEndpoints',metric:'attempts',subjects:[]}),{decision:'approve'});
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});
 assert.equal(result.proofs[0].values.count,0);assert.equal(result.proofs[0].values.first,null);assert.equal(result.proofs[0].values.latest,null);
 assert.match(result.answer,/No attempts/i);assert.deepEqual(result.moments,[]);assert.equal(mock.count(),2);
});

test('null and empty operation plans preserve the ordinary general-prose path',async()=>{
 const question={...input,question:'What is a low block?'},answer={scope:'general',claims:[{text:'A low block is a defensive shape close to the team’s own goal.',kind:'general',evidence:[]}],followUp:''};
 for(const operationPlan of [null,{version:1,obligations:[]}]){
  const mock=directTransport({mentionedPlayers:[],operationPlan,draft:answer,queries:[]},{decision:'approve'});
  const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.scope,'general');assert.equal(result.provenance.modelGenerated,true);assert.equal(result.proofs,undefined);assert.equal(mock.count(),2);
 }
});

test('roster facts retain evidence without offering an irrelevant replay button',async()=>{
 const question={kind:'sustained',seed:17,time:3,question:'What team does J. Cole play for?'};
 const event=executeMatchQuery({kind:question.kind,seed:question.seed,time:question.time},{filters:{type:'recovery'},aggregate:'list'}).rows[0];
 const rosterAnswer={scope:'match',claims:[{text:'J. Cole plays for Northbridge.',kind:'observation',evidence:event.evidence}],followUp:''};
 const mock=directTransport({mentionedPlayers:['J. Cole'],draft:rosterAnswer,queries:[]},{decision:'approve',reason:'The lineup supports this roster fact.',checks:[{claimIndex:0,actors:[{name:'J. Cole',action:'other',individualAction:false}],counts:[],inventedFacts:[],supported:true,reason:'The roster identifies his team.'}]});
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});
 assert.equal(result.evidence.length,1);assert.deepEqual(result.moments,[]);assert.equal(result.totalMoments,0);assert.equal(result.truncated,false);
});

test('a standalone roster assertion suppresses replay despite incorrect reviewer action classification',async()=>{
 const question={kind:'sustained',seed:17,time:20,question:'What team does J. Cole play for?'};
 const event=executeMatchQuery({kind:question.kind,seed:question.seed,time:question.time},{filters:{type:'pass',result:true},aggregate:'list'}).rows[0];
 for(const text of ['J. Cole plays for the home team, Northbridge.','J. Cole plays for Northbridge and completed the pass.']){
  const answer={scope:'match',claims:[{text,kind:'observation',evidence:event.evidence}],followUp:''};
  const mock=directTransport({mentionedPlayers:['J. Cole'],draft:answer,queries:[]},{decision:'approve',reason:'The supplied roster and event support the answer.',checks:[{claimIndex:0,actors:[{name:'J. Cole',action:'pass',individualAction:true}],counts:[],supported:true,reason:'Cole is identified in the roster and cited pass.'}]});
  const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});
  assert.equal(result.evidence.length,1);
  assert.equal(result.moments.length,text.includes('completed')?1:0,'Only a standalone membership assertion is excluded');
 }
});
test('accidental fragments ask for clarification without guessing a player or spending model calls',async()=>{
 for(const question of ['j','J?','x','???','...']){
  const result=await answerMatchQuestionAI({...input,question},{config,fetcher:async()=>{throw new Error('Unexpected model call');}});
  assert.equal(result.scope,'clarify');assert.equal(result.execution.modelCalls,0);
  assert.match(result.answer,/clarify/);assert.deepEqual(result.evidence,[]);assert.deepEqual(result.moments,[]);
  assert.equal(result.provenance.modelGenerated,false);assert.doesNotMatch(result.answer,/Cole|recovery|shots/);
 }
 const translated=await answerMatchQuestionAI({...input,question:'j',language:'es'},{config});
 assert.match(translated.answer,/aclarar/);
});
test('short meaningful questions and contextual fragments remain model interpreted',async()=>{
 for(const [question,conversation] of [['Score?',[]],['VAR?',[]],['Why?',[]],['Cole',[]],['asdfgh',[]]]){
  let reached=false;
  await assert.rejects(answerMatchQuestionAI({...input,question,conversation},{config,fetcher:async(_url,options)=>{
   reached=true;const policy=JSON.parse(options.body).messages[0].content;
   assert.match(policy,/Do not invent a question/);throw new Error('Intent model reached');
  }}));
  assert.equal(reached,true,question);
 }
});
const draft={scope:'match',claims:[{text:'Reed put this attempt off target.',kind:'observation',evidence:[ref]},{text:'The feed does not show his contact with the ball, so it cannot establish the technical reason for the miss.',kind:'limitation',evidence:[]}],followUp:''};
test('unsupported causal assertion is withheld even when the reviewer would approve it',async()=>{
 const bad=structuredClone(draft);bad.claims[0].text='Cole forced the turnover by recovering the ball.';
 const mock=transport([bad,{decision:'approve'}]);
 await assert.rejects(answerMatchQuestionAI(input,{config,fetcher:mock.fetcher}),error=>error.code==='question-unsupported-cause');
 assert.equal(mock.count(),2);
});
test('analyst receives capability limits and reviewer sees the exact cited record',async()=>{
 const mock=transport([draft,{decision:'approve'}],(body,call)=>{
  const packet=JSON.parse(body.messages.at(-1).content);
  if(!call)assert.ok(packet.evidenceCapabilities.unavailable.includes('who forced a mistake or turnover'));
  else {
   const cited=packet.claimChecks[0].cited[0];
   assert.deepEqual(cited.reference,ref);assert.equal(cited.record,undefined);
   const record=[...packet.evidence.queryResults.flatMap(q=>q.rows),...packet.evidence.linkedContext.rows].find(r=>r.id===ref.id);
   assert.equal(record.outcome,'off-target');
   assert.match(packet.reviewConstraints.forcedErrorAttribution,/unavailable/);
  }
 });
 await answerMatchQuestionAI(input,{config,fetcher:mock.fetcher});
});
function transport(values,inspect=()=>{},queries=[{filters:{type:'shot'},aggregate:'list'}]){values=[{queries},...values];let calls=0;return {count:()=>calls,fetcher:async(_url,options)=>{const request=JSON.parse(options.body);if(calls)inspect(request,calls-1);const source=values[calls++],value=typeof source==='function'?source(request):source;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reviewFixture(value,JSON.parse(options.body)))}}],usage:{prompt_tokens:100,completion_tokens:20}})};}};}
test('open fan question produces grounded prose followed by independent editorial review',async()=>{
 const mock=transport([draft,{decision:'approve'}],(body,call)=>{const packet=JSON.parse(body.messages.at(-1).content);if(!call){assert.equal(packet.question,input.question);assert.ok(packet.queryResults.flatMap(q=>q.rows).every(e=>e.arrivedAt<=96&&e.time<=96));assert.ok(packet.queryResults.every(q=>q.scopeReference.type==='scope'));}else assert.equal(packet.answer.claims[0].text,draft.claims[0].text);});
 const answer=await answerMatchQuestionAI(input,{config,fetcher:mock.fetcher});assert.equal(mock.count(),3);assert.equal(answer.provenance.modelGenerated,true);assert.equal(answer.scope,'match');assert.equal(answer.moments[0].anchorId,input.anchorId);assert.match(answer.answer,/technical reason/);assert.deepEqual(answer.execution.usage,{promptTokens:300,completionTokens:60});
});
test('why Cole did not pass reaches the model rather than a predetermined refusal',async()=>{
 const mock=transport([{scope:'match',claims:[{kind:'limitation',text:'The feed cannot tell us what Cole intended; it records his actions rather than his decisions.',evidence:[]}],followUp:'Do you mean his recovery before the shot?'},{decision:'approve'}]);
 const answer=await answerMatchQuestionAI({...input,question:'Why did Cole not pass?'},{config,fetcher:mock.fetcher});assert.equal(mock.count(),3);assert.equal(answer.followUp,'');
});
test('unavailable and stale citations fail before review',async()=>{
 for(const evidence of [[{...ref,revision:2}],[{...ref,id:'future'}],[]]){const bad=structuredClone(draft);bad.claims[0].evidence=evidence;const mock=transport([bad]);await assert.rejects(answerMatchQuestionAI(input,{config,fetcher:mock.fetcher}));assert.equal(mock.count(),2);}
});
test('reviewer withholding prevents supported IDs from laundering unsupported causal prose',async()=>{
 const bad=structuredClone(draft);bad.claims[0].text='Reed missed because he lost concentration.';const mock=transport([bad,{decision:'withhold'}]);await assert.rejects(answerMatchQuestionAI(input,{config,fetcher:mock.fetcher}),/could not support/);assert.equal(mock.count(),3);
});
test('general concepts remain separate from match observations',async()=>{
 const general={scope:'general',claims:[{kind:'general',text:'A high press aims to win the ball close to the opposing goal.',evidence:[]}],followUp:''};const mock=transport([general,{decision:'approve'}]);const answer=await answerMatchQuestionAI({...input,question:'What is a high press?'},{config,fetcher:mock.fetcher});assert.equal(answer.scope,'general');assert.deepEqual(answer.evidence,[]);assert.deepEqual(answer.moments,[]);
 const bad={...draft,scope:'general'};const normalized=await answerMatchQuestionAI(input,{config,fetcher:transport([bad,{decision:'approve'}]).fetcher});assert.equal(normalized.scope,'match');
});
test('follow-up context stays bounded and withdrawals do not generate new explanations',async()=>{
 const mock=transport([draft,{decision:'approve'}],(body,call)=>{if(!call)assert.equal(JSON.parse(body.messages.at(-1).content).previousQuestion,'Who is pushing more?');});await answerMatchQuestionAI({...input,question:'And why?',previousQuestion:'Who is pushing more?'},{config,fetcher:mock.fetcher});
 const never=async()=>{throw new Error('Must not call');};await assert.rejects(answerMatchQuestionAI({...input,previousQuestion:'x'.repeat(401)},{config,fetcher:never}));
 const missing=await answerMatchQuestionAI({...input,time:95},{config,fetcher:never});assert.equal(missing.status,'no-results');
});

test('match prose cannot turn source seconds into impossible match minutes',async()=>{
 const bad=structuredClone(draft);bad.claims[0].text='Reed missed in the 96th minute.';const mock=transport([bad]);await assert.rejects(answerMatchQuestionAI(input,{config,fetcher:mock.fetcher}),/incorrect match time/);assert.equal(mock.count(),2);
});

test('zero-goal answer cites an executed inventory query rather than inventing an event',async()=>{
 const mock=transport([request=>{const packet=JSON.parse(request.messages.at(-1).content),goals=packet.queryResults.find(q=>q.query.filters.result===true);assert.equal(goals.count,0);return {scope:'match',claims:[{text:'Nobody has scored yet; it is 0-0.',kind:'observation',evidence:[goals.scopeReference]}],followUp:''};},{decision:'approve'}]);
 const answer=await answerMatchQuestionAI({...input,question:'Who scored?'},{config,fetcher:mock.fetcher});assert.match(answer.answer,/Nobody/);assert.equal(answer.evidence[0].type,'scope');assert.deepEqual(answer.moments,[]);
});

test('conversation memory is bounded and cannot carry answers from a future replay time',async()=>{
 const never=async()=>{throw new Error('must not call');};
 for(const conversation of [[{question:'Who scored?',answer:'A goal later',time:118}],[{question:'q',answer:'x'.repeat(501),time:10}],Array.from({length:3},()=>({question:'q',answer:'a',time:1}))])await assert.rejects(answerMatchQuestionAI({...input,conversation},{config,fetcher:never}));
});


test('selected response language reaches analyst and reviewer and labels the answer',async()=>{
 const spanish={scope:'match',claims:[{text:'Reed dispara fuera.',kind:'observation',evidence:[ref]}],followUp:''};
 const mock=transport([spanish,{decision:'approve'}],(body,call)=>{
  const packet=JSON.parse(body.messages.at(-1).content);assert.equal(call?packet.evidence.responseLanguage:packet.responseLanguage,'es');
  assert.match(body.messages[0].content,call?/withhold final-score/:/never call it final/);
 });
 const answer=await answerMatchQuestionAI({...input,language:'es',question:'Que paso?'},{config,fetcher:mock.fetcher});
 assert.equal(answer.language,'es');assert.equal(answer.answer,'Reed dispara fuera.');assert.equal(mock.count(),3);
});

test('Spanish and Portuguese minute claims cannot hide a seconds-to-minutes error',async()=>{
 const bad=structuredClone(draft);bad.claims[0].text='Reed fallo a los 96 minutos.';
 await assert.rejects(answerMatchQuestionAI({...input,language:'es'},{config,fetcher:transport([bad]).fetcher}),/incorrect match time/);
});


test('explicit current-moment deixis supplies an anchor and the writer receives its actual evidence',async()=>{
 const requestInput={kind:'sustained',seed:17,time:90,question:'What is happening now?'};let calls=0;
 const fetcher=async(_url,options)=>{const body=JSON.parse(options.body),packet=JSON.parse(body.messages.at(-1).content);let value;
  if(calls===0){assert.equal(packet.players.length,22);assert.ok(packet.players.some(p=>p.id==='home-5'));assert.deepEqual(packet.selectedMoment,{id:'comparison-sustained-17-pass-90',type:'pass',time:90});assert.equal(packet.queryResults,undefined);value={queries:[]};}
  else if(calls===1){const latest=packet.queryResults.find(q=>q.rows.some(r=>r.id===packet.selectedAnchor)).rows.find(r=>r.id===packet.selectedAnchor);assert.equal(latest.type,'pass');assert.ok(packet.queryResults.some(q=>q.query.timeFrom===70&&q.query.limit===8));assert.ok(packet.queryResults.flatMap(q=>q.rows).every(e=>e.time<=90&&e.arrivedAt<=90));value={scope:'match',claims:[{text:'Mensah has played the ball towards Reed.',kind:'observation',evidence:latest.evidence}],followUp:''};}
  else value={decision:'approve'};calls++;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reviewFixture(value,JSON.parse(options.body)))}}]})};
 };
 const answer=await answerMatchQuestionAI(requestInput,{config,fetcher});assert.equal(calls,3);assert.match(answer.answer,/Mensah/);
});


test('aggregate evidence stays compact while complete counts retain a citable scope',async()=>{
 let calls=0;const fetcher=async(_url,options)=>{const body=JSON.parse(options.body),packet=JSON.parse(body.messages.at(-1).content);let value;
  if(calls===0)value={queries:[{filters:{type:'pass',result:true},aggregate:'by-player'}]};
  else if(calls===1){const totals=wireQueries(packet).find(q=>q.query.aggregate==='by-player'&&q.query.filters.type==='pass');assert.deepEqual(totals.rows,[]);assert.ok(totals.count>0);assert.equal(totals.scopeReference.type,'scope');assert.ok(totals.groups.every(g=>g.evidence===undefined));value={scope:'match',claims:[{text:`There have been ${totals.count} completed passes.`,kind:'observation',evidence:[totals.scopeReference]}],followUp:''};}
  else {const totals=packet.evidence.queryResults.find(q=>q.scopeReference.id===packet.answer.claims[0].evidence[0].id);value={decision:'approve',reason:'Mock complete pass inventory',checks:[{claimIndex:0,actors:[],counts:[{text:totals.count+' completed passes',value:totals.count,scopeReference:totals.scopeReference,groupKey:null}],inventedFacts:[],supported:true,reason:'Complete pass count'}]};}calls++;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reviewFixture(value,JSON.parse(options.body)))}}]})};
 };
 const answer=await answerMatchQuestionAI({...input,question:'How many completed passes?'},{config,fetcher});assert.equal(calls,3);assert.equal(answer.evidence[0].type,'scope');
});


test('a historical question follows its retrieved shot and actual buildup rather than the current highlight',async()=>{
 let calls=0;const fetcher=async(_url,options)=>{const body=JSON.parse(options.body),packet=JSON.parse(body.messages.at(-1).content);let value;
  if(calls===0){assert.equal(packet.recentActions,undefined);assert.equal(packet.selectedMoment,undefined);assert.equal(packet.queryResults,undefined);value={queries:[{filters:{type:'shot'},order:'asc',limit:1}]};}
  else if(calls===1){assert.equal(packet.focusAnchor,'comparison-sustained-17-shot-16');const pass=packet.linkedContext.rows.find(e=>e.id==='comparison-sustained-17-pass-10');assert.ok(pass);value={scope:'match',claims:[{text:'Cole supplied Reed before the first shot.',kind:'observation',evidence:pass.evidence}],followUp:''};}
  else value={decision:'approve'};calls++;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reviewFixture(value,JSON.parse(options.body)))}}]})};
 };
 const result=await answerMatchQuestionAI({kind:'sustained',seed:17,time:118,question:'Who set up the first shot?'},{config,fetcher});assert.equal(calls,3);assert.equal(result.moments[0].anchorId,'comparison-sustained-17-pass-10');
});
test('short scope handles restore canonical query references after review',async()=>{
 let canonical;
 const mock=transport([request=>{
  const packet=JSON.parse(request.messages.at(-1).content);
  const goals=packet.queryResults.find(q=>q.query.filters.result===true);
  assert.match(goals.scopeReference.id,/^scope-[a-z0-9-]+-\d+$/);
  assert.equal(goals.scope.reference,undefined,'The scope identity is supplied once.');
  assert.ok(Object.hasOwn(goals.scope,'inventoryCount'));
  assert.ok(Object.hasOwn(goals.scope,'missingFields'));
  return {scope:'match',claims:[{text:'Nobody has scored yet.',kind:'observation',evidence:[goals.scopeReference]}],followUp:''};
 },request=>{
  const packet=JSON.parse(request.messages.at(-1).content);
  assert.match(packet.answer.claims[0].evidence[0].id,/^scope-[a-z0-9-]+-\d+$/);
  return {decision:'approve'};
 }]);
 const answer=await answerMatchQuestionAI({...input,time:0,anchorId:undefined,question:'Who scored?'},{config,fetcher:mock.fetcher});
 canonical=answer.evidence[0];
 assert.match(canonical.id,/^match-query-[a-f0-9]{64}$/);
 assert.deepEqual(answer.claims[0].evidence[0],canonical);
 assert.ok(answer.lookups.some(q=>q.scope.reference.id===canonical.id));
});
test('invented short scope handles still fail evidence validation',async()=>{
 const mock=transport([{scope:'match',claims:[{text:'Nobody has scored.',kind:'observation',evidence:[{type:'scope',id:'scope-999',revision:1}]}],followUp:''}]);
 await assert.rejects(answerMatchQuestionAI(input,{config,fetcher:mock.fetcher}),/unavailable or outdated/);
 assert.equal(mock.count(),2);
});
test('planner filter placement is normalized without changing query meaning',async()=>{
 let call=0;
 const fetcher=async(_url,options)=>{
  const packet=JSON.parse(JSON.parse(options.body).messages.at(-1).content);
  const values=[
   {queries:[{type:'shot',filters:{timeFrom:0,timeTo:118},aggregate:'by-player',groupOrder:'count-desc',limit:1}]},
   null,{decision:'approve'}
  ];
  let value=values[call++];
  if(call===2){
   const result=packet.queryResults.find(q=>q.query.aggregate==='by-player'&&q.query.filters.result===undefined);
   assert.equal(result.query.filters.type,'shot');
   assert.equal(result.query.timeTo,118);assert.equal(result.query.filters.timeTo,undefined);
   value={scope:'match',claims:[{text:'Reed has the most recorded shots.',kind:'observation',evidence:[result.scopeReference]}],followUp:''};
  }
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reviewFixture(value,JSON.parse(options.body)))}}]})};
 };
 const answer=await answerMatchQuestionAI({...input,time:118,question:'Who has the most shots?'},{config,fetcher});
 assert.equal(answer.status,'answered');
});
test('conflicting planner filters fail closed before answer generation',async()=>{
 let calls=0;
 const fetcher=async()=>{calls++;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({queries:[{type:'shot',filters:{type:'pass'}}]})}}]})};};
 await assert.rejects(answerMatchQuestionAI(input,{config,fetcher}),/could not complete/);
 assert.equal(calls,1);
});
test('planner windows are clipped to the question timestamp without exposing future events',async()=>{
 let calls=0;
 const fetcher=async(_url,options)=>{
  const packet=JSON.parse(JSON.parse(options.body).messages.at(-1).content);
  let value;
  if(calls===0)value={queries:[{filters:{type:'pass'},timeFrom:0,timeTo:10,limit:1}]};
  else if(calls===1){
   const passes=packet.queryResults.find(q=>q.query.filters.type==='pass');
   assert.equal(passes.query.timeTo,0);assert.equal(passes.count,0);assert.deepEqual(passes.rows,[]);
   value={scope:'match',claims:[{text:'No pass has been recorded yet.',kind:'observation',evidence:[passes.scopeReference]}],followUp:''};
  }else value={decision:'approve',reason:'Empty clipped pass scope',checks:[{claimIndex:0,actors:[],counts:[{text:'No pass',value:0,groupKey:null,scopeReference:packet.answer.claims[0].evidence[0]}],inventedFacts:[],supported:true,reason:'No received pass'}]};
  calls++;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reviewFixture(value,JSON.parse(options.body)))}}]})};
 };
 const result=await answerMatchQuestionAI({kind:'duel',seed:1001,time:0,question:'Who made the first pass?'},{config,fetcher});
 assert.equal(result.observedAt,0);assert.match(result.answer,/No pass/);
});


test('every answer receives complete recent team counts even if planner omits comparison',async()=>{
 const mock=transport([draft,{decision:'approve'}],(body,call)=>{
  if(call)return;
  const packet=JSON.parse(body.messages.at(-1).content);
  assert.equal(packet.recentComparison.from,'01:06');
  assert.equal(packet.recentComparison.to,'01:36');
  for(const metric of packet.recentComparison.metrics){
   const expected=executeMatchQuery({kind:input.kind,seed:input.seed,time:input.time},{filters:metric.filters,aggregate:'by-team',timeFrom:66,timeTo:96});
   assert.deepEqual(metric.teams,expected.groups.map(g=>({team:g.key,count:g.count})));
   assert.ok(packet.queryResults.some(q=>q.scopeReference.id===metric.evidence[0].id));
  }
 });
 await answerMatchQuestionAI(input,{config,fetcher:mock.fetcher});
});


test('omitted revision resolves only an exact available reference while explicit stale revisions still fail',async()=>{
 const value=structuredClone(draft);delete value.claims[0].evidence[0].revision;
 const result=await answerMatchQuestionAI(input,{config,fetcher:transport([value,{decision:'approve'}]).fetcher});
 assert.equal(result.claims[0].evidence[0].revision,1);
 value.claims[0].evidence[0].id='not-a-received-event';
 await assert.rejects(answerMatchQuestionAI(input,{config,fetcher:transport([value]).fetcher}),/unavailable/);
});

function directTransport(first,review={decision:'approve'},inspect=()=>{}){
 let calls=0;
 return {count:()=>calls,fetcher:async(_url,options)=>{
  const body=JSON.parse(options.body),packet=JSON.parse(body.messages.at(-1).content),call=calls++;assert.equal(body.temperature,0);
  inspect(packet,call,body);
  assert.ok(call<2,'A directly supported answer must not make a third model call.');
  const source=call===0?first:review,value=typeof source==='function'?source(packet):source;
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reviewFixture(value,JSON.parse(options.body)))}}],usage:{prompt_tokens:100,completion_tokens:20}})};
 }};
}

test('retrieved player assessment keeps complete contributions grounded through answer and review',async()=>{
 let chosen,scopeId;
 const mock=transport([request=>{
  const packet=JSON.parse(request.messages.at(-1).content);
  assert.equal(packet.roster.length,22);
  assert.equal(packet.requestedEvidence[0].query.aggregate,'by-player');
  assert.equal(packet.playerContributions.from,'00:00');
  assert.equal(packet.playerContributions.to,'01:36');
  assert.deepEqual(packet.playerContributions.metrics.map(m=>m.name),['goals','shots','shotsOnTarget','creditedAssists','completedPasses','recoveries','savedAttemptCollections']);
  for(const metric of packet.playerContributions.metrics)for(const evidence of metric.evidence){
   const query=wireQueries(packet).find(q=>q.scopeReference.id===evidence.id);
   assert.ok(query);assert.equal(query.truncated,false);
   const actual=executeMatchQuery({kind:input.kind,seed:input.seed,time:input.time},query.query);
   assert.deepEqual(query.groups.map(({key,count})=>({key,count})),actual.groups.map(({key,count})=>({key,count})));
   assert.equal(query.count,actual.count);
  }
  const metric=packet.playerContributions.metrics.find(m=>m.name==='shots');
  const shots=wireQueries(packet).find(q=>q.scopeReference.id===metric.evidence[0].id);
  chosen=shots.groups[0];scopeId=shots.scopeReference.id;
  const rows=[...packet.queryResults.flatMap(q=>q.rows),...packet.linkedContext.rows];
  assert.equal(rows.length,new Set(rows.map(r=>`${r.id}@${r.revision}`)).size);
  assert.ok(rows.every(r=>r.time<=input.time&&r.arrivedAt<=input.time));
  return {scope:'match',claims:[{kind:'interpretation',text:`My provisional pick so far is ${chosen.label}, with ${chosen.count} recorded shots.`,evidence:[shots.scopeReference]}],followUp:''};
 },request=>{
  const packet=JSON.parse(request.messages.at(-1).content);
  assert.equal(packet.answer.claims[0].evidence[0].id,scopeId);
  assert.equal(packet.claimChecks[0].cited[0].reference.id,scopeId);
  assert.equal(packet.evidence.queryResults.find(q=>q.scopeReference.id===scopeId).groups.find(g=>g.key===chosen.key).count,chosen.count);
  return {decision:'approve',reason:'Verified complete shot total',checks:[{claimIndex:0,actors:[],counts:[{text:chosen.count+' recorded shots',value:chosen.count,scopeReference:packet.answer.claims[0].evidence[0],groupKey:chosen.key}],inventedFacts:[],supported:true,reason:'Verified complete shot total'}]};
 }],undefined,[{filters:{type:'shot'},aggregate:'by-player'}]);
 const result=await answerMatchQuestionAI({...input,question:'Who is your man of the match so far?'},{config,fetcher:mock.fetcher});
 assert.equal(mock.count(),3);assert.equal(result.execution.modelCalls,3);
 assert.deepEqual(result.execution.usage,{promptTokens:300,completionTokens:60});
 assert.deepEqual(result.execution.stages.map(s=>s.stage),['answer-or-query','answer-after-query','review']);
 assert.match(result.evidence[0].id,/^match-query-[a-f0-9]{64}$/);
 assert.ok(result.lookups.some(q=>q.scope.reference.id===result.evidence[0].id));
});

test('answer profile keeps zero outcomes, explicit assist coverage and corrected shot outcomes grounded',async()=>{
 const targetCounts=[];
 for(const time of [96,98]){
  const mock=transport([request=>{
  const packet=JSON.parse(request.messages.at(-1).content);
   const metric=name=>wireQueries(packet).find(q=>q.scopeReference.id===packet.playerContributions.metrics.find(m=>m.name===name).evidence[0].id);
   const goals=metric('goals'),assists=metric('creditedAssists');
   assert.equal(goals.count,0);assert.equal(assists.query.aggregate,'by-assister');
   assert.ok(Object.hasOwn(assists.scope.missingFields,'assistPlayer'));
   targetCounts.push(metric('shotsOnTarget').count);
   return {scope:'match',claims:[{text:'Nobody has scored yet.',kind:'observation',evidence:[goals.scopeReference]}],followUp:''};
  },{decision:'approve'}],undefined,[{filters:{type:'shot',result:true},aggregate:'by-player'}]);
  const result=await answerMatchQuestionAI({...input,time,anchorId:undefined,question:'Who has scored?'},{config,fetcher:mock.fetcher});
  assert.equal(result.execution.modelCalls,3);
 }
 assert.equal(targetCounts[1],targetCounts[0]+1,'The received correction changes the on-target profile.');
});

test('direct answer retains language and bounded conversation while general knowledge needs no lookup',async()=>{
 const mock=directTransport(packet=>{
  assert.equal(packet.responseLanguage,'es');
  assert.deepEqual(packet.conversation,[{question:'What is a press?',answer:'A way to challenge possession.',time:90}]);
  return {draft:{scope:'general',claims:[{kind:'general',text:'Presionar es intentar recuperar el balon.',evidence:[]}],followUp:''}};
 },{decision:'approve'},(packet,call)=>{if(call)assert.equal(packet.evidence.responseLanguage,'es');});
 const result=await answerMatchQuestionAI({...input,language:'es',question:'Explain that simply in Spanish.',conversation:[{question:'What is a press?',answer:'A way to challenge possession.',time:90}]},{config,fetcher:mock.fetcher});
 assert.equal(result.scope,'general');assert.deepEqual(result.evidence,[]);assert.equal(mock.count(),2);
});

test('initial planning view contains intent context but no match event or aggregate evidence',async()=>{
 const definition={scope:'general',claims:[{text:'A low block defends deep in a compact shape.',kind:'general',evidence:[]}],followUp:''};
 let planning;
 const mock=directTransport(packet=>{
  planning=packet;
  for(const field of ['playerContributions','recentComparison','assessmentDimensions','namedPlayerActions','linkedContext','shotTimeline','requestedEvidence','queryResults','score','pendingOutcomeContext','recentActions','selectedMoment','selectedAnchor','evidenceCapabilities'])assert.equal(Object.hasOwn(packet,field),false,field);
  assert.equal(packet.players.length,22);assert.equal(packet.currentTime,116);
  return {mentionedPlayers:[],draft:definition,queries:[]};
 },{decision:'approve'},(_packet,call,body)=>{
  if(call===0){assert.match(body.messages[0].content,/chronology require complete typed-query evidence/);assert.match(body.messages[0].content,/zero to three queries/);}
 });
 const answer=await answerMatchQuestionAI({kind:'counter',seed:8341,time:116,question:'What is a low block?'},{config,fetcher:mock.fetcher});
 assert.equal(answer.execution.modelCalls,2);assert.equal(answer.scope,'general');assert.deepEqual(planning.allowedOperations,{});
});

test('a carried UI anchor cannot contaminate unrelated team, assessment or historical planning',async()=>{
 for(const questionText of ['What is the passing accuracy for each side?','Who has been the standout so far, and why?','Compare the first and latest shots.']){
  const question={kind:'counter',seed:8341,time:118,anchorId:'comparison-counter-8341-shot-116',question:questionText};let packet;
  const mock=directTransport({unexpected:'invalid-planning-envelope'},{},(data,call)=>{if(!call)packet=data;});
  await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}));assert.equal(mock.count(),1);
  for(const field of ['selectedMoment','selectedAnchor','recentActions','queryResults','score','pendingOutcomeContext'])assert.equal(Object.hasOwn(packet,field),false,field);
  assert.equal(JSON.stringify(packet).includes(question.anchorId),false);
 }
 const question={kind:'counter',seed:8341,time:118,anchorId:'comparison-counter-8341-shot-116',question:'Did that shot count? What is the score now?'};let packet;
 const mock=directTransport({unexpected:'invalid-planning-envelope'},{},(data,call)=>{if(!call)packet=data;});
 await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}));
 assert.deepEqual(packet.selectedMoment,{id:question.anchorId,type:'shot',time:116});
 assert.equal(packet.queryResults,undefined);assert.equal(packet.score,undefined);assert.equal(packet.selectedMoment.player,undefined);assert.equal(packet.selectedMoment.outcome,undefined);
});

test('requested team comparison separates whole count from grouped totals through review',async()=>{
 const comparisonInput={kind:'sustained',seed:8341,time:110,question:'Which side has completed more passes so far, and by how many?'};
 const query={filters:{type:'pass',result:true},aggregate:'by-team',timeFrom:0,timeTo:110};
 let actualEvidence;
 const mock=transport([request=>{
  const packet=JSON.parse(request.messages.at(-1).content),selected=packet.requestedEvidence[0];actualEvidence=selected;
  assert.equal(packet.requestedEvidence.length,1);assert.equal(selected.count,9);
  assert.deepEqual(Object.fromEntries(selected.groups.map(g=>[g.key,g.count])),{home:5,away:4});
  assert.deepEqual(selected.groups,executeMatchQuery({kind:comparisonInput.kind,seed:comparisonInput.seed,time:comparisonInput.time},query).groups.map(({key,label,count})=>({key,label,count})));
  assert.ok(!packet.queryResults.some(q=>q.scopeReference.id===selected.scopeReference.id),'Requested scope is supplied intact once, not duplicated');
  assert.match(request.messages[0].content,/NEVER attribute that whole count to one team or player/);
  return {scope:'match',claims:[{text:'Northbridge completed five passes and Harbour Athletic completed four passes, so Northbridge has one more.',kind:'observation',evidence:[selected.scopeReference]}],followUp:''};
 },request=>{
  const packet=JSON.parse(request.messages.at(-1).content),evidence=packet.answer.claims[0].evidence[0];
  assert.deepEqual(packet.evidence.queryResults.find(q=>q.scopeReference.id===evidence.id).groups,actualEvidence.groups);
  return {decision:'approve',reason:'The group counts support the comparison and margin.',checks:[{claimIndex:0,actors:[],inventedFacts:[],supported:true,reason:'Both team totals match the complete query.',counts:[{text:'five passes',value:5,scopeReference:evidence,groupKey:'home'},{text:'four passes',value:4,scopeReference:evidence,groupKey:'away'}]}]};
 }],undefined,[query]);
 const answer=await answerMatchQuestionAI(comparisonInput,{config,fetcher:mock.fetcher});
 assert.equal(answer.execution.modelCalls,3);assert.match(answer.answer,/one more/);
});

test('requested first and latest shots keep separate ordered rows and a complete validation timeline',async()=>{
 const chronologicalInput={kind:'interrupted',seed:8341,time:100,question:'How did the first shot turn out compared with the most recent one?'};
 const queries=['asc','desc'].map(order=>({filters:{type:'shot'},aggregate:'list',order,limit:1,timeFrom:0,timeTo:100}));
 const mock=transport([request=>{
  const packet=JSON.parse(request.messages.at(-1).content),[first,last]=packet.requestedEvidence;
  assert.equal(packet.requestedEvidence.length,2);
  for(const [i,result] of packet.requestedEvidence.entries()){
   const actual=executeMatchQuery({kind:chronologicalInput.kind,seed:chronologicalInput.seed,time:chronologicalInput.time},queries[i]);
   assert.deepEqual(result.rows.map(r=>[r.id,r.revision,r.playerId,r.outcome]),actual.rows.map(r=>[r.id,r.revision,r.playerId,r.outcome]));
   assert.equal(result.count,4);assert.equal(result.query.limit,1);
  }
  assert.equal(first.rows[0].playerId,'home-10');assert.equal(first.rows[0].outcome,'saved');
  assert.equal(last.rows[0].playerId,'away-10');assert.equal(last.rows[0].outcome,'blocked');
  const timeline=packet.shotTimeline;
  assert.equal(timeline.count,4);assert.equal(timeline.rows.length,4);assert.equal(timeline.truncated,false);
  assert.equal(timeline.query.timeFrom,0);assert.equal(timeline.query.timeTo,100);
  assert.deepEqual(timeline.rows.map(r=>r.time),[64,74,84,98]);
  const claims=[{text:'The first shot was A. Reed’s saved attempt.',kind:'observation',evidence:[first.scopeReference,...first.rows[0].evidence]},
   {text:'The latest shot was D. Silva’s blocked attempt.',kind:'observation',evidence:[last.scopeReference,...last.rows[0].evidence]}];
  return {scope:'match',claims,followUp:''};
 },{decision:'approve'}],undefined,queries);
 const answer=await answerMatchQuestionAI(chronologicalInput,{config,fetcher:mock.fetcher});
 assert.equal(answer.execution.modelCalls,3);assert.match(answer.answer,/Reed.*saved/);assert.match(answer.answer,/Silva.*blocked/);
});

test('direct drafts cannot bypass citation, causality, clock or reviewer checks',async()=>{
 const invalid=[
  {change:d=>{d.claims[0].evidence=[{...ref,revision:2}];},message:/unavailable or outdated/},
  {change:d=>{d.claims[0].evidence=[{type:'scope',id:'scope-999',revision:1}];},message:/unavailable or outdated/},
  {change:d=>{d.claims[0].evidence=[];},message:/could not verify/},
  {change:d=>{d.claims[0].text='Cole forced the turnover.';},message:/does not establish/},
  {change:d=>{d.claims[0].text='Reed missed in the 96th minute.';},message:/incorrect match time/}
 ];
 for(const {change,message} of invalid){
  const bad=structuredClone(draft);change(bad);
  const mock=directTransport({draft:bad});
  await assert.rejects(answerMatchQuestionAI(input,{config,fetcher:mock.fetcher}),message);
  assert.equal(mock.count(),1);
 }
 const mock=directTransport({draft},{decision:'withhold'});
 await assert.rejects(answerMatchQuestionAI(input,{config,fetcher:mock.fetcher}),/could not support/);
 assert.equal(mock.count(),2);
});

test('malformed first-turn protocols and excessive lookups fail even beside a provisional draft',async()=>{
 for(const first of [{draft,queries:Array.from({length:4},()=>({aggregate:'count'}))},{draft,queries:[{filters:{unknown:'field'}}]},{queries:Array.from({length:4},()=>({aggregate:'count'}))},{draft:null},{queries:'all'}]){
  const mock=directTransport(first);
  await assert.rejects(answerMatchQuestionAI(input,{config,fetcher:mock.fetcher}));
  assert.equal(mock.count(),1);
 }
});

test('mixed provisional pass draft is discarded and paired team queries ground a complete comparison',async()=>{
 const comparisonInput={kind:'sustained',seed:8341,time:110,question:'Which side has completed more passes so far, and by how many?'};
 const provisional={scope:'match',claims:[{text:'The home team has completed 1 pass so far.',kind:'observation',evidence:[{type:'event',id:'comparison-sustained-8341-pass-102',revision:2}]},
  {text:'The away team has completed 0 passes so far.',kind:'observation',evidence:[]}],followUp:''};
 const queries=['home','away'].map(team=>({filters:{type:'pass',team,result:true,outcome:null},aggregate:'count',timeFrom:0,timeTo:110,order:null,limit:null}));
 let calls=0;
 const fetcher=async(_url,options)=>{
  const body=JSON.parse(options.body),packet=JSON.parse(body.messages.at(-1).content);let value;
  if(calls===0)value={mentionedPlayers:[],draft:provisional,queries};
  else if(calls===1){
   assert.equal(body.response_format.json_schema.name,'match_answer');
   assert.equal(packet.rejectedAnswer,undefined);assert.equal(packet.feedback,undefined);
   assert.ok(!JSON.stringify(packet).includes(provisional.claims[0].text),'Provisional prose must not become grounding evidence');
   const [combined,home,away]=packet.requestedEvidence;
   assert.equal(packet.requestedEvidence.length,3);assert.equal(combined.query.aggregate,'by-team');assert.equal(combined.count,9);
   assert.deepEqual(combined.groups.map(g=>[g.key,g.count]),[['home',5],['away',4]]);
   assert.equal(home.query.filters.team,'home');assert.equal(home.count,5);assert.equal(away.query.filters.team,'away');assert.equal(away.count,4);
   assert.equal(home.query.aggregate,'count');assert.equal(away.query.aggregate,'count');
   assert.equal(combined.query.timeFrom,0);assert.equal(combined.query.timeTo,110);assert.equal(combined.truncated,false);
   assert.ok(!packet.queryResults.some(q=>q.scopeReference.id===combined.scopeReference.id),'Combined proof is retained in requestedEvidence');
   const actual=executeMatchQuery({kind:'sustained',seed:8341,time:110},{filters:{type:'pass',result:true},aggregate:'by-team'});
   assert.deepEqual(combined.groups,actual.groups.map(({key,label,count})=>({key,label,count})));
   value={scope:'match',claims:[{text:'Northbridge has 5 completed passes, Harbour Athletic has 4 completed passes, so Northbridge leads by 1 completed pass.',kind:'observation',evidence:[combined.scopeReference]}],followUp:''};
  }else{
   assert.equal(calls,2);assert.notDeepEqual(packet.answer,provisional);
   const scopeReference=packet.answer.claims[0].evidence[0];
   value={decision:'approve',reason:'Complete team groups establish both totals and the margin.',checks:[{claimIndex:0,actors:[],inventedFacts:[],supported:true,reason:'Five minus four is one.',counts:[
    {text:'5 completed passes',value:5,groupKey:'home',scopeReference},{text:'4 completed passes',value:4,groupKey:'away',scopeReference},{text:'1 completed pass',value:1,groupKey:'home',scopeReference}]}]};
  }
  calls++;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reviewFixture(value,body))}}]})};
 };
 const answer=await answerMatchQuestionAI(comparisonInput,{config,fetcher});
 assert.equal(calls,3);assert.equal(answer.execution.repairs,0);assert.match(answer.answer,/leads by 1 completed pass/);
 assert.deepEqual(answer.execution.stages.map(s=>s.stage),['answer-or-query','answer-after-query','review']);
 assert.ok(answer.lookups.some(q=>q.query.aggregate==='by-team'&&q.query.timeFrom===0&&q.query.filters.type==='pass'&&q.query.filters.result===true));
});

test('team comparison derivation never joins mismatched metric windows or duplicate teams',async()=>{
 const base=['home','away'].map(team=>({filters:{type:'pass',team,result:true},aggregate:'count',timeFrom:0,timeTo:110}));
 for(const change of [queries=>queries[1].timeFrom=90,queries=>queries[1].filters.result=false,queries=>queries[1].filters.team='home',queries=>queries[1].aggregate='by-player',queries=>queries[1].filters.player='away-7']){
  const queries=structuredClone(base);change(queries);
  const mock=transport([request=>{
   const packet=JSON.parse(request.messages.at(-1).content);
   assert.equal(packet.requestedEvidence.length,2);assert.ok(packet.requestedEvidence.every(q=>q.query.aggregate!=='by-team'));
   return {scope:'match',claims:[{text:'These selected queries do not establish a complete comparison between both teams.',kind:'limitation',evidence:[]}],followUp:''};
  },{decision:'approve'}],undefined,queries);
  const answer=await answerMatchQuestionAI({kind:'sustained',seed:8341,time:110,question:'Can these counts establish a comparison between both teams?'},{config,fetcher:mock.fetcher});
  assert.equal(answer.execution.modelCalls,3);
 }
});

test('provider schema prevents plain-text drafts and preserves independent cited-answer review',async()=>{
 const mock=directTransport({draft,queries:[]},{decision:'approve'},(_packet,call,body)=>{
  const format=body.response_format;assert.equal(format.type,'json_schema');assert.equal(format.json_schema.strict,true);
  const schema=format.json_schema.schema;
  if(!call){assert.deepEqual(schema.required,['answerFocus','explanationTarget','requestedForm','mentionedPlayers','decision']);assert.equal(schema.properties.mentionedPlayers.maxItems,3);assert.equal(schema.properties.draft,undefined);assert.equal(schema.properties.decision.anyOf.length,1);assert.equal(decisionBranch(body,'operation'),undefined);assert.deepEqual(decisionBranch(body,'queries').required,['kind','queries']);assert.equal(decisionBranch(body,'queries').properties.queries.maxItems,3);assert.equal(decisionBranch(body,'general'),undefined);assert.equal(schema.additionalProperties,false);}
  else assert.deepEqual(schema.required,['requestCheck','checks','reason','decision','numericBindingMode']);
 });
 const result=await answerMatchQuestionAI(input,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,2);assert.deepEqual(result.claims,draft.claims);
 for(const invalid of [{draft:'An uncited plain-text answer',queries:[]},{draft:[draft.claims[0]],queries:[]}]){
  const bad=directTransport(invalid);await assert.rejects(answerMatchQuestionAI(input,{config,fetcher:bad.fetcher}));assert.equal(bad.count(),1);
 }
});

test('pending attempts stay explicit and do not become categorical no-goal verdicts',async()=>{
 const pendingInput={kind:'counter',seed:2969,time:116,question:'Should I celebrate yet?'};
 const first=request=>{
  const packet=JSON.parse(request.messages.at(-1).content);
  assert.equal(packet.pendingOutcomeContext.count,1);assert.equal(packet.pendingOutcomeContext.attempts[0].player,'A. Reed');
  assert.equal(packet.pendingOutcomeContext.attempts[0].time,'01:56');
  const goals=packet.queryResults.find(q=>q.query.filters.type==='shot'&&q.query.filters.result===true);
  return {scope:'match',claims:[{text:'No team has scored yet.',kind:'observation',evidence:[goals.scopeReference]}],followUp:''};
 };
 const queries=[{filters:{type:'shot',result:true},aggregate:'by-player'}];
 const mock=transport([first],undefined,queries);
 await assert.rejects(answerMatchQuestionAI(pendingInput,{config,fetcher:mock.fetcher}),error=>error.code==='question-withheld'&&/unresolved attempt/.test(error.message));assert.equal(mock.count(),2);
 const supported=transport([request=>{
  const packet=JSON.parse(request.messages.at(-1).content);
  const goals=packet.queryResults.find(q=>q.query.filters.type==='shot'&&q.query.filters.result===true);
  return {scope:'match',claims:[{text:'The confirmed score is 0-0. Reed’s latest shot is awaiting confirmation.',kind:'observation',evidence:[goals.scopeReference,...packet.pendingOutcomeContext.attempts[0].evidence]}],followUp:''};
 },{decision:'approve'}],undefined,queries);
 const result=await answerMatchQuestionAI(pendingInput,{config,fetcher:supported.fetcher});assert.match(result.answer,/awaiting confirmation/);
});

test('arbitrary absent player references cannot become participants with zero actions',async()=>{
 for(const name of ['Messi','Zoran Velic','Ada Okoro']){
  const bad={scope:'match',claims:[{text:`${name} has no goals.`,kind:'observation',evidence:[ref]}],followUp:''};
  const mock=directTransport({mentionedPlayers:[name],draft:bad,queries:[]});
  const answer=await answerMatchQuestionAI({...input,question:`Has ${name} scored?`},{config,fetcher:mock.fetcher});
  assert.equal(answer.answer,`${name} is not in this match’s lineup.`);assert.doesNotMatch(answer.answer,/goals|scored|zero/);
  assert.equal(answer.status,'limited');assert.equal(answer.scope,'clarify');assert.equal(answer.provenance.modelGenerated,false);assert.equal(answer.provenance.aiInterpreted,true);
  assert.equal(answer.provenance.source,'verified-lineup-resolution');assert.deepEqual(answer.moments,[]);assert.equal(mock.count(),1);
  assert.equal(mock.count(),1,'Unresolved participant claims fail before model review');
 }
});

test('resolved names are carried to independent review without an extra model call',async()=>{
 const mock=directTransport({mentionedPlayers:['Reed'],draft,queries:[]},{decision:'approve'},(packet,call)=>{
  if(call){assert.equal(packet.evidence.mentionedPlayerResolution[0].status,'resolved');assert.equal(packet.evidence.mentionedPlayerResolution[0].canonicalId,'home-10');}
 });
 const result=await answerMatchQuestionAI(input,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,2);
});

test('mixed resolved and absent names cannot hide behind shortened names or pronouns',async()=>{
 for(const text of ['Lionel has no goals.','Messi has no goals.','He has no goals.']){
  const mock=directTransport({mentionedPlayers:['Lionel Messi','Reed'],draft:{scope:'match',claims:[{text,kind:'observation',evidence:[ref]}],followUp:''},queries:[]});
  await assert.rejects(answerMatchQuestionAI({...input,question:'Has Lionel Messi scored? Reed is playing.'},{config,fetcher:mock.fetcher}),error=>error.code==='question-withheld');
  assert.equal(mock.count(),1);
 }
});

test('verified roster absence can be stated directly and control characters fail cleanly',async()=>{
 const correction={scope:'match',claims:[{text:'Messi is not listed as a player for Northbridge in this match.',kind:'observation',evidence:[ref]}],followUp:''};
 const mock=directTransport({mentionedPlayers:['Messi'],draft:correction,queries:[]});
 const result=await answerMatchQuestionAI({...input,question:'Has Messi scored?'},{config,fetcher:mock.fetcher});assert.match(result.answer,/not listed/);assert.equal(mock.count(),2);
 const invalid=directTransport({mentionedPlayers:['Reed\u0000'],draft,queries:[]});
 await assert.rejects(answerMatchQuestionAI(input,{config,fetcher:invalid.fetcher}),error=>error.constructor.name==='GenerationError'&&/player references/.test(error.message));
 assert.equal(invalid.count(),1);
});

test('verified unresolved-only correction needs no model rewrite and retains canonical resolution evidence',async()=>{
 const bad={scope:'match',claims:[{text:'Messi has no goals.',kind:'observation',evidence:[ref]}],followUp:''};
 const mock=directTransport({mentionedPlayers:['Messi'],draft:bad,queries:[]});
 const result=await answerMatchQuestionAI({...input,question:'Has Messi scored?'},{config,fetcher:mock.fetcher,canRepair:()=>{throw new Error('No model repair allowance is needed');}});
 assert.equal(mock.count(),1);assert.equal(result.claims.length,1);assert.equal(result.answer,'Messi is not in this match’s lineup.');
 assert.equal(result.execution.repairMode,'verified-lineup-resolution');assert.equal(result.execution.modelCalls,1);assert.equal(result.provenance.modelGenerated,false);
 assert.equal(result.evidence[0].type,'scope');assert.match(result.evidence[0].id,/^match-query-/);
 const query=result.lookups.find(q=>q.scope.reference.id===result.evidence[0].id);
 assert.equal(query.query.filters.player,'Messi');assert.equal(query.scope.entityResolution.player.status,'absent');assert.deepEqual(result.moments,[]);
});

test('uncited absent-player draft retains citation failure and typed roster resolution before repair',async()=>{
 const bad={scope:'match',claims:[{text:'There are no recorded goals scored by Messi for Northbridge in the available match data.',kind:'observation',evidence:[]}],followUp:''};
 const corrected={scope:'clarify',claims:[{text:'Messi is not on the Northbridge roster for this match.',kind:'limitation',evidence:[]},{text:'An assist credits the player who sets up a goal.',kind:'general',evidence:[]}],followUp:''};
 let calls=0;
 const fetcher=async(_url,options)=>{
  const body=JSON.parse(options.body),packet=JSON.parse(body.messages.at(-1).content);
  if(calls===1){
   assert.deepEqual(packet.rejectedAnswer,bad);assert.match(packet.feedback.reason,/could not verify/);
   assert.equal(packet.feedback.rosterResolution.length,1);assert.equal(packet.feedback.rosterResolution[0].input,'Messi');assert.equal(packet.feedback.rosterResolution[0].status,'absent');
   assert.deepEqual(packet.feedback.rosterResolution,packet.evidence.mentionedPlayerResolution);
   assert.equal(body.response_format.json_schema.schema.properties.claims.maxItems,4);
  }
  if(calls===2){assert.equal(packet.answer.claims[0].text,corrected.claims[0].text);assert.equal(packet.evidence.mentionedPlayerResolution[0].status,'absent');}
  const values=[{mentionedPlayers:['Messi'],draft:bad,queries:[]},corrected,{decision:'approve',requestCheck:{requestedInformation:'Messi goals and assist definition',status:'corrected-premise',reason:'Both requested components are addressed.',coverage:[{requestSpan:'How many goals did Messi score for Northbridge',answerSpan:corrected.claims[0].text},{requestSpan:'What is an assist',answerSpan:corrected.claims[1].text}]}}];
  const value=reviewFixture(values[calls++],body);return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]})};
 };
 const answer=await answerMatchQuestionAI({kind:'quiet',seed:2969,time:120,question:'How many goals did Messi score for Northbridge? What is an assist?'},{config,fetcher,canRepair:()=>true});
 assert.equal(calls,3);assert.equal(answer.execution.repairs,1);assert.equal(answer.answer,corrected.claims.map(c=>c.text).join(' '));
 assert.deepEqual(answer.execution.stages.map(stage=>stage.stage),['answer-or-query','repair','review']);
});

test('actual uncited absent-name failure becomes an accurately labelled lineup clarification',async()=>{
 const bad={scope:'match',claims:[{text:'There are no recorded goals scored by Messi for Northbridge in the available match data.',kind:'observation',evidence:[]}],followUp:''};
 const mock=directTransport({mentionedPlayers:['Messi'],draft:bad,queries:[]});
 const answer=await answerMatchQuestionAI({kind:'quiet',seed:2969,time:120,question:'How many goals did Messi score for Northbridge?'},{config,fetcher:mock.fetcher});
 assert.equal(mock.count(),1);assert.equal(answer.status,'limited');assert.equal(answer.scope,'clarify');
 assert.equal(answer.answer,'Messi is not in this match’s lineup.');assert.equal(answer.provenance.modelGenerated,false);assert.equal(answer.provenance.aiInterpreted,true);
 assert.equal(answer.execution.repairMode,'verified-lineup-resolution');assert.deepEqual(answer.execution.stages.map(stage=>stage.stage),['answer-or-query']);
 assert.deepEqual(answer.moments,[]);assert.equal(answer.totalMoments,0);assert.doesNotMatch(answer.answer,/goals|score|zero/);
});

test('lineup ambiguity uses received candidates and cannot adopt a model-invented name',async()=>{
 for(const [language,expected] of [['en',/Which Costa/],['es',/qué Costa/],['fr',/quel Costa/],['pt',/qual Costa/]]){
  const bad={scope:'match',claims:[{text:'Costa has scored.',kind:'observation',evidence:[]}],followUp:''};
  const mock=directTransport({mentionedPlayers:['Costa'],draft:bad,queries:[]});
  const answer=await answerMatchQuestionAI({...input,question:'Has Costa scored?',language},{config,fetcher:mock.fetcher});
  assert.match(answer.answer,expected);assert.match(answer.answer,/E\. Costa \(Northbridge\)/);assert.match(answer.answer,/M\. Costa \(Harbour Athletic\)/);
  assert.equal(answer.provenance.modelGenerated,false);assert.equal(mock.count(),1);
 }
 const invented=directTransport({mentionedPlayers:['Messi'],draft:{scope:'match',claims:[{text:'Messi has scored.',kind:'observation',evidence:[]}],followUp:''},queries:[]});
 await assert.rejects(answerMatchQuestionAI({...input,question:'Has Reed scored?'},{config,fetcher:invented.fetcher}),/could not verify/);
 assert.equal(invented.count(),1);
});

test('one-component chronology repair can preserve both requested endpoints in separate claims',async()=>{
 const question='How did the first shot turn out compared with the most recent one?';
 assert.equal(requestComponents(question).length,1);
 const bad={scope:'match',claims:[{text:'The first shot in the match was taken by D. Silva at 98 seconds and was blocked.',kind:'observation',evidence:[{type:'event',id:'comparison-interrupted-8341-shot-98',revision:1}]}],followUp:''};
 let calls=0;
 const fetcher=async(_url,options)=>{
  const body=JSON.parse(options.body),packet=JSON.parse(body.messages.at(-1).content);let value;
  if(calls===0)value={mentionedPlayers:[],draft:bad,queries:[]};
  else if(calls===1){
   assert.equal(body.response_format.json_schema.schema.properties.claims.maxItems,3);
   assert.match(body.messages[0].content,/Do not put required information only in the internal premiseCheck/);
   assert.deepEqual(packet.rejectedAnswer,bad);
   const [first,...remaining]=packet.evidence.shotTimeline.rows,last=remaining.at(-1);
   assert.equal(first.time,64);assert.equal(last.time,98);
   value={scope:'match',claims:[{text:'The first shot was A. Reed’s saved attempt at 01:04.',kind:'observation',evidence:first.evidence},{text:'The latest shot was D. Silva’s blocked attempt at 01:38.',kind:'observation',evidence:last.evidence}],followUp:''};
  }else{assert.equal(calls,2);assert.equal(packet.answer.claims.length,2);value={decision:'approve'};}
  calls++;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reviewFixture(value,body))}}]})};
 };
 const answer=await answerMatchQuestionAI({kind:'interrupted',seed:8341,time:100,question},{config,fetcher,canRepair:()=>true});
 assert.equal(calls,3);assert.equal(answer.execution.repairs,1);assert.equal(answer.claims.length,2);
 assert.match(answer.answer,/first.*Reed.*saved/);assert.match(answer.answer,/latest.*Silva.*blocked/);assert.equal(answer.provenance.modelGenerated,true);
});

test('equivalent bare first-turn answer is validated and reviewed without an extra call',async()=>{
 const mock=directTransport(draft,{decision:'approve'},(_packet,call,body)=>{
  if(!call){assert.match(body.messages[0].content,/Plan evidence only/);assert.doesNotMatch(body.messages[0].content,/Fill this INTERNAL field before writing claims/);}
 });
 const result=await answerMatchQuestionAI(input,{config,fetcher:mock.fetcher});
 assert.equal(result.execution.modelCalls,2);assert.deepEqual(result.claims,draft.claims);
 for(const first of [{...draft,queries:[]},{...draft,claims:[{...draft.claims[0],evidence:[{...ref,revision:99}]}]}]){
  const bad=directTransport(first);
  await assert.rejects(answerMatchQuestionAI(input,{config,fetcher:bad.fetcher}));assert.equal(bad.count(),1);
 }
});

test('structured lookup ignores unused null fields without treating result null as a pending-shot filter',async()=>{
 let calls=0,lookupPacket;
 const fetcher=async(_url,options)=>{
  const body=JSON.parse(options.body),packet=JSON.parse(body.messages.at(-1).content);let value;
  if(calls===0){
   const schema=decisionBranch(body,'queries').properties.queries.items.anyOf[0];
   const query=Object.fromEntries(Object.keys(schema.properties).map(key=>[key,null]));
   query.filters=Object.fromEntries(Object.keys(schema.properties.filters.anyOf[0].properties).map(key=>[key,null]));
   query.filters.type='shot';query.aggregate='list';
   value={draft:null,queries:[query]};
  }else if(calls===1){
   lookupPacket=packet;value=draft;
  }else value={decision:'approve',reason:'Supported by received events.'};
  calls++;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reviewFixture(value,JSON.parse(options.body)))}}]})};
 };
 const result=await answerMatchQuestionAI(input,{config,fetcher});
 const shots=wireQueries(lookupPacket).find(q=>q.query.aggregate==='list'&&q.query.filters.type==='shot'&&Object.keys(q.query.filters).length===1);
 assert.ok(shots.count>0);assert.equal(Object.hasOwn(shots.query.filters,'result'),false);
 assert.ok(shots.rows.some(row=>row.result!==null));
 assert.equal(calls,3);assert.equal(result.status,'answered');
});

test('compact review keeps all comparison evidence and source facts without copying records into each claim',async()=>{
 let firstEvidence;
 const mock=transport([request=>{
  const packet=JSON.parse(request.messages.at(-1).content);
  firstEvidence=packet;
  return draft;
 },request=>{
  const packet=JSON.parse(request.messages.at(-1).content);
  assert.ok(packet.evidence.queryResults.length<firstEvidence.queryResults.length);
  assert.match(packet.evidence.sourceFingerprint,/^[a-f0-9]{64}$/);
  assert.ok(packet.evidence.queryResults.every(q=>packet.answer.claims.some(c=>c.evidence.some(r=>r.id===q.scopeReference.id))));
  for(const query of packet.evidence.queryResults){
   const original=executeMatchQuery({kind:input.kind,seed:input.seed,time:input.time},query.query);
   assert.equal(query.scope.inventoryCount,original.scope.inventoryCount);
   assert.deepEqual(query.scope.missingFields,original.scope.missingFields);
   assert.equal(query.count,original.count);assert.equal(query.truncated,original.truncated);
   assert.equal(query.query.timeFrom,original.query.timeFrom);assert.equal(query.query.timeTo,original.query.timeTo);
   assert.deepEqual(query.groups.map(({key,count})=>({key,count})),original.groups.map(({key,count})=>({key,count})));
   for(const row of query.rows){
    const source=original.rows.find(r=>r.id===row.id);
    assert.ok(source);assert.equal(row.revision,source.revision);assert.equal(row.time,source.time);assert.equal(row.arrivedAt,source.arrivedAt);
    // Optional unknown attributes may be omitted, but no recorded fact changes.
    for(const [key,value] of Object.entries(row))assert.deepEqual(value,source[key]);
   }
  }
  assert.ok(packet.claimChecks.every(check=>check.cited.every(c=>c.record===undefined&&!c.unavailable)));
  assert.match(packet.reviewConstraints.eventLinks,/sequence/);
  assert.ok(packet.evidence.relevanceContext.recentComparison.metrics.some(m=>m.teams.length===2));
  assert.ok(packet.evidence.relevanceContext.playerContributions.metrics.length===7);
  assert.equal(packet.evidence.relevanceContext.citable,false);
  return {decision:'approve'};
 }]);
 await answerMatchQuestionAI(input,{config,fetcher:mock.fetcher});
 assert.equal(mock.count(),3);
});

// Legacy scenario fixtures supply an explicit per-claim mock review; this does
// not run in production or infer semantic correctness from reference validity.
function reviewFixture(value,body){
 if(!['approve','withhold'].includes(value?.decision))return value;
 const source=JSON.parse(body.messages.at(-1).content);
 value={requestCheck:{requestedInformation:'Mock scenario question',status:'answered',reason:'Mock scenario answer'},...value};
 if(source.ruleClauses?.length&&!Object.hasOwn(value,'ruleChecks'))value.ruleChecks=source.ruleClauses.map(clause=>({clauseId:clause.clauseId,factIds:source.footballKnowledge.concepts.flatMap(concept=>concept.facts.map(fact=>fact.id)),supported:value.decision==='approve',reason:'Explicit mocked source support; not a semantic verifier.'}));
 value.requestCheck={coverage:requestComponents(source.evidence.question).map(requestSpan=>({requestSpan,claimIndices:[0]})),...value.requestCheck};
 if(Object.hasOwn(value,'checks'))return {...value,checks:Array.isArray(value.checks)?value.checks.map(check=>({...check,inventedFacts:check.inventedFacts??[],counts:check.counts??[]})):value.checks};
 const packet=JSON.parse(body.messages.at(-1).content);
 return {...value,reason:value.reason||'Mock review',checks:packet.answer.claims.map((_,claimIndex)=>({claimIndex,actors:[],inventedFacts:[],counts:[],supported:value.decision==='approve',reason:'Mock scenario evidence'}))};
}

test('approval cannot bypass missing, duplicate, rejected or unexplained claim checks',async()=>{
 const checks=draft.claims.map((_,claimIndex)=>({claimIndex,actors:[],supported:true,reason:'Supported in mock scenario'}));
 for(const invalid of [null,[],[checks[0],checks[0]],[checks[0],{...checks[1],supported:false}],[checks[0],{...checks[1],claimIndex:8}],[checks[0],{...checks[1],reason:''}]]){
  const mock=directTransport({draft,queries:[]},{decision:'approve',reason:'All supported',checks:invalid});
  await assert.rejects(answerMatchQuestionAI(input,{config,fetcher:mock.fetcher}),error=>error.code==='question-withheld');
  assert.equal(mock.count(),2);
 }
});

test('one semantic repair gets a fresh review using the same evidence snapshot',async()=>{
 const bad={...draft,claims:[{text:'Reed lost concentration.',kind:'interpretation',evidence:[ref]}]};
 let calls=0;const snapshots=[];
 const fetcher=async(_url,options)=>{
  const body=JSON.parse(options.body),packet=JSON.parse(body.messages.at(-1).content);snapshots.push(packet);
  const values=[{draft:bad,queries:[]},{decision:'withhold',reason:'Intention unknown'},draft,{decision:'approve'}];
  const value=reviewFixture(values[calls++],body);
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]})};
 };
 const result=await answerMatchQuestionAI(input,{config,fetcher,canRepair:()=>true});
 assert.equal(calls,4);assert.equal(result.execution.repairs,1);assert.equal(result.observedAt,input.time);
 assert.deepEqual(snapshots[2].rejectedAnswer,bad);
 assert.equal(snapshots[2].evidence.observedAt,input.time);for(const row of snapshots[1].evidence.linkedContext.rows){const repairedRows=[...wireQueries(snapshots[2].evidence).flatMap(q=>q.rows||[]),...(snapshots[2].evidence.linkedContext?.rows||[])];assert.ok(repairedRows.some(candidate=>candidate.id===row.id&&candidate.revision===row.revision&&candidate.result===row.result));}assert.equal(snapshots[1].evidence.sourceFingerprint,snapshots[3].evidence.sourceFingerprint);
 assert.match(result.answer,/off target/);assert.doesNotMatch(result.answer,/panicked/);
});
test('semantic repair cannot loop or publish a second rejected answer',async()=>{
 let calls=0;
 const fetcher=async(_url,options)=>{
  const body=JSON.parse(options.body),value=reviewFixture([{draft,queries:[]},{decision:'withhold',reason:'Unsupported'},draft,{decision:'withhold',reason:'Still unsupported'}][calls++],body);
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]})};
 };
 await assert.rejects(answerMatchQuestionAI(input,{config,fetcher,canRepair:()=>true}),e=>e.code==='question-withheld');assert.equal(calls,4);
});

test('pre-review repair receives complete labelled team scopes and cannot retry a rejected replacement',async()=>{
 const question={kind:'sustained',seed:8341,time:110,question:'Which side has completed more passes so far, and by how many?'};
 const queryInput={kind:question.kind,seed:question.seed,time:question.time};
 const recentPass=executeMatchQuery(queryInput,{filters:{type:'pass',result:true},order:'desc',limit:1}).rows[0];
 const bad={scope:'match',claims:[{text:'The home team has completed 1 pass so far.',kind:'observation',evidence:recentPass.evidence}],followUp:''};
 let calls=0,allowanceChecks=0;
 const fetcher=async(_url,options)=>{
  const body=JSON.parse(options.body),packet=JSON.parse(body.messages.at(-1).content);let value;
  if(calls===0){assert.equal(packet.fullMatchComparison,undefined);value={mentionedPlayers:[],draft:bad,queries:[]};}
  else if(calls===1){
   assert.match(body.messages[0].content,/For team totals and comparisons, use fullMatchComparison/);
   const comparison=packet.evidence.fullMatchComparison;
   assert.equal(comparison.metrics.length,5);assert.equal(comparison.from,'00:00');assert.equal(comparison.to,'01:50');
   const passes=comparison.metrics.find(metric=>metric.filters.type==='pass');
   assert.deepEqual(passes.teams,[{team:'home',name:'Northbridge',count:5},{team:'away',name:'Harbour Athletic',count:4}]);
   for(const metric of comparison.metrics){
    const scope=packet.evidence.queryResults.find(query=>query.scopeReference.id===metric.evidence[0].id);
    assert.equal(scope.query.aggregate,'by-team');assert.equal(scope.query.timeFrom,0);assert.equal(scope.query.timeTo,110);
    const actual=executeMatchQuery(queryInput,{filters:metric.filters,aggregate:'by-team'});
    assert.deepEqual(scope.groups,actual.groups.map(({key,label,count})=>({key,label,count})));
    assert.equal(scope.count,actual.count);
   }
   const scope=packet.evidence.queryResults.find(query=>query.query.aggregate==='by-player'&&query.query.filters.type==='pass'&&query.query.filters.result===true);
   value={scope:'match',claims:[{text:'The home team has completed 9 passes so far.',kind:'observation',evidence:[scope.scopeReference]}],followUp:''};
  }else{
   assert.equal(calls,2,'No second semantic rewrite is permitted');
   const scopeReference=packet.answer.claims[0].evidence[0];
   value={decision:'approve',reason:'Intentionally incorrect model approval.',checks:[{claimIndex:0,actors:[],counts:[{text:'9 passes',value:9,groupKey:'home',scopeReference}],supported:true,reason:'Intentionally incorrect model approval.'}]};
  }
  calls++;return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reviewFixture(value,body))}}]})};
 };
 await assert.rejects(answerMatchQuestionAI(question,{config,fetcher,canRepair:()=>{allowanceChecks++;return true;}}),error=>error.code==='question-withheld');
 assert.equal(calls,3);assert.equal(allowanceChecks,1);
});
test('provider failure is not treated as a semantic repair opportunity',async()=>{
 let calls=0,checks=0;
 const fetcher=async()=>{calls++;return {ok:false,status:429};};
 await assert.rejects(answerMatchQuestionAI(input,{config,fetcher,canRepair:()=>{checks++;return true;}}),e=>e.code==='azure-rate-limit');
 assert.equal(calls,1);assert.equal(checks,0);
});

test('assessment dimensions separate shot volume from unmeasured quality and keep named actions at question time',async()=>{
 let seen;
 const mock=transport([{scope:'match',claims:[{text:'Player intention is unknown.',kind:'limitation',evidence:[]}],followUp:''},{decision:'approve'}],(body,call)=>{if(!call)seen=JSON.parse(body.messages.at(-1).content);});
 await answerMatchQuestionAI({...input,question:'Why did Cole not pass?'},{config,fetcher:mock.fetcher});
 const quality=seen.assessmentDimensions.find(d=>d.dimension==='chanceQuality');
 assert.equal(quality.availability,'unmeasured');assert.equal(quality.leader,null);assert.deepEqual(quality.evidence,[]);
 const onTarget=seen.assessmentDimensions.find(d=>d.dimension==='shotsOnTarget');
 const expected=executeMatchQuery({kind:input.kind,seed:input.seed,time:input.time},{filters:{type:'shot',outcome:'on-target'},aggregate:'by-team',timeFrom:66,timeTo:96});
 for(const team of ['home','away'])assert.equal(onTarget[team],expected.groups.find(g=>g.key===team)?.count??0);
 assert.ok(seen.namedPlayerActions.some(row=>row.player.name==='J. Cole'));
 for(const row of seen.namedPlayerActions)for(const action of row.actions){
  const [minutes,seconds]=action.time.split(':').map(Number);assert.ok(minutes*60+seconds<=input.time);
  assert.ok(action.evidence.every(ref=>seen.queryResults.some(q=>q.rows.some(r=>r.id===ref.id))||seen.linkedContext.rows.some(r=>r.id===ref.id)));
 }
});

test('unsupported judgment triggers a whole-answer rewrite rather than orphaned retained facts',async()=>{
 const bad={...draft,claims:[{text:'Northbridge creates better chances.',kind:'interpretation',evidence:[ref]},{text:'They took this shot off target.',kind:'observation',evidence:[ref]}]};
 let calls=0;
 const fetcher=async(_url,options)=>{
  const body=JSON.parse(options.body);
  const values=[{draft:bad,queries:[]},draft,{decision:'approve'}];
  if(calls===1){const packet=JSON.parse(body.messages.at(-1).content);assert.deepEqual(packet.rejectedAnswer,bad);assert.equal(packet.evidence.question,input.question);}
  const value=reviewFixture(values[calls++],body);
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]})};
 };
 const result=await answerMatchQuestionAI(input,{config,fetcher,canRepair:()=>true});
 assert.equal(calls,3);assert.equal(result.execution.repairMode,'reviewed-rewrite');
 assert.match(result.answer,/Reed/);assert.doesNotMatch(result.answer,/better chances|They/);
});

test('claim removal cannot leave a second unsupported causal claim without attempting the bounded rewrite',async()=>{
 const bad={...draft,claims:[{text:'Northbridge creates better chances.',kind:'interpretation',evidence:[ref]},{text:'Reed forced the turnover.',kind:'observation',evidence:[ref]}]};
 let calls=0;
 const fetcher=async(_url,options)=>{
  const body=JSON.parse(options.body);
  const values=[{draft:bad,queries:[]},draft,{decision:'approve'}];
  if(calls===1)assert.deepEqual(JSON.parse(body.messages.at(-1).content).rejectedAnswer,bad);
  const value=reviewFixture(values[calls++],body);
  return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]})};
 };
 const result=await answerMatchQuestionAI(input,{config,fetcher,canRepair:()=>true});
 assert.equal(calls,3);assert.equal(result.execution.repairMode,'reviewed-rewrite');
 assert.match(result.answer,/off target/);assert.doesNotMatch(result.answer,/forced|better chances/);
});


test('internal premise assessment reaches the reviewer without appearing in the fan response',async()=>{
 const premiseCheck={questionAssumption:'A shot was a goal',recordedAction:'The shot was off target',conclusion:'contradicted'};
 let received;
 const mock=directTransport({draft:{...draft,premiseCheck},queries:[]},undefined,(packet,call)=>{if(call)received=packet;});
 const result=await answerMatchQuestionAI(input,{config,fetcher:mock.fetcher});
 assert.deepEqual(received.premiseCheck,premiseCheck);
 assert.equal(Object.hasOwn(result,'premiseCheck'),false);
 assert.doesNotMatch(result.answer,/questionAssumption|contradicted/);
});

test('repeated initials remain clarifications even after earlier answers',async()=>{
 for(const answer of ['Could you clarify what you would like to know?', 'J. Cole recovered the ball.']){
  const result=await answerMatchQuestionAI({...input,question:'j',previousQuestion:'j',conversation:[{question:'j',answer,time:0}]},{config,fetcher:async()=>{throw new Error('Must not infer intent from an initial');}});
  assert.equal(result.scope,'clarify');assert.equal(result.execution.modelCalls,0);assert.deepEqual(result.moments,[]);
 }
});

test('reviewer approval cannot override its own identified unsupported assertion',async()=>{
 const claim={scope:'match',claims:[{text:'Reed put the attempt off target because he lost concentration.',kind:'observation',evidence:[ref]}],followUp:''};
 const review={decision:'approve',reason:'The shot actor is right',checks:[{claimIndex:0,actors:[],inventedFacts:['because he lost concentration'],reason:'No evidence of concentration',supported:true}]};
 const mock=directTransport({draft:claim,queries:[]},review);
 await assert.rejects(answerMatchQuestionAI(input,{config,fetcher:mock.fetcher}),error=>error.code==='question-withheld');
});

test('true claims cannot pass when the review identifies an unanswered request',async()=>{
 const mock=directTransport({draft,queries:[]},{decision:'approve',reason:'Facts true',requestCheck:{requestedInformation:'A missing quantity',status:'not-answered',reason:'Only states a shot outcome'}});
 await assert.rejects(answerMatchQuestionAI(input,{config,fetcher:mock.fetcher}),error=>error.code==='question-withheld');
});

test('canonical rule selection can only render exact selected versioned source facts, never authored match evidence',async()=>{
 const question={...input,question:'Is an offside position alone an offence?'},knowledge=retrieveFootballKnowledge(['offside']);
 const reference={type:'knowledge',id:'offside.involvement',version:knowledge.version};
 const planner={mentionedPlayers:[],decision:{kind:'general',concepts:['offside']}};
 const mock=sequenceTransport([planner,{factIds:['offside.involvement']},{decision:'approve'}],(packet,call,body)=>{
  if(call===1){const schema=body.response_format.json_schema.schema;assert.deepEqual(schema.required,['factIds']);assert.equal(schema.properties.claims,undefined);assert.ok(schema.properties.factIds.items.enum.includes(reference.id));assert.equal(schema.properties.factIds.maxItems,4);assert.equal(body.response_format.json_schema.name,'rule_fact_selection');}
  if(call===2){assert.equal(packet.answer.scope,'general');assert.deepEqual(packet.knowledgeChecks,[{claimIndex:0,reference}]);assert.deepEqual(packet.claimChecks[0].cited,[]);assert.equal(packet.ruleClauses.length,2);const schema=body.response_format.json_schema.schema.properties.ruleChecks;assert.equal(schema.minItems,2);assert.equal(schema.maxItems,2);assert.deepEqual(schema.items.properties.clauseId.enum,packet.ruleClauses.map(c=>c.clauseId));assert.match(body.messages[0].content,/necessary versus sufficient/);}
 });
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.scope,'general');assert.deepEqual(result.evidence,[]);assert.deepEqual(result.moments,[]);assert.deepEqual(result.knowledgeCitations,[{claimIndex:0,reference}]);assert.equal(result.knowledgeReview.method,'model-clause-review');assert.equal(result.execution.modelCalls,3);assert.equal(result.provenance.modelGenerated,false);assert.equal(result.provenance.aiInterpreted,true);assert.equal(result.provenance.source,'verified-rule-facts');assert.equal(result.answer,knowledge.concepts[0].facts.find(fact=>fact.id===reference.id).text);
 for(const selection of [{factIds:[]},{factIds:['offside.involvement','offside.involvement']},{factIds:['handball.offence']},{factIds:['offside.involvement'],claims:[{text:'Invented rule'}]},{factIds:knowledge.concepts[0].facts.slice(0,5).map(fact=>fact.id)},{factIds:[{type:'scope',id:reference.id,revision:1}]}]){
  const invalid=sequenceTransport([planner,selection]);await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:invalid.fetcher,canRepair:()=>true}),error=>error.code==='question-invalid-rule-selection');assert.equal(invalid.count(),2);
 }
});

test('canonical rule coverage cannot omit required clauses or accept contradictory review, and canonical text is never rewritten',async()=>{
 const question={...input,question:'Does handling have to be deliberate to be an offence?'};
 const planner={mentionedPlayers:[],decision:{kind:'general',concepts:['handball']}};
 const selection={factIds:['handball.offence','handball.scoring']};
 const valid=selection.factIds.map((factId,index)=>({clauseId:`claim${index}.clause0`,factIds:[factId],supported:true,reason:'Mock source match'}));
 for(const checks of [[],[valid[0]],[valid[0],valid[0]],[valid[0],{...valid[1],supported:false,reason:'Selection does not fully answer the requested condition.'}],[valid[0],{...valid[1],factIds:[]}],[valid[0],{...valid[1],factIds:['offside.position']}],[valid[0],{...valid[1],clauseId:'invented'}]]){
  const mock=sequenceTransport([planner,selection,{decision:'approve',ruleChecks:checks}]);await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher,canRepair:()=>true}),error=>error.code==='question-withheld');assert.equal(mock.count(),3);
 }
 const mock=sequenceTransport([planner,selection,{decision:'approve'}]);const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});
 const facts=retrieveFootballKnowledge(['handball']).concepts[0].facts;assert.deepEqual(result.claims.map(claim=>claim.text),selection.factIds.map(id=>facts.find(fact=>fact.id===id).text));assert.match(result.answer,/even accidentally/);assert.doesNotMatch(result.answer,/only if/i);assert.equal(result.execution.repairs,0);
});

test('explicit moment inspection rejects contradictory narrowing and can replan once without dropping the event',async()=>{
 const bad={mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{id:input.anchorId,type:'pass',player:'home-9'},aggregate:'list'}]}};
 const fixed={mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{id:input.anchorId},aggregate:'list'}]}};
 const invalid=sequenceTransport([bad]);await assert.rejects(answerMatchQuestionAI(input,{config,fetcher:invalid.fetcher}),/ID alone/);
 const repaired=sequenceTransport([bad,fixed,draft,{decision:'approve'}],(packet,call)=>{if(call===1)assert.match(packet.planningError,/ID alone/);if(call===2){assert.equal(packet.requestedEvidence[0].count,1);assert.equal(packet.requestedEvidence[0].rows[0].type,'shot');assert.deepEqual(packet.requestedEvidence[0].query.filters,{id:input.anchorId});}});
 const result=await answerMatchQuestionAI(input,{config,fetcher:repaired.fetcher,canRepair:required=>required===3});assert.equal(result.execution.modelCalls,4);assert.equal(result.execution.planningRepairs,1);assert.ok(result.moments.some(moment=>moment.anchorId===input.anchorId));
});

test('application numeric citation completion is audited without rewriting correct totals or accepting false totals',async()=>{
 const question={kind:'sustained',seed:84621,time:110,question:'How many completed passes has Northbridge made?'};
 const plan={mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'pass',result:true},aggregate:'by-team'}]}};
 const candidate=count=>({scope:'match',claims:[{text:`Northbridge has ${count} completed passes.`,kind:'observation',evidence:[]}],followUp:''});
 const mock=sequenceTransport([plan,candidate(5),packet=>({decision:'approve',reason:'Verified complete team count',checks:[{claimIndex:0,actors:[],supported:true,reason:'Verified team count',inventedFacts:[],counts:[{text:'5 completed passes',value:5,scopeReference:packet.answer.claims[0].evidence[0],groupKey:'home'}]}]})],(packet,call)=>{if(call===2){assert.equal(packet.citationAugmentations.length,1);assert.equal(packet.citationAugmentations[0].value,5);assert.equal(packet.answer.claims[0].text,candidate(5).claims[0].text);}});
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.citationAugmentations[0].reason,'verified-complete-count-scope');assert.equal(result.citationAugmentations[0].reference.type,'scope');assert.ok(result.evidence.some(ref=>ref.id===result.citationAugmentations[0].reference.id));assert.equal(result.provenance.modelGenerated,true);assert.equal(result.execution.modelCalls,3);
 const bad=sequenceTransport([plan,candidate(9)]);await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:bad.fetcher}),/verify|evidence/);assert.equal(bad.count(),2);
});

test('canonical own-half rule selection retains the source exception and incomplete selection may be withheld',async()=>{
 const question={...input,question:'Could an offside offence be punished in your own half?'};
 const planner={mentionedPlayers:[],decision:{kind:'general',concepts:['offside']}};
 const incomplete=sequenceTransport([planner,{factIds:['offside.position']},{decision:'approve',requestCheck:{status:'not-answered',reason:'Position alone omits the later involvement exception.'}}]);
 await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:incomplete.fetcher,canRepair:()=>true}),error=>error.code==='question-withheld');assert.equal(incomplete.count(),3);
 const full=sequenceTransport([planner,{factIds:['offside.position','offside.restart']},{decision:'approve'}]);
 const result=await answerMatchQuestionAI({...question,language:'fr'},{config,fetcher:full.fetcher});assert.match(result.answer,/potentially in the player's own half/);assert.equal(result.language,'en');assert.equal(result.knowledgeReference.selection.requestedLanguage,'fr');assert.equal(result.knowledgeReference.selection.renderedLanguage,'en');assert.equal(result.provenance.modelGenerated,false);assert.doesNotMatch(result.answer,/can never|cannot.*penalized/);
});

test('pass outcome licenses preserve unqualified selectors, negative qualifiers and outcome questions across supported languages',()=>{
 const query=result=>({filters:{type:'pass',result},aggregate:'list',order:'desc',limit:1});
 const unqualified=['Who made the most recent right-footed pass?','Which was Cole’s first pass?','What was Silva’s last pass, not just completed passes?','Who made the latest pass, whether or not it succeeded?','Was the last pass completed?','Did the last pass succeed?','Was Silva’s latest pass not completed?','Quel était le dernier passe ?','Quel est le dernier passe, pas seulement les passes réussies ?','¿Quién hizo el último pase con el pie derecho?','¿Fue el último pase completado?','Quem fez o último passe com o pé direito?','O último passe foi completado?','How many passes has Reed made?'];
 for(const question of unqualified){assert.equal(passQuerySelectionPermission({question}).constrained,true,question);assert.equal(passQueryOutcomeAllowed({question},query(true)),false,question);assert.equal(passQueryOutcomeAllowed({question},query(false)),false,question);assert.equal(passQueryOutcomeAllowed({question},{...query(true),filters:{type:'pass'}}),true,question);}
 const completed=['Who made the most recent completed right-footed pass?','Who made Silva’s first successful pass?','Quel joueur a fait le dernier passe réussi ?','¿Quién hizo el último pase completado?','Quem fez o último passe completo?'];
 for(const question of completed){assert.equal(passQueryOutcomeAllowed({question},query(true)),true,question);assert.equal(passQueryOutcomeAllowed({question},query(false)),false,question);}
 const failed=['Who made the latest failed pass?','Quel joueur a fait le dernier passe raté ?','¿Quién hizo el último pase fallido?','Quem fez o último passe incompleto?'];
 for(const question of failed){assert.equal(passQueryOutcomeAllowed({question},query(false)),true,question);assert.equal(passQueryOutcomeAllowed({question},query(true)),false,question);}
 assert.equal(passQueryOutcomeAllowed({question:'Who is standing out so far?'},{filters:{type:'pass',result:true},aggregate:'by-player'}),true,'Qualitative contributions can legitimately use labelled completed-pass metrics');
 assert.equal(passQueryOutcomeAllowed({question:'Who made the last pass?'},{filters:{type:'pass',result:true},aggregate:'by-player'}),false,'Changing aggregation cannot bypass outcome licensing');
 assert.equal(passQueryOutcomeAllowed({question:'Who made the latest pass?'},{filters:{result:true},aggregate:'list',order:'desc',limit:1}),false,'Omitting type cannot mix completed passes and goals');
 assert.equal(passQueryOutcomeAllowed({question:'Who made the latest completed pass, and was there a goal?'},{filters:{type:'shot',result:true},aggregate:'list'}),true,'Explicit supporting shot queries remain available');
 assert.equal(passQueryOutcomeAllowed({question:'And the latest one?',previousQuestion:'How many completed passes has Reed made?'},query(true)),true);
 assert.equal(passQueryOutcomeAllowed({question:'And the latest pass?',previousQuestion:'How many completed passes has Reed made?'},query(true)),false,'Current explicit unqualified topic replaces inherited completion');
});

test('latest pass planning cannot substitute an older completed pass and bounded repair retrieves the actual failed latest pass',async()=>{
 const question={kind:'sustained',seed:59231,time:67,question:'Who made the most recent right-footed pass?'};
 const filters={type:'pass',bodyPart:'right-foot'},base={filters,order:'desc',limit:1,aggregate:'list'};
 const source={kind:question.kind,seed:question.seed,time:question.time};
 const raw=executeMatchQuery(source,base),complete=executeMatchQuery(source,{...base,filters:{...filters,result:true}});
 assert.equal(raw.rows[0].player,'M. Costa');assert.equal(raw.rows[0].time,62);assert.equal(raw.rows[0].result,false);assert.equal(complete.rows[0].player,'H. Diallo');assert.equal(complete.rows[0].time,56);
 const planner=query=>({mentionedPlayers:[],decision:{kind:'queries',queries:[query]}});
 const writer=packet=>{const query=packet.requestedEvidence[0],row=query.rows[0];return {scope:'match',claims:[{text:`${row.player} attempted the latest right-footed pass at ${row.clock}; it failed.`,kind:'observation',evidence:[...row.evidence,query.scopeReference]}],followUp:''};};
 const rejected=sequenceTransport([planner({...base,filters:{...filters,result:true}})]);await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:rejected.fetcher}),/unrequested outcome filter/);assert.equal(rejected.count(),1);
 const repaired=sequenceTransport([planner({...base,filters:{...filters,result:true}}),planner(base),writer,{decision:'approve'}],(packet,call)=>{if(call===1)assert.match(packet.planningError,/unrequested outcome filter/);if(call===2){assert.equal(packet.requestedEvidence[0].rows[0].player,'M. Costa');assert.equal(packet.requestedEvidence[0].query.filters.result,undefined);}});
 const result=await answerMatchQuestionAI(question,{config,fetcher:repaired.fetcher,canRepair:required=>required===3});assert.equal(result.execution.modelCalls,4);assert.equal(result.execution.planningRepairs,1);assert.match(result.answer,/Costa/);assert.doesNotMatch(result.answer,/Diallo/);assert.equal(result.provenance.modelGenerated,true);
 const qualified={...question,question:'Who made the most recent completed right-footed pass?'};
 const success=sequenceTransport([planner({...base,filters:{...filters,result:true}}),packet=>{const query=packet.requestedEvidence[0],row=query.rows[0];return {scope:'match',claims:[{text:`${row.player} made the latest completed right-footed pass at ${row.clock}.`,kind:'observation',evidence:[...row.evidence,query.scopeReference]}],followUp:''};},{decision:'approve'}]);
 const qualifiedResult=await answerMatchQuestionAI(qualified,{config,fetcher:success.fetcher});assert.match(qualifiedResult.answer,/Diallo/);assert.equal(qualifiedResult.execution.modelCalls,3);assert.equal(qualifiedResult.execution.repairs,0);
});

test('general explanations outside retrieved rules have general-only wire kinds and no match dependencies',async()=>{
 const question={...input,question:'What is a low block?'};
 const answer={scope:'general',claims:[{text:'A low block is a compact defensive shape close to a team’s own goal.',kind:'general',evidence:[],dependsOn:[]}],followUp:''};
 const mock=sequenceTransport([{mentionedPlayers:[],decision:{kind:'general',concepts:[]}},answer,{decision:'approve'}],(_packet,call,body)=>{if(call===1){const schema=body.response_format.json_schema.schema;assert.deepEqual(schema.properties.claims.items.properties.kind.enum,['general','limitation']);assert.deepEqual(schema.properties.scope.enum,['general','clarify']);assert.equal(schema.properties.claims.items.properties.dependsOn.maxItems,0);}});
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.provenance.modelGenerated,true);assert.equal(result.knowledgeReference,undefined);assert.equal(result.execution.modelCalls,3);
});

test('typed action outcomes distinguish false, explicit null and absent source fields',()=>{
 assert.deepEqual(actionOutcome({type:'pass',result:false}),{status:'failed',basis:'result-boolean'});
 assert.deepEqual(actionOutcome({type:'pass',result:true}),{status:'completed',basis:'result-boolean'});
 assert.deepEqual(actionOutcome({type:'pass',result:null}),{status:'pending',basis:'result-null'});
 assert.deepEqual(actionOutcome({type:'pass'}),{status:'unknown',basis:'result-absent'});
 assert.deepEqual(actionOutcome({type:'shot',result:false,outcome:'saved'}),{status:'saved',basis:'result-and-outcome'});
 assert.deepEqual(actionOutcome({type:'shot',result:false}),{status:'not-goal',basis:'result-boolean'});
 assert.equal(actionOutcome({type:'recovery',result:false}),null);
});

test('known failed pass outcome cannot be called unknown; target recipient and chronology proof survive bounded repair',async()=>{
 const question={kind:'sustained',seed:59231,time:67,question:'Who made the most recent right-footed pass?'};
 const planner={mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'pass',bodyPart:'right-foot'},order:'desc',limit:1,aggregate:'list'}]}};
 let pass;
 const wrong=packet=>{pass=packet.requestedEvidence[0].rows[0];assert.equal(pass.result,false);assert.equal(pass.outcome,undefined);assert.equal(pass.actionOutcome.status,'failed');assert.equal(pass.recipientStatus,'target-only');assert.equal(pass.targetPlayer,'A. Rossi');assert.equal(pass.receiverName,undefined);return {scope:'match',claims:[{text:'This pass was aimed at A. Rossi but the outcome is not recorded as successful or unsuccessful.',kind:'observation',evidence:pass.evidence}],followUp:''};};
 const mock=sequenceTransport([planner,wrong,packet=>{assert.ok(packet.feedback.issues.some(issue=>issue.correctRecord.actionOutcome.status==='failed'));return {scope:'match',claims:[{text:'M. Costa made the latest right-footed pass at 01:02; the pass failed.',kind:'observation',evidence:pass.evidence}],followUp:''};},{decision:'approve'}],(packet,call)=>{if(call===3){assert.ok(packet.answer.claims[0].evidence.some(ref=>ref.type==='scope'));assert.ok(packet.evidence.queryResults.some(q=>q.query.order==='desc'&&q.query.limit===1));assert.equal(packet.evidence.linkedContext.rows.find(row=>row.id===pass.id).actionOutcome.status,'failed');}});
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher,canRepair:required=>required===2});assert.equal(result.execution.modelCalls,4);assert.equal(result.execution.repairs,1);assert.match(result.answer,/failed/);assert.doesNotMatch(result.answer,/not recorded/);assert.equal(result.citationAugmentations[0].reason,'verified-ordered-event-scope');assert.match(result.citationAugmentations[0].reference.id,/^match-query-/);
});

test('ordered scope supplementation fails closed for wrong endpoints and unrequested filtered subsets',()=>{
 const source={kind:'sustained',seed:59231,time:67};const state=matchState(source),query=executeMatchQuery(source,{filters:{type:'pass',bodyPart:'right-foot'},order:'desc',limit:1,aggregate:'list'});
 const packet={question:'Who made the most recent right-footed pass?',observedAt:67,teams:state.metadata.teams,roster:state.frames.at(-1).players,requestedEvidence:[query],queryResults:[query]};
 const row=query.rows[0],answer=text=>({scope:'match',claims:[{text,kind:'observation',evidence:row.evidence}],followUp:''});
 const checked=checkActionEvidence(answer('M. Costa made the latest right-footed pass.'),packet);assert.equal(checked.issues.length,0);assert.equal(checked.augmentations.length,1);assert.deepEqual(checked.answer.claims[0].evidence.at(-1),query.scopeReference);
 assert.equal(checkActionEvidence(answer('M. Costa made the first right-footed pass.'),packet).issues.length,1);
 const completed=executeMatchQuery(source,{filters:{type:'pass',result:true},order:'desc',limit:1,aggregate:'list'});
 const narrowed={...packet,question:'Who made the last pass?',requestedEvidence:[completed],queryResults:[completed]};
 const falseLatest={scope:'match',claims:[{text:'H. Diallo made the latest pass.',kind:'observation',evidence:completed.rows[0].evidence}],followUp:''};
 assert.equal(checkActionEvidence(falseLatest,narrowed).issues.length,1);
 assert.equal(checkActionEvidence(answer('No other right-footed passes occurred after this time.'),packet).augmentations.length,1);
});

test('raw ambiguous surname prevents a model-expanded identity from choosing one roster player',async()=>{
 const question={kind:'quiet',seed:48371,time:72,question:'How is Costa doing?'};
 const mock=sequenceTransport([{mentionedPlayers:['M. Costa'],decision:{kind:'queries',queries:[{filters:{type:'pass',player:'away-7'},aggregate:'list'}]}}],(packet,call)=>{assert.equal(call,0);assert.equal(packet.ambiguousPlayerMentions[0].status,'ambiguous');assert.equal(packet.ambiguousPlayerMentions[0].input,'Costa');assert.equal(packet.ambiguousPlayerMentions[0].candidates.length,2);});
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.scope,'clarify');assert.match(result.answer,/E\. Costa/);assert.match(result.answer,/M\. Costa/);assert.doesNotMatch(result.answer,/zero|no recorded|not contributing/i);assert.equal(result.execution.modelCalls,1);assert.equal(result.execution.repairs,0);assert.equal(result.provenance.modelGenerated,false);assert.equal(result.provenance.source,'verified-lineup-resolution');assert.deepEqual(result.moments,[]);assert.ok(result.evidence.every(ref=>ref.type==='scope'));
 for(const text of ['How is M. Costa doing?',"How is Harbour Athletic’s Costa doing?",'Compare both Costas.']){
  const invalid=sequenceTransport([{invalid:'stop at planner'}],(packet)=>{assert.equal(packet.ambiguousPlayerMentions,undefined,text);});
  await assert.rejects(answerMatchQuestionAI({...question,question:text},{config,fetcher:invalid.fetcher}));assert.equal(invalid.count(),1);
 }
});

test('pending goal answer retains known scoreboard and unresolved latest shot despite omitted duplicate zero extraction',async()=>{
 const question={kind:'counter',seed:48371,time:117,question:'Goal?'};let goals,shot;
 const planner={mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'shot',outcome:'goal'},aggregate:'list',order:'desc',limit:1}]}};
 const mock=sequenceTransport([planner,packet=>{goals=wireQueries(packet).find(q=>q.query.aggregate==='by-team'&&q.query.filters.type==='shot'&&q.query.filters.result===true);shot=packet.pendingOutcomeContext.attempts[0];return {scope:'match',claims:[{text:'No goals have been recorded in the match by 01:57, as confirmed by the complete goal count scopes showing zero goals for both teams.',kind:'observation',evidence:[goals.scopeReference]},{text:'The latest shot by A. Reed at 01:56 is still pending and has not been confirmed as a goal or miss.',kind:'observation',evidence:shot.evidence}],followUp:''};},packet=>({decision:'approve',reason:'Confirmed scoreboard and pending attempt are distinguished',checks:[{claimIndex:0,actors:[],inventedFacts:[],supported:true,reason:'Complete goal scope is zero',counts:['home','away'].map(groupKey=>({text:'zero goals for both teams',value:0,scopeReference:goals.scopeReference,groupKey}))},{claimIndex:1,actors:[{name:'A. Reed',action:'shot',individualAction:true}],inventedFacts:[],counts:[],supported:true,reason:'Current shot is pending'}]})]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.match(result.answer,/pending/);assert.ok(result.reviewAugmentations.some(augmentation=>augmentation.span==='No goals'));assert.ok(result.reviewAugmentations.every(augmentation=>augmentation.reason==='verified-omitted-count-binding'&&augmentation.scopeReference.id.startsWith('match-query-')));assert.ok(result.citationAugmentations.some(augmentation=>augmentation.reason==='verified-ordered-event-scope'));
});

test('indexed numeric review binds immutable assertion spans and rejects missing, duplicate, mixed and invalid indices',()=>{
 const answer={claims:[{kind:'observation',text:'Reed has 2 shots and 1 goal.'},{kind:'interpretation',text:'That suggests a threat.'}]};
 const scopeReference={type:'scope',id:'count-proof',revision:1};
 const make=()=>({numericBindingMode:'assertion-index-v1',checks:[{claimIndex:0,counts:[{assertionIndex:0,scopeReference,groupKey:'home-10'},{assertionIndex:1,scopeReference,groupKey:'home-10'}]},{claimIndex:1,counts:[]}]});
 const reviewed=resolveNumericReview(make(),answer);
 assert.deepEqual(reviewed.checks[0].counts.map(({text,value})=>({text,value})),[{text:'2 shots',value:2},{text:'1 goal',value:1}]);
 assert.equal(reviewed.numericBindings.length,2);
 for(const mutate of [r=>r.checks[0].counts.pop(),r=>r.checks[0].counts=[],r=>r.checks[0].counts[1].assertionIndex=0,r=>r.checks[0].counts[0].assertionIndex=4,r=>r.checks[0].counts[0].text='2 shots',r=>r.checks[0].counts[0].value=99,r=>r.checks[1].claimIndex=0,r=>r.checks[0].counts[0].assertionIndex='0']){
  const value=make();mutate(value);assert.throws(()=>resolveNumericReview(value,answer),error=>error.code==='question-invalid-review');
 }
 const legacy={checks:[{claimIndex:0,counts:[{text:'2 shots',value:2,scopeReference,groupKey:'home-10'}]}]};
 assert.equal(resolveNumericReview(legacy,answer),legacy,'Historical offline fixtures retain their old protocol');
});

test('actual review wire requires per-claim assertion indices including a zero at an explicit observation clock',async()=>{
 const question={kind:'counter',seed:48371,time:117,question:'Goal?'};
 const mock=sequenceTransport([{draft:null,queries:[{filters:{type:'shot',result:true},aggregate:'by-team'}]},(_body,request)=>{
  const packet=JSON.parse(request.messages.at(-1).content),scope=wireQueries(packet).find(q=>q.query.aggregate==='by-team'&&q.query.filters.result===true).scopeReference;
  return {scope:'match',claims:[{text:'No goals have been recorded in the match up to 01:57.',kind:'observation',evidence:[scope]}],followUp:''};
 },(_body,request)=>{
  const packet=JSON.parse(request.messages.at(-1).content),schema=request.response_format.json_schema.schema,variant=schema.properties.checks.items.anyOf[0];
  assert.equal(variant.properties.counts.minItems,1);assert.equal(variant.properties.counts.maxItems,1);assert.deepEqual(variant.properties.counts.items.properties.assertionIndex.enum,[0]);
  assert.equal(variant.properties.counts.items.properties.text,undefined);assert.equal(variant.properties.counts.items.properties.value,undefined);
  assert.deepEqual(packet.numericAssertions[0].assertions.map(({text,value})=>({text,value})),[{text:'No goals',value:0}]);
  return {decision:'approve',reason:'Bound confirmed score.',numericBindingMode:'assertion-index-v1',checks:[{claimIndex:0,actors:[],inventedFacts:[],counts:[{assertionIndex:0,scopeReference:packet.answer.claims[0].evidence[0],groupKey:null}],supported:true,reason:'Confirmed scoreboard, not a pending-shot verdict.'}]};
 }]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.equal(result.numericReviewBindings[0].value,0);
});

test('actual match writer selects canonical last-action facts and never authors observations or receiver roles',async()=>{
 const question={kind:'sustained',seed:48371,time:67,question:'Last pass?'};let selected;
 const mock=sequenceTransport([{mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'pass'},aggregate:'list',order:'desc',limit:1}]}},(packet,body)=>{
  const schema=body.response_format.json_schema.schema;
  assert.ok(schema.required.includes('composition'));
  assert.equal(schema.properties.claims,undefined);
  assert.deepEqual(schema.properties.composition.anyOf.find(mode=>mode.properties.mode.enum[0]==='explanation').properties.claim.anyOf.flatMap(branch=>branch.properties.kind.enum),['interpretation','limitation','general']);
  selected=packet.matchFacts.facts.find(fact=>fact.selection.kind==='ordered-event'&&fact.selection.metric==='passes');
  assert.ok(selected);assert.match(selected.claim.text,/Costa/);assert.match(selected.claim.text,/unsuccessful|failed/i);
  return {scope:'match',selectedFactIds:[selected.id],claims:[],followUp:''};
 },(packet,body)=>{
  assert.deepEqual(packet.answer.claims,[selected.claim]);assert.deepEqual(packet.canonicalClaimIndices,[0]);assert.deepEqual(packet.numericAssertions,[]);
  const variant=body.response_format.json_schema.schema.properties.checks.items.anyOf[0];assert.equal(variant.properties.actors.maxItems,0);assert.equal(variant.properties.counts.maxItems,0);
  // Contradictory legacy extraction cannot rewrite a program-verified fact.
  return {decision:'approve',reason:'The latest pass fact directly answers this request.',checks:[{claimIndex:0,actors:[{name:'A. Rossi',action:'receive',individualAction:true}],counts:[],inventedFacts:[],supported:true,reason:'Exact selected event is relevant.'}]};
 }]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});
 assert.equal(result.answer,selected.claim.text);assert.equal(result.execution.modelCalls,3);assert.equal(result.provenance.modelGenerated,false);
 assert.equal(result.provenance.source,'verified-facts-with-ai-analysis');assert.equal(result.claimProvenance[0].modelGenerated,false);
 assert.equal(result.canonicalFactSelection.selectedFactIds[0],selected.id);
 assert.ok(result.evidence.some(ref=>ref.type==='event'&&ref.id.endsWith('pass-62')&&ref.revision===2));
 assert.ok(result.evidence.some(ref=>ref.type==='scope'&&!ref.id.startsWith('scope-')),'Returned scope references are canonical, not temporary model handles');
});

test('selected shooting profiles keep exact arithmetic and distinguish app facts from a reviewed opinion',async()=>{
 const question={kind:'duel',seed:48371,time:120,question:'Would you say Reed has looked more dangerous than Silva?'};let profiles;
 const mock=sequenceTransport([{mentionedPlayers:['A. Reed','D. Silva'],decision:{kind:'queries',queries:[{filters:{type:'shot',player:'A. Reed'},aggregate:'list'},{filters:{type:'shot',player:'D. Silva'},aggregate:'list'}]}},(packet)=>{
  profiles=['home-10','away-10'].map(id=>packet.matchFacts.facts.find(fact=>fact.selection.kind==='shooting-profile'&&fact.selection.subjectId===id&&fact.selection.timeFrom===0&&fact.selection.timeTo===120));assert.ok(profiles.every(Boolean));
  return {scope:'match',selectedFactIds:profiles.map(fact=>fact.id),claims:[{text:'Reed looks more threatening on the recorded shot outcomes, though that does not measure chance quality.',kind:'interpretation',evidence:[],dependsOn:[0,1]}],followUp:''};
 },packet=>{
  assert.deepEqual(packet.canonicalClaimIndices,[0,1]);assert.equal(packet.answer.claims[2].kind,'interpretation');assert.deepEqual(packet.answer.claims[2].evidence,[...new Map(profiles.flatMap(fact=>fact.claim.evidence).map(ref=>[JSON.stringify(ref),ref])).values()]);
  return {decision:'approve',reason:'Provisional comparison grounded in both profiles.'};
 }]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});
 assert.equal(result.execution.modelCalls,3);assert.deepEqual(result.claims.slice(0,2).map(claim=>claim.text),profiles.map(fact=>fact.claim.text));
 assert.deepEqual(result.claimProvenance.map(claim=>claim.modelGenerated),[false,false,true]);assert.equal(result.provenance.modelGenerated,true);
 assert.equal(result.claimDependencies[0].claimIndex,2);assert.deepEqual(result.claimDependencies[0].observationIndices,[0,1]);
});

test('canonical fact selection rejects fabricated IDs, authored observation text, invalid dependencies and irrelevant selections',async()=>{
 const question={kind:'sustained',seed:48371,time:67,question:'Last pass?'};
 const planner={mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'pass'},aggregate:'list',order:'desc',limit:1}]}};
 for(const mode of ['unknown','duplicate','observation','dependency']){
  const mock=sequenceTransport([planner,packet=>{
   const id=packet.matchFacts.facts[0].id;
   return {scope:'match',selectedFactIds:mode==='unknown'?['fact-invented']:mode==='duplicate'?[id,id]:[id],claims:mode==='observation'?[{kind:'observation',text:'A made-up observation.',evidence:[]}]:mode==='dependency'?[{kind:'interpretation',text:'Unsupported inference.',evidence:[],dependsOn:[3]}]:[],followUp:''};
  }]);
  await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}),error=>error.code==='question-invalid-fact-selection');assert.equal(mock.count(),2);
 }
 const irrelevant=sequenceTransport([planner,packet=>({scope:'match',selectedFactIds:[packet.matchFacts.facts.find(fact=>fact.selection.kind==='count').id],claims:[],followUp:''}),{decision:'withhold',requestCheck:{status:'not-answered',reason:'A cumulative total does not identify the latest pass.'}}]);
 await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:irrelevant.fetcher}),error=>error.code==='question-withheld');assert.equal(irrelevant.count(),3);
});

test('indexed numeric protocol does not turn a wrong subject binding into valid arithmetic',async()=>{
 const question={kind:'sustained',seed:8341,time:110,question:'How many completed passes does Northbridge have?'};
 const mock=sequenceTransport([{draft:null,queries:[{filters:{type:'pass',result:true},aggregate:'by-team'}]},packet=>{
  const scope=wireQueries(packet).find(q=>q.query.aggregate==='by-team'&&q.query.filters.type==='pass'&&q.query.filters.result===true).scopeReference;
  return {scope:'match',claims:[{text:'Northbridge has 5 completed passes.',kind:'observation',evidence:[scope]}],followUp:''};
 },packet=>({decision:'approve',reason:'Intentionally wrong group binding.',numericBindingMode:'assertion-index-v1',checks:[{claimIndex:0,actors:[],inventedFacts:[],counts:[{assertionIndex:0,scopeReference:packet.answer.claims[0].evidence[0],groupKey:'away'}],supported:true,reason:'Wrong group despite correct indexed text.'}]})]);
 await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}),error=>error.code==='question-withheld'&&error.feedback.actorIssues.some(issue=>issue.claimed===5));
 assert.equal(mock.count(),3);
});

test('canonical selections still require semantic relevance and one repaired selection stays inside five calls',async()=>{
 const question={kind:'sustained',seed:48371,time:67,question:'Last pass?'};let latest;
 const planner={mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'pass'},aggregate:'list',order:'desc',limit:1}]}};
 const mock=sequenceTransport([planner,packet=>{
  latest=packet.matchFacts.facts.find(fact=>fact.selection.kind==='ordered-event'&&fact.selection.metric==='passes');
  return {scope:'match',selectedFactIds:[packet.matchFacts.facts.find(fact=>fact.selection.kind==='count').id],claims:[],followUp:''};
 },{decision:'withhold',requestCheck:{status:'not-answered',reason:'A cumulative total does not identify the latest pass.'}},(packet,body)=>{
  assert.ok(body.response_format.json_schema.schema.required.includes('composition')); 
  assert.ok(packet.evidence.matchFacts.facts.some(fact=>fact.id===latest.id));
  return {scope:'match',selectedFactIds:[latest.id],claims:[],followUp:''};
 },{decision:'approve',reason:'The selected latest action now answers the request.'}]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher,canRepair:()=>true});
 assert.equal(result.execution.modelCalls,5);assert.equal(result.execution.repairs,1);assert.equal(result.answer,latest.claim.text);assert.equal(result.provenance.modelGenerated,false);
});

test('canonical fact selection cannot launder a false model-authored numerical interpretation',async()=>{
 const question={kind:'duel',seed:48371,time:120,question:'How threatening has Reed looked?'};
 const mock=sequenceTransport([{mentionedPlayers:['A. Reed'],decision:{kind:'queries',queries:[{filters:{type:'shot',player:'A. Reed'},aggregate:'list'}]}},packet=>{
  const profile=packet.matchFacts.facts.find(fact=>fact.selection.kind==='shooting-profile'&&fact.selection.subjectId==='home-10');assert.ok(profile);
  return {scope:'match',selectedFactIds:[profile.id],claims:[{text:'A. Reed has 99 shots.',kind:'interpretation',evidence:[],dependsOn:[0]}],followUp:''};
 },packet=>({decision:'approve',reason:'Incorrect review deliberately approves a fabricated total.',numericBindingMode:'assertion-index-v1',checks:packet.answer.claims.map((_claim,claimIndex)=>({claimIndex,actors:[],inventedFacts:[],counts:claimIndex?[{assertionIndex:0,scopeReference:packet.answer.claims[claimIndex].evidence[0],groupKey:'home-10'}]:[],supported:true,reason:'Mock approval'}))})]);
 await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}),error=>error.code==='question-withheld');
 assert.ok(mock.count()<=3);
});

test('canonical pending-shot facts keep confirmed scoreboard separate from the unresolved event without numeric re-extraction',async()=>{
 const question={kind:'counter',seed:48371,time:117,question:'Goal?'};let selections;
 const mock=sequenceTransport([{mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'shot'},aggregate:'list',order:'desc',limit:1}]}},packet=>{
  const pending=packet.matchFacts.facts.find(fact=>fact.selection.kind==='ordered-event'&&fact.selection.metric==='attempts');
  const zeros=['home','away'].map(id=>packet.matchFacts.facts.find(fact=>fact.selection.kind==='count'&&fact.selection.metric==='goals'&&fact.selection.subjectId===id&&fact.selection.timeFrom===0));
  assert.ok(pending);assert.match(pending.claim.text,/pending|awaiting/i);assert.ok(zeros.every(Boolean));selections=[...zeros,pending];
  assert.ok(packet.matchFacts.facts.every(fact=>fact.proof===undefined),'Writer receives compact selection metadata, not repeated proof bodies');
  return {scope:'match',selectedFactIds:selections.map(fact=>fact.id),claims:[],followUp:''};
 },packet=>({decision:'approve',reason:'Confirmed score and pending attempt both present.',numericBindingMode:'assertion-index-v1',checks:packet.answer.claims.map((_claim,claimIndex)=>({claimIndex,actors:[],counts:[],inventedFacts:[],supported:true,reason:'Relevant canonical source fact.'}))})]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.deepEqual(result.claims.map(claim=>claim.text),selections.map(fact=>fact.claim.text));assert.equal(result.provenance.modelGenerated,false);
 assert.equal(result.canonicalFactSelection.proofs.length,3);assert.ok(result.canonicalFactSelection.proofs.some(proof=>proof.kind==='count'&&proof.value===0));
});

test('composition wire enforces joint budgets and four canonical pending facts need no redundant prose',async()=>{
 const question={kind:'counter',seed:48371,time:117,question:'Goal?'};let chosen;
 const mock=sequenceTransport([{mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'shot'},aggregate:'list',order:'desc',limit:1}]}},(packet,body)=>{
  const schema=body.response_format.json_schema.schema,modes=Object.fromEntries(schema.properties.composition.anyOf.map(mode=>[mode.properties.mode.enum[0],mode]));
  assert.equal(schema.properties.claims,undefined);assert.equal(schema.properties.selectedFactIds,undefined);
  assert.deepEqual(modes.facts.required,['mode','factIds']);assert.equal(modes.facts.properties.factIds.minItems,1);assert.equal(modes.facts.properties.factIds.maxItems,4);
  assert.deepEqual(modes.explanation.required,['mode','factIds','claim']);assert.equal(modes.explanation.properties.factIds.maxItems,3);assert.ok(modes.explanation.properties.claim.anyOf.every(branch=>branch.type==='object'&&branch.properties.evidence.maxItems===0));
  assert.equal(modes.limitation.properties.factIds.maxItems,0);assert.deepEqual(modes.limitation.properties.claim.properties.kind.enum,['limitation']);
  const explanations=schema.properties.composition.anyOf.filter(mode=>mode.properties.mode.enum[0]==='explanation');assert.equal(explanations.length,3);
  explanations.forEach((mode,index)=>{
   assert.equal(mode.properties.factIds.minItems,index+1);assert.equal(mode.properties.factIds.maxItems,index+1);
   const [interpretation,nonInterpretive]=mode.properties.claim.anyOf;
   assert.deepEqual(interpretation.properties.kind.enum,['interpretation']);assert.equal(interpretation.properties.dependsOn.minItems,1);assert.deepEqual(interpretation.properties.dependsOn.items.enum,Array.from({length:index+1},(_v,i)=>i));
   assert.deepEqual(nonInterpretive.properties.kind.enum,['limitation','general']);assert.equal(nonInterpretive.properties.dependsOn.maxItems,0);
  });
  const policy=body.messages[0].content;assert.match(policy,/Choose ONE composition mode/);assert.doesNotMatch(policy,/Every observation or interpretation needs|Return the required answer JSON schema|Select only fact IDs needed/);
  chosen=['home','away'].map(id=>packet.matchFacts.facts.find(f=>f.selection.kind==='count'&&f.selection.metric==='goals'&&f.selection.subjectId===id&&f.selection.timeFrom===0));
  chosen.push(packet.matchFacts.facts.find(f=>f.selection.kind==='count'&&f.selection.metric==='pendingShots'&&f.selection.subjectId==='home-10'));
  chosen.push(packet.matchFacts.facts.find(f=>f.selection.kind==='ordered-event'&&f.selection.metric==='attempts'));
  assert.ok(chosen.every(Boolean));
  return {scope:'match',composition:{mode:'facts',factIds:chosen.map(f=>f.id)},followUp:''};
 },{decision:'approve',reason:'Confirmed counts and the unresolved latest attempt answer the question.'}]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.equal(result.claims.length,4);assert.deepEqual(result.claims.map(c=>c.text),chosen.map(f=>f.claim.text));assert.equal(result.provenance.modelGenerated,false);
});

test('composition explanation uses two shooting profiles and exactly one dependent opinion',async()=>{
 const question={kind:'duel',seed:48371,time:120,question:'Would you say Reed has looked more dangerous than Silva?'};
 const mock=sequenceTransport([{mentionedPlayers:['A. Reed','D. Silva'],decision:{kind:'queries',queries:[{filters:{type:'shot',player:'A. Reed'},aggregate:'list'},{filters:{type:'shot',player:'D. Silva'},aggregate:'list'}]}},packet=>{
  const profiles=['home-10','away-10'].map(id=>packet.matchFacts.facts.find(f=>f.selection.kind==='shooting-profile'&&f.selection.subjectId===id&&f.selection.timeFrom===0));
  assert.ok(profiles.every(Boolean));assert.ok(!packet.matchFacts.facts.some(f=>f.selection.kind==='ordered-event'),'A full default-ordered list should not introduce incidental first-shot facts');
  return {scope:'match',composition:{mode:'explanation',factIds:profiles.map(f=>f.id),claim:{text:'Reed looks more threatening on the recorded outcomes, although these attempts do not measure chance quality.',kind:'interpretation',evidence:[],dependsOn:[0,1]}},followUp:''};
 },{decision:'approve',reason:'Qualified assessment based on both profiles.'}]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.claims.length,3);assert.deepEqual(result.claimProvenance.map(c=>c.modelGenerated),[false,false,true]);assert.equal(result.execution.modelCalls,3);
});

test('composition runtime rejects mixed modes, oversized selections, duplicate facts and unsupported prose dependencies',async()=>{
 const question={kind:'sustained',seed:48371,time:67,question:'Last pass?'};
 const planner={mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'pass'},aggregate:'list',order:'desc',limit:1}]}};
 const claim={text:'A short explanation.',kind:'interpretation',evidence:[],dependsOn:[0]};
 for(const make of [
  ids=>({mode:'facts',factIds:ids.slice(0,4),claim}),ids=>({mode:'facts',factIds:ids.slice(0,5)}),ids=>({mode:'facts',factIds:[ids[0],ids[0]]}),
  ids=>({mode:'explanation',factIds:ids.slice(0,4),claim}),ids=>({mode:'explanation',factIds:[ids[0]],claim:{...claim,dependsOn:[]}}),
  ids=>({mode:'explanation',factIds:[ids[0]],claim:{...claim,dependsOn:[1]}}),ids=>({mode:'explanation',factIds:[ids[0]],claim:{...claim,kind:'observation'}}),
  ids=>({mode:'limitation',factIds:[ids[0]],claim:{...claim,kind:'limitation',dependsOn:[]}}),ids=>({mode:'facts',factIds:[]})]){
  const mock=sequenceTransport([planner,packet=>({scope:'match',composition:make(packet.matchFacts.facts.map(f=>f.id)),followUp:''})]);
  await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}),error=>error.code==='question-invalid-fact-selection');assert.equal(mock.count(),2);
 }
 const mixed=sequenceTransport([planner,packet=>({scope:'match',composition:{mode:'facts',factIds:[packet.matchFacts.facts[0].id]},claims:[],followUp:''})]);
 await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mixed.fetcher}),error=>error.code==='question-invalid-fact-selection');
});

test('a standalone limitation has no selected facts and one paragraph, and oversized legacy repair uses the dedicated composition policy',async()=>{
 const question={kind:'sustained',seed:48371,time:67,question:'Can you tell what pressure caused that pass to fail?'};
 const planner={mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'pass'},aggregate:'list',order:'desc',limit:1}]}};
 const limitation={text:'The recorded actions do not establish what pressure caused the pass to fail.',kind:'limitation',evidence:[],dependsOn:[]};
 const limited=sequenceTransport([planner,{scope:'match',composition:{mode:'limitation',factIds:[],claim:limitation},followUp:''},{decision:'approve',reason:'Specific uncertainty is accurate.'}]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:limited.fetcher});assert.equal(result.claims.length,1);assert.equal(result.claimProvenance[0].modelGenerated,true);assert.equal(result.execution.modelCalls,3);
 let latest;
 const repair=sequenceTransport([planner,packet=>{
  latest=packet.matchFacts.facts.find(f=>f.selection.kind==='ordered-event'&&f.selection.metric==='passes');
  return {scope:'match',selectedFactIds:packet.matchFacts.facts.slice(0,4).map(f=>f.id),claims:[limitation],followUp:''};
 },(_packet,body)=>{
  assert.match(body.messages[0].content,/one bounded repair of a rejected composition/);assert.doesNotMatch(body.messages[0].content,/Repair a rejected football answer|Every observation or interpretation needs|up to .*concise necessary fan-facing claims/);
  return {scope:'match',composition:{mode:'explanation',factIds:[latest.id],claim:limitation},followUp:''};
 },{decision:'approve',reason:'The recorded outcome plus specific unknown answers the request.'}]);
 const repaired=await answerMatchQuestionAI(question,{config,fetcher:repair.fetcher,canRepair:()=>true});assert.equal(repaired.execution.modelCalls,4);assert.equal(repaired.execution.repairs,1);assert.equal(repaired.claims.length,2);
});

test('review preserves explicit opposing recovery linkage without granting pressure or forcing attribution',async()=>{
 const question={kind:'sustained',seed:48371,time:67,question:'What followed the unsuccessful pass?'};
 const mock=sequenceTransport([{mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'pass'},aggregate:'list',order:'desc',limit:1}]}},packet=>{
  const pass=packet.matchFacts.facts.find(f=>f.selection.kind==='ordered-event'&&f.selection.metric==='passes');
  const recovery=packet.matchFacts.facts.find(f=>f.selection.kind==='event'&&f.selection.eventType==='recovery'&&f.selection.time===66);
  return {scope:'match',composition:{mode:'explanation',factIds:[pass.id,recovery.id],claim:{text:'The failed pass was followed by the opposing recovery in that turnover sequence.',kind:'interpretation',evidence:[],dependsOn:[0,1]}},followUp:''};
 },(packet,body)=>{
  const link=packet.recordedActionLinks.find(link=>link.next.id.endsWith('recovery-66'));assert.ok(link);assert.ok(link.prior.id.endsWith('pass-62'));assert.equal(link.prior.revision,2);assert.deepEqual(link.sourceFields,['cause','passId']);
  assert.match(link.doesNotEstablish,/Who forced/);assert.match(body.messages[0].content,/Linked failed-pass\/recovery events can establish sequence, not who forced/);
  assert.match(packet.claimChecks[1].recoveryConstraint,/explicit prior-action link/);
  return {decision:'approve',reason:'A recorded linked sequence, not attribution of who forced the mistake.'};
 }]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.equal(result.claims.length,3);
});

test('dependent queries bind a recovered-ball anchor and its team before looking for subsequent shots',async()=>{
 const question={kind:'interrupted',seed:1007,time:106,question:'Who got the ball back most recently, and did their side get a shot away afterwards?'};let chosen;
 const planner={mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'recovery',recoveryClass:'ball-win'},aggregate:'list',order:'desc',limit:1},{filters:{type:'shot'},aggregate:'list',order:'asc',limit:1,relativeTo:{queryIndex:0,relation:'after',sameTeam:true}}]}};
 const mock=sequenceTransport([planner,(packet,body)=>{
  assert.equal(packet.queryRelations.length,1);const relation=packet.queryRelations[0];assert.equal(relation.anchorTime,92);assert.equal(relation.anchorTeam,'away');assert.equal(relation.query.timeFrom,92);assert.equal(relation.query.timeFromExclusive,true);assert.equal(relation.query.timeTo,106);assert.equal(relation.query.filters.team,'away');
  assert.notEqual(relation.query.timeFrom,packet.observedAt,'Afterwards binds the requested event, not the observation pin');
  chosen=[packet.matchFacts.facts.find(f=>f.selection.kind==='ordered-event'&&f.selection.metric==='ballWins'),packet.matchFacts.facts.find(f=>f.selection.kind==='ordered-event'&&f.selection.metric==='attempts'&&f.selection.timeFrom===92)];
  assert.ok(chosen.every(Boolean));assert.match(chosen[0].claim.text,/Patel/);assert.match(chosen[1].claim.text,/Evans/);
  return {scope:'match',composition:{mode:'facts',factIds:chosen.map(f=>f.id)},followUp:''};
 },packet=>({decision:'approve',reason:'Correct action class and dependent same-team sequence.',requestCheck:{status:'answered',requestedInformation:question.question,reason:'Both components covered.',coverage:packet.requestComponents.map((requestSpan,index)=>({requestSpan,claimIndices:[index],answerForm:'fact',requestedAction:index?'shot':'ball-win',temporalRelation:index?'after-requested-event':'none'}))}})],(packet,index,body)=>{
  if(index===0){assert.match(packet.actionOntology.receive,/not evidence of taking possession back/);assert.match(body.messages[0].content,/relativeTo/);const variants=decisionBranch(body,'queries').properties.queries.items.anyOf;assert.ok(variants.every(variant=>variant.properties.relativeTo));for(const variant of variants.filter(variant=>variant.properties.relativeTo.type==='object'&&!variant.properties.relativeTo.properties.relation.enum.includes('none')))for(const field of ['timeFrom','timeTo','timeFromExclusive','timeToExclusive'])assert.deepEqual(variant.properties[field],{type:'null'});}
 });
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.equal(result.queryRelations[0].anchorTime,92);assert.deepEqual(result.claims.map(claim=>claim.text),chosen.map(f=>f.claim.text));
});

test('relative query resolution rejects forward, non-singleton and contradictory anchors without guessing clocks',async()=>{
 const question={kind:'interrupted',seed:1007,time:106,question:'What happened after the recovery?'};
 const anchor={filters:{type:'recovery',recoveryClass:'ball-win'},aggregate:'list',order:'desc',limit:1};
 const after={filters:{type:'shot'},aggregate:'list',relativeTo:{queryIndex:0,relation:'after',sameTeam:true}};
 for(const queries of [[after],[anchor,{...after,timeFrom:106}],[{...anchor,limit:20},after],[anchor,{...after,filters:{type:'shot',team:'home'}}],[anchor,{...after,relativeTo:{queryIndex:1,relation:'after',sameTeam:true}}]]){
  const mock=sequenceTransport([{mentionedPlayers:[],decision:{kind:'queries',queries}}]);
  await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}),/lookup/);assert.equal(mock.count(),1);
 }
});

test('relative windows remain exact when the anchor is at the observation pin and no later record exists',async()=>{
 const question={kind:'sustained',seed:48371,time:62,question:'Was there a shot after the latest pass?'};
 const mock=sequenceTransport([{mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'pass'},aggregate:'list',order:'desc',limit:1},{filters:{type:'shot'},aggregate:'list',limit:1,relativeTo:{queryIndex:0,relation:'after',sameTeam:false}}]}},packet=>{
  const relation=packet.queryRelations[0],source=wireQueries(packet).find(q=>q.scopeReference.id===relation.scopeReference.id);
  assert.equal(relation.anchorTime,62);assert.equal(source.query.timeFrom,62);assert.equal(source.query.timeTo,62);assert.equal(source.query.timeFromExclusive,true);assert.equal(source.count,0);
  const zero=packet.matchFacts.facts.find(f=>f.selection.kind==='count'&&f.selection.metric==='attempts'&&f.selection.timeFromExclusive===true);assert.ok(zero);
  return {scope:'match',composition:{mode:'facts',factIds:[zero.id]},followUp:''};
 },{decision:'approve',reason:'No shot is received after the selected cutoff event.'}]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.equal(result.queryRelations[0].query.timeFromExclusive,true);
});

test('declared requested assessment cannot be satisfied by canonical numerical profiles alone',async()=>{
 const question={kind:'duel',seed:48371,time:120,question:'Would you say Reed has looked more dangerous than Silva?'};let ids;
 const planner={mentionedPlayers:['A. Reed','D. Silva'],decision:{kind:'queries',queries:[{filters:{type:'shot',player:'A. Reed'},aggregate:'list'},{filters:{type:'shot',player:'D. Silva'},aggregate:'list'}]}};
 const review=packet=>({decision:'approve',reason:'Facts are correct.',requestCheck:{status:'answered',requestedInformation:question.question,reason:'Assessment requested.',coverage:packet.requestComponents.map(requestSpan=>({requestSpan,claimIndices:packet.answer.claims.map((_c,index)=>index),answerForm:'assessment',requestedAction:'shot',temporalRelation:'none'}))}});
 const mock=sequenceTransport([planner,packet=>{ids=['home-10','away-10'].map(id=>packet.matchFacts.facts.find(f=>f.selection.kind==='shooting-profile'&&f.selection.subjectId===id&&f.selection.timeFrom===0).id);return {scope:'match',composition:{mode:'facts',factIds:ids},followUp:''};},review,(packet,body)=>{
  assert.equal(packet.feedback.requestAdequacy[0].answerForm,'assessment');assert.match(body.messages[0].content,/qualified conclusion/);
  return {scope:'match',composition:{mode:'explanation',factIds:ids,claim:{text:'Reed looks more threatening on the recorded shot outcomes, though those counts do not measure chance quality.',kind:'interpretation',evidence:[],dependsOn:[0,1]}},followUp:''};
 },review]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher,canRepair:()=>true});assert.equal(result.execution.modelCalls,5);assert.equal(result.claims.at(-1).kind,'interpretation');assert.equal(result.execution.repairs,1);
});

test('known shooter plus unavailable speed becomes an explicit fact and limitation, not an invented measurement or repeated omission',async()=>{
 const question={kind:'counter',seed:1007,time:115,question:'How fast did that last shot travel, and who hit it?'};let shot;
 const planner={mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'shot'},aggregate:'list',order:'desc',limit:1}]}};
 const review=packet=>({decision:'approve',reason:'Known shooter, speed is unavailable.',requestCheck:{status:'answered',requestedInformation:question.question,reason:'Separate known identity and unavailable measurement.',coverage:packet.requestComponents.map((requestSpan,index)=>({requestSpan,claimIndices:index?[0]:packet.answer.claims.length>1?[1]:[],answerForm:index?'fact':'unavailable-measurement',requestedAction:'shot',temporalRelation:'none'}))}});
 const mock=sequenceTransport([planner,packet=>{shot=packet.matchFacts.facts.find(f=>f.selection.kind==='ordered-event'&&f.selection.metric==='attempts');assert.match(shot.claim.text,/Murray/);return {scope:'match',composition:{mode:'facts',factIds:[shot.id]},followUp:''};},review,(packet,body)=>{
  assert.equal(packet.feedback.requestAdequacy[0].answerForm,'unavailable-measurement');assert.match(body.messages[0].content,/known fact and one limitation/);
  return {scope:'match',composition:{mode:'explanation',factIds:[shot.id],claim:{text:'The shot speed is not recorded.',kind:'limitation',evidence:[],dependsOn:[]}},followUp:''};
 },review],(_packet,index,body)=>{if(index===2)assert.match(body.messages[0].content,/premiseCheck and your reasons are internal and cannot answer the fan/);});
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher,canRepair:()=>true});assert.equal(result.execution.modelCalls,5);assert.equal(result.claims.length,2);assert.equal(result.claims[0].text,shot.claim.text);assert.equal(result.claims[1].kind,'limitation');assert.doesNotMatch(result.answer,/\d+\s*(?:km\/h|mph)/);
});

test('recorded contact attribute plus unavailable velocity remains two explicit components with empty limitation dependencies',async()=>{
 const source={kind:'duel',seed:19437,time:14},event=executeMatchQuery(source,{filters:{type:'pass'},order:'asc',limit:1}).rows[0];
 const question={...source,anchorId:event.id,question:'About that pass — which foot contacted it, and is its velocity measured?'};
 const mock=sequenceTransport([{mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{id:question.anchorId},aggregate:'list'}]}},packet=>{
  assert.deepEqual(packet.requestComponents,['which foot contacted it','is its velocity measured']);
  const attribute=packet.matchFacts.facts.find(f=>f.selection.attributes?.bodyPart===event.bodyPart&&f.selection.time===event.time);assert.ok(attribute);assert.match(attribute.claim.text,/foot/);
  return {scope:'match',composition:{mode:'explanation',factIds:[attribute.id],claim:{text:'The velocity of that delivery is not recorded.',kind:'limitation',evidence:[],dependsOn:[]}},followUp:''};
 },(packet,body)=>{
  const policy=body.messages[0].content;assert.match(policy,/FIRST fill responseIntent/);assert.doesNotMatch(policy,/SECOND check every claim|FIRST fill requestCheck/);
  assert.ok(body.response_format.json_schema.schema.properties.requestCheck.required.includes('responseIntent'));
  return {decision:'approve',requestCheck:{requestedInformation:question.question,status:'useful-limitation',responseIntent:{purpose:'mixed',needsAssessment:false,needsExplicitCorrection:false,needsMeasurementLimitation:true,reason:'Known contact attribute and unrecorded velocity.'},coverage:packet.requestComponents.map((requestSpan,index)=>({requestSpan,claimIndices:[index],answerForm:index?'unavailable-measurement':'fact',requestedAction:'other',temporalRelation:'none',relationAnchorClaimIndex:null,relationEntityBinding:'none'})),reason:'Both requested attributes are addressed.'}};
 }]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.equal(result.claims.length,2);assert.equal(result.canonicalFactSelection.proofs[0].attributes.bodyPart,event.bodyPart);assert.equal(result.claimProvenance[1].modelGenerated,true);assert.doesNotMatch(result.answer,/\d+\s*(?:mph|km\/h)/);
});

test('implicit contribution request receives a bounded repair when whole-request intent requires an assessment',async()=>{
 const source={kind:'interrupted',seed:52109,time:115},player=executeMatchQuery(source,{filters:{type:'pass',team:'home'},order:'desc',limit:1}).rows[0];
 const question={...source,question:`Is ${player.player} making a useful defensive contribution, or mainly circulating the ball?`};let chosen;
 const plan={mentionedPlayers:[player.player],decision:{kind:'queries',queries:[{filters:{type:'recovery',recoveryClass:'ball-win',player:player.playerId},aggregate:'count'},{filters:{type:'pass',result:true,player:player.playerId},aggregate:'count'}]}};
 const review=packet=>({decision:'approve',requestCheck:{requestedInformation:question.question,status:'answered',responseIntent:{purpose:'assessment',needsAssessment:true,needsExplicitCorrection:false,needsMeasurementLimitation:false,reason:'The fan asks for a judgment on contribution, not raw totals.'},coverage:packet.requestComponents.map(requestSpan=>({requestSpan,claimIndices:packet.answer.claims.map((_c,i)=>i),answerForm:'fact',requestedAction:'other',temporalRelation:'none',relationAnchorClaimIndex:null,relationEntityBinding:'none'})),reason:'Judgment must be explicit.'}});
 const mock=sequenceTransport([plan,packet=>{chosen=['ballWins','completedPasses'].map(metric=>packet.matchFacts.facts.find(f=>f.selection.kind==='count'&&f.selection.metric===metric&&f.selection.subjectId===player.playerId));assert.ok(chosen.every(Boolean));return {scope:'match',composition:{mode:'facts',factIds:chosen.map(f=>f.id)},followUp:''};},review,packet=>{
  assert.match(packet.feedback.requestAdequacy[0].reason,/qualified assessment/);
  return {scope:'match',composition:{mode:'explanation',factIds:chosen.map(f=>f.id),claim:{text:'Those actions show involvement in circulation and regaining the ball, but they do not establish the overall defensive impact.',kind:'interpretation',evidence:[],dependsOn:[0,1]}},followUp:''};
 },review]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher,canRepair:()=>true});assert.equal(result.execution.modelCalls,5);assert.equal(result.claims.at(-1).kind,'interpretation');assert.match(result.answer,/overall defensive impact/);
});

test('a declared false scorer premise needs an explicit correction in addition to source facts and preserves the requested attribute',async()=>{
 const source={kind:'sustained',seed:46382,time:120},goal=executeMatchQuery(source,{filters:{type:'shot',result:true},order:'desc',limit:1}).rows[0],wrong=executeMatchQuery(source,{filters:{type:'pass'},order:'asc',limit:20}).rows.find(row=>row.playerId!==goal.playerId);
 const question={...source,question:`Was ${wrong.player}'s goal a header?`};let ids;
 const premiseCheck={questionAssumption:`${wrong.player} scored the goal.`,recordedAction:`The goal actor is ${goal.player}.`,conclusion:'contradicted'};
 const plan={mentionedPlayers:[wrong.player],decision:{kind:'queries',queries:[{filters:{type:'shot',result:true},aggregate:'list'},{filters:{type:'shot',result:true,player:wrong.playerId},aggregate:'count'}]}};
 const mock=sequenceTransport([plan,packet=>{
  const attribute=packet.matchFacts.facts.find(f=>f.selection.attributes?.bodyPart===goal.bodyPart&&f.selection.playerId===goal.playerId&&f.selection.time===goal.time),zero=packet.matchFacts.facts.find(f=>f.selection.kind==='count'&&f.selection.metric==='goals'&&f.selection.subjectId===wrong.playerId);assert.ok(attribute&&zero);
  ids=[zero.id,attribute.id];return {premiseCheck,scope:'match',composition:{mode:'facts',factIds:ids},followUp:''};
 },packet=>{
  assert.match(packet.feedback.requirement,/explicit correction/);
  return {premiseCheck,scope:'match',composition:{mode:'explanation',factIds:ids,claim:{text:`The scorer was ${goal.player}, rather than ${wrong.player}.`,kind:'interpretation',evidence:[],dependsOn:[0,1]}},followUp:''};
 },packet=>({decision:'approve',requestCheck:{requestedInformation:question.question,status:'corrected-premise',responseIntent:{purpose:'premise-correction',needsAssessment:false,needsExplicitCorrection:true,needsMeasurementLimitation:false,reason:'The assumed scorer needs correction and the known contact attribute is retained.'},coverage:packet.requestComponents.map(requestSpan=>({requestSpan,claimIndices:[0,1,2],answerForm:'premise-correction',requestedAction:'other',temporalRelation:'none',relationAnchorClaimIndex:null,relationEntityBinding:'none'})),reason:'Explicit correction with source-bound contact attribute.'}})]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher,canRepair:()=>true});assert.equal(result.execution.modelCalls,4);assert.equal(result.execution.repairs,1);assert.match(result.answer,/rather than/);assert.ok(result.canonicalFactSelection.proofs.some(proof=>proof.attributes?.bodyPart===goal.bodyPart));
});

test('semantic coverage cannot substitute a reception or initial control for regained possession',()=>{
 const input={kind:'interrupted',seed:1007,time:106},state=matchState(input),received=state.events.find(event=>event.type==='receive'&&event.time===103),won=state.events.find(event=>event.type==='recovery'&&event.time===92),initial=state.events.find(event=>event.recoveryKind==='segment-start');
 const packet={question:'Who regained possession?',observedAt:106,queryResults:[],linkedContext:{rows:[received,won,initial]}};
 const review={requestCheck:{coverage:[{requestSpan:packet.question,claimIndices:[0],answerForm:'fact',requestedAction:'ball-win',temporalRelation:'none'}]}};
 const answer=event=>({claims:[{kind:'observation',text:'A recorded action.',evidence:[{type:'event',id:event.id,revision:event.revision}]}]});
 assert.equal(reviewRequestAdequacy(review,answer(received),packet).length,1);assert.equal(reviewRequestAdequacy(review,answer(initial),packet).length,1);assert.deepEqual(reviewRequestAdequacy(review,answer(won),packet),[]);
 const relative={requestCheck:{coverage:[{...review.requestCheck.coverage[0],requestedAction:'receive',temporalRelation:'after-requested-event'}]}};
 assert.match(reviewRequestAdequacy(relative,answer(received),packet)[0].reason,/relative sequence/);
});

test('default fan recovery metrics exclude initial control while an explicit raw-record lookup remains distinct',async()=>{
 const question={kind:'quiet',seed:1007,time:3,question:'How many provider recovery records have arrived?'};
 const mock=sequenceTransport([{mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'recovery'},aggregate:'count'}]}},packet=>{
  for(const comparison of [packet.fullMatchComparison,packet.recentComparison]){
   const metric=comparison.metrics.find(metric=>metric.filters.type==='recovery');assert.equal(metric.filters.recoveryClass,'ball-win');assert.ok(metric.teams.every(team=>team.count===0));
  }
  const contribution=packet.playerContributions.metrics.find(metric=>metric.name==='recoveries');
  const sources=wireQueries(packet);assert.ok(contribution.evidence.every(ref=>sources.some(source=>source.scopeReference.id===ref.id&&source.query.filters.recoveryClass==='ball-win'&&source.count===0)));
  const explicit=packet.requestedEvidence.find(source=>source.query.filters.type==='recovery');assert.equal(explicit.query.filters.recoveryClass,undefined);assert.equal(explicit.count,1);
  const fact=packet.matchFacts.facts.find(fact=>fact.selection.kind==='count'&&fact.selection.metric==='recoveries'&&fact.claim.evidence.some(ref=>ref.id===explicit.scopeReference.id));assert.ok(fact);assert.match(fact.claim.text,/recovery record/);
  return {scope:'match',composition:{mode:'facts',factIds:[fact.id]},followUp:''};
 },{decision:'approve',reason:'Explicit raw-record request is kept distinct from ball wins.'}]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.doesNotMatch(result.answer,/won|ball win/i);
});

test('semantic answer-form checks accept general explanation without inventing match action evidence',()=>{
 const answer={scope:'general',claims:[{kind:'general',text:'An offside position alone is not an offence.',evidence:[]}]};
 const review={requestCheck:{coverage:[{requestSpan:'Why?',claimIndices:[0],answerForm:'explanation',requestedAction:'shot',temporalRelation:'none'}]}};
 assert.deepEqual(reviewRequestAdequacy(review,answer,{queryResults:[],question:'Why?'}),[]);
});

test('positive same-team chronology is proved from a canonical ordered anchor and current event without a dependent lookup',async()=>{
 const question={kind:'interrupted',seed:1007,time:106,question:'Who got the ball back most recently, and did their side get a shot away afterwards?'};
 let captured,review;
 const mock=sequenceTransport([{mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'recovery',recoveryClass:'ball-win'},aggregate:'list',order:'desc',limit:1}]}},packet=>{
  const anchor=packet.matchFacts.facts.find(f=>f.selection.kind==='ordered-event'&&f.selection.metric==='ballWins');
  const shot=packet.matchFacts.facts.find(f=>f.selection.kind==='event'&&f.selection.eventType==='shot'&&f.selection.time===105);
  assert.match(anchor.claim.text,/Patel/);assert.match(shot.claim.text,/Evans/);assert.equal(packet.queryRelations,undefined);
  return {scope:'match',composition:{mode:'facts',factIds:[anchor.id,shot.id]},followUp:''};
 },(packet,body)=>{
  captured=packet;const schema=body.response_format.json_schema.schema.properties.requestCheck.properties.coverage.items.properties;
  assert.deepEqual(schema.relationAnchorClaimIndex.anyOf[0].enum,[0,1]);assert.deepEqual(schema.relationEntityBinding.enum,['none','same-team','same-player']);
  review={decision:'approve',requestCheck:{requestedInformation:question.question,status:'answered',reason:'Latest classified ball win and a later same-team shot.',coverage:packet.requestComponents.map((requestSpan,index)=>({requestSpan,claimIndices:[index],answerForm:'fact',requestedAction:index?'shot':'ball-win',temporalRelation:index?'after-requested-event':'none',relationAnchorClaimIndex:index?0:null,relationEntityBinding:index?'same-team':'none'}))}};
  return review;
 }]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.equal(result.queryRelations,undefined);assert.equal(result.provenance.modelGenerated,false);assert.match(result.answer,/Patel.*01:32.*Evans.*01:45/);
 assert.equal(result.relationWitnesses.length,1);assert.equal(result.relationWitnesses[0].team,'away');assert.equal(result.relationWitnesses[0].proves,'positive-existence');assert.ok(result.relationWitnesses[0].doesNotProve.includes('causation'));assert.ok(result.evidence.some(ref=>ref.id===result.relationWitnesses[0].anchorScope.id));
 const check=(r=review,answer=captured.answer,packet=captured.evidence,selection=captured.canonicalFactSelection)=>reviewRequestAdequacy(r,answer,packet,{canonicalFactSelection:selection});
 assert.deepEqual(check(),[]);
 for(const modification of [{relationEntityBinding:'same-player'},{relationAnchorClaimIndex:1},{relationAnchorClaimIndex:null},{temporalRelation:'before-requested-event'},{requestedAction:'pass'},{relationEntityBinding:'unknown'}]){
  const invalid=structuredClone(review);Object.assign(invalid.requestCheck.coverage[1],modification);assert.ok(check(invalid).length,JSON.stringify(modification));
 }
 const stale=structuredClone(captured.canonicalFactSelection);stale.proofs[1].revision++;assert.ok(check(review,captured.answer,captured.evidence,stale).length);
 const incidental=structuredClone(captured.canonicalFactSelection);incidental.proofs[0]=incidental.proofs[0].event;assert.ok(check(review,captured.answer,captured.evidence,incidental).length,'An arbitrary nearby event does not prove latest anchor selection');
 const opposite=structuredClone(captured.evidence);opposite.linkedContext.rows.find(row=>row.id.endsWith('shot-105')).team='home';assert.ok(check(review,captured.answer,opposite).length,'A later opponent event cannot prove their side acted');
 const simultaneous=structuredClone(captured.evidence),equalProof=structuredClone(captured.canonicalFactSelection);simultaneous.linkedContext.rows.find(row=>row.id.endsWith('shot-105')).time=92;equalProof.proofs[1].time=92;assert.ok(check(review,captured.answer,simultaneous,equalProof).length,'After is strict, not simultaneous');
 const absent={scope:'match',claims:[captured.answer.claims[0],{text:'No later shot.',kind:'observation',evidence:[]}]};assert.ok(check(review,absent).length,'Missing positive evidence never establishes absence');
});

test('entity-only dependency binds the first shooter to a separately requested full or restricted count window',async()=>{
 const question={kind:'duel',seed:1007,time:106,question:'Who took Harbour’s first shot, and how many attempts has that player had?'};
 for(const from of [0,60]){
  let actor,expected;
  const mock=sequenceTransport([{mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'shot',team:'away'},aggregate:'list',order:'asc',limit:1},{filters:{type:'shot'},aggregate:'count',timeFrom:from,timeTo:106,relativeTo:{queryIndex:0,relation:'none',sameTeam:false,samePlayer:true}}]}},packet=>{
   const relation=packet.queryRelations[0];actor=relation.anchorPlayerId;assert.equal(actor,'away-10');assert.equal(relation.anchorTime,46);assert.equal(relation.query.filters.player,actor);assert.equal(relation.query.timeFrom,from);assert.equal(relation.query.timeFromExclusive,undefined);
   expected=matchState(question).events.filter(row=>row.type==='shot'&&row.playerId===actor&&row.time>=from&&row.time<=106).length;
   const first=packet.matchFacts.facts.find(f=>f.selection.kind==='ordered-event'&&f.selection.metric==='attempts');
   const total=packet.matchFacts.facts.find(f=>f.selection.kind==='count'&&f.selection.metric==='attempts'&&f.selection.subjectId===actor&&f.selection.timeFrom===from&&f.claim.evidence.some(ref=>ref.id===relation.scopeReference.id));
   assert.ok(total);assert.match(total.claim.text,new RegExp(String(expected)));
   return {scope:'match',composition:{mode:'facts',factIds:[first.id,total.id]},followUp:''};
  },{decision:'approve',reason:'The independent count is bound to the retrieved actor, not a guessed roster position.'}],(_packet,index,body)=>{
   if(index)return;const variants=decisionBranch(body,'queries').properties.queries.items.anyOf;
   const entity=variants.find(v=>v.properties.relativeTo.properties?.relation.enum.includes('none'));
   assert.deepEqual(entity.properties.relativeTo.properties.samePlayer.enum,[true]);assert.deepEqual(entity.properties.filters.anyOf[0].properties.player,{type:'null'});assert.notDeepEqual(entity.properties.timeFrom,{type:'null'});
  });
  const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.equal(result.queryRelations[0].anchorPlayerId,actor);assert.equal(result.canonicalFactSelection.proofs[1].value,expected);
 }
});

test('entity dependencies reject ambiguous anchors and authored conflicting actors, preserving temporal strictness',async()=>{
 const question={kind:'duel',seed:1007,time:106,question:'Count the actions by the first shooter.'};
 const anchor={filters:{type:'shot',team:'away'},aggregate:'list',order:'asc',limit:1};
 const dependent={filters:{type:'shot'},aggregate:'count',timeFrom:0,timeTo:106,relativeTo:{queryIndex:0,relation:'none',sameTeam:false,samePlayer:true}};
 for(const queries of [[dependent],[{...anchor,limit:20},dependent],[{...anchor,filters:{type:'shot',team:'away',result:true}},dependent],[anchor,{...dependent,filters:{type:'shot',player:'away-1'}}],[anchor,{...dependent,relativeTo:{...dependent.relativeTo,samePlayer:false}}],[anchor,{...dependent,relativeTo:{...dependent.relativeTo,relation:'after'}}]]){
  const mock=sequenceTransport([{mentionedPlayers:[],decision:{kind:'queries',queries}}]);await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:mock.fetcher}),/lookup/);assert.equal(mock.count(),1);
 }
});

test('same-player temporal dependencies preserve strict windows and do not turn the actor into a guessed recipient',async()=>{
 const question={kind:'duel',seed:1007,time:106,question:'Who took the first Harbour shot, and how many shots did that player have afterwards?'};
 const mock=sequenceTransport([{mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'shot',team:'away'},aggregate:'list',order:'asc',limit:1},{filters:{type:'shot'},aggregate:'count',relativeTo:{queryIndex:0,relation:'after',sameTeam:false,samePlayer:true}}]}},packet=>{
  const relation=packet.queryRelations[0];assert.equal(relation.anchorPlayerId,'away-10');assert.equal(relation.query.timeFrom,46);assert.equal(relation.query.timeFromExclusive,true);
  const first=packet.matchFacts.facts.find(f=>f.selection.kind==='ordered-event'&&f.selection.metric==='attempts');
  const count=packet.matchFacts.facts.find(f=>f.selection.kind==='count'&&f.selection.timeFrom===46&&f.selection.subjectId==='away-10');assert.ok(count);assert.match(count.claim.text,/1 shot/);
  return {scope:'match',composition:{mode:'facts',factIds:[first.id,count.id]},followUp:''};
 },packet=>({decision:'approve',requestCheck:{status:'answered',requestedInformation:question.question,reason:'Actor-bound count with strict start.',coverage:packet.requestComponents.map((requestSpan,index)=>({requestSpan,claimIndices:[index],answerForm:'fact',requestedAction:'shot',temporalRelation:index?'after-requested-event':'none',relationAnchorClaimIndex:index?0:null,relationEntityBinding:index?'same-player':'none'}))}})]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.equal(result.queryRelations[0].samePlayer,true);assert.equal(result.canonicalFactSelection.proofs[1].value,1);
});

test('canonical composite normalization remaps raw dependencies before validation and reviews final claim indices',async()=>{
 const question={kind:'counter',seed:48371,time:117,question:'What does the confirmed score tell us?'};let requested;
 const planner={mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'shot'},aggregate:'list',order:'desc',limit:1}]}};
 const mock=sequenceTransport([planner,packet=>{
  const composite=packet.matchFacts.facts.find(f=>f.selection.kind==='confirmed-score');assert.ok(composite);
  const atoms=['home','away'].map(id=>packet.matchFacts.facts.find(f=>f.selection.kind==='count'&&f.selection.metric==='goals'&&f.selection.subjectId===id&&f.selection.timeFrom===0));
  requested=[atoms[0].id,composite.id,atoms[1].id];
  return {scope:'match',composition:{mode:'explanation',factIds:requested,claim:{text:'That confirmed score does not settle the unresolved attempt.',kind:'interpretation',evidence:[],dependsOn:[0,2]}},followUp:''};
 },(packet,body)=>{
  assert.equal(packet.answer.claims.length,2);assert.deepEqual(packet.canonicalClaimIndices,[0]);assert.deepEqual(packet.canonicalFactSelection.requestedFactIds,requested);assert.deepEqual(packet.canonicalFactSelection.originalToSelectedIndex,[0,0,0]);
  assert.deepEqual(body.response_format.json_schema.schema.properties.requestCheck.properties.coverage.items.properties.claimIndices.items.enum,[0,1]);
  assert.equal(packet.answer.claimDependencies.length,1);assert.deepEqual(packet.answer.claimDependencies[0].observationIndices,[0]);
  return {decision:'approve',reason:'The same proved score supports the interpretation after exact operand normalization.'};
 }]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.claims.length,2);assert.equal(result.canonicalFactSelection.normalizations.length,2);assert.deepEqual(result.canonicalFactSelection.dependencyMappings,[{proseIndex:0,requestedIndices:[0,2],selectedIndices:[0]}]);assert.deepEqual(result.claimProvenance.map(p=>p.modelGenerated),[false,true]);
 for(const indices of [[0,0],[3],[-1],[0.5]]){
  const invalid=sequenceTransport([planner,()=>({scope:'match',selectedFactIds:requested,claims:[{text:'A supported conclusion.',kind:'interpretation',evidence:[],dependsOn:indices}],followUp:''})]);
  await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:invalid.fetcher}),error=>error.code==='question-invalid-fact-selection');assert.equal(invalid.count(),2,'Invalid raw dependencies cannot be hidden by normalization');
 }
});

test('approved coverage prunes an unrelated canonical pass while preserving shooter, limitation and audit without another model call',async()=>{
 const question={kind:'counter',seed:1007,time:115,question:'How fast did that last shot travel, and who hit it?'};let requested,limitation;
 const mock=sequenceTransport([{mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'shot'},aggregate:'list',order:'desc',limit:1}]}},(packet,body)=>{
  const shot=packet.matchFacts.facts.find(f=>f.selection.kind==='ordered-event'&&f.selection.metric==='attempts');
  const pass=packet.matchFacts.facts.find(f=>f.selection.kind==='event'&&f.selection.eventType==='pass'&&f.selection.time===115);assert.ok(pass);
  requested=[shot.id,pass.id];limitation='The speed of the shot is not recorded.';
  assert.match(body.messages[0].content,/do not restate the selected actor, clock or action outcome/);
  return {scope:'match',composition:{mode:'explanation',factIds:requested,claim:{text:limitation,kind:'limitation',evidence:[],dependsOn:[]}},followUp:''};
 },packet=>({decision:'approve',requestCheck:{requestedInformation:question.question,status:'useful-limitation',reason:'The shooter is known and speed unavailable.',coverage:packet.requestComponents.map((requestSpan,index)=>({requestSpan,claimIndices:index?[0]:[2],answerForm:index?'fact':'unavailable-measurement',requestedAction:'shot',temporalRelation:'none',relationAnchorClaimIndex:index?0:2,relationEntityBinding:'none'}))}})]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.equal(result.execution.repairs,0);
 assert.equal(result.claims.length,2);assert.match(result.claims[0].text,/Murray/);assert.equal(result.claims[1].text,limitation);assert.doesNotMatch(result.answer,/Demir/);
 assert.deepEqual(result.canonicalFactSelection.requestedFactIds,requested);assert.deepEqual(result.canonicalFactSelection.selectedFactIds,[requested[0]]);assert.deepEqual(result.canonicalFactSelection.originalToSelectedIndex,[0,null]);
 assert.deepEqual(result.claimProvenance.map(p=>p.claimIndex),[0,1]);assert.equal(result.claimProvenance[1].modelGenerated,true);assert.equal(result.provenance.modelGenerated,true);
 assert.ok(result.evidence.every(ref=>!ref.id.endsWith('pass-115')));assert.ok(result.moments.every(moment=>!moment.anchorId.endsWith('pass-115')));
 assert.deepEqual(result.coveragePruning.originalToFinalClaimIndex,[0,null,1]);assert.deepEqual(result.coveragePruning.reviewAfter.requestCheck.coverage.map(p=>p.claimIndices),[[1],[0]]);assert.equal(result.coveragePruning.reviewBefore.checks.length,3);assert.equal(result.coveragePruning.reviewAfter.checks.length,2);
 assert.equal(result.coveragePruning.removed[0].claim.text.includes('Demir'),true);
});

test('planner wire licenses pass outcome filters without restricting supporting shot queries or permitting an untyped bypass',async()=>{
 for(const [question,allowed] of [['Who did my favourite last pass to?',[]],['Was the latest pass completed?',[]],['Who made the latest completed pass?',[true]],['Who made the latest unsuccessful pass?',[false]],['Who made the latest pass, not just completed ones?',[]],['¿Quién hizo el último pase?',[]],['Qui a fait la dernière passe ?',[]],['Quem fez o último passe?',[]]]){
  const mock=sequenceTransport([{mentionedPlayers:[],decision:{kind:'queries',queries:[]}}, {scope:'match',claims:[{kind:'limitation',text:'Please identify the player.',evidence:[]}],followUp:''},{decision:'approve'}],(_packet,call,body)=>{
   if(call)return;
   const raw=body.response_format.json_schema.schema,rawQueries=raw.properties.decision.anyOf.find(branch=>branch.properties.kind.enum.includes('queries')).properties.queries.items.anyOf;
   const definitions=Object.keys(raw.$defs||{});assert.equal(definitions.length,2,'Share ordinary and entity-bound filter definitions across all query modes');
   const references=new Set(rawQueries.map(variant=>variant.properties.filters.$ref));assert.equal(references.size,2);assert.ok(definitions.every(name=>references.has(`#/$defs/${name}`)),'Every emitted definition is used');
   for(const definition of Object.values(raw.$defs))for(const branch of definition.anyOf.filter(branch=>branch.properties)){assert.equal(branch.additionalProperties,false);assert.deepEqual(new Set(branch.required),new Set(Object.keys(branch.properties)));}
   assert.ok(JSON.stringify(raw).length<25000,'Permission constraints must not duplicate the filter schema for every query mode');
   const variants=decisionBranch(body,'queries').properties.queries.items.anyOf;
   for(const variant of variants){
    const filters=variant.properties.filters.anyOf,pass=filters.find(branch=>branch.properties?.type.enum?.includes('pass')),other=filters.find(branch=>branch.properties?.type.enum?.includes('shot')),untyped=filters.find(branch=>branch.properties?.type.type==='null');
    assert.ok(pass&&other&&untyped);assert.deepEqual(pass.properties.result,allowed.length?{anyOf:[{type:'boolean',enum:allowed},{type:'null'}]}:{type:'null'});
    assert.deepEqual(pass.properties.outcome,{type:'null'});assert.deepEqual(untyped.properties.result,{type:'null'});assert.deepEqual(untyped.properties.outcome,{type:'null'});
    assert.notDeepEqual(other.properties.result,{type:'null'});assert.equal(other.properties.type.enum.includes('pass'),false);
   }
  });
  await answerMatchQuestionAI({...input,question},{config,fetcher:mock.fetcher});
 }
});

test('recipient planning repair identifies forbidden fields and preserves favourite actor and actual latest pass',async()=>{
 const question={kind:'quiet',seed:1014,time:80,audience:'player',favoriteClub:'home',favoritePlayer:'E. Khan',question:'Who did my favourite last pass to?'};
 const plan=result=>({mentionedPlayers:['E. Khan'],decision:{kind:'queries',queries:[{filters:{type:'pass',team:'home',player:'home-7',result},aggregate:'list',order:'desc',limit:1,timeFrom:0,timeTo:80}]}});
 let selected;
 const mock=sequenceTransport([plan(true),plan(null),packet=>{
  selected=packet.matchFacts.facts.find(f=>f.selection.kind==='ordered-event'&&f.selection.metric==='passes');assert.ok(selected);assert.match(selected.claim.text,/E\. Khan completed a pass to Z\. James at 01:13/);
  return {scope:'match',composition:{mode:'facts',factIds:[selected.id]},followUp:''};
 },{decision:'approve'}],(packet,call)=>{
  if(call===1){assert.equal(packet.planningCorrection.kind,'unlicensed-outcome-filter');assert.deepEqual(packet.planningCorrection.fields,[{path:'decision.queries[0].filters.result',rejectedValue:true,allowedValues:[null]}]);assert.deepEqual(packet.planningCorrection.permission.results,[]);assert.match(packet.planningCorrection.instruction,/older completed pass/);assert.equal(packet.viewerProfile.favoritePlayerResolution.canonicalId,'home-7');}
 });
 const answer=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher,canRepair:required=>required===3});
 assert.equal(answer.execution.modelCalls,4);assert.equal(answer.execution.planningRepairs,1);assert.equal(answer.answer,selected.claim.text);assert.equal(answer.provenance.modelGenerated,false);
 assert.equal(answer.canonicalFactSelection.proofs[0].event.recipient.playerId,'home-6');assert.equal(answer.canonicalFactSelection.proofs[0].event.recipient.status,'confirmed-recipient');
});

test('arbitrary favourite identity and latest failed recipient are source-bound instead of substituted by an older completion',async()=>{
 const source={kind:'sustained',seed:92761,time:67},latest=executeMatchQuery(source,{filters:{type:'pass'},order:'desc',limit:1}).rows[0];
 const question={...source,audience:'analyst',favoriteClub:'away',question:'Who did my favourite last pass to?'};
 // Use the received identity dictionary, never the names from an earlier fixture.
 question.favoritePlayer=latest.player;
 const plan={mentionedPlayers:[latest.player],decision:{kind:'queries',queries:[{filters:{type:'pass',player:latest.playerId},aggregate:'list',order:'desc',limit:1}]}};
 let selected;
 const mock=sequenceTransport([plan,packet=>{selected=packet.matchFacts.facts.find(f=>f.selection.kind==='ordered-event'&&f.selection.metric==='passes');assert.ok(selected);assert.match(selected.claim.text,/recorded target.*unsuccessful/);return {scope:'match',composition:{mode:'facts',factIds:[selected.id]},followUp:''};},{decision:'approve'}]);
 const answer=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(answer.execution.modelCalls,3);assert.equal(answer.canonicalFactSelection.proofs[0].event.eventId,latest.id);assert.equal(answer.canonicalFactSelection.proofs[0].event.recipient.status,'recorded-target');assert.equal(answer.answer,selected.claim.text);
});

test('validated viewer preferences reach planning, writing and review without changing an explicitly requested player scope',async()=>{
 const question={kind:'duel',seed:48371,time:120,question:'How many shots has Reed had?',audience:'analyst',favoriteClub:'away',favoritePlayer:'D. Silva'};let profile;
 const mock=sequenceTransport([{mentionedPlayers:['A. Reed'],decision:{kind:'queries',queries:[{filters:{type:'shot',player:'A. Reed'},aggregate:'count'}]}},packet=>{
  assert.deepEqual(packet.viewerProfile,profile);assert.equal(packet.requestedEvidence[0].entityResolution.player.canonicalId,'home-10');
  const fact=packet.matchFacts.facts.find(f=>f.selection.kind==='count'&&f.selection.metric==='attempts'&&f.selection.subjectId==='home-10'&&f.claim.evidence.some(ref=>ref.id===packet.requestedEvidence[0].scopeReference.id));assert.ok(fact);
  return {scope:'match',composition:{mode:'facts',factIds:[fact.id]},followUp:''};
 },packet=>{assert.deepEqual(packet.viewerProfile,profile);return {decision:'approve',reason:'Explicit Reed request has priority over the Silva preference.'};}],(packet,index,body)=>{
  assert.match(body.messages[0].content,/Explicit requested players, teams, actions, comparisons, windows and filters always take priority/);
  if(!index){profile=packet.viewerProfile;assert.equal(profile.audience,'analyst');assert.equal(profile.favoriteClub,'away');assert.equal(profile.favoritePlayer,'D. Silva');assert.equal(profile.favoritePlayerResolution.status,'resolved');assert.equal(profile.favoritePlayerResolution.canonicalId,'away-10');}
 });
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.match(result.answer,/Reed/);assert.doesNotMatch(result.answer,/Silva/);assert.deepEqual(result.viewerProfile,profile);assert.equal(result.execution.modelCalls,3);
});

test('general minimal packets keep audience preferences with no match evidence and default to newcomer',async()=>{
 for(const audience of [undefined,'newcomer','analyst','player']){
  const question={kind:'quiet',seed:17,time:10,question:'What is a brace?',...(audience?{audience}: {})};
  const mock=sequenceTransport([{mentionedPlayers:[],decision:{kind:'general',concepts:[]}},{scope:'general',claims:[{text:'A brace is two goals by the same player in a game.',kind:'general',evidence:[]}],followUp:''},{decision:'approve'}],(packet,index,body)=>{
   assert.equal(packet.viewerProfile.audience,audience||'newcomer');assert.equal(packet.viewerProfile.favoritePlayerResolution,null);assert.equal(packet.viewerProfile.favoriteClub,null);
   assert.match(body.messages[0].content,/For newcomer/);assert.match(body.messages[0].content,/For analyst/);assert.match(body.messages[0].content,/Simple factual answers may correctly be identical/);
   if(index===1)for(const field of ['score','roster','queryResults','selectedAnchor'])assert.equal(packet[field],undefined);
  });
  const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.viewerProfile.audience,audience||'newcomer');assert.equal(result.evidence.length,0);
 }
});

test('absent and ambiguous favourite players stay unresolved presentation context rather than zero-action match participants',async()=>{
 for(const [favoritePlayer,status] of [['Messi','absent'],['Costa','ambiguous']]){
  const question={kind:'sustained',seed:48371,time:67,question:'How is my favourite player doing?',audience:'player',favoritePlayer};
  const mock=sequenceTransport([{mentionedPlayers:[],decision:{kind:'queries',queries:[]}},{scope:'clarify',claims:[{text:'Which player would you like to focus on?',kind:'limitation',evidence:[]}],followUp:''},{decision:'approve'}],packet=>{
   assert.equal(packet.viewerProfile.favoritePlayerResolution.status,status);assert.equal(packet.viewerProfile.favoritePlayerResolution.canonicalId,null);
   assert.equal(packet.viewerProfile.favoritePlayerResolution.candidates.length,status==='absent'?0:2);
  });
  const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.scope,'clarify');assert.equal(result.evidence.length,0);assert.doesNotMatch(result.answer,/zero|0/);assert.equal(result.viewerProfile.favoritePlayerResolution.status,status);
 }
});

test('a genuinely deictic favourite-player request can use the resolved roster identity without changing its window',async()=>{
 const question={kind:'duel',seed:48371,time:120,question:'How many shots has my favourite player had?',audience:'player',favoritePlayer:'D. Silva'};
 const mock=sequenceTransport([packet=>({mentionedPlayers:[packet.viewerProfile.favoritePlayer],decision:{kind:'queries',queries:[{filters:{type:'shot',player:packet.viewerProfile.favoritePlayerResolution.canonicalId},aggregate:'count',timeFrom:0,timeTo:120}]}}),packet=>{
  const scope=packet.requestedEvidence.find(q=>q.query.filters.type==='shot');assert.equal(scope.query.filters.player,'away-10');assert.equal(scope.query.timeFrom,0);assert.equal(scope.query.timeTo,120);
  const count=packet.matchFacts.facts.find(f=>f.selection.kind==='count'&&f.selection.metric==='attempts'&&f.claim.evidence.some(ref=>ref.id===scope.scopeReference.id));assert.ok(count);
  return {scope:'match',composition:{mode:'facts',factIds:[count.id]},followUp:''};
 },{decision:'approve',reason:'The genuine favourite-player reference is bound to a known roster identity.'}]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.match(result.answer,/Silva/);assert.equal(result.viewerProfile.favoritePlayerResolution.canonicalId,'away-10');assert.equal(result.execution.modelCalls,3);
});

test('collection after an identified shot uses the explicit source link without a redundant anchor sentence',async()=>{
 const question={kind:'interrupted',seed:1008,time:95,language:'es',question:'¿Quién se quedó con el balón tras el tiro de B. Laurent del 1:29?'};
 const mock=sequenceTransport([{mentionedPlayers:['B. Laurent'],decision:{kind:'queries',queries:[{filters:{type:'recovery'},aggregate:'list',timeFrom:90,timeTo:92,limit:1}]}},packet=>{
  const fact=packet.matchFacts.facts.find(f=>f.selection.kind==='event'&&f.selection.eventType==='recovery'&&f.selection.time===91);assert.ok(fact);
  return {scope:'match',composition:{mode:'facts',factIds:[fact.id]},followUp:''};
 },packet=>{
  const index=packet.sourceSequenceLinks.findIndex(link=>link.anchorTime===89&&link.witnessTime===91);assert.ok(index>=0);
  return {decision:'approve',requestCheck:{requestedInformation:question.question,status:'answered',reason:'Exact source-linked collection.',coverage:packet.requestComponents.map(requestSpan=>({requestSpan,claimIndices:[0],answerForm:'fact',requestedAction:'recovery',temporalRelation:'after-requested-event',relationAnchorClaimIndex:null,relationEntityBinding:'none',relationSourceLinkIndex:index}))}};
 }]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.match(result.answer,/Eriksen/);assert.equal(result.claims.length,1);assert.equal(result.relationWitnesses[0].anchorTime,89);
});

test('a complete current score directly corrects a false score premise without redundant numeric prose',async()=>{
 const question={kind:'sustained',seed:1012,time:120,question:'Dunford are two up now, aren’t they?'};
 const mock=sequenceTransport([{mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'shot',result:true},aggregate:'by-team'}]}},packet=>{
  const goals=packet.matchFacts.facts.filter(f=>f.selection.kind==='count'&&f.selection.metric==='goals'&&['home','away'].includes(f.selection.subjectId)&&f.selection.timeFrom===0&&f.selection.timeTo===120);assert.equal(goals.length,2);
  return {premiseCheck:{questionAssumption:'Dunford lead by two.',recordedAction:'Current confirmed score differs.',conclusion:'contradicted'},scope:'match',composition:{mode:'facts',factIds:goals.map(f=>f.id)},followUp:''};
 },packet=>({decision:'approve',requestCheck:{status:'corrected-premise',requestedInformation:question.question,responseIntent:{purpose:'premise-correction',needsAssessment:false,needsExplicitCorrection:true,needsMeasurementLimitation:false,reason:'The complete current score resolves the false margin.'},coverage:packet.requestComponents.map(requestSpan=>({requestSpan,claimIndices:[0,1],answerForm:'premise-correction',requestedAction:'other',temporalRelation:'none',relationAnchorClaimIndex:null,relationSourceLinkIndex:null,relationEntityBinding:'none'})),reason:'Direct current score correction.'}})]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.equal(result.claims.length,2);assert.match(result.answer,/Dunford.*1.*Bracken/i);
});

test('whole-match keeper assessment has complete team on-target scopes distinct from total attempts and recent play',async()=>{
 const question={kind:'duel',seed:1011,time:115,question:'Portwell or Highfield: who’s been making the other keeper busier?'};
 const mock=sequenceTransport([{mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'shot',outcome:'on-target'},aggregate:'by-team',timeFrom:0,timeTo:115}]}},packet=>{
  const facts=packet.matchFacts.facts.filter(f=>f.selection.kind==='count'&&f.selection.metric==='shotsOnTarget'&&['home','away'].includes(f.selection.subjectId)&&f.selection.timeFrom===0&&f.selection.timeTo===115);
  assert.equal(facts.length,2);const scopes=packet.fullMatchComparison.metrics.find(m=>m.filters.outcome==='on-target');assert.ok(scopes);assert.deepEqual(scopes.teams.map(t=>t.count),[2,1]);
  return {scope:'match',composition:{mode:'explanation',factIds:facts.map(f=>f.id),claim:{text:'Highfield’s keeper has faced more on-target attempts on this measure; it does not capture every part of his workload.',kind:'interpretation',evidence:[],dependsOn:[0,1]}},followUp:''};
 },packet=>({decision:'approve',requestCheck:{status:'answered',requestedInformation:question.question,responseIntent:{purpose:'assessment',needsAssessment:true,needsExplicitCorrection:false,needsMeasurementLimitation:false,reason:'An opposing-keeper workload comparison.'},coverage:packet.requestComponents.map(requestSpan=>({requestSpan,claimIndices:[0,1,2],answerForm:'assessment',requestedAction:'other',temporalRelation:'none',relationAnchorClaimIndex:null,relationSourceLinkIndex:null,relationEntityBinding:'none'})),reason:'Complete full-window proxy and qualified conclusion.'}})]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.match(result.answer,/Highfield’s keeper/);assert.equal(result.claims.length,3);
});

test('planner-declared assessment reaches the writer as a required concise conclusion, independently reviewed',async()=>{
 const question={kind:'duel',seed:1011,time:115,question:'Which side has made the opposing keeper busier?'};
 const mock=sequenceTransport([{requestedForm:'assessment',mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'shot',outcome:'on-target'},aggregate:'by-team'}]}},(packet,body)=>{
  assert.equal(packet.requestedForm,'assessment');assert.equal(packet.queryResults,undefined);assert.equal(packet.playerContributions,undefined);assert.ok(packet.matchFacts.facts.length);assert.ok(packet.requestedEvidence.every(query=>query.rows===undefined));const modes=body.response_format.json_schema.schema.properties.composition.anyOf;for(const mode of modes.filter(mode=>mode.properties.mode.enum.includes('facts'))){assert.equal(mode.properties.factIds.maxItems,1);assert.ok(mode.properties.factIds.items.enum.every(id=>packet.matchFacts.facts.find(f=>f.id===id).selection.kind==='team-comparison'));}
  const paragraph=modes.find(mode=>mode.properties.mode.enum.includes('explanation')).properties.claim.anyOf[0].properties.text;assert.equal(paragraph.maxLength,600);assert.match(paragraph.description,/complete sentences/);
  const facts=packet.matchFacts.facts.filter(f=>f.selection.kind==='count'&&f.selection.metric==='shotsOnTarget'&&['home','away'].includes(f.selection.subjectId)&&f.selection.timeFrom===0&&f.selection.timeTo===115);
  return {scope:'match',composition:{mode:'explanation',factIds:facts.map(f=>f.id),claim:{text:'Portwell has tested the opposing keeper more on this measure. It is a limited view of keeper workload.',kind:'interpretation',evidence:[],dependsOn:[0,1]}},followUp:''};
 },packet=>({decision:'approve',requestCheck:{status:'answered',requestedInformation:question.question,responseIntent:{purpose:'assessment',needsAssessment:true,needsExplicitCorrection:false,needsMeasurementLimitation:false,reason:'Qualified full-window judgment.'},coverage:packet.requestComponents.map(requestSpan=>({requestSpan,claimIndices:[0,1,2],answerForm:'assessment',requestedAction:'other',temporalRelation:'none',relationAnchorClaimIndex:null,relationSourceLinkIndex:null,relationEntityBinding:'none'})),reason:'Complete evidence and an actual conclusion.'}})]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.match(result.answer,/Portwell has tested/);
 const invalid=directTransport({requestedForm:'invented',mentionedPlayers:[],decision:{kind:'queries',queries:[]}});await assert.rejects(answerMatchQuestionAI(question,{config,fetcher:invalid.fetcher}),error=>error.code==='question-invalid-operation');
});

test('a verified metric-bound comparison supplies a qualified assessment without redundant authored totals',async()=>{
 const question={kind:'duel',seed:1011,time:115,question:'Who has tested the opposing keeper more?'};
 const mock=sequenceTransport([{requestedForm:'assessment',mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'shot',outcome:'on-target'},aggregate:'by-team'}]}},packet=>{
  const fact=packet.matchFacts.facts.find(f=>f.selection.kind==='team-comparison'&&f.selection.metric==='shotsOnTarget'&&f.selection.timeFrom===0&&f.selection.timeTo===115);assert.ok(fact);return {scope:'match',composition:{mode:'facts',factIds:[fact.id]},followUp:''};
 },packet=>({decision:'approve',requestCheck:{status:'answered',requestedInformation:question.question,responseIntent:{purpose:'assessment',needsAssessment:true,needsExplicitCorrection:false,needsMeasurementLimitation:false,reason:'A qualified on-target comparison, not overall workload.'},coverage:packet.requestComponents.map(requestSpan=>({requestSpan,claimIndices:[0],answerForm:'assessment',requestedAction:'shot',temporalRelation:'none',relationAnchorClaimIndex:null,relationSourceLinkIndex:null,relationEntityBinding:'none'})),reason:'The exact measure, leader and both values are explicit.'}})]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.equal(result.claims.length,1);assert.match(result.answer,/On shots on target, Portwell Athletic leads/);assert.equal(result.canonicalFactSelection.proofs[0].assessmentBounds,'this-measure-only');assert.equal(result.provenance.modelGenerated,false);
});

test('personal action question with an explicit inspected moment stays on match evidence, not unrelated rules',async()=>{
 const question={kind:'sustained',seed:1042,time:96,anchorId:'comparison-sustained-1042-shot-96',question:'Why did he shoot instead of slipping it to a teammate?'};
 const mock=sequenceTransport([{requestedForm:'explanation',mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{id:question.anchorId},aggregate:'list',limit:1}]}},packet=>{
  const fact=packet.matchFacts.facts.find(f=>f.selection.kind==='event'&&f.selection.eventType==='shot'&&f.selection.time===96&&!f.selection.attributes);assert.ok(fact);
  return {scope:'match',composition:{mode:'explanation',factIds:[fact.id],claim:{text:'I cannot tell what he saw or whether a pass was available.',kind:'limitation',evidence:[],dependsOn:[]}},followUp:''};
 },packet=>({decision:'approve',requestCheck:{status:'useful-limitation',requestedInformation:question.question,responseIntent:{purpose:'explanation',needsAssessment:false,needsExplicitCorrection:false,needsMeasurementLimitation:false,reason:'Explain the actual shot while preserving unknown intentions and options.'},coverage:packet.requestComponents.map(requestSpan=>({requestSpan,claimIndices:[0,1],answerForm:'explanation',requestedAction:'shot',temporalRelation:'none',relationAnchorClaimIndex:null,relationSourceLinkIndex:null,relationEntityBinding:'none'})),reason:'Actual action plus specific uncertainty.'}})],(packet,call,body)=>{if(!call){assert.equal(packet.selectedMoment.id,question.anchorId);assert.equal(decisionBranch(body,'general'),undefined);}});
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.match(result.answer,/cannot tell/);
});

test('last pass before an inspected goal has a complete ordered lookup with an internal identified anchor',async()=>{
 const question={kind:'counter',seed:1041,time:118,question:'Who played the final pass before that goal?'};let captured,review;
 const mock=sequenceTransport([{requestedForm:'fact',mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{id:'comparison-counter-1041-shot-116'},aggregate:'list',limit:1}]}},packet=>{
  const fact=packet.matchFacts.facts.find(f=>f.selection.kind==='ordered-event'&&f.selection.metric==='passes'&&f.selection.timeTo===116&&f.selection.timeToExclusive);assert.ok(fact);assert.ok(packet.queryRelations.some(link=>link.anchorIdentifiedBy==='requested-moment'));
  return {scope:'match',composition:{mode:'facts',factIds:[fact.id]},followUp:''};
 },packet=>{captured=packet;review={decision:'approve',requestCheck:{status:'answered',requestedInformation:question.question,coverage:packet.requestComponents.map(requestSpan=>({requestSpan,claimIndices:[0],answerForm:'fact',requestedAction:'pass',temporalRelation:'before-requested-event',relationAnchorClaimIndex:null,relationSourceLinkIndex:null,relationEntityBinding:'same-team'})),reason:'Complete last-pass query before the source-identified goal.'}};return review;}]);
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.match(result.answer,/Mensah/);assert.equal(result.claims.length,1);assert.equal(result.queryRelations[0].query.timeToExclusive,true);
 const source={...captured.evidence,queryRelations:captured.queryRelations};assert.deepEqual(reviewRequestAdequacy(review,captured.answer,source,{canonicalFactSelection:captured.canonicalFactSelection}),[]);
 const bad=structuredClone(source);bad.requestedMoment.reference.revision++;
 assert.ok(reviewRequestAdequacy(review,captured.answer,bad,{canonicalFactSelection:captured.canonicalFactSelection}).length);
 const wrongSide=structuredClone(source);wrongSide.queryRelations[0].sameTeam=false;
 assert.ok(reviewRequestAdequacy(review,captured.answer,wrongSide,{canonicalFactSelection:captured.canonicalFactSelection}).length);
});

test('personal player references keep unfamiliar action paraphrases in the match route without a fabricated anchor',async()=>{
 for(const text of ['Why did he shoot instead of passing?','Was there a reason he went for goal rather than looking for a teammate?','What was behind his attempt there?']){
 const question={kind:'sustained',seed:1042,time:98,question:text};
 const mock=sequenceTransport([{requestedForm:'explanation',mentionedPlayers:[],decision:{kind:'queries',queries:[{filters:{type:'shot'},aggregate:'list',order:'desc',limit:1}]}},packet=>{
  const fact=packet.matchFacts.facts.find(f=>f.selection.kind==='ordered-event'&&f.selection.eventType===undefined&&f.selection.metric==='attempts');assert.ok(fact);
  return {scope:'match',composition:{mode:'explanation',factIds:[fact.id],claim:{text:'I cannot tell what he saw or whether a pass was available.',kind:'limitation',evidence:[],dependsOn:[]}},followUp:''};
 },packet=>({decision:'approve',requestCheck:{status:'useful-limitation',requestedInformation:question.question,coverage:packet.requestComponents.map(requestSpan=>({requestSpan,claimIndices:[0,1],answerForm:'explanation',requestedAction:'shot',temporalRelation:'none',relationAnchorClaimIndex:null,relationSourceLinkIndex:null,relationEntityBinding:'none'})),reason:'Latest shot and a necessary specific limitation.'}})],(packet,call,body)=>{if(!call){assert.equal(packet.selectedMoment,undefined);assert.equal(decisionBranch(body,'general'),undefined);}});
 const result=await answerMatchQuestionAI(question,{config,fetcher:mock.fetcher});assert.equal(result.execution.modelCalls,3);assert.match(result.answer,/cannot tell/);
 }
});
