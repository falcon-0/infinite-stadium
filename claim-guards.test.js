import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewClaimRisks} from './claim-guards.js';
const r=(id,revision=1)=>({id,revision,type:'event'});
const recovery={...r('recovery'),team:'away',type:'recovery',time:170},shot={...r('shot',2),team:'away',type:'shot',time:178};
const outputs={score_at_moment:{references:[r('earlier-goal',2),r('shot',2)]},get_event_sequence:{scope:{anchorId:'shot'},events:[recovery,shot]}};
const check=(text,evidence=[],language='en',tools=outputs)=>reviewClaimRisks({claims:[{text,evidence}]},{outputs:tools,language});
test('targeted guards catch the three actual Azure draft failure types',()=>{
 assert.match(check('A goal at 178 seconds, equalizing the score to 1-1.',[r('shot',2)])[0],/every supplied score/);
 assert.match(check('The goal resulted from a recovery and pass, illustrating an effective attacking play.')[0],/causal or attacking/);
 const velocity=check('Displacement rate was 1.7 metres per second over the one-second interval, indicating movement velocity at shot time was moderate.');
 assert.equal(velocity.length,2);assert.match(velocity[0],/sampled interval/);assert.match(velocity[1],/threshold/);
});
test('neutral supported rewrites pass the narrow safeguards in four languages',()=>{
 const examples={en:['The recorded score was 1-1.','A shot was recorded 8 seconds after the recovery.','The sampled interval displacement rate was 1.7 metres per second.'],es:['El marcador registrado era 1-1.','Se registró un disparo 8 segundos después de la recuperación.','La tasa de desplazamiento del intervalo muestreado fue 1,7 metros por segundo.'],fr:['Le score enregistré était de 1-1.','Un tir a été enregistré 8 secondes après la récupération.','Le taux de déplacement de l’intervalle échantillonné était de 1,7 mètres par seconde.'],pt:['O placar registado era 1-1.','Um remate foi registado 8 segundos após a recuperação.','A taxa de deslocamento do intervalo amostrado foi de 1,7 metros por segundo.']};
 for(const [language,[score,timing,rate]] of Object.entries(examples)){
  assert.deepEqual(check(score,outputs.score_at_moment.references,language),[]);
  assert.deepEqual(check(timing,[r('recovery'),r('shot',2)],language),[]);
  assert.deepEqual(check(rate,[r('metric')],language),[]);
 }
});
test('known risk phrases and per-claim score references are checked across supported languages',()=>{
 for(const [language,text] of Object.entries({en:'The goal was caused by the recovery.',es:'El gol se produjo debido a la recuperación.',fr:'Le but a été marqué à cause de la récupération.',pt:'O golo resultou de uma recuperação.'}))assert.match(check(text,[],language)[0],/causal/);
 for(const [language,text] of Object.entries({en:'The shot equalized the score.',es:'El disparo igualó el marcador.',fr:'Le tir a égalisé le score.',pt:'O remate igualou o placar.'}))assert.match(check(text,[r('shot',2)],language)[0],/score-support/);
 assert.equal(check('The recorded score was 1-1.',[r('earlier-goal',1),r('shot',2)]).length,1);
 for(const [language,text] of Object.entries({en:'Velocity at shot time was moderate at 1.7 m/s.',es:'La velocidad en el momento del disparo fue moderada: 1,7 m/s.',fr:'La vitesse au moment du tir était modérée : 1,7 m/s.',pt:'A velocidade no momento do remate era moderada: 1,7 m/s.'}))assert.equal(check(text,[],language).length,2);
});
test('timing checks require uniquely derivable event boundaries and never borrow citations across claims',()=>{
 assert.match(check('The recovery preceded the shot by 8 seconds.',[r('shot',2)])[0],/both uniquely/);
 const draft={claims:[{text:'The score was 1-1.',evidence:[r('shot',2)]},{text:'The earlier goal was recorded.',evidence:[r('earlier-goal',2)]}]};
 assert.equal(reviewClaimRisks(draft,{outputs}).length,1);
 assert.deepEqual(check('A recovery preceded a shot by 8 seconds.',[], 'en',{}),[]);
 const ambiguous={get_event_sequence:{scope:{anchorId:'shot'},events:[recovery,{...recovery,id:'another'},shot]}};
 assert.deepEqual(check('A recovery preceded a shot by 8 seconds.',[], 'en',ambiguous),[]);
});
test('missing tools and empty reference lists do not invent score proof or ban ordinary outcomes',()=>{
 assert.deepEqual(check('A goal was recorded after a completed pass.',[r('shot',2)],'en',{}),[]);
 assert.deepEqual(check('The score was 0-0.',[],'en',{score_at_moment:{references:[]}}),[]);
 assert.deepEqual(reviewClaimRisks({claims:[]},{outputs:[],language:'en'}),[]);
 assert.match(reviewClaimRisks({claims:[]},{language:'unknown'})[0],/do not cover/);
 assert.deepEqual(check('The sampled interval rate was 1.7 m/s at shot time.'),[]);
 assert.equal(check('The sampled interval rate was fast at 1.7 m/s.').length,1);
});

const patternMetrics=[
 {team:'away',kind:'shots',value:3,evidence:[r('earlier-shot-1',2),r('earlier-shot-3',2),r('shot',2)]},
 {team:'away',kind:'completedPasses',value:2,evidence:[r('earlier-pass',2),r('pass',2)]},
 {team:'away',kind:'recoveries',value:3,evidence:[r('interception'),r('earlier-recovery'),r('recovery')]},
 {team:'away',kind:'pendingPasses',value:1,evidence:[r('pending')]},
 {team:'home',kind:'shots',value:0,evidence:[]}
];
const patternOutputs={...outputs,get_match_patterns:{analysis:{metrics:patternMetrics}}};
const allWindowRefs=patternMetrics.slice(0,3).flatMap(m=>m.evidence);
test('actual Azure recheck count and movement claims trigger missing inputs and unsupported prose',()=>{
 const text='Within the two-minute window ending at the shot event, the away team made three shots, completed two passes, and had three possession recoveries, indicating active attacking play.';
 const issues=check(text,[r('shot',2),r('pass',2),r('recovery')],'en',patternOutputs);
 assert.equal(issues.length,4);assert.equal(issues.filter(i=>/every counted received input/.test(i)).length,3);
 assert.match(check('D. Silva moved at a displacement rate of about 1.7 metres per second in the one second interval before the shot.')[0],/Moved at wording/);
 assert.deepEqual(check('The sample displacement rate between the received positions was 1.7 metres per second.'),[]);
 assert.deepEqual(check('D. Silva moved at a sampled interval displacement rate of 1.7 metres per second.'),[]);
});
test('window metric count references are complete per claim in all four supported languages',()=>{
 const wording={en:'In the window, the away team recorded three shots, completed two passes, and made three recoveries.',es:'En la ventana, el equipo visitante registró tres disparos, completó dos pases y tres recuperaciones.',fr:'Dans la fenêtre, l’équipe à l’extérieur a enregistré trois tirs, deux passes réussies et trois récupérations.',pt:'Na janela, a equipa visitante registou três remates, completou dois passes e três recuperações.'};
 for(const [language,text] of Object.entries(wording)){
  assert.deepEqual(check(text,allWindowRefs,language,patternOutputs),[]);
  assert.equal(check(text,[r('shot',2),r('pass',2),r('recovery')],language,patternOutputs).length,3);
 }
 for(const [language,text] of Object.entries({en:'Within the window, Harbour Athletic had one pending pass.',es:'En la ventana, Harbour Athletic registró un pase pendiente.',fr:'Dans la fenêtre, Harbour Athletic avait une passe en attente.',pt:'Na janela, Harbour Athletic registou um passe pendente.'})){
  assert.equal(check(text,[],language,patternOutputs).length,1);
  assert.deepEqual(check(text,[r('pending')],language,patternOutputs),[]);
 }
 assert.deepEqual(check('In the window, Northbridge had zero shots.',[],'en',patternOutputs),[]);
});
test('ambiguous teams are surfaced instead of guessing or unioning both teams',()=>{
 assert.match(check('The window contained three shots.',[],'en',patternOutputs)[0],/ambiguous team/);
 assert.match(check('In the window, home and away recorded three shots.',[],'en',patternOutputs)[0],/ambiguous team/);
 assert.deepEqual(check('A shot occurred after a recovery.',[],'en',patternOutputs),[]);
});
test('moment pass counts use the received sequence boundaries without demanding unrelated window references',()=>{
 const pass={...r('pass',2),team:'away',type:'pass',result:true,time:172};
 const tools={...patternOutputs,get_event_sequence:{scope:{anchorId:'shot'},events:[recovery,pass,shot]}};
 const wording={en:'One completed pass was recorded between the recovery and shot.',es:'Un pase completado se registró entre la recuperación y el disparo.',fr:'Une passe réussie a été enregistrée entre la récupération et le tir.',pt:'Um passe completo foi registado entre a recuperação e o remate.'};
 for(const [language,text] of Object.entries(wording)){
  assert.deepEqual(check(text,[r('recovery'),r('pass',2),r('shot',2)],language,tools),[]);
  assert.match(check(text,[r('recovery'),r('shot',2)],language,tools)[0],/every counted pass/);
 }
 const claims={claims:[{text:wording.en,evidence:[r('recovery'),r('shot',2)]},{text:'The pass was completed.',evidence:[r('pass',2)]}]};
 assert.equal(reviewClaimRisks(claims,{outputs:tools,language:'en'}).length,1);
});
