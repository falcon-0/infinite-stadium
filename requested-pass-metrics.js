// Expand only already-executed, typed pass measurements. These are evidence
// queries, not answers: classification gaps remain in each engine result.
export function requestedPassMetrics(plannedSourceQueries,run){
 if(!Array.isArray(plannedSourceQueries)||typeof run!=='function')throw new TypeError('Supply executed source queries and an engine runner.');
 const scopes=new Map();
 for(const source of plannedSourceQueries){
  const query=source?.query,filters=query?.filters;
  if(!filters||filters.type!=='pass'||!['count','by-team','by-player'].includes(query.aggregate))continue;
  if(Object.keys(filters).some(key=>!['type','team','player','result'].includes(key))||
   Object.keys(query).some(key=>!['filters','aggregate','order','limit','timeFrom','timeTo','timeFromExclusive','timeToExclusive','groupCount','groupOrder'].includes(key)))continue;
  if(Object.hasOwn(filters,'result')&&![true,false,null].includes(filters.result))continue;
  if(Object.hasOwn(filters,'team')&&!['home','away'].includes(filters.team))continue;
  if(query.groupCount&&Object.keys(query.groupCount).length)continue;
  if(!Number.isFinite(query.timeFrom)||!Number.isFinite(query.timeTo)||query.timeFrom<0||query.timeTo<query.timeFrom)continue;
  if(['timeFromExclusive','timeToExclusive'].some(key=>Object.hasOwn(query,key)&&typeof query[key]!=='boolean'))continue;
  if(source.scope?.timeFrom!==query.timeFrom||source.scope?.timeTo!==query.timeTo)continue;
  if(Object.values(source.entityResolution||{}).some(entity=>entity?.status!=='resolved'))continue;
  const actor=source.entityResolution?.player;
  if(Object.hasOwn(filters,'player')&&(!actor||actor.status!=='resolved'||typeof actor.canonicalId!=='string'||!actor.canonicalId))continue;
  // A global player leaderboard cannot be collapsed into a global count. Only
  // a resolved one-player measurement can safely become a count partition.
  if(query.aggregate==='by-player'&&!Object.hasOwn(filters,'player'))continue;
  const scopedFilters={type:'pass',...(Object.hasOwn(filters,'team')?{team:filters.team}:{}),...(actor?{player:actor.canonicalId}:{})};
  const definition={filters:scopedFilters,aggregate:query.aggregate==='by-player'?'count':query.aggregate,
   timeFrom:query.timeFrom,timeTo:query.timeTo,
   ...(Object.hasOwn(query,'timeFromExclusive')?{timeFromExclusive:query.timeFromExclusive}:{}),
   ...(Object.hasOwn(query,'timeToExclusive')?{timeToExclusive:query.timeToExclusive}:{})};
  // Explicit false and absent exclusivity describe the same bounded window.
  const key=JSON.stringify({...definition,timeFromExclusive:!!query.timeFromExclusive,timeToExclusive:!!query.timeToExclusive});
  if(!scopes.has(key))scopes.set(key,definition);
 }
 if(scopes.size>3)throw new RangeError('Pass partition augmentation permits at most three distinct measurement scopes.');
 return [...scopes.values()].flatMap(definition=>[undefined,true,false,null].map(result=>run({
  ...definition,filters:{...definition.filters,...(result===undefined?{}:{result})},order:'asc',limit:20
 })));
}
