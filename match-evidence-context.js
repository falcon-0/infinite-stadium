import {executeMatchQuery} from './match-query.js';
const links=e=>[e.passId,e.shotId,e.cause,e.assist?.passId].filter(v=>typeof v==='string');

// Follow explicit provider links in current received revisions. Neighbouring
// events alone never imply an assist, intention, or uninterrupted possession.
export function linkedMatchEvidence(state,rootIds,{maxEvents=16,maxDepth=3}={}){
 if(!Number.isSafeInteger(maxEvents)||maxEvents<1||maxEvents>24||!Number.isSafeInteger(maxDepth)||maxDepth<0||maxDepth>6)throw new RangeError('Choose bounded evidence context.');
 const events=state.events.filter(e=>e.time<=state.time&&e.arrivedAt<=state.time&&e.operation!=='delete');
 const index=new Map(events.map(e=>[e.id,e])),reverse=new Map();
 for(const e of events)for(const id of links(e)){if(!reverse.has(id))reverse.set(id,[]);reverse.get(id).push(e.id);}
 const roots=[...new Set(rootIds)].filter(id=>index.has(id)).slice(0,4),queue=roots.map(id=>({id,depth:0})),seen=new Set();let truncated=false;
 while(queue.length){const {id,depth}=queue.shift();if(seen.has(id)||!index.has(id))continue;
  if(seen.size>=maxEvents){truncated=true;break;}seen.add(id);
  const neighbours=[...links(index.get(id)),...(reverse.get(id)||[])].filter(next=>index.has(next)&&!seen.has(next));
  if(depth<maxDepth)queue.push(...neighbours.map(id=>({id,depth:depth+1})));else if(neighbours.length)truncated=true;
 }
 const input={kind:state.metadata.kind,seed:state.metadata.seed,time:state.time};
 const rows=[...seen].map(id=>executeMatchQuery(input,{filters:{id},limit:1},{stateFactory:()=>state}).rows[0]).sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));
 return {roots,observedAt:state.time,rows,truncated,limitation:'Explicit received event links only. This bounded context is not a complete match inventory and cannot prove absence or player intent.'};
}
