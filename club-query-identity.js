// Identity correction uses the received dictionary, never a question template.
const key=value=>typeof value==='string'?value.normalize('NFKC').toLocaleLowerCase('en').replace(/[\p{P}\p{Z}\s]/gu,''):'';

export function sourceClubSide(value,teams,roster=[]){
 const normalized=key(value);
 if(!normalized||roster.some(player=>[player.id,player.name].some(name=>key(name)===normalized)))return null;
 const sides=['home','away'].filter(side=>key(teams?.[side])===normalized);
 return sides.length===1?sides[0]:null;
}

/** A club mistakenly placed in the actor filter denotes that club's actions.
 * Receiver/assister slots remain player-only; conflicting team filters fail.
 * Every other predicate, time window and ordering is preserved. */
export function normalizeClubActorQuery(query,teams,roster=[]){
 const side=sourceClubSide(query?.filters?.player,teams,roster);
 if(!side)return query;
 if(query.filters.team!==undefined&&query.filters.team!==null&&query.filters.team!==side)
  throw new TypeError('The actor club conflicts with the selected team.');
 const filters={...query.filters,team:side};delete filters.player;
 return {...query,filters};
}
