// An explicit received link can identify an earlier action without displaying
// that action as a redundant answer sentence. It proves sequence, never cause.
export function sourceSequenceLinks(packet){
 const records=new Map();
 for(const row of [...(packet.queryResults||[]).flatMap(query=>query.rows||[]),...(packet.linkedContext?.rows||[])]){
  const previous=records.get(row.id);
  if(!previous||row.revision>previous.revision)records.set(row.id,row);
 }
 const current=row=>row&&row.operation!=='delete'&&Number.isFinite(row.time)&&row.time<=packet.observedAt&&Number.isInteger(row.revision);
 const ref=row=>({type:'event',id:row.id,revision:row.revision});
 return [...records.values()].filter(row=>current(row)&&row.type==='recovery').flatMap(row=>{
  const ids=[...new Set([row.cause,row.shotId,row.passId].filter(id=>typeof id==='string'&&id))];
  if(ids.length!==1)return [];
  const prior=records.get(ids[0]);
  if(!current(prior)||!['shot','pass'].includes(prior.type)||prior.time>=row.time)return [];
  return [{anchor:ref(prior),witness:ref(row),anchorTime:prior.time,witnessTime:row.time,
   anchorType:prior.type,witnessType:row.type,anchorTeam:prior.team,witnessTeam:row.team,
   anchorPlayerId:prior.playerId,witnessPlayerId:row.playerId,
   sourceFields:['cause','shotId','passId'].filter(field=>row[field]===prior.id),
   proves:'explicit-linked-sequence',doesNotProve:['causation','absence','count','first-or-next-event']}];
 });
}
export function sourceSequenceWitness(part,answer,checks,selection,packet){
 const index=part.relationSourceLinkIndex;
 if(!Number.isInteger(index)||index<0||part.temporalRelation!=='after-requested-event'||!['none','same-team','same-player'].includes(part.relationEntityBinding))return false;
 const link=sourceSequenceLinks(packet)[index];
 if(!link)return false;
 if(part.relationEntityBinding==='same-team'&&(!['home','away'].includes(link.anchorTeam)||link.anchorTeam!==link.witnessTeam))return false;
 if(part.relationEntityBinding==='same-player'&&(!link.anchorPlayerId||link.anchorPlayerId!==link.witnessPlayerId))return false;
 for(const claimIndex of part.claimIndices||[]){
  const proof=selection?.proofs?.[claimIndex],event=proof?.kind==='event'?proof:proof?.kind==='ordered-event'?proof.event:null;
  if(!event||event.eventId!==link.witness.id||event.revision!==link.witness.revision||event.time!==link.witnessTime)continue;
  const record=checks[claimIndex]?.cited.find(item=>item.reference.type==='event'&&item.reference.id===link.witness.id&&item.reference.revision===link.witness.revision)?.record;
  if(!record||record.type!=='recovery'||!answer.claims[claimIndex]?.evidence.some(ref=>ref.type==='event'&&ref.id===link.witness.id&&ref.revision===link.witness.revision))continue;
  // Classified actions are checked separately by the existing coverage guard.
  if(!['recovery','ball-win','initial-control'].includes(part.requestedAction))continue;
  return {...link,requestSpan:part.requestSpan,sourceLinkIndex:index,witnessClaimIndex:claimIndex,relation:'after',entityBinding:part.relationEntityBinding};
 }
 return false;
}
