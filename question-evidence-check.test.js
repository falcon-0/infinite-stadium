import test from 'node:test';

test('a trailing unavailable-data predicate does not become a positive possession assertion',()=>{
 const answer=text=>({claims:[{kind:'limitation',text,evidence:[]}]});
 assert.deepEqual(unsupportedMeasurementClaims(answer('Pressing intensity and possession control data are unavailable.')),[]);
 assert.deepEqual(unsupportedMeasurementClaims(answer('Possession duration measurements are not recorded.')),[]);
 for(const text of ['Possession control is strong, but the data are unavailable.','Possession control data are available.','Possession control data are unavailable, but Cole had the ball.'])assert.equal(unsupportedMeasurementClaims(answer(text)).length,1,text);
});

test('mental-state variants are rejected while an explicitly unknown decision stays a limitation',()=>{
 const answer=(text,kind='interpretation')=>({claims:[{text,kind,evidence:[]}]});
 for(const text of ['The choice to shoot likely reflects his role.', 'Choosing to shoot showed confidence.', 'He decides to shoot because the lane was open.', 'His decision was caused by pressure.']){
  const issues=unsupportedMeasurementClaims(answer(text));assert.equal(issues.length,1,text);assert.equal(issues[0].attribute,'intention');
 }
 for(const text of ['The reason for his choice is unknown.','I cannot tell why he chose to shoot.','His decision is not recorded.'])assert.deepEqual(unsupportedMeasurementClaims(answer(text,'limitation')),[],text);
 assert.deepEqual(unsupportedMeasurementClaims(answer('He took a shot which was saved.')),[]);
});
import assert from 'node:assert/strict';
import {projectReviewEvidence,claimEvidenceChecks,matchEvidenceCapabilities,unsupportedCausalClaims,reviewActorsMatchEvidence,unsupportedMeasurementClaims,unsupportedAssessmentWindows,unsupportedAssistClaims,reviewCountIssues,countClaimSpans,unsupportedOrderedOutcomes,unsupportedCountCitations,isRosterAbsenceText,unsupportedEventAttributeClaims,completeNumericEvidence,completeNumericReview} from './question-evidence-check.js';

const reference={type:'event',id:'recovery',revision:1};
const answer=text=>({scope:'match',claims:[{text,kind:'observation',evidence:[reference]}]});

function quantityFixture(text,{question='How many shots has Carter had so far?',count=3,groups=[{key:'carter',count}],filters={type:'shot'},timeFrom=0,timeTo=120,groupKey='carter',entityResolution={},extracted=true}={}){
 const scopeReference={type:'scope',id:'quantity-proof',revision:1};
 const packet={question,observedAt:120,roster:[{id:'carter',name:'M. Carter',team:'away'},{id:'kerr',name:'I. Kerr',team:'home'}],teams:{home:'Northbridge',away:'Harbour Athletic'},queryResults:[{scopeReference,query:{filters,aggregate:groupKey===null?'count':'by-player',timeFrom,timeTo},count,groups,scope:{missingFields:{},entityResolution},entityResolution,truncated:false,rows:[]}]};
 const answer={claims:[{text,kind:'observation',evidence:[scopeReference]}]};
 const review={checks:[{claimIndex:0,counts:extracted?countClaimSpans(text).map(span=>({text:span.text,value:span.value,groupKey,scopeReference})):[]}]};
 return {packet,answer,review,issues:()=>reviewCountIssues(review,answer,packet)};
}

test('numeric citation completion proves the unchanged single-subject claim and preserves its audit',()=>{
 for(const [text,options] of [['Carter has 3 shots.',{}],['M. Carter has 3 shots so far.',{}],['Carter has 3 shots in this match.',{}],['Carter has no shots.',{count:0,groups:[]}],['Carter has completed 3 passes.',{filters:{type:'pass',result:true}}]]){
  const sample=quantityFixture(text,options);sample.answer.claims[0].evidence=[reference];
  const original=structuredClone(sample.answer),result=completeNumericEvidence(sample.answer,sample.packet);
  assert.deepEqual(sample.answer,original,'Input remains untouched');assert.equal(result.answer.claims[0].text,text);
  assert.deepEqual(result.answer.claims[0].evidence,[reference,sample.packet.queryResults[0].scopeReference]);
  assert.equal(result.augmentations.length,1);assert.equal(result.augmentations[0].subjectId,'carter');assert.equal(result.augmentations[0].reason,'verified-complete-count-scope');
  assert.deepEqual(reviewCountIssues(sample.review,result.answer,sample.packet),[]);
  assert.deepEqual(completeNumericEvidence(result.answer,sample.packet).augmentations,[],'Already supported claims are idempotent');
 }
 const team=quantityFixture('Northbridge has 3 shots.',{question:'How many shots has Northbridge had?',groupKey:null,filters:{type:'shot',team:'home'},groups:[]});
 team.answer.claims[0].evidence=[];assert.equal(completeNumericEvidence(team.answer,team.packet).augmentations.length,1);
});

test('citation completion rejects unparsed temporal and outcome qualifiers instead of borrowing broad totals',()=>{
 for(const text of ['Carter has 3 shots in the first minute.','Carter has 3 shots in the opening 30 seconds.','Carter has 3 shots in the second half.',
  'Carter has 3 shots at halftime.','Carter has 3 shots prior to the restart.','Carter has 3 shots before 01:00.','Carter has 3 shots after the goal.',
  'In the opening 30 seconds, Carter has 3 shots.','Earlier, Carter has 3 shots.','Carter has 3 shots off target.','Carter has 3 shots that were saved.',
  'Carter has 3 shots, excluding blocked attempts.','Carter has 3 shots so far in the first minute.']){
  const sample=quantityFixture(text);sample.answer.claims[0].evidence=[];
  assert.deepEqual(completeNumericEvidence(sample.answer,sample.packet).augmentations,[],text);
 }
 const sample=quantityFixture('Carter has 3 passes that failed.',{filters:{type:'pass'}});sample.answer.claims[0].evidence=[];
 assert.deepEqual(completeNumericEvidence(sample.answer,sample.packet).augmentations,[]);
});

test('citation completion cannot launder false values, unknown subjects, subsets or incomplete coverage',()=>{
 const mutations=[s=>s.answer.claims[0].text='Carter has 4 shots.',s=>s.answer.claims[0].text='Messi has 3 shots.',s=>s.answer.claims[0].text='Carter says Messi has 3 shots.',
  s=>s.answer.claims[0].text='He has 3 shots.',s=>s.answer.claims[0].text='Carter has 3 shots and Kerr has 3 shots.',s=>s.answer.claims[0].text='Carter leads Kerr by 3 shots.',
  s=>s.packet.queryResults[0].query.filters.outcome='on-target',s=>s.packet.queryResults[0].query.filters.id='example',s=>s.packet.queryResults[0].query.timeFrom=90,
  s=>s.packet.queryResults[0].truncated=true,s=>s.packet.queryResults[0].scope.missingFields.player=1,s=>delete s.packet.queryResults[0].scope.missingFields,
  s=>s.packet.queryResults[0].query.groupCount={min:1},s=>s.packet.queryResults[0].groups[0].key='kerr',s=>s.packet.mentionedPlayerResolution=[{status:'ambiguous'}],
  s=>s.packet.queryResults[0].scopeReference.type='knowledge'];
 for(const mutate of mutations){
  const sample=quantityFixture('Carter has 3 shots.');sample.answer.claims[0].evidence=[];mutate(sample);
  const result=completeNumericEvidence(sample.answer,sample.packet);assert.deepEqual(result.augmentations,[]);assert.deepEqual(result.answer,sample.answer);
 }
 const passes=quantityFixture('Carter has 3 passes.',{filters:{type:'pass',result:true}});passes.answer.claims[0].evidence=[];
 assert.deepEqual(completeNumericEvidence(passes.answer,passes.packet).augmentations,[],'Completed subset cannot prove unqualified total passes');
});

test('knowledge references never satisfy match count, actor or event support, even with colliding identifiers',()=>{
 const sample=quantityFixture('Carter has 3 shots.');const ref={...sample.packet.queryResults[0].scopeReference,type:'knowledge'};
 sample.answer.claims[0].evidence=[ref];sample.review.checks[0].counts[0].scopeReference=ref;
 assert.equal(claimEvidenceChecks(sample.answer,sample.packet)[0].cited[0].record,null);assert.ok(reviewCountIssues(sample.review,sample.answer,sample.packet).length);
 assert.ok(unsupportedCountCitations(sample.answer,sample.packet).length);
 sample.packet.queryResults[0].scopeReference=ref;
 assert.equal(claimEvidenceChecks(sample.answer,sample.packet)[0].cited[0].record,null,'Knowledge-shaped input must not be coerced into a match scope');
 assert.deepEqual(completeNumericEvidence(sample.answer,sample.packet).augmentations,[]);
});

test('omitted count annotations are independently proved without rewriting the answer or review decision',()=>{
 for(const [text,options] of [['Carter has 3 shots.',{}],['Carter has completed 3 passes.',{filters:{type:'pass',result:true}}],['No goals have been recorded in the match by 02:00.',{question:'Goal?',count:0,groups:[],filters:{type:'shot',result:true},groupKey:null}]]){
  const sample=quantityFixture(text,{...options,extracted:false}),original=structuredClone(sample.review);
  const completed=completeNumericReview(sample.review,sample.answer,sample.packet);
  assert.deepEqual(sample.review,original);assert.equal(completed.augmentations.length,1,text);
  assert.deepEqual(reviewCountIssues(completed.review,sample.answer,sample.packet),[]);
  assert.equal(completed.augmentations[0].reason,'verified-omitted-count-binding');
  assert.deepEqual(completeNumericReview(completed.review,sample.answer,sample.packet).augmentations,[]);
 }
});

test('repeated global zero wording can be proved when the reviewer extracts only its second occurrence',()=>{
 const sample=quantityFixture('No goals have been recorded in the match by 01:57, as confirmed by the complete goal count scopes showing zero goals for both teams.',{question:'Goal?',count:0,groups:[],filters:{type:'shot',result:true},groupKey:null,timeTo:117,extracted:false});
 sample.packet.observedAt=117;sample.packet.queryResults[0].query.aggregate='by-team';
 sample.review.checks[0].counts=[{text:'zero goals for both teams',value:0,scopeReference:sample.packet.queryResults[0].scopeReference,groupKey:'home'}];
 assert.ok(sample.issues().some(issue=>issue.span==='No goals'));
 const completed=completeNumericReview(sample.review,sample.answer,sample.packet);
 assert.deepEqual(completed.augmentations.map(item=>item.span),['No goals']);
 assert.deepEqual(reviewCountIssues(completed.review,sample.answer,sample.packet),[]);
});

test('omitted count proof rejects false values, unknown identity, temporal qualifiers and incomplete evidence',()=>{
 const mutations=[s=>s.answer.claims[0].text='Carter has 4 shots.',s=>s.answer.claims[0].text='Messi has 3 shots.',
  s=>s.answer.claims[0].text='Carter says Messi has 3 shots.',s=>s.answer.claims[0].text='Carter has 3 shots in the first minute.',
  s=>s.answer.claims[0].text='Carter has 3 shots in the second half.',s=>s.answer.claims[0].text='Carter has 3 shots by 01:00.',
  s=>s.answer.claims[0].text='Carter has 3 shots by 01:60.',s=>s.answer.claims[0].text='Carter has 3 shots off target.',
  s=>s.packet.queryResults[0].query.timeFrom=90,s=>s.packet.queryResults[0].truncated=true,
  s=>s.packet.queryResults[0].scope.missingFields.player=1,s=>delete s.packet.queryResults[0].scope.missingFields,
  s=>s.packet.queryResults[0].query.filters.player='kerr',s=>s.packet.queryResults[0].groups[0].key='kerr',
  s=>s.packet.queryResults[0].query.filters.outcome='on-target',s=>s.packet.queryResults[0].query.groupCount={min:1},
  s=>s.answer.claims[0].evidence=[{...s.packet.queryResults[0].scopeReference,revision:2}],
  s=>s.answer.claims[0].evidence=[{...s.packet.queryResults[0].scopeReference,type:'knowledge'}],
  s=>s.packet.mentionedPlayerResolution=[{status:'absent'}]];
 for(const [index,mutate] of mutations.entries()){const sample=quantityFixture('Carter has 3 shots.',{extracted:false});mutate(sample);
  assert.deepEqual(completeNumericReview(sample.review,sample.answer,sample.packet).augmentations,[],`mutation ${index}`);
 }
 for(const text of ['No goals by Messi.','No goals from corners.','No goals have been recorded in the first minute.','No goals have been recorded by 01:00.']){
  const sample=quantityFixture(text,{question:'Goal?',count:0,groups:[],filters:{type:'shot',result:true},groupKey:null,extracted:false});
  assert.deepEqual(completeNumericReview(sample.review,sample.answer,sample.packet).augmentations,[],text);
 }
 const restricted=quantityFixture('No goals have been recorded.',{question:'Goal?',count:0,groups:[],filters:{type:'shot',result:true,team:'home'},groupKey:null,extracted:false});
 assert.deepEqual(completeNumericReview(restricted.review,restricted.answer,restricted.packet).augmentations,[]);
 const passes=quantityFixture('Carter has 3 passes.',{filters:{type:'pass',result:true},extracted:false});
 assert.deepEqual(completeNumericReview(passes.review,passes.answer,passes.packet).augmentations,[]);
});

test('independent annotations never replace conflicting reviewer counts or approve unrelated assertions',()=>{
 const sample=quantityFixture('Carter has 3 shots.');sample.review.checks[0].counts[0].value=4;
 assert.deepEqual(completeNumericReview(sample.review,sample.answer,sample.packet).augmentations,[]);
 const mixed=quantityFixture('No goals have been recorded, and Messi has 2 goals.',{question:'Goal?',count:0,groups:[],filters:{type:'shot',result:true},groupKey:null,extracted:false});
 const result=completeNumericReview(mixed.review,mixed.answer,mixed.packet);
 assert.equal(result.augmentations.length,1);assert.ok(reviewCountIssues(result.review,mixed.answer,mixed.packet).length,'One proved span never approves the full claim');
});

test('omitted numeric proof retains comma modifiers and rejects unparsed clocks across the whole claim',()=>{
 for(const text of ['Carter has 3 shots, at 01:00.','Carter has 3 shots, from 00:00 to 00:30.',
  'Carter has 3 shots, in the first minute.','Carter has 3 shots, all off target.',
  'Carter has 3 shots. That was at 01:00.','Carter has 3 shots by 02:00. The count was 3 at 01:00.',
  'Carter has 3 shots. This covers 00:00–00:30.','Carter has 3 shots. This was at sixty seconds.','At 01:00, Carter has 3 shots.']){
  const sample=quantityFixture(text,{extracted:false});
  assert.deepEqual(completeNumericReview(sample.review,sample.answer,sample.packet).augmentations,[],text);
 }
 for(const text of ['No goals have been recorded, at 01:00.','No goals have been recorded, from 00:00 to 00:30.',
  'No goals have been recorded by 02:00. This was at 01:00.','No goals have been recorded. This covers 00:00 to 00:30.',
  'No goals have been recorded, at sixty seconds.','No goals have been recorded, until the break.']){
  const sample=quantityFixture(text,{question:'Goal?',count:0,groups:[],filters:{type:'shot',result:true},groupKey:null,extracted:false});
  assert.deepEqual(completeNumericReview(sample.review,sample.answer,sample.packet).augmentations,[],text);
 }
 const exact=quantityFixture('Carter has 3 shots by 02:00.',{extracted:false});
 assert.equal(completeNumericReview(exact.review,exact.answer,exact.packet).augmentations.length,1);
});

test('zero synthesis cannot borrow a different filtered player or missing identity resolution',()=>{
 for(const entityResolution of [{},{player:{status:'resolved',canonicalId:'kerr'}},{player:{status:'ambiguous',canonicalId:null}}]){
  const sample=quantityFixture('Carter has no shots.',{count:2,groups:[],filters:{type:'shot',player:'kerr'},entityResolution});
  assert.ok(sample.issues().length);
  assert.deepEqual(claimEvidenceChecks(sample.answer,sample.packet)[0].cited[0].record.entityResolution,entityResolution);
 }
 const genuine=quantityFixture('Carter has no shots.',{count:0,groups:[],filters:{type:'shot',player:'carter'},entityResolution:{player:{status:'resolved',canonicalId:'carter'}}});
 assert.deepEqual(genuine.issues(),[]);
});

test('signed decimal and compound quantity tokens cannot validate their integer suffix',()=>{
 for(const text of ['Carter has -3 shots.','Carter has 1.3 shots.','Carter has 1,003 shots.','Carter has twenty-three shots.','Carter has one hundred and three shots.']){
  const sample=quantityFixture(text);
  assert.ok(sample.issues().length,text);
 }
 for(const text of ['Carter has 1.3 shots.','Carter has -3 shots.']){
  const sample=quantityFixture(text);assert.ok(unsupportedCountCitations(sample.answer,sample.packet).length);
 }
 assert.deepEqual(quantityFixture('Carter has twenty-three shots.',{count:23}).issues(),[]);
 assert.deepEqual(quantityFixture('Carter has three shots.').issues(),[]);
});

test('clock components and comma-before-but conjunctions are not French goal quantities',()=>{
 for(const text of ['A. Reed took a shot at 01:56, but the outcome is pending.','At 01:56 passes were completed.','At 1:02:03, but nothing is confirmed.','The score is 0-0, but the attempt is pending.','It was 2, but the count changed.'])assert.deepEqual(countClaimSpans(text),[],text);
 for(const [text,value,expected] of [['deux buts',2,'deux buts'],['Goals: 2 buts',2,'2 buts'],['un but',1,'un but'],['À 01:56, deux buts étaient confirmés.',2,'deux buts'],['Carter has 2 shots at 01:56, but none since.',2,'2 shots']]){
  const spans=countClaimSpans(text);assert.equal(spans.length,1);assert.equal(spans[0].value,value);assert.equal(spans[0].text,expected);assert.equal(text.slice(spans[0].index,spans[0].index+spans[0].text.length),expected);
 }
 assert.ok(Number.isNaN(countClaimSpans('1.3 buts')[0].value),'A malformed real count must still fail validation');
});

function coordinatedQuantityFixture(text='Carter made one completed pass and one recovery in the match so far.'){
 const sample=quantityFixture(text,{count:1,filters:{type:'pass',result:true}});
 const recovery=structuredClone(sample.packet.queryResults[0]);recovery.scopeReference.id='recovery-proof';recovery.query.filters={type:'recovery',recoveryClass:'ball-win'};
 sample.packet.queryResults.push(recovery);
 sample.answer.claims[0].evidence.push(recovery.scopeReference);
 for(const count of sample.review.checks[0].counts)if(/recovery|recoveries/.test(count.text))count.scopeReference=recovery.scopeReference;
 sample.review.checks[0].actors=[{name:'Carter',action:'pass',individualAction:true},{name:'Carter',action:'recovery',individualAction:true}];
 return sample;
}
test('singular recovery quantities share metric semantics with plurals and coordinated counts retain their sole actor',()=>{
 for(const noun of ['recovery','recoveries'])assert.equal(countClaimSpans(`one ${noun}`)[0]?.value,1);
 const sample=coordinatedQuantityFixture();assert.deepEqual(sample.issues(),[]);assert.equal(reviewActorsMatchEvidence(sample.review,sample.answer,sample.packet),true);
 for(const change of [s=>s.packet.queryResults[1].groups[0].count=2,s=>s.packet.queryResults[1].groups[0].key='kerr',
  s=>s.packet.queryResults[1].query.timeFrom=90,s=>s.packet.queryResults[1].scope.missingFields.type=1,
  s=>s.packet.queryResults[1].query.filters.recoveryKind='goalkeeper-hold',s=>s.packet.queryResults[1].truncated=true]){
  const invalid=coordinatedQuantityFixture();change(invalid);assert.ok(invalid.issues().length);
 }
 for(const text of ['Carter made one completed pass and Kerr made one recovery.','Carter made one completed pass to Kerr and one recovery.','Carter made one completed pass. And one recovery.']){
  const invalid=coordinatedQuantityFixture(text);invalid.packet.question='What happened?';assert.ok(invalid.issues().length,text);
 }
 const action={claims:[{text:'Carter recovered the ball.',kind:'observation',evidence:[reference]}]};
 assert.deepEqual(countClaimSpans(action.claims[0].text),[]);
 assert.equal(reviewActorsMatchEvidence({checks:[{claimIndex:0,actors:[{name:'Carter',action:'recovery',individualAction:true}],counts:[]}]},action,{roster:sample.packet.roster,queryResults:[{scopeReference:{type:'scope',id:'regular-action',revision:1},rows:[{...reference,type:'recovery',playerId:'carter'}]}]}),true);
});

test('ordinary recovery and ball-win totals require classified scopes; raw recovery records retain separate provenance',()=>{
 for(const noun of ['recovery','recoveries','ball win','ball wins','ball won','balls won']){
  const sample=quantityFixture(`Carter has one ${noun} so far.`,{count:1,filters:{type:'recovery',recoveryClass:'ball-win'}});
  assert.equal(countClaimSpans(sample.answer.claims[0].text)[0].noun,noun);assert.deepEqual(sample.issues(),[]);
  for(const mutate of [q=>delete q.query.filters.recoveryClass,q=>q.query.filters.recoveryClass='initial-control',q=>q.query.filters.recoveryKind='goalkeeper-hold',q=>q.scope.missingFields.recoveryClass=1,q=>q.truncated=true,q=>q.query.timeFrom=90,q=>q.query.timeFromExclusive=true,q=>q.groups[0].count=2,q=>q.groups[0].key='unknown']){
   const invalid=quantityFixture(`Carter has one ${noun} so far.`,{count:1,filters:{type:'recovery',recoveryClass:'ball-win'}});mutate(invalid.packet.queryResults[0]);assert.ok(invalid.issues().length,`${noun}: ${mutate}`);
  }
 }
 const raw=quantityFixture('Carter has one recovery record so far.',{count:1,filters:{type:'recovery'}});assert.deepEqual(raw.issues(),[]);assert.equal(countClaimSpans(raw.answer.claims[0].text)[0].text,'one recovery record');
 raw.packet.queryResults[0].query.filters.recoveryClass='ball-win';assert.ok(raw.issues().length,'A filtered win subset cannot stand in for every raw recovery record');
 const initial=quantityFixture('Carter has one recovery record so far.',{count:1,filters:{type:'recovery',recoveryClass:'initial-control'}});assert.ok(initial.issues().length);
});

test('numeric current score needs complete confirmed-goal citations, not pending or example events',()=>{
 const fixture=()=>quantityFixture('The current confirmed score is 0-0, so the score is still level based on confirmed goals.',{question:'Can I celebrate yet?',count:0,groups:[],filters:{type:'shot',result:true}});
 assert.deepEqual(unsupportedCountCitations(fixture().answer,fixture().packet),[]);
 for(const change of [s=>s.packet.queryResults[0].query.filters={type:'shot',outcome:'pending'},
  s=>s.packet.queryResults[0].query.filters.player='carter',s=>s.packet.queryResults[0].query.filters.team='home',
  s=>s.packet.queryResults[0].query.timeFrom=90,s=>s.packet.queryResults[0].query.timeTo=110,
  s=>s.packet.queryResults[0].truncated=true,s=>s.packet.queryResults[0].scope.missingFields.result=1,
  s=>s.packet.queryResults[0].count=1,s=>s.packet.queryResults[0].query.groupCount={max:0},
  s=>s.packet.score={home:1,away:0},s=>s.answer.claims[0].evidence=[reference]]){
  const sample=fixture();change(sample);assert.ok(unsupportedCountCitations(sample.answer,sample.packet).length);
 }
 const nonzero=fixture();nonzero.answer.claims[0].text='The current score is 1-0.';nonzero.packet.queryResults[0].count=1;
 nonzero.packet.queryResults[0].groups=[{key:'kerr',count:1}];assert.deepEqual(unsupportedCountCitations(nonzero.answer,nonzero.packet),[]);
 nonzero.packet.queryResults[0].groups[0].key='carter';assert.ok(unsupportedCountCitations(nonzero.answer,nonzero.packet).length,'Reversed teams cannot prove the displayed score');
 const pending=fixture();pending.packet.queryResults[0].query.filters={type:'shot',outcome:'pending'};
 pending.answer.claims[0].text='The pending shot is not yet included in the confirmed score.';assert.deepEqual(unsupportedCountCitations(pending.answer,pending.packet),[]);
});

test('affirmative foot attributes bind to the same event kind, named actor and exact citation',()=>{
 const pass={id:'pass',revision:2,type:'pass',playerId:'carter',player:'M. Carter',bodyPart:'left-foot',result:true};
 const shot={id:'shot',revision:1,type:'shot',playerId:'kerr',player:'I. Kerr',bodyPart:'right-foot',result:false};
 const scopeReference={type:'scope',id:'attribute-scope',revision:1};
 const packet={roster:[{id:'carter',name:'M. Carter'},{id:'kerr',name:'I. Kerr'}],queryResults:[{scopeReference,query:{filters:{type:'pass',bodyPart:'left-foot'},aggregate:'by-player'},count:1,groups:[{key:'carter',count:1}],rows:[pass,shot]}]};
 const draft=(text,evidence=[{type:'event',id:'pass',revision:2}])=>({claims:[{text,kind:'observation',evidence}]});
 for(const text of ['Carter made a left-foot pass.','M. Carter passed with his left foot.','Carter used his left foot to pass.','The left-foot pass was by M. Carter.'])assert.deepEqual(unsupportedEventAttributeClaims(draft(text),packet),[],text);
 for(const text of ['Kerr made a left-foot pass.','Carter made a right-foot pass.','Carter took a left-foot shot.'])assert.equal(unsupportedEventAttributeClaims(draft(text),packet).length,1,text);
 assert.equal(unsupportedEventAttributeClaims(draft('Carter made a left-foot pass.',[{type:'event',id:'shot',revision:1}]),packet).length,1);
 assert.equal(unsupportedEventAttributeClaims(draft('Carter made a left-foot pass.',[{type:'event',id:'pass',revision:1}]),packet).length,1,'Stale revision cannot prove the foot');
 assert.deepEqual(unsupportedEventAttributeClaims(draft('Carter made a left-foot pass.',[scopeReference]),packet),[]);
 const wrongType=structuredClone(packet);wrongType.queryResults[0].query.filters.type='shot';assert.equal(unsupportedEventAttributeClaims(draft('Carter made a left-foot pass.',[scopeReference]),wrongType).length,1);
 const broad=structuredClone(packet);delete broad.queryResults[0].query.filters.bodyPart;assert.equal(unsupportedEventAttributeClaims(draft('Carter made a left-foot pass.',[scopeReference]),broad).length,1);
 const wrongPlayer=structuredClone(packet);wrongPlayer.queryResults[0].groups[0].key='kerr';assert.equal(unsupportedEventAttributeClaims(draft('Carter made a left-foot pass.',[scopeReference]),wrongPlayer).length,1);
 const unknown=structuredClone(packet);delete unknown.queryResults[0].rows[0].bodyPart;assert.equal(unsupportedEventAttributeClaims(draft('Carter made a left-foot pass.'),unknown).length,1);
 assert.ok(unsupportedCountCitations(draft('Carter took a left-foot shot.'),packet).length,'The existing production pre-review guard includes field checks');
});

test('foot checks do not borrow a later action attribute or turn uncertainty into an assertion',()=>{
 const scopeReference={type:'scope',id:'attribute-actions',revision:1};
 const packet={roster:[{id:'carter',name:'M. Carter'},{id:'kerr',name:'I. Kerr'}],queryResults:[{scopeReference,rows:[
  {id:'pass',revision:1,type:'pass',playerId:'carter',bodyPart:'left-foot'},
  {id:'shot',revision:1,type:'shot',playerId:'kerr',bodyPart:'right-foot'}]}]};
 const draft=text=>({claims:[{text,kind:'observation',evidence:[{type:'event',id:'pass',revision:1},{type:'event',id:'shot',revision:1}]}]});
 assert.deepEqual(unsupportedEventAttributeClaims(draft('Carter passed and Kerr shot with his right foot.'),packet),[]);
 assert.equal(unsupportedEventAttributeClaims(draft('Carter passed with his right foot and Kerr took a right-foot shot.'),packet).length,1);
 for(const text of ['We cannot tell whether Carter passed with his right foot.','Carter did not make a right-foot pass.','The foot used for the pass is unknown.'])assert.deepEqual(unsupportedEventAttributeClaims(draft(text),packet),[],text);
 assert.equal(unsupportedEventAttributeClaims(draft('The foot was unknown, but Carter made a right-foot pass.'),packet).length,1,'A preceding uncertainty clause cannot excuse the later positive claim');
});

test('passive foot agent ends before clock and recipient without changing actor identity',()=>{
 const ref={type:'event',id:'comparison-sustained-84621-pass-110',revision:2};
 const packet={roster:[{id:'cole',name:'J. Cole'},{id:'reed',name:'A. Reed'}],queryResults:[{scopeReference:{type:'scope',id:'left-pass',revision:1},rows:[{...ref,type:'pass',playerId:'cole',receiverId:'reed',bodyPart:'left-foot'}]}]};
 const draft=text=>({claims:[{text,kind:'observation',evidence:[ref]}]});
 const actual='The last recorded pass played with the left foot was by J. Cole at 01:50, passing short to A. Reed.';
 assert.deepEqual(unsupportedEventAttributeClaims(draft(actual),packet),[]);
 assert.deepEqual(unsupportedEventAttributeClaims(draft('The left-foot pass was by J. Cole to A. Reed.'),packet),[]);
 assert.equal(unsupportedEventAttributeClaims(draft(actual.replace('by J. Cole','by A. Reed')),packet).length,1);
 assert.equal(unsupportedEventAttributeClaims(draft(actual.replace('left foot','right foot')),packet).length,1);
 assert.equal(unsupportedEventAttributeClaims(draft(actual),{...packet,queryResults:[{...packet.queryResults[0],rows:[{...packet.queryResults[0].rows[0],revision:1}]}]}).length,1);
});

test('total and trailing on-target counts keep separate metric semantics and coordinated subjects',()=>{
 const text='M. Carter has been active with 2 shots on target and 2 total shots, the highest on his team.';
 const sample=quantityFixture(text,{count:2});
 const target=structuredClone(sample.packet.queryResults[0]);target.scopeReference={type:'scope',id:'target-count',revision:1};target.query.filters.outcome='on-target';
 sample.packet.queryResults.push(target);sample.answer.claims[0].evidence.push(target.scopeReference);
 sample.review.checks[0].counts[0].scopeReference=target.scopeReference;
 sample.review.checks[0].actors=[{name:'M. Carter',action:'shot',individualAction:true}];
 const spans=countClaimSpans(text);assert.deepEqual(spans.map(s=>s.text),['2 shots on target','2 total shots']);
 assert.match(spans[0].modifiers,/on-target/);assert.doesNotMatch(spans[1].modifiers,/on-target/);
 assert.deepEqual(sample.issues(),[]);assert.equal(reviewActorsMatchEvidence(sample.review,sample.answer,sample.packet),true);
 const original=sample.review.checks[0].counts[0].scopeReference;
 sample.review.checks[0].counts[0].scopeReference=sample.packet.queryResults[0].scopeReference;assert.ok(sample.issues().length,'Equal values cannot substitute unrestricted shots for shots on target');
 sample.review.checks[0].counts[0].scopeReference=original;
 sample.review.checks[0].counts[1].scopeReference=original;assert.ok(sample.issues().length,'A subset cannot prove total attempts even with an equal count');
});

test('aggregate actor existence requires a positive exact group count and matching metric, window and coverage',()=>{
 const sample=quantityFixture('M. Carter has taken more shots (3).');
 sample.review.checks[0].counts=[{text:'3 total shots',value:3,groupKey:'carter',scopeReference:sample.packet.queryResults[0].scopeReference}];
 sample.review.checks[0].actors=[{name:'M. Carter',action:'shot',individualAction:true}];
 assert.equal(reviewActorsMatchEvidence(sample.review,sample.answer,sample.packet),true,'The actual group establishes actor/action existence; prose totals are checked separately');
 for(const mutate of [s=>s.review.checks[0].counts[0].value=4,s=>s.review.checks[0].counts[0].groupKey='kerr',s=>s.packet.queryResults[0].query.filters.type='pass',s=>s.packet.queryResults[0].query.timeFrom=90,s=>s.packet.queryResults[0].truncated=true,s=>s.packet.queryResults[0].scope.missingFields.result=1,s=>s.packet.queryResults[0].groups[0].count=0]){
  const copy=structuredClone({review:sample.review,answer:sample.answer,packet:sample.packet});mutate(copy);
  assert.equal(reviewActorsMatchEvidence(copy.review,copy.answer,copy.packet),false);
 }
});

test('counts must match the requested and asserted temporal window including end time',()=>{
 for(const sample of [quantityFixture('Carter has 3 shots so far.',{question:'How many shots in this passage?',timeFrom:90}),
  quantityFixture('Carter has 3 shots in the last 30 seconds.',{question:'How many shots in the last 30 seconds?'}),
  quantityFixture('Carter has 3 shots so far.',{timeTo:100}),
  quantityFixture('Carter has 3 shots in the last 30 seconds.'),
  quantityFixture('Carter has 3 shots recently.',{question:'How many shots recently?',timeFrom:90})])assert.ok(sample.issues().length);
 assert.deepEqual(quantityFixture('Carter has 3 shots in the last 30 seconds.',{question:'How many shots has Carter had in the last 30 seconds?',timeFrom:90}).issues(),[]);
 assert.deepEqual(quantityFixture('Carter has 3 shots since 01:00.',{question:'How many shots since 01:00?',timeFrom:60}).issues(),[]);
});

test('opening count windows are explicit and unsupported period qualifiers never default to the full match',()=>{
 for(const text of ['Carter has 3 shots in the first 30 seconds.','Carter has 3 shots in the opening 30 seconds.','Carter has 3 shots in the first minute.'])assert.ok(quantityFixture(text).issues().length,text);
 for(const [phrase,timeTo] of [['the first 30 seconds',30],['the opening thirty seconds',30],['the first minute',60],['the first two minutes',120]]){
  const sample=quantityFixture(`Carter has 3 shots in ${phrase}.`,{question:`How many shots did Carter take in ${phrase}?`,timeTo});
  assert.deepEqual(sample.issues(),[],phrase);
 }
 const mismatched=quantityFixture('Carter has 3 shots in the first minute.',{question:'How many shots in the first 30 seconds?',timeTo:30});assert.ok(mismatched.issues().length);
 for(const phrase of ['the second half','the first half','halftime','the opening period','the first fifteen minutes']){
  assert.ok(quantityFixture(`Carter has 3 shots in ${phrase}.`).issues().length,phrase);
  assert.ok(quantityFixture('Carter has 3 shots.',{question:`How many shots did Carter take in ${phrase}?`}).issues().length,phrase);
 }
 for(const text of ['Carter has 3 shots prior to the restart.','Carter has 3 shots before the goal.','Carter has 3 shots after halftime.','Carter has 3 shots during that period.'])assert.ok(quantityFixture(text).issues().length,text);
});

function differenceFixture(text='Northbridge leads by 1 completed pass.',extracted=true){
 const sample=quantityFixture(text,{question:'Which side has completed more passes so far, and by how many?',count:9,groups:[{key:'home',count:5},{key:'away',count:4}],filters:{type:'pass',result:true},groupKey:'home',extracted});
 sample.packet.queryResults[0].query.aggregate='by-team';return sample;
}
test('team-filtered aggregate counts accept only the matching explicit team binding',()=>{
 const fixture=(team='home')=>{
  const sample=quantityFixture(`${team==='home'?'Northbridge':'Harbour Athletic'} has completed 5 passes so far.`,{question:'Which side completed more passes?',count:5,groups:[],filters:{type:'pass',result:true,team},groupKey:team});
  sample.packet.queryResults[0].query.aggregate='count';return sample;
 };
 for(const team of ['home','away'])assert.deepEqual(fixture(team).issues(),[]);
 for(const change of [s=>s.review.checks[0].counts[0].groupKey='away',s=>s.review.checks[0].counts[0].groupKey='kerr',
  s=>s.packet.queryResults[0].query.filters.team='away',s=>delete s.packet.queryResults[0].query.filters.team,
  s=>s.packet.queryResults[0].query.filters.player='kerr',s=>s.packet.queryResults[0].query.filters.assistPlayer='kerr',
  s=>s.packet.queryResults[0].query.filters.result=false,s=>s.packet.queryResults[0].query.groupCount={min:1},
  s=>s.packet.queryResults[0].truncated=true,s=>s.packet.queryResults[0].scope.missingFields.result=1,
  s=>s.packet.queryResults[0].query.timeFrom=90,s=>s.packet.queryResults[0].count=4]){
  const sample=fixture();change(sample);assert.ok(sample.issues().length);
 }
});
test('more-than comparisons use signed arithmetic even with omitted or irrelevant model extraction',()=>{
 for(const text of ['Northbridge has 1 more completed pass than Harbour Athletic.','Northbridge has completed 1 more pass than Harbour Athletic at this point in the match.','Northbridge has one more pass than Harbour Athletic.']){
  for(const extracted of [true,false])assert.deepEqual(differenceFixture(text,extracted).issues(),[],text);
 }
 const irrelevant=differenceFixture('Northbridge has completed 1 more pass than Harbour Athletic.');
 irrelevant.review.checks[0].counts=[{...irrelevant.review.checks[0].counts[0],text:'5 passes',value:5}];
 assert.deepEqual(irrelevant.issues(),[]);
 for(const text of ['Northbridge has 2 more completed passes than Harbour Athletic.','Northbridge has 5 more completed passes than Harbour Athletic.',
  'Harbour Athletic has 1 more completed pass than Northbridge.','Northbridge has 1 more completed pass than Northbridge.',
  'Northbridge has 1 more completed pass than Carter.','Northbridge has 1 more completed pass than Unknown Club.',
  'Northbridge has 1 more completed pass.','Northbridge records 5 more completed passes than Harbour Athletic.',
  'Northbridge has 1 more completed pass than Harbour Athletic in the last 30 seconds.']){
  for(const extracted of [true,false])assert.ok(differenceFixture(text,extracted).issues().length,text);
 }
 for(const change of [s=>s.packet.queryResults[0].query.filters.result=false,s=>s.packet.queryResults[0].query.filters.type='shot',
  s=>s.packet.queryResults[0].query.timeFrom=90,s=>s.packet.queryResults[0].scope.missingFields.result=1,
  s=>s.packet.queryResults[0].truncated=true,s=>s.packet.queryResults[0].groups.pop()]){
  for(const extracted of [true,false]){const sample=differenceFixture('Northbridge has completed 1 more pass than Harbour Athletic.',extracted);change(sample);assert.ok(sample.issues().length);}
 }
});
test('explicit leads and ahead margins are verified as signed differences, including omitted extraction',()=>{
 for(const text of ['Northbridge leads by 1 completed pass.','Northbridge leads Harbour Athletic by one completed pass.','Northbridge is ahead of Harbour Athletic by 1 completed pass.']){
  assert.deepEqual(differenceFixture(text).issues(),[],text);
  assert.deepEqual(differenceFixture(text,false).issues(),[],text+' without extraction');
 }
 const combined=differenceFixture('Northbridge has 5 completed passes, Harbour Athletic has 4 completed passes, so Northbridge leads by 1 completed pass.');
 combined.review.checks[0].counts[1].groupKey='away';
 assert.deepEqual(combined.issues(),[]);
 combined.review.checks[0].counts.pop();assert.deepEqual(combined.issues(),[],'Only the independently provable arithmetic extraction may be omitted');
});
test('difference proof rejects wrong arithmetic, leader, extraction and ordinary totals',()=>{
 for(const text of ['Northbridge leads by 2 completed passes.','Northbridge leads by 5 completed passes.','Harbour Athletic leads by 1 completed pass.',
  'Northbridge leads Northbridge by 1 completed pass.','Carter leads by 1 completed pass.','Northbridge has 1 completed pass.']){
  assert.ok(differenceFixture(text).issues().length,text);
  assert.ok(differenceFixture(text,false).issues().length,text+' without extraction');
 }
 const wrongLeader=differenceFixture();wrongLeader.review.checks[0].counts[0].groupKey='away';assert.ok(wrongLeader.issues().length);
 const wrongValue=differenceFixture();wrongValue.review.checks[0].counts[0].value=5;assert.ok(wrongValue.issues().length,'Invalid extraction is not a missing-extraction fallback');
 const tie=differenceFixture('Northbridge leads by 0 completed passes.');tie.packet.queryResults[0].count=8;tie.packet.queryResults[0].groups[0].count=4;assert.ok(tie.issues().length);
});
test('difference proof requires complete unfiltered two-team evidence with matching metric and window',()=>{
 for(const change of [s=>s.packet.queryResults[0].query.filters={type:'shot'},s=>s.packet.queryResults[0].query.filters.result=false,
  s=>s.packet.queryResults[0].query.timeFrom=90,s=>s.packet.queryResults[0].query.timeTo=100,
  s=>s.packet.queryResults[0].query.filters.player='carter',s=>s.packet.queryResults[0].query.filters.team='home',
  s=>s.packet.queryResults[0].query.groupCount={min:1},s=>s.packet.queryResults[0].truncated=true,
  s=>s.packet.queryResults[0].scope.missingFields.result=1,s=>s.packet.queryResults[0].groups.pop(),
  s=>s.packet.queryResults[0].groups[1].key='home',s=>s.packet.queryResults[0].count=10,
  s=>s.packet.queryResults[0].query.aggregate='by-player',s=>s.packet.queryResults[0].groups[0].count=5.5]){
  for(const extracted of [true,false]){const sample=differenceFixture(undefined,extracted);change(sample);assert.ok(sample.issues().length);}
 }
});

test('pronoun totals cannot borrow global or different-player counts',()=>{
 assert.ok(quantityFixture('He has 3 shots so far.',{groupKey:null}).issues().length);
 assert.ok(quantityFixture('He has 3 shots so far.',{question:'What has he done?',groupKey:null}).issues().length);
 assert.deepEqual(quantityFixture('He has 3 shots so far.').issues(),[]);
 assert.deepEqual(quantityFixture('He has 3 shots so far.',{groupKey:null,filters:{type:'shot',player:'carter'},entityResolution:{player:{status:'resolved',canonicalId:'carter'}}}).issues(),[]);
 const ambiguous=quantityFixture('Costa has 3 shots.');
 ambiguous.packet.roster=[{id:'carter',name:'M. Costa'},{id:'kerr',name:'E. Costa'}];
 assert.ok(ambiguous.issues().length);
});

test('complete global zero may survive omitted model extraction only with clear subject and coverage',()=>{
 const text='The score is still 0-0; no goals have been recorded so far in the match.';
 const base={question:'Should I celebrate yet, is the score still level?',count:0,groups:[],groupKey:null,filters:{type:'shot',result:true},extracted:false};
 assert.deepEqual(quantityFixture(text,base).issues(),[],'Preserved live celebrate-pending failure should be answerable');
 assert.deepEqual(quantityFixture('Carter has no goals.',base).issues(),[]);
 for(const change of [sample=>sample.packet.queryResults[0].query.filters.player='carter',sample=>sample.packet.queryResults[0].query.filters.team='home',
  sample=>sample.packet.queryResults[0].scope.missingFields.result=1,sample=>sample.packet.queryResults[0].truncated=true,
  sample=>sample.packet.queryResults[0].query.timeFrom=90,sample=>sample.packet.mentionedPlayerResolution=[{input:'Messi',status:'absent'}],
  sample=>sample.packet.mentionedPlayerResolution=[{input:'Costa',status:'ambiguous'}],sample=>sample.packet.queryResults[0].count=1]){
  const sample=quantityFixture(text,base);change(sample);assert.ok(sample.issues().length);
 }
 assert.ok(quantityFixture('Messi has no goals.',base).issues().length);
 assert.ok(quantityFixture('Messi has no goals.',{...base,question:'How many goals has Carter scored?'}).issues().length,'A known player in the question cannot authorize an unknown name in the answer');
 assert.ok(quantityFixture('He has no goals.',base).issues().length);
 assert.ok(quantityFixture('No goals by Messi.',base).issues().length);
});

test('verified roster absence allows an absent other actor but never an action or numeric zero',()=>{
 const packet={roster:[],mentionedPlayerResolution:[{input:'Lionel Messi',status:'absent'}],queryResults:[]};
 const draft=text=>({claims:[{text,kind:'observation',evidence:[]}]});
 const review=action=>({checks:[{claimIndex:0,actors:[{name:'Messi',action,individualAction:false}]}]});
 const text='Messi is not listed as a player for Northbridge in this match.';
 assert.equal(isRosterAbsenceText(text),true);
 assert.equal(reviewActorsMatchEvidence(review('other'),draft(text),packet),true);
 assert.equal(reviewActorsMatchEvidence(review('shot'),draft(text),packet),false);
 for(const bad of ['Messi has no goals.','Messi is not listed as a player but has no goals.','His intention is not listed in this match.','Messi is not on the ball in this match.'])assert.equal(isRosterAbsenceText(bad),false);
 packet.mentionedPlayerResolution[0].status='ambiguous';
 assert.equal(reviewActorsMatchEvidence(review('other'),draft(text),packet),false);
});

test('personal pronouns infer one roster player while excluding team affiliations',()=>{
 for(const pronoun of ['He','She','His']){
  const text=pronoun==='His'?'His tally is no goals so far.':`${pronoun} has no goals so far.`;
  const sample=quantityFixture(text,{question:'Has he scored yet?',count:0,groups:[],filters:{type:'shot',result:true},groupKey:null,extracted:false});
  sample.packet.conversation=[{answer:'M. Carter plays for the away team, Harbour Athletic.'}];
  assert.deepEqual(sample.issues(),[],pronoun);
  sample.packet.conversation=[{answer:'M. Carter and I. Kerr are players for Harbour Athletic and Northbridge.'}];
  assert.ok(sample.issues().length,'Two people remain ambiguous');
  sample.packet.conversation=[{answer:'Harbour Athletic are the away team.'}];
  assert.ok(sample.issues().length,'A personal pronoun cannot refer to a team-only antecedent');
 }
});

test('negative individual action extraction accepts only a whole assertion proved by complete zero evidence',()=>{
 const make=()=>quantityFixture('M. Carter has not scored a goal yet in this match.',{question:'Has he scored yet?',count:0,groups:[],filters:{type:'shot',result:true},groupKey:null});
 const review={checks:[{claimIndex:0,actors:[{name:'M. Carter',action:'goal',individualAction:true}],counts:[]}]};
 const valid=sample=>reviewActorsMatchEvidence(review,sample.answer,sample.packet);
 assert.equal(valid(make()),true);
 const individual=make();individual.packet.queryResults[0].count=1;individual.packet.queryResults[0].query.aggregate='by-player';individual.packet.queryResults[0].groups=[{key:'kerr',count:1}];
 assert.equal(valid(individual),true,'Missing actor group in complete unrestricted groups establishes zero');
 individual.packet.queryResults[0].groups.push({key:'carter',count:1});assert.equal(valid(individual),false);
 for(const modify of [s=>s.packet.queryResults[0].truncated=true,s=>s.packet.queryResults[0].scope.missingFields.result=1,
  s=>s.packet.queryResults[0].query.timeFrom=90,s=>s.packet.queryResults[0].query.timeTo=100,
  s=>delete s.packet.queryResults[0].query.filters.result,s=>{s.packet.queryResults[0].query.filters.player='kerr';s.packet.queryResults[0].entityResolution={player:{status:'resolved',canonicalId:'kerr'}};},
  s=>s.answer.claims[0].text+=' But Carter scored the winner.',s=>s.answer.claims[0].text='Carter has not scored a goal but made the winning assist.',
  s=>s.answer.claims[0].text='Carter has not scored a goal because he chose to pass.']){
  const sample=make();modify(sample);assert.equal(valid(sample),false);
 }
 const personal=make();personal.answer.claims[0].text='He has not scored a goal yet in this match.';
 personal.packet.conversation=[{answer:'M. Carter plays for Harbour Athletic.'}];assert.equal(valid(personal),true);
 personal.packet.conversation=[{answer:'M. Carter and I. Kerr are playing.'}];assert.equal(valid(personal),false);
});

test('pending outcome context is retained for review without changing the received result',()=>{
 const packet=projectionFixture();packet.pendingOutcomeContext={pendingShots:[{player:'Silva',time:20,outcome:'pending'}],limitation:'No confirmed goal yet.'};
 assert.deepEqual(projectReviewEvidence(packet,projectionAnswer()).pendingOutcomeContext,packet.pendingOutcomeContext);
});

test('pending shot quantities require an explicit local pending qualifier and preserve player initials',()=>{
 for(const text of ['Carter has one pending shot.','Carter has one unresolved attempt.','There is one shot by M. Carter that is still pending outcome.','There is one shot by M. Carter awaiting confirmation.']){
  const sample=quantityFixture(text,{question:'What is happening?',count:1,filters:{type:'shot',outcome:'pending'}});
  assert.equal(unsupportedCountCitations(sample.answer,sample.packet).length,0,text);
  assert.deepEqual(sample.issues(),[],text);
 }
 for(const text of ['Carter has one shot.','Carter has one shot; another attempt is pending.','There is one shot by M. Carter, while another is pending.','Carter has one shot and a pending attempt.']){
  const sample=quantityFixture(text,{count:1,filters:{type:'shot',outcome:'pending'}});
  assert.ok(unsupportedCountCitations(sample.answer,sample.packet).length,text);
  assert.ok(sample.issues().length,text);
 }
 assert.ok(quantityFixture('Carter has one pending shot.',{count:1}).issues().length,'All-shot count cannot prove pending subset');
});

test('pending outcomes block unqualified goal absence even when the reviewer omits actors',()=>{
 for(const text of ['Carter has no goals.','Carter has not scored a goal yet.','No one has scored.','There are no goals; a different sentence mentions confirmed goals.']){
  const sample=quantityFixture(text,{count:0,filters:{type:'shot',result:true}});
  sample.packet.pendingOutcomeContext={count:1,attempts:[{player:'M. Carter'}]};
  assert.ok(unsupportedCountCitations(sample.answer,sample.packet).length,text);
 }
 for(const text of ['Carter has no confirmed goals.','No goals have been recorded so far in the match.','Carter has not scored a confirmed goal yet.']){
  const sample=quantityFixture(text,{count:0,filters:{type:'shot',result:true}});
  sample.packet.pendingOutcomeContext={count:1,attempts:[{player:'M. Carter'}]};
  assert.deepEqual(unsupportedCountCitations(sample.answer,sample.packet),[],text);
 }
 const different=quantityFixture('Carter has no goals.',{count:0,filters:{type:'shot',result:true}});
 different.packet.pendingOutcomeContext={count:1,attempts:[{player:'I. Kerr'}]};
 assert.deepEqual(unsupportedCountCitations(different.answer,different.packet),[],'A known different actor pending does not negate complete Carter evidence');
 different.answer.claims[0].text='No one has scored.';
 assert.ok(unsupportedCountCitations(different.answer,different.packet).length,'A globally phrased absence cannot inherit a narrower actor from the question');
});

test('negative goal actor override cannot turn a pending outcome into a miss',()=>{
 const sample=quantityFixture('Carter has not scored a goal yet.',{count:0,filters:{type:'shot',result:true}});
 sample.packet.pendingOutcomeContext={count:1,attempts:[{player:'M. Carter'}]};
 const review={checks:[{claimIndex:0,actors:[{name:'M. Carter',action:'goal',individualAction:true}],counts:[]}]};
 assert.equal(reviewActorsMatchEvidence(review,sample.answer,sample.packet),false);
 sample.answer.claims[0].text='Carter has not scored a confirmed goal yet.';
 assert.equal(reviewActorsMatchEvidence(review,sample.answer,sample.packet),true);
});

function projectionFixture(){
 const scopeReference={type:'scope',id:'complete-shots',revision:1};
 return {question:'What did Silva do?',previousQuestion:'Who is playing?',conversation:[{question:'Who?',answer:'Silva'}],responseLanguage:'en',
  teams:{home:'Northbridge'},roster:[{id:'silva',name:'D. Silva'}],score:{home:0,away:0},observedAt:20,observedClock:'00:20',limits:'No intention or pressure measurement.',evidenceCapabilities:{unavailable:['intention']},
  queryResults:[{scopeReference,query:{filters:{type:'shot'},aggregate:'by-player',timeFrom:0,timeTo:20},count:1,matchedGroupCount:1,
   groups:[{key:'silva',count:1}],scope:{inventoryCount:9,missingFields:{outcome:1}},truncated:false,entityResolution:{player:{status:'resolved',canonicalId:'silva'}},
   rows:[{id:'pass',revision:2,type:'pass',time:8,result:true,playerId:'cole'},
    {id:'shot',revision:2,type:'shot',time:10,playerId:'silva',passId:'pass',assist:{passId:'pass',playerId:'cole'},outcome:'saved'},
    {id:'hold',revision:1,type:'recovery',time:11,cause:'shot',recoveryKind:'goalkeeper-hold'},
    {id:'next',revision:1,type:'pass',time:12,cause:'hold'},
    {id:'unrelated',revision:1,type:'receive',time:5}]},
   {scopeReference:{type:'scope',id:'other-scope',revision:1},query:{filters:{type:'pass'}},count:3,groups:[],scope:{missingFields:{}},truncated:true,rows:[]}],
  linkedContext:{rows:[{id:'shot',revision:2,type:'shot',time:10,playerId:'silva',passId:'pass',assist:{passId:'pass',playerId:'cole'},outcome:'saved'}]},
  playerContributions:{from:'00:00',to:'00:20',metrics:[{name:'shots',evidence:[scopeReference]}],coverage:'Zero only with complete coverage.'},
  namedPlayerActions:[{player:{id:'silva',name:'D. Silva'},count:1,truncated:false,actions:[{type:'shot',time:'00:10',evidence:[{type:'event',id:'shot',revision:2}]}]}],
  recentComparison:{from:'00:00',to:'00:20',metrics:[{filters:{type:'shot'},teams:[{team:'away',count:1}],evidence:[scopeReference]}]},
  assessmentDimensions:[{dimension:'chanceQuality',availability:'unmeasured',leader:null,evidence:[]}]};
}
const projectionAnswer=(...evidence)=>({claims:[{text:'Recorded action.',kind:'observation',evidence}]});

test('review projection retains exact cited scope coverage without unrelated citable inventory',()=>{
 const packet=projectionFixture(),original=structuredClone(packet),ref=packet.queryResults[0].scopeReference;
 const result=projectReviewEvidence(packet,projectionAnswer(ref));
 const {rows,...header}=packet.queryResults[0];
 assert.deepEqual(result.queryResults,[{...header,rows:[]}]);
 assert.deepEqual(result.linkedContext.rows,[]);
 assert.equal(result.queryResults[0].scope.missingFields.outcome,1,'Unknown coverage must not become a clean zero');
 assert.deepEqual(result.queryResults[0].entityResolution,header.entityResolution);
 assert.deepEqual(packet,original,'Projection does not mutate the full packet used by guards');
 for(const name of ['question','previousQuestion','conversation','responseLanguage','teams','roster','score','observedAt','observedClock','limits','evidenceCapabilities'])assert.deepEqual(result[name],packet[name]);
});

test('review projection follows one explicit hop in either direction and deduplicates records',()=>{
 const result=projectReviewEvidence(projectionFixture(),projectionAnswer({type:'event',id:'shot',revision:2}));
 assert.deepEqual(result.linkedContext.rows.map(row=>row.id).sort(),['hold','pass','shot']);
 assert.deepEqual(result.queryResults,[],'An event citation must not expose unrelated citable scope IDs');
 assert.equal(result.linkedContext.rows.find(row=>row.id==='shot').assist.passId,'pass');
 assert.equal(result.linkedContext.rows.find(row=>row.id==='hold').cause,'shot');
});

test('missing or stale cited revisions remain explicitly unavailable',()=>{
 const packet=projectionFixture(),refs=[{type:'event',id:'shot',revision:1},{type:'event',id:'absent',revision:1},{type:'scope',id:'complete-shots',revision:9}];
 packet.queryResults[0].rows.push({id:'shot',revision:1,type:'shot',time:10});
 const result=projectReviewEvidence(packet,projectionAnswer(...refs));
 assert.deepEqual(result.unavailableReferences,refs);
 assert.deepEqual(result.linkedContext.rows,[]);
 assert.deepEqual(result.queryResults,[]);
});

test('projection never introduces future, late-arriving, deleted or stale dependency records',()=>{
 const packet=projectionFixture();
 packet.queryResults[0].rows.push({id:'pass',revision:3,type:'pass',time:8,operation:'delete'},
  {id:'future',revision:1,type:'recovery',time:21,cause:'shot'},
  {id:'late',revision:1,type:'recovery',time:11,arrivedAt:21,cause:'shot'});
 const result=projectReviewEvidence(packet,projectionAnswer({type:'event',id:'shot',revision:2},{type:'event',id:'future',revision:1}));
 assert.deepEqual(result.linkedContext.rows.map(row=>row.id).sort(),['hold','shot']);
 assert.deepEqual(result.unavailableReferences,[{type:'event',id:'future',revision:1}]);
});

test('uncited relevance context retains counts, uncertainty and actions without citable references',()=>{
 const packet=projectionFixture();
 packet.evidenceCapabilities.recoveries=[{reference:{type:'event',id:'uncited-recovery',revision:1},forcingPlayer:null}];
 const result=projectReviewEvidence(packet,projectionAnswer({type:'event',id:'shot',revision:2}));
 const context=result.relevanceContext;
 assert.equal(context.citable,false);
 assert.equal(context.playerContributions.metrics[0].parts[0].groups[0].count,1);
 assert.equal(context.playerContributions.metrics[0].parts[0].scope.missingFields.outcome,1);
 assert.equal(context.playerContributions.metrics[0].parts[0].truncated,false);
 assert.equal(context.namedPlayerActions[0].actions[0].type,'shot');
 assert.equal(context.recentComparison.metrics[0].teams[0].count,1);
 assert.equal(context.assessmentDimensions[0].availability,'unmeasured');
 assert.doesNotMatch(JSON.stringify(context),/complete-shots|scopeReference|"evidence"|"reference"/);
 assert.deepEqual(result.evidenceCapabilities.recoveries,[{forcingPlayer:null}],'Capabilities retain limitations without expanding the citable inventory');
 assert.deepEqual(result.queryResults,[]);
});

test('review projection fingerprint identifies full source independently of citations and key order',()=>{
 const packet=projectionFixture(),first=projectReviewEvidence(packet,projectionAnswer());
 const reordered=Object.fromEntries(Object.entries(packet).reverse());
 assert.match(first.sourceFingerprint,/^[a-f0-9]{64}$/);
 assert.equal(projectReviewEvidence(reordered,projectionAnswer({type:'event',id:'shot',revision:2})).sourceFingerprint,first.sourceFingerprint);
 packet.queryResults[1].count++;
 assert.notEqual(projectReviewEvidence(packet,projectionAnswer()).sourceFingerprint,first.sourceFingerprint,'Even uncited source changes must change identity');
});

test('first and second shot outcomes follow complete event time rather than row order',()=>{
 const shots=[{id:'later',revision:1,type:'shot',playerId:'silva',time:58,result:false,outcome:'off-target'},
  {id:'first',revision:1,type:'shot',playerId:'silva',time:42,result:false,outcome:'blocked'}];
 const packet={queryResults:[{scopeReference:{type:'scope',id:'shots',revision:1},query:{aggregate:'by-player',filters:{type:'shot'}},groups:[{key:'silva',count:2}],truncated:false,rows:shots}]};
 const draft=text=>({claims:[{text,kind:'observation',evidence:shots.map(s=>({type:'event',id:s.id,revision:1}))}]});
 assert.equal(unsupportedOrderedOutcomes(draft('His first shot was off-target, the second was blocked.'),packet).length,2);
 assert.equal(unsupportedOrderedOutcomes(draft('His first shot was blocked, the second was off-target.'),packet).length,0);
 packet.queryResults[0].groups[0].count=3;
 assert.equal(unsupportedOrderedOutcomes(draft('His first shot was off-target.'),packet).length,0,'Incomplete history remains for semantic review, not a false deterministic order claim');
});

test('global first and latest shot assertions use the complete timeline rather than cited player history',()=>{
 const rows=[{id:'silva-latest',revision:1,type:'shot',playerId:'silva',player:'D. Silva',time:98,outcome:'blocked',result:false},
  {id:'reed-first',revision:1,type:'shot',playerId:'reed',player:'A. Reed',time:64,outcome:'saved',result:false}];
 const packet={observedAt:100,roster:[{id:'silva',name:'D. Silva'},{id:'reed',name:'A. Reed'}],queryResults:[],
  shotTimeline:{query:{filters:{type:'shot'},aggregate:'list',timeFrom:0,timeTo:100},count:2,truncated:false,scope:{missingFields:{type:0}},rows}};
 const draft=(text,evidence=rows.map(row=>({type:'event',id:row.id,revision:row.revision})),kind='observation')=>({claims:[{text,kind,evidence}]});
 assert.ok(unsupportedOrderedOutcomes(draft('The first shot by D. Silva was blocked.',[{type:'event',id:'silva-latest',revision:1}]),packet).length);
 assert.ok(unsupportedOrderedOutcomes(draft('There is no explicit recorded outcome for the most recent shot.',[],'limitation'),packet).length);
 assert.deepEqual(unsupportedOrderedOutcomes(draft('The first shot by A. Reed was saved and the latest shot by D. Silva was blocked.'),packet),[]);
 packet.roster.push({id:'keeper',name:'M. Carter'});
 assert.deepEqual(unsupportedOrderedOutcomes(draft('The first shot was saved by M. Carter.'),packet),[],'The goalkeeper saving a shot is not its shooter');
 assert.deepEqual(unsupportedOrderedOutcomes(draft('Silva’s first shot was blocked.',[{type:'event',id:'silva-latest',revision:1}]),packet),[],'Possessive player-relative order is not global order');
 for(const modify of [p=>p.shotTimeline.truncated=true,p=>p.shotTimeline.count=3,p=>p.shotTimeline.scope.missingFields.outcome=1,p=>p.shotTimeline.query.timeFrom=90,p=>p.shotTimeline.rows[0].time=101]){
  const incomplete=structuredClone(packet);modify(incomplete);
  assert.deepEqual(unsupportedOrderedOutcomes(draft('The first shot was blocked.'),incomplete),[],'Incomplete context cannot prove global order');
 }
 const pending=structuredClone(packet);pending.shotTimeline.rows[0].outcome='pending';
 assert.deepEqual(unsupportedOrderedOutcomes(draft('There is no explicit recorded outcome for the most recent shot.',[],'limitation'),pending),[]);
 const projection=projectReviewEvidence(packet,draft('The first shot was saved.'));
 assert.equal(projection.relevanceContext.citable,false);
 assert.equal(projection.relevanceContext.shotTimeline.count,2);
});

test('missing outcome assertions bind to the specific ordinal and exclude warnings or other unknown attributes',()=>{
 const packet={observedAt:100,queryResults:[],shotTimeline:{query:{filters:{type:'shot'},aggregate:'list',timeFrom:0,timeTo:100},count:2,truncated:false,scope:{missingFields:{}},rows:[
  {id:'first',revision:1,type:'shot',time:64,result:false,outcome:'saved'},
  {id:'last',revision:1,type:'shot',time:98,result:false,outcome:'blocked'}]}};
 const check=text=>unsupportedOrderedOutcomes({claims:[{text,kind:'limitation',evidence:[]}]},packet);
 const live='There is no explicit record of the first shot’s outcome in the provided data, so its result cannot be compared to the most recent shot.';
 assert.equal(check(live).length,1,'The failure belongs to the first shot, not to the latest shot mentioned later');
 for(const text of ["There is no explicit record of the first shot's outcome.",'The first shot’s outcome is unknown.','The outcome of the latest shot is not recorded.','No information about the most recent attempt’s result is available.'])assert.ok(check(text).length,text);
 for(const text of ['There is no explicit record of the first shot’s intention.','The first shot’s outcome is known, while the intention is unknown.',
  "Do not say 'there is no explicit record of the first shot’s outcome'.",
  'It is wrong to claim that there is no explicit record of the first shot’s outcome.',
  "The claim 'no explicit record of the first shot’s outcome' is false."])assert.deepEqual(check(text),[],text);
 packet.shotTimeline.rows[0].outcome='pending';assert.deepEqual(check(live),[],'A genuinely pending first outcome must not contaminate the known latest outcome');
 packet.shotTimeline.rows[0].outcome='saved';packet.shotTimeline.truncated=true;assert.deepEqual(check(live),[],'Incomplete timelines cannot establish the contradiction');
});

test('recorded ordered events cannot be called missing regardless of claim kind, while unknown attributes remain unknown',()=>{
 const packet={observedAt:100,queryResults:[],shotTimeline:{query:{filters:{type:'shot'},aggregate:'list',timeFrom:0,timeTo:100},count:2,truncated:false,scope:{missingFields:{}},rows:[
  {id:'last',revision:1,type:'shot',time:98,result:false,outcome:'blocked'},
  {id:'first',revision:1,type:'shot',time:64,result:false,outcome:'saved'}]}};
 const draft=(text,kind='limitation')=>({claims:[{text,kind,evidence:[]}]});
 const live='There is no recorded first shot in the available data, so its outcome cannot be compared.';
 for(const kind of ['limitation','observation','interpretation','general'])assert.equal(unsupportedOrderedOutcomes(draft(live,kind),packet)[0].correctRecord.id,'first');
 for(const text of ['There is no first shot in the record.','There is no record of the latest shot.','The first attempt is missing.','The most recent shot is not recorded.','The latest attempt has not been recorded.','There is no data about the first shot.'])assert.equal(unsupportedOrderedOutcomes(draft(text),packet).length,1,text);
 const exact={claims:[{text:'The most recent shot in the match was taken by D. Silva at 98 seconds and was blocked.',kind:'observation',evidence:[]},...draft(live).claims]};
 assert.deepEqual(unsupportedOrderedOutcomes(exact,packet).map(issue=>issue.claimIndex),[1],'Exact paired-run failure rejects the false limitation, not the correct latest outcome');
 for(const text of ['The first shot’s intention is unknown.','There is no record of the first shot’s intention.','There is no recorded first shot intention.',
  "Do not say 'there is no recorded first shot in the available data'.",'It is incorrect to claim that there is no recorded first shot.',
  'There is no recorded second shot by Cole.'])assert.deepEqual(unsupportedOrderedOutcomes(draft(text),packet),[],text);
 for(const change of [p=>delete p.shotTimeline,p=>p.shotTimeline.truncated=true,p=>p.shotTimeline.count=3,p=>p.shotTimeline.rows=[],p=>p.shotTimeline.query.timeFrom=90]){
  const incomplete=structuredClone(packet);change(incomplete);assert.deepEqual(unsupportedOrderedOutcomes(draft(live),incomplete),[]);
 }
 packet.shotTimeline.rows[1].outcome='pending';assert.equal(unsupportedOrderedOutcomes(draft(live),packet).length,1,'A pending outcome does not make the existing event absent');
});

test('aggregate count proof cannot authorize a different action or borrow another subject total',()=>{
 const scopeReference={type:'scope',id:'passes',revision:1};
 const packet={roster:[{id:'carter',name:'M. Carter'},{id:'kerr',name:'I. Kerr'}],queryResults:[{scopeReference,query:{filters:{type:'pass',result:true},aggregate:'by-player',timeFrom:0},count:3,groups:[{key:'carter',count:2},{key:'kerr',count:1}],scope:{missingFields:{}},truncated:false,rows:[]}]};
 const claim=text=>({claims:[{text,kind:'observation',evidence:[scopeReference]}]});
 const review=(text,value,groupKey,actors=[])=>({checks:[{claimIndex:0,counts:[{text,value,groupKey,scopeReference}],actors}]});
 const mixed=claim('Carter completed two passes and scored the winning goal.');
 const mixedReview=review('two passes',2,'carter',[{name:'Carter',action:'goal',individualAction:true}]);
 assert.equal(reviewActorsMatchEvidence(mixedReview,mixed,packet),false);
 assert.equal(reviewCountIssues(review('three passes',3,null),claim('Carter completed three passes.'),packet).length,1);
 const swapped=claim('Carter completed one pass; Kerr completed two passes.');
 const checks={checks:[{claimIndex:0,counts:[{text:'one pass',value:1,groupKey:'kerr',scopeReference},{text:'two passes',value:2,groupKey:'carter',scopeReference}]}]};
 assert.ok(reviewCountIssues(checks,swapped,packet).length>0);
});

test('quantities bind published words to metric, subject and complete scope',()=>{
 const scopeReference={type:'scope',id:'holds',revision:1};
 const packet={question:'How many collections so far?',roster:[{id:'carter',name:'M. Carter'},{id:'kerr',name:'I. Kerr'}],queryResults:[{scopeReference,query:{aggregate:'by-player',filters:{type:'recovery',recoveryKind:'goalkeeper-hold',linkedShotOutcome:'saved'},timeFrom:0},count:3,groups:[{key:'carter',count:2},{key:'kerr',count:1}],scope:{missingFields:{}},truncated:false,rows:[]}]};
 const draft={claims:[{text:'Carter has collected two saved attempts.',kind:'observation',evidence:[scopeReference]}]};
 const review=(value=2,groupKey='carter',text='two saved attempts')=>({checks:[{claimIndex:0,counts:[{text,value,groupKey,scopeReference}]}]});
 assert.equal(reviewCountIssues(review(),draft,packet).length,0);
 packet.teams={away:'Harbour Athletic',home:'Northbridge'};
 assert.equal(reviewCountIssues(review(),{claims:[{...draft.claims[0],text:'M. Carter from Harbour Athletic has collected two saved attempts.'}]},packet).length,0);
 assert.equal(countClaimSpans('deux passes décisives')[0].text,'deux passes décisives');
 assert.equal(reviewCountIssues(review(1),draft,packet).length,1);
 assert.equal(reviewCountIssues(review(2,'invented'),draft,packet).length,1);
 assert.equal(reviewCountIssues({checks:[{claimIndex:0,counts:[]}]},draft,packet).length,1);
 const wrongNumber={claims:[{...draft.claims[0],text:'Carter has collected 99 saved attempts.'}]};
 assert.equal(reviewCountIssues(review(),wrongNumber,packet).length,1);
 const wrongMetric={claims:[{...draft.claims[0],text:'Carter scored two goals.'}]};
 assert.equal(reviewCountIssues(review(2,'carter','two goals'),wrongMetric,packet).length,1);
 const ordinary={claims:[{...draft.claims[0],text:'Carter supplied the final pass.'}]};
 assert.equal(reviewCountIssues(review(),ordinary,packet).length,0);
 assert.equal(reviewCountIssues(review(),{claims:[{...draft.claims[0],evidence:[reference]}]},packet).length,1);
 packet.queryResults[0].scope.missingFields.linkedShotOutcome=1;
 assert.equal(reviewCountIssues(review(),draft,packet).length,1);
 packet.queryResults[0].scope.missingFields={};packet.queryResults[0].query.timeFrom=90;
 assert.equal(reviewCountIssues(review(),draft,packet).length,1);
 packet.queryResults[0].query.timeFrom=0;packet.queryResults[0].truncated=true;
 assert.equal(reviewCountIssues(review(),draft,packet).length,1);
});

test('real recovery references do not license causal attribution in either live failed answer',()=>{
 for(const text of [
  'J. Cole forced the turnover by recovering the ball at 01:06 after an unsuccessful pass from M. Costa.',
  'J. Cole forced the turnover by making a successful ball recovery at 66 seconds, after a failed pass from M. Costa at 62 seconds.',
  'A different defender caused the error through pressure.',
  'Cole forced the turnover; his intention is unknown.'
 ])assert.equal(unsupportedCausalClaims(answer(text)).length,1,text);
});

test('recorded recovery observations and explicit causal limitations remain available',()=>{
 for(const text of [
  'Cole recovered the ball after Costa’s failed pass.',
  'The recovery does not show who forced the turnover.',
  'Who forced the turnover is unknown.',
  'We cannot tell whether Cole forced the mistake.',
  'Cole did not force the error.'
 ])assert.deepEqual(unsupportedCausalClaims(answer(text)),[],text);
 assert.deepEqual(unsupportedCausalClaims({scope:'general',claims:[{text:'Pressure can force an error.',kind:'general',evidence:[]}]}),[]);
});

test('negated lead-in cannot license a positive causal assertion after but',()=>{
 assert.equal(unsupportedCausalClaims(answer('The intent is unknown, but Cole forced the turnover.')).length,1);
});

test('checks use exact cited revisions, retain scope coverage and expose recovery constraints',()=>{
 const scopeReference={type:'scope',id:'count',revision:1};
 const row={id:'recovery',revision:1,type:'recovery',player:'Cole',cause:'failed-pass',time:66};
 const packet={queryResults:[{scopeReference,query:{aggregate:'count'},count:0,groups:[],scope:{missingFields:{bodyPart:2}},truncated:false,rows:[]}],linkedContext:{rows:[row]}};
 const checks=claimEvidenceChecks({claims:[{text:'Recovered.',kind:'observation',evidence:[reference]},{text:'Count.',kind:'observation',evidence:[scopeReference]},{text:'Stale.',kind:'observation',evidence:[{...reference,revision:2}]}]},packet);
 assert.equal(checks[0].cited[0].record,row);
 assert.match(checks[0].constraints.recovery,/does not identify/);
 assert.match(checks[0].constraints.forcedErrorAttribution,/unavailable/);
 assert.equal(checks[1].cited[0].record.scope.missingFields.bodyPart,2);
 assert.equal(checks[2].cited[0].record,null);
 const capabilities=matchEvidenceCapabilities(packet);
 assert.equal(capabilities.recoveries[0].recoveringPlayer,'Cole');
 assert.equal(capabilities.recoveries[0].linkedPriorEvent,'failed-pass');
 assert.equal(capabilities.recoveries[0].forcingPlayer,null);
});

test('extracted actors cannot convert another player shot into a Cole shot or an absent player into zero goals',()=>{
 const shot={id:'shot',revision:1,type:'shot',player:'A. Reed',playerId:'reed',result:false};
 const packet={roster:[{id:'reed',name:'A. Reed'},{id:'cole',name:'J. Cole'}],linkedContext:{rows:[shot]}};
 const draft={claims:[{text:'Cole shot',kind:'observation',evidence:[{type:'event',id:'shot',revision:1}]}]};
 const review=(name,action,individualAction)=>({checks:[{claimIndex:0,actors:[{name,action,individualAction}]}]});
 assert.equal(reviewActorsMatchEvidence(review('Cole','shot',true),draft,packet),false);
 assert.equal(reviewActorsMatchEvidence(review('Messi','goal',false),draft,packet),false);
 assert.equal(reviewActorsMatchEvidence(review('Reed','shot',true),draft,packet),true);
 assert.equal(reviewActorsMatchEvidence({checks:[{claimIndex:0}]},draft,packet),false);
});

test('individual assist checks require explicit credited player on a confirmed goal',()=>{
 const goal={id:'goal',revision:2,type:'shot',player:'A. Reed',playerId:'reed',result:true,assist:{playerId:'cole',player:'J. Cole'}};
 const packet={roster:[{id:'reed',name:'A. Reed'},{id:'cole',name:'J. Cole'}],linkedContext:{rows:[goal]}};
 const draft={claims:[{text:'Cole assisted',kind:'observation',evidence:[{type:'event',id:'goal',revision:2}]}]};
 const review={checks:[{claimIndex:0,actors:[{name:'Cole',action:'assist',individualAction:true}]}]};
 assert.equal(reviewActorsMatchEvidence(review,draft,packet),true);
 goal.assist=null;assert.equal(reviewActorsMatchEvidence(review,draft,packet),false);
});

test('reception can cite a completed pass to that player but not a failed or pending pass',()=>{
 const row={id:'pass',revision:1,type:'pass',playerId:'cole',receiverId:'reed',result:true};
 const packet={roster:[{id:'reed',name:'A. Reed'},{id:'cole',name:'J. Cole'}],linkedContext:{rows:[row]}};
 const draft={claims:[{text:'Reed received the pass',kind:'observation',evidence:[{type:'event',id:'pass',revision:1}]}]};
 const review={checks:[{claimIndex:0,actors:[{name:'Reed',action:'receive',individualAction:true}]}]};
 assert.equal(reviewActorsMatchEvidence(review,draft,packet),true);
 for(const result of [false,null]){row.result=result;assert.equal(reviewActorsMatchEvidence(review,draft,packet),false);}
});

test('unmeasured pressure, chance quality and intention assertions cannot borrow real event citations',()=>{
 for(const text of ['They are creating better chances.','Those passes support sustained offensive pressure.','Cole chose to shoot.','Reed panicked.','Northbridge creates better chances with 3 shots while Harbour has no shots.','There is no evidence of another option, so Cole chose to progress play.'])assert.equal(unsupportedMeasurementClaims(answer(text)).length,1,text);
 for(const text of ['They have made more shots.','The record does not establish chance quality or possession.','We cannot know why he chose to shoot.'])assert.equal(unsupportedMeasurementClaims(answer(text)).length,0,text);
 assert.equal(unsupportedMeasurementClaims({claims:[{text:'Pressure can force a rushed pass.',kind:'general',evidence:[]}]}).length,0);
 const limitation={claims:[{text:"The record does not provide information on Reed's intention, the defensive pressure he faced, or the quality of the shooting opportunity such as open lanes or positioning of defenders.",kind:'limitation',evidence:[]}]};
 assert.equal(unsupportedMeasurementClaims(limitation).length,0,'A long requested limitation is not a positive pressure claim');
 limitation.claims[0].text='There is no xG, but Northbridge applied sustained pressure.';
 assert.equal(unsupportedMeasurementClaims(limitation).length,1,'An earlier disclaimer cannot license a later positive assertion');
});

test('absence of an action cannot prove positive or negative ball control',()=>{
 for(const text of ['Cole had the ball.','Cole did not have the ball at that moment.','Cole was not in control of the ball.','No pass is recorded, indicating he did not have the ball to pass.','Cole was not in possession.','Cole is in possession.','They were not in possession.','No pass is recorded, so Cole was not in possession.'])assert.equal(unsupportedMeasurementClaims(answer(text)).length,1,text);
 for(const text of ['I cannot tell whether Cole had the ball.','It is unclear whether Cole did not have the ball.','Cole completed a pass to Mensah.','We cannot know whether Cole was in possession.','It is unclear whether Cole was not in possession.'])assert.equal(unsupportedMeasurementClaims(answer(text)).length,0,text);
});

test('numerical scoring probabilities cannot borrow observed shot references',()=>{
 for(const text of ['Reed had a 90% chance of scoring.','The scoring probability was 40 percent.','That chance of scoring is 75%.'])assert.equal(unsupportedMeasurementClaims(answer(text)).length,1,text);
 for(const text of ['I cannot establish a 90% chance of scoring.','The scoring probability is unavailable.'])assert.equal(unsupportedMeasurementClaims(answer(text)).length,0,text);
});

test('review actor extraction distinguishes real teams from absent players',()=>{
 const packet={teams:{home:'Northbridge',away:'Harbour Athletic'},roster:[{id:'reed',name:'A. Reed'}],queryResults:[]};
 const draft={claims:[{text:'Northbridge has more attempts',kind:'observation',evidence:[]}]};
 const review=name=>({checks:[{claimIndex:0,actors:[{name,action:'shot',individualAction:false}]}]});
 assert.equal(reviewActorsMatchEvidence(review('Northbridge'),draft,packet),true);
 assert.equal(reviewActorsMatchEvidence(review('Harbour Athletic'),draft,packet),true);
 assert.equal(reviewActorsMatchEvidence(review('Messi'),draft,packet),false);
 assert.equal(reviewActorsMatchEvidence(review('Invented United'),draft,packet),false);
});

test('no-shot circulation cannot become a dominance claim',()=>{
 const packet={assessmentDimensions:[{dimension:'attempts',home:0,away:0}]};
 assert.equal(unsupportedMeasurementClaims(answer('Harbour is pushing more based on two passes.'),packet).length,1);
 assert.equal(unsupportedMeasurementClaims(answer('Harbour completed two passes to Northbridge’s one.'),packet).length,0);
 assert.equal(unsupportedMeasurementClaims(answer('The counts cannot establish who is pushing more.'),packet).length,0);
});

test('shot outcomes and attempt counts do not establish scoring likelihood',()=>{
 for(const text of ['No attempts were on target, indicating a low chance of scoring so far.','The shot was off target, so its scoring probability was likely low.','Those two attempts gave them a high probability of scoring.']){
  assert.equal(unsupportedMeasurementClaims(answer(text)).length,1,text);
 }
 assert.equal(unsupportedMeasurementClaims(answer('The chance of scoring is unknown.')).length,0);
});

test('assist prose must cite explicit credit even if the reviewer only extracts a pass',()=>{
 const pass={id:'pass',revision:2,type:'pass',result:true,playerId:'cole',receiverId:'reed'};
 const goal={id:'goal',revision:2,type:'shot',result:true,playerId:'reed',assist:{playerId:'cole'}};
 const packet={linkedContext:{rows:[pass,goal]}};
 for(const text of ['Cole assisted the goal.','Une passe décisive de Cole.','Cole dio la asistencia.','Cole fez a assistência.']){
  const claim={claims:[{text,kind:'observation',evidence:[{type:'event',id:'pass',revision:2}]}]};
  assert.equal(unsupportedAssistClaims(claim,packet).length,1,text);
  claim.claims[0].evidence.push({type:'event',id:'goal',revision:2});
  assert.equal(unsupportedAssistClaims(claim,packet).length,0,text);
 }
 const limitation={claims:[{text:'The assist is not credited.',kind:'limitation',evidence:[]}]};
 assert.equal(unsupportedAssistClaims(limitation,packet).length,0);
});

test('negated measurement lists remain limitations without licensing a new positive clause',()=>{
 for(const text of ['Shots on target alone do not capture all aspects of goalkeeper busyness, such as saves, crosses, or defensive pressure.','These figures do not measure saves, crosses, pressure or possession.'])assert.deepEqual(unsupportedMeasurementClaims(answer(text)),[],text);
 for(const text of ['These figures do not measure saves, crosses, but they applied defensive pressure.','These figures do not measure saves, crosses, Northbridge applied pressure.','Northbridge applied pressure and the figures do not measure possession.','Shots do not measure pressure, but they created better chances.'])assert.equal(unsupportedMeasurementClaims(answer(text)).length,1,text);
});


test('recent evidence cannot silently become a whole-match assessment',()=>{
 const fixture=quantityFixture('Both keepers have been similarly busy so far in the match.',{timeFrom:90,timeTo:120});fixture.answer.claims[0].kind='interpretation';
 assert.equal(unsupportedAssessmentWindows(fixture.answer,fixture.packet).length,1);
 fixture.answer.claims[0].text='Both keepers faced the same number of attempts in the recent period.';assert.deepEqual(unsupportedAssessmentWindows(fixture.answer,fixture.packet),[]);
 fixture.answer.claims[0].text='Both keepers have been similarly busy so far in the match.';fixture.packet.queryResults[0].query.timeFrom=0;assert.deepEqual(unsupportedAssessmentWindows(fixture.answer,fixture.packet),[]);
});


test('a full-window scope for a different actor cannot license a recent assessment',()=>{
 const fixture=quantityFixture('The player has been busier overall.',{filters:{type:'shot',player:'carter'},timeFrom:90,timeTo:120});fixture.answer.claims[0].kind='interpretation';
 const full=structuredClone(fixture.packet.queryResults[0]);full.scopeReference.id='other-player';full.query.timeFrom=0;full.query.filters.player='kerr';fixture.packet.queryResults.push(full);fixture.answer.claims[0].evidence.push(full.scopeReference);
 assert.equal(unsupportedAssessmentWindows(fixture.answer,fixture.packet).length,1);
 full.query.filters.player='carter';assert.deepEqual(unsupportedAssessmentWindows(fixture.answer,fixture.packet),[]);
 full.query.timeToExclusive=true;assert.equal(unsupportedAssessmentWindows(fixture.answer,fixture.packet).length,1);
});
test('positive grouped action evidence supports involvement without repeating its count',()=>{
 const ref={type:'scope',id:'receptions',revision:1};
 const source={scopeReference:ref,query:{filters:{type:'receive'},aggregate:'by-player',timeFrom:0,timeTo:79},groups:[{key:'reed',count:2}],scope:{missingFields:{}},truncated:false,rows:[]};
 const packet={currentTime:79,roster:[{id:'reed',name:'A. Reed'},{id:'cole',name:'J. Cole'}],queryResults:[source]};
 const draft={claims:[{text:'Reed is involved in receiving.',kind:'interpretation',evidence:[ref]}]};
 const review={checks:[{claimIndex:0,actors:[{name:'Reed',action:'receive',individualAction:true}],counts:[]}]};
 assert.equal(reviewActorsMatchEvidence(review,draft,packet),true);
 for(const mutate of [s=>s.groups[0].count=0,s=>s.groups[0].key='cole',s=>s.truncated=true,s=>s.scope.missingFields.player=1,s=>s.query.aggregate='by-team',s=>s.query.filters.type='shot']){
  const changed=structuredClone(source);mutate(changed);assert.equal(reviewActorsMatchEvidence(review,draft,{...packet,queryResults:[changed]}),false);
 }
});
