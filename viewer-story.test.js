import test from 'node:test';
import assert from 'node:assert/strict';
import {selectLiveStory,momentScene} from './viewer-story.js';
import {integratedMatch} from './match-stream.js';
const event=(id,time,type,other={})=>({id,time,arrivedAt:time,revision:1,type,team:'home',player:'A. Reed',...other});
test('live selection excludes future arrivals and expires old goals instead of retaining them forever',()=>{
 const goal=event('goal',10,'shot',{result:true});
 assert.equal(selectLiveStory([goal],9),null);
 assert.equal(selectLiveStory([goal],29).event.id,'goal');
 assert.equal(selectLiveStory([goal],30),null);
 assert.equal(selectLiveStory([event('late',20,'shot',{arrivedAt:40})],25),null);
 assert.equal(selectLiveStory([event('deleted',20,'shot',{operation:'delete'})],25),null);
});
test('favorites change comparable passages but cannot hide a recent goal',()=>{
 const pass=event('pass',20,'pass',{player:'J. Cole'}),receive=event('receive',20,'receive');
 assert.equal(selectLiveStory([pass,receive],21,{favoritePlayer:'J. Cole'}).event.id,'receive');
 const otherPass=event('other',21,'pass',{player:'L. Park',team:'away'});
 assert.equal(selectLiveStory([pass,otherPass],22,{favoritePlayer:'J. Cole'}).event.id,'pass');
 assert.equal(selectLiveStory([pass,event('goal',10,'shot',{result:true})],22,{favoritePlayer:'J. Cole'}).event.id,'goal');
});
test('selected scene uses the exact received event sample and names participants, never the latest frame',()=>{
 const before=integratedMatch({kind:'central',time:8,anchorId:'central-17-shot'}).explanation;
 const after=integratedMatch({kind:'central',time:12,anchorId:'central-17-shot'}).explanation;
 assert.equal(momentScene(after).frame.time,8);
 assert.equal(momentScene(before).frame.revision,1);assert.equal(momentScene(after).frame.revision,2);
 assert.ok(momentScene(after).participants.includes('home-10'));
 assert.equal(momentScene(after).names['home-10'],'A. Reed');
 assert.equal(momentScene({...after,frame:null}).frame,null);
 assert.equal(momentScene({...after,frame:{time:12}}).frame,null);
});
