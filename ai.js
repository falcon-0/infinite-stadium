import { snapshot, explainMoment, duration } from './engine.js';
import { sceneInvestigation } from './evidence.js';
import { matchRecap } from './narratives.js';
import { integratedMatch } from './match-stream.js';
import {languagePreference} from './localization.js';

export class GenerationError extends Error {
  constructor(message, status=502,code) { super(message); this.status=status;if(code)this.code=code; }
}

export function configuration(env=process.env) {
  const endpoint=env.AZURE_OPENAI_ENDPOINT, deployment=env.AZURE_OPENAI_DEPLOYMENT, key=env.AZURE_OPENAI_API_KEY;
  if(!endpoint||!deployment||!key) return null;
  let url;
  try { url=new URL(endpoint); } catch { throw new GenerationError('Invalid Azure endpoint configuration.',503); }
  if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash ||
    !/^([a-z0-9-]+\.)+(openai\.azure\.com|services\.ai\.azure\.com)$/i.test(url.hostname))
    throw new GenerationError('Use your HTTPS Azure OpenAI or Foundry resource endpoint.',503);
  url.pathname=url.pathname.replace(/\/$/,'');
  if(!['','/','/openai/v1'].includes(url.pathname)) throw new GenerationError('Use the resource endpoint or its /openai/v1/ base URL.',503);
  url.pathname='/openai/v1/chat/completions';
  return {url:url.href,deployment,key};
}

export function buildRequest(input) {
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new GenerationError('Use an explanation request object.',400);
  try {languagePreference(input.language??'en');}catch {throw new GenerationError('Choose a supported language.',400);}
  const {time,anchorId,audience='newcomer'}=input;
  if(input.source==='integrated-match'){
    if(!['newcomer','analyst','player','spatial'].includes(audience)||!['moment','recap'].includes(input.mode??'moment'))
      throw new GenerationError('Choose a valid integrated audience and moment/recap mode.',400);
    let bundle;
    try {bundle=integratedMatch({...input,audience:audience==='spatial'?'newcomer':audience});}
    catch {throw new GenerationError('Choose valid integrated match settings.',400);}
    if(input.mode==='recap'){
      if(!bundle.state.events.length)throw new GenerationError('No match events have arrived for this recap.',400);
      return {audience,explanation:{source:'integrated-match',task:'recap',anchorId:'recap',key:bundle.recap.key,
        evidence:bundle.recap.evidence,sequence:bundle.state.events,positions:bundle.recap.positions,
        metrics:bundle.recap.entries.flatMap(e=>e.metrics),
        text:[bundle.recap.summary,...bundle.recap.entries.map(e=>e.text)].join('\n'),limit:bundle.state.limit}};
    }
    if(typeof anchorId!=='string'||!bundle.explanation)throw new GenerationError('Select an integrated match event that has arrived.',400);
    return {audience,explanation:bundle.explanation};
  }
  if(input.source==='recap'){
    let recap;
    try {recap=matchRecap(time,{audience,favoriteClub:input.favoriteClub??null,favoritePlayer:input.favoritePlayer??null,limit:5,language:input.language??'en'});}
    catch {throw new GenerationError('Choose a valid recap time, audience and favorites.',400);}
    if(!recap.evidence.length)throw new GenerationError('No match events have arrived for this recap.',400);
    return {audience,explanation:{source:'recap',anchorId:'recap',key:recap.key,evidence:recap.evidence,
      sequence:snapshot(time).events,text:[recap.summary,...recap.entries.map(e=>e.text)].join('\n'),limit:recap.limitation}};
  }
  if(input.source==='scene'){
    if(!['newcomer','analyst','spatial'].includes(audience)||typeof anchorId!=='string')throw new GenerationError('Choose a valid scene event and audience.',400);
    let explanation;
    try {({explanation}=sceneInvestigation(input));}catch {throw new GenerationError('Choose a valid scene, seed and replay time.',400);}
    if(!explanation)throw new GenerationError('This event has not arrived at the selected scene time.',400);
    return {explanation,audience};
  }
  if(input.source&&input.source!=='match')throw new GenerationError('Unknown evidence source.',400);
  if(!Number.isFinite(time)||time<0||time>duration||typeof anchorId!=='string'||!['newcomer','analyst','spatial'].includes(audience))
    throw new GenerationError('Choose a valid replay time, event and audience.',400);
  const explanation=explainMoment(snapshot(time),anchorId);
  if(!explanation) throw new GenerationError('This event has not arrived at the selected replay time.',400);
  return {explanation,audience};
}

export function validateDraft(draft, explanation) {
  if(!draft || !Array.isArray(draft.claims) || draft.claims.length<1 || draft.claims.length>5)
    throw new GenerationError('The model returned an invalid draft.');
  const references=new Set(explanation.evidence.map(e=>`${e.id}@${e.revision}`));
  const claims=draft.claims.map(claim=>{
    if(!claim||typeof claim.text!=='string'||!claim.text.trim()||claim.text.length>700||!Array.isArray(claim.evidence)||!claim.evidence.length||claim.evidence.length>20)
      throw new GenerationError('The model returned an invalid claim.');
    const evidence=claim.evidence.map(ref=>{
      if(!ref||!references.has(`${ref.id}@${ref.revision}`)) throw new GenerationError('The model cited unavailable or outdated evidence.');
      return {id:ref.id,revision:ref.revision};
    });
    return {text:claim.text.trim(),evidence};
  });
  return {claims};
}

export async function generateDraft(input,{config=configuration(),fetcher=fetch,signal}={}) {
  const started=Date.now();
  const {explanation,audience}=buildRequest(input);
  const language=languagePreference(input.language??'en');
  const result=await azureCompletion([
    {role:'system',content:'You are a football broadcast drafting assistant. Use only supplied received evidence and deterministic analysis. Event coordinates are normalized from 0 to 100; sampled positions use metres on a 105 by 68 metre pitch. Home attacks toward increasing x. Never invent movement between samples, intent, tactics, causation, match history, pressure or probabilities. Missing exact samples mean spatial measurements are unavailable. A null pass result is pending, not failed. Sample displacement rates are interval measurements, not top speed or path length. For newcomer use plain language; analyst use precise evidence-based detail; spatial describe recorded locations with limitations. Output ONLY JSON: {"claims":[{"text":"one concise factual sentence","evidence":[{"id":"EV-001","revision":1}]}]}. Return 1 to 5 claims, each citing supporting IDs from the reference list. Do not include a title.'},
    {role:'user',content:JSON.stringify({source:explanation.source||'match',audience,outputLanguage:language.name,
      task:explanation.source==='recap'||explanation.task==='recap'?'Draft a concise recap of the observed synthetic demo segment. For player audience emphasize the personalized analysis. It is not a full match.':'Draft a concise explanation of the selected moment.',
      analysis:explanation.text,limitation:explanation.limit,events:explanation.sequence,positions:explanation.positions||[],metrics:explanation.metrics||[],references:explanation.evidence})}
  ],{config,fetcher,signal});
  let draft;
  try {draft=JSON.parse(result.message.content);}catch {throw new GenerationError('The model did not return a complete JSON draft.');}
  return {source:'azure-ai',evidenceSource:explanation.source||'match',audience,language:language.code,anchorId:explanation.anchorId,key:explanation.key,...validateDraft(draft,explanation),
    execution:{modelCalls:1,toolCalls:0,repairCount:0,elapsedMs:Date.now()-started,
      usage:result.usage?{promptTokens:result.usage.prompt_tokens??0,completionTokens:result.usage.completion_tokens??0}:null,
      usageReportedCalls:Number.isInteger(result.usage?.prompt_tokens)&&Number.isInteger(result.usage?.completion_tokens)?1:0},
    review:'Evidence references passed validation. The wording is an AI draft and still needs factual review.'};
}

export async function azureCompletion(messages,{config=configuration(),fetcher=fetch,tools,signal,responseFormat,temperature,maxCompletionTokens=1600,timeoutMs=30000}={}){
  if(!config) throw new GenerationError('AI is not configured. Set the Azure endpoint, deployment and API key on the server.',503);
  const cancelled=()=>new GenerationError(signal?.reason?.name==='TimeoutError'?'The AI workflow reached its execution deadline. No draft was released.':'Generation was cancelled.',signal?.reason?.name==='TimeoutError'?504:499,signal?.reason?.name==='TimeoutError'?'workflow-timeout':'cancelled');
  if(signal?.aborted)throw cancelled();
  if(temperature!==undefined&&(!Number.isFinite(temperature)||temperature<0||temperature>2))throw new GenerationError('Choose a sampling temperature from 0 to 2.');
  if(!Number.isSafeInteger(maxCompletionTokens)||maxCompletionTokens<1||maxCompletionTokens>1600)throw new GenerationError('Choose a model output limit from 1 to 1600 tokens.');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new GenerationError('Choose an Azure request deadline from 1 to 30000 milliseconds.');
  const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(new DOMException('Azure request deadline exceeded.','TimeoutError')),timeoutMs);
  const requestSignal=signal?AbortSignal.any([signal,deadline.signal]):deadline.signal;
  let abortListener;
  const interrupted=new Promise((_,reject)=>{abortListener=()=>reject(requestSignal.reason);requestSignal.addEventListener('abort',abortListener,{once:true});});
  const check=()=>{if(requestSignal.aborted)throw requestSignal.reason;};
  try {
    const response=await Promise.race([fetcher(config.url,{
      method:'POST', headers:{'Content-Type':'application/json','api-key':config.key},
      signal:requestSignal,
      body:JSON.stringify({model:config.deployment,max_completion_tokens:maxCompletionTokens,messages,...(temperature!==undefined?{temperature}:{}),...(tools?{tools,tool_choice:'auto'}:{}),...(responseFormat?{response_format:responseFormat}:{})})
    }),interrupted]);
    check();
    if(!response.ok)throw new GenerationError(`Azure rejected the generation request (HTTP ${response.status}). ${response.status===429?'The provider is rate limited; no automatic retry was made.':'Check your deployment and access.'}`,response.status===429?429:502,response.status===429?'azure-rate-limit':'azure-http');
    const data=await Promise.race([response.json(),interrupted]);
    check();
    const choice=data?.choices?.[0];
    if(!choice?.message||!(['stop',...(tools?['tool_calls']:[])].includes(choice.finish_reason)))throw new GenerationError(`The model did not return a complete JSON draft.${choice?.finish_reason==='length'?' Its output token limit was reached.':''}`,502,'azure-incomplete-response');
    return {message:choice.message,finishReason:choice.finish_reason,usage:data.usage||null};
  }catch(error){
    if(signal?.aborted)throw cancelled();
    if(deadline.signal.aborted)throw new GenerationError('The Azure request timed out before a complete response arrived. No automatic retry was made.',504,'azure-timeout');
    if(error instanceof GenerationError)throw error;
    if(error instanceof SyntaxError)throw new GenerationError('The model did not return a complete JSON draft.',502,'azure-invalid-response');
    throw new GenerationError('Azure could not be reached or its response connection was interrupted. No automatic retry was made.',502,'azure-network');
  }finally{
    clearTimeout(timer);requestSignal.removeEventListener('abort',abortListener);
  }
}
