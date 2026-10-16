const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=700;
const measured=new Set(['nearest-sampled-opponent','player-sample-displacement-rate','pass-endpoint-displacement','shot-ball-sample-displacement-rate']);
const validRef=ref=>object(ref)&&['event','frame','metric'].includes(ref.type)&&validId(ref.id)&&Number.isSafeInteger(ref.revision)&&ref.revision>0;
const interval=(values,end)=>Number.isFinite(values.start)&&values.start>=0&&Number.isFinite(values.end)&&values.start<values.end&&values.end<=end;

/** Audience coverage over an already supported, executed-tool fact catalog.
 * This chooses no fact, computes no metric and adds no tool/model invocation.
 * The model must select an available context; canonical rendering owns wording.
 */
export function storyContextRequirement(catalog,audience){
 const scope=catalog?.scope;
 if(!object(catalog)||!Array.isArray(catalog.facts)||!object(scope)||!validId(scope.anchorId)||
    !Number.isFinite(scope.eventTime)||scope.eventTime<0||!Number.isFinite(scope.observedAt)||scope.observedAt<scope.eventTime||
    catalog.facts.some(fact=>!object(fact)||!validId(fact.id)||typeof fact.kind!=='string'||!object(fact.values))||
    new Set(catalog.facts.map(fact=>fact.id)).size!==catalog.facts.length||!['newcomer','player','analyst','spatial'].includes(audience))
  throw new RangeError('Provide a current scoped fact catalog and supported story audience.');
 if(['newcomer','player'].includes(audience))return {candidateFactIds:[],minimum:0,reason:'audience-does-not-require-context'};
 const candidateFactIds=catalog.facts.filter(fact=>{
  const values=fact.values;
  if(!Array.isArray(fact.evidence)||!fact.evidence.length||!fact.evidence.every(validRef))return false;
  if(measured.has(fact.kind)){
   if(values.anchorId!==scope.anchorId||!Number.isFinite(values.value)||values.value<0)return false;
   if(fact.kind==='nearest-sampled-opponent')return values.time===scope.eventTime&&values.unit==='metres';
   return interval(values,scope.eventTime)&&values.unit===(fact.kind==='pass-endpoint-displacement'?'metres':'metres/second');
  }
  if(audience==='spatial')return false;
  if(fact.kind==='window-shot-change')return ['home','away'].includes(values.team)&&Number.isSafeInteger(values.previousCount)&&values.previousCount>=0&&
   Number.isSafeInteger(values.recentCount)&&values.recentCount>=0&&Number.isFinite(values.previousStart)&&values.previousStart>=0&&
   Number.isFinite(values.previousEnd)&&values.previousEnd>values.previousStart&&values.recentStart===values.previousEnd&&
   Number.isFinite(values.recentEnd)&&values.recentEnd<=scope.eventTime&&values.recentEnd-values.recentStart===values.previousEnd-values.previousStart&&
   (values.direction==='increase'&&values.recentCount>=2&&values.recentCount-values.previousCount>=2||
    values.direction==='decrease'&&values.previousCount>=2&&values.recentCount===0);
  if(fact.kind==='recovery-before-shot')return values.anchorId===scope.anchorId&&interval(values,scope.eventTime)&&Number.isFinite(values.seconds)&&values.seconds>0;
  if(fact.kind==='completed-passes-between')return values.anchorId===scope.anchorId&&interval(values,scope.eventTime)&&Number.isSafeInteger(values.count)&&values.count>0;
  if(fact.kind==='window-event-count')return ['home','away'].includes(values.team)&&Number.isSafeInteger(values.count)&&values.count>0&&
   Number.isFinite(values.start)&&values.start>=0&&Number.isFinite(values.end)&&values.start<=values.end&&values.end<=scope.eventTime&&
   (['completedPasses','recoveries'].includes(values.category)||values.category==='shots'&&values.count>1);
  return false;
 }).map(fact=>fact.id);
 return {candidateFactIds,minimum:candidateFactIds.length?1:0,
  reason:candidateFactIds.length?`supported-${audience}-context`:'no-supported-nonredundant-context'};
}

/** Validate the model's unchanged selection, without silently appending context. */
export function validateStoryContext(selectedIds,requirement){
 if(!Array.isArray(selectedIds)||selectedIds.some(id=>!validId(id))||new Set(selectedIds).size!==selectedIds.length||
    !object(requirement)||!Array.isArray(requirement.candidateFactIds)||requirement.candidateFactIds.some(id=>!validId(id))||
    new Set(requirement.candidateFactIds).size!==requirement.candidateFactIds.length||![0,1].includes(requirement.minimum)||
    requirement.minimum===1&&!requirement.candidateFactIds.length)
  throw new RangeError('Provide unique selected IDs and a valid bounded context requirement.');
 if(requirement.minimum===1&&!selectedIds.some(id=>requirement.candidateFactIds.includes(id)))
  throw new RangeError('Select at least one available nonredundant supported context fact for this audience.');
 return true;
}
