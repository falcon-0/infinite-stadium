import test from 'node:test';
import assert from 'node:assert/strict';
import {createInvestigationTools} from './investigation-tools.js';
import {investigateWithAgents} from './agent-workflow.js';

const input={kind:'central',seed:17,time:8,anchorId:'central-17-shot',audience:'analyst'};
const config={url:'https://test.openai.azure.com',deployment:'test',key:'test'};
const claim=(text='A. Reed scored.',revision=1)=>({claims:[{text,evidence:[{id:'central-17-shot',revision}]}]});
const reply=value=>({finish_reason:'stop',message:{content:JSON.stringify(value)}});
const tools=(names,id='call')=>({finish_reason:'tool_calls',message:{tool_calls:names.map((name,i)=>({id:`${id}-${i}`,type:'function',function:{name,arguments:'{}'}}))}});
function provider(steps,inspect=()=>{}){
 let calls=0;
 const fetcher=async(url,options)=>{
  const body=JSON.parse(options.body);inspect(body,calls);
  assert.ok(calls<steps.length,'Unexpected model call');
  return new Response(JSON.stringify({choices:[steps[calls++]],usage:{prompt_tokens:10,completion_tokens:5}}));
 };
 return {fetcher,count:()=>calls};
}

test('tools are pinned to received evidence and cannot expand their scope or execute unknown actions',()=>{
 const registry=createInvestigationTools(input);
 const output=registry.execute('get_position_samples',{});
 assert.ok(output.positions.every(f=>f.arrivedAt<=8&&f.time<=8&&f.revision===1));
 output.positions[0].players[0].x=999;
 assert.notEqual(registry.execute('get_position_samples',{}).positions[0].players[0].x,999);
 for(const args of [{time:10},{anchorId:'future'},[],null])assert.throws(()=>registry.execute('measure_moment',args));
 for(const name of ['exec','fetch','constructor','__proto__'])assert.throws(()=>registry.execute(name,{}));
 assert.throws(()=>createInvestigationTools({...input,time:7}),/has not arrived/);
});
test('compact model positions retain received frame revisions and measurement participants without claiming full coverage',()=>{
 const request={...input,time:10};
 const full=createInvestigationTools(request),compact=createInvestigationTools(request,{compactPositions:true});
 const original=full.execute('get_position_samples',{}),selected=compact.execute('get_position_samples',{});
 assert.match(selected.coverage,/partial selection/);
 assert.deepEqual(selected.references,original.references);
 const required=new Set(compact.execute('measure_moment',{}).metrics.flatMap(metric=>[metric.playerId,metric.opponentId]).filter(Boolean));
 for(const [index,frame] of selected.positions.entries()){
  assert.equal(frame.id,original.positions[index].id);assert.equal(frame.revision,original.positions[index].revision);
  assert.ok(frame.arrivedAt<=10&&frame.time<=8);
  assert.equal(original.positions[index].players.length,22);assert.ok(frame.players.length<22);
  assert.deepEqual(frame.ball,original.positions[index].ball);
  for(const id of required)assert.ok(frame.players.some(player=>player.id===id));
  for(const player of frame.players)assert.deepEqual(player,original.positions[index].players.find(record=>record.id===player.id));
 }
 selected.positions[0].players[0].x=999;
 assert.notEqual(compact.execute('get_position_samples',{}).positions[0].players[0].x,999);
});
test('pattern tool is bounded to the selected event time and returns every count dependency',()=>{
 const registry=createInvestigationTools({kind:'extended',seed:17,time:362,anchorId:'extended-17-5-shot',audience:'analyst'});
 const output=registry.execute('get_match_patterns',{});
 assert.equal(output.analysis.anchorTime,178);
 assert.equal(output.analysis.window.start,58);
 assert.ok(output.analysis.patterns.every(p=>p.evidence.every(r=>output.references.some(found=>found.id===r.id&&found.revision===r.revision))));
 assert.ok(output.analysis.metrics.every(m=>m.evidence.every(r=>output.references.some(found=>found.id===r.id&&found.revision===r.revision))));
 assert.throws(()=>registry.execute('get_match_patterns',{anchorTime:362}));
});
test('investigator chooses evidence tools and a separate reviewer approves a cited draft',async()=>{
 const mock=provider([tools(['get_event_sequence','measure_moment']),reply(claim()),reply({decision:'approve',issues:[]})],(body,index)=>{
  if(index===0){assert.equal(body.tools.length,5);assert.ok(!body.messages[1].content.includes('players'));}
  if(index===1){assert.equal(body.messages.filter(m=>m.role==='tool').length,2);}
  if(index===2){assert.equal(body.tools,undefined);assert.match(body.messages[0].content,/separate factual reviewer/);}
 });
 const result=await investigateWithAgents(input,{config,fetcher:mock.fetcher});
 assert.equal(result.status,'draft');assert.equal(result.execution.modelCalls,3);
 assert.equal(result.execution.toolCalls,2);assert.equal(result.execution.repairCount,0);
 assert.deepEqual(result.execution.usage,{promptTokens:30,completionTokens:15});
 assert.equal(result.execution.usageReportedCalls,3);
 assert.ok(result.trace.some(t=>t.stage==='reviewer'&&t.decision==='approve'));
 assert.equal(result.claims.length,1);
});
test('incomplete score citations and causal prose trigger repair before model approval can release them',async()=>{
 const request={kind:'extended',seed:17,time:180,anchorId:'extended-17-5-shot',audience:'analyst'};
 const latest={id:request.anchorId,revision:2};
 const bad={claims:[{text:'D. Silva equalized to 1-1 because of effective attacking play.',evidence:[latest]}]};
 const repaired={claims:[{text:'The recorded score was 1-1.',evidence:[{id:'extended-17-0-shot',revision:2},latest]}]};
 const mock=provider([tools(['get_event_sequence','score_at_moment']),reply(bad),reply(repaired),reply({decision:'approve',issues:[]})],(body,index)=>{
  if(index===2){assert.match(body.messages.at(-1).content,/every supplied score-support/);assert.match(body.messages.at(-1).content,/causal/);}
  if(index===3){assert.match(body.messages[1].content,/supportedFacts/);}
 });
 const result=await investigateWithAgents(request,{config,fetcher:mock.fetcher});
 assert.equal(result.status,'draft');assert.equal(result.execution.repairCount,1);
 assert.equal(result.execution.modelCalls,4);
 assert.ok(result.trace.some(t=>t.stage==='claim-safeguards'&&t.type==='rejection'));
});
test('repeating known unsupported wording withholds the draft without asking a model to approve it',async()=>{
 const bad=claim('The goal resulted from effective attacking play.');
 const mock=provider([tools(['get_event_sequence']),reply(bad),reply(bad)]);
 const result=await investigateWithAgents(input,{config,fetcher:mock.fetcher});
 assert.equal(result.status,'withheld');assert.deepEqual(result.claims,[]);
 assert.equal(result.execution.modelCalls,3);assert.ok(result.issues.some(issue=>/causal/.test(issue)));
});
test('cancellation stops further agent calls after an in-flight tool decision',async()=>{
 const controller=new AbortController();let calls=0;
 await assert.rejects(investigateWithAgents(input,{config,signal:controller.signal,fetcher:async()=>{
  calls++;controller.abort();
  return new Response(JSON.stringify({choices:[tools(['get_event_sequence'])]}));
 }}),error=>error.status===499);
 assert.equal(calls,1);
});
test('reviewer can reject unsupported meaning and trigger one repaired draft',async()=>{
 const mock=provider([tools(['get_event_sequence']),reply(claim('The goal proves tactical superiority.')),
  reply({decision:'revise',issues:['The events do not establish tactical superiority.']}),
  reply(claim()),reply({decision:'approve',issues:[]})]);
 const result=await investigateWithAgents(input,{config,fetcher:mock.fetcher});
 assert.equal(result.status,'draft');assert.equal(result.execution.repairCount,1);
 assert.equal(result.execution.modelCalls,5);assert.equal(result.claims[0].text,'A. Reed scored.');
});
test('repeated review rejection withholds claims',async()=>{
 const reject=reply({decision:'revise',issues:['Unsupported causation.']});
 const mock=provider([tools(['get_event_sequence']),reply(claim()),reject,reply(claim()),reject]);
 const result=await investigateWithAgents(input,{config,fetcher:mock.fetcher});
 assert.equal(result.status,'withheld');assert.deepEqual(result.claims,[]);assert.equal(result.execution.repairCount,1);
});
test('citation validation catches obsolete references before model review and allows repair',async()=>{
 const mock=provider([tools(['get_event_sequence']),reply(claim('Old scorer',1)),reply(claim('A. Reed scored.',2)),reply({decision:'approve',issues:[]})]);
 const result=await investigateWithAgents({...input,time:10},{config,fetcher:mock.fetcher});
 assert.equal(result.status,'draft');assert.equal(result.execution.repairCount,1);
 assert.equal(result.claims[0].evidence[0].revision,2);
 assert.ok(result.trace.some(t=>t.stage==='validation'));
});
test('a valid but ungathered reference cannot be cited',async()=>{
 const mock=provider([tools(['get_position_samples']),reply(claim()),reply(claim())]);
 const result=await investigateWithAgents(input,{config,fetcher:mock.fetcher});
 assert.equal(result.status,'withheld');assert.equal(mock.count(),3);
});
test('tool budgets, malformed decisions and missing evidence fail closed',async()=>{
 const repeated=provider([tools(['get_event_sequence','get_position_samples','measure_moment','score_at_moment']),tools(['get_event_sequence','get_position_samples','measure_moment'],'more')]);
 await assert.rejects(investigateWithAgents(input,{config,fetcher:repeated.fetcher}),/tool-call budget/);
 const badReviewer=provider([tools(['get_event_sequence']),reply(claim()),reply({decision:'approve',issues:['Still unsupported.']})]);
 await assert.rejects(investigateWithAgents(input,{config,fetcher:badReviewer.fetcher}),/invalid decision/);
 const noTools=provider([reply(claim())]);
 await assert.rejects(investigateWithAgents(input,{config,fetcher:noTools.fetcher}),/without gathering/);
 const unknown=provider([tools(['exec'])]);
 await assert.rejects(investigateWithAgents(input,{config,fetcher:unknown.fetcher}),/unavailable tool/);
 await assert.rejects(investigateWithAgents(input,{config:null}),/not configured/);
});
