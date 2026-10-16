import {createHash} from 'node:crypto';
import {matchState,matchExplanation,recordedStoryEntry} from './match-stream.js';
import {createInvestigationTools} from './investigation-tools.js';
import {storyFacts} from './story-facts.js';
import {renderFactStory} from './fact-renderer.js';
import {storyRequirements,validateRequiredStoryFacts} from './story-requirements.js';
import {storyContextRequirement,validateStoryContext} from './story-context.js';
import {narrativePreferences} from './narratives.js';

const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const fingerprint=v=>JSON.stringify(canonical(v));
const digest=v=>createHash('sha256').update(fingerprint(v)).digest('hex');
const unique=refs=>[...new Map(refs.map(r=>[`${r.type}:${r.id}`,r])).values()];
const tools=['get_event_sequence','score_at_moment','get_match_patterns','measure_moment','get_position_samples'];
const profile=p=>({kind:p.kind,seed:p.seed,audience:p.audience,language:p.language,favoriteClub:p.favoriteClub??null,favoritePlayer:p.favoritePlayer??null});

/** Read-only canonical reconstruction. No provider, inference or imported approval.
 * Recompute saved anchors independently of the ranked fan candidate list. The
 * decision key binds complete relevant inventories, including absent members;
 * advancing the observation clock alone does not change this key.
 */
export function validateProducerStories({preferences,time,items},{stateFactory=matchState,registryFactory=createInvestigationTools}={}){
 if(!preferences||!Array.isArray(items)||items.length>50||!Number.isFinite(time)||time<0)throw new RangeError('Provide at most 50 current producer stories.');
 if(Object.keys(preferences).some(k=>!['kind','seed','audience','language','favoriteClub','favoritePlayer'].includes(k))||!['newcomer','analyst','player','spatial'].includes(preferences.audience)||!Number.isSafeInteger(preferences.seed))throw new RangeError('Choose valid producer viewing preferences.');
 narrativePreferences({...preferences,audience:preferences.audience==='spatial'?'newcomer':preferences.audience});
 const input={...profile(preferences),time},state=stateFactory(input),stories=[],failures=[];
 const ids=new Set();
 for(const request of items){
  if(!request||Object.keys(request).some(k=>!['reviewId','anchorId','source','draft','selectedFactIds','sourceTools','authorship'].includes(k))||typeof request.reviewId!=='string'||!request.reviewId||request.reviewId.length>80||ids.has(request.reviewId)||typeof request.anchorId!=='string'||request.anchorId.length>700||!['recorded','ai'].includes(request.source)||request.sourceTools&&(!Array.isArray(request.sourceTools)||request.sourceTools.length>5)||request.selectedFactIds&&(!Array.isArray(request.selectedFactIds)||request.selectedFactIds.length>5))throw new RangeError('Invalid producer story request.');
  ids.add(request.reviewId);
  try{
   const anchor=state.events.find(e=>e.id===request.anchorId);if(!anchor)throw new RangeError('The recorded event is unavailable or withdrawn.');
   const context=matchExplanation(state,anchor.id);if(!context)throw new RangeError('Current moment evidence is unavailable.');
   let entry,selectedFactIds=[],sourceTools=[],authorship={selection:'recorded-policy',wording:'application-fact-templates'};
   if(request.source==='recorded'){
    const p={audience:preferences.audience==='spatial'?'newcomer':preferences.audience,language:preferences.language,favoriteClub:preferences.favoriteClub??null,favoritePlayer:preferences.favoritePlayer??null,limit:5};
    entry=recordedStoryEntry(state,anchor.id,p);
    if(!entry)throw new RangeError('This event has no recorded story.');
   }else{
    const draft=request.draft;
    if(draft&&(draft.status!=='draft'||draft.evidenceSource!=='integrated-match'||draft.anchorId!==anchor.id||draft.key!==context.investigationKey||draft.audience!==preferences.audience||draft.language!==preferences.language||!['azure-model','local-model'].includes(draft.authorship?.selection)||draft.authorship?.wording!=='application-fact-templates'||!Array.isArray(draft.selectedFacts)))throw new RangeError('Choose a current canonical AI story.');
    selectedFactIds=draft?.selectedFactIds??request.selectedFactIds;
    sourceTools=[...new Set(['get_event_sequence','score_at_moment',...(preferences.audience==='analyst'?['get_match_patterns']:preferences.audience==='spatial'?['measure_moment']:[]),...(draft?draft.selectedFacts.map(f=>f.sourceTool):request.sourceTools||[])])];
    if(sourceTools.some(name=>!tools.includes(name)))throw new RangeError('Unknown story evidence source.');
    authorship=draft?.authorship??request.authorship;
    if(!['azure-model','local-model'].includes(authorship?.selection)||authorship.wording!=='application-fact-templates')throw new RangeError('Missing canonical story authorship.');
    authorship={selection:authorship.selection,wording:'application-fact-templates',mandatoryFacts:'application-domain-rules',additionalContext:authorship.selection};
    const registry=registryFactory({...input,anchorId:anchor.id}),outputs=Object.fromEntries(sourceTools.map(name=>[name,registry.execute(name,{})]));
    const catalog=storyFacts(outputs,registry.scope);
    validateRequiredStoryFacts(selectedFactIds,storyRequirements(catalog,anchor.id));
    validateStoryContext(selectedFactIds,storyContextRequirement(catalog,preferences.audience));
    const rendered=renderFactStory(catalog,selectedFactIds,preferences),selectedFacts=selectedFactIds.map(id=>catalog.facts.find(f=>f.id===id));
    if(draft&&(fingerprint(draft.claims)!==fingerprint(rendered.claims)||fingerprint(draft.selectedFacts)!==fingerprint(selectedFacts)))throw new RangeError('AI claims must match current canonical facts and complete references.');
    entry={anchorId:anchor.id,time:anchor.time,text:rendered.claims.map(c=>c.text).join(' '),key:context.investigationKey,evidence:unique(rendered.claims.flatMap(c=>c.evidence)),metrics:context.metrics,claims:rendered.claims};
   }
   // Full event bodies in the relevant window detect newly arriving members,
   // reclassification and same-revision changes. Earlier goals support scores.
   const windowStart=Math.max(0,anchor.time-(request.source==='ai'?120:15));
   const inventory=state.events.filter(e=>e.time<=anchor.time&&(e.time>=windowStart||e.type==='shot'&&e.result===true)).sort((a,b)=>a.id.localeCompare(b.id));
   const decisionKey='producer:'+digest({preferences:profile(preferences),source:request.source,selectedFactIds,sourceTools,inventory,frames:context.positions,metrics:context.metrics});
   const records=new Map([...state.events.map(e=>[`event:${e.id}`,e]),...state.frames.map(f=>[`frame:${f.id}`,f])]);
   const dependencies=entry.evidence.filter(r=>r.type==='event'||r.type==='frame').map(r=>{
    const body=records.get(`${r.type}:${r.id}`);if(!body||body.revision!==r.revision)throw new RangeError('Complete current story evidence is unavailable.');
    return {type:r.type,id:r.id,revision:r.revision,fingerprint:fingerprint(body)};
   });
   stories.push({reviewId:request.reviewId,entry,dependencies,decisionKey,source:request.source,selectedFactIds,sourceTools,authorship});
  }catch(error){
   // A corrected AI selection can lose fact IDs. Offer a clearly recorded,
   // newly pending replacement, never silently reselect on the model's behalf.
   const replacement=request.source==='ai'&&!request.draft?validateProducerStories({preferences,time,items:[{reviewId:request.reviewId,anchorId:request.anchorId,source:'recorded'}]},{stateFactory,registryFactory}).stories[0]:null;
   failures.push({reviewId:request.reviewId,anchorId:request.anchorId,reason:error.message,...(replacement?{replacement}:{})});
  }
 }
 return {schema:'infinite-stadium.producer-validation.v1',matchId:state.metadata.id,time:state.time,preferences:profile(preferences),stories,failures};
}
