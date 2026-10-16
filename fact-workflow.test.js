import test from 'node:test';
import assert from 'node:assert/strict';
import {investigateFactStory} from './fact-workflow.js';
import {createInvestigationTools} from './investigation-tools.js';
import {storyFacts} from './story-facts.js';
import {GenerationError} from './ai.js';

const input={kind:'extended',seed:17,time:180,anchorId:'extended-17-5-shot',audience:'analyst',language:'en'};
const config={url:'https://test.openai.azure.com',deployment:'test',key:'test'};
const reply=value=>({finish_reason:'stop',message:{content:JSON.stringify(value)}});
const tools=(names,id='tool')=>({finish_reason:'tool_calls',message:{tool_calls:names.map((name,index)=>({id:`${id}-${index}`,type:'function',function:{name,arguments:'{}'}}))}});
const approved=reply({decision:'approve',issues:[]});
function catalog(body){
 for(const message of [...body.messages].reverse()){
  try{const value=JSON.parse(message.content);if(value.catalog)return value.catalog;}catch{}
 }
 throw new Error('No executed fact catalog was supplied to the model.');
}
const momentSelection=body=>{const facts=catalog(body).facts;const ids=facts.filter(f=>['moment','goal-score-change'].includes(f.kind)).map(f=>f.id);const packet=[...body.messages].reverse().map(m=>{try{return JSON.parse(m.content);}catch{return null;}}).find(p=>p?.contextRequirement);if(packet?.contextRequirement.minimum===1)ids.push(packet.contextRequirement.candidateFactIds[0]);return reply({factIds:ids});};
function provider(steps,inspect=()=>{}){
 let calls=0;const bodies=[];
 return {count:()=>calls,bodies,fetcher:async(url,options)=>{
  const body=JSON.parse(options.body);bodies.push(body);inspect(body,calls);
  assert.ok(calls<steps.length,'Unexpected extra model call');
  const step=steps[calls++],value=typeof step==='function'?step(body):step;
  return new Response(JSON.stringify({choices:[value],usage:{prompt_tokens:10,completion_tokens:5}}));
 }};
}

test('fact selection sees only executed evidence and canonical wording retains complete citations',async()=>{
 const mock=provider([tools(['get_event_sequence','get_match_patterns']),body=>{
  const facts=catalog(body).facts;
  assert.ok(facts.every(f=>['get_event_sequence','get_match_patterns','score_at_moment'].includes(f.sourceTool)));
  assert.ok(!facts.some(f=>['nearest-sampled-opponent','player-sample-displacement-rate'].includes(f.kind)));
  const moment=facts.find(f=>f.kind==='moment'),count=facts.find(f=>f.kind==='window-event-count'&&f.values.team==='away'&&f.values.category==='shots');
  assert.equal(count.values.count,3);assert.equal(count.evidence.length,3);
  return reply({factIds:[moment.id,facts.find(f=>f.kind==='goal-score-change').id,count.id]});
 },body=>{
  const review=JSON.parse(body.messages[1].content);
  assert.equal(review.renderedClaims.length,3);
  assert.equal(review.selectedFacts.length,3);
  assert.deepEqual(Object.keys(review.renderedClaims[2]).sort(),['factId','text']);
  assert.equal(review.selectedFacts[2].evidence.length,3);
  assert.ok(review.availableFacts.facts.every(fact=>!review.selectedFactIds.includes(fact.id)));
  return approved;
 }]);
 const result=await investigateFactStory(input,{config,fetcher:mock.fetcher});
 assert.equal(result.status,'draft');assert.equal(result.claims.length,3);
 assert.equal(result.claims[2].evidence.length,3);
 assert.equal(result.authorship.selection,'azure-model');assert.equal(result.authorship.wording,'application-fact-templates');
 assert.equal(result.execution.modelCalls,3);assert.equal(result.execution.toolCalls,3);
 assert.deepEqual(result.execution.applicationRequiredTools,['get_event_sequence','score_at_moment','get_match_patterns']);
 assert.deepEqual(result.execution.modelSelectedTools,['get_event_sequence','get_match_patterns']);
 assert.deepEqual(result.execution.usage,{promptTokens:30,completionTokens:15});
});

test('a real but unexecuted score fact cannot be selected and one repair can recover',async()=>{
 const nonGoal={...input,time:122,anchorId:'extended-17-3-shot'};
 const registry=createInvestigationTools(nonGoal);
 const score=storyFacts({score_at_moment:registry.execute('score_at_moment',{})},registry.scope).facts.find(f=>f.kind==='score');
 const mock=provider([tools(['get_event_sequence']),body=>reply({factIds:[catalog(body).facts.find(f=>f.kind==='moment').id,score.id]}),momentSelection,approved]);
 const result=await investigateFactStory(nonGoal,{config,fetcher:mock.fetcher});
 assert.equal(result.status,'draft');assert.equal(result.execution.repairCount,1);assert.equal(result.execution.modelCalls,4);
 assert.ok(!result.claims.some(c=>c.factId===score.id));
});

test('unknown, duplicate and extra-field selections cannot reach the reviewer without repair',async()=>{
 const invalid=[()=>({factIds:['unknown-fact']}),facts=>({factIds:[facts[0].id,facts[0].id]}),facts=>({factIds:[facts.find(f=>f.kind==='moment').id],text:'Injected causal wording.'})];
 for(const make of invalid){
  const bad=body=>reply(make(catalog(body).facts));
  const repair=provider([tools(['get_event_sequence']),bad,momentSelection,approved]);
  const fixed=await investigateFactStory(input,{config,fetcher:repair.fetcher});
  assert.equal(fixed.status,'draft');assert.equal(fixed.execution.repairCount,1);assert.equal(fixed.execution.modelCalls,4);
  assert.ok(fixed.claims.every(c=>!c.text.includes('Injected')));
  const repeated=provider([tools(['get_event_sequence']),bad,bad]);
  const withheld=await investigateFactStory(input,{config,fetcher:repeated.fetcher});
  assert.equal(withheld.status,'withheld');assert.deepEqual(withheld.claims,[]);
  assert.equal(withheld.execution.repairCount,1);assert.equal(repeated.count(),3);
 }
});

test('the selected moment fact is mandatory and must lead the selected story',async()=>{
 for(const mode of ['omit','reverse']){
  const invalid=body=>{const facts=catalog(body).facts,moment=facts.find(f=>f.kind==='moment'),score=facts.find(f=>f.kind==='score');return reply({factIds:mode==='omit'?[score.id]:[score.id,moment.id]});};
  const mock=provider([tools(['get_event_sequence','score_at_moment']),invalid,invalid]);
  const result=await investigateFactStory(input,{config,fetcher:mock.fetcher});
  assert.equal(result.status,'withheld');assert.deepEqual(result.claims,[]);assert.equal(mock.count(),3);
 }
});

test('review rejection has one repair handoff and repeated rejection withholds canonical claims',async()=>{
 const rejected=reply({decision:'revise',issues:['Choose a more relevant supported fact.']});
 const repaired=provider([tools(['get_event_sequence']),momentSelection,rejected,momentSelection,approved]);
 const result=await investigateFactStory(input,{config,fetcher:repaired.fetcher});
 assert.equal(result.status,'draft');assert.equal(result.execution.repairCount,1);assert.equal(result.execution.modelCalls,5);
 const repeated=provider([tools(['get_event_sequence']),momentSelection,rejected,momentSelection,rejected]);
 const withheld=await investigateFactStory(input,{config,fetcher:repeated.fetcher});
 assert.equal(withheld.status,'withheld');assert.deepEqual(withheld.claims,[]);assert.equal(repeated.count(),5);
});

test('pending pass wording and evidence revise only after confirmation arrives',async()=>{
 const request={kind:'central',seed:17,time:2,anchorId:'central-17-pass',audience:'newcomer',language:'en'};
 const run=async time=>{
  const mock=provider([tools(['get_event_sequence']),momentSelection,approved]);
  return investigateFactStory({...request,time},{config,fetcher:mock.fetcher});
 };
 const pending=await run(2),confirmed=await run(4);
 assert.match(pending.claims[0].text,/outcome pending/);assert.doesNotMatch(pending.claims[0].text,/unsuccessful|completed/);
 assert.equal(pending.claims[0].evidence[0].revision,1);
 assert.match(confirmed.claims[0].text,/completed a pass/);assert.equal(confirmed.claims[0].evidence[0].revision,2);
 assert.notEqual(pending.claims[0].factId,confirmed.claims[0].factId);
});

test('cancellation prevents follow-up calls and tool budgets include every selected evidence invocation',async()=>{
 const controller=new AbortController();let calls=0;
 await assert.rejects(investigateFactStory(input,{config,signal:controller.signal,fetcher:async()=>{
  calls++;controller.abort();return new Response(JSON.stringify({choices:[tools(['get_event_sequence'])]}));
 }}),error=>error.status===499);
 assert.equal(calls,1);
 const aborted=new AbortController();aborted.abort();let preCalls=0;
 await assert.rejects(investigateFactStory(input,{config,signal:aborted.signal,fetcher:async()=>{preCalls++;throw new Error('Should not call provider');}}),error=>error.status===499);
 assert.equal(preCalls,0);
 const exceeded=provider([tools(['get_event_sequence','get_event_sequence','get_event_sequence','get_event_sequence','get_event_sequence','get_event_sequence','get_event_sequence'])]);
 await assert.rejects(investigateFactStory(input,{config,fetcher:exceeded.fetcher}),/tool.*budget/i);
 assert.equal(exceeded.count(),1);
});

test('selection, repair and editorial review share one eight-call execution budget',async()=>{
 const rejected=reply({decision:'revise',issues:['Choose relevant available context.']});
 const first=[tools(['get_event_sequence'],'first'),tools(['score_at_moment'],'second'),tools(['get_event_sequence'],'third'),momentSelection,rejected];
 const exact=provider([...first,tools(['measure_moment'],'repair'),momentSelection,approved]);
 const completed=await investigateFactStory(input,{config,fetcher:exact.fetcher});
 assert.equal(completed.status,'draft');assert.equal(completed.execution.modelCalls,8);assert.equal(completed.execution.toolCalls,4);
 const overflow=provider([...first,tools(['get_match_patterns'],'repair1'),tools(['get_event_sequence'],'repair2'),momentSelection]);
 await assert.rejects(investigateFactStory(input,{config,fetcher:overflow.fetcher}),/execution budget/);
 assert.equal(overflow.count(),8);
});

test('audience limits reject oversized selection and malformed review cannot release a draft',async()=>{
 const tooMany=body=>reply({factIds:catalog(body).facts.slice(0,4).map(f=>f.id)});
 const newcomer=provider([tools(['get_event_sequence','score_at_moment']),tooMany,tooMany]);
 const withheld=await investigateFactStory({...input,audience:'newcomer'},{config,fetcher:newcomer.fetcher});
 assert.equal(withheld.status,'withheld');assert.deepEqual(withheld.claims,[]);
 assert.ok(withheld.issues.some(issue=>/one to 3/.test(issue)));
 const invalid=reply({decision:'approve',issues:[],text:'Unreviewed invented prose.'});
 const reviewer=provider([tools(['get_event_sequence']),momentSelection,invalid,momentSelection,invalid]);
 const invalidReview=await investigateFactStory(input,{config,fetcher:reviewer.fetcher});
 assert.equal(invalidReview.status,'withheld');assert.deepEqual(invalidReview.claims,[]);assert.equal(invalidReview.execution.modelCalls,5);
 assert.match(invalidReview.issues[0],/invalid decision/);
});

test('aborting the final reviewer response cannot release a story even if transport resolves',async()=>{
 const controller=new AbortController();
 const mock=provider([tools(['get_event_sequence']),momentSelection,()=>{controller.abort();return approved;}]);
 await assert.rejects(investigateFactStory(input,{config,fetcher:mock.fetcher,signal:controller.signal}),error=>error.status===499);
 assert.equal(mock.count(),3);
});

test('application goal foundations permit supported selection without a model tool request',async()=>{
 const mock=provider([momentSelection,approved]);
 const result=await investigateFactStory(input,{config,fetcher:mock.fetcher});
 assert.equal(result.status,'draft');assert.equal(result.execution.modelCalls,2);
 assert.equal(result.execution.modelToolRequests,0);assert.equal(result.execution.toolCalls,3);
 assert.deepEqual(result.execution.modelSelectedTools,[]);
 assert.deepEqual(result.requirements.requiredKinds,['moment','goal-score-change']);
 assert.equal(result.selectedFacts[1].values.effect,'equalized');
 assert.equal(result.claims[1].evidence.length,2);
 assert.equal(result.authorship.mandatoryFacts,'application-domain-rules');
});

test('goal significance omitted from a valid moment selection gets one repair and cannot be approved away',async()=>{
 const onlyMoment=body=>reply({factIds:[catalog(body).facts.find(f=>f.kind==='moment').id]});
 const repair=provider([onlyMoment,momentSelection,approved]);
 const recovered=await investigateFactStory(input,{config,fetcher:repair.fetcher});
 assert.equal(recovered.status,'draft');assert.equal(recovered.execution.repairCount,1);assert.equal(recovered.execution.modelCalls,3);
 const repeated=provider([onlyMoment,onlyMoment]);
 const withheld=await investigateFactStory(input,{config,fetcher:repeated.fetcher});
 assert.equal(withheld.status,'withheld');assert.deepEqual(withheld.claims,[]);
 assert.equal(withheld.execution.modelCalls,2);assert.match(withheld.issues[0],/supported goal score change/);
});

test('structured selection and review stay small while preserving current IDs and complete release citations',async()=>{
 const mock=provider([tools(['get_event_sequence','get_match_patterns']),momentSelection,approved]);
 const result=await investigateFactStory(input,{config,fetcher:mock.fetcher});
 const [initial,afterTools,review]=mock.bodies;
 for(const request of [initial,afterTools]){
  assert.equal(request.max_completion_tokens,256);
  assert.equal(request.response_format.json_schema.name,'moment_fact_selection');
  const current=catalog(request);
  assert.deepEqual(request.response_format.json_schema.schema.properties.factIds.items.enum,current.facts.map(fact=>fact.id));
  assert.ok(current.facts.every(fact=>fact.values&&fact.evidence.length&&!Object.hasOwn(fact,'text')));
  assert.equal(request.messages.filter(message=>{try{return !!JSON.parse(message.content).catalog;}catch{return false;}}).length,1);
 }
 for(const tool of afterTools.messages.filter(message=>message.role==='tool')){
  const payload=JSON.parse(tool.content);assert.equal(payload.catalogFollows,true);assert.ok(payload.referenceCount>0);
  assert.equal(Object.hasOwn(payload,'analysis'),false);assert.equal(Object.hasOwn(payload,'events'),false);
 }
 assert.equal(review.max_completion_tokens,384);assert.equal(review.response_format.json_schema.name,'moment_editorial_review');
 assert.equal(result.status,'draft');assert.ok(result.claims.every(claim=>claim.evidence.length));
 assert.deepEqual(result.claims[1].evidence,result.selectedFacts[1].evidence);
});

test('review transport failure names the failed stage and does not restart a successful selection',async()=>{
 let calls=0;
 await assert.rejects(investigateFactStory(input,{config,fetcher:async(_url,options)=>{
  calls++;if(calls===2)throw new GenerationError('The Azure request timed out before a complete response arrived.',504,'azure-timeout');
  return new Response(JSON.stringify({choices:[momentSelection(JSON.parse(options.body))]}));
 }}),error=>error.status===504&&error.code==='azure-timeout'&&/editorial review \(model request 2\).*no AI story was released/.test(error.message));
 assert.equal(calls,2,'A failed reviewer must not silently retry or release an unreviewed selection.');
});

test('rate limits retain their status and stage without spending a repair call',async()=>{
 let calls=0;
 await assert.rejects(investigateFactStory(input,{config,fetcher:async()=>{calls++;return new Response('',{status:429});}}),error=>
  error.status===429&&/fact selection \(model request 1\)/.test(error.message)&&/no automatic retry/i.test(error.message));
 assert.equal(calls,1);
});
