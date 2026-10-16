import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Optional browser integration: provide PLAYWRIGHT_MODULE and, for an installed
// browser, PLAYWRIGHT_CHANNEL. All requests are fulfilled locally in this test.
const playwright=await import(process.env.PLAYWRIGHT_MODULE||'playwright').catch(()=>null);
if(process.env.REQUIRE_BROWSER_TESTS==='1'&&!playwright)throw new Error('Browser tests required but Playwright is unavailable.');
test('chat completion, scrolling and seeking preserve a usable conversation',{skip:!playwright},async()=>{
 const browser=await playwright.chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
 try{
  const page=await browser.newPage();let hold=false,release=null,fail=false;const requests=[];
  await page.route('http://chat-component.test/**',async route=>{
   const pathname=new URL(route.request().url()).pathname;
   if(pathname==='/api/agent/question'){
    const request=route.request().postDataJSON();requests.push(request);if(fail)return route.fulfill({status:502,json:{code:'question-withheld'}});if(hold)await new Promise(resolve=>release=resolve);
    return route.fulfill({json:{matchId:'demo',question:request.question,answer:'Une longue réponse. '.repeat(100),observedAt:30,language:'fr',moments:[{anchorId:'shot',revision:1,time:25,label:'Tir'}],evidence:[{type:'event',id:'shot',revision:1}]}});
   }
   if(['/match-chat-ui.js','/match-chat-state.js'].includes(pathname))return route.fulfill({contentType:'text/javascript; charset=utf-8',body:await readFile(new URL('.'+pathname,import.meta.url),'utf8')});
   return route.fulfill({contentType:'text/html; charset=utf-8',body:'<html lang="en"><style>[hidden]{display:none!important}[data-chat-answer]{height:160px;overflow:auto}body{min-height:1500px}</style><main></main></html>'});
  });
  await page.goto('http://chat-component.test/');
  await page.evaluate(async()=>{
   const {initializeMatchChat}=await import('/match-chat-ui.js');
   window.context={kind:'sustained',seed:17,matchId:'demo',language:'fr',time:30,configured:true,provider:'azure',eventRecords:[{id:'shot',revision:1,time:25,arrivedAt:25}]};window.inspected=[];
   window.chat=initializeMatchChat({parent:document.querySelector('main'),getContext:()=>context,onInspect:id=>inspected.push(id)});chat.update();
  });
  assert.equal(await page.locator('[data-chat-hint]').isHidden(),true);
  assert.equal(await page.locator('[data-chat-welcome]').isVisible(),true);
  assert.equal(await page.locator('[data-chat-status]').getAttribute('aria-live'),'polite');
  assert.match(await page.locator('[data-chat-status]').getAttribute('class'),/sr-only/);
  const ask=async question=>{await page.locator('#match-question').fill(question);await page.locator('button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('[data-chat-status]').textContent.startsWith('Answer ready'));};
  await ask('Pourquoi?');
  assert.equal(await page.locator('[data-chat-status]').textContent(),'Answer ready.');
  assert.match(await page.locator('[data-chat-status]').getAttribute('class'),/sr-only/);
  assert.match(await page.locator('.match-chat-turn').first().locator('.disclosure').first().innerText(),/Match at 00:30/);
  assert.equal(await page.locator('.match-chat-response').getAttribute('lang'),'fr');
  assert.equal(await page.locator('[data-chat-answer]').getAttribute('role'),'region');
  assert.deepEqual(await page.evaluate(()=>inspected),[]);
  assert.equal(await page.evaluate(()=>{const el=document.querySelector('[data-chat-answer]');return el.scrollHeight-el.scrollTop-el.clientHeight<2}),true);
  await page.locator('[data-chat-answer]').evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll'));});
  const before=await page.evaluate(()=>scrollY);await ask('Et ensuite?');
  assert.equal(await page.locator('[data-chat-new-answer]').isVisible(),true);
  assert.equal(await page.locator('[data-chat-answer]').evaluate(el=>el.scrollTop),0);
  assert.equal(await page.evaluate(()=>scrollY),before);
  await page.locator('[data-chat-new-answer]').click();
  assert.equal(await page.locator('[data-chat-new-answer]').isVisible(),false);
  assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('[data-chat-answer]')),true);
  await page.locator('[data-chat-moment]').last().click();assert.deepEqual(await page.evaluate(()=>inspected),['shot']);
  await page.evaluate(()=>{context={...context,anchorId:'shot'};});
  await ask('About that earlier shot');
  assert.match(await page.locator('.match-chat-turn').last().innerText(),/About 00:25 · evidence through 00:30/);
  hold=true;await page.locator('#match-question').fill('Question en attente');await page.locator('button[type=submit]').click();
  for(let attempt=0;!release&&attempt<100;attempt++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(release);
  assert.match(await page.locator('[data-chat-status]').getAttribute('class'),/sr-only/);
  assert.equal(await page.locator('[data-chat-status]').textContent(),'Checking the match…');
  assert.equal(await page.locator('[data-turn-state=pending] .match-chat-response').innerText(),'Checking the match…');
  await page.evaluate(()=>{context={...context,matchId:null};chat.update();});assert.equal(await page.locator('.match-chat-turn').count(),4);
  release();await new Promise(resolve=>setTimeout(resolve,50));assert.equal(await page.locator('.match-chat-turn').count(),4);
  await page.evaluate(()=>{context={...context,matchId:'demo'};chat.update();});await page.waitForFunction(()=>document.querySelectorAll('[data-turn-state=answered]').length===4);
  hold=false;
  await page.locator('#match-question').fill('Draft stays on language change');
  await page.evaluate(()=>{context={...context,language:'es'};chat.update();});
  assert.equal(await page.locator('.match-chat-turn').count(),4);
  assert.equal(await page.locator('#match-question').inputValue(),'Draft stays on language change');
  assert.equal(await page.locator('.match-chat-response').first().getAttribute('lang'),'fr');
  fail=true;await page.locator('#match-question').fill('Why did he miss?');await page.locator('button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('[data-turn-state=failed]'));
  assert.match(await page.locator('[data-turn-state=failed]').innerText(),/Why did he miss\?/);
  assert.match(await page.locator('[data-turn-state=failed]').innerText(),/About 00:25/);
  fail=false;await ask('Who scored?');
  assert.equal(requests.at(-1).conversation.some(turn=>turn.question==='Why did he miss?'),false);
  assert.equal(requests.at(-1).language,'es');
  assert.equal(await page.locator('[data-turn-state=failed]').count(),1);
  await page.locator('#match-question').fill('Old fixture draft');
  await page.evaluate(()=>{context={...context,matchId:null};chat.update();});
  assert.equal(await page.locator('#match-question').inputValue(),'Old fixture draft');
  await page.evaluate(()=>{context={...context,matchId:'another',seed:18};chat.update();});
  assert.equal(await page.locator('#match-question').inputValue(),'');
  assert.equal(await page.locator('.match-chat-turn').count(),0);
 }finally{await browser.close();}
});

test('explicit transient retry keeps its original moment and leaves a newer draft alone',{skip:!playwright},async()=>{
 const browser=await playwright.chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
 try{
  const page=await browser.newPage(),requests=[];let failNext=false,holdNext=false,release;
  await page.route('http://chat-retry.test/**',async route=>{
   const pathname=new URL(route.request().url()).pathname;
   if(pathname==='/api/agent/question'){
    const request=route.request().postDataJSON();requests.push(request);
    if(failNext){failNext=false;return route.fulfill({status:429,json:{code:'azure-rate-limit'}});}
    if(request.question==='Unsupported cause')return route.fulfill({status:502,json:{code:'question-withheld'}});
    if(holdNext){holdNext=false;await new Promise(resolve=>release=resolve);}
    return route.fulfill({json:{matchId:'demo',question:request.question,answer:'A supported answer.',observedAt:request.time,language:request.language,evidence:[],moments:[]}});
   }
   if(['/match-chat-ui.js','/match-chat-state.js'].includes(pathname))return route.fulfill({contentType:'text/javascript; charset=utf-8',body:await readFile(new URL('.'+pathname,import.meta.url),'utf8')});
   return route.fulfill({contentType:'text/html; charset=utf-8',body:'<html lang="en"><style>[hidden]{display:none!important}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}</style><main></main></html>'});
  });
  await page.goto('http://chat-retry.test/');
  await page.evaluate(async()=>{
   const {initializeMatchChat}=await import('/match-chat-ui.js');
   window.context={kind:'sustained',seed:17,matchId:'demo',language:'en',time:30,configured:true,provider:'azure',playing:true,eventRecords:[]};
   window.chat=initializeMatchChat({parent:document.querySelector('main'),getContext:()=>context});chat.update();
  });
  const submit=async question=>{await page.locator('#match-question').fill(question);await page.locator('button[type=submit]').click();};
  await submit('Who scored?');await page.waitForFunction(()=>document.querySelectorAll('[data-turn-state=answered]').length===1);
  await page.evaluate(()=>{context.time=35;chat.update();});
  failNext=true;await submit('Who supplied that pass?');await page.locator('[data-chat-retry]').waitFor();
  const original=requests.at(-1);assert.equal(original.time,35);assert.equal(original.conversation.length,1);
  await page.evaluate(()=>{context.time=50;chat.update();});
  await submit('What is the score now?');await page.waitForFunction(()=>document.querySelectorAll('[data-turn-state=answered]').length===2);
  assert.equal(requests.at(-1).conversation.some(turn=>turn.question==='Who supplied that pass?'),false);
  await page.locator('#match-question').fill('A newer draft I am still writing');
  await page.evaluate(()=>{context.time=80;context.language='fr';chat.update();});
  assert.equal(requests.length,3,'playback and language changes do not retry automatically');
  holdNext=true;await page.locator('[data-chat-retry]').click();
  for(let attempt=0;!release&&attempt<100;attempt++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(release);
  assert.deepEqual(requests.at(-1),original,'retry keeps question, time, language and original conversation');
  assert.equal(await page.locator('#match-question').inputValue(),'A newer draft I am still writing');
  assert.equal(await page.locator('button[type=submit]').isDisabled(),true);
  await page.evaluate(()=>{context.time=85;chat.update();});
  assert.equal(await page.evaluate(()=>context.playing),true);
  release();await page.waitForFunction(()=>document.querySelectorAll('[data-turn-state=answered]').length===3);
  assert.equal(await page.locator('.match-chat-turn').count(),3,'retry replaces its failed turn');
  assert.match(await page.locator('.match-chat-turn').nth(1).innerText(),/Match at 00:35/);
  assert.equal(await page.locator('.match-chat-turn').nth(1).locator('.match-chat-response').getAttribute('lang'),'en');
  assert.equal(await page.locator('#match-question').inputValue(),'A newer draft I am still writing');
  assert.equal(await page.locator('[data-chat-retry]').count(),0);
  await submit('Unsupported cause');await page.locator('[data-turn-state=failed]').waitFor();
  assert.equal(await page.locator('[data-chat-retry]').count(),0,'semantic withholding offers no blind retry');
  failNext=true;await submit('Another moment?');await page.locator('[data-chat-retry]').waitFor();
  await page.evaluate(()=>{context.configured=false;chat.update();});
  assert.equal(await page.locator('[data-chat-retry]').isDisabled(),true);
  assert.equal(await page.locator('[data-chat-hint]').isVisible(),true,'availability guidance remains visible');
  await page.evaluate(()=>{context={...context,configured:true,seed:18,matchId:'another'};chat.update();});
  assert.equal(await page.locator('[data-chat-retry]').count(),0);
  assert.equal(await page.locator('.match-chat-turn').count(),0);
 }finally{await browser.close();}
});
