import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createConversationPlan,scoreConversationReports,classifyConversationOutcome,captureEvaluationIdentity} from './conversational-evaluation.js';

const identity={buildFingerprint:'build',promptFingerprint:'prompt'};
const cases=[{id:'unknown',category:'useful-uncertainty',input:{kind:'sustained',seed:2317,time:96,language:'en',question:'What was the chance probability?'}}];
const plan=()=>createConversationPlan(identity,{repeat:2,cases});
const report=(p,repeat=1,overrides={})=>({mode:'real-azure',evaluationIdentity:{planId:p.planId,...identity,repeatIndex:repeat},cases:[{id:'unknown',input:cases[0].input,status:'generated',answer:{answer:'The record does not supply that probability.'},elapsedMs:100,...overrides}]});
const review=rowId=>({rowId,method:'human',reviewer:'Test reviewer fixture',reviewedAt:'2026-10-14T00:00:00Z',factuality:'pass',relevance:'pass',usefulness:'pass',uncertainty:'appropriate',rationale:'Test fixture: useful limitation without fabricated probability.'});

test('generation is unreviewed, repeat coverage remains missing, and no score is invented',()=>{
 const p=plan(),r=scoreConversationReports(p,[report(p)]);
 assert.equal(r.modelCalls,0);assert.equal(r.coverage.received,1);assert.deepEqual(r.coverage.missing,[{caseId:'unknown',repeatIndex:2}]);
 assert.equal(r.quality.human.factualityPassRate,null);assert.equal(r.quality.unreviewedPlannedLive,1);assert.equal(r.reviewTemplate[0].reviewer,null);
});
test('legacy successes and mocked runs never inflate current live quality',()=>{
 const p=plan(),legacy={cases:report(p).cases},mock={...report(p),mode:'mock'};
 const first=scoreConversationReports(p,[legacy,mock]);
 const r=scoreConversationReports(p,[legacy,mock],{reviews:first.rows.map(row=>review(row.rowId))});
 assert.equal(r.outcomes.allImported.generated,2);assert.equal(r.coverage.received,0);assert.equal(r.quality.human.reviewed,0);
});
test('provider failure, semantic withholding and setup failure remain distinct',()=>{
 assert.equal(classifyConversationOutcome({status:'failed',error:{status:502,code:'question-withheld'}}),'withheld');
 assert.equal(classifyConversationOutcome({status:'failed',error:{status:502,code:'azure-network'}}),'provider-failed');
 assert.equal(classifyConversationOutcome({status:'failed',error:{status:502}}),'application-failed');
 assert.equal(classifyConversationOutcome({status:'blocked'}),'setup-blocked');
});
test('human useful uncertainty and automated factual scores remain separate',()=>{
 const p=plan(),reports=[report(p),report(p,2)],first=scoreConversationReports(p,reports);
 const human=review(first.rows[0].rowId),automated={...review(first.rows[1].rowId),method:'automated',factuality:'fail',usefulness:'fail',uncertainty:'unsupported-certainty'};
 const r=scoreConversationReports(p,reports,{reviews:[human,automated]});
 assert.equal(r.quality.human.factualityPassRate,1);assert.equal(r.quality.human.uncertainty.appropriate,1);
 assert.equal(r.quality.automated.factualityPassRate,0);assert.equal(r.quality.automated.uncertainty['unsupported-certainty'],1);
 assert.equal(r.repeatability[0].humanFactualFailures,0);
});
test('provider failures cannot inflate quality even if a reviewer labels them passes',()=>{
 const p=plan(),r=report(p,1,{status:'failed',answer:undefined,error:{code:'azure-timeout',status:504}});
 const row=scoreConversationReports(p,[r]).rows[0];
 const scored=scoreConversationReports(p,[r],{reviews:[review(row.rowId)]});
 assert.equal(scored.outcomes.plannedLive['provider-failed'],1);assert.equal(scored.quality.human.reviewed,0);assert.equal(scored.quality.human.factualityPassRate,null);
});
test('raw draft and repair candidates survive import without acquiring semantic judgments',()=>{
 const p=plan(),r=report(p,1,{calls:[{output:JSON.stringify({draft:{claims:[{text:'Unsupported claim.'}]}})},{output:JSON.stringify({decision:'withhold'})},{output:JSON.stringify({claims:[{text:'Useful corrected limitation.'}]})}]});
 r.sourceIdentity={sha256:'preserved-provider-run-identity'};
 const row=scoreConversationReports(p,[r]).rows[0];
 assert.deepEqual(row.draftCandidates.map(c=>c.callIndex),[0,2]);assert.ok(row.draftCandidates.every(c=>c.quality==='unreviewed'));
 assert.deepEqual(row.sourceIdentity,r.sourceIdentity);assert.equal(row.review,null);
});
test('duplicate files, duplicate slots, tampered plans and mismatched inputs cannot certify repeats',()=>{
 const p=plan(),r=report(p);
 assert.throws(()=>scoreConversationReports(p,[r,r]),/Duplicate report/);
 assert.throws(()=>scoreConversationReports(p,[r,{...r,createdAt:'different'}]),/Duplicate case\/repeat/);
 assert.throws(()=>scoreConversationReports({...p,repeat:3},[r]),/Plan identity/);
 const wrong=report(p,1,{input:{...cases[0].input,time:118}});
 assert.equal(scoreConversationReports(p,[wrong]).coverage.received,0);
 assert.equal(scoreConversationReports(p,[{...r,evaluationIdentity:{...r.evaluationIdentity,buildFingerprint:'old'}}]).coverage.received,0);
});
test('reviews need explicit provenance and cannot silently overwrite adjudication',()=>{
 const p=plan(),r=report(p),row=scoreConversationReports(p,[r]).rows[0];
 assert.throws(()=>scoreConversationReports(p,[r],{reviews:[{...review(row.rowId),reviewer:''}]}),/Review needs/);
 assert.throws(()=>scoreConversationReports(p,[r],{reviews:[review(row.rowId),review(row.rowId)]}),/Duplicate review/);
});
test('source fingerprint detects dirty prompt changes independent of git commit',()=>{
 const directory=mkdtempSync(join(tmpdir(),'conversation-identity-'));
 try{
  for(const file of ['match-question-ai.js','question-evidence-check.js','ai.js'])writeFileSync(join(directory,file),'original');
  const before=captureEvaluationIdentity(directory);writeFileSync(join(directory,'match-question-ai.js'),'changed');
  const after=captureEvaluationIdentity(directory);assert.notEqual(before.buildFingerprint,after.buildFingerprint);assert.notEqual(before.promptFingerprint,after.promptFingerprint);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('offline CLI scores a historical file without model credentials and refuses overwrite',()=>{
 const directory=mkdtempSync(join(tmpdir(),'conversation-cli-'));
 try{
  const p=plan(),planFile=join(directory,'plan.json'),reportFile=join(directory,'report.json'),output=join(directory,'score.json');
  writeFileSync(planFile,JSON.stringify(p));writeFileSync(reportFile,JSON.stringify({cases:report(p).cases}));
  const args=['conversational-evaluation-cli.js','score',`--plan=${planFile}`,`--report=${reportFile}`,`--out=${output}`];
  const result=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);
  const saved=JSON.parse(readFileSync(output));assert.equal(saved.modelCalls,0);assert.equal(saved.coverage.received,0);
  assert.notEqual(spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true}).status,0);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
