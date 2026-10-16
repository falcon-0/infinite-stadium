// Local human review of received deterministic stories. No model or publishing.
import {supportedFixtureKind} from './fixture-settings.js';
export const producerStorageKey='infinite-stadium.producer-review.v1';
const schema='infinite-stadium.producer-review.v1';
const string=(v,max=200)=>typeof v==='string'&&v.length>0&&v.length<=max;
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const fingerprint=v=>JSON.stringify(canonical(v));
const clone=v=>structuredClone(v);
const values=v=>v instanceof Map?[...v.values()]:Array.isArray(v)?v:[];
const scope=p=>({kind:p.kind,seed:p.seed,language:p.language,audience:p.audience,favoriteClub:p.favoriteClub??null,favoritePlayer:p.favoritePlayer??null});
const validScope=p=>p&&supportedFixtureKind(p.kind)&&Number.isSafeInteger(p.seed)&&p.seed>=0&&p.seed<=100000&&['en','es','fr','pt'].includes(p.language)&&['newcomer','analyst','player','spatial'].includes(p.audience)&&[null,'home','away'].includes(p.favoriteClub)&&(p.favoritePlayer===null||string(p.favoritePlayer,100));
const ref=r=>r&&['event','frame','metric'].includes(r.type)&&string(r.id,700)&&Number.isSafeInteger(r.revision)&&r.revision>0;
const entryShape=e=>({anchorId:e.anchorId,time:e.time,text:e.text,key:e.key,evidence:e.evidence,metrics:e.metrics??[]});
const getEntry=(state,anchorId)=>values(state.recap).find(e=>e.anchorId===anchorId);
const validatedStory=(state,id)=>state.producerValidation?.stories?.find(s=>s.reviewId===id);
const validationCurrent=(state,preferences)=>state.producerValidation?.schema==='infinite-stadium.producer-validation.v1'&&state.producerValidation.time===state.time&&state.producerValidation.matchId===state.matchId&&fingerprint(state.producerValidation.preferences)===fingerprint(scope(preferences));
const validFingerprint=(v,max)=>{try{return string(v,max)&&fingerprint(JSON.parse(v))===v;}catch{return false;}};
const exactFields=(v,fields)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===fields.length&&fields.every(field=>Object.hasOwn(v,field));
const received=(record,time)=>record&&Number.isFinite(record.time)&&record.time>=0&&Number.isFinite(record.arrivedAt)&&record.arrivedAt>=record.time&&record.time<=time&&record.arrivedAt<=time;
function receivedFrames(state,required){
 const records=state.positionHistory instanceof Map?[...values(state.positionHistory),...values(state.positions)]:values(state.positions);
 const frames=new Map(),versions=new Map(),conflicts=new Set();
 for(const frame of records){
  if(required&&!required.has(frame.id)||!received(frame,state.time))continue;
  const version=`${frame.id}@${frame.revision}`,body=fingerprint(frame);
  if(versions.has(version)&&versions.get(version)!==body)conflicts.add(frame.id);
  versions.set(version,body);
  if(!frames.has(frame.id)||frames.get(frame.id).revision<frame.revision)frames.set(frame.id,frame);
 }
 return {frames,conflicts};
}
const rundownItem=i=>({reviewId:i.id,matchId:i.matchId,anchorId:i.anchorId,eventTime:i.eventTime,text:i.text,preferences:i.preferences,evidence:i.evidence,pacing:i.pacing,humanDecision:i.audit.at(-1)});
const rundownFingerprint=items=>fingerprint(items.map(rundownItem));
export function emptyProducerReview(){return {schema,version:0,nextId:1,items:[],exports:[]};}

/** Strict allowlist loading. Stored approvals stay inactive until current evidence is checked. */
export function loadProducerReview(storage){
 try{
  const raw=storage?.getItem(producerStorageKey);if(!raw)return {store:emptyProducerReview(),notice:''};
  if(raw.length>2000000)throw new Error();const input=JSON.parse(raw);
  if(input?.schema!==schema||!Number.isSafeInteger(input.version)||input.version<0||!Number.isSafeInteger(input.nextId)||input.nextId<1||!Array.isArray(input.items)||input.items.length>50||!Array.isArray(input.exports)||input.exports.length>20)throw new Error();
  const ids=new Set();const items=input.items.map(i=>{
   if(!i||!string(i.id,80)||ids.has(i.id)||!string(i.matchId,200)||!string(i.anchorId,700)||!string(i.text,3000)||!string(i.entryKey,30000)||!validScope(i.preferences)||!Number.isFinite(i.capturedAt)||i.capturedAt<0||!Number.isFinite(i.eventTime)||i.eventTime<0||i.eventTime>i.capturedAt||!Number.isInteger(i.pacing)||i.pacing<1||i.pacing>30||!['pending','approved','rejected'].includes(i.decision)||!validFingerprint(i.entryFingerprint,100000)||!Array.isArray(i.dependencies)||!i.dependencies.length||i.dependencies.length>300||!Array.isArray(i.evidence)||!i.evidence.length||i.evidence.length>1000||i.evidence.some(r=>!ref(r))||!Array.isArray(i.audit)||i.audit.length>20)throw new Error();
   const legacy=i.evidenceContract==='legacy-event-bodies'||i.dependencies.every(d=>d&&d.type===undefined);
   ids.add(i.id);const dependencies=i.dependencies.map(d=>{if(!d||!(legacy||['event','frame'].includes(d.type))||!string(d.id,700)||!Number.isSafeInteger(d.revision)||d.revision<1||!validFingerprint(d.fingerprint,10000))throw new Error();const body=JSON.parse(d.fingerprint);if(body.id!==d.id||body.revision!==d.revision||!received(body,i.capturedAt))throw new Error();return {type:legacy?'event':d.type,id:d.id,revision:d.revision,fingerprint:d.fingerprint};});
   if(new Set(dependencies.map(d=>`${d.type}:${d.id}`)).size!==dependencies.length||!dependencies.some(d=>d.type==='event'&&d.id===i.anchorId))throw new Error();
   const sourceRefs=i.evidence.filter(r=>r.type==='event'||!legacy&&r.type==='frame');if(sourceRefs.length!==dependencies.length||sourceRefs.some(r=>!dependencies.some(d=>d.type===r.type&&d.id===r.id&&d.revision===r.revision)))throw new Error();
   const audit=i.audit.map(a=>{if(!a||!['approved','rejected'].includes(a.decision)||!Number.isFinite(a.at)||a.at<0||typeof a.reason!=='string'||a.reason.length>300||!Number.isSafeInteger(a.version)||a.version<0)throw new Error();return {decision:a.decision,at:a.at,reason:a.reason,version:a.version};});
   const captured=JSON.parse(i.entryFingerprint);if(captured.anchorId!==i.anchorId||captured.text!==i.text||captured.key!==i.entryKey||captured.time!==i.eventTime||fingerprint(captured.evidence)!==fingerprint(i.evidence))throw new Error();
   if(i.decision!=='pending'&&audit.at(-1)?.decision!==i.decision)throw new Error();
   let validation={};
   if(i.decisionKey!==undefined){
    if(!/^producer:[a-f0-9]{64}$/.test(i.decisionKey)||!['recorded','ai'].includes(i.source)||!Array.isArray(i.selectedFactIds)||i.selectedFactIds.length>5||i.selectedFactIds.some(v=>!string(v,100))||!Array.isArray(i.sourceTools)||i.sourceTools.length>5||i.sourceTools.some(v=>!['get_event_sequence','score_at_moment','get_match_patterns','measure_moment','get_position_samples'].includes(v))||!i.authorship||i.authorship.wording!=='application-fact-templates'||!(i.source==='ai'?['azure-model','local-model']:['recorded-policy']).includes(i.authorship.selection))throw new Error();
    validation={decisionKey:i.decisionKey,source:i.source,selectedFactIds:[...i.selectedFactIds],sourceTools:[...i.sourceTools],authorship:clone(i.authorship)};
   }
   return {id:i.id,matchId:i.matchId,anchorId:i.anchorId,text:i.text,entryKey:i.entryKey,entryFingerprint:i.entryFingerprint,preferences:scope(i.preferences),capturedAt:i.capturedAt,eventTime:i.eventTime,pacing:i.pacing,decision:i.decision,status:'superseded',reason:'Current received evidence has not been checked.',dependencies,evidenceContract:legacy?'legacy-event-bodies':'event-frame-bodies-v1',evidence:i.evidence.map(r=>({type:r.type,id:r.id,revision:r.revision})),audit,replaces:string(i.replaces,80)?i.replaces:null,invalidated:legacy?'Older review lacks exact frame evidence; add a current replacement for human review.':string(i.invalidated,1000)?i.invalidated:null,...validation};
  });
  const exports=input.exports.map(e=>{
   if(!e||!string(e.id,100)||!string(e.filename,180)||!Number.isSafeInteger(e.version)||e.version<0||!Number.isFinite(e.at)||e.at<0||!Array.isArray(e.itemIds)||!e.itemIds.length||e.itemIds.length>50||new Set(e.itemIds).size!==e.itemIds.length||e.itemIds.some(id=>!ids.has(id)))throw new Error();
   if(e.rundownFingerprint!==undefined&&e.rundownFingerprint!==null){
    if(!validFingerprint(e.rundownFingerprint,500000))throw new Error();const snapshot=JSON.parse(e.rundownFingerprint);
    if(!Array.isArray(snapshot)||snapshot.length!==e.itemIds.length||snapshot.some((s,n)=>!exactFields(s,['reviewId','matchId','anchorId','eventTime','text','preferences','evidence','pacing','humanDecision'])||s.reviewId!==e.itemIds[n]||!string(s.matchId,200)||!string(s.anchorId,700)||!Number.isFinite(s.eventTime)||s.eventTime<0||!string(s.text,3000)||!exactFields(s.preferences,['kind','seed','language','audience','favoriteClub','favoritePlayer'])||!validScope(s.preferences)||!Array.isArray(s.evidence)||!s.evidence.length||s.evidence.length>1000||s.evidence.some(r=>!exactFields(r,['type','id','revision'])||!ref(r))||!Number.isInteger(s.pacing)||s.pacing<1||s.pacing>30||!exactFields(s.humanDecision,['decision','at','reason','version'])||s.humanDecision.decision!=='approved'||!Number.isFinite(s.humanDecision.at)||s.humanDecision.at<0||s.humanDecision.at>e.at||!Number.isSafeInteger(s.humanDecision.version)||s.humanDecision.version<0||s.humanDecision.version>e.version||typeof s.humanDecision.reason!=='string'||s.humanDecision.reason.length>300))throw new Error();
   }
   return {id:e.id,filename:e.filename,version:e.version,at:e.at,itemIds:[...e.itemIds],rundownFingerprint:e.rundownFingerprint??null};
  });
  if(items.some(i=>!/^review-\d+$/.test(i.id)||Number(i.id.slice(7))>=input.nextId))throw new Error();
  return {store:{schema,version:input.version,nextId:input.nextId,items,exports},notice:items.length?'Saved decisions loaded; current received evidence will be checked.':''};
 }catch{return {store:emptyProducerReview(),notice:'Saved producer review could not be read. Started an empty review.'};}
}
export function saveProducerReview(store,storage){try{const raw=JSON.stringify(store);if(raw.length>2000000)throw new Error();storage?.setItem(producerStorageKey,raw);return !!storage;}catch{return false;}}

function currentStatus(item,state,preferences){
 if(!state?.matchId||state.matchId!==item.matchId||fingerprint(scope(preferences))!==fingerprint(item.preferences))return {status:'superseded',reason:'Fixture or viewing preferences changed.'};
 if(!Number.isFinite(state.time)||state.time<item.capturedAt)return {status:'superseded',reason:'Replay is before this review snapshot.'};
 const needsValidation=item.decisionKey||Object.hasOwn(state,'producerValidation');
 if(needsValidation&&!validationCurrent(state,preferences))return {status:'checking',reason:'Checking current canonical story evidence.'};
 const checked=needsValidation&&validationCurrent(state,preferences)?validatedStory(state,item.id):null;
 const active=new Map(values(state.events).map(e=>[e.id,e]));
 const history=values(state.eventHistory).filter(e=>e.time<=state.time&&e.arrivedAt<=state.time);
 const {frames,conflicts}=receivedFrames(state,new Set(item.dependencies.filter(d=>d.type==='frame').map(d=>d.id)));
 if(checked)for(const d of checked.dependencies)if(d.type==='frame'&&!frames.has(d.id))frames.set(d.id,JSON.parse(d.fingerprint));
 for(const dependency of item.dependencies){
  if(dependency.type==='frame'){
   const frame=frames.get(dependency.id);
   if(!frame)return {status:'superseded',reason:`Received frame ${dependency.id} is unavailable.`};
   if(conflicts.has(dependency.id)||frame.revision!==dependency.revision||fingerprint(frame)!==dependency.fingerprint)return {status:'superseded',reason:`Received frame ${dependency.id} changed.`,invalidated:`Received frame ${dependency.id} changed.`};
   continue;
  }
  const current=active.get(dependency.id),latest=history.filter(e=>e.id===dependency.id).sort((a,b)=>b.revision-a.revision)[0];
  if(latest?.operation==='delete'&&(!current||latest.revision>=current.revision))return {status:'withdrawn',reason:`Received event ${dependency.id} was withdrawn.`,invalidated:`Received event ${dependency.id} was withdrawn.`};
  if(!received(current,state.time))return {status:'superseded',reason:`Received event ${dependency.id} is unavailable.`};
  if(current.revision!==dependency.revision||fingerprint(current)!==dependency.fingerprint)return {status:'superseded',reason:`Received event ${dependency.id} changed.`,invalidated:`Received event ${dependency.id} changed.`};
 }
 if(needsValidation&&!checked){const failed=validationCurrent(state,preferences),reason=failed?state.producerValidation.failures?.find(f=>f.reviewId===item.id)?.reason||'Current story is unavailable.':'Checking current canonical story evidence.';return {status:'superseded',reason,...(failed?{invalidated:reason}:{})};}
 if(checked&&item.decisionKey&&checked.decisionKey!==item.decisionKey)return {status:'superseded',reason:'The story context or received inventory changed.',invalidated:'The story context or received inventory changed.'};
 const entry=checked?.entry??getEntry(state,item.anchorId);
 if(!entry)return {status:'superseded',reason:'This story is outside the current candidate set; inspect it again before review.'};
 if(fingerprint(entryShape(entry))!==item.entryFingerprint)return {status:'superseded',reason:'The current story or its scene evidence changed.',invalidated:'The current story or its scene evidence changed.'};
 if(item.invalidated)return {status:'superseded',reason:`Renew review: ${item.invalidated}`};
 return {status:item.decision,reason:item.decision==='approved'?'Human approved this exact local review snapshot.':item.decision==='rejected'?'Rejected by the local reviewer.':'Human review needed.'};
}
export function updateProducerReview(store,state,preferences){for(const item of store.items)Object.assign(item,currentStatus(item,state,preferences));return store;}
export function addProducerStory(store,entry,state,preferences,{replaces=null}={}){
 if(store.items.length>=50)throw new RangeError('The local rundown holds at most 50 items.');
 if(!validScope(scope(preferences))||!string(state?.matchId,200)||!entry||!string(entry.anchorId,700)||!string(entry.text,3000)||!string(entry.key,30000)||!Number.isFinite(entry.time)||entry.time<0||!Number.isFinite(state.time)||state.time<entry.time||!Array.isArray(entry.evidence)||entry.evidence.length>1000||entry.evidence.some(r=>!ref(r))||fingerprint(entryShape(getEntry(state,entry.anchorId)||{}))!==fingerprint(entryShape(entry)))throw new RangeError('Choose a current received story.');
 const active=new Map(values(state.events).map(e=>[e.id,e])),{frames,conflicts}=receivedFrames(state,new Set(entry.evidence.filter(r=>r.type==='frame').map(r=>r.id)));
 const dependencies=entry.evidence.filter(r=>['event','frame'].includes(r.type)).map(r=>{const e=(r.type==='event'?active:frames).get(r.id);if(!received(e,state.time)||e.revision!==r.revision||e.operation==='delete'||r.type==='frame'&&conflicts.has(r.id))throw new RangeError('Story evidence is unavailable.');return {type:r.type,id:r.id,revision:r.revision,fingerprint:fingerprint(e)};});
 if(!dependencies.length||dependencies.length>300||new Set(dependencies.map(d=>`${d.type}:${d.id}`)).size!==dependencies.length||!dependencies.some(d=>d.type==='event'&&d.id===entry.anchorId))throw new RangeError('Story needs complete received event and frame references.');
 const body=fingerprint(entryShape(entry));if(body.length>100000||dependencies.some(d=>d.fingerprint.length>10000))throw new RangeError('Story evidence exceeds the local review limit.');
 if(store.items.some(i=>i.matchId===state.matchId&&i.entryFingerprint===body&&fingerprint(i.preferences)===fingerprint(scope(preferences))&&i.decision!=='rejected'&&!i.invalidated))throw new RangeError('This exact story is already in the rundown.');
 if(replaces&&!store.items.some(i=>i.id===replaces))throw new RangeError('Replacement item is unavailable.');
 const item={id:`review-${store.nextId++}`,matchId:state.matchId,anchorId:entry.anchorId,text:entry.text,entryKey:entry.key,entryFingerprint:body,preferences:scope(preferences),capturedAt:state.time,eventTime:entry.time,pacing:6,decision:'pending',status:'pending',reason:'Human review needed.',dependencies,evidenceContract:'event-frame-bodies-v1',evidence:clone(entry.evidence),audit:[],replaces,invalidated:null};
 store.items.push(item);store.version++;return item;
}
/** Initial items are accepted only from the current read-only server response. */
export function addValidatedProducerStory(store,story,validation,state,preferences,{replaces=null}={}){
 const checkedState={...state,producerValidation:validation};
 if(!validationCurrent(checkedState,preferences)||!validation.stories.includes(story)||!/^producer:[a-f0-9]{64}$/.test(story.decisionKey))throw new RangeError('Check the current canonical story before adding it.');
 const positions=new Map(values(state.positions).map(f=>[f.id,f]));
 for(const d of story.dependencies)if(d.type==='frame')positions.set(d.id,JSON.parse(d.fingerprint));
 const item=addProducerStory(store,story.entry,{...state,positions,recap:new Map([[story.entry.anchorId,story.entry]])},preferences,{replaces});
 Object.assign(item,{decisionKey:story.decisionKey,source:story.source,selectedFactIds:clone(story.selectedFactIds),sourceTools:clone(story.sourceTools),authorship:clone(story.authorship)});
 return item;
}
export function producerValidationRequests(store){return store.items.map(i=>({reviewId:i.id,anchorId:i.anchorId,source:i.source||'recorded',...(i.source==='ai'?{selectedFactIds:i.selectedFactIds,sourceTools:i.sourceTools,authorship:i.authorship}:{})}));}
export function producerPreview(store,state,preferences){
 updateProducerReview(store,state,preferences);const items=store.items.filter(i=>i.status==='approved');
 let duration=0;return {fingerprint:rundownFingerprint(items),segments:items.map(i=>{const start=duration;duration+=i.pacing;return {...rundownItem(i),timing:{startOffsetSeconds:start,durationSeconds:i.pacing,endOffsetSeconds:duration}};}),durationSeconds:duration};
}
export function decideProducerStory(store,id,decision,reason,state,preferences){
 updateProducerReview(store,state,preferences);const item=store.items.find(i=>i.id===id);
 if(!item||!['approved','rejected'].includes(decision)||['superseded','withdrawn','checking'].includes(item.status))throw new RangeError('Review a current story before deciding.');
 if(typeof reason!=='string'||reason.length>300||decision==='rejected'&&!reason.trim())throw new RangeError('Give a rejection reason of up to 300 characters.');
 item.decision=decision;store.version++;item.audit.push({decision,at:state.time,reason:reason.trim(),version:store.version});item.audit=item.audit.slice(-20);updateProducerReview(store,state,preferences);return item;
}
export function moveProducerStory(store,id,direction){const at=store.items.findIndex(i=>i.id===id),next=at+direction;if(![-1,1].includes(direction)||at<0||next<0||next>=store.items.length)return;[store.items[at],store.items[next]]=[store.items[next],store.items[at]];store.version++;}
export function paceProducerStory(store,id,seconds){const item=store.items.find(i=>i.id===id);if(!item||!Number.isInteger(seconds)||seconds<1||seconds>30)throw new RangeError('Review pacing must be 1–30 seconds.');item.pacing=seconds;store.version++;}
export function producerExportStatus(record,store){
 if(record.itemIds.some(id=>store.items.find(i=>i.id===id)?.status==='checking')&&!record.itemIds.some(id=>['superseded','withdrawn','rejected'].includes(store.items.find(i=>i.id===id)?.status)))return {affected:[],status:'checking-evidence',reason:'Waiting for the current canonical evidence check.'};
 const current=store.items.filter(i=>i.status==='approved'),currentFingerprint=rundownFingerprint(current);
 const affected=new Set(record.itemIds.filter(id=>store.items.find(i=>i.id===id)?.status!=='approved'));
 if(!record.rundownFingerprint)return {affected:[...new Set([...affected,...record.itemIds])],status:'needs-replacement',reason:'Older export lacks an exact rundown snapshot.'};
 if(record.rundownFingerprint!==currentFingerprint){
  const previous=JSON.parse(record.rundownFingerprint),now=current.map(rundownItem),before=new Map(previous.map(i=>[i.reviewId,i]));
  for(const item of now)if(fingerprint(before.get(item.reviewId))!==fingerprint(item))affected.add(item.reviewId);
  for(const id of record.itemIds)if(!now.some(i=>i.reviewId===id))affected.add(id);
  // Reordering retained items changes their relative pacing even when their own text is unchanged.
  const sharedOld=previous.filter(i=>now.some(n=>n.reviewId===i.reviewId)),sharedNew=now.filter(i=>before.has(i.reviewId));
  sharedNew.forEach((i,n)=>{if(sharedOld[n]?.reviewId!==i.reviewId){affected.add(i.reviewId);if(sharedOld[n])affected.add(sharedOld[n].reviewId);}});
  return {affected:[...affected],status:'needs-replacement',reason:'The approved selection, order, content, pacing or human decision changed.'};
 }
 return {affected:[...affected],status:affected.size?'needs-replacement':'current'};
}
export function exportProducerRundown(store,state,preferences){
 updateProducerReview(store,state,preferences);const items=store.items.filter(i=>i.status==='approved');if(!items.length)throw new RangeError('Approve at least one current story before export.');
 const exportFingerprint=rundownFingerprint(items);if(exportFingerprint.length>500000)throw new RangeError('The approved rundown exceeds the local export snapshot limit.');
 let duration=0;const segments=items.map(i=>{const start=duration;duration+=i.pacing;return {reviewId:i.id,anchorId:i.anchorId,eventTime:i.eventTime,text:i.text,preferences:clone(i.preferences),evidence:clone(i.evidence),dependencies:clone(i.dependencies),...(i.decisionKey?{decisionKey:i.decisionKey,source:i.source,authorship:clone(i.authorship),selectedFactIds:clone(i.selectedFactIds)}:{}),humanDecision:clone(i.audit.at(-1)),timing:{startOffsetSeconds:start,durationSeconds:i.pacing,endOffsetSeconds:duration}};});
 store.version++;
 const filename=`producer-rundown-v${store.version}.json`,id=`export-${store.version}`;
 const document={schema:'infinite-stadium.producer-rundown.v1',synthetic:true,publishing:false,status:'human-reviewed-local-preparation',matchId:state.matchId,observedAt:state.time,version:store.version,segments,timing:{unit:'seconds',durationSeconds:duration,pacing:'human-selected-review-pacing',livePublishing:false},limitation:'Local human-reviewed preparation from received synthetic template stories. This is not a live broadcast approval, signed provenance or proof of real-world truth. Downloaded files cannot update themselves; check the local export ledger after corrections.'};
 store.exports.push({id,filename,version:store.version,at:state.time,itemIds:items.map(i=>i.id),rundownFingerprint:exportFingerprint});store.exports=store.exports.slice(-20);
 return {filename,document,script:segments.map((s,index)=>`${index+1}. [${s.timing.startOffsetSeconds}–${s.timing.endOffsetSeconds}s] ${s.text}`).join('\n\n')};
}
