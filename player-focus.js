import {languagePreference} from './localization.js';
import {momentHeadline} from './viewer-copy.js';
import {recoveryClassification} from './recovery-classification.js';
import {isSafePlayerName} from './viewer-preferences.js';

const ref=event=>({type:'event',id:event.id,revision:event.revision});
const unique=refs=>[...new Map(refs.map(r=>[`${r.type}:${r.id}@${r.revision}`,r])).values()];
const order=(a,b)=>a.time-b.time||a.id.localeCompare(b.id);
const clock=value=>Number.isInteger(value)?`${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`:`${value}s`;
const text={
 en:{waiting:name=>`Waiting for a recorded action from ${name}.`,ambiguous:name=>`${name} matches more than one received player; tracking is unavailable.`,
  summary:(name,count,start,end)=>`${name}: ${count} recorded ${count===1?'action':'actions'} in the ${clock(start)}–${clock(end)} window.`,
  last:'Last recorded action',none:'No recorded action in this window.',
  pass:{complete:'completed a pass',failed:'made an unsuccessful pass',pending:'passed; outcome pending'},
  recovery:'won possession',receive:'received the ball',other:'recorded an action',
  limitation:'Synthetic received-event profile. Counts describe supplied actor actions, not all involvement or feed completeness. Position is one received sample, never an interpolated current location. No intent, tactical cause or peak speed is inferred.'},
 es:{waiting:name=>`Esperando una acción registrada de ${name}.`,ambiguous:name=>`${name} coincide con más de un jugador en los datos recibidos; el seguimiento no está disponible.`,
  summary:(name,count,start,end)=>`${name}: ${count} ${count===1?'acción registrada':'acciones registradas'} en la ventana de ${clock(start)} a ${clock(end)}.`,
  last:'Última acción registrada',none:'No hay acciones registradas en esta ventana.',
  pass:{complete:'completó un pase',failed:'dio un pase fallido',pending:'dio un pase; resultado pendiente'},
  recovery:'recuperó la posesión',receive:'recibió el balón',other:'registró una acción',
  limitation:'Perfil de eventos sintéticos recibidos. Los recuentos describen acciones del jugador registradas, no toda su participación ni datos completos. La posición es una muestra recibida, nunca una ubicación actual interpolada. No se infieren intención, causa táctica ni velocidad máxima.'},
 fr:{waiting:name=>`En attente d’une action enregistrée de ${name}.`,ambiguous:name=>`${name} correspond à plusieurs joueurs dans les données reçues ; le suivi est indisponible.`,
  summary:(name,count,start,end)=>`${name} : ${count} ${count===1?'action enregistrée':'actions enregistrées'} dans la fenêtre de ${clock(start)} à ${clock(end)}.`,
  last:'Dernière action enregistrée',none:'Aucune action enregistrée dans cette fenêtre.',
  pass:{complete:'a réussi une passe',failed:'a manqué une passe',pending:'a fait une passe ; résultat en attente'},
  recovery:'a récupéré la possession',receive:'a reçu le ballon',other:'a enregistré une action',
  limitation:'Profil d’événements synthétiques reçus. Les comptes décrivent les actions enregistrées du joueur, pas toute sa participation ni des données complètes. La position est un échantillon reçu, jamais une position actuelle interpolée. Aucune intention, cause tactique ou vitesse maximale n’est déduite.'},
 pt:{waiting:name=>`À espera de uma ação registada de ${name}.`,ambiguous:name=>`${name} corresponde a mais de um jogador nos dados recebidos; o acompanhamento está indisponível.`,
  summary:(name,count,start,end)=>`${name}: ${count} ${count===1?'ação registada':'ações registadas'} na janela dos ${clock(start)} aos ${clock(end)}.`,
  last:'Última ação registada',none:'Não há ações registadas nesta janela.',
  pass:{complete:'completou um passe',failed:'fez um passe falhado',pending:'fez um passe; resultado pendente'},
  recovery:'recuperou a posse',receive:'recebeu a bola',other:'registou uma ação',
  limitation:'Perfil de eventos sintéticos recebidos. As contagens descrevem ações registadas do jogador, não toda a sua participação nem dados completos. A posição é uma amostra recebida, nunca uma localização atual interpolada. Não se inferem intenção, causa tática ou velocidade máxima.'}
};

const unavailable={en:name=>`${name} is unavailable in the received roster.`,es:name=>`${name} no está disponible en la plantilla recibida.`,fr:name=>`${name} est indisponible dans l’effectif reçu.`,pt:name=>`${name} não está disponível no elenco recebido.`};
const conflicting={en:name=>`Received identity data for ${name} conflict; tracking is unavailable.`,es:name=>`Los datos recibidos de identidad de ${name} son contradictorios; el seguimiento no está disponible.`,fr:name=>`Les données d’identité reçues pour ${name} se contredisent ; le suivi est indisponible.`,pt:name=>`Os dados de identidade recebidos de ${name} são contraditórios; o acompanhamento está indisponível.`};
const unknownRecovery={en:'has a recovery record with an unknown classification',es:'tiene un registro de recuperación sin clasificación conocida',fr:'a un événement de récupération de catégorie inconnue',pt:'tem um registro de recuperação com classificação desconhecida'};
const validFrame=(frame,time)=>frame&&frame.operation!=='delete'&&typeof frame.id==='string'&&frame.id&&Number.isInteger(frame.revision)&&frame.revision>0&&
 Number.isFinite(frame.time)&&frame.time>=0&&frame.time<=time&&Number.isFinite(frame.arrivedAt)&&frame.arrivedAt>=frame.time&&frame.arrivedAt<=time&&Array.isArray(frame.players)&&frame.players.length<=100;
/** Pure player-follow view. The caller supplies its current received frame.
 * A named frame roster can establish identity, not any actions. Historical
 * events and a position sample remain separate, independently cited evidence.
 */
export function playerFocus(records,time,{favoritePlayer,language='en',windowSeconds=60}={},frame){
 if(favoritePlayer===undefined||favoritePlayer===null||(typeof favoritePlayer==='string'&&!favoritePlayer.trim()))return null;
 if(!isSafePlayerName(favoritePlayer))throw new RangeError('Choose a bounded player display name.');
 if(!Number.isFinite(time)||time<0||!Number.isFinite(windowSeconds)||windowSeconds<=0||windowSeconds>3600)
  throw new RangeError('Choose a received time and a positive player window up to 3600 seconds.');
 languagePreference(language);
 if(!records||typeof records[Symbol.iterator]!=='function')throw new TypeError('Provide an iterable of received events.');
 const active=new Map(),revisions=new Map();let supplied=0;
 for(const event of records){
  if(++supplied>10000)throw new RangeError('Player focus exceeds 10000 supplied event records.');
  if(!event||typeof event.id!=='string'||!event.id||!Number.isInteger(event.revision)||event.revision<1||
     !Number.isFinite(event.time)||event.time<0||!Number.isFinite(event.arrivedAt)||event.arrivedAt<event.time||
     ![undefined,'upsert','delete'].includes(event.operation)||
     (event.operation!=='delete'&&(typeof event.type!=='string'||!event.type||typeof event.playerId!=='string'||!event.playerId||!['home','away'].includes(event.team))))
   throw new TypeError('Invalid received event revision.');
  if(event.time>time||event.arrivedAt>time)continue;
  const revisionKey=`${event.id}@${event.revision}`;
  const fingerprint=JSON.stringify([event.time,event.arrivedAt,event.type,event.playerId,event.player,event.team,event.result,event.outcome,event.recoveryKind,event.operation||'upsert']);
  if(revisions.has(revisionKey)&&revisions.get(revisionKey)!==fingerprint)throw new TypeError('Conflicting received records share an event revision.');
  revisions.set(revisionKey,fingerprint);
  if(!active.has(event.id)||active.get(event.id).revision<event.revision)active.set(event.id,event);
 }
 const events=[...active.values()].filter(e=>e.operation!=='delete').sort(order);
 const matching=events.filter(e=>e.player===favoritePlayer&&typeof e.playerId==='string'&&e.playerId&&['home','away'].includes(e.team));
 const identities=new Map(matching.map(e=>[`${e.playerId}:${e.team}`,{playerId:e.playerId,team:e.team}]));
 const receivedFrame=validFrame(frame,time),hasNamedRoster=receivedFrame&&frame.players.some(p=>p?.name!==undefined);
 const validRoster=hasNamedRoster&&frame.players.length>0&&frame.players.every(p=>p&&typeof p.id==='string'&&p.id.length>0&&p.id.length<=100&&isSafePlayerName(p.name)&&['home','away'].includes(p.team))&&new Set(frame.players.map(p=>p.id)).size===frame.players.length;
 const rosterMatches=validRoster?frame.players.filter(p=>p.name===favoritePlayer):[];
 for(const p of rosterMatches)identities.set(`${p.id}:${p.team}`,{playerId:p.id,team:p.team});
 const identityFrameEvidence=validRoster?[{type:'frame',id:frame.id,revision:frame.revision}]:[];
 let identityProblem=hasNamedRoster&&!validRoster?'conflicting-identity':validRoster&&!rosterMatches.length?'not-in-received-roster':null;
 for(const identity of identities.values()){
  if(events.some(e=>e.playerId===identity.playerId&&(e.team!==identity.team||typeof e.player==='string'&&e.player!==favoritePlayer)))identityProblem='conflicting-identity';
  if(validRoster&&frame.players.some(p=>p.id===identity.playerId&&(p.team!==identity.team||p.name!==favoritePlayer)))identityProblem='conflicting-identity';
 }
 const start=Math.max(0,time-windowSeconds),window={start,end:time,requestedSeconds:windowSeconds,inclusive:true};
 const copy=text[language],identityEvidence=unique([...matching.map(ref),...identityFrameEvidence]);
 const base={source:'received-player-profile',synthetic:true,favoritePlayer,language,time,window,identityEvidence,
  limitation:copy.limitation,translationReview:'Template translations have not been verified by native speakers.'};
 if(identities.size!==1||identityProblem)return {...base,status:'unknown',reason:identityProblem||(identities.size?'ambiguous-identity':'not-yet-observed'),
  playerId:null,team:null,counts:null,countsEvidence:null,lastAction:null,sample:null,
  summary:identityProblem==='not-in-received-roster'?unavailable[language](favoritePlayer):identityProblem==='conflicting-identity'?conflicting[language](favoritePlayer):identities.size?copy.ambiguous(favoritePlayer):copy.waiting(favoritePlayer),evidence:identityEvidence,
  key:JSON.stringify({favoritePlayer,language,time,windowSeconds,identityProblem})+'|unknown|'+identityEvidence.map(r=>`${r.type}:${r.id}@${r.revision}`).join('|')};
 const {playerId,team}=identities.values().next().value;
 const actions=events.filter(e=>e.playerId===playerId&&e.team===team&&e.time>=start&&e.type!=='flight');
 const groups={actions,shots:actions.filter(e=>e.type==='shot'),goals:actions.filter(e=>e.type==='shot'&&e.result===true),
  completedPasses:actions.filter(e=>e.type==='pass'&&e.result===true),recoveries:actions.filter(e=>recoveryClassification(e)==='ball-win'),receives:actions.filter(e=>e.type==='receive')};
 const unknownRecoveries=actions.filter(e=>recoveryClassification(e)==='unknown');if(unknownRecoveries.length)groups.recoveriesUnknown=unknownRecoveries;
 const initialControls=actions.filter(e=>recoveryClassification(e)==='initial-control');if(initialControls.length)groups.initialControls=initialControls;
 const counts=Object.fromEntries(Object.entries(groups).map(([key,events])=>[key,events.length]));
 const countsEvidence=Object.fromEntries(Object.entries(groups).map(([key,events])=>[key,events.map(ref)]));
 const last=actions.at(-1);let lastAction=null;
 if(last){
  const outcome=last.type==='shot'?(last.result===true?'goal':last.result===false?'no-goal':'pending'):
   last.type==='pass'?(last.result===true?'completed':last.result===false?'failed':'pending'):null;
  const action=last.type==='pass'?copy.pass[last.result===true?'complete':last.result===false?'failed':'pending']:copy[last.type]||copy.other;
  lastAction={id:last.id,anchorId:last.id,revision:last.revision,time:last.time,arrivedAt:last.arrivedAt,type:last.type,outcome,
   text:['shot','recovery'].includes(last.type)?last.type==='recovery'&&recoveryClassification(last)==='unknown'?`${favoritePlayer} ${unknownRecovery[language]}`:momentHeadline({...last,player:favoritePlayer},language):`${favoritePlayer} ${action}`,evidence:[ref(last)],
   ...(last.type==='recovery'?{recoveryClass:recoveryClassification(last)}:{})};
 }
 let sample=null;
 if(receivedFrame){
  const candidates=frame.players.filter(p=>p?.id===playerId&&p.team===team&&(p.name===undefined||p.name===favoritePlayer)&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=105&&p.y>=0&&p.y<=68);
  if(candidates.length===1){const player=candidates[0];sample={playerId,team,x:player.x,y:player.y,unit:'metres',time:frame.time,
   arrivedAt:frame.arrivedAt,ageSeconds:time-frame.time,frameRef:{type:'frame',id:frame.id,revision:frame.revision},
   phase:frame.phase??null,description:'Exact received sample; not an interpolated current position.'};}
 }
 const evidence=unique([...identityEvidence,...countsEvidence.actions,...(sample?[sample.frameRef]:[])]);
 return {...base,status:'known',reason:null,playerId,team,counts,countsEvidence,lastAction,sample,
  activitySummary:copy.summary(favoritePlayer,counts.actions,start,time),
  summary:`${copy.summary(favoritePlayer,counts.actions,start,time)} ${lastAction?`${copy.last}: ${lastAction.text} (${clock(lastAction.time)}).`:copy.none}`,
  evidence,key:JSON.stringify({favoritePlayer,language,time,windowSeconds,playerId,team})+'|'+evidence.map(r=>`${r.type}:${r.id}@${r.revision}`).join('|')};
}
