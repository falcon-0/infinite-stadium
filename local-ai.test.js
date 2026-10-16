import test from 'node:test';
import assert from 'node:assert/strict';
import {generateLocalDraft,investigateLocally} from './local-ai.js';
import {createServer} from './server.js';
import {once} from 'node:events';
import {GenerationError} from './ai.js';

const input={source:'integrated-match',kind:'central',seed:101,time:10,anchorId:'central-101-shot',audience:'analyst',language:'fr'};
function reply(packet,decision='approve'){
 const ref=packet.outputs.measure_moment.references.find(ref=>ref.type==='metric');
 return {draft:{claims:[{text:'A bounded factual draft.',evidence:[ref]}]},tools:['measure_moment'],
  review:{decision,issues:decision==='revise'?['Unsupported wording.']:[]},elapsedMs:12,modelCalls:3,repairCount:decision==='revise'?1:0};
}
test('local tools receive only observed evidence and preserve corrected dependencies and language',async()=>{
 let captured;
 const result=await investigateLocally(input,{runner:async packet=>{captured=packet;return reply(packet);}});
 assert.equal(result.provider,'local');assert.equal(result.status,'draft');assert.equal(result.language,'fr');
 assert.equal(captured.scope.observedAt,10);
 assert.ok(captured.outputs.get_position_samples.positions.every(frame=>frame.arrivedAt<=10));
 assert.ok(captured.outputs.get_position_samples.positions.every(frame=>frame.players.length<22));
 assert.match(captured.outputs.get_position_samples.coverage,/partial selection/i);
 assert.equal(captured.outputs.get_event_sequence.events.find(event=>event.id===input.anchorId).revision,2);
 assert.equal(captured.outputs.get_event_sequence.events.find(event=>event.id===input.anchorId).x,85.6/105*100);
 let called=false;
 await assert.rejects(investigateLocally({...input,time:7},{runner:async()=>{called=true;}}),error=>error.status===400);
 assert.equal(called,false);
});
test('local investigation rejects ungathered or stale references and withholds a rejected draft',async()=>{
 await assert.rejects(investigateLocally(input,{runner:async packet=>{
  const result=reply(packet);result.draft.claims[0].evidence=[{id:input.anchorId,revision:1}];return result;
 }}),/unavailable or outdated/);
 await assert.rejects(investigateLocally(input,{runner:async packet=>{
  const result=reply(packet);result.tools=['score_at_moment'];return result;
 }}),/unavailable or outdated/);
 const rejected=await investigateLocally(input,{runner:async packet=>reply(packet,'revise')});
 assert.equal(rejected.status,'withheld');assert.deepEqual(rejected.claims,[]);assert.equal(rejected.execution.repairCount,1);
 await assert.rejects(investigateLocally(input,{runner:async packet=>{
  const result=reply(packet);result.draft.claims[0].text='Explain this recorded moment in one short sentence.';return result;
 }}),/echoed its task/);
 await assert.rejects(investigateLocally(input,{runner:async packet=>{
  const result=reply(packet);result.review.issues=['Approval contradicts this issue.'];return result;
 }}),/contradictory/);
});
test('local model approval cannot release known causal-risk wording',async()=>{
 const result=await investigateLocally({...input,language:'en'},{runner:async packet=>{
  const response=reply(packet);response.draft.claims[0].text='The goal resulted from effective attacking play.';return response;
 }});
 assert.equal(result.status,'withheld');assert.deepEqual(result.claims,[]);
 assert.ok(result.issues.some(issue=>/causal/.test(issue)));
});
test('local single-call adapter uses current received context and validates its citations',async()=>{
 const result=await generateLocalDraft(input,{runner:async packet=>{
  assert.equal(packet.mode,'single');assert.equal(packet.language.code,'fr');
  assert.ok(packet.explanation.positions.every(frame=>frame.arrivedAt<=10));
  assert.ok(packet.explanation.positions.length<=2);
  assert.ok(packet.explanation.positions.every(frame=>frame.players.length<22));
  return {draft:{claims:[{text:'Observed fact.',evidence:[packet.explanation.evidence[0]]}]},elapsedMs:4,modelCalls:1};
 }});
 assert.equal(result.provider,'local');assert.equal(result.execution.modelCalls,1);
});
test('newcomer packet omits spatial payload and reports missing buildup citation coverage',async()=>{
 const result=await generateLocalDraft({source:'integrated-match',kind:'extended',seed:17,time:30,anchorId:'extended-17-0-shot',audience:'newcomer'},{runner:async packet=>{
  assert.deepEqual(packet.explanation.positions,[]);assert.deepEqual(packet.explanation.metrics,[]);
  assert.ok(packet.explanation.sequence.every(e=>!Object.hasOwn(e,'x')&&!Object.hasOwn(e,'endX')));
  assert.ok(packet.explanation.evidence.every(r=>r.type==='event'));
  assert.match(packet.explanation.brief.facts[1].text,/8 seconds/);
  const anchor=packet.explanation.evidence.find(r=>r.id==='extended-17-0-shot');
  return {draft:{claims:[{text:'A. Reed scored.',evidence:[anchor]}]},elapsedMs:4,modelCalls:1};
 }});
 assert.ok(result.coverage.warning);assert.equal(result.coverage.citedBuildupFacts,0);
 assert.match(result.review,/buildup/);
});
test('local server selects the local worker without cloud calls and rejects public binding',async t=>{
 assert.throws(()=>createServer({env:{AI_PROVIDER:'local',HOST:'0.0.0.0',PUBLIC_ORIGIN:'https://demo.invalid',APP_ACCESS_TOKEN:'x'.repeat(32)}}),/loopback/);
 let called=0;
 const server=createServer({env:{AI_PROVIDER:'local'},fetcher:()=>{throw new Error('Cloud calls forbidden.');},
  localStatusReader:async()=>({provider:'local',configured:true,connected:false}),
  localRunner:async packet=>{called++;return reply(packet);}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const base=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await (await fetch(base+'/api/ai/status')).json()).provider,'local');
 const headers={'Content-Type':'application/json'};
 const accepted=await fetch(base+'/api/agent/investigate',{method:'POST',headers,body:JSON.stringify(input)});
 assert.equal(accepted.status,200);assert.equal((await accepted.json()).source,'microsoft-agent-framework-ollama');
 const denied=await fetch(base+'/api/agent/investigate',{method:'POST',headers:{...headers,Origin:'https://untrusted.example'},body:JSON.stringify(input)});
 assert.equal(denied.status,403);assert.equal(called,1);
});
test('local server limits concurrent work and cancels generation after client disconnect',async t=>{
 let markStarted,markCancelled,calls=0;
 const started=new Promise(resolve=>markStarted=resolve),cancelled=new Promise(resolve=>markCancelled=resolve);
 const server=createServer({env:{AI_PROVIDER:'local'},localRunner:async(packet,{signal})=>{
  if(++calls>1)return reply(packet);
  markStarted();
  return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{markCancelled();reject(new GenerationError('Cancelled.',499));},{once:true}));
 }});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const base=`http://127.0.0.1:${server.address().port}`,controller=new AbortController();
 const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)};
 const pending=fetch(base+'/api/agent/investigate',{...options,signal:controller.signal});
 const rejection=assert.rejects(pending,error=>error.name==='AbortError');
 await started;
 assert.equal((await fetch(base+'/api/agent/investigate',options)).status,429);
 controller.abort();await rejection;await cancelled;
 assert.equal((await fetch(base+'/api/agent/investigate',options)).status,200);
 assert.equal(calls,2);
});
