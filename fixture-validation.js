// Own synthetic-feed contract, not a StatsBomb/Metrica schema adapter.
// Metrica documents synchronized events/tracks and a normalized coordinate
// scale: https://github.com/metrica-sports/sample-data . Our event scale is
// 0..100; tracks are metres. StatsBomb's Ball Receipt can be an intended
// location, so a receipt must not universally be treated as actual control:
// https://github.com/hudl/open-data/blob/master/doc/StatsBomb%20Open%20Data%20Specification%20v1.1.pdf
// Here an authored receive explicitly means successful reception. All speed
// thresholds below are configurable prototype heuristics, not FIFA limits.
// The ten-second reception-link window is an authored-scene policy, not a
// universal limit on real passes. Out-of-play balls and substitutions would
// require an expanded contract; this fixture has neither.
const finite=n=>Number.isFinite(n);
const inside=(value,max)=>finite(value)&&value>=0&&value<=max;
const side=t=>['home','away'].includes(t);
const ref=(record,type)=>({type,id:record.id,revision:record.revision});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);

/** Audit complete raw synthetic fixtures; do not pass a pruned live snapshot.
 * Structural checks cover the supplied feed; semantic checks use only revisions
 * received at observedAt. Hard contract errors are separate from rate warnings.
 */
export function validateFixture(feed,{observedAt,pitch={length:105,width:68},tolerance=1e-6,
 playerRateWarning=12,ballRateWarning=50,sampleIntervalWarning=2}={}){
 if(!feed||!Array.isArray(feed.events)||!Array.isArray(feed.frames))throw new TypeError('Provide complete event and frame arrays.');
 if(!inside(tolerance,1)||!finite(pitch.length)||pitch.length<=0||!finite(pitch.width)||pitch.width<=0||
    [playerRateWarning,ballRateWarning,sampleIntervalWarning].some(n=>n!==null&&(!finite(n)||n<=0)))throw new RangeError('Choose positive pitch dimensions and positive warning thresholds, or null to disable a heuristic.');
 if(observedAt===undefined)observedAt=Math.max(0,...[...feed.events,...feed.frames].flatMap(r=>[r?.time,r?.arrivedAt]).filter(finite));
 if(!finite(observedAt)||observedAt<0)throw new RangeError('Choose a finite nonnegative observation time.');
 const errors=[],warnings=[],add=(list,code,message,record,type,extra={})=>list.push({code,message,...(record?{reference:ref(record,type)}:{}),...extra});
 const valid={event:[],frame:[]};let roster=null;
 for(const [type,records] of [['event',feed.events],['frame',feed.frames]]){
  const revisions=new Map();
  for(const record of records){
   if(!record||typeof record.id!=='string'||!record.id||!Number.isSafeInteger(record.revision)||record.revision<1||
      !finite(record.time)||record.time<0||!finite(record.arrivedAt)||record.arrivedAt<record.time||
      ![undefined,'upsert','delete'].includes(record.operation)){
    add(errors,'record-schema','A record needs an ID, positive revision and arrival time no earlier than event time.',record,type);continue;
   }
   const key=`${record.id}@${record.revision}`;
   const content=stable(type==='frame'&&Array.isArray(record.players)?{...record,players:[...record.players].sort((a,b)=>String(a?.id).localeCompare(String(b?.id)))}:record);
   if(revisions.has(key)&&revisions.get(key)!==content)add(errors,'revision-conflict','Different payloads share an ID and revision.',record,type);
   revisions.set(key,content);
   if(record.operation!=='delete'){
    if(type==='event'){
     if(!side(record.team)||typeof record.playerId!=='string'||!record.playerId||typeof record.type!=='string'||!record.type||
        !inside(record.x,100)||!inside(record.y,100)||(['pass','shot'].includes(record.type)&&![null,true,false].includes(record.result)))
      add(errors,'event-schema','Actor, team, normalized location or explicit action outcome is invalid.',record,type);
     if(record.type==='pass'&&(record.result===null?(record.endX!==null||record.endY!==null):(!inside(record.endX,100)||!inside(record.endY,100))))
      add(errors,'pass-endpoint-schema','Pending actual pass endpoints must be null; confirmed endpoints must be normalized coordinates.',record,type);
    }else{
     if(!Array.isArray(record.players)||record.players.length!==22||record.players.some(p=>!p||typeof p.id!=='string'||!p.id||
         !side(p.team)||!Number.isInteger(p.number)||p.number<1||p.number>11||!inside(p.x,pitch.length)||!inside(p.y,pitch.width))||
         new Set(record.players?.map(p=>p?.id)).size!==22||['home','away'].some(team=>record.players?.filter(p=>p?.team===team).length!==11)){
      add(errors,'frame-roster','Each synthetic sample must contain 22 unique bounded players, eleven per team.',record,type);continue;
     }
     const identity=record.players.map(p=>`${p.id}:${p.team}:${p.number}`).sort().join('|');
     if(roster===null)roster=identity;
     else if(identity!==roster)add(errors,'roster-changed','Player IDs, team identities or shirt numbers changed between samples.',record,type);
     if(new Set(record.players.map(p=>`${p.team}:${p.number}`)).size!==22)add(errors,'shirt-number-conflict','A team has duplicate shirt numbers.',record,type);
     if(!record.ball||!inside(record.ball.x,pitch.length)||!inside(record.ball.y,pitch.width))
      add(errors,'ball-bounds','This bounded synthetic scene needs a finite ball sample inside its pitch.',record,type);
    }
   }
   valid[type].push(record);
  }
 }
 const fold=records=>{
  const map=new Map();
  for(const r of records)if(r.time<=observedAt&&r.arrivedAt<=observedAt&&(!map.has(r.id)||map.get(r.id).revision<r.revision))map.set(r.id,r);
  return [...map.values()].filter(r=>r.operation!=='delete').sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));
 };
 const events=fold(valid.event),frames=fold(valid.frame),byTime=new Map();
 for(const frame of frames){
  if(byTime.has(frame.time))add(errors,'sample-time-conflict','Two active frames describe the same sample time.',frame,'frame');
  byTime.set(frame.time,frame);
 }
 for(const event of events){
  const frame=byTime.get(event.time),actor=frame?.players?.find(p=>p.id===event.playerId);
  if(!frame){add(errors,'missing-event-sample','An event has no exact received positional sample.',event,'event');continue;}
  if(!actor||actor.team!==event.team){add(errors,'event-actor','The event actor is absent or belongs to the other team in its sample.',event,'event');continue;}
  if(distance({x:event.x/100*pitch.length,y:event.y/100*pitch.width},actor)>tolerance)
   add(errors,'event-location','Normalized event location does not match its received actor sample.',event,'event');
  if(['recovery','pass','receive','shot'].includes(event.type)&&frame.ball&&distance(frame.ball,actor)>tolerance)
   add(errors,'ball-custody','This authored on-ball action does not coincide with its actor and ball sample.',event,'event');
  if(event.type==='receive'&&!events.some(pass=>pass.type==='pass'&&pass.team===event.team&&pass.receiverId===event.playerId&&
    pass.result!==false&&pass.time<event.time&&event.time-pass.time<=10))
   add(errors,'orphan-reception','An authored successful reception has no preceding teammate pass in its scene window.',event,'event');
  if(event.type==='pass'){
   const intended=frame.players.find(p=>p.id===event.receiverId);
   if(!intended||intended.team!==event.team)add(errors,'pass-receiver','The intended pass receiver must be a known teammate.',event,'event');
   if(event.result===null)continue;
   const endpoints=events.filter(e=>e.time>event.time&&(event.result===true?e.type==='receive'&&e.playerId===event.receiverId&&e.team===event.team:
    e.type==='recovery'&&e.passId===event.id&&e.team!==event.team));
   const availableEndpoints=endpoints.filter(e=>e.time<=event.arrivedAt);
   const endpoint=availableEndpoints[0];
   if(!endpoint){add(errors,'pass-outcome-link','A confirmed pass lacks its authored reception or opponent interception.',event,'event');continue;}
   if(availableEndpoints.length>1)add(errors,'ambiguous-pass-ending','A confirmed pass links to multiple authored ending events.',event,'event');
   const endFrame=byTime.get(endpoint.time);
   if(endFrame?.ball&&distance({x:event.endX/100*pitch.length,y:event.endY/100*pitch.width},endFrame.ball)>tolerance)
    add(errors,'pass-endpoint','Confirmed pass endpoint does not match the received ending sample.',event,'event');
   if(event.arrivedAt<endpoint.arrivedAt)add(errors,'pass-confirmed-too-early','Pass confirmation predates reception/interception arrival.',event,'event');
  }
 }
 let rateIntervalsChecked=0,rateIntervalsSkipped=0,maxPlayerSampleRate=0,maxBallSampleRate=0;
 for(let i=1;i<frames.length;i++){
  const previous=frames[i-1],frame=frames[i];
  if(previous.phase==='reset'||frame.phase==='reset'){rateIntervalsSkipped++;continue;}
  const dt=frame.time-previous.time;if(dt<=0)continue;rateIntervalsChecked++;
  if(sampleIntervalWarning!==null&&dt>sampleIntervalWarning)add(warnings,'sample-gap','A sampling gap limits displacement interpretation.',frame,'frame',{interval:{start:previous.time,end:frame.time}});
  for(const player of frame.players){
   const before=previous.players.find(p=>p.id===player.id);if(!before)continue;
   const value=distance(player,before)/dt;maxPlayerSampleRate=Math.max(maxPlayerSampleRate,value);
   if(playerRateWarning!==null&&value>playerRateWarning)add(warnings,'player-sample-rate','Sample displacement rate exceeds the configured heuristic.',frame,'frame',{playerId:player.id,value,unit:'metres/second',interval:{start:previous.time,end:frame.time}});
  }
  if(previous.ball&&frame.ball&&[previous.ball.x,previous.ball.y,frame.ball.x,frame.ball.y].every(finite)){const value=distance(frame.ball,previous.ball)/dt;maxBallSampleRate=Math.max(maxBallSampleRate,value);
   if(ballRateWarning!==null&&value>ballRateWarning)add(warnings,'ball-sample-rate','Ball sample displacement rate exceeds the configured heuristic.',frame,'frame',{value,unit:'metres/second',interval:{start:previous.time,end:frame.time}});
  }
 }
 return {valid:errors.length===0,observedAt,pitch:{...pitch},errors,warnings,
  thresholds:{playerRateWarning,ballRateWarning,sampleIntervalWarning},
  stats:{receivedEvents:events.length,receivedFrames:frames.length,rateIntervalsChecked,rateIntervalsSkipped,maxPlayerSampleRate,maxBallSampleRate},
  limitation:'Checks the internal contract of scripted synthetic scenes, not real-match physics, feed completeness, tactical causation, offside, possession intent, peak speed or FIFA certification. Rates are endpoint displacement divided by sample interval. Reset transitions are excluded; warning thresholds are prototype policies.'};
}
