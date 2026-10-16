import {integratedMatch,integratedFeed} from './match-stream.js';
import {recapChanges} from './narratives.js';

const changed=(records,old=[])=>{const previous=new Map(old.map(r=>[r.id,r]));return records.filter(r=>previous.get(r.id)?.revision!==r.revision);};
export function broadcastFrame(input,previous=null,messages){
 const feed=messages||integratedFeed(input.kind??'central',input.seed??17);
 const bundle=integratedMatch(input,feed),{state,recap}=bundle;
 const received=new Map();
 for(const event of feed.events){
  if(event.time>state.time||event.arrivedAt>state.time)continue;
  if(!received.has(event.id)||received.get(event.id).revision<event.revision)received.set(event.id,event);
 }
 // Preserve actual provider tombstones, including in a fresh seek snapshot.
 // A withdrawal ID alone cannot supply a fabricated evidence revision.
 const tombstones=[...received.values()].filter(e=>e.operation==='delete').sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id)).map(e=>structuredClone(e));
 bundle.withdrawalRecords=tombstones;
 const withdrawalRecords=changed(tombstones,previous?.withdrawalRecords);
 const oldOverlays=new Map((previous?.recap.overlays||[]).map(e=>[e.id,e]));
 const currentIds=new Set(recap.overlays.map(e=>e.id));
 const eventIds=new Set(state.events.map(e=>e.id));
 return {bundle,message:{schemaVersion:1,matchId:state.metadata.id,time:state.time,score:recap.score,stats:state.stats,
  status:recap.status,positionWindowStart:Math.max(0,state.time-30),
  events:{upserts:changed(state.events,previous?.state.events),withdrawals:[...new Set([...(previous?.state.events||[]).filter(e=>!eventIds.has(e.id)).map(e=>e.id),...withdrawalRecords.map(e=>e.id)])],withdrawalRecords,
   ...(!previous?{history:feed.events.filter(e=>e.time<=state.time&&e.arrivedAt<=state.time).map(e=>structuredClone(e))}:{})},
  positions:{upserts:changed(state.frames,previous?.state.frames),...(!previous?{history:feed.frames.filter(f=>f.time<=state.time&&f.arrivedAt<=state.time).map(f=>structuredClone(f))}:{})},
  overlays:{upserts:recap.overlays.filter(e=>oldOverlays.get(e.id)?.key!==e.key),withdrawals:[...oldOverlays.keys()].filter(id=>!currentIds.has(id))},
  recap:recapChanges(previous?.recap,recap),summary:recap.summary,limitation:state.limit}};
}
