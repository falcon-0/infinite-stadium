import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import {createServer} from './server.js';

async function start(t,env={},options={}){
 const server=createServer({env,...options});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 return `http://127.0.0.1:${server.address().port}`;
}

test('repeated unclear initials require no model allowance even when a reviewed answer cannot fit',async t=>{
 const base=await start(t,{MAX_DAILY_MODEL_CALLS:'1'},{fetcher:async()=>{throw new Error('Clarification must not use a model');}});
 const input={kind:'sustained',seed:17,time:0,question:'j',previousQuestion:'j',conversation:[{question:'j',answer:'Could you clarify what you would like to know?',time:0}]};
 for(let i=0;i<2;i++){
  const response=await fetch(base+'/api/agent/question',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.scope,'clarify');assert.equal(result.execution.modelCalls,0);assert.deepEqual(result.moments,[]);
 }
});

test('production packages reconstruct three outputs without inference and protect the route boundary',async t=>{
 let providerCalls=0;
 const base=await start(t,{}, {fetcher:async()=>{providerCalls++;throw new Error('No inference allowed');}});
 const input={kind:'sustained',seed:17,time:96,anchorId:'comparison-sustained-17-shot-96',language:'es'};
 const post=(body,headers={'Content-Type':'application/json'})=>fetch(base+'/api/production/package',{method:'POST',headers,body:typeof body==='string'?body:JSON.stringify(body)});
 const first=await post(input);assert.equal(first.status,200);const original=await first.json();assert.equal(original.outputs.length,3);
 const revised=await (await post({...input,time:98})).json();assert.notEqual(revised.key,original.key);assert.equal(revised.revision,2);
 assert.equal((await post(input,{'Content-Type':'application/json',Origin:'https://untrusted.example'})).status,403);
 assert.equal((await post('{}',{'Content-Type':'text/plain'})).status,415);
 assert.equal((await post('{')).status,400);
 assert.equal((await post({...input,extra:true})).status,400);
 assert.equal((await post(' '.repeat(262145))).status,413);
 for(const path of ['/production-desk-ui.js','/production-desk-state.js'])assert.equal((await fetch(base+path)).status,200);
 assert.equal((await fetch(base+'/production-package.js')).status,404);
 assert.equal(providerCalls,0);
});

test('producer canonical reads survive recommendation eviction without inference and reject malformed requests',async t=>{
 let providerCalls=0;
 const base=await start(t,{}, {fetcher:async()=>{providerCalls++;throw new Error('No provider call permitted.');}});
 const preferences={kind:'extended',seed:17,audience:'newcomer',language:'en',favoriteClub:null,favoritePlayer:null};
 const items=[{reviewId:'review-1',anchorId:'extended-17-1-shot',source:'recorded'}];
 const post=(body,headers={'Content-Type':'application/json'})=>fetch(base+'/api/producer/validate',{method:'POST',headers,body:typeof body==='string'?body:JSON.stringify(body)});
 const early=await post({preferences,time:80,items});assert.equal(early.status,200);
 const first=await early.json();assert.equal(first.failures.length,0);assert.equal(first.stories.length,1);
 const later=await post({preferences,time:362,items});assert.equal(later.status,200);
 const second=await later.json();assert.equal(second.failures.length,0);
 assert.deepEqual(second.stories[0].entry,first.stories[0].entry);
 assert.equal(second.stories[0].decisionKey,first.stories[0].decisionKey);
 assert.ok(second.stories[0].dependencies.some(d=>d.type==='frame'));
 assert.equal((await post({preferences,time:80,items},{'Content-Type':'application/json',Origin:'https://untrusted.example'})).status,403);
 assert.equal((await post('{}',{'Content-Type':'text/plain'})).status,415);
 assert.equal((await post('{')).status,400);
 assert.equal((await post({preferences,time:80,items,extra:true})).status,400);
 assert.equal((await post({preferences,time:80,items:Array.from({length:51},(_,i)=>({...items[0],reviewId:`review-${i}`}))})).status,400);
 assert.equal((await post(' '.repeat(262145))).status,413);
 assert.equal((await fetch(base+'/producer-validation.js')).status,404,'Server reconstruction stays private');
 assert.equal(providerCalls,0);
});
test('API integrates the extended fixture and localization without exposing private modules',async t=>{
 const base=await start(t);
 const response=await fetch(base+'/api/match?kind=extended&seed=101&time=360&language=fr');
 assert.equal(response.status,200);const body=await response.json();assert.deepEqual(body.recap.score,{home:2,away:1});assert.equal(body.recap.preferences.language,'fr');
 for(const path of ['/server.js','/.env','/evaluation.js'])assert.equal((await fetch(base+path)).status,404);
 assert.equal((await fetch(base+'/api/health')).status,200);
 for(const path of ['/stream-ui.js','/stream-state.js']){
  const asset=await fetch(base+path);assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);
 }
 const bad=await fetch(base+'/api/agent/investigate',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://untrusted.example'},body:'{}'});assert.equal(bad.status,403);
});
test('SSE returns received state, supports a cursor and completes at the horizon',async t=>{
 const base=await start(t);
 const response=await fetch(base+'/api/stream?kind=central&time=11&speed=12',{headers:{'Last-Event-ID':'central:17:12'}});
 assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/event-stream/);
 const text=await response.text();assert.match(text,/id: central:17:12/);assert.match(text,/event: complete/);
 const payload=JSON.parse(text.split('data: ')[1].split('\n')[0]);assert.equal(payload.time,12);
 assert.ok(payload.positions.upserts.every(f=>f.arrivedAt<=12));
 assert.equal((await fetch(base+'/api/stream?speed=99')).status,400);
 assert.equal((await fetch(base+'/api/stream',{headers:{'Last-Event-ID':'other:17:12'}})).status,400);
});
test('paid generation requires a configured access token while public synthetic reads remain available',async t=>{
 const base=await start(t,{APP_ACCESS_TOKEN:'x'.repeat(32)});
 const headers={'Content-Type':'application/json'},input=JSON.stringify({source:'integrated-match',time:8,anchorId:'central-17-shot'});
 assert.equal((await fetch(base+'/api/ai/explain',{method:'POST',headers,body:input})).status,401);
 assert.equal((await fetch(base+'/api/ai/explain',{method:'POST',headers:{...headers,Authorization:'Bearer '+'x'.repeat(32)},body:input})).status,503);
 assert.equal((await fetch(base+'/api/match?time=8')).status,200);
});

test('local AI recap uses whole received segment scope with no invented moment anchor or cloud calls',async t=>{
 const packets=[];
 const base=await start(t,{AI_PROVIDER:'local'},{fetcher:()=>{throw new Error('A local recap must not contact Azure.');},localRunner:async packet=>{
  packets.push(packet);assert.equal(packet.task,'recap');assert.equal(packet.scope.observedAt,362);assert.equal(packet.scope.anchorId,undefined);
  const raw=packet.mode==='fact-selection'?{slots:[1,packet.catalog.facts.find(f=>f.kind==='recap-team-shots'&&f.values.team==='away').slot,...packet.requiredSlots.filter(slot=>slot!==1)]}:{decision:'approve',issues:[],suggestions:[]};
  return {raw,tools:[],modelCalls:1,elapsedMs:1,usageReportedCalls:0};
 }});
 const response=await fetch(base+'/api/agent/recap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'integrated-match',kind:'extended',seed:17,time:362,audience:'analyst',language:'en'})});
 assert.equal(response.status,200);const recap=await response.json();assert.equal(recap.status,'draft');assert.equal(recap.claims.length,3);
 assert.equal(recap.selectedFacts[0].kind,'recap-overview');assert.equal(recap.selectedFacts[0].values.home,2);assert.equal(recap.selectedFacts[0].values.away,1);
 assert.ok(recap.dependencies.some(ref=>ref.id==='extended-17-0-shot'),'Full segment retains its early goal.');
 assert.equal(recap.execution.modelCalls,2);assert.equal(recap.execution.toolCalls,0);assert.equal(packets.length,2);
 assert.equal(recap.anchorId,undefined,'A whole-segment recap has no invented moment anchor.');
 assert.deepEqual(recap.authorship,{selection:'local-model',mandatoryFacts:'application-domain-rules',additionalContext:'local-model',wording:'application-fact-templates'});
});

test('local main story route selects canonical facts through the injected SDK runner',async t=>{
 const modes=[];
 const base=await start(t,{AI_PROVIDER:'local'},{localRunner:async packet=>{
  modes.push(packet.mode);
  const tools=packet.mode==='fact-tool-selector'?['get_event_sequence','score_at_moment']:[];
  const raw=packet.mode==='fact-tool-selector'?{tools}:packet.mode==='fact-selection'?{slots:[packet.catalog.facts.find(f=>f.kind==='moment').slot,packet.catalog.facts.find(f=>f.kind==='goal-score-change').slot]}:{decision:'approve',issues:[]};
  return {raw,tools,modelCalls:1,elapsedMs:1,usageReportedCalls:0};
 }});
 const response=await fetch(base+'/api/agent/story',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'integrated-match',kind:'extended',seed:17,time:180,anchorId:'extended-17-5-shot',audience:'newcomer',language:'fr'})});
 assert.equal(response.status,200);const story=await response.json();assert.equal(story.status,'draft');assert.equal(story.claims.length,2);
 assert.deepEqual(story.authorship,{selection:'local-model',mandatoryFacts:'application-domain-rules',additionalContext:'local-model',wording:'application-fact-templates'});
 assert.equal(story.selectedFacts[1].kind,'goal-score-change');assert.equal(story.claims[1].evidence.length,2);
 assert.deepEqual(modes,['fact-tool-selector','fact-selection','fact-editorial-review']);
});

test('browser AI access uses an expiring HttpOnly session and logout restores the access requirement',async t=>{
 const token='judge-test-access-'.padEnd(32,'x'),base=await start(t,{APP_ACCESS_TOKEN:token});
 const status=()=>fetch(base+'/api/ai/status');
 assert.equal((await (await status()).json()).authRequired,true);
 assert.equal((await fetch(base+'/api/access',{method:'POST',headers:{Authorization:'Bearer wrong'}})).status,401);
 assert.equal((await fetch(base+'/api/access',{method:'POST',headers:{Authorization:`Bearer ${token}`,Origin:'https://untrusted.example'}})).status,403);
 const unlocked=await fetch(base+'/api/access',{method:'POST',headers:{Authorization:`Bearer ${token}`}});
 assert.equal(unlocked.status,200);assert.deepEqual(await unlocked.json(),{authenticated:true});
 const cookie=unlocked.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/Path=\/api/);assert.match(cookie,/SameSite=Strict/);
 assert.ok(!cookie.includes(token));const session=cookie.split(';')[0];
 assert.equal((await (await fetch(base+'/api/ai/status',{headers:{Cookie:session}})).json()).authRequired,false);
 const generation=await fetch(base+'/api/agent/story',{method:'POST',headers:{'Content-Type':'application/json',Cookie:session},body:JSON.stringify({kind:'central',seed:17,time:8,anchorId:'central-17-shot'})});
 assert.equal(generation.status,503,'Authorized session reaches unconfigured-provider handling without a model call.');
 const locked=await fetch(base+'/api/access',{method:'DELETE',headers:{Cookie:session}});assert.equal(locked.status,200);assert.match(locked.headers.get('set-cookie'),/Max-Age=0/);
 assert.equal((await (await fetch(base+'/api/ai/status',{headers:{Cookie:session}})).json()).authRequired,true);
});

test('disconnect cancels Azure transport for drafts and agents and releases the generation lock', {timeout:5000},async t=>{
 for(const route of ['/api/ai/explain','/api/agent/investigate','/api/agent/story','/api/agent/recap']){
  let started,cancelled,calls=0;
  const ready=new Promise(resolve=>started=resolve),stopped=new Promise(resolve=>cancelled=resolve);
  const server=createServer({env:{AZURE_OPENAI_ENDPOINT:'https://test.openai.azure.com',AZURE_OPENAI_DEPLOYMENT:'test',AZURE_OPENAI_API_KEY:'test'},fetcher:async(url,options)=>{
   calls++;
   if(calls===1){started();return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{cancelled();reject(options.signal.reason);},{once:true}));}
   return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({claims:[{text:'A. Reed scored.',evidence:[{id:'central-17-shot',revision:1}]}]})}}]}));
  }});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'integrated-match',kind:'central',seed:17,time:8,anchorId:'central-17-shot'})};
  const pending=http.request(base+route,{method:options.method,headers:options.headers});
  pending.on('error',()=>{});pending.end(options.body);
  await ready;pending.destroy();await stopped;
  const retry=await fetch(base+'/api/ai/explain',options);assert.equal(retry.status,200);assert.equal(calls,2);
 }
});
