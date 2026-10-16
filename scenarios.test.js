import test from 'node:test';
import assert from 'node:assert/strict';
import {createScenario,positionalSnapshot} from './scenarios.js';
test('seeded positional fixtures are repeatable, bounded and have 22 continuous tracks',()=>{
 for(const kind of ['central','wide'])for(const seed of [1,17,902]){
  const scene=createScenario(kind,seed);assert.deepEqual(scene,createScenario(kind,seed));
  for(const [i,frame] of scene.frames.entries()){
   assert.equal(frame.players.length,22);assert.equal(new Set(frame.players.map(p=>p.id)).size,22);
   for(const p of frame.players){assert.ok(p.x>=0&&p.x<=105&&p.y>=0&&p.y<=68);if(i){const prev=scene.frames[i-1].players.find(x=>x.id===p.id);assert.ok(Math.hypot(p.x-prev.x,p.y-prev.y)<8,'track exceeds plausible running speed');}}
   assert.ok(frame.ball.x>=0&&frame.ball.x<=105&&frame.ball.y>=0&&frame.ball.y<=68);
  }
 }
 assert.notDeepEqual(createScenario('central',1),createScenario('central',2));
});
test('scene observation gates frames, delayed arrivals and future shots',()=>{
 const scene=createScenario();assert.equal(positionalSnapshot(scene,7).events.some(e=>e.type==='shot'),false);
 assert.equal(positionalSnapshot(scene,8).events.at(-1).type,'shot');
 scene.frames[4].arrivedAt=5;assert.equal(positionalSnapshot(scene,4).frame.time,3);
 assert.deepEqual(positionalSnapshot(scene,3),positionalSnapshot(scene,3));
});
test('spatial distance agrees with known positions and ball reception',()=>{
 const scene=createScenario(),state=positionalSnapshot(scene,4);
 assert.deepEqual(state.frame.ball,{x:state.runner.x,y:state.runner.y});
 const opponent=state.frame.players.find(p=>p.id===state.nearest.id);
 assert.equal(state.nearest.metres,Math.hypot(opponent.x-state.runner.x,opponent.y-state.runner.y));
 const wide=positionalSnapshot(createScenario('wide'),8);assert.equal(wide.runner.y,11);assert.equal(state.runner.y,34);
});
