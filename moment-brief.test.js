import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRequest} from './ai.js';
import {momentBrief,briefCoverage} from './moment-brief.js';
test('writing brief uses received chronology and follows scorer corrections',()=>{
 const early=momentBrief(buildRequest({time:169,anchorId:'EV-017'}).explanation);
 assert.match(early.facts[1].text,/9 seconds/);
 assert.deepEqual(early.facts[1].evidence,[{id:'EV-015',revision:1},{id:'EV-017',revision:1}]);
 const corrected=momentBrief(buildRequest({time:190,anchorId:'EV-017'}).explanation);
 assert.match(corrected.facts[0].text,/J. Cole/);
 assert.ok(corrected.facts.flatMap(f=>f.evidence).filter(r=>r.id==='EV-017').every(r=>r.revision===2));
 const coverage=briefCoverage({claims:[{evidence:[{id:'EV-017',revision:2}]}]},corrected);
 assert.equal(coverage.citedBuildupFacts,0);assert.ok(coverage.warning);
 assert.equal(briefCoverage({claims:[{evidence:corrected.facts.flatMap(f=>f.evidence)}]},corrected).warning,null);
 const scattered=briefCoverage({claims:corrected.facts.flatMap(f=>f.evidence).map(r=>({evidence:[r]}))},corrected);
 assert.equal(scattered.citedBuildupFacts,0);assert.ok(scattered.warning);
});
test('a possession change prevents linking an earlier recovery to the moment',()=>{
 const explanation={anchorId:'shot',sequence:[{id:'recover',revision:1,type:'recovery',team:'home',player:'A',time:1},{id:'lost',revision:1,type:'recovery',team:'away',player:'B',time:2},{id:'shot',revision:1,type:'shot',team:'home',player:'C',time:3,result:null}]};
 const brief=momentBrief(explanation);
 assert.equal(brief.facts.length,1);assert.match(brief.facts[0].text,/outcome pending/);
 assert.equal(momentBrief({...explanation,task:'recap'}),null);
});

test('writing briefs suppress ambiguous recovery boundaries and count only strictly earlier passes',()=>{
 const anchor={id:'shot',revision:1,type:'shot',team:'home',player:'C',time:4,result:true};
 const recovery={id:'recover',revision:1,type:'recovery',team:'home',player:'A',time:1};
 for(const time of [1,4]){
  const brief=momentBrief({anchorId:anchor.id,sequence:[recovery,{id:'opponent',revision:1,type:'recovery',team:'away',player:'B',time},anchor]});
  assert.equal(brief.facts.filter(f=>f.kind==='buildup').length,0);
 }
 const ambiguous=momentBrief({anchorId:anchor.id,sequence:[recovery,{...recovery,id:'tie'},anchor]});
 assert.equal(ambiguous.facts.length,1);
 const withShotTimePass=momentBrief({anchorId:anchor.id,sequence:[recovery,{id:'pass',revision:1,type:'pass',team:'home',player:'A',time:4,result:true},anchor]});
 assert.equal(withShotTimePass.facts.length,2);assert.match(withShotTimePass.facts[1].text,/3 seconds/);
});
