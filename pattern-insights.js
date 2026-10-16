const ref=event=>({type:'event',id:event.id,revision:event.revision});
const unique=refs=>[...new Map(refs.map(r=>[`${r.type}:${r.id}`,r])).values()];
const order=(a,b)=>a.time-b.time||a.id.localeCompare(b.id);

// Counts and temporal associations over supplied received records. This does
// not infer tactical pressure, intention, causation, or event completeness.
export function matchPatterns(records,observedAt,options={}){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['windowSeconds','anchorTime'].includes(k)))throw new RangeError('Unsupported pattern options.');
 const {windowSeconds=120,anchorTime=observedAt}=options;
 if(!Number.isFinite(observedAt)||observedAt<0||!Number.isFinite(anchorTime)||anchorTime<0||anchorTime>observedAt||!Number.isFinite(windowSeconds)||windowSeconds<=0||windowSeconds>3600)throw new RangeError('Choose a nonnegative received horizon, an observed anchor and a window up to 3600 seconds.');
 if(!records?.[Symbol.iterator])throw new TypeError('Supply iterable event records.');
 const active=new Map();
 for(const event of records){
  if(!event||typeof event.id!=='string'||!event.id||!Number.isInteger(event.revision)||event.revision<1||!Number.isFinite(event.time)||event.time<0||!Number.isFinite(event.arrivedAt)||event.arrivedAt<event.time||!['home','away'].includes(event.team)||typeof event.type!=='string'||!event.type||![undefined,'upsert','delete'].includes(event.operation))throw new RangeError('Invalid received event record.');
  if(['pass','shot'].includes(event.type)&&![undefined,null,true,false].includes(event.result))throw new RangeError('Pass and shot outcomes must be boolean or unknown.');
  if(event.arrivedAt>observedAt)continue;
  const previous=active.get(event.id);
  if(!previous||event.revision>previous.revision)active.set(event.id,event);
  else if(event.revision===previous.revision&&JSON.stringify([event.time,event.arrivedAt,event.team,event.type,event.result,event.operation||'upsert'])!==JSON.stringify([previous.time,previous.arrivedAt,previous.team,previous.type,previous.result,previous.operation||'upsert']))throw new RangeError('Conflicting records share an event revision.');
 }
 const start=Math.max(0,anchorTime-windowSeconds);
 const events=[...active.values()].filter(e=>e.operation!=='delete'&&e.time>=start&&e.time<=anchorTime).sort(order);
 const teams={},metrics=[],patterns=[];
 for(const team of ['home','away']){
  const own=events.filter(e=>e.team===team);
  const groups={shots:own.filter(e=>e.type==='shot'),completedPasses:own.filter(e=>e.type==='pass'&&e.result===true),pendingPasses:own.filter(e=>e.type==='pass'&&(e.result===null||e.result===undefined)),recoveries:own.filter(e=>e.type==='recovery')};
  teams[team]=Object.fromEntries(Object.entries(groups).map(([kind,inputs])=>[kind,inputs.length]));
  for(const [kind,inputs] of Object.entries(groups))metrics.push({kind,team,value:inputs.length,unit:'events',evidence:inputs.map(ref),window:{start,end:anchorTime},definition:'Count of supplied received event revisions inside the inclusive event-time window.'});
  for(const shot of groups.shots){
   const recovery=groups.recoveries.filter(e=>e.time<shot.time).at(-1);
   if(!recovery||shot.time-recovery.time>10)continue;
   if(groups.recoveries.filter(e=>e.time===recovery.time).length>1)continue;
   // Equal timestamps cannot establish order. Opposing recoveries at either
   // boundary therefore prevent a claimed uninterrupted association.
   if(events.some(e=>e.type==='recovery'&&e.team!==team&&e.time>=recovery.time&&e.time<=shot.time))continue;
   const passes=groups.completedPasses.filter(e=>e.time>recovery.time&&e.time<shot.time);
   const evidence=[ref(recovery),...passes.map(ref),ref(shot)];
   patterns.push({kind:'recovery-before-shot',team,anchorId:shot.id,recoveryId:recovery.id,seconds:shot.time-recovery.time,completedPasses:passes.length,evidence,
    text:`${team==='home'?'Home':'Away'} recorded a shot ${shot.time-recovery.time} seconds after its latest recorded recovery, with ${passes.length} completed ${passes.length===1?'pass':'passes'} strictly between those event times. This is a recorded sequence, not an explanation of why the shot occurred.`});
  }
 }
 patterns.sort((a,b)=>events.find(e=>e.id===a.anchorId).time-events.find(e=>e.id===b.anchorId).time||a.anchorId.localeCompare(b.anchorId));
 return {observedAt,anchorTime,window:{start,end:anchorTime,requestedSeconds:windowSeconds,inclusive:true,truncatedAtStart:anchorTime<windowSeconds},teams,metrics,patterns,evidence:unique([...metrics.flatMap(m=>m.evidence),...patterns.flatMap(p=>p.evidence)]),limit:'Synthetic event-window analysis. Counts describe supplied received records and do not establish feed completeness. Events outside the window are excluded, so a recovery before the window cannot support a sequence. Timestamp ties do not establish ordering. Temporal association is not tactical pressure, intent, causation, or expected goals.'};
}
