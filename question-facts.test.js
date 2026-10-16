import test from 'node:test';
import assert from 'node:assert/strict';
import {buildQuestionFacts,selectQuestionFacts} from './question-facts.js';
import {numericAssertions} from './question-evidence-check.js';
const reference=(id,type='scope',revision=1)=>({type,id,revision});
const query=(id,filters,groups,{aggregate='by-player',count=groups.reduce((n,g)=>n+g.count,0),from=0,to=120,...rest}={})=>({scopeReference:reference(id),query:{filters,aggregate,timeFrom:from,timeTo:to},count,groups,rows:[],truncated:false,scope:{missingFields:{}},entityResolution:{},...rest});
const packet=()=>({question:'What happened?',responseLanguage:'en',observedAt:120,teams:{home:'Northbridge',away:'Harbour Athletic'},roster:[{id:'reed',name:'A. Reed',team:'home'},{id:'silva',name:'B. Silva',team:'away'}],mentionedPlayerResolution:[{status:'resolved',canonicalId:'reed'}],queryResults:[],requestedEvidence:[]});
const row=(overrides={})=>({id:'pass',revision:2,type:'pass',time:62,arrivedAt:66,team:'away',playerId:'silva',player:'B. Silva',receiverId:'reed',result:false,outcome:null,evidence:[reference('pass','event',2)],...overrides});

test('ordered event facts subsume only the same revision and explicitly rendered attribute',()=>{
 const p=packet(),shot=row({id:'shot',type:'shot',team:'home',playerId:'reed',player:'A. Reed',result:false,outcome:'saved',bodyPart:'left-foot'});
 p.requestedEvidence=[query('last-left',{type:'shot',bodyPart:'left-foot'},[],{aggregate:'list',count:1,rows:[shot]})];p.requestedEvidence[0].query.order='desc';p.requestedEvidence[0].query.limit=1;
 const m=buildQuestionFacts(p),ordered=m.facts.find(f=>f.proof.kind==='ordered-event'),atoms=m.facts.filter(f=>f.proof.kind==='event');assert.ok(ordered);assert.equal(atoms.length,2);
 const selected=selectQuestionFacts(m,[ordered.id,...atoms.map(f=>f.id)]);assert.equal(selected.claims.length,1);assert.deepEqual(selected.originalToSelectedIndex,[0,0,0]);assert.match(selected.claims[0].text,/left foot.*saved/);
 const bad=structuredClone(m);bad.facts.find(f=>f.id===ordered.id).proof.query.filters.bodyPart='right-foot';assert.equal(selectQuestionFacts(bad,[ordered.id,...atoms.map(f=>f.id)]).claims.length,2);
});

test('saved-shot collection counts require both the hold and linked saved outcome',()=>{
 const p=packet();p.queryResults=[query('saves',{type:'recovery',recoveryKind:'goalkeeper-hold',linkedShotOutcome:'saved'},[{key:'silva',count:1}])];
 const fact=buildQuestionFacts(p).facts.find(f=>f.proof.metric==='savedAttemptCollections');assert.ok(fact);assert.match(fact.claim.text,/collected 1 saved shot/);
 p.queryResults[0].scope.missingFields.linkedShotOutcome=1;assert.equal(buildQuestionFacts(p).facts.some(f=>f.proof.metric==='savedAttemptCollections'),false);
});

test('pass completion profiles use matching confirmed partitions and exclude pending outcomes',()=>{
 const p=packet();p.queryResults=[query('completed',{type:'pass',result:true},[{key:'reed',count:5}]),query('failed',{type:'pass',result:false},[{key:'reed',count:1}]),query('pending',{type:'pass',result:null},[{key:'reed',count:2}])];
 const f=buildQuestionFacts(p).facts.find(f=>f.proof.kind==='pass-completion-profile');assert.ok(f);assert.equal(f.proof.denominator,6);assert.equal(f.proof.percentage,83.3);assert.match(f.claim.text,/83.3%.*5 of 6.*confirmed/);assert.equal(f.proof.pendingExcluded,true);assert.equal(f.claim.evidence.length,2);
 for(const mutate of [q=>q.query.timeFrom=30,q=>q.scope.missingFields.result=1,q=>q.truncated=true]){const bad=structuredClone(p);mutate(bad.queryResults[1]);assert.equal(buildQuestionFacts(bad).facts.some(f=>f.proof.kind==='pass-completion-profile'),false);}
});

test('a saved-shot collection omits an equal ball-win total only for the same actor and window',()=>{
 const p=packet();p.queryResults=[query('saved',{type:'recovery',recoveryKind:'goalkeeper-hold',linkedShotOutcome:'saved'},[{key:'silva',count:1}]),query('wins',{type:'recovery',recoveryClass:'ball-win'},[{key:'silva',count:1}])];
 const m=buildQuestionFacts(p),save=m.facts.find(f=>f.proof.metric==='savedAttemptCollections'&&f.proof.subjectId==='silva'),win=m.facts.find(f=>f.proof.metric==='ballWins'&&f.proof.subjectId==='silva');assert.ok(save&&win);
 assert.equal(selectQuestionFacts(m,[save.id,win.id]).claims.length,1);
 for(const mutate of [f=>f.proof.value=2,f=>f.proof.timeFrom=30,f=>f.proof.subjectId='reed']){const bad=structuredClone(m);mutate(bad.facts.find(f=>f.id===win.id));assert.equal(selectQuestionFacts(bad,[save.id,win.id]).claims.length,2);}
});

test('a capability limitation requires explicit schema unavailability, not an empty action list',()=>{
 for(const language of ['en','es','fr','pt']){
  const p={...packet(),responseLanguage:language,requestedForm:'explanation',evidenceCapabilities:{unavailable:['player intention','verified open passing lanes']}};
  const fact=buildQuestionFacts(p).facts.find(f=>f.proof.kind==='capability-limitation');assert.ok(fact);assert.equal(fact.claim.kind,'limitation');assert.deepEqual(fact.claim.evidence,[]);assert.equal(fact.proof.basis,'trusted-event-schema');assert.equal(selectQuestionFacts(buildQuestionFacts(p),[fact.id]).claims[0].text,fact.claim.text);
  delete p.evidenceCapabilities;assert.equal(buildQuestionFacts(p).facts.length,0);
 }
});

test('natural final-pass wording requires the executed current goal relation and preserves ordering proof',()=>{
 const p=packet(),pass=row({result:true,receiverId:null}),goal=row({id:'goal',type:'shot',time:100,result:true,passId:'pass',receiverId:null,evidence:[reference('goal','event',2)]});
 const q=query('before',{type:'pass',team:'away'},[],{aggregate:'list',count:1,to:100,rows:[pass]});Object.assign(q.query,{order:'desc',limit:1,timeToExclusive:true});
 p.requestedEvidence=[q];p.queryResults=[query('anchor',{id:'goal'},[],{aggregate:'list',count:1,rows:[goal]})];p.requestedMoment={reference:reference('goal','event',2),time:100};
 p.queryRelations=[{anchorIdentifiedBy:'requested-moment',relation:'before',sameTeam:true,scopeReference:q.scopeReference,anchor:p.requestedMoment.reference,anchorTime:100}];
 const fact=buildQuestionFacts(p).facts.find(f=>f.proof.kind==='ordered-event');assert.match(fact.claim.text,/^Last pass before the goal:/);assert.equal(fact.proof.timeToExclusive,true);assert.equal(fact.proof.scope.id,'before');
 for(const mutate of [p=>p.requestedMoment.reference.revision=3,p=>p.queryResults[0].rows[0].passId='other',p=>p.queryRelations[0].sameTeam=false]){const bad=structuredClone(p);mutate(bad);assert.doesNotMatch(buildQuestionFacts(bad).facts.find(f=>f.proof.kind==='ordered-event').claim.text,/^Last pass before the goal:/);}
});

test('ball-win scopes are distinct from raw recovery provenance and unknown classifications withhold completeness',()=>{
 const p=packet();p.queryResults=[query('raw',{type:'recovery'},[{key:'reed',count:2}]),query('wins',{type:'recovery',recoveryClass:'ball-win'},[{key:'reed',count:1}])];
 let facts=buildQuestionFacts(p).facts;const raw=facts.find(f=>f.proof.metric==='recoveries'),win=facts.find(f=>f.proof.metric==='ballWins');
 assert.match(raw.claim.text,/2 recovery records/);assert.doesNotMatch(raw.claim.text,/ball win/);assert.match(win.claim.text,/1 ball win/);assert.equal(win.claim.evidence[0].id,'wins');assert.equal(win.proof.query.filters.recoveryClass,'ball-win');
 p.queryResults[1].scope.missingFields.recoveryClass=1;assert.equal(buildQuestionFacts(p).facts.some(f=>f.proof.metric==='ballWins'),false);
 p.queryResults=[query('events',{type:'recovery'},[],{aggregate:'list',count:2,rows:[row({id:'start',type:'recovery',recoveryKind:'segment-start'}),row({id:'unknown',type:'recovery'})]})];
 facts=buildQuestionFacts(p).facts;assert.equal(facts.length,1);assert.match(facts[0].claim.text,/starts with the ball/);assert.equal(facts[0].proof.eventId,'start');
});

test('both-team zero-goal composite needs complete matching confirmed scopes and retains both proofs',()=>{
 const p=packet();p.queryResults=[query('home',{type:'shot',result:true,team:'home'},[],{aggregate:'count'}),query('away',{type:'shot',result:true,team:'away'},[],{aggregate:'count'})];
 const fact=buildQuestionFacts(p).facts.find(f=>f.proof.kind==='confirmed-score');assert.ok(fact);assert.match(fact.claim.text,/Neither team has a confirmed goal yet/);assert.deepEqual(fact.claim.evidence.map(r=>r.id),['home','away']);assert.equal(fact.proof.operands.length,2);
 for(const mutate of [q=>q.query.timeTo=90,q=>q.query.timeFrom=30,q=>q.query.timeFromExclusive=true,q=>q.scope.missingFields.result=1,q=>q.truncated=true,q=>q.count=1,q=>q.query.filters={type:'shot',outcome:'pending',team:'away'}]){
  const bad=structuredClone(p);mutate(bad.queryResults[1]);assert.equal(buildQuestionFacts(bad).facts.some(f=>f.proof.kind==='confirmed-score'),false);
 }
 p.queryResults.forEach(q=>q.query.timeTo=30);const historical=buildQuestionFacts(p).facts.find(f=>f.proof.kind==='confirmed-score');assert.match(historical.claim.text,/00:00.*00:30.*in this interval/);assert.doesNotMatch(historical.claim.text,/yet/);
});

function zeroSelectionFixture(){
 const p=packet();p.queryResults=[query('goals',{type:'shot',result:true},[],{aggregate:'by-team'}),query('pending',{type:'shot'},[],{aggregate:'list',count:1,rows:[row({id:'pending',type:'shot',result:null})]})];
 const manifest=buildQuestionFacts(p),composite=manifest.facts.find(f=>f.proof.kind==='confirmed-score'),home=manifest.facts.find(f=>f.proof.kind==='count'&&f.proof.subjectId==='home'),away=manifest.facts.find(f=>f.proof.kind==='count'&&f.proof.subjectId==='away'),pending=manifest.facts.find(f=>f.proof.kind==='event');
 return {p,manifest,composite,home,away,pending};
}

test('selected exact zero-score composite dominates its atomic operands with a stable audited index map',()=>{
 const {manifest,composite,home,away,pending}=zeroSelectionFixture();
 assert.deepEqual(composite.proof.componentFactIds,[home.id,away.id]);
 for(const [ids,expected,map] of [
  [[home.id,composite.id,away.id],[composite.id],[0,0,0]],
  [[pending.id,away.id,composite.id,home.id],[pending.id,composite.id],[0,1,1,1]],
  [[away.id,pending.id,home.id,composite.id],[pending.id,composite.id],[1,0,1,1]],
  [[composite.id,home.id,pending.id],[composite.id,pending.id],[0,0,1]]
 ]){
  const before=structuredClone(manifest),selection=selectQuestionFacts(manifest,ids);
  assert.deepEqual(selection.requestedFactIds,ids);assert.deepEqual(selection.selectedFactIds,expected);assert.deepEqual(selection.originalToSelectedIndex,map);assert.deepEqual(manifest,before);
  assert.deepEqual(selection.claims,expected.map(id=>manifest.facts.find(f=>f.id===id).claim));
  assert.ok(selection.normalizations.every(item=>item.coveredByFactId===composite.id&&item.reason==='exact-composite-operand'));
  assert.equal(selection.normalizations.length,ids.length-expected.length);assert.ok(Object.isFrozen(selection.normalizations));assert.ok(Object.isFrozen(selection.originalToSelectedIndex));
 }
 const selection=selectQuestionFacts(manifest,[home.id,composite.id,away.id]);
 const remapped=[...new Set([0,2].map(index=>selection.originalToSelectedIndex[index]))];assert.deepEqual(remapped,[0]);
 assert.deepEqual(selection.proofs[0].operands,composite.proof.operands);assert.deepEqual(selection.claims[0].evidence,composite.claim.evidence);
});

test('selection never introduces an unselected composite or drops a pending event',()=>{
 const {manifest,home,away,pending}=zeroSelectionFixture(),ids=[home.id,pending.id,away.id];
 const selection=selectQuestionFacts(manifest,ids);assert.deepEqual(selection.selectedFactIds,ids);assert.deepEqual(selection.originalToSelectedIndex,[0,1,2]);assert.deepEqual(selection.normalizations,[]);
 assert.deepEqual(selectQuestionFacts(manifest,[]).originalToSelectedIndex,[]);
});

test('a selected shooting profile dominates only its exact selected operands, never a different time interval',()=>{
 const p=packet(),attempt=query('attempts',{type:'shot'},[{key:'reed',count:2}]),target=query('targets',{type:'shot',outcome:'on-target'},[{key:'reed',count:1}]);
 p.queryResults=[attempt,target];const manifest=buildQuestionFacts(p),profile=manifest.facts.find(f=>f.proof.kind==='shooting-profile'),atoms=manifest.facts.filter(f=>f.proof.kind==='count');
 const chosen=selectQuestionFacts(manifest,[atoms[0].id,profile.id,atoms[1].id]);assert.deepEqual(chosen.selectedFactIds,[profile.id]);assert.deepEqual(chosen.originalToSelectedIndex,[0,0,0]);assert.equal(chosen.normalizations.length,2);
 for(const mutate of [q=>q.query.timeFrom=30,q=>q.query.timeFromExclusive=true,q=>q.scopeReference.id='different-proof']){
  const extra=structuredClone(attempt);extra.scopeReference.id='separate-scope';mutate(extra);p.requestedEvidence=[extra];const next=buildQuestionFacts(p),original=next.facts.find(f=>f.id===profile.id),other=next.facts.find(f=>f.proof.kind==='count'&&f.proof.scope.id===extra.scopeReference.id&&JSON.stringify(f.proof)!==JSON.stringify(atoms[0].proof));
  assert.ok(original);
  assert.ok(other);assert.deepEqual(selectQuestionFacts(next,[original.id,other.id]).selectedFactIds,[original.id,other.id]);
 }
});

test('body-part facts copy only the current recorded attribute and never infer force, technique or preferred foot',()=>{
 for(const language of ['en','es','fr','pt'])for(const bodyPart of ['left-foot','right-foot','head']){
  const p=packet();p.responseLanguage=language;p.queryResults=[query('attribute',{type:'pass'},[],{aggregate:'list',count:1,rows:[row({bodyPart,technique:'trivela'})]})];
  const attribute=buildQuestionFacts(p).facts.find(f=>f.proof.attributes);assert.ok(attribute);assert.deepEqual(attribute.proof.attributes,{bodyPart});assert.equal(attribute.proof.eventId,'pass');assert.equal(attribute.claim.evidence[0].revision,2);assert.doesNotMatch(attribute.claim.text,/power|speed|force|trivela|preferred/);
  delete p.queryResults[0].rows[0].bodyPart;assert.equal(buildQuestionFacts(p).facts.some(f=>f.proof.attributes),false,'Technique alone never establishes a body part');
 }
});

test('equal counts do not establish dominance across different scope identities, windows or metrics',()=>{
 for(const mutate of [q=>q.scopeReference.id='other',q=>q.scopeReference.revision=2,q=>q.query.timeTo=90,q=>q.query.timeFromExclusive=true,q=>q.query.filters={type:'recovery'},q=>q.query.filters={type:'recovery',recoveryClass:'ball-win'}]){
  const {p}=zeroSelectionFixture(),extra=structuredClone(p.queryResults[0]);extra.scopeReference.id='other';mutate(extra);p.queryResults.push(extra);
  const manifest=buildQuestionFacts(p),composite=manifest.facts.find(f=>f.proof.kind==='confirmed-score'&&f.proof.operands[0].scope.id==='goals'&&f.proof.operands[0].scope.revision===1);
  const atom=manifest.facts.find(f=>f.proof.kind==='count'&&f.proof.subjectId==='home'&&!composite.proof.componentFactIds.includes(f.id));assert.ok(atom);
  const selection=selectQuestionFacts(manifest,[composite.id,atom.id]);assert.deepEqual(selection.selectedFactIds,[composite.id,atom.id]);assert.deepEqual(selection.normalizations,[]);
 }
});

test('malformed coverage edges cannot remove an atomic proof and raw selection validation runs first',()=>{
 const {manifest,composite,home,away}=zeroSelectionFixture();
 for(const mutate of [p=>p.operands[0].value=1,p=>p.operands[0].scope.revision=2,p=>p.operands[0].query.filters={type:'shot',outcome:'pending'},p=>p.componentFactIds=[home.id,home.id],p=>p.operands[0].timeFromExclusive=true,p=>p.home=1,p=>p.kind='shooting-profile']){
  const altered=structuredClone(manifest);mutate(altered.facts.find(f=>f.id===composite.id).proof);
  const selection=selectQuestionFacts(altered,[composite.id,home.id]);assert.deepEqual(selection.selectedFactIds,[composite.id,home.id]);
 }
 for(const ids of [[home.id,composite.id,home.id],[composite.id,'unknown'],Array(9).fill(home.id),new Array(1)])assert.throws(()=>selectQuestionFacts(manifest,ids),RangeError);
 const bounded=structuredClone(manifest);bounded.facts=bounded.facts.filter(f=>f.id!==away.id);
 assert.deepEqual(selectQuestionFacts(bounded,[composite.id]).selectedFactIds,[composite.id]);assert.throws(()=>selectQuestionFacts(bounded,[composite.id,away.id]),RangeError);
});

test('natural multilingual facts keep explicit pending outcomes, profile operands and a single historical window',()=>{
 for(const language of ['en','es','fr','pt']){
  const p=packet();p.responseLanguage=language;p.queryResults=[query('attempts',{type:'shot'},[{key:'reed',count:2}],{to:30}),query('target',{type:'shot',outcome:'on-target'},[{key:'reed',count:1}],{to:30}),query('pending',{type:'shot'},[],{aggregate:'list',count:1,rows:[row({id:'pending',type:'shot',result:null,time:116,arrivedAt:116})]})];
  const facts=buildQuestionFacts(p).facts,profile=facts.find(f=>f.proof.kind==='shooting-profile'),pending=facts.find(f=>f.proof.kind==='event');
  assert.ok(profile);assert.deepEqual(profile.proof.operands.map(x=>x.value),[2,1]);assert.equal(profile.claim.text.match(/00:30/g).length,1);assert.equal(profile.claim.evidence.length,2);
  assert.match(pending.claim.text,/01:56/);assert.match(pending.claim.text,/pending|pendiente|en attente|pendente/);assert.equal(pending.proof.actionOutcome.status,'pending');
  p.queryResults.push(query('goals',{type:'shot',result:true},[],{aggregate:'by-team'}));const zero=buildQuestionFacts(p).facts.find(f=>f.proof.kind==='confirmed-score');assert.ok(zero);assert.match(zero.claim.text,/confirmed|confirmado|confirmé/);assert.equal(zero.proof.home,0);assert.equal(zero.proof.away,0);
 }
});

test('exclusive bounds remain explicit and cannot combine with inclusive profiles or admit boundary endpoints',()=>{
 const p=packet(),attempt=query('shots',{type:'shot'},[{key:'reed',count:1}],{from:30,to:90}),target=query('target',{type:'shot',outcome:'on-target'},[{key:'reed',count:1}],{from:30,to:90});
 attempt.query.timeFromExclusive=true;p.queryResults=[attempt,target];assert.equal(buildQuestionFacts(p).facts.some(f=>f.proof.kind==='shooting-profile'),false);
 target.query.timeFromExclusive=true;target.query.timeToExclusive=true;attempt.query.timeToExclusive=true;
 for(const language of ['en','es','fr','pt']){p.responseLanguage=language;const profile=buildQuestionFacts(p).facts.find(f=>f.proof.kind==='shooting-profile');assert.ok(profile);assert.equal(profile.proof.timeFromExclusive,true);assert.equal(profile.proof.timeToExclusive,true);assert.match(profile.claim.text,/After|Después|Après|Depois/);assert.match(profile.claim.text,/before|antes|avant/);}
 const endpoint=query('endpoint',{type:'pass'},[],{aggregate:'list',count:1,rows:[row({time:62,arrivedAt:66})],from:62});endpoint.query.limit=1;endpoint.query.timeFromExclusive=true;p.queryResults=[];p.requestedEvidence=[endpoint];assert.equal(buildQuestionFacts(p).facts.some(f=>f.proof.kind==='ordered-event'),false);
 endpoint.query.timeFrom=61;assert.ok(buildQuestionFacts(p).facts.some(f=>f.proof.kind==='ordered-event'));
 endpoint.query.timeTo=62;endpoint.query.timeToExclusive=true;assert.equal(buildQuestionFacts(p).facts.some(f=>f.proof.kind==='ordered-event'),false);
});

test('a complete empty list proves only its exact supported metric, identity and strict window absence',()=>{
 const p=packet(),q=query('empty',{type:'shot',team:'away'},[],{aggregate:'list',count:0,rows:[],from:92});q.query.timeFromExclusive=true;q.query.limit=1;p.requestedEvidence=[q];
 const fact=buildQuestionFacts(p).facts[0];assert.equal(fact.proof.kind,'count');assert.equal(fact.proof.value,0);assert.equal(fact.proof.subjectId,'away');assert.equal(fact.proof.timeFromExclusive,true);assert.match(fact.claim.text,/After 01:32 through 02:00: Harbour Athletic has 0 shots/);assert.equal(fact.claim.evidence[0].id,'empty');
 for(const mutate of [s=>s.truncated=true,s=>s.scope.missingFields.type=1,s=>s.count=1,s=>s.rows=[row()],s=>s.query.filters.player='unknown',s=>s.query.filters.bodyPart='left-foot']){
  const bad=structuredClone(q);mutate(bad);p.requestedEvidence=[bad];assert.equal(buildQuestionFacts(p).facts.some(f=>f.proof.kind==='count'),false);
 }
});

test('numeric assertion descriptors preserve repeated occurrences, positions and application values',()=>{
 const answer={claims:[{kind:'observation',text:'No goals, and zero goals.'},{kind:'general',text:'A brace is two goals.'},{kind:'observation',text:'At 01:56, but the outcome is pending.'}]};
 const result=numericAssertions(answer);assert.equal(result.length,1);assert.deepEqual(result[0].assertions.map(x=>[x.assertionIndex,x.text,x.value]),[[0,'No goals',0],[1,'zero goals',0]]);
 assert.ok(result[0].assertions[1].index>result[0].assertions[0].index);assert.equal(answer.claims[0].text,'No goals, and zero goals.');
});

test('count and compact shooting profiles preserve both complete operands and scoped identity',()=>{
 const p=packet();p.queryResults=[query('shots',{type:'shot'},[{key:'reed',count:2},{key:'silva',count:3}]),query('target',{type:'shot',outcome:'on-target'},[{key:'reed',count:2},{key:'silva',count:1}])];
 const manifest=buildQuestionFacts(p),profiles=manifest.facts.filter(f=>f.proof.kind==='shooting-profile');assert.equal(profiles.length,2);
 assert.match(profiles[0].claim.text,/has taken 2 shots, 2 on target/);assert.match(profiles[1].claim.text,/has taken 3 shots, 1 on target/);
 assert.equal(profiles[0].claim.evidence.length,2);assert.deepEqual(profiles[1].proof.operands.map(o=>o.value),[3,1]);
 const selected=selectQuestionFacts(manifest,[profiles[1].id]);assert.equal(selected.modelGenerated,false);assert.deepEqual(selected.claims,[profiles[1].claim]);assert.ok(Object.isFrozen(selected.claims[0].evidence));
 assert.throws(()=>selectQuestionFacts(manifest,['invented']));assert.throws(()=>selectQuestionFacts(manifest,[profiles[0].id,profiles[0].id]));assert.throws(()=>selectQuestionFacts(manifest,[{id:profiles[0].id,value:99}]));
});

test('zero facts are bounded to eligible named players and teams, never unknown identities',()=>{
 const p=packet();for(let n=0;n<20;n++)p.roster.push({id:'extra'+n,name:'Extra '+n,team:'home'});
 p.queryResults=[query('shots',{type:'shot'},[]),query('goals',{type:'shot',result:true},[],{aggregate:'by-team'})];
 const facts=buildQuestionFacts(p).facts.filter(f=>f.proof.kind==='count');assert.equal(facts.length,3);assert.ok(facts.every(f=>['reed','home','away'].includes(f.proof.subjectId)));
 p.mentionedPlayerResolution=[{status:'absent',canonicalId:'messi'}];assert.equal(buildQuestionFacts(p).facts.filter(f=>f.proof.kind==='count'&&f.proof.metric==='attempts').length,0);
});

test('unknown classifications, truncation, subset filters, invalid group arithmetic and windows omit facts',()=>{
 for(const mutate of [q=>q.truncated=true,q=>q.scope.missingFields.result=1,q=>delete q.scope.missingFields,q=>q.query.filters.bodyPart='left-foot',q=>q.query.groupCount={min:1},q=>q.count=9,q=>q.groups[0].key='unknown',q=>q.query.timeTo=121,q=>q.query.timeFrom=-1,q=>q.entityResolution={player:{status:'ambiguous'}},q=>q.query.filters.player='silva']){
  const p=packet(),q=query('shots',{type:'shot'},[{key:'reed',count:2}]);mutate(q);p.queryResults=[q];assert.equal(buildQuestionFacts(p).facts.length,0);
 }
 const p=packet();p.queryResults=[query('recent',{type:'shot'},[{key:'reed',count:1}],{from:90,to:120})];assert.match(buildQuestionFacts(p).facts[0].claim.text,/01:30.*02:00/);
});

test('credited assists require explicit complete credit coverage rather than goals or pass links',()=>{
 const p=packet();p.queryResults=[query('assists',{type:'shot',result:true},[{key:'reed',count:1}],{aggregate:'by-assister'})];
 assert.equal(buildQuestionFacts(p).facts[0].proof.metric,'creditedAssists');p.queryResults[0].scope.missingFields.assistPlayer=1;
 assert.equal(buildQuestionFacts(p).facts.length,0);
});

test('a particular goal assist needs explicit same-team credit on that confirmed current goal',()=>{
 const p=packet();p.roster.push({id:'cole',name:'J. Cole',team:'home'});
 const goal=row({id:'goal',type:'shot',team:'home',playerId:'reed',result:true,outcome:'goal',assist:{playerId:'cole',passId:'earlier'}});
 p.queryResults=[query('goal',{type:'shot'},[],{aggregate:'list',count:1,rows:[goal]})];
 let facts=buildQuestionFacts(p).facts.filter(f=>f.proof.kind==='credited-goal-assist');assert.equal(facts.length,1);assert.match(facts[0].claim.text,/J\. Cole.*A\. Reed/);assert.equal(facts[0].claim.evidence[0].id,'goal');
 for(const mutate of [r=>r.result=false,r=>r.result=null,r=>delete r.assist,r=>r.assist.playerId='silva',r=>r.assist.playerId='unknown',r=>r.assist.playerId='reed']){
  p.queryResults[0].rows=[structuredClone(goal)];mutate(p.queryResults[0].rows[0]);assert.equal(buildQuestionFacts(p).facts.some(f=>f.proof.kind==='credited-goal-assist'),false);
 }
});

test('threshold facts enumerate only fully returned qualifying groups and never use the prefilter total',()=>{
 const p=packet(),q=query('threshold',{type:'shot'},[{key:'silva',count:3}],{count:5});q.query.groupCount={min:3};q.matchedGroupCount=1;p.requestedEvidence=[q];
 let facts=buildQuestionFacts(p).facts.filter(f=>f.proof.kind==='qualifying-groups');assert.equal(facts.length,1);assert.match(facts[0].claim.text,/at least 3 shots: B\. Silva \(3\)/);assert.doesNotMatch(facts[0].claim.text,/5/);
 for(const mutate of [s=>s.truncated=true,s=>s.matchedGroupCount=2,s=>s.groups[0].count=2,s=>s.scope.missingFields.type=1,s=>s.groups[0].key='unknown',s=>s.count=1]){
  const bad=structuredClone(q);mutate(bad);p.requestedEvidence=[bad];assert.equal(buildQuestionFacts(p).facts.some(f=>f.proof.kind==='qualifying-groups'),false);
 }
 const empty=structuredClone(q);empty.groups=[];empty.matchedGroupCount=0;p.requestedEvidence=[empty];facts=buildQuestionFacts(p).facts.filter(f=>f.proof.kind==='qualifying-groups');assert.equal(facts.length,1);assert.match(facts[0].claim.text,/none/);assert.doesNotMatch(facts[0].claim.text,/0 shots/);
});

test('event outcomes preserve false, pending and absent distinctions without inventing reception',()=>{
 const p=packet();p.queryResults=[query('event',{type:'pass'},[],{aggregate:'list',count:1,rows:[row()]})];
 let facts=buildQuestionFacts(p).facts;assert.equal(facts.length,1);assert.match(facts[0].claim.text,/unsuccessful/);assert.doesNotMatch(facts[0].claim.text,/Reed|receiv|pending/);assert.equal(facts[0].proof.actionOutcome.status,'failed');
 p.queryResults[0].rows[0].result=null;facts=buildQuestionFacts(p).facts;assert.match(facts[0].claim.text,/pending/);
 p.queryResults[0].rows[0].actionOutcome={status:'unknown',basis:'result-absent'};assert.equal(buildQuestionFacts(p).facts.length,0,'Raw source absence overrides normalized null');
 delete p.queryResults[0].rows[0].actionOutcome;
 delete p.queryResults[0].rows[0].result;assert.equal(buildQuestionFacts(p).facts.length,0);
});

test('canonical recipients bind the received same-team identity and preserve completion, failure and pending roles',()=>{
 for(const language of ['en','es','fr','pt'])for(const result of [true,false,null]){
  const p=packet();p.responseLanguage=language;p.roster.push({id:'mate-73',name:'N. Okafor',team:'away'});
  const event=row({id:'unseen-pass',receiverId:'mate-73',receiverName:'N. Okafor',result});
  p.queryResults=[query('recipient',{type:'pass'},[],{aggregate:'list',count:1,rows:[event]})];
  const fact=buildQuestionFacts(p).facts.find(f=>f.proof.kind==='event');assert.ok(fact);assert.match(fact.claim.text,/N\. Okafor/);
  assert.equal(fact.proof.recipient.playerId,'mate-73');assert.equal(fact.proof.recipient.status,result===true?'confirmed-recipient':'recorded-target');
  assert.equal(fact.proof.actionOutcome.status,result===true?'completed':result===false?'failed':'pending');
  assert.deepEqual(fact.claim.evidence,[reference('unseen-pass','event',2)]);assert.doesNotMatch(fact.claim.text,/assist|received|receives/);
  if(result!==true)assert.match(fact.claim.text,/recorded target|destinatario registrado|destinataire enregistré|destinatário registrado/);
 }
});

test('missing, conflicting, self and opposing-team receiver identities cannot become confirmed recipients or guessed targets',()=>{
 for(const fields of [{receiverId:undefined},{receiverId:'unseen'},{receiverId:'reed'},{receiverId:'silva'},{receiverId:'mate',receiverName:'Wrong Name'},{receiverId:'mate',targetPlayer:'reed'}]){
  const p=packet();p.roster.push({id:'mate',name:'N. Okafor',team:'away'});
  p.queryResults=[query('recipient',{type:'pass'},[],{aggregate:'list',count:1,rows:[row({...fields,result:true})]})];
  const fact=buildQuestionFacts(p).facts.find(f=>f.proof.kind==='event');assert.equal(fact.proof.recipient.status,'unknown');assert.equal(fact.proof.recipient.playerId,undefined);
  assert.match(fact.claim.text,/recipient is unknown/);assert.doesNotMatch(fact.claim.text,/Okafor|Reed|Wrong Name/);
 }
 const p=packet();p.roster.push({id:'mate',name:'N. Okafor',team:'away'});const a=row({receiverId:'mate'}),b={...a,receiverId:'silva'};
 p.queryResults=[query('conflicting',{type:'pass'},[],{aggregate:'list',count:1,rows:[a,b]})];assert.equal(buildQuestionFacts(p).facts.length,0,'Conflicting same-revision events never establish recipient facts');
});

test('latest pass recipient follows the ordered current attempt rather than an older completed pass',()=>{
 for(const result of [false,null]){
  const p=packet();p.roster.push({id:'older-target',name:'V. Shah',team:'away'},{id:'new-target',name:'N. Okafor',team:'away'});
  const older=row({id:'old',time:20,arrivedAt:24,result:true,receiverId:'older-target'}),latest=row({id:'new',time:70,arrivedAt:74,result,receiverId:'new-target'});
  p.queryResults=[query('history',{type:'pass'},[],{aggregate:'list',count:2,rows:[older,latest]})];
  const selected=query('last',{type:'pass'},[],{aggregate:'list',count:2,rows:[latest],truncated:true});selected.query.limit=1;selected.query.order='desc';p.requestedEvidence=[selected];
  const fact=buildQuestionFacts(p).facts.find(f=>f.proof.kind==='ordered-event');assert.match(fact.claim.text,/Latest.*Okafor/);assert.doesNotMatch(fact.claim.text,/Shah|completed a pass to/);
  assert.equal(fact.proof.event.recipient.status,'recorded-target');assert.equal(fact.proof.event.eventId,'new');assert.deepEqual(fact.claim.evidence,[reference('new','event',2),reference('last')]);
  const corrected={...latest,revision:3,arrivedAt:80,result:true,receiverId:'older-target'};p.queryResults[0].rows.push(corrected);assert.equal(buildQuestionFacts(p).facts.some(f=>f.proof.kind==='ordered-event'),false,'A stale endpoint cannot reuse the recipient of a corrected revision');
 }
});

test('current event revisions exclude future, deleted, conflicting and unknown-actor records',()=>{
 const p=packet(),old=row({revision:1,result:true}),current=row(),future=row({revision:3,arrivedAt:130,result:true});
 p.queryResults=[query('events',{type:'pass'},[],{aggregate:'list',count:1,rows:[old,current,future]})];let facts=buildQuestionFacts(p).facts;
 assert.equal(facts.length,1);assert.equal(facts[0].claim.evidence[0].revision,2);assert.equal(facts[0].proof.actionOutcome.status,'failed');
 p.queryResults[0].rows.push(row({operation:'delete',revision:3}));assert.equal(buildQuestionFacts(p).facts.length,0);
 p.queryResults[0].rows=[row(),row({result:true})];assert.equal(buildQuestionFacts(p).facts.length,0);
 p.queryResults[0].rows=[row({playerId:'unknown'})];assert.equal(buildQuestionFacts(p).facts.length,0);
});

test('ordered endpoints cite their requested exact scope and never globalize restricted queries',()=>{
 const p=packet(),q=query('latest',{type:'pass',team:'away'},[],{aggregate:'list',count:6,rows:[row()],truncated:true});q.query.order='desc';q.query.limit=1;p.requestedEvidence=[q];
 const fact=buildQuestionFacts(p).facts.find(f=>f.proof.kind==='ordered-event');assert.ok(fact);assert.match(fact.claim.text,/Harbour Athletic/);assert.equal(fact.claim.evidence.length,2);assert.equal(fact.proof.subjectId,'away');
 q.query.timeFrom=30;assert.match(buildQuestionFacts(p).facts.find(f=>f.proof.kind==='ordered-event').claim.text,/00:30–02:00/);
 delete q.query.order;assert.equal(buildQuestionFacts(p).facts.find(f=>f.proof.kind==='ordered-event').proof.order,'asc','Compacted app packet omits the canonical ascending default');
 q.query.filters.team='home';assert.equal(buildQuestionFacts(p).facts.some(f=>f.proof.kind==='ordered-event'),false);
 q.query.filters={type:'shot',outcome:'on-target'};q.rows=[row({type:'shot',outcome:'blocked'})];assert.equal(buildQuestionFacts(p).facts.some(f=>f.proof.kind==='ordered-event'),false);
});

test('a body-part endpoint retains its selector and rejects mismatched or unknown recorded attributes',()=>{
 const p=packet(),q=query('left',{type:'pass',bodyPart:'left-foot'},[],{aggregate:'list',count:2,rows:[row({bodyPart:'left-foot'})],truncated:true});q.query.order='desc';q.query.limit=1;p.requestedEvidence=[q];
 const fact=buildQuestionFacts(p).facts.find(f=>f.proof.kind==='ordered-event');assert.ok(fact);assert.match(fact.claim.text,/left foot/);assert.equal(fact.proof.query.filters.bodyPart,'left-foot');
 q.rows[0].bodyPart='right-foot';assert.equal(buildQuestionFacts(p).facts.some(f=>f.proof.kind==='ordered-event'),false);
 delete q.rows[0].bodyPart;assert.equal(buildQuestionFacts(p).facts.some(f=>f.proof.kind==='ordered-event'),false);
});

test('complete lists do not invent endpoint selectors or outrank requested statistics and profiles',()=>{
 for(const order of [undefined,'asc','desc'])for(const limit of [undefined,20]){
  const p=packet(),list=query('list',{type:'shot'},[],{aggregate:'list',count:1,rows:[row({id:'shot',type:'shot',result:false,outcome:'saved'})]});
  if(order!==undefined)list.query.order=order;if(limit!==undefined)list.query.limit=limit;
  const attempts=query('shots',{type:'shot'},[{key:'silva',count:1}]),target=query('target',{type:'shot',outcome:'on-target'},[{key:'silva',count:1}]);
  p.requestedEvidence=[list,attempts];p.queryResults=[target];const manifest=buildQuestionFacts(p);
  assert.equal(manifest.facts.some(f=>f.proof.kind==='ordered-event'),false,`order=${order}, limit=${limit}`);
  const profile=manifest.facts.findIndex(f=>f.proof.kind==='shooting-profile'),aggregate=manifest.facts.findIndex(f=>f.proof.kind==='count'&&f.proof.scope.id==='shots'),event=manifest.facts.findIndex(f=>f.proof.kind==='event');
  assert.ok(profile>=0&&profile<event);assert.ok(aggregate>=0&&aggregate<event);
  list.query.limit=1;assert.equal(buildQuestionFacts(p).facts.filter(f=>f.proof.kind==='ordered-event').length,1,'An explicit selector still proves the endpoint even when only one event exists');
 }
});

test('canonical fact rendering is deterministic, immutable and available in four languages',()=>{
 for(const language of ['en','es','fr','pt']){const p=packet();p.responseLanguage=language;p.queryResults=[query('goals',{type:'shot',result:true},[{key:'home',count:0},{key:'away',count:0}],{aggregate:'by-team'}),query('pass',{type:'pass'},[],{aggregate:'list',count:1,rows:[row()]})];
  const original=structuredClone(p),first=buildQuestionFacts(p),second=buildQuestionFacts(p);assert.deepEqual(first,second);assert.deepEqual(p,original);assert.ok(Object.isFrozen(first.facts[0].proof));assert.equal(first.facts.length,5);
  assert.match(first.facts[0].claim.text,language==='en'?/confirmed/:/confirm/);
 }
});

test('on-target attempts faced invert team identity without inventing save credit or keeper identity',()=>{
 for(const language of ['en','es','fr','pt']){
  const p=packet();p.responseLanguage=language;p.queryResults=[query('on-target',{type:'shot',outcome:'on-target'},[{key:'home',count:2},{key:'away',count:1}],{aggregate:'by-team'})];
  const facts=buildQuestionFacts(p).facts.filter(f=>f.proof.kind==='opponent-count'&&f.proof.metric==='shotsOnTargetFaced');assert.equal(facts.length,2);
  const away=facts.find(f=>f.proof.subjectId==='away');assert.equal(away.proof.value,2);assert.equal(away.proof.attackingTeam,'home');assert.equal(away.proof.operand.subjectId,'home');assert.equal(away.claim.evidence[0].id,'on-target');assert.match(away.claim.text,/Harbour Athletic/);assert.ok(away.proof.doesNotProve.includes('save-credit'));
 }
 for(const mutate of [q=>q.truncated=true,q=>q.scope.missingFields.outcome=1,q=>q.query.filters.player='reed',q=>q.query.filters.outcome='saved',q=>q.query.aggregate='by-player']){
  const p=packet();p.queryResults=[query('scope',{type:'shot',outcome:'on-target'},[{key:'home',count:2},{key:'away',count:1}],{aggregate:'by-team'})];mutate(p.queryResults[0]);assert.equal(buildQuestionFacts(p).facts.some(f=>f.proof.metric==='shotsOnTargetFaced'),false);
 }
});

test('team comparisons require matching complete metrics and windows, and compute ties and opposition correctly',()=>{
 const p=packet();p.queryResults=[query('sot',{type:'shot',outcome:'on-target'},[{key:'home',count:2},{key:'away',count:1}],{aggregate:'by-team'})];
 let facts=buildQuestionFacts(p).facts;const attack=facts.find(f=>f.proof.kind==='team-comparison'&&f.proof.metric==='shotsOnTarget'),faced=facts.find(f=>f.proof.kind==='team-comparison'&&f.proof.metric==='shotsOnTargetFaced');assert.equal(attack.proof.leader,'home');assert.equal(faced.proof.leader,'away');assert.deepEqual(faced.proof.values,{home:1,away:2});assert.equal(attack.proof.margin,1);assert.equal(faced.proof.assessmentBounds,'this-measure-only');assert.match(faced.claim.text,/Northbridge has tested Harbour Athletic more/);assert.equal(faced.proof.attackingLeader,'home');
 p.queryResults[0].groups[1].count=2;p.queryResults[0].count=4;facts=buildQuestionFacts(p).facts;assert.equal(facts.find(f=>f.proof.kind==='team-comparison'&&f.proof.metric==='shotsOnTarget').proof.leader,null);
 p.queryResults=[query('home',{type:'shot',outcome:'on-target',team:'home'},[{key:'home',count:2}],{aggregate:'by-team',from:0}),query('away',{type:'shot',outcome:'on-target',team:'away'},[{key:'away',count:1}],{aggregate:'by-team',from:90})];assert.equal(buildQuestionFacts(p).facts.some(f=>f.proof.kind==='team-comparison'),false);
});

test('a requested ordered endpoint survives a large background catalog without changing its proof',()=>{
 const p=packet();p.queryResults=Array.from({length:70},(_v,index)=>query('background-'+index,{type:'pass'},[{key:'reed',count:1},{key:'silva',count:1}],{from:index}));
 const requested=query('last-pass',{type:'pass'},[],{aggregate:'list',count:1,rows:[row()]});requested.query.order='desc';requested.query.limit=1;p.requestedEvidence=[requested];
 const manifest=buildQuestionFacts(p);assert.equal(manifest.truncated,true);assert.equal(manifest.facts.length,128);assert.equal(manifest.facts[0].proof.kind,'ordered-event');assert.equal(manifest.facts[0].proof.scope.id,'last-pass');assert.equal(manifest.facts[0].proof.event.eventId,'pass');
});
