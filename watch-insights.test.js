import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseWatchInsight,watchExplanation} from './watch-insights.js';

const event=(id,time,type='shot',extra={})=>({id,time,arrivedAt:time,revision:1,type,team:'home',player:'A. Reed',result:false,operation:'upsert',...extra});

test('routine passing and isolated recoveries leave a quiet screen',()=>{
 const rows=[event('pass',1,'pass',{result:true}),event('receive',2,'receive'),event('recovery',3,'recovery')];
 assert.equal(chooseWatchInsight(rows,3).status,'quiet');
 assert.equal(chooseWatchInsight(rows,3).anchorId,null);
});

test('a received chance persists through routine passes then expires exactly on schedule',()=>{
 const rows=[event('shot',10),event('pass',11,'pass',{result:true})];
 assert.equal(chooseWatchInsight(rows,9).status,'quiet');
 assert.equal(chooseWatchInsight(rows,11).anchorId,'shot');
 assert.equal(chooseWatchInsight(rows,21.99).expiresAt,22);
 assert.equal(chooseWatchInsight(rows,22).status,'quiet');
});

test('a goal stays prominent over subsequent shots and verified turnover sequences',()=>{
 const rows=[event('goal',10,'shot',{result:true}),event('shot',11),event('failed',12,'pass',{team:'away'}),event('recovery',13,'recovery')];
 assert.equal(chooseWatchInsight(rows,13).reason,'goal');
 assert.equal(chooseWatchInsight(rows,22).anchorId,'shot');
 assert.equal(chooseWatchInsight(rows,23).anchorId,'recovery');
 assert.equal(chooseWatchInsight(rows,25).status,'quiet');
});

test('recovery promotion requires a recorded earlier opponent pass failure without asserting cause',()=>{
 const recovery=event('recovery',10,'recovery');
 assert.equal(chooseWatchInsight([event('fail',9,'pass',{team:'away'}),recovery],10).reason,'possession-recovery');
 for(const fail of [event('fail',3,'pass',{team:'away'}),event('fail',9,'pass',{team:'home'}),event('fail',11,'pass',{team:'away'}),event('fail',9,'pass',{team:'away',result:true})]){
  assert.equal(chooseWatchInsight([fail,recovery],10).status,'quiet');
 }
});

test('late events and revised outcomes appear only after receipt and replace original identity',()=>{
 const original=event('shot',10,'shot',{outcome:'off-target'}),corrected={...original,revision:2,arrivedAt:15,outcome:'saved'};
 const before=chooseWatchInsight([corrected,original],14),after=chooseWatchInsight([original,corrected],15);
 assert.equal(before.revision,1);assert.match(before.meaning.headline,/off target/);
 assert.equal(after.revision,2);assert.match(after.meaning.headline,/saved/);assert.notEqual(after.key,before.key);
 assert.equal(after.anchorId,before.anchorId);assert.equal(after.expiresAt,27);
 assert.equal(chooseWatchInsight([event('late',1,'shot',{arrivedAt:20})],19).status,'quiet');
 assert.equal(chooseWatchInsight([event('late',1,'shot',{arrivedAt:20})],20).status,'insight');
});

test('withdrawn moments disappear and older revisions never revive them',()=>{
 const original=event('shot',10),deleted={...original,revision:2,operation:'delete',arrivedAt:12};
 assert.equal(chooseWatchInsight([deleted,original],12).status,'quiet');
 assert.equal(chooseWatchInsight([deleted,original],11).revision,1);
});

test('score evidence corrections refresh a current headline without changing its anchor',()=>{
 const goal=event('goal',1,'shot',{result:true}),shot=event('shot',20),correction={...goal,revision:2,result:false,arrivedAt:21};
 const before=chooseWatchInsight([goal,shot,correction],20),after=chooseWatchInsight([goal,shot,correction],21);
 assert.equal(before.anchorId,'shot');assert.equal(after.anchorId,'shot');assert.notEqual(before.key,after.key);
});

test('selection is deterministic, localized, non-mutating, and validates bounded input',()=>{
 const a=event('a',10),b=event('b',10),rows=[b,a],snapshot=structuredClone(rows);
 assert.equal(chooseWatchInsight(rows,10).anchorId,'a');
 assert.deepEqual(chooseWatchInsight(rows,10),chooseWatchInsight([...rows].reverse(),10));
 assert.deepEqual(rows,snapshot);
 assert.notEqual(chooseWatchInsight(rows,10).key,chooseWatchInsight(rows,10,{language:'es'}).key);
 assert.throws(()=>chooseWatchInsight(rows,10,{duration:0}),RangeError);
 assert.throws(()=>chooseWatchInsight(rows,-1),RangeError);
 assert.throws(()=>chooseWatchInsight(rows,10,{language:'xx'}),RangeError);
});


test('automatic Watch context waits for shot completion and expires without replacing play-by-play',()=>{
 const rows=[event('goal',10,'shot',{result:true})];
 assert.equal(watchExplanation(rows,10),null);
 const shown=watchExplanation(rows,11);
 assert.equal(shown.anchorId,'goal');assert.ok(shown.text);assert.equal(shown.expiresAt,18);
 assert.equal(watchExplanation(rows,18),null);
 assert.equal(watchExplanation([event('pending',10,'shot',{result:null})],12),null);
});
test('2x replay keeps automatic context readable for eight wall-clock seconds',()=>{
 const rows=[event('goal',10,'shot',{result:true})];
 assert.equal(watchExplanation(rows,25,{playbackRate:2}).expiresAt,26);
 assert.equal(watchExplanation(rows,26,{playbackRate:2}),null);
 assert.throws(()=>watchExplanation(rows,11,{playbackRate:0}),RangeError);
});
test('automatic context honors withdrawal, correction and selected language',()=>{
 const original=event('shot',10,'shot',{result:true});
 const corrected={...original,revision:2,result:false,outcome:'saved',arrivedAt:12};
 const rows=[original,corrected];
 const before=watchExplanation(rows,11),after=watchExplanation(rows,12);
 assert.equal(before.revision,1);assert.equal(after.revision,2);assert.notEqual(before.text,after.text);
 assert.notEqual(after.text,watchExplanation(rows,12,{language:'es'}).text);
 assert.equal(watchExplanation([...rows,{...corrected,revision:3,operation:'delete',arrivedAt:13}],13),null);
});
