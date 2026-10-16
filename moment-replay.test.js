import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMomentReplay,MomentReplay} from './moment-replay.js';
const frame=time=>({id:`test-frame-${time}`,revision:1,time,arrivedAt:time,phase:'continuous',players:[{id:'home-1',team:'home',x:time,y:30}],ball:{x:time,y:30}});
const goal={id:'goal',time:16,arrivedAt:17,revision:2,type:'shot',team:'home',result:true};
const selection={anchorId:'goal',sequence:[goal],frame:frame(16)};
const frames=Array.from({length:21},(_,time)=>frame(time));
const options={events:[goal],frames,observedAt:18};
test('buildup uses only received positions and preserves exact anchor and source data',()=>{
 const before=JSON.stringify(frames),clip=buildMomentReplay(selection,options);
 assert.equal(clip.status,'available');assert.equal(clip.start,4);assert.equal(clip.end,18);
 assert.equal(clip.frames.length,15);assert.equal(clip.anchorTime,16);
 assert.ok(clip.evidence.some(e=>e.id==='goal'&&e.revision===2));
 assert.equal(JSON.stringify(frames),before);
 const delayed=frames.map(f=>f.time===18?{...f,arrivedAt:30}:f);
 assert.equal(buildMomentReplay(selection,{...options,frames:delayed}).end,17);
});
test('stale selections, withdrawals, gaps, resets and roster changes cannot become replay clips',()=>{
 for(const input of [
  {...options,events:[{...goal,revision:3}]},
  {...options,events:[{...goal,revision:3,operation:'delete'}]},
  {...options,frames:frames.filter(f=>f.time!==10)},
  {...options,frames:frames.map(f=>f.time===10?{...f,phase:'reset'}:f)},
  {...options,frames:frames.map(f=>f.time===10?{...f,players:[]}:f)},
  {...options,frames:frames.map(f=>f.time===16?{...f,revision:2}:f)},
  {...options,observedAt:16}
 ])assert.equal(buildMomentReplay(selection,input).status,'unavailable');
});
test('clip replay interpolates, never extrapolates, and bounds background-tab elapsed time',()=>{
 const clip=buildMomentReplay(selection,options),replay=new MomentReplay(clip,0);
 assert.equal(replay.step(0).ball.x,4);assert.equal(replay.step(50).ball.x,4.05);
 assert.ok(Math.abs(replay.step(100000).ball.x-4.15)<1e-9);
 for(let wall=100100;wall<=120000;wall+=100)replay.step(wall);
 assert.equal(replay.done,true);assert.equal(replay.step(130000).ball.x,18);
 assert.equal(replay.step(140000).displayOnly,true);
});
test('newer frame withdrawals and corrections are applied before building a clip',()=>{
 assert.equal(buildMomentReplay(selection,{...options,frames:[...frames,{...frame(10),revision:2,operation:'delete'}]}).status,'unavailable');
 const corrected={...frame(10),revision:2,ball:{x:11,y:30}};
 const clip=buildMomentReplay(selection,{...options,frames:[...frames,corrected]});
 assert.equal(clip.frames.find(f=>f.time===10).ball.x,11);
});
test('conflicting revision contents cannot drive an ambiguous clip',()=>{
 assert.equal(buildMomentReplay(selection,{...options,events:[goal,{...goal,result:false}]}).status,'unavailable');
 assert.equal(buildMomentReplay(selection,{...options,frames:[...frames,{...frame(10),ball:{x:99,y:30}}]}).status,'unavailable');
 const stale={...selection,sequence:[{...goal,result:false}]};
 assert.equal(buildMomentReplay(stale,options).status,'unavailable');
});
