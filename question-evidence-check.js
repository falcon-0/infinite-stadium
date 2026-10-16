import {createHash} from 'node:crypto';

const key=ref=>`${ref.type}:${ref.id}@${ref.revision}`;

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
 Object.fromEntries(Object.keys(value).sort().filter(name=>value[name]!==undefined).map(name=>[name,canonical(value[name])])):value;
const copy=value=>JSON.parse(JSON.stringify(value));
const eventLinks=row=>[row.passId,row.shotId,row.cause,row.assist?.passId].filter(id=>typeof id==='string');
// Context can challenge an answer's relevance, but cannot supply new citations.
function withoutReferences(value){
 if(Array.isArray(value))return value.filter(item=>!(item?.type==='scope'||item?.type==='event')).map(withoutReferences);
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).filter(([name])=>!['evidence','reference','scopeReference','rowReferences'].includes(name)).map(([name,item])=>[name,withoutReferences(item)]));
}

/** Reviewer-only projection. Full-packet application checks remain authoritative.
 * Cited scopes retain complete coverage; event context follows explicit links by
 * one hop only. Uncited summaries are deliberately non-citable relevance context.
 * The fingerprint identifies the full source, independently of answer selection. */
export function projectReviewEvidence(packet,answer){
 const projected={sourceFingerprint:createHash('sha256').update(JSON.stringify(canonical(packet))).digest('hex')};
 for(const name of ['question','requestedForm','explanationTarget','answerFocus','previousQuestion','conversation','responseLanguage','language','roster','teams','score','coordinateSystem','mentionedPlayerResolution','requestedMoment','pendingOutcomeContext','timeUnit','observedAt','observedClock','currentTime','limits','evidenceCapabilities']){
  if(packet[name]!==undefined)projected[name]=copy(packet[name]);
 }
 if(packet.evidenceCapabilities)projected.evidenceCapabilities=withoutReferences(packet.evidenceCapabilities);
 projected.sourcePolicy='Review cited scopes and records for factual support. Unavailable references are not evidence. Non-citable relevance context may expose omissions but cannot substitute for a claim citation.';
 const references=[...new Map((answer.claims||[]).flatMap(claim=>claim.evidence||[]).map(ref=>[key(ref),ref])).values()];
 const queries=packet.queryResults||[],scopes=new Map(queries.map(query=>[key(query.scopeReference),query]));
 const latest=new Map();
 for(const row of [...queries.flatMap(query=>query.rows||[]),...(packet.linkedContext?.rows||[])]){
  const prior=latest.get(row.id);
  if(!prior||row.revision>prior.revision)latest.set(row.id,row);
 }
 const observedAt=packet.observedAt??packet.currentTime;
 const available=row=>row&&row.operation!=='delete'&&
  (!Number.isFinite(observedAt)||(!Number.isFinite(row.time)||row.time<=observedAt)&&(!Number.isFinite(row.arrivedAt)||row.arrivedAt<=observedAt));
 const current=new Map([...latest].filter(([,row])=>available(row)));
 const roots=new Set(),missing=[];
 for(const ref of references){
  if(ref.type==='scope'){if(!scopes.has(key(ref)))missing.push(copy(ref));}
  else if(ref.type==='event'){
   const row=current.get(ref.id);
   if(row&&row.revision===ref.revision)roots.add(ref.id);else missing.push(copy(ref));
  }else missing.push(copy(ref));
 }
 const included=new Set(roots);
 for(const id of roots)for(const linked of eventLinks(current.get(id)))if(current.has(linked))included.add(linked);
 // A saved shot may be the target of a goalkeeper recovery's explicit link.
 for(const row of current.values())if(eventLinks(row).some(id=>roots.has(id)))included.add(row.id);
 projected.queryResults=references.filter(ref=>ref.type==='scope'&&scopes.has(key(ref))).map(ref=>{
  const {rows,rowReferences,...header}=scopes.get(key(ref));
  return {...copy(header),rows:[]};
 });
 projected.linkedContext={rows:[...included].map(id=>copy(current.get(id))),
  limitation:'Cited current records and one-hop explicit dependencies only; not a complete event inventory. Links establish sequence, not causation or assist credit.'};
 projected.unavailableReferences=missing;
 const contributions=packet.playerContributions;
 projected.relevanceContext={citable:false,limitation:'Summaries help detect omitted information and false premises. They do not authorize uncited match assertions.'};
 if(contributions)projected.relevanceContext.playerContributions={...withoutReferences(contributions),metrics:(contributions.metrics||[]).map(metric=>({
  name:metric.name,parts:(metric.evidence||[]).map(ref=>{
   const query=scopes.get(key(ref));
   if(!query)return {unavailable:true};
   const {query:definition,count,groups,scope,truncated,entityResolution,matchedGroupCount}=query;
   return withoutReferences({query:definition,count,groups,scope,truncated,entityResolution,matchedGroupCount});
  })}))};
 for(const name of ['namedPlayerActions','recentComparison','assessmentDimensions','shotTimeline'])if(packet[name]!==undefined)projected.relevanceContext[name]=withoutReferences(packet[name]);
 return projected;
}

export function matchEvidenceCapabilities(packet){
 const rows=[...(packet.queryResults||[]).flatMap(query=>query.rows||[]),...(packet.linkedContext?.rows||[])];
 const recoveries=[...new Map(rows.filter(row=>row.type==='recovery').map(row=>[key({...row,type:'event'}),row])).values()];
 return {
  supported:['received event actor, time and explicitly recorded result','counts only within the cited query scope and coverage'],
  unavailable:['who forced a mistake or turnover','player intention','measured pressing or possession duration','verified open passing lanes'],
  eventLinks:'cause/passId/shotId connect recorded actions, not pressure attribution; a recovery identifies who collected the ball, not who forced the preceding loss',
  recoveries:recoveries.map(row=>({reference:{type:'event',id:row.id,revision:row.revision},recoveringPlayer:row.player??null,time:row.time,linkedPriorEvent:row.cause??row.passId??row.shotId??null,forcingPlayer:null}))
 };
}

/** Reduce each claim to the exact records it cites. A valid reference is not
 * semantic support. These constraints describe the received schema, not a
 * catalogue of fan questions or prewritten answers. */
export function claimEvidenceChecks(answer,packet){
 const records=new Map();
 for(const query of packet.queryResults||[]){
  if(query.scopeReference?.type==='scope')records.set(key(query.scopeReference),{type:'scope',query:query.query,count:query.count,groups:query.groups,scope:query.scope,truncated:query.truncated,entityResolution:query.entityResolution??query.scope?.entityResolution});
  for(const row of query.rows||[])records.set(key({...row,type:'event'}),row);
 }
 for(const row of packet.linkedContext?.rows||[])records.set(key({...row,type:'event'}),row);
 return answer.claims.map((claim,claimIndex)=>{
  const cited=claim.evidence.map(ref=>({reference:ref,record:records.get(key(ref))??null}));
  return {claimIndex,text:claim.text,kind:claim.kind,cited,
   constraints:{
    // cause/passId/shotId connect actions; none is a pressure measurement or
    // an attribution of the preceding mistake to the recovering player.
    forcedErrorAttribution:'unavailable: this event schema does not record who forced an error',
    intent:'unavailable: no player intention is recorded',
    eventLinks:'sequence relationships only; they do not establish pressure or an official assist',
    ...(cited.some(item=>item.record?.type==='recovery')?{recovery:'supports the recovering player and recovery time only; does not identify who forced the preceding loss'}:{})
   }};
 });
}

// A deliberately narrow English assertion guard complements semantic review.
// It is independent of question wording and is not a multilingual entailment
// checker. Unknown/negative explanations of the same concept remain allowed.
const causal= /\b(?:forc(?:e|ed|es|ing)|caus(?:e|ed|es|ing)|induc(?:e|ed|es|ing)|provok(?:e|ed|es|ing))\b[^.!?;]{0,90}\b(?:turnover|mistake|error|loss of possession|failed pass|unsuccessful pass)\b/gi;
const negative=/\b(?:not|never|neither|cannot|can't|couldn't|didn't|doesn't|don't|unknown|unclear|unrecorded|unavailable)\b|\b(?:no evidence|no record|whether|who|what)\b[^.!?;]{0,45}$/i;

export function unsupportedCausalClaims(answer){
 const issues=[];
 for(const [claimIndex,claim] of answer.claims.entries()){
  if(claim.kind==='general'&&!claim.evidence.length)continue;
  for(const match of claim.text.matchAll(causal)){
   // Bound negation to the local clause, so a later disclaimer cannot excuse
   // an earlier positive causal assertion.
   const prefix=claim.text.slice(0,match.index).split(/[.!?;]|\bbut\b|\bhowever\b/i).at(-1);
   const suffix=claim.text.slice(match.index+match[0].length).split(/[.!?;]|\bbut\b|\bhowever\b/i)[0];
   if(negative.test(prefix)||/^\s+(?:is|was|remains)\s+(?:unknown|unclear|unrecorded|not recorded)\b/i.test(suffix))continue;
   issues.push({claimIndex,code:'unsupported-causal-attribution',reason:'The received schema records actions and links, but does not attribute who forced the preceding error.'});
   break;
  }
 }
 return issues;
}

/** Fail closed when review skips, duplicates, or rejects any claim. */
export function reviewSupportsEveryClaim(review,count){
 if(review?.decision!=='approve'||typeof review.reason!=='string'||!review.reason.trim()||!Array.isArray(review.checks)||review.checks.length!==count)return false;
 const seen=new Set();
 for(const check of review.checks){
  if(!Number.isInteger(check.claimIndex)||check.claimIndex<0||check.claimIndex>=count||seen.has(check.claimIndex)||check.supported!==true||typeof check.reason!=='string'||!check.reason.trim())return false;
  seen.add(check.claimIndex);
 }
 return count>0&&seen.size===count;
}

/** Cross-check the review's extracted actor/action pairs against cited records.
 * This is independent of the reviewer's approval. Extraction remains model based.
 */
export function reviewActorIssues(review,answer,packet){
 const issues=[];
 const normalize=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 const roster=packet.roster||[];
 const resolve=name=>{
  const needle=normalize(name);
  const matches=roster.filter(p=>normalize(p.name)===needle||normalize(p.id)===needle||normalize(String(p.name||'').split(' ').at(-1))===needle);
  return matches.length===1?matches[0]:null;
 };
 const checks=claimEvidenceChecks(answer,packet);
 for(const check of review.checks){
  if(!Array.isArray(check.actors)){issues.push({claimIndex:check.claimIndex,reason:'Review omitted actor extraction.'});continue;}
  for(const actor of check.actors){
   const player=resolve(actor.name);
   const team=Object.entries(packet.teams||{}).find(([id,name])=>normalize(actor.name)===normalize(name)||normalize(actor.name)===normalize(id))?.[0];
   if(!player&&!team&&checks[check.claimIndex]?.kind==='limitation'&&actor.action==='other'&&!actor.individualAction&&(packet.mentionedPlayerResolution||[]).some(entity=>entity.status==='absent'&&normalize(entity.input)===normalize(actor.name)))continue;
   if(!player&&!team){
    const absent=(packet.mentionedPlayerResolution||[]).some(entity=>entity.status==='absent'&&[entity.input,String(entity.input||'').split(/\s+/).at(-1)].some(alias=>normalize(alias)===normalize(actor.name)));
    if(actor.action==='other'&&absent&&isRosterAbsenceText(checks[check.claimIndex]?.text||''))continue;
    issues.push({claimIndex:check.claimIndex,name:actor.name,reason:'This name does not uniquely identify a player in the received lineup. Do not claim zero actions. State that the name is not identified in this match, or clarify ambiguity.'});continue;
   }
   if(!actor.individualAction||actor.action==='other')continue;
   if(player&&verifiedActionAbsence(actor,player,check.claimIndex,answer,packet,checks[check.claimIndex]))continue;
   const aggregateAction=Array.isArray(check.counts)&&check.counts.some(count=>{
    if(count.groupKey!==(player?.id??team))return false;
    const span=typeof count.text==='string'?countClaimSpans(count.text).find(s=>s.value===count.value):null;
    const source=checks[check.claimIndex]?.cited.find(item=>item.reference.type==='scope'&&key(item.reference)===key(count.scopeReference||{}))?.record;
    const actual=source?.groups?.find(group=>group.key===(player?.id??team))?.count;
    // This establishes that the actor performed this action, not the prose
    // quantity. reviewCountIssues separately binds quantities to exact text.
    if(!span||!source||!countMetricMatches(span,source.query)||source.truncated||!Number.isSafeInteger(actual)||actual<=0||actual!==count.value||
     Object.values(source.scope?.missingFields||{}).some(n=>n>0)||!countWindowMatches(source,packet,checks[check.claimIndex]?.text||''))return false;
    const f=source.query?.filters||{};
    return actor.action==='goal'?f.type==='shot'&&f.result===true:actor.action==='assist'?source.query?.aggregate==='by-assister':actor.action===f.type;
   });
   // A complete cited grouped inventory proves positive action involvement even
   // when the interpretation contains no repeated count for the reviewer to bind.
   // It proves neither a quantity in prose nor the qualitative conclusion.
   const groupedClaim=checks[check.claimIndex];
   const groupedAction=player&&groupedClaim?.kind==='interpretation'&&!countClaimSpans(groupedClaim.text).length&&!/\b(?:not|never|no|hasn.t|didn.t|doesn.t|cannot|ne|pas|aucun|não|nunca|ningún)\b/iu.test(groupedClaim.text)&&groupedClaim.cited.some(item=>{
    const source=item.reference.type==='scope'&&item.record,f=source?.query?.filters||{};
    if(!source||source.truncated||Object.values(source.scope?.missingFields||{}).some(n=>n>0)||
     !countWindowMatches(source,packet,checks[check.claimIndex]?.text||''))return false;
    const group=source.groups?.find(group=>group.key===player.id);
    if(!Number.isSafeInteger(group?.count)||group.count<=0)return false;
    if(actor.action==='assist')return source.query.aggregate==='by-assister'&&f.type==='shot'&&f.result===true;
    if(source.query.aggregate!=='by-player')return false;
    return actor.action==='goal'?f.type==='shot'&&f.result===true:f.type===actor.action;
   });
   if(aggregateAction||groupedAction)continue;
   const rows=checks[check.claimIndex].cited.map(item=>item.record).filter(Boolean);
   const matches=rows.some(row=>{
    if(!player)return row.team===team&&(actor.action==='goal'?row.type==='shot'&&row.result===true:actor.action==='assist'?row.type==='shot'&&row.result===true&&!!row.assist:row.type===actor.action);
    if(actor.action==='receive'&&row.type==='pass')return row.result===true&&row.receiverId===player.id;
    if(actor.action==='assist')return row.type==='shot'&&row.result===true&&(row.assist?.playerId===player.id||normalize(row.assist?.player)===normalize(player.name));
    const samePlayer=row.playerId===player.id||normalize(row.player)===normalize(player.name);
    return samePlayer&&(actor.action==='goal'?row.type==='shot'&&row.result===true:row.type===actor.action);
   });
   if(!matches)issues.push({claimIndex:check.claimIndex,name:actor.name,action:actor.action,reason:'The cited records do not show this player performing this action. Correct the player or describe only their recorded action.'});
  }
 }
 return issues;
}

export function reviewActorsMatchEvidence(review,answer,packet){return reviewActorIssues(review,answer,packet).length===0;}

// The reviewer extracts quantities; JavaScript verifies them against complete
// executed scopes. A handful of cited events cannot prove a total or a tie.
const numberWords={zero:0,no:0,none:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,cero:0,un:1,una:1,uno:1,dos:2,tres:3,cuatro:4,cinco:5,zéro:0,une:1,deux:2,trois:3,quatre:4,cinq:5,um:1,uma:1,dois:2,duas:2,três:3,quatro:4};
const tens={twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
// Preserve initials while bounding qualifiers to one clause.
const firstCountClause=text=>String(text).replace(/\b(\p{Lu})\.(?=\s*\p{L})/gu,'$1\u0000').split(/[;.!?]|\b(?:but|however|and)\b/i)[0].replace(/\u0000/g,'.');
// Conservative quantity-span extraction, not a general-language proof. It
// complements semantic review and deliberately excludes clock/ordinal phrases.
export function countClaimSpans(text){
 const clocks=[...text.matchAll(/\b\d+:[0-5]\d(?::[0-5]\d)?\b/g)].map(match=>({start:match.index,end:match.index+match[0].length}));
 const number=`(?:${Object.keys(tens).join('|')})(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|${Object.keys(numberWords).join('|')}|[+−-]?\\d[\\d.,]*`;
 const expression=new RegExp(`(?<![\\p{L}\\p{N}])(${number})\\s+((?:(?:total|more|confirmed|recorded|pending|unresolved|saved|completed|successful|on[- ]target)\\s+){0,3})(passes décisives|recovery records?|ball wins?|balls? won|shots?|attempts?|goals?|assists?|pass(?:es)?|recover(?:y|ies)|collections?|receptions?|saves?|tiros?|goles?|asistencias?|pases?|tirs?|buts?|chutes?|gols?|assistências?)\\b`,'giu');
 return [...text.matchAll(expression)].filter(match=>!clocks.some(clock=>match.index>=clock.start&&match.index<clock.end)&&
  !(match[3].toLowerCase()==='but'&&/,$/.test(match[1]))).map(match=>{
  const token=match[1].toLowerCase(),parts=token.split(/[- ]/),value=numberWords[token]??(tens[parts[0]]!==undefined?tens[parts[0]]+(numberWords[parts[1]]??0):/^\d+$/.test(token)?Number(token):NaN);
  // Never validate the tail of a larger expression ('one hundred and three').
  const prefix=text.slice(0,match.index),compound=/\b(?:hundred|thousand|million)(?:\s+and)?\s*$|[\p{L}\p{N}][−-]$/iu.test(prefix);
  const tail=firstCountClause(text.slice(match.index+match[0].length));
  const onTarget=/^(?:shots?|attempts?|tiros?|tirs?|chutes?)$/i.test(match[3])?tail.match(/^\s+on[- ]target\b/i):null;
  const pending=/^(?:\s+by\s+[\p{L} .'’\-]{1,80}?)?\s*,?\s+(?:(?:that|which)\s+(?:is|was)\s+(?:still\s+)?|is\s+(?:still\s+)?|remains\s+)?(?:pending(?:\s+(?:an?\s+)?outcome)?|unresolved|awaiting confirmation)\b/iu.test(tail);
  return {text:match[0]+(onTarget?.[0]||''),index:match.index,value:compound?NaN:value,noun:match[3].toLowerCase(),modifiers:match[2].toLowerCase()+(onTarget?'on-target ':'')+(pending?'pending ':'')+(/\b(?:has|have)\s+completed\s*$/i.test(prefix)?'completed ':'')};
 });
}

export function isRosterAbsenceText(text){
 return /\b(?:not|isn't)\s+(?:(?:listed|included|named|present)\b|in\s+(?:(?:the|this|either)\s+)?match\b|(?:in|on)\s+(?:[\p{L}\p{N}'’ -]{0,60}\s+)?(?:roster|lineup|line-up|squad)\b)/iu.test(text)&&
  /\b(?:roster|lineup|line-up|squad|player|match)\b/i.test(text)&&countClaimSpans(text).length===0&&
  !/\b(?:intention|intent|motive|decid|cho[os]|pressure)\w*\b/i.test(text);
}

const escapePattern=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function countSubjects(packet,text){
 const subjects=[...(packet.roster||[]).map(p=>({id:p.id,names:[p.name,String(p.name||'').split(/\s+/).at(-1)]})),...Object.entries(packet.teams||{}).map(([id,name])=>({id,names:[name]}))];
 const hits=subjects.flatMap(subject=>subject.names.filter(Boolean).flatMap(name=>[...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escapePattern(name)}(?![\\p{L}\\p{N}])`,'giu'))].map(m=>({...subject,at:m.index,end:m.index+m[0].length}))));
 // A full initial+surname match is more specific than the shared surname inside it.
 return hits.filter(hit=>!hits.some(other=>other!==hit&&other.at<=hit.at&&other.end>=hit.end&&(other.end-other.at)>(hit.end-hit.at)))
  .filter(hit=>!Object.hasOwn(packet.teams||{},hit.id)||!hits.some(player=>!Object.hasOwn(packet.teams||{},player.id)&&player.end<hit.at&&/^\s+(?:from|for)\s+$/i.test(text.slice(player.end,hit.at))));
}
function countSubject(packet,answer,claimIndex,span){
 const text=answer.claims[claimIndex].text,prefix=text.slice(0,span.index).split(/;|\band\b/i).at(-1);
 const personal=/\b(?:he|him|his|she|her)\b/i.test(prefix+' '+(packet.question||''));
 const contextIds=context=>[...new Set(countSubjects(packet,context).filter(hit=>!personal||(packet.roster||[]).some(player=>player.id===hit.id)).map(hit=>hit.id))];
 const hits=countSubjects(packet,prefix),latest=Math.max(-1,...hits.map(hit=>hit.at));
 let candidates=[...new Set(hits.filter(hit=>hit.at===latest).map(hit=>hit.id))];
 if(!candidates.length){
  const suffix=firstCountClause(text.slice(span.index+span.text.length));
  const explicit=suffix.match(/^\s+(?:by|for)\s+(.+)/i);
  if(explicit)candidates=[...new Set(countSubjects(packet,explicit[1]).map(hit=>hit.id))];
 }
 if(!candidates.length){
  // Coordinate quantities may share one explicit subject: "Cole made one
  // pass and one recovery". Only a plain quantity list inherits the actor;
  // recipients, changed actors and separate sentences remain unresolved.
  const clause=text.slice(0,span.index).replace(/\b(\p{Lu})\.(?=\s*\p{L})/gu,'$1\u0000').split(/[;.!?]/).at(-1).replace(/\u0000/g,'.');
  const prior=countSubjects(packet,clause),ids=[...new Set(prior.map(hit=>hit.id))];
  if(ids.length===1&&/\band\s*$/i.test(clause)){
   const end=Math.max(...prior.map(hit=>hit.end));let rest=clause.slice(end);
   const quantities=countClaimSpans(rest);
   for(const quantity of quantities.toReversed())rest=rest.slice(0,quantity.index)+rest.slice(quantity.index+quantity.text.length);
   if(quantities.length&&/^\s+(?:(?:has|have|made|recorded|completed|taken|scored)\s+)+(?:been\s+active\s+with\s+)?(?:\s|,|\band\b)*$/i.test(rest))candidates=ids;
  }
 }
 const explicit=candidates.length>0;
 if(!candidates.length)candidates=contextIds(packet.question||'');
 if(!candidates.length&&/\b(?:he|she|his|her|they|their)\b/i.test(prefix)){
  const previous=answer.claims.slice(0,claimIndex).at(-1)?.text??packet.conversation?.at(-1)?.answer??'';
  candidates=contextIds(previous);
 }
 return {id:candidates.length===1?candidates[0]:null,ambiguous:candidates.length>1,explicit,pronoun:/\b(?:he|she|his|her|they|their)\b/i.test(prefix)};
}
// Conservative English window binding; unsupported temporal phrases fail closed
// instead of letting a recent subset establish a full-passage quantity.
function countWindow(text,now){
 const opening=text.match(/\b(?:first|opening)\s+(?:(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|sixty)\s+)?(seconds?|minutes?)\b/i);
 if(opening){const token=opening[1]?.toLowerCase(),n=token===undefined?1:Number(token)||numberWords[token]||tens[token];return Number.isFinite(n)&&n>0?{from:0,to:Math.min(now,n*(opening[2].toLowerCase().startsWith('minute')?60:1)),explicit:true}:{unknown:true};}
 const recent=text.match(/\b(?:last|past|previous)\s+(\d+|one|two|three|four|five|ten|twenty|thirty|sixty)\s+(seconds?|minutes?)\b/i);
 if(recent){const n=Number(recent[1])||numberWords[recent[1].toLowerCase()]||tens[recent[1].toLowerCase()];return {from:Math.max(0,now-n*(recent[2].startsWith('minute')?60:1)),to:now};}
 const since=text.match(/\bsince\s+(\d{1,3}):(\d{2})\b/i);
 if(since)return {from:Number(since[1])*60+Number(since[2]),to:now};
 if(/\brecent(?:ly)?\b|\b(?:first|opening)\b[^.!?;]{0,30}\b(?:seconds?|minutes?|half|period)\b|\b(?:first|second|other|either|each)\s+half\b|\bhalf[- ]?time\b|\b(?:prior|before|after|during|between)\b|\b(?:last|past|previous|since)\s+(?:\d|few|minute|second|half|period)/i.test(text))return {unknown:true};
 return {from:0,to:now};
}
function countWindowMatches(source,packet,text){
 const now=packet.observedAt??packet.currentTime,query=source?.query||{};
 // Free-prose window parsing does not establish strict endpoint semantics.
 // Canonical facts carry their separately verified exclusive bounds.
 if(query.timeFromExclusive||query.timeToExclusive)return false;
 // Older direct unit fixtures omit the clock; production packets always have it.
 if(!Number.isFinite(now))return !/\b(?:so far|in (?:this|the) (?:match|passage)|throughout)\b/i.test(packet.question||'')||query.timeFrom===0;
 const requested=countWindow(packet.question||'',now),asserted=countWindow(text,now);
 if(requested.unknown||asserted.unknown)return false;
 const explicit=asserted.explicit||/\b(?:last|past|previous|since|so far|throughout|in (?:this|the) (?:match|passage))\b/i.test(text);
 return query.timeFrom===requested.from&&query.timeTo===requested.to&&(!explicit||query.timeFrom===asserted.from&&query.timeTo===asserted.to);
}

function pendingForSubject(packet,subjectId){
 const pending=packet.pendingOutcomeContext;if(!pending?.count)return false;
 const attempts=pending.attempts||[];
 if(!subjectId||attempts.length<pending.count)return true;
 const roster=packet.roster||[];
 return attempts.some(attempt=>{
  const matches=roster.filter(player=>player.id===attempt.playerId||[player.name,String(player.name||'').split(/\s+/).at(-1)].includes(attempt.player));
  return matches.length!==1||matches[0].id===subjectId||matches[0].team===subjectId;
 });
}
export function unsupportedPendingGoalAbsence(answer,packet){
 if(!packet.pendingOutcomeContext?.count)return [];
 return answer.claims.flatMap((claim,claimIndex)=>{
  if(claim.kind==='general')return [];
  const clauses=claim.text.replace(/\b(\p{Lu})\.(?=\s*\p{L})/gu,'$1\u0000').split(/[;.!?]|\b(?:but|however|and)\b/i).map(text=>text.replace(/\u0000/g,'.'));
  const bad=clauses.some(text=>{
   if(!/\b(?:no|zero)\s+goals?\b|\b(?:has|have|had)\s+not\s+scored\b|\b(?:hasn't|haven't|hadn't)\s+scored\b|\bno (?:one|team|player|side) (?:has |have )?scored\b|\bgoalless\b/i.test(text))return false;
   if(/\b(?:confirmed|recorded)\s+goals?\b|\bgoals?\s+(?:(?:have|has)\s+been|are|is)\s+(?:confirmed|recorded)\b|\bscoreboard\s+(?:shows|records)\s+(?:no|zero)\s+goals?\b/i.test(text))return false;
   const subject=countSubject(packet,{claims:[{text}]},0,{index:text.length,text:''});
   const impersonal=!countSubjects(packet,text).length&&!/\b(?:he|him|his|she|her|they|their)\b/i.test(text);
   return pendingForSubject(packet,impersonal||subject.ambiguous?null:subject.id);
  });
  return bad?[{claimIndex,reason:'An unresolved attempt cannot prove an unqualified absence of goals. State the confirmed or recorded goal count and distinguish the pending outcome.'}]:[];
 });
}

// A reviewer may label a negated action as an individual action. Only a whole,
// single negative assertion plus a complete zero scope can override that label.
// No 'but', second assertion, unrecorded identity, or guessed time window passes.
function verifiedActionAbsence(actor,player,claimIndex,answer,packet,claim){
 const forms={goal:['scored(?: (?:a |any )?(?:(?:confirmed|recorded) )?goals?)?','goals'],shot:['(?:taken|made|had) (?:a |any )?(?:shots?|attempts?)','shots'],
  pass:['(?:made|completed) (?:a |any )?passes?','passes'],receive:['(?:made|had) (?:a |any )?receptions?','receptions'],
  assist:['(?:made|provided|recorded) (?:an? |any )?assists?','assists'],recovery:['(?:made|recorded) (?:a |any )?recover(?:y|ies)','recoveries']};
 const form=forms[actor.action];if(!form||!claim)return false;
 if(actor.action==='goal'&&pendingForSubject(packet,player.id)&&! /\b(?:confirmed|recorded)\b/i.test(firstCountClause(claim.text)))return false;
 const names=[player.name,String(player.name||'').split(/\s+/).at(-1)].filter(Boolean).map(escapePattern).join('|');
 const subject=`(?:${names}|he|she)`;
 const negative='(?:has not|have not|had not|did not|does not|hasn\u0027t|haven\u0027t|hadn\u0027t|didn\u0027t|doesn\u0027t|never)';
 const suffix='(?: yet)?(?: (?:so far|in (?:this|the) (?:match|passage)|in the last \\d+ seconds?|since \\d{1,3}:\\d{2}))*';
 if(!new RegExp(`^\\s*(?:No,?\\s+)?${subject}\\s+${negative}\\s+${form[0]}${suffix}[.!]?\\s*$`,'iu').test(claim.text))return false;
 if(/^\s*(?:No,?\s+)?(?:he|she)\b/i.test(claim.text)){
  const resolved=countSubject(packet,answer,claimIndex,{index:claim.text.length,text:''});
  if(resolved.ambiguous||resolved.id!==player.id)return false;
 }
 const span={noun:form[1],modifiers:actor.action==='pass'&&/\bcompleted\b/i.test(claim.text)?'completed ':''};
 return claim.cited.some(item=>{
  const source=item.record,f=source?.query?.filters||{},resolution=source?.entityResolution?.player??source?.entityResolution?.assistPlayer;
  if(source?.type!=='scope'||source.truncated||!countMetricMatches(span,source.query)||Object.values(source.scope?.missingFields||{}).some(n=>n>0)||!countWindowMatches(source,packet,claim.text))return false;
  if(actor.action==='pass'&&!span.modifiers&&f.result!==undefined)return false;
  if(f.team&&f.team!==player.team)return false;
  if((f.player||f.assistPlayer)&&!(resolution?.status==='resolved'&&resolution.canonicalId===player.id))return false;
  if(source.count===0&&!f.player&&!f.assistPlayer&&!f.team)return true;
  if(source.count===0&&resolution?.status==='resolved'&&resolution.canonicalId===player.id)return true;
  if(!['by-player','by-assister'].includes(source.query?.aggregate))return false;
  const group=source.groups?.find(entry=>entry.key===player.id);
  if(group)return group.count===0;
  const restrictions=source.query.groupCount||{};
  return (restrictions.min===undefined||restrictions.min===0)&&restrictions.max===undefined;
 });
}
function countMetricMatches(span,query){
 const f=query?.filters||{},noun=span.noun,mod=span.modifiers;
 if(Object.keys(f).some(key=>!['type','result','outcome','recoveryClass','recoveryKind','linkedShotOutcome','player','team','assistPlayer'].includes(key)))return false;
 if(f.recoveryClass!==undefined&&(f.type!=='recovery'||f.recoveryClass!=='ball-win'))return false;
 if(/^(?:goals?|goles?|buts?|gols?)$/.test(noun))return f.type==='shot'&&f.result===true;
 if(/^(?:assists?|asistencias?|assistências?|passes décisives)$/.test(noun))return query.aggregate==='by-assister'&&f.type==='shot'&&f.result===true;
 if(/^(?:shots?|attempts?|tiros?|tirs?|chutes?)$/.test(noun)){
  if(/pending|unresolved/.test(mod))return f.type==='shot'&&f.outcome==='pending'&&f.result===undefined;
  if(mod.includes('saved'))return f.type==='shot'&&f.outcome==='saved'||f.type==='recovery'&&f.recoveryKind==='goalkeeper-hold'&&f.linkedShotOutcome==='saved';
  if(/on[- ]target/.test(mod))return f.type==='shot'&&f.outcome==='on-target';
  return f.type==='shot'&&f.outcome===undefined&&f.result===undefined;
 }
 if(noun==='pass'||noun==='passes'||noun==='pases')return f.type==='pass'&&(!/completed|successful/.test(mod)||f.result===true);
 if(/^recovery records?$/.test(noun))return f.type==='recovery'&&f.result===undefined&&f.outcome===undefined&&f.recoveryClass===undefined&&!f.recoveryKind&&!f.linkedShotOutcome;
 if(/^(?:recover(?:y|ies)|ball wins?|balls? won)$/.test(noun))return f.type==='recovery'&&f.result===undefined&&f.outcome===undefined&&f.recoveryClass==='ball-win'&&!f.recoveryKind&&!f.linkedShotOutcome;
 if(/^collections?$/.test(noun))return f.type==='recovery'&&f.recoveryKind==='goalkeeper-hold'&&f.linkedShotOutcome==='saved';
 if(/^receptions?$/.test(noun))return f.type==='receive';
 // A hold after a saved shot does not establish an exhaustive save statistic.
 return false;
}
// Score context alone is not a citation. A pending attempt or an example goal
// cannot establish the current score; require a complete confirmed-goal scope.
function unsupportedScoreCitations(answer,packet){
 const issues=[],teams=Object.keys(packet.teams||{});
 for(const claim of claimEvidenceChecks(answer,packet)){
  if(claim.kind==='general')continue;
  const scores=[...claim.text.matchAll(/\bscore(?:line|board)?\s+(?:(?:is|remains|stands)(?:\s+at)?\s+)?(?:(?:still|currently)\s+)?(\d+)\s*[-–]\s*(\d+)(?![\d-])/gi)];
  for(const match of scores){
   const expected={home:Number(match[1]),away:Number(match[2])};
   const proved=teams.length===2&&teams.includes('home')&&teams.includes('away')&&claim.cited.some(({record:source})=>{
    const q=source?.query,f=q?.filters||{};
    if(source?.type!=='scope'||source.truncated||f.type!=='shot'||f.result!==true||Object.keys(f).some(field=>!['type','result'].includes(field))||
     Object.keys(q.groupCount||{}).length||Object.values(source.scope?.missingFields||{}).some(n=>n>0)||q.timeFrom!==0||q.timeTo!==(packet.observedAt??packet.currentTime)||
     !Number.isSafeInteger(source.count)||source.count<0||!['count','list','by-player','by-team'].includes(q.aggregate))return false;
    const actual={home:0,away:0};
    if(source.count!==0){
     if(!['by-player','by-team'].includes(q.aggregate))return false;
     const groups=source.groups||[],seen=new Set();let total=0;
     for(const group of groups){
      const players=(packet.roster||[]).filter(player=>player.id===group.key);
      const team=q.aggregate==='by-team'?group.key:players.length===1?players[0].team:null;
      if(!teams.includes(team)||seen.has(group.key)||!Number.isSafeInteger(group.count)||group.count<0)return false;
      seen.add(group.key);actual[team]+=group.count;total+=group.count;
     }
     if(total!==source.count)return false;
    }else if((source.groups||[]).some(group=>group.count!==0))return false;
    return teams.every(team=>actual[team]===expected[team]&&(!packet.score||packet.score[team]===expected[team]));
   });
   if(!proved)issues.push({claimIndex:claim.claimIndex,reason:'The stated current score needs a cited complete full-window confirmed-goal scope establishing both teams’ totals. A pending-shot scope or example event does not prove the score.',span:match[0]});
  }
 }
 return issues;
}
export function unsupportedCountCitations(answer,packet){
 return [...unsupportedPendingGoalAbsence(answer,packet),...unsupportedScoreCitations(answer,packet),...unsupportedEventAttributeClaims(answer,packet),...claimEvidenceChecks(answer,packet).flatMap(claim=>(claim.kind==='general'?[]:countClaimSpans(claim.text)).flatMap(span=>{
  if(!Number.isSafeInteger(span.value)||span.value<0)return [{claimIndex:claim.claimIndex,reason:'Use a complete non-negative integer count; this quantity cannot be validated by a numeric suffix.',span:span.text}];
  const usable=source=>source&&!source.truncated&&countMetricMatches(span,source.query)&&!Object.values(source.scope?.missingFields||{}).some(n=>n>0);
  if(claim.cited.some(item=>item.record?.type==='scope'&&usable(item.record)))return [];
  return [{claimIndex:claim.claimIndex,reason:'This numeric total cites individual events or a different metric. Cite the complete matching query scope as well as individual outcome events.',span:span.text,
   candidateScopes:(packet.queryResults||[]).filter(usable).map(q=>({reference:q.scopeReference,query:q.query,count:q.count,groups:q.groups}))}];
 }))];
}

// Affirmative event attributes must belong to the same action and actor.
// This checks a small explicit output vocabulary, not request interpretation;
// it cannot establish that a selected event is the requested first/latest one.
export function unsupportedEventAttributeClaims(answer,packet){
 const issues=[];
 const patterns=[
  {expression:/\b(left[- ]foot(?:ed)?|right[- ]foot(?:ed)?)\s+(pass(?:es)?|shots?|attempts?)\b/gi,attribute:1,action:2},
  {expression:/\b(pass(?:ed|es|ing)?|shots?|attempts?|shoot(?:s|ing)?)\b(?:(?!\b(?:and|but|then|pass(?:ed|es|ing)?|shots?|attempts?|shoot(?:s|ing)?)\b)[^.!?;]){0,45}?\b(?:with|using)\s+(?:(?:his|her|their|the|a)\s+)?(left[- ]foot|right[- ]foot)\b/gi,attribute:2,action:1},
  {expression:/\b(?:used|uses)\s+(?:(?:his|her|their|the)\s+)?(left[- ]foot|right[- ]foot)\s+to\s+(pass|shoot)\b/gi,attribute:1,action:2}
 ];
 for(const claim of claimEvidenceChecks(answer,packet)){
  if(claim.kind==='general')continue;
  const protectedText=claim.text.replace(/\b(\p{Lu})\.(?=\s*\p{L})/gu,'$1\u0000');
  const boundaries=[...protectedText.matchAll(/[;.!?]|\b(?:and|but|however|then)\b/gi)],seen=new Set();
  for(const {expression,attribute,action} of patterns)for(const match of claim.text.matchAll(expression)){
   const left=boundaries.filter(boundary=>boundary.index<match.index).at(-1),right=boundaries.find(boundary=>boundary.index>=match.index+match[0].length);
   const prefix=claim.text.slice(left?left.index+left[0].length:0,match.index),suffix=claim.text.slice(match.index+match[0].length,right?.index??claim.text.length);
   if(/\b(?:no|not|never|cannot|can't|unknown|unclear|whether|without|didn't|doesn't|isn't|wasn't)\b/i.test(prefix)||/^\s+(?:is|was|remains)\s+(?:unknown|unrecorded|not recorded)\b/i.test(suffix))continue;
   const bodyPart=match[attribute].toLowerCase().startsWith('left')?'left-foot':'right-foot',type=match[action].toLowerCase().startsWith('pass')?'pass':'shot';
   const hits=countSubjects(packet,prefix).filter(hit=>(packet.roster||[]).some(player=>player.id===hit.id)),latest=Math.max(-1,...hits.map(hit=>hit.at));
   let actors=[...new Set(hits.filter(hit=>hit.at===latest).map(hit=>hit.id))];
   const by=suffix.match(/^\s+(?:was\s+)?by\s+(.+)/i);
   if(by){
    const agent=firstCountClause(by[1]).split(/,|\b(?:at|to|towards?|for|from|with|into)\b/i)[0];
    actors=[...new Set(countSubjects(packet,agent).filter(hit=>(packet.roster||[]).some(player=>player.id===hit.id)).map(hit=>hit.id))];
   }
   const actor=actors.length===1?actors[0]:null;
   const supported=actors.length<=1&&claim.cited.some(({record:source})=>{
    if(source?.type===type)return source.bodyPart===bodyPart&&(!actor||source.playerId===actor);
    const q=source?.query,f=q?.filters||{};
    if(source?.type!=='scope'||f.type!==type||f.bodyPart!==bodyPart||source.count<=0)return false;
    if(!actor)return true;
    if(f.player!==undefined)return source.entityResolution?.player?.status==='resolved'&&source.entityResolution.player.canonicalId===actor;
    return q.aggregate==='by-player'&&(source.groups||[]).some(group=>group.key===actor&&group.count>0);
   });
   const signature=`${type}:${bodyPart}:${actor}`;
   if(!supported&&!seen.has(signature)){
    seen.add(signature);issues.push({claimIndex:claim.claimIndex,reason:'The asserted foot must be recorded on the cited action of the stated player. A different event type, another player’s action or an unfiltered scope does not establish this attribute.',assertion:match[0],expected:{type,bodyPart,playerId:actor}});
   }
  }
 }
 return issues;
}

// Typed arithmetic derived from an explicit output comparison, never from a
// question category. Other wording remains subject to ordinary review/repair.
function countDifference(packet,text,span){
 const prefix=text.slice(0,span.index),more=/\bmore\b/.test(span.modifiers);
 const relation=more?prefix.match(/\b(?:has|have)(?:\s+(?:completed|recorded|made|taken|scored))?\s*$/i):prefix.match(/\b(?:leads?|is ahead|are ahead)(?:\s+(?:of\s+)?(.+?))?\s+by\s*$/i);
 // A comparison token must never fall through as an ordinary team total.
 if(!relation)return more?{operation:'difference',leftKey:null,rightKey:null,valid:false}:null;
 const teams=Object.keys(packet.teams||{}),hits=countSubjects(packet,prefix.slice(0,relation.index));
 const latest=Math.max(-1,...hits.map(hit=>hit.at)),leaders=[...new Set(hits.filter(hit=>hit.at===latest).map(hit=>hit.id))];
 const than=more?firstCountClause(text.slice(span.index+span.text.length)).match(/^\s+than\s+(.+)/i):null;
 const opponents=more?(than?[...new Set(countSubjects(packet,than[1]).map(hit=>hit.id))]:[]):relation[1]?[...new Set(countSubjects(packet,relation[1]).map(hit=>hit.id))]:teams.filter(team=>team!==leaders[0]);
 const leftKey=leaders.length===1&&teams.includes(leaders[0])?leaders[0]:null;
 const rightKey=opponents.length===1&&teams.includes(opponents[0])?opponents[0]:null;
 return {operation:'difference',leftKey,rightKey,valid:teams.length===2&&!!leftKey&&!!rightKey&&leftKey!==rightKey};
}
function provesCountDifference(source,comparison,span,packet,text){
 if(!comparison.valid||source?.type!=='scope'||source.query?.aggregate!=='by-team'||source.truncated||
  !Number.isSafeInteger(span.value)||span.value<=0||!countMetricMatches(span,source.query)||!countWindowMatches(source,packet,text)||
  Object.values(source.scope?.missingFields||{}).some(n=>n>0)||Object.keys(source.query.groupCount||{}).length||
  Object.keys(source.query.filters||{}).some(field=>!['type','result','outcome','recoveryClass','recoveryKind','linkedShotOutcome'].includes(field)))return false;
 const groups=source.groups||[],keys=new Set(groups.map(group=>group.key));
 if(groups.length!==2||keys.size!==2||!keys.has(comparison.leftKey)||!keys.has(comparison.rightKey)||
  groups.some(group=>!Number.isSafeInteger(group.count)||group.count<0)||!Number.isSafeInteger(source.count)||groups.reduce((sum,group)=>sum+group.count,0)!==source.count)return false;
 const left=groups.find(group=>group.key===comparison.leftKey).count,right=groups.find(group=>group.key===comparison.rightKey).count;
 return left-right===span.value;
}
/** Fill only omitted numeric annotations with independently proved bindings.
 * This never changes claims, citations, reviewer decisions or supplied counts.
 * A narrow clause grammar avoids treating unknown names or unparsed qualifiers
 * as global quantities merely because a cited number happens to match. */
export function numericAssertions(answer){
 return (answer?.claims||[]).flatMap((claim,claimIndex)=>{
  if(claim.kind==='general'||typeof claim.text!=='string')return [];
  const assertions=countClaimSpans(claim.text).map((span,assertionIndex)=>({assertionIndex,text:span.text,value:span.value,index:span.index}));
  return assertions.length?[{claimIndex,assertions}]:[];
 });
}

export function completeNumericReview(review,answer,packet){
 const completed=structuredClone(review),augmentations=[];
 if(!Array.isArray(completed?.checks)||!Array.isArray(answer?.claims))return {review:completed,augmentations};
 const checks=claimEvidenceChecks(answer,packet);
 for(const check of completed.checks){
  const claim=checks[check.claimIndex];
  if(!claim||claim.kind==='general'||!Array.isArray(check.counts)||(packet.mentionedPlayerResolution||[]).some(entity=>entity.status!=='resolved'))continue;
  for(const span of countClaimSpans(claim.text)){
   if(!Number.isSafeInteger(span.value)||span.value<0||countDifference(packet,claim.text,span)||
    check.counts.some(count=>typeof count.text==='string'&&claim.text.includes(count.text)&&count.text.includes(span.text)))continue;
   const protectedText=claim.text.replace(/\b(\p{Lu})\.(?=\s*\p{L})/gu,'$1\u0000');
   const boundaries=[...protectedText.matchAll(/[;!?]|\.(?:\s|$)/g)],left=boundaries.filter(m=>m.index<span.index).at(-1),right=boundaries.find(m=>m.index>=span.index+span.text.length);
   const start=left?left.index+left[0].length:0,end=right?.index??claim.text.length;
   if(start!==0||claim.text.slice(end).replace(/[.!?;\s]/g,''))continue;
   const prefix=claim.text.slice(start,span.index),suffix=claim.text.slice(span.index+span.text.length,end).trim();
   // A global zero may have an explanatory continuation, but that continuation
   // cannot supply the subject or time of the zero. Check clocks across the
   // entire claim below, including later sentences; commas never end the
   // explicit-subject count grammar.
   const globalTail=suffix.split(',')[0].trim();
   const continuation=suffix.includes(',')?suffix.slice(suffix.indexOf(',')+1):'';
   if(/\b(?:at|from|until|earlier|later)\b/i.test(continuation))continue;
   const tail=globalTail.match(/^(?:(?:have|has) been (?:recorded|scored|made)\s*)?(?:(?:so far|in (?:this|the) (?:match|passage)|yet)\s*)*(?:by (\d{1,3}):(\d{2}))?\s*$/i);
   const simpleTail=/^(?:(?:so far|in (?:this|the) (?:match|passage)|yet)\s*)*(?:by (\d{1,3}):(\d{2}))?\s*$/i.exec(suffix);
   const subject=countSubject(packet,answer,check.claimIndex,span),mentions=countSubjects(packet,prefix),before=mentions.filter(hit=>hit.end<=prefix.length).at(-1);
   const explicit=subject.explicit&&!subject.ambiguous&&!subject.pronoun&&subject.id&&before?.id===subject.id&&
    !prefix.slice(0,before.at).trim()&&new Set(mentions.map(hit=>hit.id)).size===1&&
    /^\s*(?::\s*|(?:(?:has|have|had|made|recorded|taken|scored|completed|registered|attempted)\s+){1,3})$/i.test(prefix.slice(before.end))&&simpleTail;
   const globalZero=span.value===0&&!prefix.trim()&&tail;
   if(!explicit&&!globalZero)continue;
   const clockMatch=explicit?simpleTail:tail;
   const assertedTo=clockMatch[1]===undefined?null:Number(clockMatch[1])*60+Number(clockMatch[2]);
   if(clockMatch[2]!==undefined&&Number(clockMatch[2])>=60)continue;
   const clocks=[...claim.text.matchAll(/\b\d{1,3}:\d{2}\b/g)];
   // The only clock admitted by this helper is its one parsed 'by MM:SS'
   // endpoint. Other clocks/ranges/second-sentence qualifications stay for
   // ordinary review, never automatic numeric certification.
   if(clocks.length!==(assertedTo===null?0:1))continue;
   for(const item of claim.cited){
    const source=item.record,q=source?.query,f=q?.filters||{},ref=item.reference;
    if(ref.type!=='scope'||source?.type!=='scope'||source.truncated!==false||!source.scope?.missingFields||
     Object.values(source.scope.missingFields).some(n=>!Number.isSafeInteger(n)||n!==0)||Object.keys(q?.groupCount||{}).length||
     !['count','by-team','by-player','by-assister'].includes(q?.aggregate)||!countMetricMatches(span,q)||!countWindowMatches(source,packet,claim.text)||
     assertedTo!==null&&q.timeTo!==assertedTo)continue;
    if(/^(?:pass|passes|pases)$/.test(span.noun)&&!/completed|successful/.test(span.modifiers)&&Object.hasOwn(f,'result'))continue;
    if(explicit){
     const player=(packet.roster||[]).find(item=>item.id===subject.id),resolved=source.entityResolution?.player??source.entityResolution?.assistPlayer;
     if((f.player!==undefined||f.assistPlayer!==undefined)&&(resolved?.status!=='resolved'||resolved.canonicalId!==subject.id))continue;
     if(f.team!==undefined&&f.team!==(player?.team??subject.id))continue;
    }
    if(globalZero&&(source.count!==0||Object.keys(f).some(field=>!['type','result','outcome','recoveryClass','recoveryKind','linkedShotOutcome'].includes(field))||
     (source.groups||[]).some(group=>group.count!==0)))continue;
    const count={text:span.text,value:span.value,scopeReference:structuredClone(ref),groupKey:globalZero||q.aggregate==='count'?null:subject.id};
    const candidate={checks:[{...check,counts:[...check.counts,count]}]};
    if(reviewCountIssues(candidate,answer,packet).some(issue=>issue.span===span.text))continue;
    check.counts.push(count);augmentations.push({claimIndex:check.claimIndex,span:span.text,index:span.index,value:span.value,scopeReference:structuredClone(ref),groupKey:count.groupKey,reason:'verified-omitted-count-binding'});break;
   }
  }
 }
 return {review:completed,augmentations};
}

export function reviewCountIssues(review,answer,packet){
 const checks=claimEvidenceChecks(answer,packet),issues=[];
 for(const check of review.checks||[]){
  const claim=checks[check.claimIndex];if(!claim||claim.kind==='general')continue;
  const spans=countClaimSpans(claim.text);
  if(!spans.length)continue; // Ignore model-invented totals on ordinary event prose.
  if(!Array.isArray(check.counts)){issues.push({claimIndex:check.claimIndex,reason:'Review omitted quantity checks.'});continue;}
  for(const span of spans){
   const subject=countSubject(packet,answer,check.claimIndex,span);
   const bound=check.counts.filter(count=>typeof count.text==='string'&&claim.text.includes(count.text)&&count.text.includes(span.text)&&countClaimSpans(count.text).length===1&&count.value===span.value);
   const difference=countDifference(packet,claim.text,span);
   if(difference){
    const extracted=check.counts.some(count=>typeof count.text==='string'&&claim.text.includes(count.text)&&count.text.includes(span.text));
    const sources=bound.length?bound.filter(count=>count.groupKey===difference.leftKey).map(count=>claim.cited.find(item=>item.reference.type==='scope'&&key(item.reference)===key(count.scopeReference||{}))?.record):extracted?[]:claim.cited.map(item=>item.record);
    if(!sources.some(source=>provesCountDifference(source,difference,span,packet,claim.text)))issues.push({claimIndex:check.claimIndex,reason:'The stated lead must equal the positive signed difference between both teams in one complete matching scope, with the correct leader, opponent and time window.',span:span.text,claimed:span.value,comparison:difference});
    continue;
   }
   // A complete global zero is directly provable without model quantity
   // extraction. Never apply this to a restricted scope or an unknown identity.
   if(!bound.length&&span.value===0&&!subject.ambiguous&&!(packet.mentionedPlayerResolution||[]).some(entity=>entity.status!=='resolved')){
    const clause=claim.text.slice(0,span.index).split(/[;!?]|\.(?:\s|$)/).at(-1).trim();
    const tail=claim.text.slice(span.index+span.text.length).split(/[;.!?]/)[0];
    const impersonal=/^(?:there (?:are|have been)\s*)?$/i.test(clause)&&/^(?:\s+(?:have|has) been (?:recorded|scored|made))?(?:\s+(?:so far|in (?:this|the) (?:match|passage)|by either team|yet))*\s*$/i.test(tail);
    if(subject.id&&(subject.explicit||subject.pronoun)||impersonal)for(const item of claim.cited){
     const source=item.record,f=source?.query?.filters||{};
     if(source?.type==='scope'&&source.count===0&&!source.truncated&&Object.keys(f).every(field=>['type','result','outcome','recoveryClass','recoveryKind','linkedShotOutcome'].includes(field))&&countMetricMatches(span,source.query)&&!Object.values(source.scope?.missingFields||{}).some(n=>n>0)&&countWindowMatches(source,packet,claim.text))bound.push({text:span.text,value:0,scopeReference:item.reference,groupKey:null});
    }
   }
   if(!bound.length){issues.push({claimIndex:check.claimIndex,reason:'Every numeric total in the answer must have an exact text/value binding and complete cited query scope.',span:span.text});continue;}
   let verified=false,lastActual=null;
   for(const count of bound){
    const source=claim.cited.find(item=>item.reference.type==='scope'&&key(item.reference)===key(count.scopeReference||{}))?.record;
    const f=source?.query?.filters||{};
    // A count filtered to exactly one team has no group rows. Accept that
    // team's explicit binding, but never broaden a player/subset restriction.
    const exactTeamCount=source?.query?.aggregate==='count'&&Object.hasOwn(packet.teams||{},count.groupKey)&&f.team===count.groupKey&&
     Object.keys(f).every(field=>['type','result','outcome','recoveryClass','recoveryKind','linkedShotOutcome','team'].includes(field))&&Object.keys(source.query.groupCount||{}).length===0;
    let actual=count.groupKey===null||exactTeamCount?source?.count:source?.query?.aggregate==='count'?undefined:source?.groups?.find(group=>group.key===count.groupKey)?.count;
    const groupedPlayer=(packet.roster||[]).find(p=>p.id===count.groupKey),restrictions=source?.query?.groupCount||{};
    const identityFilter=source?.entityResolution?.player??source?.entityResolution?.assistPlayer;
    const identityRestricted=source?.query?.filters?.player!==undefined||source?.query?.filters?.assistPlayer!==undefined;
    const eligible=groupedPlayer&&(!source?.query?.filters?.team||source.query.filters.team===groupedPlayer.team)&&(!identityRestricted||identityFilter?.status==='resolved'&&identityFilter.canonicalId===groupedPlayer.id);
    if(actual===undefined&&source&&!source.truncated&&['by-player','by-assister'].includes(source.query?.aggregate)&&eligible&&(restrictions.min===undefined||restrictions.min===0)&&restrictions.max===undefined)actual=0;
    const windowWrong=!countWindowMatches(source,packet,claim.text);
    const unknown=Object.values(source?.scope?.missingFields||{}).some(value=>value>0);
    const filteredSubject=identityFilter?.status==='resolved'?identityFilter.canonicalId:f.team??(packet.roster||[]).find(player=>player.id===f.player||player.name===f.player)?.id;
    const globalZero=span.value===0&&source?.count===0&&!source.query?.filters?.player&&!source.query?.filters?.assistPlayer&&!source.query?.filters?.team;
    const wrongSubject=subject.ambiguous||(!subject.id&&subject.pronoun)||(!globalZero&&(subject.id?(count.groupKey===null?filteredSubject!==subject.id:count.groupKey!==subject.id):count.groupKey!==null));

    if(!source||source.type!=='scope'||source.truncated||unknown||windowWrong||wrongSubject||!countMetricMatches(span,source.query)||(globalZero?0:actual)!==span.value){lastActual=actual??null;continue;}
    verified=true;break;
   }
   if(!verified)issues.push({claimIndex:check.claimIndex,reason:'The asserted total must match the cited complete metric, subject and time window, with no unknown classification. Example events or a different metric cannot prove it.',span:span.text,claimed:span.value,actual:lastActual});
  }
 }
 return issues;
}

/** Complete a missing count citation without rewriting the model's assertion.
 * This intentionally handles one quantity with one explicit grammatical subject.
 * It is citation augmentation, not semantic approval; all final guards and the
 * reviewer still run on the unchanged wording and the augmented references. */
export function completeNumericEvidence(answer,packet){
 const completed=structuredClone(answer),augmentations=[];
 if(!Array.isArray(completed?.claims))return {answer:completed,augmentations};
 for(const [claimIndex,claim] of completed.claims.entries()){
  if(claim.kind==='general'||typeof claim.text!=='string'||!Array.isArray(claim.evidence))continue;
  const spans=countClaimSpans(claim.text);if(spans.length!==1)continue;
  const span=spans[0],subject=countSubject(packet,completed,claimIndex,span);
  if(!Number.isSafeInteger(span.value)||span.value<0||!subject.explicit||subject.ambiguous||!subject.id||subject.pronoun||countDifference(packet,claim.text,span)||
   (packet.mentionedPlayerResolution||[]).some(entity=>entity.status!=='resolved'))continue;
  const mentions=countSubjects(packet,claim.text);
  if(new Set(mentions.map(hit=>hit.id)).size!==1)continue;
  const before=mentions.filter(hit=>hit.id===subject.id&&hit.end<=span.index).at(-1);
  // A named player elsewhere in the sentence is not necessarily this quantity's
  // actor: e.g. "Carter says Messi has three shots" must not borrow Carter.
  const predicate=before?claim.text.slice(before.end,span.index):'';
  if(!before||!/^\s*(?::\s*|(?:(?:has|have|had|made|recorded|taken|scored|completed|registered|attempted)\s+){1,3})$/i.test(predicate))continue;
  // Automatic augmentation is limited to an isolated simple count assertion.
  // Unparsed prefixes/suffixes can narrow time, outcome or another dimension;
  // value coincidence in a broader scope cannot prove those qualifiers.
  if(claim.text.slice(0,before.at).trim()||!/^\s*(?:(?:so far|in this match)\s*)?[.!]?\s*$/i.test(claim.text.slice(span.index+span.text.length)))continue;
  const candidates=[];
  for(const source of packet.queryResults||[]){
   const ref=source.scopeReference,q=source.query,f=q?.filters||{};
   if(ref?.type!=='scope'||!Number.isSafeInteger(ref.revision)||ref.revision<1||source.truncated!==false||!source.scope?.missingFields||
    Object.values(source.scope.missingFields).some(n=>n>0)||Object.keys(q?.groupCount||{}).length||!['count','by-team','by-player','by-assister'].includes(q?.aggregate)||
    !countMetricMatches(span,q)||!countWindowMatches(source,packet,claim.text))continue;
   // An unqualified pass total cannot borrow a completed/failed subset merely
   // because the displayed number happens to be the same.
   if(/^(?:pass|passes|pases)$/.test(span.noun)&&!/completed|successful/.test(span.modifiers)&&Object.hasOwn(f,'result'))continue;
   const groupKey=q.aggregate==='count'?null:subject.id;
   const candidate=structuredClone(completed);
   if(!candidate.claims[claimIndex].evidence.some(existing=>key(existing)===key(ref)))candidate.claims[claimIndex].evidence.push(structuredClone(ref));
   const review={checks:[{claimIndex,counts:[{text:span.text,value:span.value,scopeReference:ref,groupKey}]}]};
   if(reviewCountIssues(review,candidate,packet).length===0)candidates.push(ref);
  }
  // Already supported claims are not relabelled or given redundant references.
  if(candidates.some(ref=>claim.evidence.some(existing=>key(existing)===key(ref))))continue;
  const reference=candidates.sort((a,b)=>key(a).localeCompare(key(b)))[0];if(!reference)continue;
  claim.evidence.push(structuredClone(reference));
  augmentations.push({claimIndex,reference:structuredClone(reference),span:span.text,value:span.value,subjectId:subject.id,reason:'verified-complete-count-scope'});
 }
 return {answer:completed,augmentations};
}

// A completed pass is not itself an assist credit. Check the domain evidence
// independently of whether the model extracted the actor as "pass" or "assist".
export function unsupportedAssistClaims(answer,packet){
 const terms=/\b(?:assist(?:ed|s)?|asistencia|asistido|assistido|assistência|passe d[ée]cisive)\b/iu;
 return claimEvidenceChecks(answer,packet).flatMap(check=>{
  if(!['observation','interpretation'].includes(check.kind)||!terms.test(check.text))return [];
  const records=check.cited.map(item=>item.record).filter(Boolean);
  const credited=records.some(row=>row.type==='shot'&&row.result===true&&row.assist?.playerId);
  const aggregate=records.some(row=>row.type==='scope'&&row.query?.aggregate==='by-assister'&&!row.truncated);
  return credited||aggregate?[]:[{claimIndex:check.claimIndex,reason:'An assist assertion must cite the confirmed goal with explicit assist credit or a complete credited-assist query scope. A pass alone does not establish an assist. Rewrite or cite the actual credit.'}];
 });
}

// Schema-level limitations apply regardless of the question wording. This
// conservative English guard supplements (not replaces) semantic review.
export function unsupportedMeasurementClaims(answer,packet={}){
 const unavailable=/\b(?:\d+(?:\.\d+)?\s*(?:%|percent)\s+(?:chance|probability|likelihood)(?: of scoring)?|(?:chance|probability|likelihood)(?: of scoring)?\s+(?:(?:was|is|of)\s+)?\d+(?:\.\d+)?\s*(?:%|percent)|better chances|higher[- ]quality chances|scoring (?:probability|likelihood) (?:was|is) (?:likely )?(?:low|high)|(?:low|high|higher|lower|good|poor|better|worse)(?:er)? (?:chance|probability|likelihood)(?: of scoring)?|(?:sustained |offensive |attacking |defensive )?pressure|(?:was|is|were|are) (?:not )?in possession|possession|open passing lanes|chose|chooses|choosing|choice|decided|decides|deciding|decision|panicked|(?:(?:did not|didn't|does not|doesn't|could not|couldn't) )?(?:have|has|had|held|hold|holds) (?:the )?ball|(?:was|is|were|are) (?:not )?in control of (?:the )?ball)(?=\W|$)/gi;
 const attempts=packet.assessmentDimensions?.find(d=>d.dimension==='attempts');
 const unsupportedDominance=attempts&&attempts.home===0&&attempts.away===0?/\b(?:pushing more|more threatening|dominant|dominating)\b/gi:null;
 const deniedPrefix=/\b(?:not|no|cannot|can't|unknown|unavailable|unrecorded|unclear|whether|without|doesn't|didn't)\b[^.!?;,]{0,65}$/i;
 // A negated measurement predicate can govern a comma-separated noun list.
 // Keep the grammar narrow: a new clause/positive verb cannot inherit denial.
 const measurementNoun='(?:(?:attacking|defensive|offensive|sustained)\\s+)?(?:pressure|possession|chance quality|goalkeeper workload|saves|crosses|intentions|open passing lanes)';
 const deniedEnumeration=new RegExp('\\b(?:(?:do|does) not|cannot) (?:measure|capture|establish|quantify|reveal) (?:all aspects of [a-z -]+,\\s*such as\\s+)?'+measurementNoun+'(?:(?:,\\s*(?:(?:and|or)\\s+)?|\\s+(?:and|or)\\s+)'+measurementNoun+')*$', 'i');
 return answer.claims.flatMap((claim,claimIndex)=>{
  if(claim.kind==='general')return [];
  const clauses=claim.text.split(/(?<=[.!?;])\s+|\bbut\b|\bhowever\b|\bso\b/i);
  let violation;
  const bad=clauses.find(clause=>{
   for(const match of [...clause.matchAll(unavailable),...(unsupportedDominance?[...clause.matchAll(unsupportedDominance)]:[])]){
    const before=clause.slice(0,match.index),after=clause.slice(match.index+match[0].length);
    const denied=deniedPrefix.test(before)||deniedEnumeration.test(clause.slice(0,match.index+match[0].length))||(claim.kind==='limitation'&&/\b(?:not|no|cannot|can't|unknown|unavailable|unrecorded|unclear|whether|without|doesn't|didn't)\b[^.!?;]*$/i.test(before));
    if(!denied&&!/^\s+(?:(?:intensity|duration|control|measurements?|data)\s+){0,3}(?:is|are|was|were|remains?)\s+(?:unknown|unmeasured|unavailable|not recorded)\b/i.test(after)){
     violation={span:match[0],attribute:/^(?:chose|chooses|choosing|choice|decided|decides|deciding|decision|panicked)$/i.test(match[0])?'intention':'unmeasured-attribute'};return true;
    }
   }
   return false;
  });
  return bad?[{claimIndex,...violation,reason:violation.attribute==='intention'?'The marked mental-state wording is not recorded. Describe the action (took a shot or made a pass), and give a specific limitation when its reason is unknown. A later disclaimer cannot justify an earlier invented choice or motive.':'The record does not measure intention, pressure, possession or chance quality. Describe recorded actions and counts without inferring those attributes.'}]:[];
 });
}

// A recent statistic cannot support an unqualified whole-match conclusion.
// Compare query predicates, not wording-derived team names or inferred values.
export function unsupportedAssessmentWindows(answer,packet){
 const metric=query=>JSON.stringify({aggregate:query.aggregate,filters:Object.fromEntries(Object.entries(query.filters||{}).sort(([a],[b])=>a.localeCompare(b)))});
 return claimEvidenceChecks(answer,packet).flatMap(check=>{
  const claim=answer.claims[check.claimIndex];
  if(claim.kind!=='interpretation'||!/\b(?:overall|so far in (?:the |this )?match|throughout (?:the |this )?match)\b/i.test(claim.text))return [];
  const scopes=check.cited.map(item=>item.record).filter(record=>record?.type==='scope'&&record.query);
  const recent=scopes.filter(record=>record.query.timeFrom>0);
  const missing=recent.filter(record=>!scopes.some(full=>full.query.timeFrom===0&&full.query.timeTo===packet.observedAt&&!full.query.timeFromExclusive&&!full.query.timeToExclusive&&metric(full.query)===metric(record.query)));
  return missing.length?[{claimIndex:check.claimIndex,reason:'This whole-match assessment relies on a restricted-window metric without the matching full-window evidence. Keep the conclusion within that window or select complete evidence for the requested match-wide comparison.'}]:[];
 });
}

// Check explicit first/second/last outcome assertions against a complete
// received player shot inventory. English supplement to semantic review.
export function unsupportedOrderedOutcomes(answer,packet){
 const rows=[...(packet.queryResults||[]).flatMap(q=>q.rows||[]),...(packet.linkedContext?.rows||[])];
 const unique=[...new Map(rows.filter(r=>r.type==='shot').map(r=>[r.id,r])).values()];
 const ordinals={first:0,second:1,third:2,last:-1},issues=globalOrdinalIssues(answer,packet);
 for(const claim of claimEvidenceChecks(answer,packet)){
  if(claim.kind==='general'||! /\b(?:shot|attempt)s?\b/i.test(claim.text))continue;
  const actors=[...new Set(claim.cited.map(c=>c.record).filter(r=>r?.type==='shot').map(r=>r.playerId))];
  if(actors.length!==1)continue;
  const player=actors[0],shots=unique.filter(r=>r.playerId===player).sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));
  const total=(packet.queryResults||[]).find(q=>q.query?.aggregate==='by-player'&&q.query.filters?.type==='shot'&&q.query.filters.outcome===undefined&&q.query.filters.result===undefined&&!q.truncated)?.groups?.find(g=>g.key===player)?.count;
  if(total!==shots.length)continue;
  for(const match of claim.text.matchAll(/\b(first|second|third|last)(?:\s+(?:shot|attempt))?\s+(?:was|is|went)\s+(off[- ]target|blocked|saved|a goal)\b/gi)){
   const position=ordinals[match[1].toLowerCase()],shot=shots.at(position),expected=match[2].toLowerCase().replace('off target','off-target').replace('a goal','goal');
   const actual=shot?.result===true?'goal':shot?.outcome;
   if(actual!==expected)issues.push({claimIndex:claim.claimIndex,reason:'The stated shot order contradicts the complete received timeline. Reconstruct the sequence by elapsed event time, not row order.',assertion:match[0],correctRecord:shot??null});
  }
 }
 return issues;
}

// Output-semantic English supplement: 'the first/latest shot' is global;
// an explicit possessive ('his first shot', 'Silva’s first shot') is player-relative.
// A bounded or incomplete timeline never becomes proof of global order.
function assertsUnknownOrderedOutcome(clause,ordinal){
 const label=escapePattern(ordinal),owner=`(?:the\\s+)?${label}(?:['’]s)?`;
 const unavailable='(?:unknown|unrecorded|unavailable|not\\s+(?:known|recorded|available))';
 const patterns=[
  `\\bno\\s+(?:explicit\\s+)?(?:record|information|data|evidence)\\s+(?:of|about|on|for)\\s+${owner}\\s+(?:outcome|result)\\b`,
  `\\bno\\s+(?:explicit\\s+)?(?:recorded\\s+)?(?:outcome|result)(?:\\s+(?:is|was)\\s+(?:recorded|available))?\\s+(?:for|of)\\s+${owner}\\b`,
  `\\b${owner}\\s+(?:outcome|result)\\s+(?:is|was|remains)\\s+${unavailable}\\b`,
  `\\b(?:outcome|result)\\s+(?:of|for)\\s+${owner}\\s+(?:is|was|remains)\\s+${unavailable}\\b`
 ];
 return affirmedUnavailableAssertion(clause,patterns);
}
function assertsMissingOrderedEvent(clause,ordinal){
 const owner=`(?:the\\s+)?${escapePattern(ordinal)}`;
 // Event absence differs from an unknown attribute of an existing event.
 // Require the event noun to end the assertion or lead into location/context.
 const end=`(?=\\s*(?:$|[,;.!?]|(?:in|within|here|there|exists?|available)\\b))`;
 return affirmedUnavailableAssertion(clause,[
  `\\bno\\s+(?:(?:explicit|recorded|available)\\s+)*${owner}\\b${end}`,
  `\\bno\\s+(?:explicit\\s+)?(?:record|data|information|evidence)\\s+(?:of|for|about)\\s+${owner}\\b${end}`,
  `\\b${owner}\\s+(?:is|was|remains)\\s+(?:missing|absent|unavailable|unrecorded|not\\s+(?:recorded|available|present))\\b`,
  `\\b${owner}\\s+(?:has|had)\\s+not\\s+been\\s+recorded\\b`
 ]);
}
function affirmedUnavailableAssertion(clause,patterns){
 return patterns.some(pattern=>[...clause.matchAll(new RegExp(pattern,'giu'))].some(match=>{
  const before=clause.slice(0,match.index),after=clause.slice(match.index+match[0].length);
  const warning=/\b(?:(?:do not|don't|never)\s+(?:say|claim|assert|assume)|(?:false|wrong|incorrect|not true)\s+(?:to\s+(?:say|claim)|that))\s*['"“‘]?\s*(?:that\s+)?(?:there\s+(?:is|was)\s+)?$/i.test(before);
  const deniedQuote=/^\s*['"”’]\s+(?:is|was)\s+(?:false|wrong|incorrect|untrue)\b/i.test(after);
  return !warning&&!deniedQuote;
 }));
}
function globalOrdinalIssues(answer,packet){
 const timeline=packet.shotTimeline,now=packet.observedAt??packet.currentTime,query=timeline?.query;
 if(!timeline||timeline.truncated||query?.filters?.type!=='shot'||Object.keys(query.filters).length!==1||query.timeFrom!==0||query.timeTo!==now||
  Object.values(timeline.scope?.missingFields||{}).some(n=>n>0))return [];
 const shots=[...new Map((timeline.rows||[]).filter(row=>row.type==='shot'&&row.operation!=='delete'&&row.time<=now&&(!Number.isFinite(row.arrivedAt)||row.arrivedAt<=now)).map(row=>[row.id,row])).values()].sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));
 if(!shots.length||shots.length!==timeline.count)return [];
 const order={first:0,second:1,third:2,last:-1,latest:-1,'most recent':-1},issues=[];
 for(const [claimIndex,claim] of answer.claims.entries()){
  const protectedText=claim.text.replace(/\b(\p{Lu})\.(?=\s*\p{L})/gu,'$1\u0000');
  const boundaries=[...protectedText.matchAll(/[;.!?]|\b(?:but|however|and)\b/gi)];
  for(const match of claim.text.matchAll(/\b(first|second|third|last|latest|most recent)\s+(?:recorded\s+)?(?:shot|attempt)\b/gi)){
   const prefix=claim.text.slice(0,match.index);
   if(/\b(?:his|her|their)\s*$/i.test(prefix)||/[’']s\s*$/i.test(prefix))continue;
   const expected=shots.at(order[match[1].toLowerCase()]);
   if(!expected)continue;
   const left=boundaries.filter(boundary=>boundary.index<match.index).at(-1),right=boundaries.find(boundary=>boundary.index>match.index);
   const clause=claim.text.slice(left?left.index+left[0].length:0,right?.index??claim.text.length);
   const outcome=expected.result===true?'goal':expected.outcome;
   const stated=clause.match(/\b(?:was|is|went|ended|finished|resulted in)\s+(?:a\s+)?(saved|blocked|off[- ]target|goal|pending)\b/i)?.[1]?.toLowerCase().replace('off target','off-target');
   const unknown=assertsUnknownOrderedOutcome(clause,match[0]);
   const missing=assertsMissingOrderedEvent(clause,match[0]);
   if(claim.kind==='general'&&!missing)continue;
   const actorPhrase=claim.text.slice(match.index+match[0].length,right?.index??claim.text.length).match(/^\s+by\s+(.+?)(?=\s+(?:was|is|went|ended|finished)|$)/i)?.[1];
   const actors=actorPhrase?[...new Set(countSubjects(packet,actorPhrase).filter(subject=>(packet.roster||[]).some(player=>player.id===subject.id)).map(subject=>subject.id))]:[];
   // Player names after 'by' assert the actor of this ordered attempt.
   const actorWrong=actors.length===1&&actors[0]!==expected.playerId;
   const citedShots=(claim.evidence||[]).filter(ref=>ref.type==='event').map(ref=>shots.find(row=>row.id===ref.id&&row.revision===ref.revision)).filter(Boolean);
   const wrongCitation=claim.kind==='observation'&&citedShots.length>0&&!citedShots.some(row=>row.id===expected.id);
   if(missing||actorWrong||wrongCitation||stated&&stated!==outcome||unknown&&['goal','saved','blocked','off-target','on-target'].includes(outcome))issues.push({claimIndex,reason:'The ordered shot assertion contradicts the complete received global shot timeline. First/latest refer to event time; the event is present, so use its actual actor and recorded outcome.',assertion:match[0],correctRecord:expected});
  }
 }
 return issues;
}
