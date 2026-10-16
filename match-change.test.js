import test from 'node:test';
import assert from 'node:assert/strict';
import {matchChange} from './match-change.js';
import {comparisonFixture} from './comparison-fixture.js';
const shot=(id,time,extra={})=>({id,time,arrivedAt:time,revision:1,type:'shot',team:'home',result:false,outcome:'off-target',...extra});

test('continuous sustained passage compares exact full adjacent windows and all received support',()=>{
 const feed=comparisonFixture(),result=matchChange(feed.events,120);
 assert.equal(result.status,'insight');assert.deepEqual(result.signal,{team:'home',direction:'increase',delta:2});
 assert.equal(result.text,'Northbridge: 1 shot from 01:00 to 01:30, then 3 shots from 01:30 to 02:00.');
 assert.deepEqual([result.windows.previous.start,result.windows.previous.end,result.windows.recent.start,result.windows.recent.end],[60,90,90,120]);
 assert.equal(result.windows.previous.startInclusive,false);assert.equal(result.windows.previous.endInclusive,true);
 assert.ok(result.windows.recent.evidence.some(ref=>ref.id==='comparison-sustained-17-receive-104'),'Non-shot reception supports received window inventory');
 const previous=['flight-75@1','pass-62@2','pass-68@2','pass-80@2','pass-90@2','receive-72@1','receive-84@1',
  'recovery-66@1','recovery-76@1','shot-74@1'];
 const recent=['flight-107@1','flight-117@1','flight-97@1','pass-100@2','pass-102@2','pass-110@2',
  'receive-104@1','receive-114@1','receive-94@1','recovery-102@1','recovery-108@1','recovery-98@1',
  'shot-106@1','shot-116@2','shot-96@2'];
 assert.deepEqual(result.windows.previous.evidence.map(ref=>`${ref.id}@${ref.revision}`),previous.map(suffix=>`comparison-sustained-17-${suffix}`));
 assert.deepEqual(result.windows.recent.evidence.map(ref=>`${ref.id}@${ref.revision}`),recent.map(suffix=>`comparison-sustained-17-${suffix}`));
 assert.deepEqual(result.teams[0].shotEvidence.recent.map(ref=>[ref.id,ref.revision]),[
  ['comparison-sustained-17-shot-106',1],['comparison-sustained-17-shot-116',2],['comparison-sustained-17-shot-96',2]]);
 assert.equal(result.evidence.length,38);assert.equal(result.evidence.some(ref=>ref.id==='comparison-sustained-17-pass-118'),false,'No invented post-goal restart');
 assert.match(result.limitation,/not proof of feed completeness/);assert.doesNotMatch(result.text,/pressure|caused|momentum|dominat/i);
});

test('quiet, equal, insufficient change and incomplete windows abstain without narrative filler',()=>{
 for(const rows of [[],[shot('prior',70),shot('recent',100)],
  [shot('prior',70),shot('r1',100),shot('r2',110)],[shot('p1',70),shot('p2',80),shot('r',100)]]){
  const result=matchChange(rows,120);assert.equal(result.status,'abstain');assert.equal(result.text,null);assert.equal(result.signal,null);
 }
 assert.equal(matchChange(comparisonFixture(17,{scenario:'quiet'}).events,120).status,'abstain');
 const incomplete=matchChange([shot('one',20),shot('two',30)],59);
 assert.equal(incomplete.reason,'incomplete-windows');assert.equal(incomplete.scope.fullAdjacentWindows,false);assert.equal(incomplete.text,null);
});

test('minimum increase and meaningful disappearance thresholds select the strongest literal change',()=>{
 assert.equal(matchChange([shot('one',100),shot('two',110)],120).signal.delta,2);
 const decrease=matchChange([shot('one',70),shot('two',80)],120);
 assert.deepEqual(decrease.signal,{team:'home',direction:'decrease',delta:-2});
 const interrupted=matchChange(comparisonFixture(17,{scenario:'interrupted'}).events,120);
 assert.deepEqual(interrupted.signal,{team:'home',direction:'decrease',delta:-3});
 assert.equal(interrupted.teams[1].recentShots,2);assert.ok(interrupted.windows.recent.evidence.length>2);
});

test('correction, retiming and minimal deletion change comparison rather than accumulating history',()=>{
 const rows=[shot('previous',74),shot('a',96),shot('b',106),shot('c',116)],before=matchChange(rows,120);
 const corrected=matchChange([...rows,{...rows[1],revision:2,arrivedAt:120,outcome:'saved'}],120);
 assert.equal(corrected.teams[0].recentShots,3);assert.notEqual(before.key,corrected.key);
 assert.ok(corrected.windows.recent.evidence.some(ref=>ref.id==='a'&&ref.revision===2));
 const retimed=matchChange([...rows,{...rows[1],revision:2,time:86,arrivedAt:120}],120);
 assert.equal(retimed.teams[0].previousShots,2);assert.equal(retimed.teams[0].recentShots,2);assert.equal(retimed.status,'abstain');
 const deleted=matchChange([...rows,{id:'a',revision:2,time:96,arrivedAt:120,operation:'delete'}],120);
 assert.equal(deleted.teams[0].recentShots,2);assert.equal(deleted.status,'abstain');assert.notEqual(deleted.key,before.key);
});

test('boundaries are open on the left, closed on the right and future arrivals cannot influence comparison',()=>{
 const rows=[shot('start',60),shot('split',90),shot('recent',100),shot('end',120)];
 const result=matchChange(rows,120);assert.equal(result.teams[0].previousShots,1);assert.equal(result.teams[0].recentShots,2);
 assert.equal(result.windows.previous.evidence.some(ref=>ref.id==='start'),false);
 assert.equal(result.windows.previous.evidence.some(ref=>ref.id==='split'),true);assert.equal(result.windows.recent.evidence.some(ref=>ref.id==='split'),false);
 const future=[...rows,shot('late',75,{arrivedAt:121}),shot('future',125)];
 assert.deepEqual(matchChange(future,120),result);
});

test('four languages preserve evidence and counts, and keys include absence-supporting non-shot inventory',()=>{
 const rows=[shot('one',100),shot('two',110)],english=matchChange(rows,120);
 for(const language of ['en','es','fr','pt']){
  const result=matchChange(rows,120,{language});assert.equal(result.status,'insight');assert.ok(result.text.includes('02:00'));
  assert.deepEqual(result.evidence,english.evidence);assert.deepEqual(result.teams,english.teams);assert.equal(result.key,english.key);
 }
 const receipt={id:'receipt',type:'receive',team:'away',revision:1,time:80,arrivedAt:80};
 assert.notEqual(matchChange([...rows,receipt],120).key,english.key);
 assert.ok(matchChange([...rows,receipt],120).windows.previous.evidence.some(ref=>ref.id==='receipt'));
});

test('conflicting revisions and invalid bounds fail closed without mutating source data',()=>{
 const rows=[shot('one',100),shot('two',110)],saved=structuredClone(rows),result=matchChange(rows,120);
 result.evidence[0].revision=999;result.teams[0].shotEvidence.recent[0].id='changed';assert.deepEqual(rows,saved);
 assert.throws(()=>matchChange([...rows,{...rows[0],result:true}],120),/Conflicting/);
 for(const windowSeconds of [0,-1,Infinity,601])assert.throws(()=>matchChange(rows,120,{windowSeconds}));
 assert.throws(()=>matchChange(Array(10001).fill(rows[0]),120));
});

test('an anchored comparison receives later corrections without counting later event times',()=>{
 const feed=comparisonFixture(),anchorTime=116;
 const atAnchor=matchChange(feed.events,anchorTime),corrected=matchChange(feed.events,anchorTime,{observedAt:120});
 assert.deepEqual(corrected.signal,atAnchor.signal);
 assert.ok(atAnchor.evidence.some(ref=>ref.id==='comparison-sustained-17-shot-116'&&ref.revision===1));
 assert.ok(corrected.evidence.some(ref=>ref.id==='comparison-sustained-17-shot-116'&&ref.revision===2));
 assert.equal(corrected.evidence.some(ref=>ref.id==='comparison-sustained-17-pass-118'),false);
 assert.equal(corrected.windows.recent.end,116);assert.equal(corrected.scope.observedAt,120);
 assert.notEqual(corrected.key,atAnchor.key);
 assert.throws(()=>matchChange(feed.events,116,{observedAt:115}));
});
