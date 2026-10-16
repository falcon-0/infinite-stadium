import {createHash} from 'node:crypto';
import {actionOutcome} from './action-evidence.js';
import {momentHeadline} from './viewer-copy.js';
import {recoveryClassification,recoveryClassificationVersion} from './recovery-classification.js';
import {linkedGoalStory} from './linked-goal-story.js';

const version='question-facts-v1';
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const json=v=>JSON.stringify(stable(v));
const hash=v=>createHash('sha256').update(json(v)).digest('hex');
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const key=r=>`${r?.type}:${r?.id}@${r?.revision}`;
const refValid=r=>r?.type==='scope'&&typeof r.id==='string'&&Number.isSafeInteger(r.revision)&&r.revision>0;
const clock=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(Math.floor(n%60)).padStart(2,'0')}`;
const units={
 en:{attempts:['shot','shots'],shotsOnTarget:['shot on target','shots on target'],goals:['confirmed goal','confirmed goals'],passes:['pass attempt','pass attempts'],completedPasses:['completed pass','completed passes'],failedPasses:['unsuccessful pass','unsuccessful passes'],pendingPasses:['pass awaiting an outcome','passes awaiting an outcome'],pendingShots:['shot awaiting an outcome','shots awaiting an outcome'],savedShots:['shot saved','shots saved'],blockedShots:['shot blocked','shots blocked'],offTargetShots:['shot off target','shots off target'],recoveries:['recovery','recoveries'],receptions:['reception','receptions'],creditedAssists:['credited assist','credited assists']},
 es:{attempts:['tiro','tiros'],shotsOnTarget:['tiro a puerta','tiros a puerta'],goals:['gol confirmado','goles confirmados'],passes:['intento de pase','intentos de pase'],completedPasses:['pase completado','pases completados'],failedPasses:['pase fallido','pases fallidos'],pendingPasses:['pase pendiente de resultado','pases pendientes de resultado'],pendingShots:['tiro pendiente de resultado','tiros pendientes de resultado'],savedShots:['tiro parado','tiros parados'],blockedShots:['tiro bloqueado','tiros bloqueados'],offTargetShots:['tiro fuera','tiros fuera'],recoveries:['recuperación','recuperaciones'],receptions:['recepción','recepciones'],creditedAssists:['asistencia acreditada','asistencias acreditadas']},
 fr:{attempts:['tir','tirs'],shotsOnTarget:['tir cadré','tirs cadrés'],goals:['but confirmé','buts confirmés'],passes:['tentative de passe','tentatives de passe'],completedPasses:['passe réussie','passes réussies'],failedPasses:['passe manquée','passes manquées'],pendingPasses:['passe au résultat en attente','passes au résultat en attente'],pendingShots:['tir au résultat en attente','tirs au résultat en attente'],savedShots:['tir arrêté','tirs arrêtés'],blockedShots:['tir contré','tirs contrés'],offTargetShots:['tir non cadré','tirs non cadrés'],recoveries:['récupération','récupérations'],receptions:['réception','réceptions'],creditedAssists:['passe décisive attribuée','passes décisives attribuées']},
 pt:{attempts:['remate','remates'],shotsOnTarget:['remate à baliza','remates à baliza'],goals:['gol confirmado','gols confirmados'],passes:['tentativa de passe','tentativas de passe'],completedPasses:['passe completo','passes completos'],failedPasses:['passe não completado','passes não completados'],pendingPasses:['passe com resultado pendente','passes com resultado pendente'],pendingShots:['remate com resultado pendente','remates com resultado pendente'],savedShots:['remate defendido','remates defendidos'],blockedShots:['remate bloqueado','remates bloqueados'],offTargetShots:['remate fora','remates fora'],recoveries:['recuperação','recuperações'],receptions:['receção','receções'],creditedAssists:['assistência creditada','assistências creditadas']}
};
const copy={en:{all:'Both teams combined',window:(a,b)=>`From ${a} to ${b}: `,first:'First',last:'Latest',scope:'Matching scope',for:'for',at:'at'},es:{all:'Ambos equipos juntos',window:(a,b)=>`De ${a} a ${b}: `,first:'Primera acción',last:'Última acción',scope:'Ámbito',for:'para',at:'a las'},fr:{all:'Les deux équipes ensemble',window:(a,b)=>`De ${a} à ${b} : `,first:'Première action',last:'Dernière action',scope:'Périmètre',for:'pour',at:'à'},pt:{all:'As duas equipes juntas',window:(a,b)=>`De ${a} a ${b}: `,first:'Primeira ação',last:'Última ação',scope:'Âmbito',for:'para',at:'aos'}};
for(const [language,extra] of Object.entries({
 en:{recoveries:['recovery record','recovery records'],ballWins:['ball win','ball wins'],initialControls:['initial-control event','initial-control events']},
 es:{recoveries:['registro de recuperación','registros de recuperación'],ballWins:['balón recuperado','balones recuperados'],initialControls:['evento de posesión inicial','eventos de posesión inicial']},
 fr:{recoveries:['événement de récupération','événements de récupération'],ballWins:['ballon récupéré','ballons récupérés'],initialControls:['événement de possession initiale','événements de possession initiale']},
 pt:{recoveries:['registro de recuperação','registros de recuperação'],ballWins:['bola recuperada','bolas recuperadas'],initialControls:['evento de posse inicial','eventos de posse inicial']}
}))Object.assign(units[language],extra);
for(const [language,labels] of Object.entries({en:['saved shot collected','saved shots collected'],es:['tiro parado recogido','tiros parados recogidos'],fr:['tir arrêté récupéré','tirs arrêtés récupérés'],pt:['remate defendido recolhido','remates defendidos recolhidos']}))units[language].savedAttemptCollections=labels;
function countText(language,name,value,unit,{global=false,historical=false}={}){
 return ({en:()=>`${name} ${historical?'had':global?'have':'has'} ${value} ${unit}.`,
  es:()=>`${name} ${historical?(global?'registraron':'registró'):(global?'registran':'registra')} ${value} ${unit}.`,
  fr:()=>`${name} ${historical?(global?'totalisaient':'totalisait'):(global?'totalisent':'totalise')} ${value} ${unit}.`,
  pt:()=>`${name} ${historical?(global?'registraram':'registrou'):(global?'registram':'registra')} ${value} ${unit}.`})[language]();
}
function profileText(language,name,attempts,onTarget,historical){
 const shotUnit=units[language].attempts[attempts===1?0:1];
 return ({en:()=>`${name} ${historical?'took':'has taken'} ${attempts} ${shotUnit}, ${onTarget} on target.`,
  es:()=>`${name} ${historical?'realizó':'ha realizado'} ${attempts} ${shotUnit}, ${onTarget} a puerta.`,
  fr:()=>`${name} a tenté ${attempts} ${shotUnit}, dont ${onTarget} ${onTarget===1?'cadré':'cadrés'}.`,
  pt:()=>`${name} fez ${attempts} ${shotUnit}, ${onTarget} à baliza.`})[language]();
}
const windowFlags=q=>({...q.timeFromExclusive?{timeFromExclusive:true}:{},...q.timeToExclusive?{timeToExclusive:true}:{}});
const sameWindow=(a,b)=>a.timeFrom===b.timeFrom&&a.timeTo===b.timeTo&&!!a.timeFromExclusive===!!b.timeFromExclusive&&!!a.timeToExclusive===!!b.timeToExclusive;

function metric(q){
 const f=q?.filters||{};
 if(f.type==='recovery'&&f.recoveryKind==='goalkeeper-hold'&&f.linkedShotOutcome==='saved'&&Object.keys(f).every(k=>['type','recoveryKind','linkedShotOutcome','team','player'].includes(k)))return 'savedAttemptCollections';
 if(Object.keys(f).some(k=>!['type','result','outcome','team','player','assistPlayer','recoveryClass'].includes(k)))return null;
 if(f.recoveryClass!==undefined)return f.type==='recovery'&&f.result===undefined&&f.outcome===undefined&&f.assistPlayer===undefined?({'ball-win':'ballWins','initial-control':'initialControls'})[f.recoveryClass]||null:null;
 if(q.aggregate==='by-assister'||f.assistPlayer!==undefined)return f.type==='shot'&&f.result===true&&f.outcome===undefined&&f.player===undefined?'creditedAssists':null;
 if(f.type==='pass'&&f.outcome===undefined)return f.result===undefined?'passes':f.result===true?'completedPasses':f.result===false?'failedPasses':f.result===null?'pendingPasses':null;
 if(f.type==='shot'){
  if(f.outcome==='goal'&&(f.result===undefined||f.result===true))return 'goals';
  if(f.result===true&&f.outcome===undefined)return 'goals';
  if(f.result!==undefined)return null;
  return f.outcome===undefined?'attempts':({ 'on-target':'shotsOnTarget',pending:'pendingShots',saved:'savedShots',blocked:'blockedShots','off-target':'offTargetShots'})[f.outcome]||null;
 }
 if(f.result!==undefined||f.outcome!==undefined)return null;
 return f.type==='recovery'?'recoveries':f.type==='receive'?'receptions':null;
}
function canonicalOutcome(row){
 const derived=actionOutcome(row);
 // modelRow retains the raw-source distinction even if query normalization
 // supplied a null placeholder. An explicit unknown is never a pending action.
 if(row.actionOutcome){
  if(row.actionOutcome.status==='unknown')return {status:'unknown',basis:row.actionOutcome.basis};
  if(derived?.status!==row.actionOutcome.status)return {status:'unknown',basis:'conflicting-outcome'};
 }
 return derived;
}
function passRecipient(row,actor,player){
 const candidate=player(row.receiverId);
 // IDs bind identities. Display aliases can corroborate an ID, never replace it.
 const aliases=[row.receiverName,row.targetPlayer].filter(value=>value!==undefined&&value!==null);
 const conflicting=aliases.some(value=>value!==candidate?.name&&value!==candidate?.id);
 if(!candidate||candidate.id===actor.id||candidate.team!==actor.team||conflicting)
  return {status:'unknown',basis:!row.receiverId?'missing-receiver':conflicting?'conflicting-receiver':'unresolved-or-invalid-receiver'};
 return {status:canonicalOutcome(row)?.status==='completed'?'confirmed-recipient':'recorded-target',playerId:candidate.id,name:candidate.name,basis:'received-receiver-id'};
}
function passRecipientText(language,actor,recipient,outcome,time,fallback){
 if(recipient.status==='unknown')return fallback+' '+({en:'The recorded recipient is unknown.',es:'Se desconoce el destinatario registrado.',fr:'Le destinataire enregistré est inconnu.',pt:'O destinatário registrado é desconhecido.'})[language];
 const name=recipient.name,t=clock(time);
 if(outcome.status==='completed')return ({en:`${actor} completed a pass to ${name} at ${t}.`,es:`${actor} completó un pase a ${name} a las ${t}.`,fr:`${actor} a réussi une passe à ${name} à ${t}.`,pt:`${actor} completou um passe para ${name} aos ${t}.`})[language];
 return ({en:`${actor}'s pass at ${t} had ${name} as its recorded target; ${outcome.status==='failed'?'the pass was unsuccessful':'the outcome is still pending'}.`,es:`El pase de ${actor} a las ${t} tenía a ${name} como destinatario registrado; ${outcome.status==='failed'?'el pase falló':'el resultado sigue pendiente'}.`,fr:`La passe de ${actor} à ${t} avait ${name} comme destinataire enregistré ; ${outcome.status==='failed'?'la passe a échoué':'le résultat est encore en attente'}.`,pt:`O passe de ${actor} aos ${t} tinha ${name} como destinatário registrado; ${outcome.status==='failed'?'o passe não foi completado':'o resultado ainda está pendente'}.`})[language];
}
function matchesMetric(row,m){
 const outcome=canonicalOutcome(row)?.status;
 return ({attempts:row.type==='shot',shotsOnTarget:row.type==='shot'&&['goal','saved','on-target'].includes(outcome),goals:outcome==='goal',
  passes:row.type==='pass',completedPasses:row.type==='pass'&&outcome==='completed',failedPasses:row.type==='pass'&&outcome==='failed',pendingPasses:row.type==='pass'&&outcome==='pending',
  pendingShots:row.type==='shot'&&outcome==='pending',savedShots:row.type==='shot'&&outcome==='saved',blockedShots:row.type==='shot'&&outcome==='blocked',offTargetShots:row.type==='shot'&&outcome==='off-target',recoveries:row.type==='recovery',ballWins:recoveryClassification(row)==='ball-win',initialControls:recoveryClassification(row)==='initial-control',receptions:row.type==='receive'})[m]===true;
}

/** Trusted app-built evidence only. This does not execute model queries or
 * establish request relevance. The reviewer still checks selected facts against
 * the actual question. Unsupported filters/coverage produce no canonical fact. */
export function buildQuestionFacts(packet){
 const language=Object.hasOwn(units,packet.responseLanguage)?packet.responseLanguage:'en',c=copy[language],now=packet.observedAt??packet.currentTime;
 const roster=packet.roster||[],teams=packet.teams||{},facts=[],seen=new Set();
 const validRoster=Number.isFinite(now)&&roster.every(p=>typeof p.id==='string'&&typeof p.name==='string'&&Object.hasOwn(teams,p.team)&&!Object.hasOwn(teams,p.id))&&new Set(roster.map(p=>p.id)).size===roster.length;
 const sourceFingerprint=hash(packet);
 if(!validRoster)return freeze({version,sourceFingerprint,facts:[],truncated:false});
 const player=id=>roster.find(p=>p.id===id),label=id=>id===null?c.all:Object.hasOwn(teams,id)?teams[id]:player(id)?.name;
 const named=new Set((packet.mentionedPlayerResolution||[]).filter(x=>x.status==='resolved').map(x=>x.canonicalId));
 for(const entry of packet.namedPlayerActions||[])if(player(entry.player?.id))named.add(entry.player.id);
 const add=(text,evidence,proof)=>{const identity=hash({text,evidence,proof}),id='fact-'+identity.slice(0,16);if(seen.has(identity))return id;seen.add(identity);facts.push({id,claim:{text,kind:'observation',evidence:structuredClone(evidence)},proof:structuredClone(proof)});return id;};
 // Availability is a property of the trusted event schema, not an inference
 // from missing actions. Let the model select a specific limitation without
 // writing an unsupported explanation of the player's mental state.
 if(packet.requestedForm==='explanation'&&['player intention','verified open passing lanes'].every(attribute=>packet.evidenceCapabilities?.unavailable?.includes(attribute))){
  const text=({en:"I can't tell what the player intended or which passing options they saw.",es:'No puedo saber qué pretendía el jugador ni qué opciones de pase vio.',fr:'Je ne peux pas savoir ce que le joueur voulait faire ni quelles options de passe il voyait.',pt:'Não posso saber o que o jogador pretendia nem que opções de passe viu.'})[language];
  const id=add(text,[],{kind:'capability-limitation',attributes:['player intention','verified open passing lanes'],basis:'trusted-event-schema',modelGenerated:false});
  facts.find(fact=>fact.id===id).claim.kind='limitation';
 }
 const allQueries=[...(packet.requestedEvidence||[]),...(packet.queryResults||[]),...(packet.shotTimeline?[packet.shotTimeline]:[])];
 const queries=[...new Map(allQueries.map(q=>[key(q.scopeReference),q])).values()];
 const windowValid=q=>Number.isFinite(q.timeFrom)&&Number.isFinite(q.timeTo)&&q.timeFrom>=0&&q.timeTo>=q.timeFrom&&q.timeTo<=now&&[q.timeFromExclusive,q.timeToExclusive].every(v=>v===undefined||typeof v==='boolean');
 const windowText=q=>{
  const a=clock(q.timeFrom),b=clock(q.timeTo);
  if(q.timeFromExclusive||q.timeToExclusive)return ({en:`${q.timeFromExclusive?'After':'From'} ${a} ${q.timeToExclusive?'to before':'through'} ${b}: `,es:`${q.timeFromExclusive?'Después de':'Desde'} ${a} ${q.timeToExclusive?'hasta antes de':'hasta'} ${b}: `,fr:`${q.timeFromExclusive?'Après':'De'} ${a} ${q.timeToExclusive?'à avant':'jusqu’à'} ${b} : `,pt:`${q.timeFromExclusive?'Depois de':'De'} ${a} ${q.timeToExclusive?'até antes de':'até'} ${b}: `})[language];
  return q.timeFrom===0&&q.timeTo===now?'':c.window(a,b);
 };
 const complete=q=>refValid(q.scopeReference)&&q.truncated===false&&windowValid(q.query||{})&&Number.isSafeInteger(q.count)&&q.count>=0&&q.scope?.missingFields&&
  Object.values(q.scope.missingFields).every(n=>n===0)&&Object.keys(q.query?.groupCount||{}).length===0&&Object.values(q.entityResolution||{}).every(r=>r.status==='resolved');
 // Full shot inventories establish outcome partitions. Blocks, wide attempts,
 // saves and pending outcomes must never collapse into a generic "miss" count.
 for(const source of queries){
  const q=source.query,f=q?.filters||{},rows=source.rows;
  if(!complete(source)||source.count===0||q.aggregate!=='list'||f.type!=='shot'||Object.keys(f).some(k=>!['type','team'].includes(k))||!Array.isArray(rows)||rows.length!==source.count||new Set(rows.map(row=>row.id)).size!==rows.length||rows.some(row=>row.type!=='shot'||!['home','away'].includes(row.team)||typeof row.id!=='string'||!Number.isSafeInteger(row.revision)||row.revision<1||!Number.isFinite(row.time)||row.time<q.timeFrom||row.time>q.timeTo||row.arrivedAt>now||row.operation==='delete'||f.team&&row.team!==f.team))continue;
  for(const side of f.team?[f.team]:['home','away']){
   const subset=rows.filter(row=>row.team===side),counts={goal:0,saved:0,blocked:0,'off-target':0,'on-target':0,pending:0,unknown:0};
   for(const row of subset){const status=canonicalOutcome(row)?.status;counts[Object.hasOwn(counts,status)?status:'unknown']++;}
   const labels={en:{goal:'goal',saved:'saved',blocked:'blocked','off-target':'off target','on-target':'on target (further outcome unknown)',pending:'pending',unknown:'outcome unknown'},es:{goal:'gol',saved:'parado',blocked:'bloqueado','off-target':'fuera','on-target':'a puerta (resultado desconocido)',pending:'pendiente',unknown:'resultado desconocido'},fr:{goal:'but',saved:'arrêté',blocked:'contré','off-target':'non cadré','on-target':'cadré (suite inconnue)',pending:'en attente',unknown:'résultat inconnu'},pt:{goal:'golo',saved:'defendido',blocked:'bloqueado','off-target':'fora','on-target':'à baliza (resultado desconhecido)',pending:'pendente',unknown:'resultado desconhecido'}}[language];
   const breakdown=Object.entries(counts).filter(([,n])=>n>0).map(([status,n])=>`${n} ${labels[status]}`).join(', ');
   const noun={en:'attempts',es:'remates',fr:'tirs',pt:'remates'}[language];
   add(`${windowText(q)}${teams[side]}: ${subset.length} ${noun}${breakdown?' — '+breakdown:''}.`,[source.scopeReference],{kind:'shot-outcome-profile',metric:'shotOutcomes',subjectId:side,attempts:subset.length,counts,timeFrom:q.timeFrom,timeTo:q.timeTo,...windowFlags(q),scope:source.scopeReference,query:q,modelGenerated:false,doesNotProve:['keeper-identity','overall-workload','chance-quality']});
  }
 }
 const countFacts=[];
 for(const id of named){const p=player(id);if(!p)continue;
  const source=queries.find(q=>refValid(q.scopeReference)&&q.entityResolution?.player?.status==='resolved'&&q.entityResolution.player.canonicalId===id);
  if(!source)continue;
  const text=({en:`${p.name} plays for ${teams[p.team]}.`,es:`${p.name} juega en ${teams[p.team]}.`,fr:`${p.name} joue pour ${teams[p.team]}.`,pt:`${p.name} joga no ${teams[p.team]}.`})[language];
  add(text,[source.scopeReference],{kind:'roster',playerId:id,team:p.team,scope:source.scopeReference,modelGenerated:false});
 }
 for(const source of queries){
  const q=source.query,f=q?.filters||{},m=metric(q),emptyList=q?.aggregate==='list'&&source.count===0&&Array.isArray(source.rows)&&source.rows.length===0;
  if(!m||!complete(source)||!['count','by-team','by-player','by-assister'].includes(q.aggregate)&&!emptyList)continue;
  const resolution=source.entityResolution||source.scope.entityResolution||{};
  const actorField=f.assistPlayer!==undefined?'assistPlayer':f.player!==undefined?'player':null;
  const actor=actorField?resolution[actorField]?.canonicalId:null;
  if(actorField&&(!player(actor)||resolution[actorField]?.status!=='resolved')||f.team!==undefined&&!Object.hasOwn(teams,f.team)||actor&&f.team&&player(actor).team!==f.team)continue;
  let values=[];
  if(q.aggregate==='count'||emptyList)values=[{id:actor??f.team??null,count:source.count}];
  else{
   const groups=source.groups||[],ids=groups.map(g=>g.key);
   if(new Set(ids).size!==ids.length||groups.some(g=>!Number.isSafeInteger(g.count)||g.count<0||!(q.aggregate==='by-team'?Object.hasOwn(teams,g.key):player(g.key)))||groups.reduce((n,g)=>n+g.count,0)!==source.count)continue;
   if(groups.some(g=>actor&&g.key!==actor||f.team&&(q.aggregate==='by-team'?g.key:player(g.key)?.team)!==f.team))continue;
   values=groups.filter(g=>g.count>0||q.aggregate==='by-team'||named.has(g.key)).map(g=>({id:g.key,count:g.count}));
   if(q.aggregate==='by-team')for(const id of Object.keys(teams).filter(id=>!f.team||id===f.team))if(!ids.includes(id))values.push({id,count:0});
   if(['by-player','by-assister'].includes(q.aggregate))for(const id of named)if(player(id)&&(!actor||actor===id)&&(!f.team||player(id).team===f.team)&&!ids.includes(id))values.push({id,count:0});
  }
  for(const value of values){const name=label(value.id);if(!name)continue;const unit=units[language][m][value.count===1?0:1];
   const proof={kind:'count',metric:m,subjectId:value.id,value:value.count,timeFrom:q.timeFrom,timeTo:q.timeTo,...windowFlags(q),scope:source.scopeReference,query:q,coverage:source.scope,modelGenerated:false};
   if(['ballWins','initialControls'].includes(m))proof.measurementVersion=recoveryClassificationVersion;
   const text=windowText(q)+(m==='savedAttemptCollections'?({en:`${name} has collected ${value.count} saved ${value.count===1?'shot':'shots'}.`,es:`${name} ha recogido ${value.count} tiros parados.`,fr:`${name} a récupéré ${value.count} tirs arrêtés.`,pt:`${name} recolheu ${value.count} remates defendidos.`})[language]:countText(language,name,value.count,unit,{global:value.id===null,historical:q.timeTo!==now}));const factId=add(text,[source.scopeReference],proof);countFacts.push({factId,text,proof,ref:source.scopeReference});
  }
 }
 // A team faces its opponent's attempts. Keep this inversion explicit and
 // source-proved; it does not credit a save to a named keeper or rate workload.
 for(const item of countFacts){
  const proof=item.proof;
  if(proof.metric!=='shotsOnTarget'||proof.query.aggregate!=='by-team'||!['home','away'].includes(proof.subjectId)||
   Object.keys(proof.query.filters).some(field=>!['type','outcome','team'].includes(field)))continue;
  const defending=proof.subjectId==='home'?'away':'home',name=label(defending);if(!name)continue;
  const text=({en:()=>`${name} has faced ${proof.value} ${proof.value===1?'shot':'shots'} on target.`,
   es:()=>`${name} ha recibido ${proof.value} ${proof.value===1?'remate':'remates'} a puerta.`,
   fr:()=>`${name} a subi ${proof.value} ${proof.value===1?'tir cadré':'tirs cadrés'}.`,
   pt:()=>`${name} sofreu ${proof.value} ${proof.value===1?'remate':'remates'} à baliza.`})[language]();
  add(windowText(proof.query)+text,[item.ref],{kind:'opponent-count',metric:'shotsOnTargetFaced',subjectId:defending,attackingTeam:proof.subjectId,value:proof.value,
   timeFrom:proof.timeFrom,timeTo:proof.timeTo,...windowFlags(proof),scope:proof.scope,operand:proof,modelGenerated:false,
   doesNotProve:['keeper-identity','save-credit','overall-workload','chance-quality']});
 }
 // A comparison is an application-computed fact, not a model-written total.
 // Match metric, subject predicate and window before comparing both teams.
 const comparisons=new Map();
 for(const fact of facts.filter(f=>['count','opponent-count'].includes(f.proof.kind)&&['home','away'].includes(f.proof.subjectId))){
  const p=fact.proof,q=(p.operand||p).query;
  if(!q||q.filters?.player!==undefined||q.filters?.assistPlayer!==undefined)continue;
  const predicate=Object.fromEntries(Object.entries(q.filters||{}).filter(([name])=>name!=='team'));
  const identity=json({metric:p.metric,timeFrom:p.timeFrom,timeTo:p.timeTo,...windowFlags(p),predicate});
  if(!comparisons.has(identity))comparisons.set(identity,[]);comparisons.get(identity).push(fact);
 }
 for(const candidates of comparisons.values()){
  const sides=['home','away'].map(team=>candidates.filter(f=>f.proof.subjectId===team));
  if(sides.some(side=>!side.length||new Set(side.map(f=>f.proof.value)).size!==1))continue;
  const [home,away]=sides.map(side=>side[0]),p=home.proof,a=p.value,b=away.proof.value;
  const leader=a===b?null:a>b?'home':'away',margin=Math.abs(a-b);
  const metricLabel=p.metric==='shotsOnTargetFaced'?({en:'shots on target faced',es:'remates a puerta recibidos',fr:'tirs cadrés subis',pt:'remates à baliza sofridos'})[language]:units[language][p.metric]?.[1];
  if(!metricLabel)continue;
  const values=`${label('home')} ${a}, ${label('away')} ${b}`;
  const text=({en:()=>`On ${metricLabel}, ${leader?label(leader)+' leads':'the teams are level'}: ${values}.`,
   es:()=>`En ${metricLabel}, ${leader?label(leader)+' lleva ventaja':'los equipos están igualados'}: ${values}.`,
   fr:()=>`Pour les ${metricLabel}, ${leader?label(leader)+' est devant':'les équipes sont à égalité'} : ${values}.`,
   pt:()=>`Em ${metricLabel}, ${leader?label(leader)+' leva vantagem':'as equipes estão empatadas'}: ${values}.`})[language]();
  const attackingLeader=p.metric==='shotsOnTargetFaced'&&leader?(leader==='home'?'away':'home'):null;
  const relationalText=attackingLeader?({en:()=>`On shots on target, ${label(attackingLeader)} has tested ${label(leader)} more: ${label(leader)} faced ${Math.max(a,b)}, ${label(attackingLeader)} faced ${Math.min(a,b)}.`,
   es:()=>`En remates a puerta, ${label(attackingLeader)} ha rematado más contra ${label(leader)}: ${label(leader)} recibió ${Math.max(a,b)}, ${label(attackingLeader)} recibió ${Math.min(a,b)}.`,
   fr:()=>`Sur les tirs cadrés, ${label(attackingLeader)} a cadré davantage contre ${label(leader)} : ${label(leader)} a subi ${Math.max(a,b)}, ${label(attackingLeader)} a subi ${Math.min(a,b)}.`,
   pt:()=>`Em remates à baliza, ${label(attackingLeader)} testou mais ${label(leader)}: ${label(leader)} sofreu ${Math.max(a,b)}, ${label(attackingLeader)} sofreu ${Math.min(a,b)}.`})[language]():text;
  add(windowText((p.operand||p).query)+relationalText,[...new Map([...home.claim.evidence,...away.claim.evidence].map(ref=>[key(ref),ref])).values()],
   {kind:'team-comparison',metric:p.metric,leader,...(attackingLeader?{attackingLeader}:{}),margin,values:{home:a,away:b},timeFrom:p.timeFrom,timeTo:p.timeTo,...windowFlags(p),
    operands:[home.proof,away.proof],componentFactIds:[home.id,away.id],assessmentBounds:'this-measure-only',modelGenerated:false});
 }
 // A threshold query proves its complete qualifying groups, not the total
 // actions of those groups from the query's pre-filter count.
 for(const source of queries){
  const q=source.query,f=q?.filters||{},bounds=q?.groupCount,m=metric(q),groups=source.groups||[];
  if(!bounds||!Object.keys(bounds).length||Object.keys(bounds).some(k=>!['min','max'].includes(k))||Object.values(bounds).some(v=>!Number.isSafeInteger(v)||v<0)||
   bounds.min!==undefined&&bounds.max!==undefined&&bounds.min>bounds.max||!m||!refValid(source.scopeReference)||source.truncated!==false||!windowValid(q)||
   !['by-team','by-player','by-assister'].includes(q.aggregate)||!source.scope?.missingFields||Object.values(source.scope.missingFields).some(v=>v!==0)||
   source.matchedGroupCount!==groups.length||new Set(groups.map(g=>g.key)).size!==groups.length||!Number.isSafeInteger(source.count)||source.count<0||f.player!==undefined||f.assistPlayer!==undefined||
   f.team!==undefined&&!Object.hasOwn(teams,f.team)||Object.values(source.entityResolution||{}).some(r=>r.status!=='resolved'))continue;
  if(groups.some(g=>!Number.isSafeInteger(g.count)||g.count<0||g.count<(bounds.min??0)||g.count>(bounds.max??Infinity)||
   !(q.aggregate==='by-team'?Object.hasOwn(teams,g.key):player(g.key))||f.team&&(q.aggregate==='by-team'?g.key:player(g.key).team)!==f.team)||groups.reduce((n,g)=>n+g.count,0)>source.count)continue;
  const bound=({en:()=>bounds.min!==undefined&&bounds.max!==undefined?`${bounds.min}–${bounds.max}`:bounds.min!==undefined?`at least ${bounds.min}`:`at most ${bounds.max}`,
   es:()=>bounds.min!==undefined&&bounds.max!==undefined?`${bounds.min}–${bounds.max}`:bounds.min!==undefined?`al menos ${bounds.min}`:`como máximo ${bounds.max}`,
   fr:()=>bounds.min!==undefined&&bounds.max!==undefined?`${bounds.min}–${bounds.max}`:bounds.min!==undefined?`au moins ${bounds.min}`:`au plus ${bounds.max}`,
   pt:()=>bounds.min!==undefined&&bounds.max!==undefined?`${bounds.min}–${bounds.max}`:bounds.min!==undefined?`pelo menos ${bounds.min}`:`no máximo ${bounds.max}`})[language]();
  const names=({en:q.aggregate==='by-team'?'Teams':'Players',es:q.aggregate==='by-team'?'Equipos':'Jugadores',fr:q.aggregate==='by-team'?'Équipes':'Joueurs',pt:q.aggregate==='by-team'?'Equipes':'Jogadores'})[language];
  const withWord=({en:'with',es:'con',fr:'avec',pt:'com'})[language],none=({en:'none',es:'ninguno',fr:'aucun',pt:'nenhum'})[language];
  const listing=groups.length?groups.map(g=>`${label(g.key)} (${g.count})`).join(', '):none;
  add(`${windowText(q)}${names} ${withWord} ${bound} ${units[language][m][1]}${f.team?` — ${teams[f.team]}`:''}: ${listing}.`,[source.scopeReference],
   {kind:'qualifying-groups',metric:m,bounds,groups:groups.map(g=>({id:g.key,count:g.count})),matchedGroupCount:source.matchedGroupCount,timeFrom:q.timeFrom,timeTo:q.timeTo,...windowFlags(q),query:q,scope:source.scopeReference,coverage:source.scope,modelGenerated:false});
 }
 // Pair compatible shooting statistics without inventing a rating or chance
 // quality. Both primitive scopes remain independently inspectable.
 const profiles=[];
 for(const a of countFacts.filter(x=>x.proof.metric==='attempts'&&x.proof.subjectId!==null)){
  const b=countFacts.find(x=>x.proof.metric==='shotsOnTarget'&&x.proof.subjectId===a.proof.subjectId&&sameWindow(x.proof,a.proof));
  if(!b||b.proof.value>a.proof.value)continue;
  const text=windowText(a.proof)+profileText(language,label(a.proof.subjectId),a.proof.value,b.proof.value,a.proof.timeTo!==now);
  const proof={kind:'shooting-profile',subjectId:a.proof.subjectId,timeFrom:a.proof.timeFrom,timeTo:a.proof.timeTo,...windowFlags(a.proof),operands:[a.proof,b.proof],modelGenerated:false};
  const before=facts.length;add(text,[a.ref,b.ref],proof);if(facts.length>before)profiles.push(facts.pop());
 }
 facts.unshift(...profiles);
 // Completion is a ratio over confirmed outcomes; pending passes never become
 // failures or disappear into an assertion about all attempted passes.
 for(const a of countFacts.filter(x=>x.proof.metric==='completedPasses'&&x.proof.subjectId!==null)){
  const b=countFacts.find(x=>x.proof.metric==='failedPasses'&&x.proof.subjectId===a.proof.subjectId&&sameWindow(x.proof,a.proof));
  if(!b)continue;
  const total=a.proof.value+b.proof.value;if(!total)continue;
  const percent=Math.round(a.proof.value/total*1000)/10,name=label(a.proof.subjectId);
  const text=({en:`${name}: ${percent}% pass completion — ${a.proof.value} of ${total} passes with a confirmed outcome.`,es:`${name}: ${percent}% de pases completados — ${a.proof.value} de ${total} pases con resultado confirmado.`,fr:`${name} : ${percent}% de passes réussies — ${a.proof.value} sur ${total} passes au résultat confirmé.`,pt:`${name}: ${percent}% de passes completos — ${a.proof.value} de ${total} passes com resultado confirmado.`})[language];
  add(windowText(a.proof)+text,[a.ref,b.ref],{kind:'pass-completion-profile',subjectId:a.proof.subjectId,timeFrom:a.proof.timeFrom,timeTo:a.proof.timeTo,...windowFlags(a.proof),operands:[a.proof,b.proof],denominator:total,percentage:percent,pendingExcluded:true,assessmentBounds:'this-measure-only',modelGenerated:false});
 }
 // A shared zero-score sentence is supported by both complete operands, never
 // by pending-shot evidence. Retain each scope even when two queries prove it.
 for(const home of countFacts.filter(x=>x.proof.metric==='goals'&&x.proof.subjectId==='home'&&x.proof.value===0)){
  const away=countFacts.find(x=>x.proof.metric==='goals'&&x.proof.subjectId==='away'&&x.proof.value===0&&sameWindow(x.proof,home.proof));
  if(!away)continue;
  const current=home.proof.timeFrom===0&&home.proof.timeTo===now&&!home.proof.timeFromExclusive&&!home.proof.timeToExclusive;
  const text=windowText(home.proof)+({en:current?'Neither team has a confirmed goal yet.':'Neither team had a confirmed goal in this interval.',es:current?'Ninguno de los dos equipos tiene un gol confirmado todavía.':'Ninguno de los dos equipos tuvo un gol confirmado en este intervalo.',fr:current?'Aucun des deux clubs n’a de but confirmé pour le moment.':'Aucun des deux clubs n’a eu de but confirmé dans cet intervalle.',pt:current?'Nenhuma das duas equipes tem um gol confirmado ainda.':'Nenhuma das duas equipes teve um gol confirmado neste intervalo.'})[language];
  const evidence=[...new Map([home.ref,away.ref].map(ref=>[key(ref),ref])).values()];
  add(text,evidence,{kind:'confirmed-score',home:0,away:0,timeFrom:home.proof.timeFrom,timeTo:home.proof.timeTo,...windowFlags(home.proof),operands:[home.proof,away.proof],componentFactIds:[home.factId,away.factId],modelGenerated:false});
 }
 const rows=[...allQueries.flatMap(q=>q.rows||[]),...(packet.linkedContext?.rows||[])],latest=new Map(),conflicts=new Set();
 for(const row of rows){if(!Number.isFinite(row.time)||row.time>now||row.arrivedAt>now||!Number.isSafeInteger(row.revision)||row.revision<1)continue;
  const old=latest.get(row.id);if(!old||row.revision>old.revision){latest.set(row.id,row);conflicts.delete(row.id);}else if(row.revision===old.revision&&json(row)!==json(old))conflicts.add(row.id);
 }
 const eventFacts=new Map();
 for(const row of latest.values()){
  const actor=player(row.playerId);if(conflicts.has(row.id)||row.operation==='delete'||!actor||actor.team!==row.team||!['pass','shot','receive','recovery'].includes(row.type))continue;
  const outcome=canonicalOutcome(row);if(outcome?.status==='unknown')continue;
  const recoveryClass=recoveryClassification(row);if(recoveryClass==='unknown')continue;
  const ref={type:'event',id:row.id,revision:row.revision};
  const headline=row.type==='shot'&&outcome?.status==='pending'?({en:`${actor.name} shot at ${clock(row.time)}; the outcome is still pending.`,es:`${actor.name} tiró a las ${clock(row.time)}; el resultado sigue pendiente.`,fr:`${actor.name} a tiré à ${clock(row.time)} ; le résultat est encore en attente.`,pt:`${actor.name} rematou aos ${clock(row.time)}; o resultado ainda está pendente.`})[language]:`${momentHeadline({...row,player:actor.name},language)} ${c.at} ${clock(row.time)}.`;
  const recipient=row.type==='pass'?passRecipient(row,actor,player):null;
  const text=recipient?passRecipientText(language,actor.name,recipient,outcome,row.time,headline):headline;
  const proof={kind:'event',eventId:row.id,revision:row.revision,playerId:actor.id,eventType:row.type,time:row.time,actionOutcome:outcome,recipientStatus:recipient?.status??null,...recipient?{recipient}:{},modelGenerated:false};
  add(text,[ref],proof);eventFacts.set(row.id,{text,ref,proof,row});
  // Optional source attributes are separate selectable facts, not inferred from
  // a technique, result, adjacent event or the player's usual preference.
  if(['pass','shot'].includes(row.type)&&['left-foot','right-foot','head'].includes(row.bodyPart)){
   const body=({en:{'left-foot':'left foot','right-foot':'right foot',head:'head'},es:{'left-foot':'pie izquierdo','right-foot':'pie derecho',head:'cabeza'},fr:{'left-foot':'pied gauche','right-foot':'pied droit',head:'tête'},pt:{'left-foot':'pé esquerdo','right-foot':'pé direito',head:'cabeça'}})[language][row.bodyPart];
   const action=({en:{pass:'pass',shot:outcome.status==='goal'?'goal':'shot'},es:{pass:'pase',shot:outcome.status==='goal'?'gol':'tiro'},fr:{pass:'passe',shot:outcome.status==='goal'?'but':'tir'},pt:{pass:'passe',shot:outcome.status==='goal'?'gol':'remate'}})[language][row.type];
   const attributeText=({en:`${actor.name} used their ${body} for the ${action} at ${clock(row.time)}.`,es:`${actor.name} usó ${row.bodyPart==='head'?'la':'el'} ${body} para el ${action} a las ${clock(row.time)}.`,fr:`${actor.name} a utilisé ${row.bodyPart==='head'?'la':'le'} ${body} pour ${row.type==='pass'?'la':'le'} ${action} à ${clock(row.time)}.`,pt:`${actor.name} usou ${row.bodyPart==='head'?'a':'o'} ${body} para o ${action} aos ${clock(row.time)}.`})[language];
   add(attributeText,[ref],{...proof,attributes:{bodyPart:row.bodyPart}});
  }
  if(row.type==='shot'&&outcome?.status==='goal'){
   const assister=player(row.assist?.playerId);
   if(assister&&assister.team===actor.team&&assister.id!==actor.id){
    const assistText=({en:`${assister.name} is credited with the assist for ${actor.name}'s goal at ${clock(row.time)}.`,es:`${assister.name} tiene acreditada la asistencia del gol de ${actor.name} a las ${clock(row.time)}.`,fr:`La passe décisive du but de ${actor.name} à ${clock(row.time)} est attribuée à ${assister.name}.`,pt:`${assister.name} tem a assistência creditada no gol de ${actor.name} aos ${clock(row.time)}.`})[language];
    add(assistText,[ref],{kind:'credited-goal-assist',eventId:row.id,revision:row.revision,scorerId:actor.id,assisterId:assister.id,time:row.time,modelGenerated:false});
   }
  }
 }
 if(packet.answerFocus==='event-sequence')for(const goal of eventFacts.values()){
  const story=linkedGoalStory(goal,eventFacts,{language,name:id=>player(id)?.name,clock});
  if(story){const id=add(story.text,story.evidence,story.proof);facts.find(fact=>fact.id===id).claim.kind='interpretation';}
 }
 for(const source of packet.requestedEvidence||[]){
  const q=source.query,f=q?.filters||{},order=q?.order??'asc',baseFilters={...f};delete baseFilters.bodyPart;
  const m=metric({...q,filters:baseFilters});
  // A bounded one-row query is an explicit endpoint selector. An ordinary
  // complete list (including the compacted ascending default) is not an
  // instruction to introduce a first/latest fact into an assessment.
  if(!refValid(source.scopeReference)||q?.aggregate!=='list'||q.limit!==1||!['asc','desc'].includes(order)||!windowValid(q)||f.id||!m||
   f.bodyPart!==undefined&&(!['left-foot','right-foot','head'].includes(f.bodyPart)||!['pass','shot'].includes(f.type))||
   !source.scope?.missingFields||Object.values(source.scope.missingFields).some(n=>n!==0)||!Number.isSafeInteger(source.count)||source.count<=0)continue;
  const listed=(source.rows||[]).map(row=>eventFacts.get(row.id)).filter(item=>item&&source.rows.some(row=>row.id===item.row.id&&row.revision===item.row.revision));
  if(listed.length!==(source.rows||[]).length||listed.length!==1)continue;
  const sorted=[...listed].sort((a,b)=>a.row.time-b.row.time||a.row.id.localeCompare(b.row.id)),endpoint=order==='asc'?sorted[0]:sorted.at(-1);
  const subject=f.player?source.entityResolution?.player?.canonicalId:f.team??null;
  if(f.player&&!player(subject)||f.team&&!Object.hasOwn(teams,f.team))continue;
  if(listed.some(item=>!matchesMetric(item.row,m)||subject&&(Object.hasOwn(teams,subject)?item.row.team!==subject:item.row.playerId!==subject)||Object.hasOwn(f,'result')&&item.row.result!==f.result||f.bodyPart&&item.row.bodyPart!==f.bodyPart||item.row.time<q.timeFrom||item.row.time>q.timeTo||q.timeFromExclusive&&item.row.time===q.timeFrom||q.timeToExclusive&&item.row.time===q.timeTo))continue;
  const bodyLabel=f.bodyPart?({en:{'left-foot':'left foot','right-foot':'right foot',head:'head'},es:{'left-foot':'pie izquierdo','right-foot':'pie derecho',head:'cabeza'},fr:{'left-foot':'pied gauche','right-foot':'pied droit',head:'tête'},pt:{'left-foot':'pé esquerdo','right-foot':'pé direito',head:'cabeça'}})[language][f.bodyPart]:null;
  const qualifier=`${units[language][m][0]}${bodyLabel?` (${bodyLabel})`:''}${subject?` ${c.for} ${label(subject)}`:''}${q.timeFromExclusive||q.timeToExclusive?` (${windowText(q).trim().replace(/:$/,'')})`:q.timeFrom!==0||q.timeTo!==now?` (${clock(q.timeFrom)}–${clock(q.timeTo)})`:''}`;
  const feminine=({es:['receptions','creditedAssists'],fr:['passes','completedPasses','failedPasses','pendingPasses','receptions','creditedAssists'],pt:['passes','receptions','creditedAssists','ballWins']})[language]?.includes(m);
  const ordinal=language==='en'?(order==='asc'?c.first:c.last):({
   es:order==='asc'?(feminine?'Primera':'Primer'):(feminine?'Última':'Último'),
   fr:order==='asc'?(feminine?'Première':'Premier'):(feminine?'Dernière':'Dernier'),
   pt:order==='asc'?(feminine?'Primeira':'Primeiro'):(feminine?'Última':'Último')
  })[language];
  let prefix=`${ordinal} ${qualifier}`;
  const relation=(packet.queryRelations||[]).find(link=>link.anchorIdentifiedBy==='requested-moment'&&link.relation==='before'&&link.sameTeam&&key(link.scopeReference)===key(source.scopeReference)&&key(link.anchor)===key(packet.requestedMoment?.reference)&&link.anchorTime===packet.requestedMoment?.time);
  const anchor=relation&&queries.flatMap(query=>query.rows||[]).find(row=>key({type:'event',id:row.id,revision:row.revision})===key(relation.anchor));
  if(anchor?.type==='shot'&&anchor.passId===endpoint.row.id&&anchor.team===f.team&&q.timeTo===anchor.time&&q.timeToExclusive&&order==='desc'&&m==='passes'&&Object.keys(f).every(field=>['type','team'].includes(field))){
   const goal=canonicalOutcome(anchor)?.status==='goal';
   prefix=({en:goal?'Last pass before the goal':'Last pass before the shot',es:goal?'Último pase antes del gol':'Último pase antes del remate',fr:goal?'Dernière passe avant le but':'Dernière passe avant le tir',pt:goal?'Último passe antes do gol':'Último passe antes do remate'})[language];
  }
  add(`${prefix}: ${endpoint.text}`,[endpoint.ref,source.scopeReference],{kind:'ordered-event',order,metric:m,subjectId:subject,timeFrom:q.timeFrom,timeTo:q.timeTo,...windowFlags(q),query:q,scope:source.scopeReference,event:endpoint.proof,modelGenerated:false});
 }
 const requestedRefs=new Set((packet.requestedEvidence||[]).map(q=>key(q.scopeReference)));
 const rank=fact=>fact.proof.kind==='ordered-event'?0:['shooting-profile','confirmed-score'].includes(fact.proof.kind)?1:fact.claim.evidence.some(ref=>requestedRefs.has(key(ref)))?2:3;
 facts.sort((a,b)=>rank(a)-rank(b));
 // Bounded catalogs must retain the requested lookup, especially ordered
 // endpoints added after background summaries. IDs and proofs do not change.
 const scopes=new Set((packet.requestedEvidence||[]).map(source=>key(source.scopeReference)));
 const eventRefs=new Set((packet.requestedEvidence||[]).flatMap(source=>[...(source.rows||[]).map(row=>key({type:'event',id:row.id,revision:row.revision})),...(source.rowReferences||[]).map(key)]));
 const priority=fact=>['capability-limitation','linked-goal-sequence'].includes(fact.proof.kind)||fact.proof.kind==='ordered-event'&&scopes.has(key(fact.proof.scope))?0:
  fact.claim.evidence.some(ref=>scopes.has(key(ref))||eventRefs.has(key(ref)))?1:2;
 facts.sort((a,b)=>priority(a)-priority(b));
 const truncated=facts.length>128;
 return freeze({version,sourceFingerprint,facts:facts.slice(0,128),truncated});
}

export function selectQuestionFacts(manifest,ids){
 if(manifest?.version!==version||!Array.isArray(manifest.facts)||!Array.isArray(ids)||ids.length>8||new Set(ids).size!==ids.length||[...ids].some(id=>typeof id!=='string'))throw new RangeError('Select up to eight unique canonical fact IDs.');
 const selected=ids.map(id=>{const fact=manifest.facts.find(f=>f.id===id);if(!fact)throw new RangeError('Unknown canonical fact ID.');return fact;});
 // Only application-built exact composite operands dominate selected atoms.
 // This never chooses an unselected composite or compares natural-language text.
 const covers=(composite,atom)=>{
  const proof=composite.proof;
  if(proof?.kind==='count'&&proof.metric==='savedAttemptCollections'&&proof.value>0&&atom.proof?.kind==='count'&&atom.proof.metric==='ballWins'){
   const a=proof.query?.filters,b=atom.proof.query?.filters;
   return proof.modelGenerated===false&&atom.proof.modelGenerated===false&&proof.subjectId===atom.proof.subjectId&&proof.value===atom.proof.value&&sameWindow(proof,atom.proof)&&
    a?.type==='recovery'&&a.recoveryKind==='goalkeeper-hold'&&a.linkedShotOutcome==='saved'&&Object.keys(a).every(k=>['type','recoveryKind','linkedShotOutcome','team','player'].includes(k))&&
    b?.type==='recovery'&&b.recoveryClass==='ball-win'&&Object.keys(b).every(k=>['type','recoveryClass','team','player'].includes(k))&&recoveryClassification({type:'recovery',recoveryKind:'goalkeeper-hold'})==='ball-win';
  }
  if(proof?.kind==='ordered-event'&&proof.modelGenerated===false&&atom.proof?.kind==='event'&&proof.event?.modelGenerated===false){
   const base=structuredClone(atom.proof);delete base.attributes;
   const event=structuredClone(proof.event);delete event.attributes;
   return json(base)===json(event)&&(!atom.proof.attributes||Object.entries(atom.proof.attributes).every(([field,value])=>field==='bodyPart'&&proof.query?.filters?.bodyPart===value))&&atom.claim.evidence.every(ref=>composite.claim.evidence.some(other=>key(other)===key(ref)));
  }
  if(proof?.kind==='shooting-profile')return proof.modelGenerated===false&&atom.proof?.kind==='count'&&Array.isArray(proof.operands)&&proof.operands.length===2&&
   proof.operands.every((operand,index)=>operand.kind==='count'&&operand.metric===['attempts','shotsOnTarget'][index]&&operand.subjectId===proof.subjectId&&operand.modelGenerated===false&&sameWindow(operand,proof)&&Number.isSafeInteger(operand.value)&&operand.value>=0&&composite.claim.evidence.some(ref=>key(ref)===key(operand.scope)))&&
   proof.operands[1].value<=proof.operands[0].value&&proof.operands.some(operand=>json(operand)===json(atom.proof))&&atom.claim.evidence.every(ref=>composite.claim.evidence.some(other=>key(other)===key(ref)));
  if(proof?.kind!=='confirmed-score'||proof.home!==0||proof.away!==0||proof.modelGenerated!==false||
   !Array.isArray(proof.componentFactIds)||proof.componentFactIds.length!==2||new Set(proof.componentFactIds).size!==2||
   !Array.isArray(proof.operands)||proof.operands.length!==2||atom.proof?.kind!=='count')return false;
  const index=proof.componentFactIds.indexOf(atom.id);if(index<0)return false;
  return proof.operands.every((operand,i)=>operand.kind==='count'&&operand.metric==='goals'&&operand.value===0&&operand.subjectId===['home','away'][i]&&
   operand.modelGenerated===false&&sameWindow(operand,proof)&&composite.claim.evidence.some(ref=>key(ref)===key(operand.scope)))&&
   json(atom.proof)===json(proof.operands[index])&&atom.claim.evidence.every(ref=>composite.claim.evidence.some(other=>key(other)===key(ref)));
 };
 const covering=selected.map(atom=>selected.find(composite=>covers(composite,atom)));
 const retained=selected.filter((_fact,index)=>!covering[index]);
 const retainedIndex=new Map(retained.map((fact,index)=>[fact.id,index]));
 const originalToSelectedIndex=selected.map((fact,index)=>retainedIndex.get(covering[index]?.id??fact.id));
 const normalizations=selected.flatMap((fact,index)=>covering[index]?[{removedFactId:fact.id,coveredByFactId:covering[index].id,reason:'exact-composite-operand'}]:[]);
 return freeze({claims:structuredClone(retained.map(f=>f.claim)),proofs:structuredClone(retained.map(f=>({factId:f.id,...f.proof}))),selectedFactIds:retained.map(f=>f.id),requestedFactIds:[...ids],originalToSelectedIndex,normalizations,modelGenerated:false});
}
