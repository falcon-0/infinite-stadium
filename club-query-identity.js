// Identity correction uses the received dictionary, never a question template.
const key=value=>typeof value==='string'?value.normalize('NFKC').toLocaleLowerCase('en').replace(/[\p{P}\p{Z}\s]/gu,''):'';

export function sourceClubSide(value,teams,roster=[]){
 const normalized=key(value);
 if(!normalized||roster.some(player=>[player.id,player.name].some(name=>key(name)===normalized)))return null;
 const sides=['home','away'].filter(side=>key(teams?.[side])===normalized);
 return sides.length===1?sides[0]:null;
}

/** Resolve only names the fan or the supplied conversation actually mentions.
 * The planner's enumeration of the lineup is not a user reference. */
export function hasSourcePlayerReference(value,input,roster=[]){
 const words=text=>' '+String(text??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()+' ';
 const source=words([input.question,input.previousQuestion,...(input.conversation||[]).flatMap(turn=>[turn.question,turn.answer])].filter(Boolean).join(' '));
 const players=roster.filter(player=>[player.name,player.id].some(name=>key(name)===key(value)));
 const aliases=[value,...players.flatMap(player=>[player.name,player.id,String(player.name).split(/\s+/).at(-1)])];
 return aliases.some(alias=>words(alias).trim().length>1&&source.includes(words(alias)));
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
