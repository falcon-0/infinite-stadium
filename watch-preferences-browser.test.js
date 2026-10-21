import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from './server.js';
import {matchState} from './match-stream.js';
import {VIEWER_PREFERENCES_KEY} from './viewer-preferences.js';
const playwright=await import(process.env.PLAYWRIGHT_MODULE||'playwright').catch(()=>null);
if(process.env.REQUIRE_BROWSER_TESTS==='1'&&!playwright)throw new Error('Browser tests required but Playwright is unavailable.');

test('asking a question keeps the actual Watch clock advancing while its answer stays pinned',{skip:!playwright},async()=>{
 const server=createServer({env:{}});server.listen(0,'127.0.0.1');await once(server,'listening');
 let browser,release,submitted;
 try{
  browser=await playwright.chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  const page=await browser.newPage({viewport:{width:1366,height:900}});
  await page.route('**/api/ai/status',route=>route.fulfill({json:{provider:'azure',configured:true,available:true,questionAvailable:true,authRequired:false}}));
  await page.route('**/api/agent/question',async route=>{
   submitted=route.request().postDataJSON();await new Promise(resolve=>release=resolve);
   const {kind,seed,time}=submitted,match=matchState({kind,seed,time});
   return route.fulfill({json:{schema:'infinite-stadium.match-question.v1',matchId:match.metadata.id,question:submitted.question,answer:'This is a local interaction test response.',observedAt:time,language:'en',claims:[],moments:[],evidence:[]}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/?view=watch&match=northbridge-harbour`);
  await page.locator('#unified-play').click();
  const seconds=()=>{const parts=document.querySelector('#unified-clock').textContent.match(/(\d+):(\d+)/);return parts?Number(parts[1])*60+Number(parts[2]):0;};
  await page.waitForFunction(seconds=>{const parts=document.querySelector('#unified-clock').textContent.match(/(\d+):(\d+)/);return parts&&Number(parts[1])*60+Number(parts[2])>=seconds;},3);
  await page.locator('#match-question').fill('What is happening now?');await page.locator('.match-chat button[type=submit]').click();
  await page.locator('[data-turn-state=pending]').waitFor();
  for(let n=0;!submitted&&n<100;n++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(submitted);
  const pinned=submitted.time,before=await page.evaluate(seconds);
  await page.waitForFunction(previous=>{const parts=document.querySelector('#unified-clock').textContent.match(/(\d+):(\d+)/);return parts&&Number(parts[1])*60+Number(parts[2])>=previous+3;},before);
  assert.equal(submitted.time,pinned);assert.equal(await page.locator('[data-turn-state=pending]').count(),1);
  release();await page.locator('[data-turn-state=answered]').waitFor();
  const stamp=`${String(Math.floor(pinned/60)).padStart(2,'0')}:${String(Math.floor(pinned%60)).padStart(2,'0')}`;
  assert.match(await page.locator('[data-turn-state=answered]').innerText(),new RegExp(stamp));
 }finally{release?.();await browser?.close();await new Promise(resolve=>server.close(resolve));}
});

test('Watch viewing options follow inactive roster players, persist applied choices and discard staged changes',{skip:!playwright},async()=>{
 const server=createServer({env:{}});server.listen(0,'127.0.0.1');await once(server,'listening');
 let browser;
 try{
  browser=await playwright.chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  const page=await browser.newPage({viewport:{width:1366,height:900}}),errors=[],apiPosts=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>{if(route.request().method()==='POST'){apiPosts.push(route.request().url());return route.abort();}return route.continue();});
  const path='/?view=watch&match=northbridge-harbour',url=`http://127.0.0.1:${server.address().port}${path}`;
  await page.goto(url);
  const drawer=page.locator('details.viewer-preferences'),summary=drawer.locator(':scope > summary'),spotlight=page.locator('.player-spotlight');
  await summary.waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelectorAll('#unified-player option[value]:not([value=""])').length===22);
  assert.equal(await summary.textContent(),'Viewing options');assert.equal(await page.getByText('Viewing options',{exact:true}).count(),1);
  assert.equal(await drawer.evaluate(element=>element.open),false);assert.equal(await page.locator('#unified-player').isVisible(),false);
  assert.equal(await page.locator('#unified-speed').isVisible(),false);

  const state=matchState({kind:'sustained',seed:17,time:0}),roster=state.frames[0].players;
  const inactive=roster.find(player=>player.name==='R. Hughes');assert.ok(inactive);assert.equal(state.events.some(event=>event.playerId===inactive.id),false);
  const names=await page.locator('#unified-player option').evaluateAll(options=>options.filter(option=>option.value).map(option=>option.value));
  assert.deepEqual([...names].sort(),roster.map(player=>player.name).sort());assert.equal(names.length,22);
  await summary.click();await page.getByRole('combobox',{name:'Match view',exact:true}).selectOption('player');
  await page.getByRole('combobox',{name:'Player',exact:true}).selectOption(inactive.name);
  assert.equal(await spotlight.isVisible(),false,'Staging a player view does not apply it');
  await page.getByRole('button',{name:'Apply view',exact:true}).click();
  await page.waitForFunction(name=>document.querySelector('.player-follow-heading strong')?.textContent===name&&document.querySelectorAll('.player-follow-stats dd').length===3,inactive.name);
  assert.equal(await drawer.evaluate(element=>element.open),false);assert.equal(await spotlight.isVisible(),true);
  assert.match(await spotlight.textContent(),/No on-ball action yet/);assert.doesNotMatch(await spotlight.textContent(),/unavailable|Waiting for|unknown/i);
  assert.deepEqual(await spotlight.locator('.player-follow-stats dd').allTextContents(),['0','0','0']);
  const readSaved=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),VIEWER_PREFERENCES_KEY);
  const saved=await readSaved();assert.deepEqual(saved,{version:1,preferences:{audience:'player',language:'en',favoriteClub:null,favoritePlayer:inactive.name}});

  // Remove URL preference hints so reload must restore the persisted profile.
  await page.evaluate(path=>history.replaceState(null,'',path),path);await page.reload();
  await page.waitForFunction(name=>document.querySelector('.player-follow-heading strong')?.textContent===name&&document.querySelectorAll('.player-follow-stats dd').length===3,inactive.name);
  assert.equal(await drawer.evaluate(element=>element.open),false);assert.equal(await summary.isVisible(),true);
  assert.equal(await page.locator('#unified-audience').inputValue(),'player');assert.equal(await page.locator('#unified-player').inputValue(),inactive.name);
  assert.deepEqual(await spotlight.locator('.player-follow-stats dd').allTextContents(),['0','0','0']);assert.deepEqual(await readSaved(),saved);

  await summary.click();
  await page.getByRole('combobox',{name:'Language',exact:true}).selectOption('es');
  await page.getByRole('combobox',{name:'Player',exact:true}).selectOption(roster.find(player=>player.id!==inactive.id).name);
  await page.getByRole('combobox',{name:'Favorite club',exact:true}).selectOption('away');
  await page.getByRole('combobox',{name:'Match view',exact:true}).selectOption('analyst');
  await summary.click(); // Closing the drawer cancels unapplied changes.
  await page.waitForFunction(name=>document.querySelector('#unified-player').value===name&&document.querySelector('#unified-audience').value==='player',inactive.name);
  assert.equal(await page.locator('#unified-language').inputValue(),'en');assert.equal(await page.locator('#unified-club').inputValue(),'');
  assert.deepEqual(await readSaved(),saved);assert.equal(await spotlight.locator('.player-follow-heading strong').textContent(),inactive.name);
  for(const [language,shotLabel] of [['es','Tiros'],['fr','Tirs'],['pt','Remates'],['en','Shots']]){
   await summary.click();
   assert.equal(await page.getByRole('combobox',{name:'Language',exact:true}).getAttribute('aria-describedby'),'unified-language-help');
   assert.equal(await page.locator('#unified-language-help').isVisible(),true);
   await page.getByRole('combobox',{name:'Language',exact:true}).selectOption(language);
   await page.getByRole('button',{name:'Apply view',exact:true}).click();
   await page.waitForFunction(language=>document.querySelector('.watch-stats').lang===language,language);
   assert.equal(await page.locator('.watch-stats tbody th').first().textContent(),shotLabel);
   assert.equal((await readSaved()).preferences.language,language);
   assert.equal(await page.locator('#unified-time').inputValue(),'0','Changing language keeps the viewed moment');
  }
  await summary.click();assert.equal(await page.locator('#unified-player').inputValue(),inactive.name);await summary.click();
  assert.equal(await page.locator('#unified-speed').isVisible(),false);assert.equal(await drawer.evaluate(element=>element.open),false);
  // Applying presentation preferences must not pause or rewind an active replay.
  assert.equal(await page.locator('#unified-speed').inputValue(),'2');
  const playbackStarted=Date.now();
  await page.locator('#unified-play').click();
  await page.waitForFunction(()=>Number(document.querySelector('#unified-time').value)>=2);
  const beforeApply=Number(await page.locator('#unified-time').inputValue());
  await summary.click();await page.getByRole('combobox',{name:'Favorite club',exact:true}).selectOption('home');
  await page.getByRole('button',{name:'Apply view',exact:true}).click();
  await page.getByRole('button',{name:'Pause match',exact:true}).waitFor();
  assert.ok(Number(await page.locator('#unified-time').inputValue())>=beforeApply,'Applying a view must not rewind the clock');
  await page.waitForFunction(time=>Number(document.querySelector('#unified-time').value)>=time+2,beforeApply);
  assert.equal(await page.getByRole('button',{name:'Pause match',exact:true}).isVisible(),true);
  assert.equal(await drawer.evaluate(element=>element.open),false);
  assert.equal((await readSaved()).preferences.favoriteClub,'home');
  await page.waitForFunction(()=>Number(document.querySelector('#unified-time').value)>=12);
  assert.ok(Date.now()-playbackStarted<10000,'2x replay reaches twelve match seconds faster than normal playback');
  await page.getByRole('button',{name:'Pause match',exact:true}).click();
  const mobileBounds=[];
  for(const width of [390,320]){
   await page.setViewportSize({width,height:844});await page.goto(url);
   await page.waitForFunction(()=>document.querySelectorAll('#unified-player option[value]:not([value=""])').length===22);
   await summary.click();await page.getByRole('combobox',{name:'Match view',exact:true}).selectOption('newcomer');await page.getByRole('button',{name:'Apply view',exact:true}).click();
   await page.getByRole('button',{name:'Resume match playback',exact:true}).click();
   await page.waitForFunction(()=>Number(document.querySelector('#unified-time').value)>=4);
   await page.getByRole('button',{name:'Pause match playback',exact:true}).click();
   await page.getByRole('button',{name:'Resume match playback',exact:true}).waitFor();
   await summary.click();await page.getByRole('combobox',{name:'Match view',exact:true}).selectOption('player');
   await page.getByRole('combobox',{name:'Player',exact:true}).selectOption(inactive.name);await page.getByRole('button',{name:'Apply view',exact:true}).click();
   await page.waitForFunction(name=>document.querySelector('.player-follow-heading strong')?.textContent===name&&document.querySelectorAll('.player-follow-stats dd').length===3,inactive.name);
   const bounds=await page.evaluate(()=>{const composer=document.querySelector('.match-chat-input').getBoundingClientRect();return {top:composer.top,bottom:composer.bottom,height:composer.height,viewportHeight:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};});
   mobileBounds.push({width,...bounds});
   assert.equal(bounds.overflow,false,`${width}px view has no horizontal overflow`);assert.equal(await drawer.evaluate(element=>element.open),false);
   assert.deepEqual(await spotlight.locator('.player-follow-stats dd').allTextContents(),['0','0','0']);assert.equal(await page.locator('#unified-speed').isVisible(),false);
  }
  for(const bounds of mobileBounds)assert.ok(bounds.height>0&&bounds.top>=0&&bounds.bottom<=bounds.viewportHeight,`The full composer must remain visible after playback and applying player follow at both mobile widths; ${JSON.stringify(mobileBounds)}`);
  assert.deepEqual(apiPosts,[],'Viewing options must not invoke any AI or other API POST');assert.deepEqual(errors,[]);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
