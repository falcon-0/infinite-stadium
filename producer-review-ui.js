import {loadProducerReview,saveProducerReview,updateProducerReview,addValidatedProducerStory,producerValidationRequests,producerPreview,decideProducerStory,moveProducerStory,paceProducerStory,exportProducerRundown,producerExportStatus} from './producer-review.js';
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
const entries=state=>state.recap instanceof Map?[...state.recap.values()]:[];

/** Local preparation. Canonical validation is read-only and never calls a model. */
export function initializeProducerReview({parent,getState,getPreferences,onInspect,getAIStory=()=>null,isRefreshing=()=>false}){
 let storage;try{storage=window.localStorage;}catch{}
 const loaded=loadProducerReview(storage),store=loaded.store;
 const panel=document.createElement('details');panel.className='producer-review';
 panel.innerHTML='<summary>Producer review workbench</summary><p class="disclosure">Prepare a local rundown from recorded or existing AI-selected stories. Review applies to exact evidence and viewing preferences. Nothing is published; evidence checks make no model call.</p><p data-review-notice role="status" aria-live="polite"></p><div data-review-content></div><div class="ai-controls"><button class="secondary" data-review-ai>Add current AI story for review</button><button class="secondary" data-review-preview>Preview approved rundown</button><button class="secondary" data-review-export>Download approved rundown</button></div><div data-review-stage hidden aria-live="polite"></div><div data-review-script hidden><label>Approved review script<textarea readonly rows="8" aria-label="Approved local rundown script"></textarea></label><button class="secondary" data-review-copy>Copy script</button><p class="disclosure">Review pacing only. Downloaded files cannot update themselves after corrections.</p></div>';
 parent.append(panel);
 const content=panel.querySelector('[data-review-content]'),notice=panel.querySelector('[data-review-notice]'),scriptPanel=panel.querySelector('[data-review-script]'),script=scriptPanel.querySelector('textarea'),stage=panel.querySelector('[data-review-stage]');
 notice.textContent=loaded.notice;
 let html='',validation=null,validatedKey=null,pendingKey=null,failedKey=null,controller=null,actionBusy=false,exportSignature=null,preview=null,previewTimer=null;
 const stateSignature=()=>JSON.stringify(store.items.map(i=>[i.id,i.status,i.reason,i.invalidated,i.pacing,i.decision,i.audit]));
 const requestKey=()=>JSON.stringify([getState().matchId,getState().time,getPreferences(),producerValidationRequests(store),[...getState().events.values()], [...getState().positions.values()]]);
 const checkedState=()=>({...getState(),producerValidation:validatedKey===requestKey()?validation:null});
 const ready=()=>!!getState().matchId&&!isRefreshing()&&!actionBusy&&(!store.items.length||validatedKey===requestKey());
 function persist(){if(!saveProducerReview(store,storage))notice.textContent='Review is available for this visit. Browser storage is unavailable or full.';}
 function stopPreview(message=''){preview=null;if(previewTimer)clearInterval(previewTimer);previewTimer=null;stage.hidden=!message;stage.textContent=message;panel.querySelector('[data-review-preview]').textContent='Preview approved rundown';}
 async function fetchValidation(items,signal){
  const response=await fetch('/api/producer/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({preferences:getPreferences(),time:getState().time,items}),signal});
  if(!response.ok)throw new Error('Current producer evidence could not be checked.');return response.json();
 }
 function validate(){
  if(isRefreshing()||!getState().matchId||!store.items.length)return;
  const key=requestKey();if(validatedKey===key||pendingKey===key||failedKey===key)return;
  controller?.abort();controller=new AbortController();pendingKey=key;
  fetchValidation(producerValidationRequests(store),controller.signal).then(result=>{
   if(pendingKey!==key||requestKey()!==key||isRefreshing())return;
   validation=result;validatedKey=key;pendingKey=null;update();
  }).catch(error=>{if(error.name==='AbortError')return;if(pendingKey===key){pendingKey=null;failedKey=key;notice.textContent=error.message;update();}});
 }
 function renderPreview(){
  if(!preview)return;
  if(!ready()){if(!preview.pausedAt)preview.pausedAt=performance.now();stage.hidden=false;stage.textContent='Checking current rundown evidence...';return;}
  if(preview.pausedAt){preview.started+=performance.now()-preview.pausedAt;preview.pausedAt=null;}
  if(producerPreview(store,checkedState(),getPreferences()).fingerprint!==preview.fingerprint){stopPreview('Preview stopped: the rundown or its current evidence changed. Review it before replaying.');return;}
  const elapsed=(performance.now()-preview.started)/1000;
  const segment=preview.segments.find(s=>elapsed>=s.timing.startOffsetSeconds&&elapsed<s.timing.endOffsetSeconds);
  if(!segment){stopPreview('Approved rundown preview complete.');return;}
  stage.hidden=false;stage.textContent=`${Math.floor(elapsed)} / ${preview.durationSeconds}s | ${segment.text}`;
 }
 function update(){
  const state=getState(),preferences=getPreferences();
  if(isRefreshing()){controller?.abort();pendingKey=null;validatedKey=null;validation=null;}
  validate();
  const before=stateSignature();if(state.matchId&&validatedKey===requestKey())updateProducerReview(store,checkedState(),preferences);if(before!==stateSignature())persist();
  if(exportSignature!==null&&(exportSignature!==stateSignature()||!ready())){scriptPanel.hidden=true;script.value='';exportSignature=null;}
  const candidates=entries(state),affected=store.items.filter(i=>['superseded','withdrawn'].includes(i.status)),checking=!ready();
  const next=`<h3>Current story candidates</h3><p class="disclosure">${escape(preferences.audience)} | ${escape(preferences.language)}. ${checking?'Checking current evidence...':'Recorded stories; no AI call needed.'}</p>${candidates.length?candidates.map(e=>`<div class="producer-candidate"><p><b>${stamp(e.time)}</b> ${escape(e.text)}</p><div class="ai-controls"><button class="secondary" data-review-add="${escape(e.anchorId)}">Add to rundown</button><button class="secondary" data-review-inspect="${escape(e.anchorId)}">Inspect evidence</button></div></div>`).join(''):'<p>Play or seek to a received shot to find a story.</p>'}
   <h3>Correction and review inbox</h3>${affected.length?affected.map(i=>{const current=validation?.stories.find(s=>s.reviewId===i.id)||validation?.failures.find(f=>f.reviewId===i.id)?.replacement,files=store.exports.filter(e=>producerExportStatus(e,store).affected.includes(i.id));return `<article><p><b>${escape(i.id)} | ${escape(i.status)}</b>: ${escape(i.reason)}</p>${i.invalidated||current&&current.entry.text!==i.text?`<p>Previously: ${escape(i.text)}</p><p>Current${current?.source==='recorded'&&i.source==='ai'?' recorded replacement':''}: ${escape(current?.entry.text||'Current canonical selection is unavailable; inspect the moment again.')}</p>`:''}${files.length?`<p>Replace exports: ${files.map(e=>escape(e.filename)).join(', ')}</p>`:''}${current?`<button class="secondary" data-review-replace="${escape(i.id)}">${current.source==='recorded'&&i.source==='ai'?'Add recorded replacement for review':'Add current replacement for review'}</button>`:`<button class="secondary" data-review-inspect="${escape(i.anchorId)}">Inspect current moment</button>`}${current&&i.invalidated?`<details data-review-disclosure="comparison:${escape(i.id)}"><summary data-review-comparison="${escape(i.id)}">Compare evidence revisions</summary><p class="disclosure">Previous evidence: ${escape(i.evidence.map(r=>`${r.type}:${r.id}@${r.revision}`).join(', '))}</p><p class="disclosure">Current evidence: ${escape(current.entry.evidence.map(r=>`${r.type}:${r.id}@${r.revision}`).join(', '))}</p></details>`:''}</article>`;}).join(''):'<p>No saved items need renewed evidence review.</p>'}
   <h3>Local rundown</h3><p class="disclosure">${store.items.length}/50 items. ${checking?'Current approvals are being checked.':store.items.filter(i=>i.status==='approved').length+' current approvals.'} Inspect before approving. Model review is not human approval.</p>${store.items.map((i,index)=>`<article class="producer-item"><p><b>${index+1}. ${stamp(i.eventTime)} | ${escape(i.status.toUpperCase())}</b> | ${escape(i.source==='ai'?'AI-selected':'Recorded')} | ${escape(i.preferences.audience)} / ${escape(i.preferences.language)}</p><p>${escape(i.text)}</p><p class="disclosure">${escape(i.reason)}${i.replaces?` Replaces ${escape(i.replaces)}; previous decisions remain in the audit.`:''}</p><div class="ai-controls"><button class="secondary" data-review-up="${escape(i.id)}" ${index===0?'disabled':''}>Move earlier</button><button class="secondary" data-review-down="${escape(i.id)}" ${index===store.items.length-1?'disabled':''}>Move later</button><label>Review seconds <input type="number" min="1" max="30" step="1" value="${i.pacing}" data-review-pacing="${escape(i.id)}" aria-label="Review duration for item ${index+1}"></label></div>${['superseded','withdrawn'].includes(i.status)?'':`<label>Review note (required to reject)<input type="text" maxlength="300" data-review-reason="${escape(i.id)}" aria-label="Review note for item ${index+1}"></label><div class="ai-controls"><button class="secondary" data-review-approve="${escape(i.id)}">Approve reviewed item</button><button class="secondary" data-review-reject="${escape(i.id)}">Reject item</button></div>`}<details><summary>Evidence and local decisions</summary><p class="disclosure">Captured at ${stamp(i.capturedAt)}. Canonical reconstruction checks complete relevant received inventory, exact event and frame bodies and derived facts. Authorship labels describe the supplied application draft, not signed model provenance.</p><pre>${escape(i.evidence.map(r=>`${r.type}: ${r.id} / v${r.revision}`).join('\n'))}</pre>${i.audit.map(a=>`<p>${escape(a.decision)} at ${stamp(a.at)} | ${escape(a.reason||'No additional note')} (review v${a.version})</p>`).join('')||'<p>No human decision yet.</p>'}</details></article>`).join('')||'<p>Add a candidate, inspect it, and record your review.</p>'}
   <details><summary>Local export ledger</summary>${store.exports.map(e=>{const result=producerExportStatus(e,store);return `<p><b>${escape(e.filename)}</b> | ${escape(result.status)}${result.affected.length?` | affected: ${escape(result.affected.join(', '))}`:''}</p>`;}).join('')||'<p>No rundown exported.</p>'}</details>`;
  if(next!==html){
   const focused=content.contains(document.activeElement)?document.activeElement:null,attribute=focused?.getAttributeNames().find(n=>n.startsWith('data-review-')),focusValue=attribute?focused.getAttribute(attribute):null;
   const notes=new Map([...content.querySelectorAll('[data-review-reason]')].map(e=>[e.dataset.reviewReason,e.value]));
   const disclosureKey=e=>e.dataset.reviewDisclosure||e.closest('article')?.querySelector('[data-review-up]')?.dataset.reviewUp||'ledger';
   const opened=[...content.querySelectorAll('details[open]')].map(disclosureKey);
   content.innerHTML=next;html=next;
   for(const input of content.querySelectorAll('[data-review-reason]'))if(notes.has(input.dataset.reviewReason))input.value=notes.get(input.dataset.reviewReason);
   for(const details of content.querySelectorAll('details'))if(opened.includes(disclosureKey(details)))details.open=true;
   if(focused){const target=attribute?[...content.querySelectorAll(`[${attribute}]`)].find(e=>e.getAttribute(attribute)===focusValue):null;(target||panel.querySelector('summary')).focus({preventScroll:true});}
  }
  for(const control of panel.querySelectorAll('button,input')){
   const data=control.dataset;
   if(Object.hasOwn(data,'reviewPreview')&&preview){control.disabled=false;continue;}
   if(data.reviewInspect){control.disabled=isRefreshing();continue;}
   control.disabled=checking||Object.hasOwn(data,'reviewAi')&&!getAIStory()||['reviewExport','reviewPreview'].some(k=>Object.hasOwn(data,k))&&!store.items.some(i=>i.status==='approved')||Boolean(data.reviewUp&&data.reviewUp===store.items[0]?.id)||Boolean(data.reviewDown&&data.reviewDown===store.items.at(-1)?.id);
  }
  renderPreview();
 }
 panel.addEventListener('toggle',()=>{if(panel.open){failedKey=null;update();}});
 panel.addEventListener('change',event=>{const id=event.target.dataset.reviewPacing;if(!id||!ready())return;try{paceProducerStory(store,id,Number(event.target.value));persist();update();}catch(error){notice.textContent=error.message;event.target.value=store.items.find(i=>i.id===id)?.pacing||6;}});
 panel.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button||!panel.contains(button)||button.disabled)return;
  const data=button.dataset;
  try{
   if(data.reviewInspect){onInspect?.(data.reviewInspect);return;}
   if(Object.hasOwn(data,'reviewPreview')&&preview){stopPreview('Preview stopped.');return;}
   if(!ready())throw new Error('Wait for the current evidence check.');
   if(data.reviewAdd||data.reviewReplace||Object.hasOwn(data,'reviewAi')){
    const old=store.items.find(i=>i.id===data.reviewReplace),fallback=old&&validation?.failures.find(f=>f.reviewId===old.id)?.replacement,ai=Object.hasOwn(data,'reviewAi')?getAIStory():null;
    if(Object.hasOwn(data,'reviewAi')&&!ai)throw new Error('Choose a current canonical AI story.');
    const request=ai?{reviewId:'new-story',anchorId:ai.draft.anchorId,source:'ai',draft:ai.draft}:old?(fallback?{reviewId:'new-story',anchorId:old.anchorId,source:'recorded'}:{...producerValidationRequests(store).find(r=>r.reviewId===old.id),reviewId:'new-story'}):{reviewId:'new-story',anchorId:data.reviewAdd,source:'recorded'};
    const key=requestKey();actionBusy=true;update();const result=await fetchValidation([request]);
    if(requestKey()!==key||isRefreshing())throw new Error('Received evidence changed; choose the story again.');
    if(!result.stories.length)throw new Error(result.failures[0]?.reason||'Current canonical story is unavailable.');
    addValidatedProducerStory(store,result.stories[0],result,getState(),getPreferences(),{replaces:old?.id??null});
    validatedKey=null;failedKey=null;notice.textContent='Current story added as pending. Inspect its evidence before approving.';
   }else if(data.reviewApprove||data.reviewReject){const id=data.reviewApprove||data.reviewReject,note=[...content.querySelectorAll('[data-review-reason]')].find(e=>e.dataset.reviewReason===id)?.value||'';decideProducerStory(store,id,data.reviewApprove?'approved':'rejected',note,checkedState(),getPreferences());notice.textContent='Human decision saved for this exact local snapshot.';}
   else if(data.reviewUp)moveProducerStory(store,data.reviewUp,-1);
   else if(data.reviewDown)moveProducerStory(store,data.reviewDown,1);
   else if(Object.hasOwn(data,'reviewPreview')){if(preview){stopPreview('Preview stopped.');return;}const snapshot=producerPreview(store,checkedState(),getPreferences());if(!snapshot.segments.length)throw new Error('Approve a current story first.');stopPreview();preview={...snapshot,started:performance.now()};panel.querySelector('[data-review-preview]').textContent='Stop preview';renderPreview();previewTimer=setInterval(renderPreview,100);}
   else if(Object.hasOwn(data,'reviewExport')){const output=exportProducerRundown(store,checkedState(),getPreferences()),url=URL.createObjectURL(new Blob([JSON.stringify(output.document,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=output.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);script.value=output.script;scriptPanel.hidden=false;exportSignature=stateSignature();notice.textContent='Approved rundown downloaded. Check the ledger after corrections.';}
   else if(Object.hasOwn(data,'reviewCopy')){update();if(scriptPanel.hidden)throw new Error('Export the current approved rundown first.');try{await navigator.clipboard.writeText(script.value);notice.textContent='Review script copied.';}catch{script.focus();script.select();notice.textContent='Script selected. Use your browser copy command.';}return;}
   else return;
   persist();
  }catch(error){notice.textContent=error.message;}
  finally{actionBusy=false;update();}
 });
 update();return {update};
}
