import {momentHeadline} from './viewer-copy.js';
import {matchPicture} from './match-picture.js';
import {matchChange} from './match-change.js';
import {recoveryClassification} from './recovery-classification.js';

const copy={
 en:{title:'Why it matters',unavailable:'This moment is no longer available.',pending:'The shot outcome is still pending. The score cannot be updated from this attempt yet.',
  effects:{'took-lead':club=>`${club} take the lead`,'equalized':club=>`${club} draw level`,'extended-lead':club=>`${club} extend their lead`,'reduced-deficit':club=>`${club} narrow the gap`},
  score:(before,after)=>`The recorded score moves from ${before} to ${after}.`,level:score=>`The recorded score stays level at ${score}.`,lead:(club,n,score)=>`${club} keep a ${n===1?'one-goal':`${n}-goal`} lead at ${score}.`,
  missLevel:score=>`A chance to draw level ends without a goal. The recorded score stays ${score}.`,missLead:score=>`A chance to take the lead ends without a goal. The recorded score stays ${score}.`,
  noGoal:'This attempt adds no goal. Its outcome does not tell us who controls the next ball.',
  recovery:p=>`${p} wins the ball`,pass:p=>`${p} completes a pass`,buildup:(p,n,s)=>`After ${p} won the ball, ${n===1?'one completed pass':`${n} completed passes`} came before this shot, ${s} seconds later.`,
  direct:(p,s)=>`${p} won the ball ${s} seconds before this shot.`,received:(p,s)=>`The shooter received ${p}'s pass ${s} seconds before taking this shot.`,pattern:'The shot pattern has changed',scope:'Recorded score within this synthetic segment.',limitation:'Received events establish what happened and in what order. They do not establish tactical intent or why a defender left space.'},
 es:{title:'Por qué importa',unavailable:'Este momento ya no está disponible.',pending:'El resultado del tiro sigue pendiente. Este intento todavía no permite actualizar el marcador.',
  effects:{'took-lead':club=>`${club} se adelanta`,'equalized':club=>`${club} empata`,'extended-lead':club=>`${club} amplía su ventaja`,'reduced-deficit':club=>`${club} recorta distancias`},
  score:(before,after)=>`El marcador registrado pasa de ${before} a ${after}.`,level:score=>`El marcador registrado sigue empatado a ${score}.`,lead:(club,n,score)=>`${club} conserva una ventaja de ${n} ${n===1?'gol':'goles'}: ${score}.`,
  missLevel:score=>`La ocasión de empatar termina sin gol. El marcador registrado sigue ${score}.`,missLead:score=>`La ocasión de adelantarse termina sin gol. El marcador registrado sigue ${score}.`,
  noGoal:'Este intento no suma un gol. Su resultado no indica quién controla el siguiente balón.',
  recovery:p=>`${p} recupera el balón`,pass:p=>`${p} completa un pase`,buildup:(p,n,s)=>`Tras la recuperación de ${p}, hubo ${n} ${n===1?'pase completado':'pases completados'} antes de este tiro, ${s} segundos después.`,
  direct:(p,s)=>`${p} recuperó el balón ${s} segundos antes de este tiro.`,received:(p,s)=>`El autor del tiro recibió el pase de ${p} ${s} segundos antes de rematar.`,pattern:'Ha cambiado el patrón de tiros',scope:'Marcador registrado dentro de este segmento sintético.',limitation:'Los eventos recibidos establecen qué ocurrió y en qué orden, no la intención táctica ni por qué un defensor dejó espacio.'},
 fr:{title:'Pourquoi cela compte',unavailable:'Cet instant n’est plus disponible.',pending:'Le résultat du tir est encore en attente. Cette tentative ne permet pas encore de mettre le score à jour.',
  effects:{'took-lead':club=>`${club} prend l’avantage`,'equalized':club=>`${club} égalise`,'extended-lead':club=>`${club} creuse l’écart`,'reduced-deficit':club=>`${club} réduit l’écart`},
  score:(before,after)=>`Le score enregistré passe de ${before} à ${after}.`,level:score=>`Le score enregistré reste à égalité : ${score}.`,lead:(club,n,score)=>`${club} conserve ${n} ${n===1?'but':'buts'} d’avance : ${score}.`,
  missLevel:score=>`L’occasion d’égaliser se termine sans but. Le score enregistré reste ${score}.`,missLead:score=>`L’occasion de prendre l’avantage se termine sans but. Le score enregistré reste ${score}.`,
  noGoal:'Cette tentative n’ajoute aucun but. Son résultat ne dit pas qui contrôle le ballon ensuite.',
  recovery:p=>`${p} récupère le ballon`,pass:p=>`${p} réussit une passe`,buildup:(p,n,s)=>`Après la récupération de ${p}, ${n} ${n===1?'passe réussie a précédé':'passes réussies ont précédé'} ce tir, ${s} secondes plus tard.`,
  direct:(p,s)=>`${p} a récupéré le ballon ${s} secondes avant ce tir.`,received:(p,s)=>`Le tireur a reçu la passe de ${p} ${s} secondes avant de tirer.`,pattern:'Le rythme des tirs a changé',scope:'Score enregistré dans cette séquence synthétique.',limitation:'Les événements reçus établissent ce qui s’est passé et dans quel ordre, pas l’intention tactique ni pourquoi un défenseur a laissé de l’espace.'},
 pt:{title:'Porque importa',unavailable:'Este momento já não está disponível.',pending:'O resultado do remate ainda está pendente. Esta tentativa ainda não permite atualizar o marcador.',
  effects:{'took-lead':club=>`${club} passa para a frente`,'equalized':club=>`${club} empata`,'extended-lead':club=>`${club} aumenta a vantagem`,'reduced-deficit':club=>`${club} reduz a diferença`},
  score:(before,after)=>`O marcador registado passa de ${before} para ${after}.`,level:score=>`O marcador registado continua empatado: ${score}.`,lead:(club,n,score)=>`${club} mantém ${n} ${n===1?'golo':'golos'} de vantagem: ${score}.`,
  missLevel:score=>`A oportunidade de empatar termina sem golo. O marcador registado continua ${score}.`,missLead:score=>`A oportunidade de passar para a frente termina sem golo. O marcador registado continua ${score}.`,
  noGoal:'Esta tentativa não soma um golo. O resultado não indica quem controla a bola a seguir.',
  recovery:p=>`${p} recupera a bola`,pass:p=>`${p} completa um passe`,buildup:(p,n,s)=>`Após a recuperação de ${p}, houve ${n} ${n===1?'passe completo':'passes completos'} antes deste remate, ${s} segundos depois.`,
  direct:(p,s)=>`${p} recuperou a bola ${s} segundos antes deste remate.`,received:(p,s)=>`O autor do remate recebeu o passe de ${p} ${s} segundos antes de rematar.`,pattern:'O padrão de remates mudou',scope:'Marcador registado neste segmento sintético.',limitation:'Os eventos recebidos estabelecem o que aconteceu e em que ordem, não a intenção tática nem porque um defesa deixou espaço.'}
};
const ref=e=>({type:'event',id:e.id,revision:e.revision});
const unique=rows=>[...new Map(rows.map(row=>[`${row.id}@${row.revision}`,ref(row)])).values()];
const scoreText=score=>`${score.home}–${score.away}`;

/** A concise fan-facing consequence plus optional possession-to-shot sequence.
 * Pass the complete received event inventory, not a 15-second explanation slice.
 * `observedAt` is the receipt horizon; all consequences stop at the anchor time.
 * A corrected event is folded BEFORE chronological filtering. Rendering clients
 * must render these strings as text, never unsanitized HTML.
 */
export function momentMeaning(records,anchorId,{observedAt,language='en'}={}){
 const lang=Object.hasOwn(copy,language)?language:'en',c=copy[lang];
 const picture=matchPicture(records,observedAt,{language:lang});
 const inventory=new Map(records.filter(event=>event.arrivedAt<=observedAt&&event.time<=observedAt).map(event=>[`${event.id}@${event.revision}`,event]));
 const active=picture.evidence.map(r=>inventory.get(`${r.id}@${r.revision}`));
 const anchor=active.find(e=>e.id===anchorId);
 const empty={status:'unavailable',kind:null,headline:c.unavailable,title:c.title,why:null,buildup:null,steps:[],evidence:[],score:null,
  scope:{anchorId,eventTime:null,observedAt,scoreLabel:c.scope},language:lang,corrected:false,limitation:c.limitation};
 if(!anchor)return empty;
 const received=active.filter(e=>e.time<=anchor.time).sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));
 const goals=received.filter(e=>e.type==='shot'&&e.result===true);
 const score={home:goals.filter(e=>e.team==='home').length,away:goals.filter(e=>e.team==='away').length};
 const teams=Object.fromEntries(picture.teams.map(team=>[team.id,team.name]));
 const output={...empty,status:'context',headline:momentHeadline(anchor,lang),scope:{...empty.scope,eventTime:anchor.time},score,
  evidence:[ref(anchor)]};
 const supports=[anchor];
 if(anchor.type==='recovery'){
  const recoveryContext={
   en:club=>`${club} have won possession back. Follow the next pass to see how the move develops.`,
   es:club=>`${club} ha recuperado la posesión. Sigue el siguiente pase para ver cómo se desarrolla la jugada.`,
   fr:club=>`${club} a récupéré la possession. Suivez la prochaine passe pour voir la suite du mouvement.`,
   pt:club=>`${club} recuperou a posse. Acompanha o próximo passe para seguir o desenvolvimento da jogada.`
  };
  const initialControl={en:club=>`${club} start with the ball.`,es:club=>`${club} empieza con el balón.`,fr:club=>`${club} commence avec le ballon.`,pt:club=>`${club} começa com a bola.`};
  const classification=recoveryClassification(anchor);
  if(classification!=='unknown')output.context=(classification==='initial-control'?initialControl[lang]:recoveryContext[lang])(teams[anchor.team]);
 }
 const ambiguousScore=received.some(e=>e.type==='shot'&&typeof e.result!=='boolean'||e.id!==anchor.id&&e.time===anchor.time&&e.type==='shot');
 if(anchor.type==='shot'){
  if(typeof anchor.result!=='boolean'){
   output.kind='pending-outcome';output.why=c.pending;
  }else if(anchor.result===true&&!ambiguousScore){
   const before={...score,[anchor.team]:score[anchor.team]-1},opponent=anchor.team==='home'?'away':'home';
   const own=before[anchor.team],other=before[opponent];
   const effect=own===other?'took-lead':own===other-1?'equalized':own>other?'extended-lead':'reduced-deficit';
   output.kind=effect;output.title=c.effects[effect](teams[anchor.team]);output.why=c.score(scoreText(before),scoreText(score));
   output.score={...score,before,effect};supports.push(...goals);
  }else if(anchor.result===false){
   output.kind='no-goal';output.why=c.noGoal;
   if(!ambiguousScore){
    const opponent=anchor.team==='home'?'away':'home',difference=score[anchor.team]-score[opponent],text=scoreText(score);
    output.why=difference===-1?c.missLevel(text):difference===0?c.missLead(text):c.lead(teams[score.home>score.away?'home':'away'],Math.abs(difference),text);
    supports.push(...goals);
   }
  }
  const before=received.filter(e=>e.time>=anchor.time-15&&e.time<anchor.time);
  const recoveries=before.filter(e=>recoveryClassification(e)==='ball-win'&&e.team===anchor.team),recovery=recoveries.at(-1);
  // Any opposing ball involvement or ambiguous recovery boundary breaks the
  // proposed sequence. A failed/pending pass cannot establish continued control.
  const passage=recovery?received.filter(e=>e.time>=recovery.time&&e.time<=anchor.time):[];
  const linked=recovery&&recoveries.filter(e=>e.time===recovery.time).length===1&&
   !passage.some(e=>e.team!==anchor.team||e.type==='pass'&&e.result!==true||e.type==='shot'&&e.id!==anchor.id);
  if(linked){
   const passes=passage.filter(e=>e.type==='pass'&&e.time>recovery.time&&e.time<anchor.time);
   const seconds=Math.round((anchor.time-recovery.time)*10)/10;
   output.buildup=passes.length?c.buildup(recovery.player||teams[recovery.team],passes.length,seconds):c.direct(recovery.player||teams[recovery.team],seconds);
   output.steps=[recovery,...passes,anchor].map(e=>({id:e.id,revision:e.revision,time:e.time,type:e.type,text:momentHeadline(e,lang)}));
   supports.push(...passage);
  }else if(typeof anchor.playerId==='string'&&anchor.playerId){
   const receptions=before.filter(e=>e.type==='receive'&&e.team===anchor.team&&e.playerId===anchor.playerId);
   const reception=receptions.at(-1);
   const passes=reception?before.filter(e=>e.type==='pass'&&e.team===anchor.team&&e.result===true&&e.receiverId===anchor.playerId&&e.time<reception.time):[];
   const pass=passes.at(-1);
   const path=pass?received.filter(e=>e.time>=pass.time&&e.time<=anchor.time):[];
   const directPass=pass&&receptions.filter(e=>e.time===reception.time).length===1&&passes.filter(e=>e.time===pass.time).length===1&&
    !path.some(e=>e.team!==anchor.team||e.id!==anchor.id&&e.type==='shot'||e.time>reception.time&&e.id!==anchor.id&&e.type!=='flight'||
     e.type==='pass'&&e.id!==pass.id||e.type==='receive'&&e.id!==reception.id||e.type==='recovery');
   if(directPass){
    output.buildup=c.received(pass.player||teams[pass.team],Math.round((anchor.time-reception.time)*10)/10);
    output.steps=[pass,reception,anchor].map(e=>({id:e.id,revision:e.revision,time:e.time,type:e.type,text:momentHeadline(e,lang)}));
    supports.push(...path);
   }
  }
 }
 if(!output.why){
  const change=matchChange(records,anchor.time,{language:lang,observedAt});
  if(change.status==='insight'){
   output.kind='shot-pattern';output.title=c.pattern;output.why=change.text;
   supports.push(...received.filter(e=>change.evidence.some(r=>r.id===e.id&&r.revision===e.revision)));
  }
 }
 output.status=output.why?'insight':'context';
 output.evidence=unique(supports);
 // A normal pending-to-confirmed update is not described as a correction.
 // With only a current inventory, there is no historical basis for this label.
 output.corrected=supports.some(current=>records.some(previous=>{
  if(previous.id!==current.id||previous.revision>=current.revision||previous.arrivedAt>observedAt)return false;
  return ['team','player','time','type'].some(key=>previous[key]!==current[key])||
   typeof previous.result==='boolean'&&previous.result!==current.result||
   ['saved','blocked','off-target','on-target'].includes(previous.outcome)&&previous.outcome!==current.outcome;
 }));
 return output;
}
