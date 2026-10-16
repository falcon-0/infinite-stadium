import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
import {mkdirSync,existsSync,readFileSync,writeFileSync,unlinkSync,symlinkSync} from 'node:fs';
import {createServer} from './server.js';

const projectRoot=dirname(fileURLToPath(import.meta.url)),runtimeRoot=resolve(projectRoot,'.runtime');
const token='persistent-budget-test-token'.padEnd(32,'x');
const headers={'Content-Type':'application/json',Authorization:`Bearer ${token}`};
const input={source:'integrated-match',kind:'extended',seed:17,time:362,audience:'newcomer',language:'en'};
const environment=(file,limit=2)=>({APP_ACCESS_TOKEN:token,AZURE_OPENAI_ENDPOINT:'https://mock.openai.azure.com',
 AZURE_OPENAI_DEPLOYMENT:'test',AZURE_OPENAI_API_KEY:'mock-only',MAX_DAILY_MODEL_CALLS:String(limit),
 ...(file?{MODEL_BUDGET_FILE:file}:{})});
function ownedFile(t,suffix='json'){
 mkdirSync(runtimeRoot,{recursive:true});
 const file=join(runtimeRoot,`budget-test-${randomUUID()}.${suffix}`);
 t.after(()=>{
  // Only exact files owned by this test; never remove directories or neighboring ledgers.
  for(const candidate of [file,file+'.lock']){
   assert.equal(dirname(resolve(candidate)),runtimeRoot);
   try{unlinkSync(candidate);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
 });
 return file;
}
function mockTransport(file){
 let calls=0;
 return {count:()=>calls,fetcher:async(_url,options)=>{
  calls++;
  if(file)assert.equal(JSON.parse(readFileSync(file,'utf8')).calls,calls,'reservation persisted before provider work');
  const request=JSON.parse(options.body),packet=JSON.parse(request.messages.at(-1).content);
  let raw;
  if(calls%2){
   const contexts=Object.keys(request.response_format.json_schema.schema.properties).filter(key=>key!=='overviewFactId');
   raw={overviewFactId:packet.catalog.facts[0].id,...Object.fromEntries(contexts.map(key=>[key,null]))};
   if(packet.requiredFactIds.length)raw[contexts.at(-1)]=packet.requiredFactIds[0];
  }else raw={decision:'approve',issues:[],suggestions:[]};
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}],
   usage:{prompt_tokens:10,completion_tokens:5}}));
 }};
}
async function start(t,file,limit=2,mock=mockTransport(),envOverrides={}){
 const server=createServer({env:{...environment(file,limit),...envOverrides},fetcher:mock.fetcher});
 server.listen(0,'127.0.0.1');await once(server,'listening');let closed=false;
 const close=async()=>{if(closed)return;closed=true;await new Promise(done=>{server.closeAllConnections();server.close(done);});};
 t.after(close);
 return {base:`http://127.0.0.1:${server.address().port}`,close,mock};
}
const status=async base=>(await (await fetch(`${base}/api/ai/status`,{headers})).json()).modelBudget;
const recap=base=>fetch(`${base}/api/agent/recap`,{method:'POST',headers,body:JSON.stringify(input)});

test('persistent reservations survive actual server restart and prevent any further provider call',async t=>{
 const file=ownedFile(t),mock=mockTransport(file),first=await start(t,file,2,mock);
 assert.equal(existsSync(file),false,'server creation writes nothing');
 const empty=await status(first.base);assert.equal(empty.calls,0);assert.equal(empty.limit,2);
 assert.equal(existsSync(file),false,'status writes nothing');assert.equal(existsSync(file+'.lock'),false);
 const response=await recap(first.base);assert.equal(response.status,200);
 assert.equal((await response.json()).status,'draft');assert.equal(mock.count(),2);
 const ledger=JSON.parse(readFileSync(file,'utf8'));assert.deepEqual(ledger,{version:1,day:empty.day,calls:2});
 assert.equal(existsSync(file+'.lock'),false);await first.close();
 const second=await start(t,file,2,mock);
 assert.deepEqual(await status(second.base),{day:empty.day,calls:2,limit:2});
 const denied=await recap(second.base);assert.equal(denied.status,429);
 assert.deepEqual(await denied.json(),{error:'Daily model-call limit reached.'});
 assert.equal(mock.count(),2);assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),ledger);
});

test('changing the configured limit preserves an existing ledger count rather than resetting it',async t=>{
 const file=ownedFile(t),mock=mockTransport(file),first=await start(t,file,4,mock);
 const response=await recap(first.base);
 assert.equal(response.status,200,JSON.stringify({response:await response.json(),providerCalls:mock.count(),lockRemains:existsSync(file+'.lock')}));await first.close();
 const previous=readFileSync(file,'utf8'),second=await start(t,file,1,mock);
 const snapshot=await status(second.base);assert.equal(snapshot.calls,2);assert.equal(snapshot.limit,1);
 assert.equal((await recap(second.base)).status,429);assert.equal(mock.count(),2);
 assert.equal(readFileSync(file,'utf8'),previous);
});

test('default in-memory budgets remain isolated between servers with no ledger option',async t=>{
 const first=await start(t,null,2),second=await start(t,null,2);
 assert.equal((await recap(first.base)).status,200);assert.equal(first.mock.count(),2);
 assert.equal((await status(first.base)).calls,2);assert.equal((await status(second.base)).calls,0);
 assert.equal((await recap(second.base)).status,200);assert.equal(second.mock.count(),2);
});

test('server rejects ledger paths outside or nested below its direct runtime directory',t=>{
 const file=ownedFile(t);
 for(const filename of [resolve(projectRoot,'budget-test-outside.json'),join(runtimeRoot,'nested',`budget-test-${randomUUID()}.json`),
  runtimeRoot,resolve(runtimeRoot,'..','budget-test-traversal.json')]){
  assert.throws(()=>createServer({env:environment(filename),fetcher:()=>{throw new Error('must not call');}}));
 }
 assert.equal(existsSync(file),false);
});

test('server rejects a symlink ledger without altering its target',t=>{
 const file=ownedFile(t),target=ownedFile(t);
 const contents=JSON.stringify({version:1,day:new Date().toISOString().slice(0,10),calls:1});writeFileSync(target,contents);
 try{symlinkSync(target,file,'file');}catch(error){
  if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('Platform does not permit creating file symlinks.');return;}throw error;
 }
 assert.throws(()=>createServer({env:environment(file)}));
 assert.equal(readFileSync(target,'utf8'),contents);
});

test('Azure status distinguishes healthy configuration from an exhausted persistent counter',async t=>{
 const file=ownedFile(t),mock=mockTransport(file),{base}=await start(t,file,2,mock);
 const healthy=await (await fetch(`${base}/api/ai/status`,{headers})).json();
 assert.equal(healthy.configured,true);assert.equal(healthy.available,true);assert.equal(healthy.connected,false);
 assert.equal(healthy.authRequired,false);assert.equal(healthy.accessConfigured,true);
 assert.equal(healthy.modelBudget.calls,0);assert.equal(existsSync(file),false);assert.equal(mock.count(),0);
 assert.equal((await recap(base)).status,200);assert.equal(mock.count(),2);
 for(const authenticated of [false,true]){
  const response=await fetch(`${base}/api/ai/status`,authenticated?{headers}:{});assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.provider,'azure');assert.equal(data.configured,true);
  assert.equal(data.available,false);assert.equal(data.connected,false);assert.equal(data.authRequired,!authenticated);
  assert.equal(data.accessConfigured,true);assert.equal(data.modelBudget.calls,2);assert.equal(data.modelBudget.limit,2);
  assert.equal(data.error,'Daily model-call limit reached. Recorded insights remain available.');
 }
 assert.equal((await fetch(`${base}/api/match?kind=extended&seed=17&time=362`)).status,200);
 assert.equal(mock.count(),2,'status and recorded intelligence do not call the provider');
});

test('corrupt counter status preserves configuration and authorization without leaking storage details',async t=>{
 const file=ownedFile(t),corrupt='private-storage-diagnostic-not-json';writeFileSync(file,corrupt);
 const {base,mock}=await start(t,file);
 for(const authenticated of [false,true]){
  const response=await fetch(`${base}/api/ai/status`,authenticated?{headers}:{});assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.configured,true);assert.equal(data.available,false);
  assert.equal(data.authRequired,!authenticated);assert.equal(data.accessConfigured,true);assert.equal(data.connected,false);
  assert.equal(data.error,'AI request counter is unavailable. Recorded insights remain available.');
  assert.equal(Object.hasOwn(data,'modelBudget'),false);
  const wire=JSON.stringify(data);assert.equal(wire.includes(file),false);assert.equal(wire.includes(corrupt),false);
  assert.equal(wire.includes('mock-only'),false);assert.equal(wire.includes(token),false);
 }
 assert.equal(readFileSync(file,'utf8'),corrupt);assert.equal(mock.count(),0);
});

test('missing Azure configuration stays unavailable without a misleading counter failure',async t=>{
 const file=ownedFile(t);writeFileSync(file,'corrupt ledger must not masquerade as missing credentials');
 const {base,mock}=await start(t,file,2,mockTransport(),{AZURE_OPENAI_API_KEY:''});
 for(const authenticated of [false,true]){
  const data=await (await fetch(`${base}/api/ai/status`,authenticated?{headers}:{})).json();
  assert.equal(data.configured,false);assert.equal(data.available,false);assert.equal(data.connected,false);
  assert.equal(data.authRequired,!authenticated);assert.equal(data.accessConfigured,true);
  assert.notEqual(data.error,'AI request counter is unavailable. Recorded insights remain available.');
  assert.notEqual(data.error,'Daily model-call limit reached. Recorded insights remain available.');
 }
 assert.equal(mock.count(),0);
});
