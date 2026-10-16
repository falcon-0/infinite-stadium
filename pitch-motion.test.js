import test from 'node:test';
import assert from 'node:assert/strict';
import {pitchMotion,PitchPlayback} from './pitch-motion.js';
const frame=(time,x,extra={})=>({id:'f'+time,time,revision:1,players:[{id:'p',team:'home',x,y:10}],ball:{x,y:10},...extra});
test('motion uses bounded linear positions between received samples without mutating evidence',()=>{
 const a=frame(1,10),b=frame(2,14),result=pitchMotion(a,b,.5);
 assert.equal(result.players[0].x,12);assert.equal(result.ball.x,12);assert.equal(result.displayOnly,true);
 assert.equal(a.players[0].x,10);assert.equal(b.players[0].x,14);
 assert.equal(pitchMotion(a,b,-1).ball.x,10);assert.equal(pitchMotion(a,b,2).ball.x,14);
});
test('missing, nonconsecutive, reversed, reset and changed-roster samples are never bridged',()=>{
 const a=frame(1,10),b=frame(2,14);
 for(const from of [null,frame(0,10),frame(3,10),frame(1,10,{phase:'reset'}),frame(1,10,{players:[]}),frame(1,10,{players:[{id:'other',team:'home',x:10,y:10}]})])assert.equal(pitchMotion(from,b,.5),b);
 assert.equal(pitchMotion(a,{...b,phase:'reset'},.5).displayOnly,undefined);
});
test('playback holds at received horizon and resumes without restarting on rerender',()=>{
 const clock=new PitchPlayback(),frames=[frame(0,0)];
 assert.equal(clock.step(frames,0).ball.x,0);
 assert.equal(clock.step(frames,100).ball.x,0);
 frames.push(frame(1,10));
 assert.equal(clock.step(frames,150).ball.x,.5);
 assert.equal(clock.step(frames,150).ball.x,.5,'same render time cannot advance playback');
 assert.equal(clock.step(frames,200).ball.x,1);
 for(let wall=300;wall<=2000;wall+=100)clock.step(frames,wall);
 assert.equal(clock.step(frames,2100).ball.x,10,'never extrapolate beyond received position');
 frames.push(frame(2,20));
 assert.ok(Math.abs(clock.step(frames,2150).ball.x-10.5)<1e-9);
});
test('playback reset seeks exactly and a suspended tab rejoins received play',()=>{
 const clock=new PitchPlayback();clock.step([frame(0,0)],0);
 const frames=[frame(0,0),frame(1,10),frame(2,20)];
 assert.equal(clock.step(frames,60000).displayTime,2);
 clock.reset();assert.equal(clock.step(frames,60001).ball.x,20);
 assert.equal(clock.step([frame(0,0)],60002).ball.x,0);
 assert.equal(clock.step([],60003),null);
});
test('ball custody changes at the sample boundary and corrections use current received frames',()=>{
 const a=frame(0,0,{ballState:{ownerId:'a'}}),b=frame(1,10,{ballState:{ownerId:'b'}});
 assert.equal(pitchMotion(a,b,.9).ballState.ownerId,'a');
 assert.equal(pitchMotion(a,b,1).ballState.ownerId,'b');
 const clock=new PitchPlayback();clock.step([b],0);
 const corrected={...b,revision:2,ball:{x:12,y:10}};
 assert.equal(clock.step([corrected],50).ball.x,12);
});

test('cached playback consumes a received iterable once and matches direct playback',()=>{
 const cached=new PitchPlayback(),direct=new PitchPlayback();
 let reads=0;
 const source=rows=>({*[Symbol.iterator](){reads++;yield* rows;}});
 const first=[frame(0,0)],next=[frame(2,20),frame(0,0),frame(1,10)];
 cached.update(source(first));cached.step(null,0);direct.step(first,0);
 cached.update(source(next));
 for(let wall=50;wall<=2500;wall+=50){
  assert.deepEqual(cached.step(null,wall),direct.step(next,wall));
 }
 assert.equal(reads,2,'animation frames must not consume the received inventory again');
 assert.deepEqual(next.map(row=>row.time),[2,0,1],'source ordering must not change');
});

test('cache replacement honors same-size corrections and withdrawals immediately',()=>{
 const clock=new PitchPlayback(),a=frame(0,0),b=frame(1,10);
 clock.update([a]);clock.step(null,0);
 clock.update([a,b]);assert.equal(clock.step(null,100).ball.x,1);
 const corrected={...b,revision:2,ball:{x:20,y:10}};
 clock.update([a,corrected]);assert.equal(clock.step(null,100).ball.x,2);
 clock.update([a]);assert.equal(clock.step(null,100).ball.x,0,'withdrawn future sample cannot interpolate');
 clock.update([]);assert.equal(clock.step(null,110),null);
 clock.reset();assert.equal(clock.step(null,120),null,'reset cannot reuse another match inventory');
});

test('binary lookup preserves exact boundaries and does not bridge sample gaps',()=>{
 const clock=new PitchPlayback();clock.update([frame(0,0)]);clock.step(null,0);
 clock.update([frame(0,0),frame(1,10),frame(3,30)]);
 for(let wall=100;wall<=1000;wall+=100)clock.step(null,wall);
 const boundary=clock.step(null,1000);assert.ok(Math.abs(boundary.ball.x-10)<1e-9);
 assert.equal(clock.step(null,1100).ball.x,30,'missing sample gap retains existing snap policy');
});

test('brief rendering stalls do not halve replay speed on a five-fps device',()=>{
 const clock=new PitchPlayback();clock.step([frame(0,0)],0);
 clock.update([frame(0,0),frame(1,10),frame(2,20)]);
 for(let wall=200;wall<=1000;wall+=200)clock.step(null,wall);
 assert.equal(clock.time,1);
 assert.equal(clock.step(null,1000).ball.x,10);
 assert.equal(clock.step(null,60000).displayTime,2,'long suspension rejoins the received horizon');
});
test('keeper dive and recovery interpolate without moving before the strike',async()=>{
 const {comparisonFixture}=await import('./comparison-fixture.js');
 const {frames}=comparisonFixture(17,{scenario:'sustained'});
 const pose=(a,b,t)=>pitchMotion(frames[a],frames[b],t).players.find(p=>p.id==='away-1');
 assert.equal(pose(95,96,.5).displayDiveAngle,0);
 assert.equal(pose(96,97,.5).displayDiveAngle,-27.5);
 assert.equal(pose(97,98,.5).displayDiveAngle,-42.5);
 assert.equal(pose(98,99,.5).displayDiveAngle,-15);
 assert.equal(pose(99,100,.5).displayDiveAngle,0);
 assert.equal(frames[97].players.find(p=>p.id==='away-1').displayDiveAngle,-55);
});

test('startup reserve absorbs delivery jitter without predicting or altering pace',()=>{
 const clock=new PitchPlayback();
 clock.step([frame(0,0)],0,{rate:2.5,buffer:.6});
 assert.equal(clock.step(null,300,{rate:2.5,buffer:.6}).displayTime,0);
 clock.update([frame(0,0),frame(1,10)]);
 assert.equal(clock.step(null,400,{rate:2.5,buffer:.6}).displayTime,0);
 assert.equal(clock.step(null,600,{rate:2.5,buffer:.6}).displayTime,0);
 assert.equal(clock.step(null,650,{rate:2.5,buffer:.6}).displayTime,0);
 let previous=0;
 // Subsequent samples arrive late by up to 100ms. Once primed, every displayed
 // frame advances at the chosen rate rather than stopping at each sample edge.
 for(let wall=700;wall<=2000;wall+=50){
  const latest=Math.max(1,Math.floor((wall-100)/400));
  clock.update(Array.from({length:latest+1},(_,i)=>frame(i,i*10)));
  const shown=clock.step(null,wall,{rate:2.5,buffer:.6});
  assert.ok(Math.abs(shown.displayTime-previous-.125)<1e-9,`continuous motion at ${wall}ms`);
  assert.ok(shown.displayTime<=latest,'received samples remain the upper bound');
  previous=shown.displayTime;
 }
 clock.reset();
 assert.equal(clock.step([frame(20,200)],0,{rate:2.5,buffer:.6}).displayTime,20,'new match/seek starts in its own inventory');
});


test('one-second throttling does not accumulate artificial playback delay',()=>{
 const clock=new PitchPlayback();clock.step([frame(0,0)],0);
 for(let second=1;second<=20;second++){
  const samples=Array.from({length:second+1},(_,i)=>frame(i,i*10));
  assert.equal(clock.step(samples,second*1000).displayTime,second);
 }
});

test('resuming a suspended live view keeps its reserve and never predicts missing play',()=>{
 const clock=new PitchPlayback();clock.step([frame(0,0),frame(1,10)],0,{buffer:.6});
 const samples=Array.from({length:61},(_,i)=>frame(i,i*10));
 const resumed=clock.step(samples,60000,{buffer:.6});
 assert.equal(resumed.displayTime,59.4);
 assert.ok(resumed.ball.x<=600);
 assert.ok(Math.abs(clock.step(null,60016,{buffer:.6}).displayTime-59.416)<1e-9);
});
