import test from 'node:test';
import assert from 'node:assert/strict';
import {investigateLocalFactStory} from './local-fact-workflow.js';
import {GenerationError} from './ai.js';

const input={source:'integrated-match',kind:'extended',seed:17,time:180,anchorId:'extended-17-5-shot',audience:'analyst',language:'en'};
const result=(raw,tools=[])=>({raw,tools,modelCalls:1,elapsedMs:2,usageReportedCalls:1,usage:{promptTokens:10,completionTokens:5},trace:tools.map(name=>({type:'function-tool',name}))});
const tools=names=>result({tools:names},names);
const approve=result({decision:'approve',issues:[]});
const selectedSlots=packet=>[...(packet.requiredSlots||[packet.catalog.facts.find(f=>f.kind==='moment').slot]),...(packet.contextRequirement?.minimum===1?[packet.contextRequirement.candidateSlots[0]]:[])];
const moment=packet=>result({slots:selectedSlots(packet)});
function mock(steps,inspect=()=>{}){
 const packets=[],options=[];let calls=0;
 return {packets,options,count:()=>calls,runner:async(packet,opts)=>{
  packets.push(packet);options.push(opts);inspect(packet,calls,opts);
  assert.ok(calls<steps.length,'Unexpected extra worker invocation');
  const step=steps[calls++];return typeof step==='function'?step(packet):step;
 }};
}

test('local fact workflow uses selected tool outputs only and renders complete canonical score-change citations',async()=>{
 const worker=mock([tools(['get_event_sequence','score_at_moment']),packet=>{
  assert.ok(packet.catalog.facts.every(f=>!Object.hasOwn(f,'id')&&!Object.hasOwn(f,'text')&&!Object.hasOwn(f,'evidence')));
  assert.ok(!packet.catalog.facts.some(f=>['window-event-count','nearest-sampled-opponent'].includes(f.kind)));
  return result({slots:[packet.catalog.facts.find(f=>f.kind==='moment').slot,packet.catalog.facts.find(f=>f.kind==='goal-score-change').slot]});
 },packet=>{
  assert.equal(packet.renderedClaims[1].evidence.length,2);assert.match(packet.renderedClaims[1].text,/equalized at 02:58/);
  return approve;
 }]);
 const output=await investigateLocalFactStory({...input,audience:'newcomer'},{runner:worker.runner});
 assert.equal(output.status,'draft');assert.equal(output.provider,'local');assert.equal(output.model,'qwen3:4b');
 assert.deepEqual(output.authorship,{selection:'local-model',wording:'application-fact-templates',mandatoryFacts:'application-domain-rules',additionalContext:'local-model'});
 assert.equal(output.selectedFacts[1].kind,'goal-score-change');assert.equal(output.claims[1].evidence.length,2);
 assert.equal(output.execution.modelCalls,3);assert.equal(output.execution.workerCalls,3);assert.equal(output.execution.toolCalls,2);
 assert.equal(output.execution.repairCount,0);assert.deepEqual(output.execution.usage,{promptTokens:30,completionTokens:15});
 assert.equal(output.execution.usageReportedCalls,3);assert.equal(output.execution.frameworkTrace.length,3);
 assert.ok(worker.options.every(opts=>opts.signal===worker.options[0].signal&&opts.timeoutMs>0&&opts.timeoutMs<=180000));
 assert.ok(worker.options.every((opts,index)=>index===0||opts.timeoutMs<=worker.options[index-1].timeoutMs));
});

test('confirmed goal domain evidence stays separate from the exact SDK-selected tool trace',async()=>{
 const worker=mock([tools(['get_event_sequence']),packet=>{
  assert.deepEqual(packet.requiredSlots,packet.mandatorySlots);
  assert.equal(packet.requiredSlots.length,2);
  assert.deepEqual(packet.selectionCapacity,{maximumFacts:3,mandatoryFactCount:2,optionalFactCapacity:1});
  assert.equal(packet.catalog.facts[packet.requiredSlots[1]-1].kind,'goal-score-change');
  return moment(packet);
 },packet=>{
  assert.deepEqual(packet.selectionCapacity,{maximumFacts:3,mandatoryFactCount:2,optionalFactCapacity:1});
  assert.equal(packet.requiredSlots.length,2);return approve;
 }]);
 const output=await investigateLocalFactStory({...input,audience:'newcomer'},{runner:worker.runner});
 assert.equal(output.status,'draft');assert.equal(output.execution.modelCalls,3);
 assert.deepEqual(output.execution.modelSelectedTools,['get_event_sequence']);
 assert.deepEqual(output.execution.applicationRequiredTools,['score_at_moment']);
 assert.equal(output.execution.toolCalls,2);
 assert.deepEqual(output.execution.frameworkTrace[0].trace,[{type:'function-tool',name:'get_event_sequence'}]);
 assert.deepEqual(output.trace.filter(t=>t.stage==='application-required-evidence').map(t=>t.name),['score_at_moment']);
 assert.ok(output.requiredFactIds.every(id=>output.selectedFactIds.includes(id)));
 assert.deepEqual(output.selectedFacts.map(f=>f.kind),['moment','goal-score-change']);
 const already=await investigateLocalFactStory({...input,audience:'newcomer'},{runner:mock([tools(['get_event_sequence','score_at_moment']),moment,approve]).runner});
 assert.deepEqual(already.execution.applicationRequiredTools,[]);assert.equal(already.execution.toolCalls,2);
});

test('omitted supported goal meaning is repaired from the raw model selection or withheld without silent insertion',async()=>{
 const anchorOnly=packet=>result({slots:[packet.catalog.facts.find(f=>f.kind==='moment').slot]});
 const repaired=mock([tools(['get_event_sequence']),anchorOnly,moment,approve]);
 const output=await investigateLocalFactStory(input,{runner:repaired.runner});
 assert.equal(output.status,'draft');assert.equal(output.execution.repairCount,1);assert.equal(output.execution.modelCalls,4);
 assert.equal(repaired.packets.filter(p=>p.mode==='fact-editorial-review').length,1);
 assert.ok(repaired.packets[2].repair.issues.length);assert.equal(output.claims.length,3);
 const repeated=mock([tools(['get_event_sequence']),anchorOnly,anchorOnly]);
 const withheld=await investigateLocalFactStory(input,{runner:repeated.runner});
 assert.equal(withheld.status,'withheld');assert.deepEqual(withheld.claims,[]);assert.deepEqual(withheld.selectedFactIds,[]);
 assert.equal(repeated.count(),3);assert.equal(repeated.packets.filter(p=>p.mode==='fact-editorial-review').length,0);
 const nonGoal={...input,time:60,anchorId:'extended-17-1-shot',audience:'newcomer'};
 const unknown=await investigateLocalFactStory(nonGoal,{runner:mock([tools(['get_event_sequence']),anchorOnly,approve]).runner});
 assert.equal(unknown.status,'draft');assert.equal(unknown.requiredFactIds.length,1);
 assert.deepEqual(unknown.execution.applicationRequiredTools,[]);assert.equal(unknown.execution.toolCalls,1);
});

test('unknown, duplicate and extra-field slots are repaired once or withheld without editorial approval',async()=>{
 const bad=[()=>result({slots:[99]}),packet=>result({slots:[packet.catalog.facts[0].slot,packet.catalog.facts[0].slot]}),packet=>result({slots:[packet.catalog.facts[0].slot],text:'Untrusted model prose.'})];
 for(const invalid of bad){
  const repaired=mock([tools(['get_event_sequence']),invalid,moment,approve]);
  const output=await investigateLocalFactStory(input,{runner:repaired.runner});
  assert.equal(output.status,'draft');assert.equal(output.execution.repairCount,1);assert.equal(output.execution.workerCalls,4);
  assert.equal(repaired.packets.filter(p=>p.mode==='fact-editorial-review').length,1);
  assert.ok(repaired.packets[2].repair.issues.length>0);assert.ok(!output.claims.some(c=>c.text.includes('Untrusted')));
  const repeated=mock([tools(['get_event_sequence']),invalid,invalid]);
  const withheld=await investigateLocalFactStory(input,{runner:repeated.runner});
  assert.equal(withheld.status,'withheld');assert.deepEqual(withheld.claims,[]);assert.deepEqual(withheld.selectedFacts,[]);
  assert.equal(repeated.count(),3);assert.equal(repeated.packets.filter(p=>p.mode==='fact-editorial-review').length,0);
 }
});

test('selected anchor moment is mandatory and missing tool facts cannot be selected',async()=>{
 const nonMoment=packet=>result({slots:[packet.catalog.facts.find(f=>f.kind==='score').slot]});
 const omitted=mock([tools(['get_event_sequence','score_at_moment']),nonMoment,nonMoment]);
 const output=await investigateLocalFactStory(input,{runner:omitted.runner});
 assert.equal(output.status,'withheld');assert.ok(output.issues.some(i=>/moment slot must be first/.test(i)));
 const onlyEvents=mock([tools(['get_event_sequence']),packet=>{
  assert.ok(!packet.catalog.facts.some(f=>f.kind==='score'));return result({slots:[12]});
 },moment,approve]);
 assert.equal((await investigateLocalFactStory({...input,kind:'central',time:4,anchorId:'central-17-pass'},{runner:onlyEvents.runner})).status,'draft');
 const reversed=packet=>result({slots:[packet.catalog.facts.find(f=>f.kind==='score').slot,packet.catalog.facts.find(f=>f.kind==='moment').slot]});
 assert.equal((await investigateLocalFactStory(input,{runner:mock([tools(['get_event_sequence','score_at_moment']),reversed,reversed]).runner})).status,'withheld');
});

test('editorial rejection uses the shared five-call budget and repeated rejection withholds output',async()=>{
 const revise=result({decision:'revise',issues:['Select relevant available buildup.']});
 const repaired=mock([tools(['get_event_sequence']),moment,revise,moment,approve]);
 const output=await investigateLocalFactStory(input,{runner:repaired.runner});
 assert.equal(output.status,'draft');assert.equal(output.execution.modelCalls,5);assert.equal(output.execution.repairCount,1);
 assert.deepEqual(repaired.packets[3].repair.previousSlots,selectedSlots(repaired.packets[1]));
 const repeated=mock([tools(['get_event_sequence']),moment,revise,moment,revise]);
 const withheld=await investigateLocalFactStory(input,{runner:repeated.runner});
 assert.equal(withheld.status,'withheld');assert.equal(withheld.execution.modelCalls,5);assert.deepEqual(withheld.claims,[]);
 const invalid=result({decision:'approve',issues:['Contradiction.'],text:'Extra private prose.'});
 const malformed=mock([tools(['get_event_sequence']),moment,invalid,moment,invalid]);
 assert.equal((await investigateLocalFactStory(input,{runner:malformed.runner})).status,'withheld');
});

test('local canonical pending and confirmed pass stories preserve language and revision dependencies',async()=>{
 for(const [language,pending,completed] of [['en',/outcome pending/,/completed a pass/],['fr',/en attente/,/reussi|réussi/]]){
  const request={source:'integrated-match',kind:'central',seed:17,anchorId:'central-17-pass',audience:'newcomer',language};
  const run=time=>investigateLocalFactStory({...request,time},{runner:mock([tools(['get_event_sequence']),moment,approve]).runner});
  const before=await run(2),after=await run(4);
  assert.match(before.claims[0].text,pending);assert.match(after.claims[0].text,completed);
  assert.equal(before.claims[0].evidence[0].revision,1);assert.equal(after.claims[0].evidence[0].revision,2);
  assert.notEqual(before.selectedFactIds[0],after.selectedFactIds[0]);assert.equal(before.language,language);
 }
});

test('caller cancellation stops subsequent phases and rejects a final review even if the runner resolves',async()=>{
 for(const at of [0,2]){
  const controller=new AbortController();
  const worker=mock([tools(['get_event_sequence']),moment,approve],(_packet,index)=>{if(index===at)controller.abort();});
  await assert.rejects(investigateLocalFactStory(input,{runner:worker.runner,signal:controller.signal}),error=>error.status===499);
  assert.equal(worker.count(),at+1);
 }
 const controller=new AbortController();controller.abort();let called=false;
 await assert.rejects(investigateLocalFactStory(input,{signal:controller.signal,runner:async()=>{called=true;}}),error=>error.status===499);
 assert.equal(called,false);
});

test('invalid tool plans, execution metadata and hidden extra invocations fail closed',async()=>{
 for(const response of [tools(['score_at_moment']),tools(['get_event_sequence','get_event_sequence']),tools(['get_event_sequence','unknown']),
  {...tools(['get_event_sequence']),tools:['get_event_sequence','score_at_moment']},
  {...tools(['get_event_sequence']),modelCalls:2},
  {...tools(['get_event_sequence']),usageReportedCalls:1,usage:{promptTokens:-1,completionTokens:1}}
 ]){
  const worker=mock([response]);await assert.rejects(investigateLocalFactStory(input,{runner:worker.runner}),/Invalid local/);assert.equal(worker.count(),1);
 }
 const hidden=mock([tools(['get_event_sequence']),packet=>({...moment(packet),tools:['measure_moment']})]);
 await assert.rejects(investigateLocalFactStory(input,{runner:hidden.runner}),/unexpected tools/);assert.equal(hidden.count(),2);
});

test('worker rejection distinguishes the shared deadline from caller cancellation',async t=>{
 const deadline=new AbortController();
 t.mock.method(AbortSignal,'timeout',milliseconds=>{assert.equal(milliseconds,180000);return deadline.signal;});
 let calls=0;
 await assert.rejects(investigateLocalFactStory(input,{runner:async()=>{
  calls++;deadline.abort(new DOMException('Expired','TimeoutError'));
  throw new GenerationError('Local generation was cancelled.',499);
 }}),error=>error.status===504&&/deadline/.test(error.message));
 assert.equal(calls,1);
 t.mock.restoreAll();

 const caller=new AbortController();
 await assert.rejects(investigateLocalFactStory(input,{signal:caller.signal,runner:async()=>{
  caller.abort();throw new GenerationError('Worker aborted.',503);
 }}),error=>error.status===499);
 const providerError=new GenerationError('Worker failed independently.',503);
 await assert.rejects(investigateLocalFactStory(input,{runner:async()=>{throw providerError;}}),error=>error===providerError);
});
