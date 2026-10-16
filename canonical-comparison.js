import {createHash} from 'node:crypto';
import {createInvestigationTools} from './investigation-tools.js';
import {storyFacts} from './story-facts.js';
import {requiredStoryTools,storyRequirements,validateRequiredStoryFacts} from './story-requirements.js';
import {storyContextRequirement,validateStoryContext} from './story-context.js';
import {renderFactStory} from './fact-renderer.js';

export const comparisonArms=['deterministic','single-selector','selector-reviewer'];
const tools=['get_event_sequence','score_at_moment','get_match_patterns','measure_moment'];
const humanReview=()=>({status:'not-conducted',reviewerId:null,comprehension:null,relevance:null,
 misleadingInference:null,nativeLanguageQuality:null,notes:null});
export function canonicalComparisonCases(){
 const earlier=[
  {id:'pending-pass',kind:'central',seed:101,time:2,event:'pass',audience:'newcomer'},
  {id:'corrected-goal',kind:'wide',seed:902,time:10,event:'shot',audience:'analyst'},
  {id:'spatial-goal',kind:'central',seed:717,time:10,event:'shot',audience:'spatial'},
  {id:'unreceived-goal',kind:'central',seed:101,time:7,event:'shot',audience:'newcomer',expectedUnavailable:true}
 ].map(({id,event,expectedUnavailable=false,...input})=>({id,expectedUnavailable,
  input:{...input,source:'integrated-match',language:'en',anchorId:`${input.kind}-${input.seed}-${event}`}}));
 return [...earlier,
  {id:'continuous-goal',input:{source:'integrated-match',kind:'sustained',seed:717,time:120,anchorId:'comparison-sustained-717-shot-116',audience:'newcomer',language:'en'}},
  {id:'interrupted-shot',input:{source:'integrated-match',kind:'interrupted',seed:902,time:120,anchorId:'comparison-interrupted-902-shot-106',audience:'analyst',language:'en'}}];
}

/** Fixed evidence ablation: every arm receives all fact-producing tools. This
 * deliberately does not evaluate production dynamic tool selection. */
export function prepareCanonicalComparison(input){
 const registry=createInvestigationTools(input,{compactPositions:true}),outputs={};
 for(const name of tools)outputs[name]=registry.execute(name,{});
 const catalog=storyFacts(outputs,registry.scope);
 const packet={input:structuredClone(input),anchorId:registry.anchorId,audience:registry.audience,
  language:registry.language.code,preferences:registry.preferences,scope:registry.scope,
  applicationRequiredTools:requiredStoryTools(outputs.get_event_sequence,registry.anchorId),
  evidenceTools:[...tools],catalog,requirements:storyRequirements(catalog,registry.anchorId),
  contextRequirement:storyContextRequirement(catalog,registry.audience),
  maximumFacts:['newcomer','player'].includes(registry.audience)?3:5};
 packet.catalogHash=createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
 return packet;
}

export function validateCanonicalSelection(packet,candidate){
 if(!candidate||typeof candidate!=='object'||Array.isArray(candidate)||Object.keys(candidate).length!==1||
  !Array.isArray(candidate.factIds)||!candidate.factIds.length||candidate.factIds.length>packet.maximumFacts||
  candidate.factIds.some(id=>typeof id!=='string')||new Set(candidate.factIds).size!==candidate.factIds.length)
  throw new RangeError('Return only one to maximumFacts unique factIds.');
 const available=new Map(packet.catalog.facts.map(f=>[f.id,f]));
 if(candidate.factIds.some(id=>!available.has(id)))throw new RangeError('Selection contains an unavailable fact ID.');
 if(candidate.factIds[0]!==packet.requirements.requiredFactIds[0])throw new RangeError('The selected moment must lead.');
 validateRequiredStoryFacts(candidate.factIds,packet.requirements);
 validateStoryContext(candidate.factIds,packet.contextRequirement);
 return renderFactStory(packet.catalog,candidate.factIds,{audience:packet.audience,language:packet.language});
}

/** A disclosed, fixed ranking, not an optimized baseline fitted to ratings. */
export function deterministicCanonicalSelection(packet){
 const ids=[...packet.requirements.requiredFactIds];
 const priorities=packet.audience==='spatial'?
  ['nearest-sampled-opponent','pass-endpoint-displacement','player-sample-displacement-rate']:
  ['recovery-before-shot','completed-passes-between','window-event-count','nearest-sampled-opponent'];
 const ranked=packet.catalog.facts.map((fact,index)=>({fact,index})).sort((a,b)=>{
  const rank=f=>priorities.includes(f.kind)?priorities.indexOf(f.kind):100;
  return rank(a.fact)-rank(b.fact)||a.index-b.index;
 });
 if(packet.contextRequirement.minimum&&!ids.some(id=>packet.contextRequirement.candidateFactIds.includes(id))){
  const context=ranked.find(({fact})=>packet.contextRequirement.candidateFactIds.includes(fact.id));
  if(context)ids.push(context.fact.id);
 }
 // One additional useful context at most; do not fill the quota with counts.
 if(ids.length===packet.requirements.requiredFactIds.length&&ids.length<packet.maximumFacts){
  const extra=ranked.find(({fact})=>priorities.includes(fact.kind)&&!ids.includes(fact.id));
  if(extra)ids.push(extra.fact.id);
 }
 return {factIds:ids};
}

const parse=content=>typeof content==='string'?JSON.parse(content):content;
// Fail closed: other input-validation errors are not unavailable evidence.
const unavailableAnchor=error=>error?.status===400&&error.message==='The selected investigation event has not arrived.';
function omissions(packet,candidate){
 const ids=Array.isArray(candidate?.factIds)?candidate.factIds:[];
 return {requiredFactIds:packet.requirements.requiredFactIds.filter(id=>!ids.includes(id)),
  requiredContextMissing:packet.contextRequirement.minimum===1&&!ids.some(id=>packet.contextRequirement.candidateFactIds.includes(id))};
}
const selectionInstruction='Select relevant current factIds from the fixed catalog. Return only a JSON object {"factIds":[...]}. The moment must lead; include every requiredFactId and the required audience context within maximumFacts. Prefer clear buildup for newcomers and relevant window or sampled context for analysts/spatial viewers. Do not add prose, infer tactical cause, or fill the quota unnecessarily.';
const reviewInstruction='Review relevance, redundancy and audience suitability of the selected facts using the same fixed catalog and slot limit. Respect all mandatory and context requirements. Do not certify source truth or request unavailable facts. Return only a JSON object {"decision":"approve"|"revise","issues":["concrete selection issue"]}. Approval requires no issues; revision requires an issue.';

/** completion is an explicitly injected transport, not an implicit provider.
 * It receives {role,payload,prompt,signal} and returns {content,usage?,refused?}; usage
 * uses promptTokens/completionTokens. Callers must own any provider budget.
 * No Azure/local adapter is exposed until shared budget integration exists. */
export async function runCanonicalComparison({cases=canonicalComparisonCases(),completion=null,
 maxModelCalls=6,providerLabel='injected-unverified',timeoutMs=60000}={}){
 if(!Array.isArray(cases)||!cases.length||cases.length>6||new Set(cases.map(c=>c.id)).size!==cases.length||
  cases.some(c=>typeof c.id!=='string'||!c.id)||!Number.isInteger(maxModelCalls)||maxModelCalls<0||maxModelCalls>6||
  completion!==null&&typeof completion!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)
  throw new RangeError('Provide one to six unique cases, at most six total model calls, and a bounded timeout.');
 const results=[],prepared=[],controller=new AbortController();let totalModelCalls=0;
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  for(const testCase of cases){
   let packet,preparationError;
   try{packet=prepareCanonicalComparison(testCase.input);prepared.push({caseId:testCase.id,packet});}
   catch(error){preparationError=error;prepared.push({caseId:testCase.id,input:structuredClone(testCase.input),preparationError:error.message});}
   for(const arm of comparisonArms){
    const row={caseId:testCase.id,arm,input:structuredClone(testCase.input),catalogHash:packet?.catalogHash??null,
     status:null,claims:[],selectedFactIds:[],attempts:[],applicationIssues:[],modelIssues:[],executionIssues:[],
     execution:{modelCalls:0,usageReportedCalls:0,tokens:null,tokensComplete:false,elapsedMs:null},humanReview:humanReview()};
    if(arm!=='deterministic'&&!completion){results.push({...row,status:'skipped',reason:'No model transport supplied; no AI comparison was run.'});continue;}
    const started=performance.now();
    if(preparationError){results.push({...row,status:testCase.expectedUnavailable&&unavailableAnchor(preparationError)?'correct-abstention':'failed',
     applicationIssues:[preparationError.message],execution:{...row.execution,elapsedMs:performance.now()-started}});continue;}
    if(testCase.expectedUnavailable){results.push({...row,status:'failed',applicationIssues:['Expected unavailable anchor was admitted.']});continue;}
    if(arm!=='deterministic'&&totalModelCalls>=maxModelCalls){
     results.push({...row,status:'skipped',reasonCode:'budget-exhausted',reason:'Report model-call budget exhausted before this arm ran.'});continue;
    }
    const call=async(stage,payload)=>{
     if(totalModelCalls>=maxModelCalls)throw Object.assign(new Error('Report model-call budget exhausted.'),{code:'budget-exhausted'});
     if(controller.signal.aborted)throw new Error('Report deadline exceeded.');
     totalModelCalls++;row.execution.modelCalls++;
     // Independent copies prevent a transport from contaminating another arm.
     const request={role:stage,arm,prompt:stage==='selection'?selectionInstruction:reviewInstruction,
      payload:{...structuredClone(packet),...structuredClone(payload)},signal:controller.signal};
     let listener;
     const aborted=new Promise((_,reject)=>{listener=()=>reject(new Error('Report deadline exceeded.'));controller.signal.addEventListener('abort',listener,{once:true});});
     let response;
     try{response=await Promise.race([Promise.resolve().then(()=>completion(request)),aborted]);}
     finally{controller.signal.removeEventListener('abort',listener);}
     if(controller.signal.aborted)throw new Error('Report deadline exceeded.');
     const usage=response?.usage;
     if(Number.isSafeInteger(usage?.promptTokens)&&usage.promptTokens>=0&&Number.isSafeInteger(usage?.completionTokens)&&usage.completionTokens>=0){
      row.execution.usageReportedCalls++;row.execution.tokens??={promptTokens:0,completionTokens:0};
      row.execution.tokens.promptTokens+=usage.promptTokens;row.execution.tokens.completionTokens+=usage.completionTokens;
     }
     if(response?.refused){row.status='refused';throw new Error('Model explicitly refused.');}
     return response?.content;
    };
    let repairIssues=[];
    try{
     for(let attempt=0;attempt<(arm==='deterministic'?1:2);attempt++){
      let candidate,rendered;
      const raw=arm==='deterministic'?deterministicCanonicalSelection(packet):await call('selection',{repairIssues,attempt});
      try{candidate=parse(raw);rendered=validateCanonicalSelection(packet,candidate);}
      catch(error){repairIssues=[error.message];row.applicationIssues.push(error.message);
       row.attempts.push({attempt,selectedFactIds:Array.isArray(candidate?.factIds)?candidate.factIds:[],omissions:omissions(packet,candidate),applicationAccepted:false});continue;}
      row.attempts.push({attempt,selectedFactIds:[...candidate.factIds],omissions:omissions(packet,candidate),applicationAccepted:true});
      if(arm==='selector-reviewer'){
       let verdict;
       const reviewContent=await call('review',{selectedFactIds:candidate.factIds,claims:rendered.claims,attempt});
       try{verdict=parse(reviewContent);}catch{verdict=null;}
       if(!verdict||typeof verdict!=='object'||Array.isArray(verdict)||Object.keys(verdict).length!==2||
        !['approve','revise'].includes(verdict.decision)||!Array.isArray(verdict.issues)||verdict.issues.length>8||
        verdict.issues.some(issue=>typeof issue!=='string'||!issue.trim()||issue.length>500)||
        (verdict.decision==='approve')!==(verdict.issues.length===0)){
        repairIssues=['Invalid editorial review contract.'];row.applicationIssues.push(...repairIssues);continue;
       }
       row.attempts.at(-1).review=verdict;
       if(verdict.decision==='revise'){repairIssues=verdict.issues;row.modelIssues.push(...verdict.issues);continue;}
      }
      row.status='draft';row.selectedFactIds=[...candidate.factIds];row.claims=rendered.claims;break;
     }
     row.status??='withheld';
    }catch(error){row.status??='failed';if(error.code==='budget-exhausted')row.reasonCode=error.code;row.executionIssues.push(error.message);}
    row.execution.elapsedMs=performance.now()-started;
    row.execution.tokensComplete=row.execution.modelCalls>0&&row.execution.usageReportedCalls===row.execution.modelCalls;
    results.push(row);
   }
  }
 }finally{clearTimeout(timer);}
 return {schemaVersion:1,createdAt:new Date().toISOString(),kind:'isolated-fixed-catalog-ablation',
  provider:completion?providerLabel:'offline',totalModelCalls,maxModelCalls,prepared,results,
  coverage:{plannedCases:cases.length,plannedRows:results.length,byArm:Object.fromEntries(comparisonArms.map(arm=>{
   const rows=results.filter(row=>row.arm===arm);
   return [arm,{planned:rows.length,modelExecuted:rows.filter(row=>row.execution.modelCalls>0).length,
    skipped:rows.filter(row=>row.status==='skipped').length,budgetSkipped:rows.filter(row=>row.status==='skipped'&&row.reasonCode==='budget-exhausted').length,
    executionFailed:rows.filter(row=>row.status==='failed'&&row.execution.modelCalls>0).length}];
  }))},
  humanEvaluation:{status:'not-conducted',participantCount:0,observations:[],consentRecords:[]},
  limitations:['All arms share fixed complete bounded catalogs, coverage rules, maximum slots and application wording.',
   'This isolates fact selection and editorial review; it does not run or evaluate production dynamic tool selection.',
   'The deterministic ranking is a disclosed baseline, not a proven optimum. Both AI arms permit one repair.',
   'Global call budget can leave later arms unexecuted or incomplete; inspect every row and do not compare unequal case coverage.',
   'Budget-unexecuted arms are skipped; budget exhaustion after an arm starts is an execution failure, not a model-quality result. Correct abstentions identify unavailable anchors, not invalid settings.',
   'No human semantic, football, language, accessibility or user-benefit result is implied by validation.',
   'Injected transports require separately integrated provider spending controls; the CLI has no live provider adapter.']};
}
