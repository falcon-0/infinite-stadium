const key=ref=>`${ref?.type}:${ref?.id}@${ref?.revision}`;

// The planner identifies the requested role; the application selects only an
// exact, unique result with an existing proof. Semantic review is still required.
export function directQuestionFacts(packet,manifest,{focus,form,passAccuracyRequested=false}={}){
 const components=packet.requestComponents?.length;
 if(components!==1&&!(components===2&&focus==='event-actor'&&form==='fact'))return null;
 const derived=new Set((packet.queryRelations||[]).map(link=>key(link.scopeReference)));
 const queries=(packet.requestedEvidence||[]).filter(source=>!derived.has(key(source.scopeReference)));
 const result=fact=>({scope:'match',composition:{mode:'facts',factIds:[fact.id]},followUp:''});
 if(components===1&&passAccuracyRequested&&focus==='player-performance'&&['fact','assessment'].includes(form)&&queries.length===2){
  const resolved=(packet.mentionedPlayerResolution||[]).filter(r=>r.status==='resolved').map(r=>r.canonicalId);
  const filters=queries.map(source=>source.query?.filters||{}),refs=new Set(queries.map(source=>key(source.scopeReference)));
  if(resolved.length===1&&filters.every(f=>f.type==='pass'&&typeof f.result==='boolean'&&Object.keys(f).every(k=>['type','result','player','team'].includes(k)))&&new Set(filters.map(f=>f.result)).size===2){
   const matches=manifest.facts.filter(fact=>fact.proof.kind==='pass-completion-profile'&&fact.proof.subjectId===resolved[0]&&fact.claim.evidence.length===2&&fact.claim.evidence.every(ref=>refs.has(key(ref))));
   if(matches.length===1)return result(matches[0]);
  }
  return null;
 }
 if(form==='explanation'&&focus==='event-sequence'&&packet.requestedMoment?.reference){
  const matches=manifest.facts.filter(fact=>fact.proof.kind==='linked-goal-sequence'&&fact.proof.eventId===packet.requestedMoment.reference.id&&fact.proof.revision===packet.requestedMoment.reference.revision);
  if(matches.length===1)return result(matches[0]);
 }
 if(form==='fact'&&focus==='credited-assist'&&queries.every(source=>source.query?.timeFrom===0&&source.query.timeTo===packet.observedAt)){
  const total=manifest.facts.find(fact=>fact.proof.kind==='team-comparison'&&fact.proof.metric==='goals'&&fact.proof.timeFrom===0&&fact.proof.timeTo===packet.observedAt&&!fact.proof.timeFromExclusive&&!fact.proof.timeToExclusive&&Object.values(fact.proof.values).reduce((a,b)=>a+b,0)===1);
  const goals=manifest.facts.filter(fact=>fact.proof.kind==='event'&&!fact.proof.attributes&&fact.proof.eventType==='shot'&&fact.proof.actionOutcome?.status==='goal');
  const assists=manifest.facts.filter(fact=>fact.proof.kind==='credited-goal-assist');
  const explicit=(packet.namedPlayerActions||[]).map(entry=>entry.player.id);
  if(total&&goals.length===1&&assists.length===1&&assists[0].proof.eventId===goals[0].proof.eventId&&(!packet.requestedMoment||packet.requestedMoment.reference?.id===goals[0].proof.eventId)&&explicit.every(id=>[assists[0].proof.scorerId,assists[0].proof.assisterId].includes(id))){
   const prior=packet.conversation?.at(-1)?.answer,scorer=packet.roster.find(player=>player.id===assists[0].proof.scorerId);
   const words=value=>' '+String(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()+' ';
   const priorPlayers=prior?(packet.roster||[]).filter(player=>words(prior).includes(words(player.name))||words(prior).includes(words(player.name.split(' ').at(-1)))):[];
   if(!prior||explicit.length||scorer&&priorPlayers.length===1&&priorPlayers[0].id===scorer.id)return result(assists[0]);
  }
 }
 if(queries.length!==1)return null;
 const source=queries[0],q=source.query,row=source.rows?.[0];
 // A single complete count already has application-rendered wording. The
 // independent reviewer still checks that its predicates answer the question.
 if(components===1&&form==='fact'&&focus!=='player-assessment'&&q?.aggregate==='count'&&source.truncated===false&&source.scope?.missingFields&&Object.values(source.scope.missingFields).every(value=>value===0)&&Object.values(source.entityResolution||{}).every(entity=>entity.status==='resolved')){
  const matches=manifest.facts.filter(fact=>fact.proof.kind==='count'&&key(fact.proof.scope)===key(source.scopeReference));
  if(matches.length===1)return result(matches[0]);
 }
 if(components===2&&!['left-foot','right-foot','head'].includes(q?.filters?.bodyPart))return null;
 if(q?.aggregate!=='list'||source.rows?.length!==1||!(q.filters?.id===row.id||q.limit===1))return null;
 const current=fact=>(fact.proof.eventId===row.id&&fact.proof.revision===row.revision);
 let matches=[];
 if(form==='fact'&&focus==='event-actor')matches=manifest.facts.filter(fact=>
  fact.proof.kind==='ordered-event'&&key(fact.proof.scope)===key(source.scopeReference)&&fact.proof.event?.eventId===row.id&&fact.proof.event?.revision===row.revision||
  fact.proof.kind==='event'&&!fact.proof.attributes&&q.filters?.id===row.id&&current(fact));
 else if(form==='fact'&&focus==='credited-assist')matches=manifest.facts.filter(fact=>fact.proof.kind==='credited-goal-assist'&&current(fact));
 else if(form==='explanation'&&focus==='event-sequence')matches=manifest.facts.filter(fact=>fact.proof.kind==='linked-goal-sequence'&&current(fact));
 if(matches.length!==1)return null;
 return result(matches[0]);
}
