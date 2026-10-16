// Independent, seeded positional fixtures. These are scripted scenes, not a physics simulator.
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function random(seed){let n=seed>>>0;return ()=>{n=(1664525*n+1013904223)>>>0;return n/4294967296;};}
export function createScenario(kind='central',seed=17){
 if(!['central','wide'].includes(kind)||!Number.isInteger(seed))throw new RangeError('Choose a scenario and integer seed.');
 const rand=random(seed),wide=kind==='wide',runnerY=wide?11:34;
 const formations={home:[[6,34],[35,10],[37,26],[37,42],[35,58],[55,20],[56,34],[55,48],[73,12],[73,34],[73,56]],away:[[101,34],[85,13],[87,27],[87,41],[85,55],[71,19],[72,34],[71,49],[52,14],[54,34],[52,54]]};
 const roster=Object.entries(formations).flatMap(([team,positions])=>positions.map(([x,y],i)=>({id:`${team}-${i+1}`,team,number:i+1,x:clamp(x+(i?rand()*2-1:0),0,105),y:clamp(y+(i?rand()*2-1:0),0,68)})));
 const start=roster.find(p=>p.id==='home-10');start.x=72;start.y=runnerY;
 const passer=roster.find(p=>p.id==='home-7');passer.x=64;passer.y=34;
 const frames=Array.from({length:9},(_,time)=>{
  const players=roster.map(p=>{
   if(p.id==='home-10')return {...p,x:72+time*1.7,y:runnerY};
   if(p.id==='home-7')return {...p,x:64+time*.5};
   if(p.team==='away'&&p.number>=2&&p.number<=5)return {...p,x:p.x-time*.35,y:p.y+(runnerY-p.y)*time*.025};
   return {...p,x:clamp(p.x+(p.number===1?0:time*(p.team==='home'?.2:-.15)),0,105)};
  });
  // Ball is carried, passed at t=2, received at t=4, then carried to the shot at t=8.
  const from=players.find(p=>p.id==='home-7'),to=players.find(p=>p.id==='home-10');
  const ratio=clamp((time-2)/2,0,1);
  const ball={x:from.x+(to.x-from.x)*ratio,y:from.y+(to.y-from.y)*ratio};
  return {id:`${kind}-${seed}-frame-${time}`,time,arrivedAt:time,revision:1,players,ball};
 });
 return {id:`${kind}-${seed}`,kind,seed,title:wide?'Wide receiving run':'Central receiving run',duration:8,frames,
  events:[{id:`${kind}-${seed}-pass`,time:2,arrivedAt:2,type:'pass',playerId:'home-7',receiverId:'home-10',revision:1},{id:`${kind}-${seed}-receive`,time:4,arrivedAt:4,type:'receive',playerId:'home-10',revision:1},{id:`${kind}-${seed}-shot`,time:8,arrivedAt:8,type:'shot',playerId:'home-10',revision:1}],
  limitation:'Scripted synthetic positions, in metres on a 105 × 68 m pitch. Distances describe geometry; they do not establish pressure, intent, shot quality or a tactical cause.'};
}
export function positionalSnapshot(scenario,time){
 if(!Number.isFinite(time)||time<0)throw new RangeError('Time must be nonnegative and finite.');
 const frame=scenario.frames.filter(f=>f.time<=time&&f.arrivedAt<=time).at(-1);
 if(!frame)return null;
 const runner=frame.players.find(p=>p.id==='home-10');
 const distances=frame.players.filter(p=>p.team==='away').map(p=>({id:p.id,number:p.number,metres:Math.hypot(p.x-runner.x,p.y-runner.y)})).sort((a,b)=>a.metres-b.metres);
 return {frame,events:scenario.events.filter(e=>e.time<=time&&e.arrivedAt<=time),nearest:distances[0],runner};
}
