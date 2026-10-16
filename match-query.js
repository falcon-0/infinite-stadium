import {createHash} from 'node:crypto';
import {matchState} from './match-stream.js';
import {recoveryClassification,RECOVERY_KINDS} from './recovery-classification.js';

const keys=['filters','order','limit','aggregate','timeFrom','timeTo','timeFromExclusive','timeToExclusive','groupCount','groupOrder'];
const filterKeys=['id','type','team','player','receiver','assistPlayer','result','outcome','bodyPart','passType','technique','recoveryKind','recoveryClass','linkedShotOutcome'];
const types=['pass','receive','shot','flight','recovery'];
const shotOutcomes=['goal','off-target','saved','blocked','on-target','pending'];
const recoveryKinds=RECOVERY_KINDS;
const aggregates=['list','count','by-player','by-team','by-assister'];
const groupOrders=['count-desc','count-asc','name'];
const clock=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
const eventFields=['id','revision','type','time','arrivedAt','team','player','playerId','result','passId','shotId','receiverId','cause','recoveryKind','passType','technique','x','y','endX','endY'];
const ref=e=>({type:'event',id:e.id,revision:e.revision});
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const entityKeys=['player','receiver','assistPlayer'];
const normalizeName=value=>String(value).normalize('NFKC').toLocaleLowerCase('en').replace(/[\p{P}\p{Z}\s]/gu,'');
const surname=name=>String(name).trim().split(/\s+/).at(-1);

// Resolve identities before filtering: an absent name is not a roster player
// with zero actions, and shared surnames must never silently pick a player.
function resolveEntities(filters,players,events){
 const identities=new Map(players.map(p=>[p.id,{id:p.id,name:p.name||p.id,team:p.team}]));
 for(const e of events)for(const p of [{id:e.playerId,name:e.player,team:e.team},{id:e.assist?.playerId,name:e.assist?.player,team:e.team}]){
  if(p.id&&!identities.has(p.id))identities.set(p.id,p);
 }
 const eligible=[...identities.values()].filter(p=>!filters.team||p.team===filters.team);
 return Object.fromEntries(entityKeys.filter(k=>own(filters,k)).map(k=>{
  const input=filters[k],normalized=normalizeName(input);
  let candidates=eligible.filter(p=>p.id===input);
  let matchedBy='id';
  if(!candidates.length){candidates=eligible.filter(p=>normalizeName(p.id)===normalized);}
  if(!candidates.length){matchedBy='name';candidates=eligible.filter(p=>normalizeName(p.name||p.id)===normalized);}
  if(!candidates.length){matchedBy='surname';candidates=eligible.filter(p=>normalizeName(surname(p.name||p.id))===normalized);}
  const status=candidates.length===1?'resolved':candidates.length?'ambiguous':'absent';
  return [k,{input,status,canonicalId:status==='resolved'?candidates[0].id:null,matchedBy:status==='resolved'?matchedBy:null,candidates:candidates.map(p=>({id:p.id,name:p.name||p.id,team:p.team??null}))}];
 }));
}

export const matchQueryDefinition={
 name:'query_received_match',
 description:'Query received events by field filters and event-time window; list, count or group by player/team. Group counts can be filtered by inclusive min/max and ranked before limiting. by-player includes zero-count roster players when min:0 or max:0 is explicit, or when ranking ascending; by-team includes both eligible teams even at zero. On-target includes confirmed goals and saves, excluding pending, blocked and off-target attempts. by-assister groups only explicit credits on confirmed goals. Pass types and trivela technique require recorded metadata. Player, receiver and assister filters resolve canonical IDs, normalized names or unique surnames. Inspect entityResolution: absent or ambiguous identities are not proof of zero actions; ambiguous candidates require clarification. Unknown attributes do not match. A query reference proves the complete query scope, including zero results. Chronology does not establish an official assist or intent.',
 parameters:{type:'object',properties:{filters:{type:'object',properties:{id:{type:'string'},type:{type:'string',enum:types},team:{type:'string',enum:['home','away']},player:{type:'string'},receiver:{type:'string',description:'Intended receiver name or ID on a pass; add result:true for a completed reception.'},assistPlayer:{type:'string'},result:{type:['boolean','null']},outcome:{type:'string',enum:shotOutcomes},bodyPart:{type:'string',enum:['left-foot','right-foot','head','other']},passType:{type:'string',enum:['short','medium','long','cross']},technique:{type:'string',enum:['standard','trivela']},recoveryKind:{type:'string',enum:recoveryKinds,description:'Explicit recorded recovery classification, never inferred from the player position.'},recoveryClass:{type:'string',enum:['ball-win','initial-control'],description:'Derived only from an explicit known recoveryKind. Ball wins exclude segment-start; unknown classifications are reported as missing. Requires type:recovery.'},linkedShotOutcome:{type:'string',enum:shotOutcomes,description:'Current received outcome of the shot explicitly identified by cause or shotId. Unknown, withdrawn, conflicting or future links do not match. Combine with type:recovery and recoveryKind:goalkeeper-hold to count recorded collections of saved shots.'}},additionalProperties:false},
  groupCount:{type:'object',properties:{min:{type:'integer',minimum:0},max:{type:'integer',minimum:0}},additionalProperties:false},groupOrder:{type:'string',enum:groupOrders},order:{type:'string',enum:['asc','desc']},limit:{type:'integer',minimum:1,maximum:20},aggregate:{type:'string',enum:aggregates},timeFrom:{type:'number',minimum:0},timeTo:{type:'number',minimum:0},timeFromExclusive:{type:'boolean',description:'Exclude the lower event-time boundary; false or omitted is inclusive.'},timeToExclusive:{type:'boolean',description:'Exclude the upper event-time boundary; false or omitted is inclusive.'}},additionalProperties:false}
};

/** Execute general typed queries against received state, never future fixture data.
 * input: {kind,seed,time}; query: see matchQueryDefinition.
 * Evidence includes a content-addressed query reference covering full inventory,
 * filters, window, counts and truncation, plus exact references for returned rows.
 * Unknown metadata is reported as missing, not inferred from neighboring events.
 */
export function executeMatchQuery(input,query,{stateFactory=matchState}={}){
 if(!plain(input)||Object.keys(input).some(k=>!['kind','seed','time'].includes(k)))throw new RangeError('Supply only kind, seed and received time.');
 const state=stateFactory(input);
 if(!plain(query)||Object.keys(query).some(k=>!keys.includes(k))||
    query.filters!==undefined&&(!plain(query.filters)||Object.keys(query.filters).some(k=>!filterKeys.includes(k)))||
    query.order!==undefined&&!['asc','desc'].includes(query.order)||query.aggregate!==undefined&&!aggregates.includes(query.aggregate)||
    query.limit!==undefined&&(!Number.isSafeInteger(query.limit)||query.limit<1||query.limit>20)||
    ['timeFromExclusive','timeToExclusive'].some(k=>own(query,k)&&typeof query[k]!=='boolean'))throw new RangeError('Choose supported query fields, aggregation, order and a limit of 1 to 20.');
 const grouping=['by-player','by-team','by-assister'].includes(query.aggregate);
 if(query.groupOrder!==undefined&&(!grouping||!groupOrders.includes(query.groupOrder))||query.groupCount!==undefined&&(!grouping||!plain(query.groupCount)||Object.keys(query.groupCount).some(k=>!['min','max'].includes(k))||Object.values(query.groupCount).some(v=>!Number.isSafeInteger(v)||v<0)||(query.groupCount.min??0)>(query.groupCount.max??Infinity)))throw new RangeError('Use nonnegative group count bounds and a supported group order with grouping.');
 const filters=query.filters||{};
 if(own(filters,'type')&&!types.includes(filters.type)||own(filters,'team')&&!['home','away'].includes(filters.team)||
    ['id','player','receiver','assistPlayer'].some(k=>own(filters,k)&&(typeof filters[k]!=='string'||!filters[k].trim()||filters[k].length>(k==='id'?700:100)||/[\u0000-\u001f]/.test(filters[k])))||
    own(filters,'result')&&filters.result!==null&&typeof filters.result!=='boolean'||
    own(filters,'outcome')&&!shotOutcomes.includes(filters.outcome)||
    own(filters,'linkedShotOutcome')&&!shotOutcomes.includes(filters.linkedShotOutcome)||own(filters,'recoveryKind')&&!recoveryKinds.includes(filters.recoveryKind)||
    own(filters,'recoveryClass')&&(!['ball-win','initial-control'].includes(filters.recoveryClass)||filters.type!=='recovery')||
    own(filters,'bodyPart')&&!['left-foot','right-foot','head','other'].includes(filters.bodyPart)||
    own(filters,'passType')&&!['short','medium','long','cross'].includes(filters.passType)||own(filters,'technique')&&!['standard','trivela'].includes(filters.technique))throw new RangeError('Use supported exact-match filters.');
 const timeFrom=query.timeFrom??0,timeTo=query.timeTo??state.time;
 if(!Number.isFinite(timeFrom)||!Number.isFinite(timeTo)||timeFrom<0||timeTo<timeFrom||timeTo>state.time)throw new RangeError('Query times must stay within the received match window.');
 const interval={...(query.timeFromExclusive?{timeFromExclusive:true}:{}),...(query.timeToExclusive?{timeToExclusive:true}:{})};
 const canonical={filters:{...filters},order:query.order||'asc',limit:query.limit??20,aggregate:query.aggregate||'list',timeFrom,timeTo,...interval,...(grouping?{groupCount:query.groupCount||{},groupOrder:query.groupOrder||'count-desc'}:{})};
 // Resolve revisions before following links. A received deletion supersedes an
 // older record; a later unreceived correction must not influence this query.
 const latest=new Map();
 for(const event of state.events){
  if(event.time>state.time||event.arrivedAt>state.time)continue;
  const previous=latest.get(event.id);
  if(!previous||event.revision>previous.revision||event.revision===previous.revision&&event.operation==='delete')latest.set(event.id,event);
 }
 const active=[...latest.values()].filter(event=>event.operation!=='delete');
 const window=active.filter(e=>(query.timeFromExclusive?e.time>timeFrom:e.time>=timeFrom)&&(query.timeToExclusive?e.time<timeTo:e.time<=timeTo));
 const shotOutcome=e=>e.result===true?'goal':e.result===null?'pending':e.outcome;
 const linkedShot=e=>{
  // For this derived filter, cause and shotId are alternative identities of
  // the source shot. If both are supplied they must agree BEFORE resolution;
  // dropping an unavailable target must never erase an explicit conflict.
  // A distinct non-shot cause is also excluded: this filter does not infer how
  // two differently typed relationships should be combined.
  const identities=[...new Set([e.shotId,e.cause].filter(id=>typeof id==='string'&&id.length))];
  if(identities.length!==1||identities[0]===e.id)return null;
  const candidate=latest.get(identities[0]);
  return candidate&&candidate.type==='shot'&&candidate.operation!=='delete'&&candidate.time<=e.time?candidate:null;
 };
 const references=e=>[ref(e),...(own(filters,'linkedShotOutcome')&&linkedShot(e)?[ref(linkedShot(e))]:[])];
 const uniqueReferences=items=>[...new Map(items.map(item=>[`${item.id}@${item.revision}`,item])).values()];
 const roster=new Map((state.frames.at(-1)?.players||[]).map(p=>[p.id,p.name]));
 const entityResolution=resolveEntities(filters,state.frames.at(-1)?.players||[],active);
 const field=(e,k)=>k==='recoveryClass'?(['ball-win','initial-control'].includes(recoveryClassification(e))?recoveryClassification(e):undefined):k==='result'&&!['pass','shot'].includes(e.type)?undefined:k==='linkedShotOutcome'?(linkedShot(e)?shotOutcome(linkedShot(e)):undefined):k==='receiver'?roster.get(e.receiverId)||e.receiverId:k==='player'?e.player:k==='assistPlayer'?e.assist?.player:k==='outcome'&&e.type==='shot'?shotOutcome(e):e[k];
 const matchesFilter=(e,k,v)=>{
  if(entityKeys.includes(k)){
   const resolution=entityResolution[k],id=k==='receiver'?e.receiverId:k==='player'?e.playerId:e.assist?.playerId;
   return resolution.status==='resolved'&&(id?id===resolution.canonicalId:field(e,k)!=null&&normalizeName(field(e,k))===normalizeName(resolution.candidates[0].name));
  }
  if(k==='linkedShotOutcome'&&v==='on-target'){const shot=linkedShot(e);return !!shot&&(shot.result===true||shot.result===false&&['saved','on-target'].includes(shot.outcome));}
  return k==='outcome'&&v==='on-target'?e.type==='shot'&&(e.result===true||e.result===false&&['saved','on-target'].includes(e.outcome)):field(e,k)===v;
 };
 const matches=window.filter(e=>Object.entries(filters).every(([k,v])=>matchesFilter(e,k,v))&&(canonical.aggregate!=='by-assister'||e.type==='shot'&&e.result===true&&!!e.assist?.playerId));
 const ordered=[...matches].sort((a,b)=>(a.time-b.time||a.id.localeCompare(b.id))*(canonical.order==='asc'?1:-1));
 const selected=ordered.slice(0,canonical.limit);
 const rows=selected.map(e=>({...Object.fromEntries(eventFields.filter(k=>own(e,k)).map(k=>[k,e[k]])),clock:clock(e.time),receivedClock:clock(e.arrivedAt),id:e.id,revision:e.revision,time:e.time,arrivedAt:e.arrivedAt,type:e.type,team:e.team,
  player:e.player??null,playerId:e.playerId??null,...(e.receiverId?{receiverName:roster.get(e.receiverId)||null}:{}),result:field(e,'result')??null,outcome:field(e,'outcome')??null,bodyPart:e.bodyPart??null,
  assist:e.assist?{playerId:e.assist.playerId??null,player:e.assist.player??null,passId:e.assist.passId??null}:null,
  ...(e.type==='recovery'?{recoveryClass:recoveryClassification(e)}:{}),...(own(filters,'linkedShotOutcome')?{linkedShotOutcome:field(e,'linkedShotOutcome')??null,linkedShotReference:linkedShot(e)?ref(linkedShot(e)):null}:{}),evidence:references(e)}));
 const groups=[];let matchedGroupCount=0;
 if(grouping){
  const grouped=new Map();for(const e of ordered){const key=canonical.aggregate==='by-assister'?e.assist.playerId:canonical.aggregate==='by-player'?e.playerId||e.player:e.team;
   if(!grouped.has(key))grouped.set(key,{key:key??null,label:canonical.aggregate==='by-assister'?e.assist.player||e.assist.playerId:canonical.aggregate==='by-player'?e.player??e.playerId??'Unknown':state.metadata.teams[e.team],count:0,evidence:[]});
   const group=grouped.get(key);group.count++;group.evidence=uniqueReferences([...group.evidence,...references(e)]);
  }
  // Zero-count questions require the roster, not just actors with a matching event.
  const includeZero=canonical.groupCount.min===0||canonical.groupCount.max===0||canonical.groupOrder==='count-asc';
  if(canonical.aggregate==='by-team')for(const team of ['home','away']){
   if((!filters.team||filters.team===team)&&!grouped.has(team))grouped.set(team,{key:team,label:state.metadata.teams[team],count:0,evidence:[]});
  }
  if(canonical.aggregate==='by-player'&&includeZero)for(const player of state.frames.at(-1)?.players||[]){
   if(filters.team&&player.team!==filters.team||filters.player&&(entityResolution.player.status!=='resolved'||player.id!==entityResolution.player.canonicalId))continue;
   if(!grouped.has(player.id))grouped.set(player.id,{key:player.id,label:player.name||player.id,count:0,evidence:[]});
  }
  const qualifying=[...grouped.values()].filter(g=>g.count>=(canonical.groupCount.min??0)&&g.count<=(canonical.groupCount.max??Infinity));
  qualifying.sort((a,b)=>(canonical.groupOrder==='count-desc'?b.count-a.count:canonical.groupOrder==='count-asc'?a.count-b.count:0)||a.label.localeCompare(b.label)||String(a.key).localeCompare(String(b.key)));
  matchedGroupCount=qualifying.length;groups.push(...qualifying.slice(0,canonical.limit));
 }
 // Missing coverage is measured after all other filters, so zero left-foot rows
 // cannot be misrepresented as proof that every relevant action was right-footed.
 const missingFields=Object.fromEntries(Object.keys(filters).map(k=>[k,window.filter(e=>
  Object.entries(filters).filter(([other])=>other!==k).every(([other,v])=>matchesFilter(e,other,v))&&(field(e,k)===undefined||field(e,k)===null&&filters[k]!==null&&!(k==='result'&&['pass','shot'].includes(e.type)&&own(e,'result')&&e.result===null))).length]));
 if(canonical.aggregate==='by-assister')missingFields.assistPlayer=window.filter(e=>e.type==='shot'&&e.result===true&&Object.entries(filters).every(([k,v])=>matchesFilter(e,k,v))&&!e.assist?.playerId).length;
 const linkedDependencies=own(filters,'linkedShotOutcome')?[...new Map(window.map(linkedShot).filter(Boolean).map(event=>[event.id,event])).values()]:[];
 const scopeData={matchId:state.metadata.id,observedAt:state.time,query:canonical,inventory:window,roster:(state.frames.at(-1)?.players||[]).map(({id,name,team,number})=>({id,name,team,number})),matchedCount:matches.length,...(Object.keys(entityResolution).length?{entityResolution}:{}),...(own(filters,'linkedShotOutcome')?{linkedShotDependencies:linkedDependencies}:{})};
 const scopeReference={type:'scope',id:'match-query-'+createHash('sha256').update(JSON.stringify(scopeData)).digest('hex'),revision:1};
 const evidence=[scopeReference,...uniqueReferences(selected.flatMap(references))];
 return {schema:'infinite-stadium.match-query.v1',scopeReference,query:canonical,scope:{reference:scopeReference,matchId:state.metadata.id,observedAt:state.time,
  timeFrom,timeTo,...interval,inventoryCount:window.length,matchedCount:matches.length,missingFields,entityResolution},count:matches.length,entityResolution,
  coordinateSystem:'Event x/y positions are percentages of pitch length/width, not metres. No speed or open-lane measurement is implied.',
  rows:canonical.aggregate==='count'?[]:rows,groups,matchedGroupCount:grouping?matchedGroupCount:null,evidence,
  truncated:canonical.aggregate==='count'?false:canonical.aggregate==='list'?matches.length>selected.length:matchedGroupCount>groups.length,
  limitation:'Received synthetic events only. Missing attributes are unknown. A preceding pass does not by itself establish an official assist. Query references support inventory counts and absence within this received scope.'};
}
