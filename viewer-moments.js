import {momentHeadline} from './viewer-copy.js';

// Use the current received inventory, not model recommendations or old revisions.
export function viewerMoments(events,time,{language='en',audience='newcomer',favoritePlayer=null,favoriteClub=null}={}){
 if(!Number.isFinite(time)||time<0)throw new RangeError('Choose a received replay time.');
 const current=new Map();
 for(const event of events){
  if(!event||typeof event.id!=='string'||!Number.isInteger(event.revision)||event.revision<1||
     !Number.isFinite(event.time)||event.time<0||!Number.isFinite(event.arrivedAt)||event.arrivedAt<event.time||event.time>time||event.arrivedAt>time)continue;
  const known=current.get(event.id);
  if(!known||event.revision>known.revision)current.set(event.id,event);
 }
 const received=[...current.values()].filter(e=>e.operation!=='delete'&&e.type!=='flight');
 const belongs=e=>(!favoriteClub||e.team===favoriteClub)&&(!favoritePlayer||e.player===favoritePlayer);
 const candidates=received.filter(e=>e.type==='shot'||audience==='player'&&favoritePlayer&&belongs(e));
 // Other teams' goals remain eligible even when following a player or club.
 const relevant=candidates.filter(e=>e.type==='shot'&&e.result===true||belongs(e));
 const ordered=relevant.sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));
 const selected=ordered.slice(-6);
 return {total:ordered.length,omitted:Math.max(0,ordered.length-selected.length),moments:selected.map(e=>({
  anchorId:e.id,time:e.time,revision:e.revision,team:e.team,text:momentHeadline(e,language),
  pending:e.type==='shot'&&typeof e.result!=='boolean',evidence:[{type:'event',id:e.id,revision:e.revision}]
 }))};
}
