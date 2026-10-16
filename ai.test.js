import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRequest,configuration,generateDraft,validateDraft,azureCompletion} from './ai.js';

test('AI input cannot ask for events not yet received or an invalid audience',()=>{
 assert.throws(()=>buildRequest(null),/request object/);
 assert.throws(()=>buildRequest({time:168,anchorId:'EV-017'}),/has not arrived/);
 assert.throws(()=>buildRequest({time:169,anchorId:'EV-017',audience:'anything'}),/valid replay/);
 assert.throws(()=>buildRequest({time:Infinity,anchorId:'EV-017'}),/valid replay/);
});

test('Azure transport supports bounded structured output without changing legacy requests',async()=>{
 const config={url:'https://test.openai.azure.com',key:'test',deployment:'test'},requests=[];
 const fetcher=async(url,options)=>{requests.push(JSON.parse(options.body));return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{}'}}]}));};
 const responseFormat={type:'json_schema',json_schema:{name:'test',strict:true,schema:{type:'object',properties:{},required:[],additionalProperties:false}}};
 await azureCompletion([{role:'user',content:'Return JSON.'}],{config,fetcher});
 await azureCompletion([{role:'user',content:'Return JSON.'}],{config,fetcher,responseFormat,maxCompletionTokens:256});
 assert.equal(requests[0].max_completion_tokens,1600);assert.equal(Object.hasOwn(requests[0],'response_format'),false);
 assert.equal(requests[1].max_completion_tokens,256);assert.deepEqual(requests[1].response_format,responseFormat);
 for(const limit of [0,-1,1601,2.5,Infinity])await assert.rejects(azureCompletion([],{config,fetcher,maxCompletionTokens:limit}),/output limit/);
 assert.equal(requests.length,2,'Invalid output limits fail before any provider call.');
});
test('draft validation rejects fabricated, old, and missing references',()=>{
 const {explanation}=buildRequest({time:190,anchorId:'EV-017'});
 for(const evidence of [[],[{id:'EV-017',revision:1}],[{id:'EV-026',revision:1}]])
  assert.throws(()=>validateDraft({claims:[{text:'A claim',evidence}]},explanation));
 assert.throws(()=>validateDraft({claims:[]},explanation));
});
test('Azure adapter sends only observed revisions and returns a cited draft',async()=>{
 const draft=await generateDraft({time:169,anchorId:'EV-017'},{config:{url:'https://example.openai.azure.com/openai/v1/chat/completions',key:'test-key',deployment:'test-model'},fetcher:async(url,options)=>{
  const body=JSON.parse(options.body),evidence=JSON.parse(body.messages[1].content);
  assert.equal(body.model,'test-model');assert.equal(options.headers['api-key'],'test-key');
  assert.ok(evidence.events.every(e=>e.time<=169&&e.arrivedAt<=169));
  assert.equal(evidence.events.find(e=>e.id==='EV-017').player,'A. Reed');
  assert.ok(!JSON.stringify(evidence).includes('Provider corrects'));
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({claims:[{text:'A. Reed scored.',evidence:[{id:'EV-017',revision:1}]}]})}}]}));
 }});
 assert.equal(draft.source,'azure-ai');assert.equal(draft.claims[0].evidence[0].revision,1);
});
test('Azure failures and incomplete or malformed drafts are surfaced',async()=>{
 const input={time:169,anchorId:'EV-017'},config={url:'https://example.openai.azure.com',key:'test',deployment:'test'};
 await assert.rejects(generateDraft(input,{config:null}),/not configured/);
 await assert.rejects(generateDraft(input,{config,fetcher:async()=>new Response('',{status:429})}),error=>error.status===429&&error.code==='azure-rate-limit'&&/HTTP 429/.test(error.message));
 for(const content of ['not JSON',JSON.stringify({claims:[]})])
  await assert.rejects(generateDraft(input,{config,fetcher:async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}))}));
 await assert.rejects(generateDraft(input,{config,fetcher:async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{}'}}]}))}),/complete JSON/);
});
test('server configuration accepts Azure v1 resource URLs and refuses other hosts',()=>{
 assert.equal(configuration({}),null);
 const settings={AZURE_OPENAI_ENDPOINT:'https://stadium.services.ai.azure.com/openai/v1/',AZURE_OPENAI_DEPLOYMENT:'model',AZURE_OPENAI_API_KEY:'key'};
 assert.equal(configuration(settings).url,'https://stadium.services.ai.azure.com/openai/v1/chat/completions');
 assert.equal(configuration({...settings,AZURE_OPENAI_ENDPOINT:'https://stadium.openai.azure.com/'}).url,'https://stadium.openai.azure.com/openai/v1/chat/completions');
 for(const endpoint of ['http://stadium.openai.azure.com','https://evil.example','https://stadium.openai.azure.com/path','https://stadium.openai.azure.com?key=secret'])
  assert.throws(()=>configuration({...settings,AZURE_OPENAI_ENDPOINT:endpoint}));
});

test('an already-cancelled draft never contacts the cloud provider',async()=>{
 const controller=new AbortController();controller.abort();let called=false;
 await assert.rejects(generateDraft({time:169,anchorId:'EV-017'},{config:{url:'https://test.openai.azure.com',key:'test',deployment:'test'},signal:controller.signal,fetcher:async()=>{called=true;}}),error=>error.status===499);
 assert.equal(called,false);
});

test('recap AI input honors corrections and rejects future and stale references',async()=>{
 assert.throws(()=>buildRequest({source:'recap',time:0}),/No match events/);
 const input={source:'recap',time:190,audience:'player',favoritePlayer:'J. Cole'};
 const {explanation}=buildRequest(input);
 assert.equal(explanation.anchorId,'recap');
 assert.equal(explanation.sequence.find(e=>e.id==='EV-017').player,'J. Cole');
 for(const ref of [{id:'EV-017',revision:1},{id:'EV-024',revision:1}])
  assert.throws(()=>validateDraft({claims:[{text:'Unsupported recap.',evidence:[ref]}]},explanation));
 const draft=await generateDraft(input,{config:{url:'https://test.openai.azure.com',key:'test',deployment:'test'},fetcher:async(url,options)=>{
  const payload=JSON.parse(JSON.parse(options.body).messages[1].content);
  assert.equal(payload.source,'recap');assert.equal(payload.audience,'player');assert.match(payload.task,/recap/);
  assert.ok(payload.events.every(e=>e.time<=190&&e.arrivedAt<=190));
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({claims:[{text:'J. Cole scored for Northbridge.',evidence:[{id:'EV-017',revision:2}]}]})}}]}));
 }});
 assert.equal(draft.evidenceSource,'recap');assert.equal(draft.key,explanation.key);
});

test('Azure deadline covers both fetching headers and reading a stalled response body',async()=>{
 const config={url:'https://test.openai.azure.com',key:'test',deployment:'test'};
 for(const hangAt of ['headers','body']){
  let calls=0,requestSignal;
  await assert.rejects(azureCompletion([],{config,timeoutMs:10,fetcher:async(_url,options)=>{
   calls++;requestSignal=options.signal;
   return hangAt==='headers'?new Promise(()=>{}):{ok:true,json:()=>new Promise(()=>{})};
  }}),error=>error.status===504&&error.code==='azure-timeout'&&/No automatic retry/.test(error.message));
  assert.equal(calls,1);assert.equal(requestSignal.aborted,true);
 }
});

test('late successful response bodies cannot escape caller cancellation',async()=>{
 const config={url:'https://test.openai.azure.com',key:'test',deployment:'test'},controller=new AbortController();
 await assert.rejects(azureCompletion([],{config,signal:controller.signal,fetcher:async()=>({ok:true,json:async()=>{
  controller.abort();return {choices:[{finish_reason:'stop',message:{content:'{}'}}]};
 }})}),error=>error.status===499&&error.code==='cancelled');
});

test('workflow deadline, network interruption and malformed response have distinct safe diagnostics',async()=>{
 const config={url:'https://test.openai.azure.com',key:'test',deployment:'test'};
 const controller=new AbortController();controller.abort(new DOMException('deadline','TimeoutError'));let calls=0;
 await assert.rejects(azureCompletion([],{config,signal:controller.signal,fetcher:()=>{calls++;}}),error=>error.status===504&&error.code==='workflow-timeout');
 assert.equal(calls,0);
 await assert.rejects(azureCompletion([],{config,fetcher:async()=>{throw new Error('sensitive upstream detail');}}),error=>
  error.status===502&&error.code==='azure-network'&&!error.message.includes('sensitive'));
 await assert.rejects(azureCompletion([],{config,fetcher:async()=>new Response('not json')}),error=>error.code==='azure-invalid-response');
 await assert.rejects(azureCompletion([],{config,fetcher:async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{}'}}]}))}),error=>
  error.code==='azure-incomplete-response'&&/token limit/.test(error.message));
});

test('invalid transport deadlines fail before any provider request',async()=>{
 const config={url:'https://test.openai.azure.com',key:'test',deployment:'test'};let calls=0;
 for(const timeoutMs of [0,-1,1.5,30001,Infinity])await assert.rejects(azureCompletion([],{config,timeoutMs,fetcher:()=>{calls++;}}),/request deadline/);
 assert.equal(calls,0);
});
