import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatchConversation, questionFailureMessage, questionCanRetry, captureQuestionMoment, matchAssistantStatus,questionEvidenceSnapshot,questionEvidenceChanged,chatIsNearBottom,answerMomentLinks} from './match-chat-state.js';
const context = {kind:'sustained', seed:17, matchId:'demo', language:'en', time:30};
const answer = {question:'Who scored?', answer:'Nobody yet.'};

test('view choices accompany a pinned question and retry keeps the original choices',()=>{
 const chat=createMatchConversation(),profile={audience:'player',favoriteClub:'away',favoritePlayer:'D. Silva'};
 const request=chat.begin({...context,...profile},'How is he doing?');
 for(const [key,value] of Object.entries(profile))assert.equal(request.payload[key],value);
 const retry=chat.retry(request,{...context,time:60,audience:'analyst',favoritePlayer:'J. Cole'});
 assert.equal(retry.payload.time,30);assert.equal(retry.payload.favoritePlayer,'D. Silva');assert.equal(retry.payload.audience,'player');
});

test('seeking through an empty stream preserves history and waits for the same actual match identity',()=>{
 const state=createMatchConversation();state.accept(state.begin(context,answer.question),context,answer);
 const request=state.begin({...context,time:35},'Why?');
 assert.equal(state.sync({...context,matchId:null,time:20}),false);
 assert.equal(state.accept(request,{...context,matchId:null,time:20},answer),false);
 assert.equal(state.sync({...context,time:20}),false);
 assert.equal(state.accept(request,{...context,time:20},answer),true);
 assert.deepEqual(state.begin({...context,time:40},'What next?').payload.conversation.map(turn=>turn.time),[30,35]);
});

test('transient empty streams cannot carry answers or history into another fixture',()=>{
 for(const change of [{matchId:'other'}, {seed:18}, {kind:'quiet'}]){
  const state=createMatchConversation();state.accept(state.begin(context,answer.question),context,answer);
  const request=state.begin(context,'Why?');state.sync({...context,matchId:null});
  const other={...context,...change};assert.equal(state.sync(other),true);
  assert.equal(state.accept(request,other,answer),false);
  assert.deepEqual(state.begin(other,'What happened?').payload.conversation,[]);
 }
 const state=createMatchConversation(),request=state.begin(context,'Why?');
 assert.equal(state.accept(request,context,{...answer,matchId:'wrong-response'}),false);
});

test('answer scrolling follows only readers near the end of the transcript',()=>{
 assert.equal(chatIsNearBottom({scrollHeight:600,clientHeight:300,scrollTop:270}),true);
 assert.equal(chatIsNearBottom({scrollHeight:600,clientHeight:300,scrollTop:200}),false);
 assert.equal(chatIsNearBottom({scrollHeight:200,clientHeight:300,scrollTop:0}),true);
});

test('moment links require cited, received and unchanged events and reject future or withdrawn moments',()=>{
 const event={id:'shot',revision:1,time:25,arrivedAt:25};
 const moment={anchorId:'shot',revision:1,time:25,label:'Shot'};
 const response={observedAt:30,moments:[moment,moment],evidence:[{type:'event',id:'shot',revision:1}]};
 assert.deepEqual(answerMomentLinks(response,[event],30),[moment]);
 assert.deepEqual(answerMomentLinks(response,[event],20),[]);
 assert.deepEqual(answerMomentLinks({...response,evidence:[]},[event],30),[]);
 assert.deepEqual(answerMomentLinks({...response,observedAt:20},[event],30),[]);
 assert.deepEqual(answerMomentLinks(response,[event,{...event,revision:2,arrivedAt:28}],30),[]);
 assert.deepEqual(answerMomentLinks(response,[{...event,operation:'delete'}],30),[]);
 assert.deepEqual(answerMomentLinks(response,[{...event,arrivedAt:35}],30),[]);
});

test('aggregate and absence answers detect revisions and late arrivals within their cited window',()=>{
 const records=[{id:'shot',revision:1,time:10,arrivedAt:10},{id:'future',revision:1,time:30,arrivedAt:30}];
 const snapshot=questionEvidenceSnapshot(records,20);
 const aggregate={evidence:[{type:'scope',id:'goals',revision:1}],lookups:[{scope:{reference:{id:'goals'},timeFrom:0,timeTo:20}}]};
 assert.equal(questionEvidenceChanged(aggregate,snapshot,records),false);
 assert.equal(questionEvidenceChanged(aggregate,snapshot,[...records,{id:'shot',revision:2,time:10,arrivedAt:22}]),true);
 assert.equal(questionEvidenceChanged(aggregate,snapshot,[...records,{id:'late',revision:1,time:18,arrivedAt:24}]),true);
 assert.equal(questionEvidenceChanged(aggregate,snapshot,[...records,{id:'future',revision:2,time:30,arrivedAt:31}]),false);
 assert.equal(questionEvidenceChanged({...aggregate,evidence:[]},snapshot,[...records,{id:'shot',revision:2,time:10,arrivedAt:22}]),false);
});
test('direct event citations still detect corrections independently of aggregate windows',()=>{
 const snapshot=questionEvidenceSnapshot([{id:'shot',revision:1,time:10}],20);
 assert.equal(questionEvidenceChanged({evidence:[{type:'event',id:'shot',revision:1}]},snapshot,[{id:'shot',revision:2,time:10}]),true);
});

test('advancing playback preserves the request timestamp and permits its answer', () => {
 const state = createMatchConversation(), request = state.begin(context, answer.question);
 assert.equal(state.sync({...context,time:60}),false);
 assert.equal(state.accept(request,{...context,time:60},answer),true);
 assert.equal(request.payload.time,30);
 const next = state.begin({...context,time:65},'And who assisted?');
 assert.equal(next.payload.conversation[0].time,30);
 assert.equal(next.payload.previousQuestion,answer.question);
});

test('rewinding removes future context including the previous question', () => {
 const state = createMatchConversation();
 state.accept(state.begin(context,answer.question),context,answer);
 const next = state.begin({...context,time:10},'Who scored first?');
 assert.deepEqual(next.payload.conversation,[]);
 assert.equal(next.payload.previousQuestion,undefined);
 state.accept(next,{...context,time:10},answer);
 assert.deepEqual(state.begin({...context,time:60},'Why?').payload.conversation.map(t=>t.time),[10]);
});

test('switching match rejects pending answers and clears history', () => {
 for(const change of [{matchId:'different'}, {seed:2}]) {
  const state = createMatchConversation(), request = state.begin(context,answer.question);
  assert.equal(state.sync({...context,...change}),true);
  assert.equal(state.accept(request,{...context,...change},answer),false);
  assert.deepEqual(state.begin({...context,...change},'Who?').payload.conversation,[]);
 }
});

test('cancelled and superseded answers cannot enter conversation history', () => {
 const state = createMatchConversation(), first = state.begin(context,'first');
 const second = state.begin(context,'second');
 assert.equal(state.accept(first,context,answer),false);
 state.cancel();
 assert.equal(state.accept(second,context,answer),false);
 assert.deepEqual(state.begin(context,'third').payload.conversation,[]);
});

test('history stays bounded and preserves successful context after a failed request', () => {
 const state = createMatchConversation();
 for(let time=1;time<=4;time++) state.accept(state.begin({...context,time},'q'),{...context,time},{question:'q'.repeat(400),answer:'a'.repeat(800)});
 state.begin({...context,time:5},'unanswered');
 const next = state.begin({...context,time:6},'follow-up');
 assert.deepEqual(next.payload.conversation.map(t=>t.time),[3,4]);
 assert.equal(next.payload.conversation[0].question.length,200);
 assert.equal(next.payload.conversation[0].answer.length,500);
});

test('clarifications display without becoming the topic of a subsequent question', () => {
 const state=createMatchConversation();
 const clarification={question:'j',answer:'Could you clarify what you would like to know?',scope:'clarify',status:'limited'};
 assert.equal(state.accept(state.begin(context,clarification.question),context,clarification),true);
 const next=state.begin({...context,time:35},'Who scored?');
 assert.deepEqual(next.payload.conversation,[]);
 assert.equal(next.payload.previousQuestion,undefined);
});

test('repeated clarifications preserve both successful turns for a natural follow-up', () => {
 const state=createMatchConversation();
 const scored={question:'Who scored?',answer:'A. Reed scored.',scope:'match',status:'answered'};
 const assisted={question:'Who assisted him?',answer:'J. Cole assisted Reed.',scope:'match',status:'answered'};
 state.accept(state.begin(context,scored.question),context,scored);
 state.accept(state.begin({...context,time:35},assisted.question),{...context,time:35},assisted);
 for(const time of [36,37,38]){
  const current={...context,time},clarification={question:'j',answer:'Could you clarify?',scope:'clarify',status:'limited'};
  assert.equal(state.accept(state.begin(current,clarification.question),current,clarification),true);
 }
 const next=state.begin({...context,time:40},'What else has Cole done?');
 assert.deepEqual(next.payload.conversation.map(turn=>turn.question),[scored.question,assisted.question]);
 assert.equal(next.payload.previousQuestion,assisted.question);
});

test('clarification cannot bypass cancellation or match identity checks', () => {
 const state=createMatchConversation(),clarification={question:'j',answer:'Could you clarify?',scope:'clarify',status:'limited'};
 const request=state.begin(context,clarification.question);
 assert.equal(state.accept(request,{...context,matchId:'another'},clarification),false);
 state.cancel();
 assert.equal(state.accept(request,context,clarification),false);
});

test('supported limitations remain useful conversation context', () => {
 const state=createMatchConversation();
 const limited={question:'Who forced the turnover?',answer:'Cole recovered it, but the record does not identify who forced the mistake.',scope:'match',status:'limited'};
 assert.equal(state.accept(state.begin(context,limited.question),context,limited),true);
 const next=state.begin({...context,time:35},'What happened just before that?');
 assert.equal(next.payload.conversation[0].answer,limited.answer);
 assert.equal(next.payload.previousQuestion,limited.question);
});

test('explicit retry preserves the pinned payload and cannot cross a fixture change',()=>{
 const state=createMatchConversation();state.accept(state.begin(context,answer.question),context,answer);
 const original=state.begin({...context,time:35,anchorId:'shot'},'Who supplied that pass?');
 const later={...context,time:80,language:'fr'};
 assert.equal(state.begin(later,'A new question').payload.conversation.length,1,'failed requests add no context');
 const retry=state.retry(original,later);
 assert.deepEqual(retry.payload,original.payload);assert.notEqual(retry.id,original.id);
 assert.notEqual(retry.payload.conversation,original.payload.conversation);
 assert.equal(state.accept(original,later,answer),false);
 assert.equal(state.accept(retry,later,{question:original.payload.question,answer:'Cole.'}),true);
 assert.equal(state.retry(original,{...later,matchId:null}),null);
 assert.equal(state.retry(original,{...later,seed:18,matchId:'other'}),null);
});

test('retry is available only for transient failures, never semantic, allowance or access failures',()=>{
 for(const [status,code] of [[429,'azure-rate-limit'],[429,'generation-busy'],[502,'azure-network'],[502,'azure-http'],[504,'azure-timeout']])assert.equal(questionCanRetry(status,code),true,code);
 for(const [status,code] of [[429,undefined],[429,'budget-exhausted'],[401,'azure-http'],[403,'azure-network'],[400,'azure-http'],[502,'question-withheld'],[502,'question-unsupported-cause'],[502,'question-time-unit'],[502,undefined],[503,undefined]])assert.equal(questionCanRetry(status,code),false,String(code));
});

test('errors describe unavailable or unverified answers without internal validator details', () => {
 assert.match(questionFailureMessage(429),/usage limit/);
 assert.match(questionFailureMessage(429,'azure-rate-limit'),/temporarily busy/);
 assert.doesNotMatch(questionFailureMessage(429,'azure-rate-limit'),/allowance|usage limit/);
 assert.match(questionFailureMessage(429,'generation-busy'),/Another answer/);
 assert.match(questionFailureMessage(502),/could not verify/);
 assert.match(questionFailureMessage(503),/unavailable/);
 assert.match(questionFailureMessage(502,'azure-network'),/could not connect/);
 assert.match(questionFailureMessage(502,'azure-http'),/could not connect/);
 assert.match(questionFailureMessage(504,'azure-timeout'),/took too long/);
 assert.match(questionFailureMessage(502,'question-unsupported-cause'),/cannot establish who forced/);
 for(const code of ['question-unsupported-cause','question-withheld','question-time-unit'])assert.doesNotMatch(questionFailureMessage(502,code),/try again|connection/i);
});


test('live questions use the displayed timestamp and never inherit an editorial highlight',()=>{
 assert.deepEqual(captureQuestionMoment({time:96,displayTime:94.7,following:true,anchorId:'old-shot'}),{time:94});
 assert.deepEqual(captureQuestionMoment({time:96,displayTime:99,following:true}),{time:96});
 assert.deepEqual(captureQuestionMoment({time:96,displayTime:null,following:true}),{time:96});
 assert.deepEqual(captureQuestionMoment({time:96,displayTime:94,following:false,anchorId:'selected-pass'}),{time:96,anchorId:'selected-pass'});
});


test('fan availability distinguishes exhausted allowance from a generic outage',()=>{
 assert.equal(matchAssistantStatus({configured:false,provider:'azure',aiUnavailableReason:'budget'}).label,'AI allowance used');
 assert.equal(matchAssistantStatus({configured:true,provider:'azure'}).label,'AI match assistant');
 assert.equal(matchAssistantStatus({configured:false}).label,'AI unavailable');
 assert.equal(matchAssistantStatus({configured:false},{allowRecordedSearch:true}).label,'Recorded match search');
});

 test('language changes preserve successful history and accept the pinned in-flight answer',()=>{
 const state=createMatchConversation();state.accept(state.begin(context,answer.question),context,answer);
 const request=state.begin(context,'Why?'), french={...context,language:'fr',time:40};
 assert.equal(state.sync(french),false);
 assert.equal(state.accept(request,french,{...answer,language:'en'}),true);
 const next=state.begin(french,'Et ensuite?');assert.equal(next.payload.language,'fr');assert.equal(next.payload.conversation.length,2);assert.equal(request.payload.language,'en');
 });

test('later play does not invalidate a pinned whole-passage scope but a late historical correction does',()=>{
 const original=[{id:'pass',revision:1,time:8,arrivedAt:8}],before=questionEvidenceSnapshot(original,12);
 const answer={observedAt:12,evidence:[{type:'scope',id:'all',revision:1}],lookups:[{scope:{reference:{id:'all'},timeFrom:0,timeTo:120}}]};
 assert.equal(questionEvidenceChanged(answer,before,[...original,{id:'next',revision:1,time:23,arrivedAt:23}]),false);
 assert.equal(questionEvidenceChanged(answer,before,[...original,{id:'late',revision:1,time:10,arrivedAt:23}]),true);
 assert.equal(questionEvidenceChanged(answer,before,[...original,{id:'pass',revision:2,time:8,arrivedAt:24}]),true);
});
