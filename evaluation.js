import {performance} from 'node:perf_hooks';
import {buildRequest,configuration,generateDraft,validateDraft} from './ai.js';
import {investigateWithAgents} from './agent-workflow.js';
import {investigateFactStory} from './fact-workflow.js';
import {investigateLocalFactStory} from './local-fact-workflow.js';
import {createInvestigationTools} from './investigation-tools.js';
import {integratedMatch} from './match-stream.js';
import {generateLocalDraft,investigateLocally} from './local-ai.js';

export function evaluationCases(){
 const short=[{kind:'central',seed:101},{kind:'wide',seed:902}].flatMap(fixture=>[
  {label:'pending-pass',time:2,event:'pass',expected:{scoreHome:0,passAccuracy:null,anchorRevision:1}},
  {label:'received-pass',time:4,event:'receive',expected:{scoreHome:0,passAccuracy:100,anchorRevision:1}},
  {label:'goal-original',time:8,event:'shot',expected:{scoreHome:1,passAccuracy:100,anchorRevision:1}},
  {label:'goal-corrected',time:10,event:'shot',expected:{scoreHome:1,passAccuracy:100,anchorRevision:2}},
  {label:'future-goal',time:7,event:'shot',expectedInvalid:true},
  {label:'before-first-event',time:0,event:'pass',expectedInvalid:true}
 ].map(testCase=>({...testCase,id:`${fixture.kind}-${fixture.seed}-${testCase.label}`,
  input:{source:'integrated-match',...fixture,time:testCase.time,anchorId:`${fixture.kind}-${fixture.seed}-${testCase.event}`,audience:'analyst'}})));
 const extended=[
  {label:'pending-pass',time:22,event:'pass',phase:0,expected:{scoreHome:0,passAccuracy:null,anchorRevision:1}},
  {label:'received-pass',time:24,event:'receive',phase:0,expected:{scoreHome:0,passAccuracy:100,anchorRevision:1}},
  {label:'goal-original',time:29,event:'shot',phase:0,expected:{scoreHome:1,passAccuracy:100,anchorRevision:1}},
  {label:'goal-corrected',time:30,event:'shot',phase:0,expected:{scoreHome:1,passAccuracy:100,anchorRevision:2}},
  {label:'segment-end',time:362,event:'shot',phase:11,expected:{scoreHome:2,scoreAway:1,passAccuracy:75,anchorRevision:2,
   homeShots:2,awayShots:5,passAttempts:12,completedPasses:9,homeRecoveries:7,awayRecoveries:8,eventCount:50}},
  {label:'delayed-shot',time:28,event:'shot',phase:0,expectedInvalid:true}
 ].map(testCase=>({...testCase,id:`extended-2039-${testCase.label}`,input:{source:'integrated-match',kind:'extended',seed:2039,
  time:testCase.time,anchorId:`extended-2039-${testCase.phase}-${testCase.event}`,audience:'analyst'}}));
 return [...short,...extended];
}

export const evaluationAdapterIds=['template','single-call','investigator-reviewer','fact-selection'];
export function evaluationAdapters({live=false,local=false,config,fetcher=fetch,localRunner,adapter=null}={}){
 if(adapter!==null&&!evaluationAdapterIds.includes(adapter))throw new RangeError('Choose a supported evaluation adapter.');
 const azureConfig=local||!live||adapter==='template'?null:config===undefined?configuration():config;
 const adapters=[
  {id:'template',run:async(input)=>{
   const {explanation}=buildRequest(input);
   return {source:'local-template',status:'draft',key:explanation.key,
    claims:[{text:explanation.text,evidence:explanation.evidence.map(({id,revision})=>({id,revision}))}],
    execution:{modelCalls:0,toolCalls:0,repairCount:0,usage:null,usageReportedCalls:0}};
  }},
  {id:'single-call',skip:local?null:!live?'Live calls disabled.':!azureConfig?'Azure is not configured.':null,
   run:input=>local?generateLocalDraft(input,{runner:localRunner}):generateDraft(input,{config:azureConfig,fetcher})},
  {id:'investigator-reviewer',skip:local?null:!live?'Live calls disabled.':!azureConfig?'Azure is not configured.':null,
   run:input=>local?investigateLocally(input,{runner:localRunner}):investigateWithAgents(input,{config:azureConfig,fetcher})},
  {id:'fact-selection',skip:local?null:!live?'Live calls disabled.':!azureConfig?'Azure is not configured.':null,
   run:input=>local?investigateLocalFactStory(input,{runner:localRunner}):investigateFactStory(input,{config:azureConfig,fetcher})}
 ];
 return adapter===null?adapters:adapters.filter(candidate=>candidate.id===adapter);
}

function factChecks(testCase){
 if(testCase.expectedInvalid)return null;
 const bundle=integratedMatch(testCase.input);
 const anchor=bundle.state.events.find(e=>e.id===testCase.input.anchorId);
 const checks={score:bundle.recap.score.home===testCase.expected.scoreHome,
  passAccuracy:bundle.state.passOutcomes.accuracy===testCase.expected.passAccuracy,
  anchorRevision:anchor?.revision===testCase.expected.anchorRevision};
 const totals={scoreAway:bundle.recap.score.away,homeShots:bundle.state.stats.home.shots,awayShots:bundle.state.stats.away.shots,
  passAttempts:bundle.state.passOutcomes.attempts,completedPasses:bundle.state.passOutcomes.completed,
  homeRecoveries:bundle.state.stats.home.recoveries,awayRecoveries:bundle.state.stats.away.recoveries,eventCount:bundle.state.events.length};
 for(const [key,value] of Object.entries(totals))if(Object.hasOwn(testCase.expected,key))checks[key]=value===testCase.expected[key];
 return checks;
}

export async function runEvaluation({cases=evaluationCases(),adapters=evaluationAdapters(),repeat=1}={}){
 if(!Number.isInteger(repeat)||repeat<1||repeat>10)throw new RangeError('Evaluation repeat must be from 1 to 10.');
 const results=[];
 for(let repetition=1;repetition<=repeat;repetition++)for(const testCase of cases)for(const adapter of adapters){
  const row={caseId:testCase.id,adapter:adapter.id,repetition,input:testCase.input,expectedInvalid:!!testCase.expectedInvalid,
   fixtureChecks:factChecks(testCase),semanticReview:{status:'pending-human-review',label:null,notes:null}};
  if(adapter.skip){results.push({...row,status:'skipped',reason:adapter.skip,elapsedMs:null});continue;}
  const start=performance.now();
  try {
   const output=await adapter.run(testCase.input);
   row.provider=output.provider??null;row.model=output.model??null;row.source=output.source??null;
   row.authorship=output.authorship??null;
   row.elapsedMs=performance.now()-start;
   if(testCase.expectedInvalid){results.push({...row,status:'failed',reason:'Output returned for an unavailable anchor.'});continue;}
   const {explanation}=buildRequest(testCase.input);
   const expectedKey=['investigator-reviewer','fact-selection'].includes(adapter.id)?createInvestigationTools(testCase.input).key:explanation.key;
   if(output.status==='withheld'){
    if(!Array.isArray(output.claims)||output.claims.length)throw new Error('Withheld result contains claims.');
    results.push({...row,status:'withheld',execution:output.execution||null,claims:[],reason:output.review});continue;
   }
   if(output.key!==expectedKey)throw new Error('Output does not match current evidence dependencies.');
   let evidence=explanation.evidence;
   if(adapter.id==='fact-selection'){
    // Window/score facts can depend on received events outside the selected
    // moment's 15-second sequence. Validate against their pinned tool scope.
    const registry=createInvestigationTools(testCase.input);
    evidence=['get_event_sequence','measure_moment','score_at_moment','get_match_patterns'].flatMap(name=>registry.execute(name,{}).references);
   }
   const validated=validateDraft(output,{evidence});
   results.push({...row,status:'draft',citationCheck:'passed',execution:output.execution||null,
    claims:validated.claims,evidenceKey:output.key,selectedFactIds:output.selectedFactIds??null});
  }catch(error){
   row.elapsedMs=performance.now()-start;
   // A network/configuration/provider failure is not successful abstention.
   const unavailable=testCase.expectedInvalid&&error?.status===400;
   results.push({...row,status:unavailable?'correct-abstention':'failed',reason:unavailable?'Unavailable anchor rejected.':
    error?.status?`Generation failed (status ${error.status}).`:'Output validation or adapter execution failed.'});
  }
 }
 const summaries=adapters.map(adapter=>{
  const rows=results.filter(r=>r.adapter===adapter.id),executed=rows.filter(r=>r.status!=='skipped');
  const times=executed.map(r=>r.elapsedMs).filter(Number.isFinite).sort((a,b)=>a-b);
  const drafts=executed.filter(r=>r.status==='draft');
  const withUsage=executed.filter(r=>r.execution?.usage&&r.execution.usageReportedCalls===r.execution.modelCalls&&r.execution.modelCalls>0);
  return {adapter:adapter.id,total:rows.length,executed:executed.length,skipped:rows.length-executed.length,
   drafts:drafts.length,correctAbstentions:executed.filter(r=>r.status==='correct-abstention').length,
   withheld:executed.filter(r=>r.status==='withheld').length,failed:executed.filter(r=>r.status==='failed').length,
   citationValidatedDrafts:drafts.length,semanticQuality:null,semanticQualityLimitation:'Citation and fixture checks do not measure semantic truth, editorial usefulness, translation quality, or source completeness. Canonical fact-selection wording is supplied by application templates, not generated by the model.',
   latency:{samples:times.length,medianMs:times.length?times[Math.ceil(times.length/2)-1]:null,p95Ms:times.length?times[Math.ceil(times.length*.95)-1]:null,method:'nearest-rank; includes failed/abstention requests'},
   completeUsageRows:withUsage.length,
   tokens:withUsage.length?{prompt:withUsage.reduce((n,r)=>n+r.execution.usage.promptTokens,0),completion:withUsage.reduce((n,r)=>n+r.execution.usage.completionTokens,0)}:null};
 });
 return {schemaVersion:1,createdAt:new Date().toISOString(),repeat,
  limitations:['Citation validity and fixture checks are not semantic truth scores.','Human review is pending; no model quality advantage is established.','Fact selection evaluates AI choice and editorial orchestration; application templates supply prose and citations. This does not establish source truth or football realism.','These short seeded scripted segments are not representative full matches.','Small-sample latency percentiles are descriptive only.','Token totals include only rows with complete reported usage and are not monetary cost.'],
  summaries,results};
}
