import {snapshot,explainMoment,teams,duration} from './engine.js';
import {languagePreference,recapSummary,localizedMoment} from './localization.js';
import {isSafePlayerName} from './viewer-preferences.js';
import {recoveryClassification} from './recovery-classification.js';

const ref=e=>({id:e.id,revision:e.revision});
const key=refs=>refs.map(e=>`${e.id}@${e.revision}`).join('|');
const unique=refs=>[...new Map(refs.map(e=>[e.id,e])).values()];
const clock=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
const detailCopy={
 en:{recovery:(p,s)=>`${p} won the ball ${s} seconds before the shot.`,passes:(club,n,start,end)=>`${club}: ${n} completed ${n===1?'pass':'passes'} in the 15-second window (${start}–${end}).`,favorite:'This moment involves your chosen club or player.'},
 es:{recovery:(p,s)=>`${p} recuperó el balón ${s} segundos antes del remate.`,passes:(club,n,start,end)=>`${club}: ${n} ${n===1?'pase completado':'pases completados'} en la ventana de 15 segundos (${start}–${end}).`,favorite:'Este momento incluye a tu club o jugador elegido.'},
 fr:{recovery:(p,s)=>`${p} a récupéré le ballon ${s} secondes avant le tir.`,passes:(club,n,start,end)=>`${club} : ${n} passe${n===1?' réussie':'s réussies'} dans la fenêtre de 15 secondes (${start}–${end}).`,favorite:'Ce moment concerne votre club ou joueur choisi.'},
 pt:{recovery:(p,s)=>`${p} recuperou a bola ${s} segundos antes do remate.`,passes:(club,n,start,end)=>`${club}: ${n} passe${n===1?' completo':'s completos'} na janela de 15 segundos (${start}–${end}).`,favorite:'Este momento envolve o clube ou jogador que escolheu.'}
};

const collectionCopy={
 en:(p,s)=>`${p} collected the ball ${s} seconds before the shot.`,
 es:(p,s)=>`${p} recogió el balón ${s} segundos antes del remate.`,
 fr:(p,s)=>`${p} a capté le ballon ${s} secondes avant le tir.`,
 pt:(p,s)=>`${p} recolheu a bola ${s} segundos antes do remate.`
};
const initialControlCopy={
 en:(p,s)=>`${p} had control of the ball ${s} seconds before the shot.`,
 es:(p,s)=>`${p} tenía el control del balón ${s} segundos antes del remate.`,
 fr:(p,s)=>`${p} contrôlait le ballon ${s} secondes avant le tir.`,
 pt:(p,s)=>`${p} tinha o controlo da bola ${s} segundos antes do remate.`
};

export function narrativePreferences(input={}){
 const {audience='newcomer',favoriteClub=null,favoritePlayer=null,limit=5,language='en'}=input;
 languagePreference(language);
 if(!['newcomer','analyst','player'].includes(audience)||!Number.isInteger(limit)||limit<1||limit>10||
    (favoriteClub!==null&&!Object.hasOwn(teams,favoriteClub))||
    (favoritePlayer!==null&&!isSafePlayerName(favoritePlayer)))
  throw new RangeError('Choose a valid audience, favorite club/player and recap limit from 1 to 10.');
 return {audience,favoriteClub,favoritePlayer,limit,language};
}

export function selectNarratives(state,input={},selection={}){
 const teams=state.metadata?.teams||{home:state.events.find(e=>e.team==='home')?.teamName||'Northbridge',away:state.events.find(e=>e.team==='away')?.teamName||'Harbour Athletic'};
 const preferences=narrativePreferences(input);
 if(!selection||typeof selection!=='object'||Array.isArray(selection)||Object.keys(selection).some(key=>key!=='anchorId')||selection.anchorId!==undefined&&(typeof selection.anchorId!=='string'||!selection.anchorId))throw new RangeError('Choose a received story anchor.');
 const candidates=state.events.filter(e=>e.type==='shot'&&(selection.anchorId===undefined||e.id===selection.anchorId)).map(anchor=>{
  const explanation=explainMoment(state,anchor.id);
  const sequence=explanation.sequence;
  const recoveries=sequence.filter(e=>e.team===anchor.team&&e.type==='recovery'&&e.time<anchor.time).sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));
  const recovery=recoveries.at(-1);
  const linked=recovery&&recoveries.filter(e=>e.time===recovery.time).length===1&&
   !sequence.some(e=>e.team!==anchor.team&&e.type==='recovery'&&e.time>=recovery.time&&e.time<=anchor.time);
  const goals=state.events.filter(e=>e.type==='shot'&&e.result===true&&e.time<=anchor.time);
  const score=Object.fromEntries(Object.keys(teams).map(team=>[team,goals.filter(e=>e.team===team).length]));
  const favorite=anchor.team===preferences.favoriteClub||anchor.player===preferences.favoritePlayer;
  const rank=(anchor.result===true?100:30)+(linked?10:0)+(favorite?15:0);
  const evidence=unique([...explanation.evidence,...goals.map(ref)]);
  const own=sequence.filter(e=>e.team===anchor.team),completed=own.filter(e=>e.type==='pass'&&e.result===true).length;
  const c=detailCopy[preferences.language],details=[];
  if(linked){
   // Keep the shared ball-win metric unchanged. A keeper hold is best
   // described as a collection, and initial control is never a ball win.
   const kind=recoveryClassification(recovery),render=recovery.recoveryKind==='goalkeeper-hold'||kind==='unknown'?collectionCopy[preferences.language]:kind==='initial-control'?initialControlCopy[preferences.language]:c.recovery;
   details.push(render(recovery.player,anchor.time-recovery.time));
  }
  if(preferences.audience==='analyst')details.push(c.passes(teams[anchor.team],completed,clock(Math.max(0,anchor.time-15)),clock(anchor.time)));
  if(preferences.audience==='player'&&favorite)details.push(c.favorite);
  const text=localizedMoment(preferences.language,anchor,teams[anchor.team],score,preferences.audience,details.join(' '));
  return {id:`narrative-${anchor.id}`,anchorId:anchor.id,time:anchor.time,rank,
   selectionReason:anchor.result===true?'goal':linked?'shot after a recorded recovery':'shot',
   preferenceMatch:favorite,title:anchor.result===true?'Goal':'Shot opportunity',text,evidence,
   key:JSON.stringify(preferences)+'|'+key(evidence),limit:explanation.limit,
   timing:{eventTime:anchor.time,availableAt:Math.max(...sequence.map(e=>e.arrivedAt)),expiresAt:anchor.time+20}};
 });
 // A ranking policy for this prototype, not a learned measure of football importance.
 return candidates.sort((a,b)=>b.rank-a.rank||b.time-a.time||a.id.localeCompare(b.id)).slice(0,preferences.limit);
}

export function matchRecap(time,input={},messages){
 if(!Number.isFinite(time)||time<0||time>duration)throw new RangeError('Choose a replay time from 0 to 360 seconds.');
 const preferences=narrativePreferences(input),state=snapshot(time,messages);
 return recapFromState(state,preferences);
}

export function recapFromState(state,input={},metadata={segmentDuration:duration,observationHorizon:duration}){
 const teams=metadata.teams||state.metadata?.teams||{home:'Northbridge',away:'Harbour Athletic'};
 const time=state.time,preferences=narrativePreferences(input);
 const entries=selectNarratives(state,preferences).sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));
 const evidence=state.events.map(ref);
 const score=Object.fromEntries(Object.keys(teams).map(team=>[team,state.events.filter(e=>e.team===team&&e.type==='shot'&&e.result===true).length]));
 return {source:'local-template',time,status:time>=metadata.segmentDuration?'demo-segment-complete':'in-progress',preferences,
  key:JSON.stringify(preferences)+'|'+key(evidence),score,stats:state.stats,evidence,
  summary:state.events.length?recapSummary(preferences.language,teams.home,teams.away,score.home,score.away,state.stats.home.shots+state.stats.away.shots):'No match events have arrived.',
  entries,overlays:entries.filter(e=>e.time<=time&&e.timing.expiresAt>time).map(e=>({
   schemaVersion:1,id:e.id,key:e.key,anchorId:e.anchorId,title:e.title,text:e.text,evidence:e.evidence,
   timing:e.timing,audience:preferences.audience,review:'Deterministic template; not an AI-generated broadcast.'})),
  limitation:'A six-minute fictional segment, not a full-match recap. Selection weights and the 20-second overlay duration are prototype policies. Recorded sequences do not establish causation.'};
}

export function recapChanges(previous,current){
 const oldEntries=new Map((previous?.entries||[]).map(e=>[e.id,e]));
 const nextEntries=new Map(current.entries.map(e=>[e.id,e]));
 return {summaryChanged:previous?.key!==current.key,
  upserts:current.entries.filter(e=>oldEntries.get(e.id)?.key!==e.key),
  withdrawals:[...oldEntries.keys()].filter(id=>!nextEntries.has(id))};
}
