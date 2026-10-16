import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer} from './server.js';
const playwright=await import(process.env.PLAYWRIGHT_MODULE||'playwright').catch(()=>null);
if(process.env.REQUIRE_BROWSER_TESTS==='1'&&!playwright)throw new Error('Browser tests required but Playwright is unavailable.');

test('watch keeps the pitch beside its action on desktop and above the composer on phones',{skip:!playwright},async()=>{
 const server=createServer({env:{}});server.listen(0,'127.0.0.1');await once(server,'listening');
 let browser;
 try{
  browser=await playwright.chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>route.request().method()==='POST'?route.abort():route.continue());
  const url=`http://127.0.0.1:${server.address().port}/?view=watch&match=northbridge-harbour`;
  const capture=async name=>{
   if(!process.env.WATCH_LAYOUT_SCREENSHOT_DIR)return;
   await mkdir(process.env.WATCH_LAYOUT_SCREENSHOT_DIR,{recursive:true});
   await page.screenshot({path:join(process.env.WATCH_LAYOUT_SCREENSHOT_DIR,`${name}.png`)});
  };
  for(const width of [320,390]){
   await page.setViewportSize({width,height:844});
   await page.goto(url);
   await page.locator('.watch-mini-score button').waitFor();
   const initial=await page.evaluate(()=>{
    const box=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
    return {scrollY,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,composer:box('.match-chat-input'),stage:box('.watch-stage'),stats:box('.watch-stats'),pitch:box('#unified-pitch'),synthetic:box('.audience-heading .pill')};
   });
   assert.equal(initial.scrollY,0,'initial composition must work before focusing or scrolling');
   assert.equal(initial.overflow,false,`${width}px phone has no horizontal overflow`);
   assert.ok(initial.composer.top>=initial.pitch.bottom&&initial.composer.bottom<=initial.height,'the full composer is visible below the pitch on arrival');
   assert.ok(initial.synthetic.height>0&&initial.synthetic.bottom<initial.stage.top,'the synthetic-match label remains visible above play');
   assert.ok(initial.stats.height>0&&initial.stats.bottom<=initial.pitch.top,'statistics stay above the field');
   assert.equal(await page.locator('#unified-speed').isVisible(),false,'playback speed does not return to the fan controls');
   await capture(`initial-${width}x844`);
  }
  await page.getByRole('button',{name:'Resume match playback',exact:true}).click();
  await page.waitForFunction(()=>Number(document.querySelector('#unified-time').value)>=3);
  await page.locator('#match-question').click();
  const dimensions=await page.evaluate(()=>{
   const pitch=document.querySelector('#unified-pitch').getBoundingClientRect();
   const input=document.querySelector('#match-question').getBoundingClientRect();
   return {pitchTop:pitch.top,pitchBottom:pitch.bottom,inputTop:input.top,inputBottom:input.bottom,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  assert.equal(dimensions.overflow,false);
  assert.ok(dimensions.pitchTop>=0&&dimensions.pitchBottom<dimensions.inputTop,'pitch remains above the question box');
  assert.ok(dimensions.inputBottom<=dimensions.height,'question box stays visible');
  await page.getByRole('button',{name:'Pause match playback',exact:true}).click();
  await page.getByRole('button',{name:'Resume match playback',exact:true}).waitFor();
  assert.equal(await page.locator('#unified-play').textContent(),'Resume match');
  const timeline=page.getByRole('slider',{name:'Match timeline',exact:true});
  assert.equal(await timeline.getAttribute('aria-valuetext'),`${await page.locator('#unified-clock').textContent()} of 02:00 · 2× replay`);
  assert.deepEqual(await page.locator('.replay-time').allTextContents(),[await page.locator('#unified-clock').textContent(),'02:00 · 2×']);
  for(const height of [768,900]){
   await page.setViewportSize({width:1366,height});
   await page.evaluate(()=>scrollTo(0,0));
   assert.equal(await page.locator('.watch-mini-score').isVisible(),false);
   assert.equal(await page.locator('#unified-play').isVisible(),true);
   assert.equal(await page.locator('.match-score-strip').isVisible(),true);
   const desktop=await page.evaluate(()=>{
    const score=document.querySelector('.match-score-strip').getBoundingClientRect();
    const pitch=document.querySelector('#unified-pitch').getBoundingClientRect();
    const svg=document.querySelector('#unified-pitch'),matrix=svg.getScreenCTM();
    const fieldStart=new DOMPoint(0,0).matrixTransform(matrix),fieldEnd=new DOMPoint(1050,680).matrixTransform(matrix);
    const view=svg.viewBox.baseVal,viewStart=new DOMPoint(view.x,view.y).matrixTransform(matrix),viewEnd=new DOMPoint(view.x+view.width,view.y+view.height).matrixTransform(matrix);
    const title=document.querySelector('.watch-story-banner .fan-moment-card__title').getBoundingClientRect();
    return {scoreHeight:score.height,pitchTop:pitch.top,pitchBottom:pitch.bottom,pitchWidth:pitch.width,fieldWidth:fieldEnd.x-fieldStart.x,viewContained:viewStart.x>=pitch.left-1&&viewStart.y>=pitch.top-1&&viewEnd.x<=pitch.right+1&&viewEnd.y<=pitch.bottom+1,titleTop:title.top,titleBottom:title.bottom,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};
   });
   assert.equal(desktop.overflow,false);
   assert.ok(desktop.scoreHeight<=100,'compact score leaves space for the match');
   assert.ok(desktop.pitchTop>=0&&desktop.pitchBottom<=desktop.titleTop,'the full pitch remains above the action headline');
   assert.ok(desktop.viewContained,'the complete SVG viewBox is visible without cropping');
   assert.ok(desktop.fieldWidth>=desktop.pitchWidth*.74,'the rendered field, not only its green container, uses most of the desktop width');
   assert.ok(desktop.titleBottom<=desktop.height,'the current action is visible without scrolling on desktop');
   await capture(`action-1366x${height}`);
  }
  await page.setViewportSize({width:320,height:844});
  await page.locator('#match-question').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'larger secondary labels do not overflow a narrow phone');
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
