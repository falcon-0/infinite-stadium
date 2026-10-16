import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedOperationMetrics,allowedTypedOperationMetrics,allowedOperationOperators,allowedOperationSubjects,allowedOperationWindow,operationMetricPolicyDescription} from './operation-capabilities.js';

const allowed=(question,options={})=>allowedOperationMetrics({question,...options});
const permits=(question,metric,options)=>assert.ok(allowed(question,options).includes(metric),question);
const denies=(question,metric,options)=>assert.ok(!allowed(question,options).includes(metric),question);

test('adjectival passing accuracy permits completion rate without licensing other accuracy metrics',()=>{
 permits('How accurate has Cole’s passing been?','passCompletionRate');
 denies('How accurate has Cole’s shooting been?','passCompletionRate');
 denies('Show all passes, not just accurate passes.','passCompletionRate');
});

test('unqualified shots retain all attempts, not an on-target or goal-only inventory',()=>{
 for(const question of ['Compare the first shot with the latest shot.','How did the earliest attempt turn out?','Comparez le premier tir et le dernier.','Compara el primer tiro con el último.','Compare a primeira tentativa com a última.','What happened at 01:04 and 01:38?']){
  assert.deepEqual(allowed(question),['attempts','recoveries'],question);
 }
 assert.match(operationMetricPolicyDescription,/not universal natural-language entailment/);
});

test('nominal on-target subsets are licensed in four languages and independent of response language',()=>{
 for(const question of ['How many shots on target?','Compare the first on-target shot with the latest.','Were there any shots on target?','Combien de tirs cadrés ?','Compare les tirs cadres.','¿Cuántos tiros a puerta hubo?','Quantos chutes no alvo?','Compare os tiros à baliza.'])permits(question,'shotsOnTarget');
 permits('Compare on-target shots.','shotsOnTarget',{language:'fr'});
});

test('asking an individual shot outcome never licenses a filtered historical timeline',()=>{
 for(const question of ['Was the first shot on target?','Is his latest shot on target?','Was Reed’s first shot on target?','Did the first shot go on target?','Was it on target?','Le premier tir était-il cadré ?','Était-ce un tir cadré ?','¿Fue el primer tiro a puerta?','Foi o primeiro chute no alvo?'])denies(question,'shotsOnTarget');
});

test('negated, excluded and broadened subsets are not licensed',()=>{
 for(const question of ['Compare all shots, including shots on target.','Not just on-target shots: compare the first and latest.','Compare shots, not only shots on target.','Compare non on-target shots.','Compare shots not on target.','Compare shots excluding on-target shots.','Comparez tous les tirs, y compris les tirs cadrés.','Compara todos los tiros, no solo los tiros a puerta.','Compare todos os chutes, incluindo chutes no alvo.'])denies(question,'shotsOnTarget');
 for(const question of ['How many passes were not completed?','Which passes weren’t completed?','How many passes were not fully completed?','Compare passes, not just completed passes.','Show failed passes instead of completed passes.'])denies(question,'completedPasses');
});

test('explicit completion, goals and credits license their filters across all supported languages',()=>{
 const samples={completedPasses:['Compare completed passes.','Are pass completions level?','Compare pass completion.','How many passes has Cole completed?','Compare successful passes.','¿Cuántos pases completó Cole?','Compare les passes réussies.','Quantos passes completos?'],
  goals:['Who scored the goals?','Compare confirmed goals.','¿Cuántos goles?','Combien de buts ?','Qui a marqué un but ?','Quantos gols?'],
  creditedAssists:['Compare credited assists.','Who assisted that goal?','¿Cuántas asistencias?','Compare les passes décisives.','Quantas assistências?']};
 for(const [metric,questions] of Object.entries(samples))for(const question of questions)permits(question,metric);
});

test('English but is not a French goal token and qualifiers need actual metric context',()=>{
 for(const question of ['Compare the shots, but include both outcomes.','But what happened first?','The pass was late, but accurate.'])denies(question,'goals',{language:'fr'});
 for(const question of ['What happened on target?','Compare target positions.','How did it turn out?','Give me the successful outcome.','How much clinical edge did they have?']){
  denies(question,'shotsOnTarget');denies(question,'completedPasses');
 }
 permits('Combien de buts ?','goals');permits('Est-ce un but ?','goals');
});

test('irrelevant clock and window wording cannot create restrictive metric permission',()=>{
 assert.deepEqual(allowed('Compare shots on either side of 00:30, from first to latest.'),['attempts','recoveries']);
 assert.deepEqual(allowed('Compare the first and latest shots after a successful minute.'),['attempts','recoveries']);
 permits('Compare completed passes from 00:30 to 01:20.','completedPasses');
 permits('Compare shots on target during the last thirty seconds.','shotsOnTarget');
});

test('current explicit topic overrides history and answers cannot supply metric permission',()=>{
 const conversation=[{question:'Who has completed more passes?',answer:'Northbridge has more completed passes and goals.'}];
 assert.deepEqual(allowed('And shots?',{conversation}),['attempts','recoveries']);
 permits('And the other side?', 'completedPasses',{conversation});
 denies('And the other side?','goals',{conversation});
 assert.deepEqual(allowed('And possession?',{conversation}),['attempts','recoveries']);
 assert.deepEqual(allowed('And shots?',{previousQuestion:'How many shots on target?'}),['attempts','recoveries']);
 permits('Et les mêmes ?', 'shotsOnTarget',{conversation:[{question:'Combien de tirs cadrés ?'}]});
 permits('And now?','completedPasses',{conversation:[{question:'Compare completed passes.'},{question:'And the other side?'}]});
 denies('And now?','completedPasses',{conversation:[{question:'Compare completed passes.'},{question:'What is a low block?'}]});
 denies('And not just those?','shotsOnTarget',{conversation:[{question:'Compare shots on target.'}]});
 denies('And all of them?','completedPasses',{conversation});
});

test('mixed explicit concepts may license both filters, unfamiliar paraphrases never get silently translated',()=>{
 const mixed=allowed('Compare completed passes and credited assists.');assert.ok(mixed.includes('completedPasses'));assert.ok(mixed.includes('creditedAssists'));assert.ok(!mixed.includes('shotsOnTarget'));
 denies('Compare passes and successful shots.','completedPasses');
 for(const question of ['Compare their clinical efforts.','How much did they threaten?','Compare deliveries that found a friend.','Compare the first effort that tested the keeper with the latest.'])assert.deepEqual(allowed(question),['attempts','recoveries']);
 for(const input of [undefined,null,{},[],{question:42},{question:'',conversation:[null]}])assert.deepEqual(allowedOperationMetrics(input),['attempts','recoveries']);
});

const scope={teams:{home:'Northbridge',away:'Harbour Athletic'},roster:[{id:'h1',name:'J. Cole'},{id:'h2',name:'M. Costa'},{id:'a1',name:'L. Costa'},{id:'a2',name:'D. Silva'}]};
test('operation grammar leaves qualitative, unary, roster and unsupported filters to free-form planning',()=>{
 for(const question of ['Why did Cole not pass there?','Who has been the standout so far, and why?','Who last played a pass with the left foot?','Did that shot count? What is the score now?','What is offside?','Is Messi playing in either lineup?','Which side has more passes with the right foot?','Compare the first and latest shots by xG.','Compare the speed of the first and latest shots.']){
  assert.deepEqual(allowedOperationOperators({...scope,question}),[],question);
 }
 assert.deepEqual(allowedOperationOperators({...scope,question:'Compare the first shot with the latest shot.'}),['orderedEndpoints']);
 assert.deepEqual(allowedOperationOperators({...scope,question:'Which team has completed more passes, and by how many?'}),['difference']);
});
test('typed metrics cannot silently cross from passes to shots or recoveries',()=>{
 assert.deepEqual(allowedTypedOperationMetrics({question:'Which team has completed more passes?'}),['completedPasses']);
 assert.deepEqual(allowedTypedOperationMetrics({question:'Compare first and latest shots.'}),['attempts']);
 assert.deepEqual(allowedTypedOperationMetrics({question:'Compare first and latest shots on target.'}),['shotsOnTarget']);
 assert.deepEqual(allowedTypedOperationMetrics({question:'Compare first and latest passes.'}),[]);
 assert.deepEqual(allowedTypedOperationMetrics({question:'Which side has more recoveries?'}),['recoveries']);
});
test('global questions cannot inherit a player from the current event; ambiguous surnames are unlicensed',()=>{
 assert.deepEqual(allowedOperationSubjects({...scope,question:'Compare the first and latest shots.',selectedAnchor:'a2',recentActions:[{player:'a2'}]}),{difference:[],orderedEndpoints:[[]],ratio:[['home','away']]});
 assert.deepEqual(allowedOperationSubjects({...scope,question:'Compare Costa’s first and latest shots.'}).orderedEndpoints,[[]]);
 assert.deepEqual(allowedOperationSubjects({...scope,question:'Compare Silva’s first and latest shots.'}).orderedEndpoints,[[],['a2']]);
 assert.deepEqual(allowedOperationSubjects({...scope,question:'Compare Cole and Silva on completed passes.'}).difference,[['h1','a2']]);
 assert.deepEqual(allowedOperationSubjects({...scope,question:'Which side has more shots?'}).difference,[['home','away']]);
});
test('follow-ups inherit only explicit question scope, never fabricated entities from answer prose',()=>{
 const conversation=[{question:'Which team has completed more passes?',answer:'Cole leads Silva.'}];
 assert.deepEqual(allowedOperationSubjects({...scope,question:'And what is the gap in shots?',conversation}).difference,[['home','away']]);
 assert.deepEqual(allowedOperationOperators({...scope,question:'And what is the gap in shots?',conversation}),['difference']);
 assert.deepEqual(allowedOperationSubjects({...scope,question:'Compare first and latest shots.',conversation}).orderedEndpoints,[[]]);
});
test('operation windows cannot narrow a full received-match question without a time request',()=>{
 assert.deepEqual(allowedOperationWindow({question:'Compare first and latest shots.',time:110}),{kind:'full',from:0,to:110});
 for(const question of ['Which side has more shots in the last 30 seconds?','Compare shots from 00:30 to 01:10.','Which side has more shots over the last half minute?'])assert.deepEqual(allowedOperationWindow({question,time:110}),{kind:'explicit'});
 for(const question of ['Compare shots since halftime.','Which side has had more shots recently?','Compare shots in the last few minutes.'])assert.equal(allowedOperationWindow({question,time:110}),null);
});
test('pass percentage requests use a ratio, with raw counts and other percentage domains kept distinct',()=>{
 for(const question of ['What is the passing accuracy for each side?','What is the pass completion rate?','Quel est le pourcentage de passes réussies ?','¿Cuál es el porcentaje de pases completados?','Qual é a precisão dos passes?']){
  assert.deepEqual(allowedTypedOperationMetrics({...scope,question}),['passCompletionRate'],question);
  assert.deepEqual(allowedOperationOperators({...scope,question}),['ratio'],question);
 }
 assert.deepEqual(allowedOperationOperators({...scope,question:'Why is the pass completion rate low?'}),[]);
 assert.deepEqual(allowedOperationOperators({...scope,question:'What is Cole’s passing accuracy?'}),[]);
 assert.deepEqual(allowedOperationOperators({...scope,question:'Which team has better shot accuracy?'}),[]);
 assert.deepEqual(allowedOperationSubjects({...scope,question:'What is Northbridge’s passing accuracy?'}).ratio,[['home']]);
 assert.deepEqual(allowedTypedOperationMetrics({...scope,question:'Which team has completed more passes?'}),['completedPasses']);
});
