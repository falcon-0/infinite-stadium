// Display-only interpolation between two already received samples. Never used as evidence.
export function pitchMotion(from,to,fraction){
 if(!to)return null;
 const amount=Math.max(0,Math.min(1,Number.isFinite(fraction)?fraction:1));
 if(!from||!Number.isFinite(from.time)||!Number.isFinite(to.time)||to.time<=from.time||to.time-from.time>1.01||
    from.phase==='reset'||to.phase==='reset'||!Array.isArray(from.players)||!Array.isArray(to.players)||
    from.players.length!==to.players.length||!from.ball||!to.ball)return to;
 const old=new Map(from.players.map(p=>[p.id,p]));
 if(to.players.some(p=>!old.has(p.id)||old.get(p.id).team!==p.team))return to;
 const point=(a,b)=>({...b,x:a.x+(b.x-a.x)*amount,y:a.y+(b.y-a.y)*amount,...(a.displayDiveAngle!==undefined||b.displayDiveAngle!==undefined?{displayDiveAngle:(a.displayDiveAngle||0)+((b.displayDiveAngle||0)-(a.displayDiveAngle||0))*amount}:{}),...(a.height!==undefined||b.height!==undefined?{height:(a.height||0)+((b.height||0)-(a.height||0))*amount}:{})});
 return {...to,players:to.players.map(p=>point(old.get(p.id),p)),ball:point(from.ball,to.ball),ballState:amount<1?from.ballState:to.ballState,displayOnly:true};
}

// A received-only playback cursor survives jitter and repeated UI renders.
// Waiting for another sample holds the final pose; it never predicts motion.
export class PitchPlayback {
 constructor(){this.reset();}
 reset(){this.time=null;this.wall=null;this.samples=[];this.primed=false;this.primeAt=null;}
 // Call once when received state changes. Passing null to step then avoids
 // sorting and scanning the entire position history on every animation frame.
 // Replace the whole inventory so corrections and withdrawals cannot leave
 // an obsolete sample in the display cache. The source iterable is untouched.
 update(frames){this.samples=[...frames].sort((a,b)=>a.time-b.time);}
 step(frames,wall,{rate=1,buffer=0}={}){
  // Existing callers may still supply fresh frames directly; animation loops
  // should update on receipt and use step(null, wall, options).
  if(frames!=null)this.update(frames);
  const samples=this.samples,last=samples.at(-1);
  if(!last)return null;
  const reserve=Math.max(0,Math.min(2,Number.isFinite(buffer)?buffer:0));
  const pace=Math.max(1,Math.min(12,rate));
  if(this.time===null||this.time>last.time){this.time=Math.max(samples[0].time,last.time-reserve);this.wall=wall;this.primed=reserve===0||last.time-this.time+1e-9>=reserve;this.primeAt=null;}
  // A small startup reserve absorbs ordinary delivery jitter without inventing
  // future samples, changing playback speed or repeatedly holding every second.
  if(!this.primed){
   this.wall=wall;
   if(last.time-this.time+1e-9>=reserve){
    if(this.primeAt===null)this.primeAt=wall+reserve/pace*1000;
    this.primed=wall>=this.primeAt;
   }
  }
  const elapsed=Math.max(0,(wall-this.wall)/1000);
  // Do not discard elapsed time on slow devices. After a suspended tab,
  // rejoin received play with the normal reserve instead of accumulating lag.
  // This is a display seek within received samples, never extrapolation.
  this.wall=wall;
  if(this.primed&&elapsed>1)this.time=Math.max(this.time,last.time-reserve);
  else this.time+=this.primed?elapsed*pace:0;
  this.time=Math.min(last.time,this.time);
  // Find the first sample at or after the display cursor in O(log n).
  let low=0,high=samples.length;
  while(low<high){const middle=(low+high)>>>1;if(samples[middle].time<this.time)low=middle+1;else high=middle;}
  const after=samples[low]||last;
  let before=samples[Math.max(0,low-1)];
  if(after.time===this.time){
   // Preserve the old filter(...).at(-1) rule for duplicate timestamps.
   let end=low,right=samples.length;
   while(end<right){const middle=(end+right)>>>1;if(samples[middle].time<=this.time)end=middle+1;else right=middle;}
   before=samples[end-1];
  }
  return {...pitchMotion(before,after,after.time===before.time?1:(this.time-before.time)/(after.time-before.time)),displayTime:this.time};
 }
}
