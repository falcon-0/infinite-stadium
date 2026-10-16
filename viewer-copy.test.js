import test from 'node:test';
import assert from 'node:assert/strict';
import {momentHeadline,momentSummary,livePlayHeadline} from './viewer-copy.js';
import {matchState} from './match-stream.js';
const event=(id,time,type,result,extra={})=>({id,time,type,result,team:'home',player:'A. Reed',revision:1,...(type==='recovery'?{recoveryKind:'loose-ball'}:{}),...extra});
const explanation=sequence=>({sequence,anchorId:sequence.at(-1).id,metrics:[]});

test('unknown recovery classification and opening control do not invent a ball win or a won-ball buildup',()=>{
 const unknown=event('u',5,'recovery',false,{recoveryKind:undefined});
 const start=event('start',0,'recovery',false,{recoveryKind:'segment-start'});
 for(const language of ['en','es','fr','pt']){
  assert.notEqual(momentHeadline(unknown,language),momentHeadline({...unknown,recoveryKind:'interception'},language));
  assert.notEqual(momentHeadline(start,language),momentHeadline({...start,recoveryKind:'loose-ball'},language));
 }
 for(const row of [unknown,start]){
  const summary=momentSummary(explanation([row,event('s',8,'shot',false)]));
  assert.doesNotMatch(summary,/recovered the ball|between that recovery/);
 }
});

test('shot and pass headlines distinguish known outcomes from all unknown values',()=>{
 assert.equal(momentHeadline(event('s',8,'shot',true)),'A. Reed scores');
 assert.equal(momentHeadline(event('s',8,'shot',false)),'A. Reed shoots but does not score');
 assert.equal(momentHeadline(event('p',8,'pass',true)),'A. Reed completes a pass');
 assert.equal(momentHeadline(event('p',8,'pass',false)),"A. Reed's pass is unsuccessful");
 for(const result of [null,undefined,'false',0,1]){
  assert.match(momentHeadline(event('s',8,'shot',result)),/outcome pending/);
  assert.match(momentHeadline(event('p',8,'pass',result)),/outcome pending/);
 }
});

test('explicit shot categories are natural facts only when the non-goal outcome is known',()=>{
 const english={'off-target':'D. Silva shoots off target',saved:'D. Silva has a shot saved',blocked:'D. Silva has a shot blocked','on-target':'D. Silva shoots on target'};
 for(const language of ['en','es','fr','pt'])for(const outcome of Object.keys(english)){
  const shot=event('s',8,'shot',false,{player:'D. Silva',outcome});
  const text=momentHeadline(shot,language);assert.match(text,/D\. Silva/);
  if(language==='en')assert.equal(text,english[outcome]);
  assert.notEqual(text,momentHeadline({...shot,outcome:'unknown'},language));
  assert.equal(momentHeadline({...shot,result:true},language),momentHeadline({...shot,result:true,outcome:'goal'},language));
  for(const result of [null,undefined,'false',0])assert.equal(momentHeadline({...shot,result},language),momentHeadline({...shot,result,outcome:undefined},language));
 }
 assert.equal(momentHeadline(event('s',8,'shot',false,{outcome:'goal'})),'A. Reed shoots but does not score');
 assert.equal(momentHeadline(event('s',8,'shot',false,{outcome:'toString'})),'A. Reed shoots but does not score');
});

test('actual corrected extended off-target shot does not invent miss direction, angle or a save',()=>{
 const state=matchState({kind:'extended',seed:17,time:120}),shot=state.events.find(e=>e.id==='extended-17-3-shot');
 assert.equal(shot.time,118);assert.equal(shot.revision,2);assert.equal(shot.result,false);assert.equal(shot.outcome,'off-target');
 assert.equal(momentHeadline(shot),'D. Silva shoots off target');
 assert.doesNotMatch(momentHeadline(shot),/wide|over|saved|blocked|power|angle|scores/);
 for(const language of ['en','es','fr','pt'])assert.notEqual(momentHeadline(shot,language),momentHeadline({...shot,result:true},language));
});

test('four languages provide distinct received-event headlines and pending outcomes',()=>{
 for(const language of ['en','es','fr','pt']){
  const values=[true,false,null].map(result=>momentHeadline(event('s',8,'shot',result),language));
  assert.equal(new Set(values).size,3);
  for(const type of ['pass','receive','recovery','flight'])assert.match(momentHeadline(event('x',8,type,null),language),/A\. Reed/);
  assert.notEqual(momentSummary(null,language),'');
 }
 assert.equal(momentHeadline(event('s',8,'shot',true),'unsupported'),'A. Reed scores');
});

test('shot summary uses latest uninterrupted recovery and known completed passes',()=>{
 const input=explanation([
  event('old',12,'recovery',false,{player:'M. Vale'}),event('early',13,'pass',true),
  event('recovery',20,'recovery',false,{player:'J. Cole'}),event('pass',22,'pass',true),
  event('pending',24,'pass',null),event('failed',26,'pass',false),event('shot',28,'shot',null)
 ]);
 const text=momentSummary(input);
 assert.match(text,/outcome pending/);
 assert.match(text,/J\. Cole recovered the ball 8 seconds/);
 assert.match(text,/1 completed pass between that recovery and the shot/);
 assert.doesNotMatch(text,/M\. Vale|2 completed|scores|without scoring/);
 assert.doesNotMatch(text,/not why the shot happened/);
});

test('opponent recovery breaks buildup linkage; future and old records are excluded',()=>{
 const input=explanation([
  event('old',0,'pass',true),event('recover',20,'recovery',false),event('p',22,'pass',true),
  event('opponent',25,'recovery',false,{team:'away'}),event('shot',28,'shot',false)
 ]);
 input.sequence.push(event('future',30,'recovery',false));
 const text=momentSummary(input);
 assert.match(text,/shoots but does not score/);
 assert.match(text,/1 completed pass in the preceding 15 seconds/);
 assert.doesNotMatch(text,/seconds before|between that recovery/);
});

test('non-shot copy counts received current records without asserting pass success',()=>{
 const input=explanation([event('r',10,'recovery',false),event('p',12,'pass',null)]);
 input.sequence.push(event('p',12,'pass',true,{revision:2}),event('gone',11,'receive',false,{operation:'delete'}));
 assert.match(momentSummary(input),/completes a pass\. 2 recorded events/);
 input.sequence.push(event('p',12,'pass',undefined,{revision:3}));
 assert.match(momentSummary(input),/outcome pending\. 2 recorded events/);
});

test('analyst copy adds sampled distance only for finite matching metric; fans get no geometry',()=>{
 const input=explanation([event('r',20,'recovery',false)]);
 input.metrics=[{kind:'nearest-opponent',unit:'metres',value:3.26,anchorId:'r'}];
 assert.match(momentSummary(input,'en','analyst'),/sampled moment: 3\.3 m/);
 assert.doesNotMatch(momentSummary(input),/opponent|3\.3/);
 input.metrics[0].anchorId='wrong';
 assert.doesNotMatch(momentSummary(input,'en','analyst'),/opponent/);
 input.metrics[0].anchorId='r';input.metrics[0].value=NaN;
 assert.doesNotMatch(momentSummary(input,'en','analyst'),/NaN|opponent/);
});

test('localized summaries preserve chronology without replacing unknown shot with a miss',()=>{
 const input=explanation([event('r',20,'recovery',false,{player:'J. Cole'}),event('p',22,'pass',true),event('s',28,'shot',undefined)]);
 for(const language of ['es','fr','pt']){
  const summary=momentSummary(input,language);
  assert.match(summary,/J\. Cole/);assert.match(summary,/8/);assert.match(summary,/1/);
  assert.ok(summary.startsWith(`${momentHeadline(input.sequence.at(-1),language)}.`));
  assert.doesNotMatch(summary,/without scoring|nearest|completed pass/);
 }
});

test('opposing recoveries at either event boundary suppress uninterrupted buildup',()=>{
 for(const time of [20,28]){
  const input=explanation([event('r',20,'recovery',false,{player:'J. Cole'}),
   event('p',22,'pass',true),event('opponent',time,'recovery',false,{team:'away'}),event('s',28,'shot',true)]);
  const text=momentSummary(input);
  assert.match(text,/1 completed pass in the preceding 15 seconds/);
  assert.doesNotMatch(text,/J\. Cole recovered|seconds before|between that recovery/);
 }
});

test('distinct own recoveries at the same latest time cannot arbitrarily supply a buildup boundary',()=>{
 const sequence=[event('r-a',20,'recovery',false,{player:'J. Cole'}),
  event('r-b',20,'recovery',false,{player:'M. Vale'}),event('p',22,'pass',true),event('s',28,'shot',true)];
 for(const records of [sequence,[...sequence].reverse()]){
  const text=momentSummary({...explanation(sequence),sequence:records});
  assert.doesNotMatch(text,/seconds before|between that recovery|J\. Cole recovered|M\. Vale recovered/);
  assert.match(text,/preceding 15 seconds/);
 }
});

test('repeated revisions of the same recovery are one boundary and a later unique recovery restores linkage',()=>{
 const input=explanation([event('r',20,'recovery',false,{player:'M. Vale'}),
  event('r',20,'recovery',false,{player:'J. Cole',revision:2}),event('p',22,'pass',true),event('s',28,'shot',true)]);
 assert.match(momentSummary(input),/J\. Cole recovered the ball 8 seconds/);
 input.sequence.push(event('tie',20,'recovery',false,{player:'M. Vale'}),
  event('later',24,'recovery',false,{player:'J. Cole'}),event('late-pass',26,'pass',true));
 const text=momentSummary(input);
 assert.match(text,/J\. Cole recovered the ball 4 seconds/);
 assert.match(text,/1 completed pass between that recovery and the shot/);
});

test('linked completed passes exclude both boundaries and unknown outcomes',()=>{
 const input=explanation([event('r',20,'recovery',false),event('at-recovery',20,'pass',true),
  event('p',22,'pass',true),event('pending',24,'pass',null),event('at-shot',28,'pass',true),event('s',28,'shot',true)]);
 const text=momentSummary(input);
 assert.match(text,/1 completed pass between that recovery and the shot/);
 assert.doesNotMatch(text,/2 completed|3 completed/);
});


test('live play follows passes and receptions with no future result or revision leak',async()=>{
 const {livePlayHeadline}=await import('./viewer-copy.js');
 const events=[{id:'p',revision:1,type:'pass',time:10,arrivedAt:10,player:'Cole',receiverId:'home-6',result:null},
 {id:'p',revision:2,type:'pass',time:10,arrivedAt:14,player:'Cole',result:true},
 {id:'r',revision:1,type:'receive',time:14,arrivedAt:14,player:'Costa'},
 {id:'s',revision:1,type:'shot',time:16,arrivedAt:16,player:'Costa',result:false,outcome:'saved'}];
 assert.equal(livePlayHeadline(events,9),null);
 assert.equal(livePlayHeadline(events,11,{players:[{id:'home-6',name:'Costa'}]}).title,'Cole passes to Costa');
 assert.match(livePlayHeadline(events,14).title,/Costa receives/);
 assert.doesNotMatch(livePlayHeadline(events,16).title,/saved|stopped/);
 assert.match(livePlayHeadline(events,17).title,/saved/);
});


test('live commentary describes dead-ball preparation and current custody instead of a stale shot',async()=>{
 const {livePlayHeadline}=await import('./viewer-copy.js');const records=[{id:'s',revision:1,type:'shot',time:16,arrivedAt:16,player:'Reed',result:false,outcome:'off-target'}];
 assert.equal(livePlayHeadline(records,25,{ballState:{kind:'dead-ball-collection'}}).title,'The goalkeeper prepares the goal kick');
 assert.equal(livePlayHeadline(records,20,{ballState:{kind:'dead-ball'}}).title,'The ball is out of play');
 assert.equal(livePlayHeadline(records,30,{players:[{id:'away-1',name:'Carter'}],ballState:{kind:'control',ownerId:'away-1'}}).title,'Carter has the ball');
});


test('live commentary identifies authored pass styles without guessing technique from geometry',()=>{
 const players=[{id:'home-10',name:'Reed'}];
 for(const [attributes,phrase] of [[{passType:'short'},'short pass'],[{passType:'long'},'long ball'],[{passType:'cross'},'crosses towards'],[{technique:'trivela'},'trivela pass']]){
  const row={id:'p',revision:1,operation:'upsert',type:'pass',time:2,arrivedAt:2,player:'Cole',receiverId:'home-10',result:null,...attributes};
  assert.ok(livePlayHeadline([row],2,{players}).title.includes(phrase));
 }
});


test('initial control does not report winning the ball from an opponent',()=>{
 const start=event('start',0,'recovery',false,{recoveryKind:'segment-start'});
 assert.equal(momentHeadline(start),'A. Reed starts with the ball');
 assert.equal(momentHeadline({...start,recoveryKind:'loose-ball'}),'A. Reed wins the ball');
 for(const language of ['es','fr','pt'])assert.notEqual(momentHeadline(start,language),momentHeadline({...start,recoveryKind:'loose-ball'},language));
});
