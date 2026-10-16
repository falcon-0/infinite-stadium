import {matchPicture} from './match-picture.js';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
 Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const clock=time=>`${String(Math.floor(time/60)).padStart(2,'0')}:${String(Math.floor(time%60)).padStart(2,'0')}`;
const ref=row=>({type:'event',id:row.id,revision:row.revision});
const copy={
 en:{text:(club,a,b,s,m,e)=>`${club}: ${a} ${a===1?'shot':'shots'} from ${s} to ${m}, then ${b} ${b===1?'shot':'shots'} from ${m} to ${e}.`,limitation:'Adjacent equal windows count received synthetic events. Window starts are excluded and ends included. This is a change in supplied shot counts, not proof of feed completeness, pressure, momentum or tactical cause.'},
 es:{text:(club,a,b,s,m,e)=>`${club}: ${a} ${a===1?'tiro':'tiros'} de ${s} a ${m}, y después ${b} ${b===1?'tiro':'tiros'} de ${m} a ${e}.`,limitation:'Se cuentan eventos sintéticos recibidos en ventanas adyacentes de igual duración. Se excluye el inicio y se incluye el final. El cambio no demuestra datos completos, presión ni causas tácticas.'},
 fr:{text:(club,a,b,s,m,e)=>`${club} : ${a} ${a===1?'tir':'tirs'} de ${s} à ${m}, puis ${b} ${b===1?'tir':'tirs'} de ${m} à ${e}.`,limitation:'Les fenêtres adjacentes de même durée comptent les événements synthétiques reçus. Le début est exclu et la fin incluse. Ce changement ne prouve ni un flux complet, ni une pression ou une cause tactique.'},
 pt:{text:(club,a,b,s,m,e)=>`${club}: ${a} ${a===1?'remate':'remates'} de ${s} a ${m}, depois ${b} ${b===1?'remate':'remates'} de ${m} a ${e}.`,limitation:'As janelas adjacentes de igual duração contam eventos sintéticos recebidos. O início é excluído e o fim incluído. A mudança não prova dados completos, pressão ou causas táticas.'}
};

/** Literal received-shot comparison, never a model-generated tactical claim. */
export function matchChange(records,time,{language='en',windowSeconds=30,observedAt=time}={}){
 if(!Number.isFinite(windowSeconds)||windowSeconds<=0||windowSeconds>600)throw new RangeError('Choose a positive comparison window no longer than ten minutes.');
 if(!Number.isFinite(time)||time<0||!Number.isFinite(observedAt)||observedAt<time)throw new RangeError('The selected comparison time must be within its received horizon.');
 const picture=matchPicture(records,observedAt,{language});
 const dictionary=new Map(records.filter(row=>row.time<=observedAt&&row.arrivedAt<=observedAt).map(row=>[`${row.id}@${row.revision}`,row]));
 const active=picture.evidence.map(reference=>JSON.parse(JSON.stringify(dictionary.get(`${reference.id}@${reference.revision}`)))).filter(row=>row.time<=time);
 const start=time-2*windowSeconds,middle=time-windowSeconds;
 const window=(from,to)=>{
  const rows=active.filter(row=>row.time>from&&row.time<=to);
  return {start:from,end:to,startInclusive:false,endInclusive:true,evidence:rows.map(ref)};
 };
 const previous=window(start,middle),recent=window(middle,time);
 const teams=picture.teams.map(({id,name})=>{
  const before=active.filter(row=>row.team===id&&row.type==='shot'&&row.time>start&&row.time<=middle);
  const after=active.filter(row=>row.team===id&&row.type==='shot'&&row.time>middle&&row.time<=time);
  return {id,name,previousShots:before.length,recentShots:after.length,delta:after.length-before.length,
   shotEvidence:{previous:before.map(ref),recent:after.map(ref)}};
 });
 const complete=start>=0;
 const eligible=complete?teams.filter(team=>team.recentShots>=2&&team.delta>=2||team.previousShots>=2&&team.recentShots===0):[];
 eligible.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)||b.recentShots-a.recentShots||a.id.localeCompare(b.id));
 const selected=eligible[0],signal=selected?{team:selected.id,direction:selected.delta>0?'increase':'decrease',delta:selected.delta}:null;
 const scope={observedAt,windowSeconds,fullAdjacentWindows:complete};
 const key='match-change:'+JSON.stringify(canonical({scope,records:active}));
 return {source:'received-synthetic-shot-comparison',synthetic:true,time,language,scope,windows:{previous,recent},teams,
  status:selected?'insight':'abstain',reason:selected?'material-received-shot-count-change':complete?'no-material-shot-change':'incomplete-windows',
  signal,text:selected?copy[language].text(selected.name,selected.previousShots,selected.recentShots,clock(start),clock(middle),clock(time)):null,
  evidence:active.map(ref),key,limitation:copy[language].limitation};
}
