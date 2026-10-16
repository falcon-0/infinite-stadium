import {answerMatchQuestionAI} from './match-question-ai.js';
import {evaluationHash} from './conversational-evaluation.js';

const copy=value=>structuredClone(value);
const reviewSchema='match_answer_review';

function measurements(calls,elapsedMs,pricing){
 const reported=calls.filter(call=>Number.isInteger(call.usage?.prompt_tokens)&&call.usage.prompt_tokens>=0&&Number.isInteger(call.usage?.completion_tokens)&&call.usage.completion_tokens>=0);
 const promptTokens=reported.reduce((sum,call)=>sum+call.usage.prompt_tokens,0),completionTokens=reported.reduce((sum,call)=>sum+call.usage.completion_tokens,0);
 const complete=reported.length===calls.length;
 return {modelCalls:calls.length,elapsedMs,reportedUsageCalls:reported.length,usageComplete:complete,
  tokens:{promptTokens,completionTokens},estimatedUsd:pricing&&complete?(promptTokens*pricing.inputUsdPerMillion+completionTokens*pricing.outputUsdPerMillion)/1e6:null};
}

function validatePricing(pricing){
 if(!pricing)return;
 if(!['inputUsdPerMillion','outputUsdPerMillion'].every(key=>Number.isFinite(pricing[key])&&pricing[key]>=0)||typeof pricing.source!=='string'||!pricing.source.trim()||!Number.isFinite(Date.parse(pricing.asOf)))throw new Error('Pricing requires nonnegative per-million rates, a source and asOf date.');
}

/** Observe a counterfactual stopping point; never bypass production review.
 * The checked answer in the first reviewer request has already passed the
 * application's pre-review guards. Its exact draft/evidence is the baseline.
 * The real production function then continues normally. No approval is mocked.
 */
export async function compareWatchWorkflow(input,{config,fetcher,canRepair=()=>false,signal,pricing=null,clock=()=>performance.now()}={}){
 if(typeof fetcher!=='function')throw new Error('Supply an explicit transport; this comparison never defaults to network access.');
 validatePricing(pricing);
 const started=clock(),calls=[],reviewBoundaries=[];let baseline=null,full=null,error=null;
 const observedFetch=async(url,options)=>{
  if(calls.length>=5)throw new Error('Comparison exceeded its five-call execution ceiling.');
  const request=JSON.parse(options.body),schema=request.response_format?.json_schema?.name??null;
  // Persist only the model payload. URL, authentication headers and key are
  // deliberately excluded from both successful and failed trace records.
  if(schema===reviewSchema){
   const packet=JSON.parse(request.messages.at(-1).content);
   if(!packet.answer?.claims||!packet.evidence)throw new Error('Production reviewer boundary changed; comparison cannot identify a baseline.');
   const evidenceHash=evaluationHash(packet.evidence);
   reviewBoundaries.push({callIndex:calls.length,evidenceHash,sourceEvidenceHash:packet.evidence.sourceFingerprint??evidenceHash});
   if(!baseline)baseline={status:'checked-candidate',answer:packet.answer.claims.map(claim=>claim.text).join(' '),draft:copy(packet.answer),
    evidence:copy(packet.evidence),evidenceHash,boundaryCallIndex:calls.length,
    measurements:measurements(calls,clock()-started,pricing),quality:{verdict:'unreviewed'},
    provenance:'Counterfactual stop after pre-review application checks; not released by production.'};
  }
  const entry={index:calls.length,schema,request:copy(request),startedAfterMs:clock()-started,status:'pending'};
  calls.push(entry);const callStarted=clock();
  try{
   const response=await fetcher(url,options);
   const body=await response.clone().json().catch(()=>null);
   Object.assign(entry,{status:response.status,elapsedMs:clock()-callStarted,usage:body?.usage??null,
    response:body?{model:body.model??null,choices:body.choices??null,error:body.error?{code:body.error.code??null}:null}:null});
   return response;
  }catch(cause){
   Object.assign(entry,{status:'transport-failed',elapsedMs:clock()-callStarted,errorName:cause?.name??'Error'});
   throw cause;
  }
 };
 try{full=await answerMatchQuestionAI(input,{config,fetcher:observedFetch,canRepair,signal});}
 catch(cause){error={code:cause.code??null,status:cause.status??null,message:cause.message};}
 const fullMeasurements=measurements(calls,clock()-started,pricing);
 if(!baseline&&full&&calls.length===0)baseline={status:'local-result',answer:full.answer??null,draft:{scope:full.scope,claims:full.claims??[]},
  evidence:null,evidenceHash:null,boundaryCallIndex:null,measurements:measurements([],fullMeasurements.elapsedMs,pricing),quality:{verdict:'unreviewed'},
  provenance:'Shared deterministic local result; no reviewer intervention occurred.'};
 const first=baseline?.measurements;
 return {schema:'infinite-stadium.watch-comparison-case.v1',input:copy(input),inputHash:evaluationHash(input),
  method:'paired-first-review-boundary',baseline:baseline??{status:'not-reached',quality:{verdict:'unreviewed'},reason:'No candidate passed the pre-review checks before workflow failure.'},
  full:{status:full?'generated':'failed',result:full,error,measurements:fullMeasurements,quality:{verdict:'unreviewed'}},
  paired:baseline?.status==='checked-candidate',sameSourceAtEveryReview:reviewBoundaries.length?reviewBoundaries.every(boundary=>boundary.sourceEvidenceHash===reviewBoundaries[0].sourceEvidenceHash):null,sameEvidenceAtEveryReview:reviewBoundaries.length?reviewBoundaries.every(boundary=>boundary.evidenceHash===reviewBoundaries[0].evidenceHash):null,
  delta:first?{modelCalls:fullMeasurements.modelCalls-first.modelCalls,elapsedMs:fullMeasurements.elapsedMs-first.elapsedMs,
   promptTokens:fullMeasurements.usageComplete&&first.usageComplete?fullMeasurements.tokens.promptTokens-first.tokens.promptTokens:null,
   completionTokens:fullMeasurements.usageComplete&&first.usageComplete?fullMeasurements.tokens.completionTokens-first.tokens.completionTokens:null,
   estimatedUsd:fullMeasurements.estimatedUsd!==null&&first.estimatedUsd!==null?fullMeasurements.estimatedUsd-first.estimatedUsd:null,
   answerChanged:full?baseline.answer!==full.answer:null}:null,
  reviewBoundaries,calls,pricing:pricing?copy(pricing):null,
  limitations:['Baseline shares the actual analyst/retrieval trajectory; it is not an independent end-to-end run.','Baseline includes any repair caused by deterministic checks before the first reviewer request. Later reviewer-driven repair belongs only to the full arm.','The model-assisted actor/roster cross-check occurs after model review and therefore belongs to the full arm, not the pre-review baseline.','Boundary capture proves execution of pre-review checks, not semantic correctness. Both arms need independent answer adjudication.','No score or quality advantage is inferred from generation, changed wording, or reviewer approval.','Latency includes trace-capture overhead. Token prices are optional supplied estimates, never billing confirmation.']};
}

export function summarizeWatchComparison(cases){
 const paired=cases.filter(row=>row.paired),complete=cases.filter(row=>row.full?.status==='generated');
 return {cases:cases.length,paired:paired.length,localResults:cases.filter(row=>row.baseline?.status==='local-result').length,
  baselineNotReached:cases.filter(row=>row.baseline?.status==='not-reached').length,fullGenerated:complete.length,
  fullFailed:cases.length-complete.length,changedAnswers:paired.filter(row=>row.delta?.answerChanged).length,
  executedModelCalls:cases.reduce((sum,row)=>sum+row.full.measurements.modelCalls,0),
  incrementalCallsAfterBoundary:paired.reduce((sum,row)=>sum+row.delta.modelCalls,0),
  humanReviewCount:0,automatedReviewCount:0,qualityAdvantage:null,
  interpretation:'Execution/cost comparison only; quality is unreviewed. Shared prefix calls are counted once in actual spending.'};
}
