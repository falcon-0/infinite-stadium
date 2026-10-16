import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {createServer} from './server.js';
import {serverSettings} from './server-settings.js';

const token='public-release-test-token'.padEnd(32,'x');
const publicSettings={HOST:'0.0.0.0',APP_ACCESS_TOKEN:token,PUBLIC_ORIGIN:'https://demo.invalid'};
const azure={AZURE_OPENAI_ENDPOINT:'https://mock.openai.azure.com',AZURE_OPENAI_DEPLOYMENT:'test',AZURE_OPENAI_API_KEY:'mock-only'};

test('public binding cannot start with an unusable browser origin configuration',()=>{
 assert.throws(()=>serverSettings({HOST:'0.0.0.0',APP_ACCESS_TOKEN:token}),/requires an HTTPS PUBLIC_ORIGIN/);
 for(const PUBLIC_ORIGIN of ['http://demo.invalid','https://demo.invalid/path','https://demo.invalid?x=1','https://name:pass@demo.invalid'])
  assert.throws(()=>serverSettings({...publicSettings,PUBLIC_ORIGIN}),/HTTPS origin/);
 assert.ok(serverSettings(publicSettings).origins.includes('https://demo.invalid'));
 assert.equal(serverSettings({}).publicHost,false,'Local development remains usable without deployment settings.');
});

test('public configured Azure cannot silently fall back to a restartable in-memory budget',()=>{
 let providerCalls=0;const fetcher=()=>{providerCalls++;throw new Error('No cloud calls allowed.');};
 assert.throws(()=>createServer({env:{...publicSettings,...azure},fetcher}),/requires MODEL_BUDGET_FILE/);
 const filename=`.runtime/release-check-${randomUUID()}.json`;
 const server=createServer({env:{...publicSettings,...azure,MODEL_BUDGET_FILE:filename,MAX_DAILY_MODEL_CALLS:'12'},fetcher});
 assert.ok(server);assert.equal(existsSync(filename),false,'Startup does not create or reset a budget ledger.');
 assert.equal(providerCalls,0);
 assert.ok(createServer({env:publicSettings,fetcher}),'A recorded-only public demo needs no model budget.');
 assert.ok(createServer({env:azure,fetcher}),'Local configuration retains its explicit development behavior.');
});

test('malformed absolute request targets receive 400 without terminating the server',async t=>{
 let providerCalls=0;
 const server=createServer({env:{},fetcher:()=>{providerCalls++;throw new Error('No cloud calls allowed.');}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const port=server.address().port;
 for(const target of ['http://[','http://%']){
  const response=await new Promise((resolve,reject)=>{
   const socket=net.connect(port,'127.0.0.1');let wire='';
   socket.setTimeout(2000,()=>{socket.destroy();reject(new Error('Malformed request did not receive a bounded response.'));});
   socket.on('connect',()=>socket.write(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`));
   socket.on('data',chunk=>{wire+=chunk.toString('utf8');});socket.on('error',reject);socket.on('end',()=>resolve(wire));
  });
  assert.match(response,/^HTTP\/1\.1 400 /);assert.match(response,/Invalid request URL/);
 }
 const healthy=await fetch(`http://127.0.0.1:${port}/api/health`);
 assert.equal(healthy.status,200);assert.equal((await healthy.json()).healthy,true);assert.equal(providerCalls,0);
});
