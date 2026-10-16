// Browser-side materialization of the received SSE deltas. Reset on seek or
// preference changes; a reconnect can safely replay the latest snapshot.
export function emptyStream(){
 return {matchId:null,time:0,events:new Map(),eventHistory:new Map(),positions:new Map(),positionHistory:new Map(),overlays:new Map(),recap:new Map(),summary:'No match events have arrived.',score:{home:0,away:0}};
}
export function applyStream(previous,message){
 if(message.schemaVersion!==1)throw new Error('Unsupported stream version.');
 if(previous.matchId&&previous.matchId!==message.matchId)throw new Error('Reset before switching matches.');
 if(previous.matchId&&message.time<previous.time)throw new Error('Reset before rewinding the stream.');
 const state={...previous,matchId:message.matchId,time:message.time,score:message.score,stats:message.stats,summary:message.summary,limitation:message.limitation};
 state.eventHistory=new Map(previous.eventHistory||[]);
 state.positionHistory=new Map(previous.positionHistory||[]);
 const validReceived=record=>{
  if(!record||typeof record.id!=='string'||!record.id||!Number.isInteger(record.revision)||record.revision<1||!Number.isFinite(record.time)||record.time<0||!Number.isFinite(record.arrivedAt)||record.arrivedAt<record.time)throw new Error('Invalid received evidence record.');
  if(record.time>message.time||record.arrivedAt>message.time)throw new Error('Stream contains evidence that has not arrived.');
 };
 const latestHistoryRevision=id=>Math.max(0,...[...state.eventHistory.values()].filter(e=>e.id===id).map(e=>e.revision));
 const fingerprint=record=>JSON.stringify(record,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
 const rememberEvent=record=>{
  const version=`${record.id}@${record.revision}`,known=state.eventHistory.get(version);
  if(known&&fingerprint(known)!==fingerprint(record))throw new Error('Conflicting contents for a received event revision.');
  if(!known)state.eventHistory.set(version,structuredClone(record));
 };
 const rememberPosition=record=>{
  validReceived(record);const version=`${record.id}@${record.revision}`,known=state.positionHistory.get(version);
  if(known&&fingerprint(known)!==fingerprint(record))throw new Error('Conflicting contents for a received position revision.');
  if(!known){if(state.positionHistory.size>=10000)throw new Error('Received position history exceeds its bound.');state.positionHistory.set(version,structuredClone(record));}
 };
 for(const [key,delta] of [['events',message.events],['positions',message.positions],['overlays',message.overlays],['recap',message.recap]]){
  const records=new Map(previous[key]);
  if(key==='positions'){
   const history=delta.history===undefined?[]:delta.history;
   if(!Array.isArray(history)||history.length>10000)throw new Error('Invalid received position history.');
   for(const frame of history)rememberPosition(frame);
  }
  if(key==='events'){
   const history=delta.history===undefined?[]:delta.history;
   if(!Array.isArray(history)||history.length>10000)throw new Error('Invalid received event history.');
   const historyLatest=new Map();
   for(const record of history){
    validReceived(record);
    if(![undefined,'upsert','delete'].includes(record.operation))throw new Error('Invalid received event history operation.');
    rememberEvent(record);
    if((historyLatest.get(record.id)?.revision||0)<record.revision)historyLatest.set(record.id,record);
   }
   const snapshotRecords=[...delta.upserts,...(delta.withdrawalRecords||[])];
   for(const record of snapshotRecords)validReceived(record);
   const snapshotLatest=new Map(snapshotRecords.map(record=>[record.id,record]));
   for(const record of historyLatest.values()){
    const current=snapshotLatest.get(record.id);
    if(!current||fingerprint(current)!==fingerprint(record))throw new Error('Received history conflicts with current snapshot.');
   }
   const tombstones=delta.withdrawalRecords||[];
   for(const record of tombstones){
    validReceived(record);
    if(record.operation!=='delete')throw new Error('A withdrawal record must be an actual deletion.');
    rememberEvent(record);
    if((records.get(record.id)?.revision||0)<=record.revision&&latestHistoryRevision(record.id)<=record.revision)records.delete(record.id);
   }
   for(const id of delta.withdrawals||[]){
    if(tombstones.some(record=>record.id===id))continue;
    records.delete(id);
    // Older protocol messages have no actual tombstone. Omit withdrawn
    // history rather than inventing a deletion revision or keeping a ghost.
    for(const [version,event] of state.eventHistory)if(event.id===id)state.eventHistory.delete(version);
   }
  }else for(const id of delta.withdrawals||[]){records.delete(id);if(key==='positions')for(const [version,frame] of state.positionHistory)if(frame.id===id)state.positionHistory.delete(version);}
  for(const record of delta.upserts){
   if(key==='events'||key==='positions')validReceived(record);
   if(key==='positions'&&records.get(record.id)?.revision===record.revision&&fingerprint(records.get(record.id))!==fingerprint(record))
    throw new Error('Conflicting contents for a received position revision.');
   if(key==='positions'){
    rememberPosition(record);
    if([...state.positionHistory.values()].some(frame=>frame.id===record.id&&frame.revision>record.revision))continue;
   }
   if(key==='events'){
    if(record.operation==='delete')throw new Error('Deletions belong in withdrawal records.');
    rememberEvent(record);
    if(latestHistoryRevision(record.id)>record.revision)continue;
   }
   if((key==='events'||key==='positions')&&records.get(record.id)?.revision>record.revision)continue;
   records.set(record.id,record);
  }
  state[key]=records;
 }
 for(const [id,frame] of state.positions)if(frame.time<message.positionWindowStart)state.positions.delete(id);
 for(const [id,overlay] of state.overlays)if(overlay.timing.availableAt>state.time||overlay.timing.expiresAt<=state.time)state.overlays.delete(id);
 return state;
}
