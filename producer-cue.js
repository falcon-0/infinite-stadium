const kinds=new Set(['event','frame','metric']);
const refKey=ref=>`${ref.type}:${ref.id}`;
const fullKey=ref=>`${refKey(ref)}@${ref.revision}`;
const validString=value=>typeof value==='string'&&value.length>0&&value.length<=700;
const validRef=ref=>ref&&kinds.has(ref.type)&&validString(ref.id)&&Number.isSafeInteger(ref.revision)&&ref.revision>0;
const copyRef=ref=>({type:ref.type,id:ref.id,revision:ref.revision});
const sameRefs=(a,b)=>a.length===b.length&&new Set(a.map(fullKey)).size===a.length&&
 new Set(b.map(fullKey)).size===b.length&&a.every(ref=>b.some(other=>fullKey(ref)===fullKey(other)));

/** A reviewable cue for this prototype's received synthetic replay, not a
 * publishing command. Callers supply current references from ALL dependencies,
 * including score goals/pattern inputs outside the selected moment window.
 * Canonical authorship is trusted-server provenance, not a prose truth check.
 */
export function buildStoryCue(draft,explanation,options={}){
 const {preferencesMatch,observedAt,eventTime,durationSeconds=20,receivedReferences,language,audience,factCatalog}=options;
 if(preferencesMatch!==true)throw new RangeError('Story preferences changed; regenerate before exporting a cue.');
 if(!draft||draft.status!=='draft'||!['azure-model','local-model'].includes(draft.authorship?.selection)||draft.authorship?.wording!=='application-fact-templates')
  throw new TypeError('Only a current canonical AI-selected fact story can become a cue.');
 if(!explanation||!validString(draft.anchorId)||draft.anchorId!==explanation.anchorId||typeof draft.key!=='string'||!draft.key||
    ![explanation.key,explanation.investigationKey].filter(key=>typeof key==='string'&&key).includes(draft.key))
  throw new RangeError('The story is superseded or does not match the selected received evidence.');
 if(!['en','es','fr','pt'].includes(draft.language)||!['newcomer','analyst','player','spatial'].includes(draft.audience))
  throw new TypeError('The story needs a supported language and audience.');
 for(const [field,expected] of [['language',language],['audience',audience],['language',explanation.language],['audience',explanation.audience]]){
  if(expected!==undefined&&draft[field]!==expected)throw new RangeError(`Story ${field} does not match the current selection.`);
 }
 const anchor=explanation.sequence?.find(event=>event.id===explanation.anchorId&&event.operation!=='delete');
 if(!anchor||!Number.isFinite(anchor.time)||anchor.time<0||eventTime!==anchor.time||
    !Number.isFinite(observedAt)||observedAt<eventTime||!Number.isFinite(durationSeconds)||durationSeconds<1||durationSeconds>60||
    !Number.isFinite(observedAt+durationSeconds))
  throw new RangeError('Use the exact selected event time, a received observation time, and a duration from 1 to 60 seconds.');
 if(!receivedReferences||typeof receivedReferences[Symbol.iterator]!=='function')
  throw new TypeError('Supply current event, frame and metric revision references for every story dependency.');
 const current=new Map();let receivedCount=0;
 for(const ref of receivedReferences){
  if(++receivedCount>10000||!validRef(ref))throw new TypeError('Current received references are invalid or exceed 10000 entries.');
  const previous=current.get(refKey(ref));
  if(previous&&previous.revision!==ref.revision)throw new RangeError('Current references contain conflicting revisions; materialize the received state first.');
  current.set(refKey(ref),copyRef(ref));
 }
 const maximum=['newcomer','player'].includes(draft.audience)?3:5;
 if(!Array.isArray(draft.claims)||draft.claims.length<1||draft.claims.length>maximum||
    !Array.isArray(draft.selectedFactIds)||draft.selectedFactIds.length!==draft.claims.length||
    new Set(draft.selectedFactIds).size!==draft.selectedFactIds.length)
  throw new TypeError('The canonical story needs a bounded selection of unique fact claims.');
 const evidence=new Map();
 const claims=draft.claims.map((claim,index)=>{
  if(!claim||!validString(claim.factId)||claim.factId!==draft.selectedFactIds[index]||!validString(claim.text)||
     !Array.isArray(claim.evidence)||claim.evidence.length<1||claim.evidence.length>1000||
     claim.evidence.some(ref=>!validRef(ref))||new Set(claim.evidence.map(refKey)).size!==claim.evidence.length)
   throw new TypeError('Each cue claim needs canonical text, its selected fact ID and unique complete references.');
  for(const ref of claim.evidence){
   if(current.get(refKey(ref))?.revision!==ref.revision)throw new RangeError('A story reference is unknown or superseded in the current received state.');
   evidence.set(refKey(ref),copyRef(ref));
  }
  if(factCatalog!==undefined){
   if(!Array.isArray(factCatalog?.facts))throw new TypeError('Provide a valid selected fact catalog.');
   const fact=factCatalog.facts.find(f=>f.id===claim.factId);
   if(!fact||!Array.isArray(fact.evidence)||fact.evidence.some(ref=>!validRef(ref))||!sameRefs(claim.evidence,fact.evidence))
    throw new RangeError('A cue claim does not preserve its complete catalog fact references.');
   if(index===0&&(fact.kind!=='moment'||fact.values?.anchorId!==draft.anchorId))throw new RangeError('The selected moment must lead the cue.');
  }
  return {factId:claim.factId,text:claim.text,evidence:claim.evidence.map(copyRef)};
 });
 if(!claims[0].evidence.some(ref=>ref.type==='event'&&ref.id===draft.anchorId&&ref.revision===anchor.revision))
  throw new RangeError('The cue must begin with the current selected event reference.');
 return {schema:'infinite-stadium.studio-cue.v1',synthetic:true,status:'human-review-required',
  anchorId:draft.anchorId,evidenceKey:draft.key,language:draft.language,audience:draft.audience,
  authorship:{selection:draft.authorship.selection,wording:'application-fact-templates',...(draft.authorship.mandatoryFacts==='application-domain-rules'?{
   mandatoryFacts:'application-domain-rules',additionalContext:draft.authorship.selection}: {})},claims,
  evidence:[...evidence.values()].sort((a,b)=>fullKey(a).localeCompare(fullKey(b))),
  timing:{unit:'seconds',anchorEventTime:eventTime,availableAtObservedTime:observedAt,durationSeconds,
   expiresAtObservedTime:observedAt+durationSeconds,synchronization:'received-synthetic-replay'},
  limitation:'Reviewable prototype cue for a received synthetic replay. It is not a broadcast publishing command or production-readiness claim. Revision checks do not verify prose, source completeness or real-world truth. Translations require human review.'};
}
