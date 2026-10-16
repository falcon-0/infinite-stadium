import test from 'node:test';
import assert from 'node:assert/strict';
import {catchup} from './catchup.js';
import {broadcastFrame} from './broadcast.js';
import {integratedFeed} from './match-stream.js';
import {applyStream,emptyStream} from './stream-state.js';
import {validateFixture} from './fixture-validation.js';
import {momentHeadline} from './viewer-copy.js';

const event=(id,time,type='shot',extra={})=>({id,time,arrivedAt:time,revision:1,team:'home',player:'A. Reed',playerId:'home-10',type,result:true,...extra});

test('catch-up uses confirmed football shot outcomes in every supported language',()=>{
 for(const language of ['en','es','fr','pt'])for(const outcome of ['off-target','saved','blocked','on-target']){
  const shot=event('attempt',3,'shot',{result:false,outcome});
  const result=catchup([shot],5,0,{language});
  assert.equal(result.highlights[0].text,`${momentHeadline(shot,language)} (Home).`);
  assert.equal(result.counts.shots,1);assert.equal(result.counts.goals,0);
  assert.deepEqual(result.highlights[0].evidence,[{type:'event',id:'attempt',revision:1}]);
 }
});

test('catch-up never infers a shot on target or exposes an internal player ID',()=>{
 const unknown=event('unknown',3,'shot',{result:false,player:null,outcome:'unknown'});
 assert.equal(catchup([unknown],5,0).highlights[0].text,'A player shoots but does not score (Home).');
 const pending={...unknown,result:null,outcome:'saved'};
 assert.match(catchup([pending],5,0).highlights[0].text,/outcome pending/);
 assert.doesNotMatch(catchup([pending],5,0).highlights[0].text,/saved|home-10/);
 const pass=event('pass',3,'pass',{player:null});
 assert.doesNotMatch(catchup([pass],5,0).highlights[0].text,/home-10/);
 const goal={...unknown,result:true,outcome:'off-target'};
 assert.equal(catchup([goal],5,0).highlights[0].text,'A player scores (Home).');
});

test('catch-up presents the latest received shot correction without changing its action identity',()=>{
 const original=event('attempt',3,'shot',{result:false,outcome:'saved'});
 const correction={...original,revision:2,arrivedAt:5,outcome:'off-target'};
 assert.match(catchup([original,correction],4,0).highlights[0].text,/shot saved/);
 const corrected=catchup([original,correction],5,0);
 assert.match(corrected.highlights[0].text,/off target/);
 assert.equal(corrected.counts.actions,1);
 assert.deepEqual(corrected.highlights[0].evidence,[{type:'event',id:'attempt',revision:2}]);
});

test('catch-up folds received revisions, distinguishes old corrections from new actions, and preserves historical score',()=>{
 const original=event('old-goal',4),correction={...original,revision:2,arrivedAt:12,result:false};
 const received=[correction,event('new-shot',11,'shot',{result:false}),original,event('new-goal',14,'shot',{team:'away'})];
 const result=catchup(received,15,10);
 assert.deepEqual(result.scoreAtSince,{home:1,away:0});
 assert.deepEqual(result.scoreNow,{home:0,away:1});
 assert.equal(result.counts.actions,2);
 assert.equal(result.counts.goals,1);
 assert.equal(result.correctionCount,1);
 assert.equal(result.updates[0].kind,'correction');
 assert.equal(result.updates[0].time,4);
 assert.deepEqual(result.updates[0].previousEvidence,[{type:'event',id:'old-goal',revision:1}]);
 assert.ok(!result.highlights.some(h=>h.anchorId==='old-goal'));
 assert.deepEqual(result.countsEvidence.goals,[{type:'event',id:'new-goal',revision:1}]);
});

test('a materialized correction without history does not fabricate the historical score',()=>{
 const result=catchup(new Map([['old',event('old',3,'shot',{revision:2,arrivedAt:12,result:false})]]).values(),15,10);
 assert.equal(result.scoreAtSince,null);
 assert.equal(result.baselineComplete,false);
 assert.equal(result.counts.actions,0);
 assert.equal(result.missingHistory[0].id,'old');
 assert.deepEqual(result.scoreNow,{home:0,away:0});
});

test('a timestamp correction cannot turn an already received action into a new action',()=>{
 const old=event('retimed',4);
 const result=catchup([old,{...old,revision:2,time:11,arrivedAt:12}],15,10);
 assert.equal(result.counts.actions,0);
 assert.equal(result.correctionCount,1);
 assert.equal(result.updates[0].anchorId,'retimed');
 assert.deepEqual(result.scoreAtSince,{home:1,away:0});
 assert.deepEqual(result.scoreNow,{home:1,away:0});
});

test('future arrivals, future event times and unreached revisions never leak into catch-up',()=>{
 const shot=event('shot',7,'shot',{result:null});
 const result=catchup([shot,{...shot,revision:2,arrivedAt:20,result:true},event('future',30),event('delayed',8,'shot',{arrivedAt:21})],10,5);
 assert.equal(result.counts.actions,1);
 assert.equal(result.counts.goals,0);
 assert.match(result.highlights[0].text,/pending/);
 assert.deepEqual(result.highlights[0].evidence,[{type:'event',id:'shot',revision:1}]);
});

test('late initial arrivals are reported separately, not treated as actions since the baseline',()=>{
 const result=catchup([event('late',2,'shot',{arrivedAt:12})],15,10);
 assert.equal(result.counts.actions,0);
 assert.equal(result.lateArrivalCount,1);
 assert.equal(result.updates[0].kind,'late-arrival');
 assert.deepEqual(result.scoreAtSince,{home:0,away:0});
 assert.deepEqual(result.scoreNow,{home:1,away:0});
});

test('withdrawals update score and retract highlights rather than counting another action',()=>{
 const original=event('goal',3);
 const result=catchup([original,{...original,revision:2,arrivedAt:12,operation:'delete'}],15,10);
 assert.deepEqual(result.scoreAtSince,{home:1,away:0});
 assert.deepEqual(result.scoreNow,{home:0,away:0});
 assert.equal(result.updates[0].withdrawn,true);
 assert.equal(result.counts.actions,0);
 assert.deepEqual(result.highlights,[]);
});

test('a received withdrawal is reported even when its original goal was inside the catch-up interval',()=>{
 const original=event('goal-in-interval',8),correction={...original,revision:2,arrivedAt:10};
 const deletion={id:original.id,revision:3,time:8,arrivedAt:11,operation:'delete'};
 const records=[original,correction,deletion],saved=structuredClone(records),notices=new Set();
 for(const language of ['en','es','fr','pt']){
  const before=catchup(records,8,0,{language});assert.equal(before.counts.goals,1);assert.equal(before.updates.length,0);
  const corrected=catchup(records,10,0,{language});assert.equal(corrected.counts.goals,1);assert.equal(corrected.updates.length,0);
  const withdrawn=catchup(records,12,0,{language});
  assert.deepEqual(withdrawn.scoreAtSince,{home:0,away:0});assert.deepEqual(withdrawn.scoreNow,{home:0,away:0});
  assert.equal(withdrawn.counts.actions,0);assert.equal(withdrawn.counts.goals,0);assert.equal(withdrawn.counts.shots,0);
  assert.deepEqual(withdrawn.highlights,[]);assert.deepEqual(withdrawn.countsEvidence.actions,[]);
  assert.equal(withdrawn.updateCount,1);assert.equal(withdrawn.updates[0].withdrawn,true);
  assert.equal(withdrawn.updates[0].intervalMembership,'within-interval');assert.equal(withdrawn.baselineComplete,true);
  assert.equal(withdrawn.uncertainUpdateCount,0);
  assert.deepEqual(withdrawn.updates[0].evidence,[{type:'event',id:original.id,revision:3}]);
  assert.deepEqual(withdrawn.updates[0].previousEvidence,[{type:'event',id:original.id,revision:2}]);
  assert.ok(withdrawn.updates[0].text.length>80);assert.doesNotMatch(withdrawn.updates[0].text,/A\. Reed|Northbridge|VAR|offside/);
  notices.add(withdrawn.updates[0].text);
 }
 assert.equal(notices.size,4);assert.match(catchup(records,12,0).updates[0].text,/provider withdrew a recorded event/i);
 assert.deepEqual(records,saved);
});

test('withdrawal without original history stays uncertain and old withdrawal receipts are excluded',()=>{
 const deletion={id:'goal',revision:3,time:8,arrivedAt:11,operation:'delete'};
 for(const language of ['en','es','fr','pt']){
  const unknown=catchup([deletion],12,0,{language});
  assert.equal(unknown.updates.length,1);assert.equal(unknown.updates[0].intervalMembership,'unknown');
  assert.equal(unknown.baselineComplete,false);assert.equal(unknown.scoreAtSince,null);assert.equal(unknown.uncertainUpdateCount,1);
  assert.equal(unknown.updates[0].withdrawn,true);assert.deepEqual(unknown.updates[0].previousEvidence,[]);
  assert.deepEqual(unknown.updates[0].evidence,[{type:'event',id:'goal',revision:3}]);
  assert.equal(unknown.counts.actions,0);assert.ok(unknown.updates[0].text.length>120);
 }
 const original=event('goal',8),correction={...original,revision:2,arrivedAt:10};
 for(const since of [11,12]){
  const old=catchup([original,correction,deletion],12,since);
  assert.deepEqual(old.updates,[]);assert.equal(old.updateCount,0);assert.equal(old.counts.actions,0);
  assert.deepEqual(old.scoreAtSince,{home:0,away:0});
 }
 const confirmed=event('new-pass',4,'pass',{result:null}),repair={...confirmed,revision:2,arrivedAt:6,result:true};
 const active=catchup([confirmed,repair],12,0);
 assert.equal(active.counts.actions,1);assert.equal(active.counts.completedPasses,1);assert.deepEqual(active.updates,[]);
});

test('continuous authored withdrawal replay reports the retraction in a default whole-window catch-up',()=>{
 let state=emptyStream(),previous=null;
 for(const time of [0,2,4,8,10,11,12]){
  const frame=broadcastFrame({kind:'withdrawal',seed:17,time},previous);state=applyStream(state,frame.message);previous=frame.bundle;
 }
 const result=catchup(state.eventHistory.values(),12,0);
 assert.deepEqual(result.scoreNow,{home:0,away:0});assert.equal(result.counts.goals,0);assert.equal(result.counts.shots,0);
 assert.equal(result.counts.actions,2);assert.equal(result.updates.length,1);assert.equal(result.updates[0].withdrawn,true);
 assert.equal(result.updates[0].intervalMembership,'within-interval');
 assert.deepEqual(result.updates[0].evidence,[{type:'event',id:'withdrawal-17-shot',revision:3}]);
});

test('highlight priorities favor goals while respecting favorites, with exact aggregate evidence and bounded output',()=>{
 const records=[event('goal',1),...Array.from({length:8},(_,i)=>event(`shot-${i}`,i+2,'shot',{player:'J. Cole',result:false}))];
 const original=structuredClone(records);
 const result=catchup(records,10,0,{favoritePlayer:'J. Cole',limit:2});
 assert.equal(result.counts.actions,9);
 assert.equal(result.countsEvidence.actions.length,9);
 assert.equal(result.highlights.length,2);
 assert.equal(result.highlights[0].anchorId,'goal');
 assert.equal(result.highlights[1].anchorId,'shot-7');
 assert.equal(result.highlights[1].preferenceMatch,true);
 assert.deepEqual(records,original);
});

test('since is exclusive, observation inclusive, and pending passes are not completed',()=>{
 const result=catchup([event('boundary',5),event('pending',6,'pass',{result:null}),event('sample',7,'flight'),event('complete',10,'pass')],10,5);
 assert.equal(result.counts.actions,2);
 assert.equal(result.counts.passes,2);
 assert.equal(result.counts.completedPasses,1);
 assert.equal(result.counts.pendingPasses,1);
 assert.deepEqual(result.scoreAtSince,{home:1,away:0});
 assert.deepEqual(catchup([],0,0).highlights,[]);
});

test('localized summaries and correction notices are generated for every supported language',()=>{
 for(const language of ['en','es','fr','pt']){
  const old=event('old',1);
  const result=catchup([old,{...old,revision:2,arrivedAt:7},event('new',8)],10,5,{language});
  assert.equal(result.preferences.language,language);
  assert.equal(result.summary,{en:'1 shot, including a goal.',es:'1 tiro, con un gol.',fr:'1 tir, dont un but.',pt:'1 remate, incluindo um golo.'}[language]);
  assert.ok(result.accounting.length>20);
  assert.ok(result.limitation.length>40);
  assert.ok(result.updates[0].text.length>20);
 }
 assert.equal(catchup([event('goal',3)],5,0,{language:'fr'}).highlights[0].text,'A. Reed marque (Home).');
});

test('invalid intervals, unsupported preferences and malformed evidence are rejected',()=>{
 for(const [time,since] of [[2,3],[-1,0],[3,-1],[Infinity,0],[4,NaN]])assert.throws(()=>catchup([],time,since),RangeError);
 for(const prefs of [{language:'de'},{favoriteClub:'real-club'},{favoritePlayer:''},{limit:0},{limit:6}])assert.throws(()=>catchup([],5,0,prefs),RangeError);
 assert.throws(()=>catchup(null,5,0),TypeError);
 assert.throws(()=>catchup([{...event('bad',1),revision:0}],5,0),TypeError);
});

test('receive highlights name the observed ball reception in every supported language',()=>{
 for(const [language,action] of Object.entries({en:'received the ball',es:'recibió el balón',fr:'a reçu le ballon',pt:'recebeu a bola'})){
  const result=catchup([event('receive',3,'receive')],5,0,{language});
  assert.equal(result.highlights[0].text,`A. Reed ${action} (Home).`);
  assert.deepEqual(result.highlights[0].evidence,[{type:'event',id:'receive',revision:1}]);
  assert.equal(result.counts.shots,0);
 }
});

test('secondary accounting retains singular and plural action counts',()=>{
 assert.equal(catchup([event('goal',3)],5,0).accounting,'1 new recorded action: 1 goal and 1 shot.');
 assert.equal(catchup([event('miss',3,'shot',{result:false})],5,0).accounting,'1 new recorded action: 0 goals and 1 shot.');
 assert.equal(catchup([event('first',3),event('second',4)],5,0).accounting,'2 new recorded actions: 2 goals and 2 shots.');
});

test('football catch-up leads with shots including goals and cites the full end-score consequence',()=>{
 const records=[event('previous-away',10,'shot',{team:'away'}),event('save',95,'shot',{result:false,outcome:'saved'}),
  event('block',105,'shot',{result:false,outcome:'blocked'}),event('goal',116),event('pass',96,'pass')];
 const result=catchup(records,120,90);
 assert.equal(result.summary,'3 shots, including a goal.');
 assert.equal(result.consequence,'The score is level at 1–1 at the end of this interval.');
 assert.deepEqual(result.consequenceEvidence.map(r=>r.id),['previous-away','goal']);
 assert.equal(result.accounting,'4 new recorded actions: 1 goal and 3 shots.');
 for(const language of ['en','es','fr','pt']){
  const translated=catchup(records.filter(r=>r.id!=='previous-away'),120,90,{language});
  assert.ok(translated.summary.startsWith('3 '));assert.match(translated.consequence,/Home.*1–0/);
  assert.deepEqual(translated.consequenceEvidence.map(r=>r.id),['goal']);
 }
});

test('catch-up never describes a pending or withdrawn goal as a lead consequence',()=>{
 const pending=catchup([event('pending',3,'shot',{result:null})],5,0);
 assert.equal(pending.summary,'1 shot; no confirmed goal.');assert.equal(pending.consequence,null);
 const withdrawn=catchup([event('goal',3),{id:'goal',revision:2,time:3,arrivedAt:4,operation:'delete'}],5,0);
 assert.equal(withdrawn.consequence,null);assert.deepEqual(withdrawn.consequenceEvidence,[]);
 const away=catchup([event('away',3,'shot',{team:'away'})],5,0);
 assert.equal(away.consequence,'Away lead 1–0 at the end of this interval.');
});

test('a current-only event retimed across the interval cannot be counted as a new action',()=>{
 const original=event('retimed',40),corrected={...original,revision:2,time:70,arrivedAt:72};
 const currentOnly=catchup([corrected],75,60);
 assert.equal(currentOnly.counts.actions,0);assert.deepEqual(currentOnly.highlights,[]);
 assert.equal(currentOnly.updates[0].kind,'correction');
 assert.equal(currentOnly.updates[0].intervalMembership,'unknown');
 assert.equal(currentOnly.uncertainUpdateCount,1);
 assert.equal(currentOnly.baselineComplete,false);assert.equal(currentOnly.scoreAtSince,null);
 assert.match(currentOnly.updates[0].text,/excluded from new-action counts/);
 const history=catchup([original,corrected],75,60);
 assert.equal(history.counts.actions,0);assert.equal(history.uncertainUpdateCount,0);
 assert.equal(history.updates[0].intervalMembership,'before-or-at-since');
 assert.equal(history.baselineComplete,true);assert.deepEqual(history.scoreAtSince,{home:1,away:0});
 assert.notEqual(currentOnly.key,history.key);
});

test('received original history allows genuinely new revised actions to be counted exactly once',()=>{
 const initial=event('new',70,'pass',{result:null}),confirmed={...initial,result:true,revision:2,arrivedAt:72};
 const history=catchup([initial,confirmed],75,60);
 assert.equal(history.counts.actions,1);assert.equal(history.counts.completedPasses,1);
 assert.equal(history.updates.length,0);assert.equal(history.baselineComplete,true);
 assert.equal(history.countsEvidence.actions[0].revision,2);
 const incomplete=catchup([confirmed],75,60);
 assert.equal(incomplete.counts.actions,0);assert.equal(incomplete.uncertainUpdateCount,1);
});

test('unknown interval membership is explained without inventing chronology in all supported languages',()=>{
 const revised=event('uncertain',70,'shot',{revision:2,arrivedAt:72});
 const notices=new Set();
 for(const language of ['en','es','fr','pt']){
  const result=catchup([revised],75,60,{language});
  assert.equal(result.updates[0].intervalMembership,'unknown');
  assert.equal(result.counts.actions,0);assert.equal(result.scoreAtSince,null);
  assert.ok(result.updates[0].text.length>80);notices.add(result.updates[0].text);
 }
 assert.equal(notices.size,4);
});

test('minimal actual provider tombstones survive broadcast, history and catch-up without invented actor fields',()=>{
 const input={kind:'central',seed:17},feed=integratedFeed(input.kind,input.seed);
 const deletion={id:'central-17-shot',revision:3,time:8,arrivedAt:11,operation:'delete'};
 const records={...feed,events:[...feed.events,deletion]},saved=structuredClone(records);
 assert.equal(validateFixture(records,{observedAt:11}).valid,true);
 let state=emptyStream(),previous=null;
 for(const time of [8,10,11]){
  const frame=broadcastFrame({...input,time},previous,records);state=applyStream(state,frame.message);previous=frame.bundle;
 }
 assert.deepEqual(state.eventHistory.get('central-17-shot@3'),deletion);
 assert.equal(state.events.has(deletion.id),false);
 for(const language of ['en','es','fr','pt']){
  const result=catchup(state.eventHistory.values(),11,9,{language});
  assert.deepEqual(result.scoreAtSince,{home:1,away:0});assert.deepEqual(result.scoreNow,{home:0,away:0});
  assert.equal(result.counts.goals,0);assert.deepEqual(result.highlights,[]);
  assert.equal(result.updates.length,1);assert.equal(result.updates[0].withdrawn,true);
  assert.deepEqual(result.updates[0].evidence,[{type:'event',id:deletion.id,revision:3}]);
  assert.deepEqual(result.updates[0].previousEvidence,[{type:'event',id:deletion.id,revision:1}]);
 }
 const seek=applyStream(emptyStream(),broadcastFrame({...input,time:11},null,records).message);
 const complete=catchup(seek.eventHistory.values(),11,9);
 assert.deepEqual(complete.scoreAtSince,{home:1,away:0});assert.equal(complete.baselineComplete,true);
 assert.deepEqual(complete.scoreNow,{home:0,away:0});assert.equal(complete.updates[0].withdrawn,true);
 assert.deepEqual(complete.updates[0].evidence,[{type:'event',id:deletion.id,revision:3}]);
 assert.deepEqual(records,saved);
});

test('future-retimed corrections received before their event time violate the contract instead of resurrecting old goals',()=>{
 const original=event('retimed-goal',4),invalid={...original,revision:2,time:20,arrivedAt:12,result:false};
 assert.throws(()=>catchup([original,invalid],15,10),/arrival no earlier than event time/);
 const valid={...invalid,arrivedAt:20};
 assert.deepEqual(catchup([original,valid],15,10).scoreNow,{home:1,away:0});
 const corrected=catchup([original,valid],25,10);
 assert.deepEqual(corrected.scoreAtSince,{home:1,away:0});assert.deepEqual(corrected.scoreNow,{home:0,away:0});
 assert.equal(corrected.counts.actions,0);assert.equal(corrected.updates[0].evidence[0].revision,2);
 for(const deletion of [{id:'deleted',revision:2,time:10,arrivedAt:9,operation:'delete'},{id:'deleted',revision:0,time:10,arrivedAt:10,operation:'delete'}])assert.throws(()=>catchup([deletion],15,10),TypeError);
 assert.throws(()=>catchup([{...original,operation:'invented'}],15,10),TypeError);
});
