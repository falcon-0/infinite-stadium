import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshot,stories,events,feed,explainMoment,validateExplanation} from './engine.js';
test('clock gates goals and every story evidence reference',()=>{
 for(let t=0;t<=360;t++){
  const s=snapshot(t);
  assert.ok(s.events.every(e=>e.time<=t));
  for(const story of stories(s,'A. Reed'))for(const id of story.evidence)assert.ok(s.events.some(e=>e.id===id));
 }
 assert.equal(snapshot(168).stats.home.goals,0);
 assert.equal(snapshot(169).stats.home.goals,1);
 assert.equal(snapshot(283).stats.away.goals,0);
 assert.equal(snapshot(284).stats.away.goals,1);
});
test('late arrivals are invisible until received, including after replay rewind',()=>{
 assert.equal(snapshot(160).events.some(e=>e.id==='EV-015'),false);
 assert.equal(snapshot(164).events.some(e=>e.id==='EV-015'),true);
 snapshot(360);
 assert.equal(snapshot(163).events.some(e=>e.id==='EV-015'),false);
});
test('scorer correction revises scene evidence and recap without changing score',()=>{
 const before=snapshot(169),after=snapshot(190);
 const explanation=explainMoment(before,'EV-017');
 assert.match(explanation.text,/A\. Reed/);
 assert.equal(validateExplanation(explanation,after).valid,false);
 const revised=explainMoment(after,'EV-017');
 assert.match(revised.text,/J\. Cole/);
 assert.match(revised.recap,/J\. Cole scores/);
 assert.doesNotMatch(revised.recap,/A\. Reed/);
 assert.equal(after.stats.home.goals,before.stats.home.goals);
 assert.equal(revised.sequence.at(-1).player,'J. Cole');
 assert.deepEqual(explainMoment(snapshot(169),'EV-017'),explanation);
});
test('unrelated explanation remains valid across scorer correction',()=>{
 const earlier=explainMoment(snapshot(169),'EV-013');
 assert.equal(validateExplanation(earlier,snapshot(190)).valid,true);
});
test('duplicate and out of order deliveries cannot double count or roll back',()=>{
 const corrected=feed.find(e=>e.revision===2);
 const replay=[corrected,...feed,...feed];
 assert.deepEqual(snapshot(360,replay).stats,snapshot(360).stats);
 assert.equal(snapshot(360,replay).events.find(e=>e.id==='EV-017').player,'J. Cole');
});
test('deletion removes a goal and withdraws its explanation only after arrival',()=>{
 const goal=feed.find(e=>e.id==='EV-017');
 const messages=[...feed,{...goal,revision:3,arrivedAt:210,operation:'delete'}];
 const original=explainMoment(snapshot(200,messages),'EV-017');
 assert.equal(snapshot(209,messages).stats.home.goals,1);
 assert.equal(snapshot(210,messages).stats.home.goals,0);
 assert.equal(explainMoment(snapshot(210,messages),'EV-017'),null);
 assert.equal(validateExplanation(original,snapshot(210,messages)).valid,false);
});
test('late evidence inserted into an old window invalidates its explanation',()=>{
 const goal=feed.find(e=>e.id==='EV-017');
 const inserted={...goal,id:'LATE-1',time:162,arrivedAt:180,type:'pass',result:true};
 const messages=[...feed,inserted];
 const original=explainMoment(snapshot(169,messages),'EV-017');
 const changed=snapshot(180,messages);
 assert.equal(validateExplanation(original,changed).valid,false);
 assert.match(explainMoment(changed,'EV-017').text,/2 completed passes/);
});
test('rewinding restores the exact earlier state',()=>{
 const first=snapshot(130);snapshot(360);assert.deepEqual(snapshot(130),first);
 assert.deepEqual(snapshot(0).events,[]);
});
test('final independent fixture totals',()=>{
 assert.deepEqual(snapshot(360).stats,{
 home:{goals:1,shots:3,passes:8,completed:6,recoveries:3},
 away:{goals:1,shots:2,passes:7,completed:4,recoveries:3}
 });
});
test('high recovery story expires as the rolling window moves',()=>{
 assert.match(stories(snapshot(211),'A. Reed')[1].text,/3 attacking-third recoveries/);
 assert.match(stories(snapshot(211),'A. Reed')[1].text,/2 were followed/);
 assert.doesNotMatch(stories(snapshot(360),'A. Reed')[1].text,/attacking-third recoveries/);
});
test('fixture ids and temporal ordering are unambiguous',()=>{
 assert.equal(new Set(events.map(e=>e.id)).size,events.length);
 assert.ok(events.every((e,i)=>i===0||e.time>events[i-1].time));
});
