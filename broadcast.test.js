import test from 'node:test';
import assert from 'node:assert/strict';
import {broadcastFrame} from './broadcast.js';
import {integratedFeed} from './match-stream.js';
import {serverSettings,authorized,modelBudget} from './server-settings.js';

test('broadcast deltas repair active overlays and expire them without repeating unrelated events',()=>{
 const input={kind:'extended',seed:101,audience:'analyst'},feed=integratedFeed(input.kind,input.seed);
 const original=broadcastFrame({...input,time:29},null,feed);
 assert.equal(original.message.overlays.upserts.length,1);
 const correction=broadcastFrame({...input,time:30},original.bundle,feed);
 assert.equal(correction.message.overlays.upserts.length,1);assert.equal(correction.message.recap.upserts.length,1);
 assert.ok(correction.message.positions.upserts.some(f=>f.time===28&&f.revision===2));
 assert.equal(correction.message.events.upserts.filter(e=>e.type==='shot').length,1);
 const expired=broadcastFrame({...input,time:48},correction.bundle,feed);
 assert.ok(expired.message.overlays.withdrawals.includes('narrative-extended-101-0-shot'));
 assert.equal(expired.message.overlays.upserts.length,0);
});

test('actual received deletion revisions accompany delta and seek-snapshot withdrawals',()=>{
 const input={kind:'extended',seed:17},feed=integratedFeed(input.kind,input.seed);
 const goal=feed.events.find(e=>e.id==='extended-17-0-shot'&&e.revision===2);
 const deletion={...goal,revision:3,arrivedAt:32,operation:'delete',reason:'Synthetic provider withdraws the goal.'};
 const messages={...feed,events:[...feed.events,deletion]};
 const before=broadcastFrame({...input,time:30},null,messages);
 const pending=broadcastFrame({...input,time:31},before.bundle,messages);
 assert.deepEqual(pending.message.events.withdrawalRecords,[]);
 const after=broadcastFrame({...input,time:32},pending.bundle,messages);
 assert.ok(after.message.events.withdrawals.includes(goal.id));
 assert.deepEqual(after.message.events.withdrawalRecords,[deletion]);
 assert.deepEqual(after.message.score,{home:0,away:0});
 const seek=broadcastFrame({...input,time:32},null,messages);
 assert.deepEqual(seek.message.events.withdrawalRecords,[deletion]);assert.ok(seek.message.events.withdrawals.includes(goal.id));
 assert.ok(!seek.message.events.upserts.some(e=>e.id===goal.id));
 assert.deepEqual(broadcastFrame({...input,time:33},after.bundle,messages).message.events.withdrawalRecords,[]);
});
test('public servers require credentials, HTTPS origins and bounded model budgets',()=>{
 assert.throws(()=>serverSettings({HOST:'0.0.0.0'}),/APP_ACCESS_TOKEN/);
 assert.throws(()=>serverSettings({PUBLIC_ORIGIN:'http://public.example'}),/HTTPS/);
 assert.throws(()=>serverSettings({PORT:'wrong'}));
 const token='a'.repeat(32),settings=serverSettings({HOST:'0.0.0.0',PORT:'8080',APP_ACCESS_TOKEN:token,PUBLIC_ORIGIN:'https://demo.example'});
 assert.ok(settings.origins.includes('https://demo.example'));
 assert.equal(authorized(undefined,token),false);assert.equal(authorized('Bearer wrong',token),false);
 assert.equal(authorized(`Bearer ${token}`,token),true);
 let today=new Date('2026-10-05T10:00:00Z');const budget=modelBudget(2,()=>today);
 budget.take();budget.take();assert.throws(()=>budget.take(),/limit reached/);
 today=new Date('2026-10-06T10:00:00Z');budget.take();assert.equal(budget.snapshot().calls,1);
});
