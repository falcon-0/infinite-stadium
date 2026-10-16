import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalComparisonCases,prepareCanonicalComparison,deterministicCanonicalSelection,
 validateCanonicalSelection,runCanonicalComparison} from './canonical-comparison.js';

const corrected=()=>canonicalComparisonCases().find(row=>row.id==='corrected-goal');
const select=payload=>({content:deterministicCanonicalSelection(payload),usage:{promptTokens:10,completionTokens:3}});
const approve=()=>({content:{decision:'approve',issues:[]},usage:{promptTokens:5,completionTokens:2}});

test('offline reports complete identical catalogs, explicit skips and no invented human ratings',async()=>{
 const report=await runCanonicalComparison();
 assert.equal(report.totalModelCalls,0);
 assert.equal(report.humanEvaluation.participantCount,0);
 assert.equal(report.results.filter(row=>row.status==='skipped').length,12);
 assert.equal(report.results.filter(row=>row.status==='draft').length,5);
 assert.equal(report.results.filter(row=>row.status==='correct-abstention').length,1);
 for(const prepared of report.prepared.filter(row=>row.packet)){
  const rows=report.results.filter(row=>row.caseId===prepared.caseId);
  assert(rows.every(row=>row.catalogHash===prepared.packet.catalogHash));
  assert.deepEqual(prepared.packet.evidenceTools,['get_event_sequence','score_at_moment','get_match_patterns','measure_moment']);
  assert(rows.every(row=>row.humanReview.comprehension===null));
 }
});

test('all model roles see the same fixed catalog and cannot mutate another arm',async()=>{
 const seen=[];
 const report=await runCanonicalComparison({cases:[corrected()],providerLabel:'mock',completion:async request=>{
  seen.push({role:request.role,hash:request.payload.catalogHash,catalog:structuredClone(request.payload.catalog),max:request.payload.maximumFacts});
  const response=request.role==='review'?approve():select(request.payload);
  request.payload.catalog.facts.length=0;
  return response;
 }});
 assert.deepEqual(seen.map(row=>row.role),['selection','selection','review']);
 assert(seen.every(row=>row.hash===seen[0].hash&&row.max===5));
 assert.deepEqual(seen[0].catalog,seen[2].catalog);
 assert(report.results.every(row=>row.status==='draft'));
 assert.deepEqual(report.results[0].claims,report.results[2].claims);
 assert.equal(report.totalModelCalls,3);
 assert.equal(report.results[2].execution.tokensComplete,true);
 assert.deepEqual(report.results[2].execution.tokens,{promptTokens:15,completionTokens:5});
});

test('same hard checks reject missing consequence, context, order, quota and unknown IDs',()=>{
 const packet=prepareCanonicalComparison(corrected().input);
 const valid=deterministicCanonicalSelection(packet);
 assert.doesNotThrow(()=>validateCanonicalSelection(packet,valid));
 assert.throws(()=>validateCanonicalSelection(packet,{factIds:[packet.requirements.requiredFactIds[0]]}),/required/);
 assert.throws(()=>validateCanonicalSelection(packet,{factIds:packet.requirements.requiredFactIds}),/context/);
 assert.throws(()=>validateCanonicalSelection(packet,{factIds:[...valid.factIds].reverse()}),/lead/);
 assert.throws(()=>validateCanonicalSelection(packet,{factIds:[...valid.factIds,'unknown']}),/unavailable/);
 assert.throws(()=>validateCanonicalSelection(packet,{factIds:packet.catalog.facts.slice(0,6).map(f=>f.id)}),/maximumFacts/);
});

test('both AI arms get one application repair, preserve omissions and do not silently insert facts',async()=>{
 const report=await runCanonicalComparison({cases:[corrected()],completion:async({role,payload})=>
  role==='review'?approve():payload.attempt===0?{content:{factIds:[payload.requirements.requiredFactIds[0]]}}:select(payload)});
 for(const row of report.results.slice(1)){
  assert.equal(row.status,'draft');assert.equal(row.attempts.length,2);
  assert.equal(row.attempts[0].omissions.requiredFactIds.length,1);
  assert.equal(row.attempts[0].omissions.requiredContextMissing,true);
  assert.equal(row.attempts[0].applicationAccepted,false);
  assert.equal(row.modelIssues.length,0);assert.equal(row.applicationIssues.length,1);
  assert.equal(row.execution.tokensComplete,false);
 }
 assert.equal(report.totalModelCalls,5);
});

test('reviewer rejection is distinct from application failure and can withhold valid selections',async()=>{
 const report=await runCanonicalComparison({cases:[corrected()],completion:async({role,payload})=>
  role==='selection'?select(payload):{content:{decision:'revise',issues:['Choose less redundant context.']}}});
 const row=report.results[2];
 assert.equal(row.status,'withheld');assert.deepEqual(row.claims,[]);
 assert.equal(row.applicationIssues.length,0);assert.equal(row.modelIssues.length,2);
 assert.equal(row.attempts.length,2);assert(row.attempts.every(a=>a.applicationAccepted));
 assert.equal(row.execution.modelCalls,4);assert.equal(report.totalModelCalls,5);
});

test('malformed reviewer approval cannot release a story',async()=>{
 const report=await runCanonicalComparison({cases:[corrected()],completion:async({role,payload})=>
  role==='selection'?select(payload):{content:{decision:'approve',issues:['But change the selection.']}}});
 assert.equal(report.results[2].status,'withheld');
 assert.equal(report.results[2].applicationIssues.length,2);
 assert.deepEqual(report.results[2].claims,[]);
});

test('global call budget and explicit refusal cannot masquerade as successful abstention',async()=>{
 const limited=await runCanonicalComparison({cases:[corrected()],maxModelCalls:1,completion:async({payload})=>select(payload)});
 assert.equal(limited.totalModelCalls,1);assert.equal(limited.results[2].status,'skipped');
 assert.equal(limited.results[2].reasonCode,'budget-exhausted');
 assert.equal(limited.results[2].execution.modelCalls,0);assert.deepEqual(limited.results[2].executionIssues,[]);
 assert.deepEqual(limited.coverage.byArm['selector-reviewer'],{planned:1,modelExecuted:0,skipped:1,budgetSkipped:1,executionFailed:0});
 const refusal=await runCanonicalComparison({cases:[corrected()],completion:async()=>({refused:true})});
 assert(refusal.results.slice(1).every(row=>row.status==='refused'&&row.claims.length===0));
});

test('zero call budget skips both model arms without invoking transport',async()=>{
 const report=await runCanonicalComparison({cases:[corrected()],maxModelCalls:0,completion:async()=>{assert.fail('No transport may run.');}});
 assert.equal(report.totalModelCalls,0);assert.equal(report.results[0].status,'draft');
 assert(report.results.slice(1).every(row=>row.status==='skipped'&&row.reasonCode==='budget-exhausted'&&row.execution.modelCalls===0));
 assert.equal(report.coverage.plannedCases,1);assert.equal(report.coverage.plannedRows,3);
});

test('budget exhaustion after selection remains a distinct executed failure without released claims',async()=>{
 const report=await runCanonicalComparison({cases:[corrected()],maxModelCalls:2,completion:async({payload})=>select(payload)});
 const row=report.results[2];assert.equal(report.totalModelCalls,2);
 assert.equal(row.status,'failed');assert.equal(row.reasonCode,'budget-exhausted');assert.equal(row.execution.modelCalls,1);
 assert.equal(row.attempts.length,1);assert.equal(row.attempts[0].applicationAccepted,true);assert.deepEqual(row.claims,[]);
 assert.match(row.executionIssues[0],/budget/);assert.deepEqual(row.applicationIssues,[]);assert.deepEqual(row.modelIssues,[]);
 assert.deepEqual(report.coverage.byArm['selector-reviewer'],{planned:1,modelExecuted:1,skipped:0,budgetSkipped:0,executionFailed:1});
});

test('expected unavailable anchor cannot turn invalid settings into a correct abstention',async()=>{
 const unavailable=canonicalComparisonCases().find(row=>row.expectedUnavailable);
 const cases=[unavailable,...[{seed:-1},{language:'invalid'},{audience:'invalid'},{anchorId:null}].map((change,index)=>({
  ...unavailable,id:`invalid-unavailable-${index}`,input:{...unavailable.input,...change}
 }))];
 const report=await runCanonicalComparison({cases,completion:async()=>{assert.fail('Preparation must prevent model calls.');}});
 assert.equal(report.totalModelCalls,0);
 assert(report.results.filter(row=>row.caseId===unavailable.id).every(row=>row.status==='correct-abstention'));
 assert(report.results.filter(row=>row.caseId!==unavailable.id).every(row=>row.status==='failed'&&row.applicationIssues.length===1));
});

test('report deadline bounds a transport that ignores cancellation',async()=>{
 const report=await runCanonicalComparison({cases:[corrected()],timeoutMs:20,completion:()=>new Promise(()=>{})});
 assert.equal(report.totalModelCalls,1);
 assert(report.results.slice(1).every(row=>row.status==='failed'&&row.executionIssues.some(issue=>issue.includes('deadline'))));
});

test('review transport failure is an execution failure, not editorial rejection or abstention',async()=>{
 const report=await runCanonicalComparison({cases:[corrected()],completion:async({role,payload})=>{
  if(role==='review')throw new Error('Mock transport unavailable.');
  return select(payload);
 }});
 const row=report.results[2];
 assert.equal(row.status,'failed');assert.equal(row.executionIssues.length,1);
 assert.deepEqual(row.applicationIssues,[]);assert.deepEqual(row.modelIssues,[]);assert.deepEqual(row.claims,[]);
});
