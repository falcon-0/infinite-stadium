export const duration = 360;
export const teams = { home: 'Northbridge', away: 'Harbour Athletic' };
export const players = { home: ['M. Vale', 'A. Reed', 'J. Cole'], away: ['S. Noor', 'L. Park', 'D. Silva'] };
// Fictional six-minute demonstration segment. Coordinates describe event locations,
// not player tracking. Northbridge attack toward x=100, Harbour toward x=0.
const script = [
  [8,'home','pass',0,48,48,61,35,true],
  [19,'home','pass',1,61,35,72,60,true],
  [32,'home','pass',2,72,60,83,44,false],
  [35,'away','recovery',0,83,44],
  [49,'away','pass',0,83,44,57,63,true],
  [63,'away','pass',1,57,63,30,50,true],
  [76,'away','shot',2,24,52,0,47,false],
  [95,'home','pass',0,30,45,60,32,true],
  [108,'home','pass',1,60,32,76,45,false],
  [111,'away','recovery',1,76,45],
  [120,'away','pass',1,76,45,82,55,false],
  [124,'home','recovery',1,82,55],
  [130,'home','shot',1,84,53,100,56,false],
  [155,'away','pass',0,88,37,71,45,false],
  [160,'home','recovery',2,71,45],
  [165,'home','pass',2,71,45,84,51,true],
  [169,'home','shot',1,84,51,100,50,true],
  [195,'away','pass',0,50,50,68,25,true],
  [208,'away','pass',1,68,25,78,38,false],
  [211,'home','recovery',0,78,38],
  [224,'home','pass',0,78,38,60,55,true],
  [250,'away','recovery',2,57,61],
  [262,'away','pass',2,57,61,39,42,true],
  [284,'away','shot',0,20,43,0,50,true],
  [312,'home','pass',0,50,50,68,30,true],
  [336,'home','shot',2,79,32,100,40,false]
];
export const events = script.map(([time,team,type,p,x,y,endX=x,endY=y,result=false],i) =>
  Object.freeze({ id:`EV-${String(i+1).padStart(3,'0')}`,time,team,type,player:players[team][p],x,y,endX,endY,result }));
// Application input is an observed message stream. Arrival time and event time
// differ. Replays fold received revisions instead of reading final corrected facts.
export const feed = Object.freeze([
  ...events.map(e => Object.freeze({ ...e, revision:1, arrivedAt:e.id==='EV-015'?164:e.time, operation:'upsert' })),
  Object.freeze({ ...events.find(e=>e.id==='EV-017'), player:'J. Cole', revision:2, arrivedAt:190, operation:'upsert', reason:'Provider corrects the scorer from A. Reed to J. Cole.' })
]);
export function snapshot(time, messages=feed) {
  if(!Number.isFinite(time)||time<0) throw new RangeError('Replay time must be a nonnegative finite number.');
  const received=messages.filter(e=>e.arrivedAt<=time&&e.time<=time);
  const active=new Map();
  for(const e of received){
    const previous=active.get(e.id);
    if(!previous||e.revision>previous.revision) active.set(e.id,e);
  }
  const visible=[...active.values()].filter(e=>e.operation!=='delete').sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));
  const stats = Object.fromEntries(Object.keys(teams).map(team => {
    const own = visible.filter(e => e.team === team);
    return [team, { goals:own.filter(e=>e.type==='shot'&&e.result).length, shots:own.filter(e=>e.type==='shot').length,
      passes:own.filter(e=>e.type==='pass').length, completed:own.filter(e=>e.type==='pass'&&e.result).length,
      recoveries:own.filter(e=>e.type==='recovery').length }];
  }));
  const updates=[...active.values()].filter(e=>e.revision>1).sort((a,b)=>a.arrivedAt-b.arrivedAt);
  return { time, events:visible, stats, updates };
}
export function describe(e) {
  if(e.type==='shot') return `${e.player} ${e.result===true?'scores':e.result===false?'shoots without scoring':'shoots; outcome pending'}`;
  if(e.type==='recovery') return e.recoveryKind==='segment-start'?`${e.player} starts with the ball`:`${e.player} wins possession`;
  if(e.type==='receive') return `${e.player} receives the ball`;
  if(e.type==='flight') return `${e.player}: recorded shot-flight sample`;
  if(e.result===null) return `${e.player}: pass outcome pending`;
  return `${e.player}: ${e.result?'completed':'unsuccessful'} pass`;
}
export function stories(state, selectedPlayer) {
  const e = state.events.at(-1);
  if(!e) return [];
  const side = teams[e.team], s = state.stats[e.team];
  const playerEvents = state.events.filter(x=>x.player===selectedPlayer);
  const evidence = playerEvents.map(x=>x.id);
  const recent = state.events.filter(x=>x.team==='home'&&x.type==='recovery'&&x.x>=66.67&&x.time>=state.time-120);
  const linked = recent.map(r=>({r, shot:state.events.find(x=>x.time>r.time&&x.time<=r.time+10&&x.type==='shot'&&x.team===r.team&& !state.events.some(y=>y.team!==r.team&&y.type==='recovery'&&y.time>r.time&&y.time<x.time))})).filter(x=>x.shot);
  const tactical = recent.length>=2 ? {
    text:`Northbridge have ${recent.length} attacking-third recoveries in the last two minutes; ${linked.length} were followed by a shot within ten seconds. This shows where their recent chances started, but does not establish a tactical cause.`,
    evidence:[...new Set([...recent.map(x=>x.id),...linked.map(x=>x.shot.id)])]
  } : {text:`${side}: ${s.shots} shots and ${s.completed}/${s.passes} completed passes in this demo so far. Latest event at (${e.x}, ${e.y}) on the normalized pitch.`,evidence:state.events.filter(x=>x.team===e.team&&['shot','pass'].includes(x.type)).map(x=>x.id)};
  return [
    {mode:'The newcomer',title:e.type==='shot'&&e.result?'A breakthrough!':'Follow the action',text:`${describe(e)} for ${side}. ${e.type==='recovery'?'Winning possession gives the team a chance to start an attack.':e.type==='pass'?'A completed pass keeps the ball moving between teammates.':`The score is now ${state.stats.home.goals}–${state.stats.away.goals}.`}`,evidence:[e.id]},
    {mode:'The analyst',title:recent.length>=2?'Where the chances begin':'The numbers behind the moment',...tactical},
    {mode:'The player follower',title:selectedPlayer,text:playerEvents.length?`${selectedPlayer} has ${playerEvents.filter(x=>x.type==='shot').length} shots, ${playerEvents.filter(x=>x.type==='pass'&&x.result).length} completed passes, and ${playerEvents.filter(x=>x.type==='recovery').length} recoveries. Latest involvement: ${describe(playerEvents.at(-1))}.`:`No recorded involvement for ${selectedPlayer} yet.`,evidence}
  ];
}

export function explainMoment(state, anchorId) {
  const anchor=state.events.find(e=>e.id===anchorId);
  if(!anchor) return null;
  const sequence=state.events.filter(e=>e.time>=anchor.time-15&&e.time<=anchor.time);
  const own=sequence.filter(e=>e.team===anchor.team);
  const recoveries=own.filter(e=>e.type==='recovery'&&e.time<anchor.time).sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));
  const recovery=recoveries.at(-1);
  const ambiguous=recovery&&recoveries.filter(e=>e.time===recovery.time).length>1;
  const interrupted=recovery&&sequence.some(e=>e.time>=recovery.time&&e.time<=anchor.time&&e.team!==anchor.team&&e.type==='recovery');
  const linked=recovery&&!ambiguous&&!interrupted&&anchor.type==='shot';
  const evidence=sequence.map(e=>({id:e.id,revision:e.revision}));
  const key=evidence.map(e=>`${e.id}@${e.revision}`).join('|');
  return {
    anchorId, key, evidence, sequence, title:anchor.type==='shot'?(anchor.result?'How this goal developed':'How this shot developed'):'Explain this passage',
    text:linked?`${anchor.teamName||teams[anchor.team]} recovered possession ${anchor.time-recovery.time} seconds before ${anchor.player}'s ${anchor.result?'goal':'shot'}. ${own.filter(e=>e.time>recovery.time&&e.time<anchor.time&&e.type==='pass'&&e.result===true).length} completed passes are recorded between the recovery and shot.`:`${describe(anchor)}. The ${sequence.length} received events in the preceding 15-second window are shown below.`,
    limit:'These are recorded event locations. Continuous movement, player intent and off-ball positioning are unavailable; this sequence cannot establish why a defender left space.',
    recap:`${anchor.teamName||teams[anchor.team]}: ${describe(anchor)} at ${Math.floor(anchor.time/60)}:${String(anchor.time%60).padStart(2,'0')}.`,
    updated:sequence.some(e=>e.revision>1)
  };
}

export function validateExplanation(explanation,state){
  if(!explanation)return {valid:false,reason:'No explanation selected.'};
  const current=explainMoment(state,explanation.anchorId);
  if(!current)return {valid:false,reason:'The selected event is not available in this replay state.'};
  // Recompute the entire bounded query, so a late insertion also invalidates it.
  return current.key===explanation.key?{valid:true,reason:'All event references match received revisions.'}:{valid:false,reason:'Evidence changed: regenerate this explanation and its recap.'};
}
