// Presentation of received facts only. These summaries never infer tactical causes.
import {recoveryClassification} from './recovery-classification.js';
const copy={
 en:{player:'A player',missing:'Select a recorded moment to explore it.',
  goal:p=>`${p} scores`,shot:p=>`${p} shoots but does not score`,pendingShot:p=>`${p} shoots; outcome pending`,
  shotOutcomes:{'off-target':p=>`${p} shoots off target`,saved:p=>`${p} has a shot saved`,blocked:p=>`${p} has a shot blocked`,'on-target':p=>`${p} shoots on target`},
  pass:p=>`${p} completes a pass`,failedPass:p=>`${p}'s pass is unsuccessful`,pendingPass:p=>`${p} plays a pass; outcome pending`,
  initialControl:p=>`${p} starts with the ball`,receive:p=>`${p} receives the ball`,recovery:p=>`${p} wins the ball`,flight:p=>`${p}: recorded shot-flight sample`,other:p=>`${p}: recorded involvement`,
  window:n=>`${n} recorded event${n===1?'':'s'} in the 15 seconds up to this moment.`,
  recoveryBefore:(p,s)=>`${p} recovered the ball ${s} seconds before this shot.`,
  passes:(n,linked)=>`${n} completed pass${n===1?'':'es'} ${linked?'between that recovery and the shot':'in the preceding 15 seconds'}.`,
  nearest:n=>`Nearest opponent at the sampled moment: ${n} m away.`},
 es:{player:'Un jugador',missing:'Selecciona un momento registrado para explorarlo.',
  goal:p=>`${p} marca`,shot:p=>`${p} remata sin marcar`,pendingShot:p=>`${p} remata; resultado pendiente`,
  shotOutcomes:{'off-target':p=>`${p} no encuentra portería`,saved:p=>`El remate de ${p} es detenido`,blocked:p=>`El remate de ${p} es bloqueado`,'on-target':p=>`${p} remata a puerta`},
  pass:p=>`${p} completa un pase`,failedPass:p=>`El pase de ${p} no se completa`,pendingPass:p=>`${p} da un pase; resultado pendiente`,
  initialControl:p=>`${p} empieza con el balón`,receive:p=>`${p} recibe el balón`,recovery:p=>`${p} recupera el balón`,flight:p=>`${p}: muestra registrada del balón tras el remate`,other:p=>`${p}: participación registrada`,
  window:n=>`${n} evento${n===1?' registrado':'s registrados'} en los 15 segundos hasta este momento.`,
  recoveryBefore:(p,s)=>`${p} recuperó el balón ${s} segundos antes de este remate.`,
  passes:(n,linked)=>`${n} ${n===1?'pase completado':'pases completados'} ${linked?'entre esa recuperación y el remate':'en los 15 segundos anteriores'}.`,
  nearest:n=>`En ese momento, el rival más cercano en la muestra de posiciones recibida estaba a ${n} m.`},
 fr:{player:'Un joueur',missing:'Sélectionnez un moment enregistré pour le découvrir.',
  goal:p=>`${p} marque`,shot:p=>`${p} tire sans marquer`,pendingShot:p=>`${p} tire ; résultat en attente`,
  shotOutcomes:{'off-target':p=>`${p} ne cadre pas son tir`,saved:p=>`Le tir de ${p} est arrêté`,blocked:p=>`Le tir de ${p} est contré`,'on-target':p=>`${p} cadre son tir`},
  pass:p=>`${p} réussit une passe`,failedPass:p=>`La passe de ${p} est manquée`,pendingPass:p=>`${p} fait une passe ; résultat en attente`,
  initialControl:p=>`${p} commence avec le ballon`,receive:p=>`${p} reçoit le ballon`,recovery:p=>`${p} récupère le ballon`,flight:p=>`${p} : échantillon enregistré du ballon après le tir`,other:p=>`${p} : participation enregistrée`,
  window:n=>`${n} événement${n===1?' enregistré':'s enregistrés'} dans les 15 secondes jusqu’à cet instant.`,
  recoveryBefore:(p,s)=>`${p} a récupéré le ballon ${s} secondes avant ce tir.`,
  passes:(n,linked)=>`${n} passe${n===1?' réussie':'s réussies'} ${linked?'entre cette récupération et le tir':'dans les 15 secondes précédentes'}.`,
  nearest:n=>`À cet instant, l’adversaire le plus proche dans l’échantillon de positions reçu se trouvait à ${n} m.`},
 pt:{player:'Um jogador',missing:'Selecione um momento registado para o explorar.',
  goal:p=>`${p} marca`,shot:p=>`${p} remata sem marcar`,pendingShot:p=>`${p} remata; resultado pendente`,
  shotOutcomes:{'off-target':p=>`${p} remata sem acertar na baliza`,saved:p=>`O remate de ${p} é defendido`,blocked:p=>`O remate de ${p} é bloqueado`,'on-target':p=>`${p} remata à baliza`},
  pass:p=>`${p} completa um passe`,failedPass:p=>`O passe de ${p} não é completado`,pendingPass:p=>`${p} faz um passe; resultado pendente`,
  initialControl:p=>`${p} começa com a bola`,receive:p=>`${p} recebe a bola`,recovery:p=>`${p} recupera a bola`,flight:p=>`${p}: amostra registada da bola após o remate`,other:p=>`${p}: participação registada`,
  window:n=>`${n} evento${n===1?' registado':'s registados'} nos 15 segundos até este momento.`,
  recoveryBefore:(p,s)=>`${p} recuperou a bola ${s} segundos antes deste remate.`,
  passes:(n,linked)=>`${n} passe${n===1?' completado':'s completados'} ${linked?'entre essa recuperação e o remate':'nos 15 segundos anteriores'}.`,
  nearest:n=>`Nesse momento, o adversário mais próximo na amostra de posições recebida estava a ${n} m.`}
};
const languageCopy=language=>copy[language]||copy.en;

export function momentHeadline(event,language='en'){
 const c=languageCopy(language);
 if(!event)return c.missing;
 const p=event.player||c.player;
 if(event.type==='recovery'&&event.recoveryKind==='segment-start')return c.initialControl(p);
 if(event.type==='recovery'&&recoveryClassification(event)!=='ball-win')return c.other(p);
 if(event.type==='shot')return (event.result===true?c.goal:event.result===false?(Object.hasOwn(c.shotOutcomes,event.outcome)?c.shotOutcomes[event.outcome]:c.shot):c.pendingShot)(p);
 if(event.type==='pass')return (event.result===true?c.pass:event.result===false?c.failedPass:c.pendingPass)(p);
 return (c[event.type]||c.other)(p);
}

export function momentSummary(explanation,language='en',audience='newcomer'){
 const c=languageCopy(language),current=new Map();
 for(const event of explanation?.sequence||[]){
  const previous=current.get(event.id);
  if(!previous||(event.revision??1)>(previous.revision??1))current.set(event.id,event);
 }
 const anchor=current.get(explanation?.anchorId);
 if(!anchor||anchor.operation==='delete')return c.missing;
 const sequence=[...current.values()].filter(e=>e.operation!=='delete'&&Number.isFinite(e.time)&&e.time>=anchor.time-15&&e.time<=anchor.time)
  .sort((a,b)=>a.time-b.time||String(a.id).localeCompare(String(b.id)));
 const parts=[`${momentHeadline(anchor,language)}.`];
 if(anchor.type==='shot'){
  const prior=sequence.filter(e=>e.time<anchor.time),own=prior.filter(e=>e.team===anchor.team);
  const recoveries=own.filter(e=>recoveryClassification(e)==='ball-win'),recovery=recoveries.at(-1);
  const linked=Boolean(recovery&&recoveries.filter(e=>e.time===recovery.time).length===1&&
   !sequence.some(e=>e.type==='recovery'&&e.team!==anchor.team&&e.time>=recovery.time&&e.time<=anchor.time));
  if(linked)parts.push(c.recoveryBefore(recovery.player||c.player,anchor.time-recovery.time));
  const passes=own.filter(e=>e.type==='pass'&&e.result===true&&(!linked||(e.time>recovery.time&&e.time<anchor.time)));
  if(passes.length)parts.push(c.passes(passes.length,linked));
  if(!linked&&!passes.length)parts.push(c.window(sequence.length));
 }else parts.push(c.window(sequence.length));
 if(audience==='analyst'){
  const nearest=explanation.metrics?.find(m=>m.kind==='nearest-opponent'&&m.unit==='metres'&&Number.isFinite(m.value)&&m.value>=0&&(!m.anchorId||m.anchorId===anchor.id));
  if(nearest)parts.push(c.nearest(nearest.value.toFixed(1)));
 }
 return parts.join(' ');
}


// Current action at display time, using only revisions received by that time.
export function livePlayHeadline(records,time,{language='en',players=[],ballState=null}={}){
 const canonical=new Map();
 for(const e of records){if(e.time>time||e.arrivedAt>time)continue;const old=canonical.get(e.id);if(!old||e.revision>old.revision)canonical.set(e.id,e);}
 const events=[...canonical.values()].filter(e=>e.operation!=='delete'&&e.type!=='flight');
 const latest=events.sort((a,b)=>Math.max(a.time,a.arrivedAt)-Math.max(b.time,b.arrivedAt)||a.time-b.time||a.id.localeCompare(b.id)).at(-1);
 if(!latest)return null;
 let shown=latest;
 // Shot outcome appears only after the authored ball flight endpoint arrives.
 if(latest.type==='shot'&&time<latest.time+1)shown={...latest,result:null};
 let title=momentHeadline(shown,language);
 if(latest.type==='pass'&&latest.result===null){
  const receiver=players.find(p=>p.id===latest.receiverId);
  if(receiver){
   const verbs={en:{short:'plays a short pass to',long:'plays a long ball to',cross:'crosses towards',trivela:'plays a trivela pass to'},es:{short:'da un pase corto a',long:'da un pase largo a',cross:'centra hacia',trivela:'pasa con el exterior a'},fr:{short:'fait une passe courte a',long:'joue long vers',cross:'centre vers',trivela:'passe de l exterieur a'},pt:{short:'faz um passe curto para',long:'faz um passe longo para',cross:'cruza para',trivela:'faz um passe de trivela para'}};
   const key=latest.technique==='trivela'?'trivela':latest.passType,verb=(verbs[language]||verbs.en)[key];
   const patterns={en:`${latest.player} passes to ${receiver.name}`,es:`${latest.player} pasa a ${receiver.name}`,fr:`${latest.player} passe a ${receiver.name}`,pt:`${latest.player} passa para ${receiver.name}`};title=verb?`${latest.player} ${verb} ${receiver.name}`:patterns[language]||patterns.en;
  }
 }
 if(ballState?.kind==='dead-ball-collection'){
  const text={en:'The goalkeeper prepares the goal kick',es:'El portero prepara el saque de meta',fr:'Le gardien prepare le renvoi',pt:'O guarda-redes prepara o pontape de baliza'};title=text[language]||text.en;
 }else if(ballState?.kind==='dead-ball'&&latest.type==='shot'&&latest.result!==true&&time>=latest.time+3){
  const text={en:'The ball is out of play',es:'El balon esta fuera de juego',fr:'Le ballon est sorti',pt:'A bola saiu'};title=text[language]||text.en;
 }else if(ballState?.kind==='control'&&time-Math.max(latest.time,latest.arrivedAt)>2){
  const owner=players.find(p=>p.id===ballState.ownerId);
  if(owner){const text={en:`${owner.name} has the ball`,es:`${owner.name} tiene el balon`,fr:`${owner.name} a le ballon`,pt:`${owner.name} tem a bola`};title=text[language]||text.en;}
 }
 return {title,time:Math.max(latest.time,latest.arrivedAt),id:latest.id,revision:latest.revision};
}
