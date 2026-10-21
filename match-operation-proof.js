import {createHash} from 'node:crypto';
import {executeMatchQuery} from './match-query.js';
import {matchState} from './match-stream.js';

const metrics=['completedPasses','attempts','goals','shotsOnTarget','recoveries','creditedAssists','passCompletionRate'];
const strict=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const operationPlanSchema=strict({version:{type:'integer',enum:[1]},obligations:{type:'array',maxItems:2,items:strict({
 id:{type:'string',minLength:1,maxLength:80},requestSpan:{type:'string',minLength:1,maxLength:1000},
 operator:{type:'string',enum:['difference','orderedEndpoints','ratio']},metric:{type:'string',enum:metrics},
 subjects:{type:'array',maxItems:2,items:{type:'string',minLength:1,maxLength:100}},timeFrom:{type:'number',minimum:0},timeTo:{type:'number',minimum:0}
})}});

const filters={completedPasses:{type:'pass',result:true},attempts:{type:'shot'},goals:{type:'shot',result:true},shotsOnTarget:{type:'shot',outcome:'on-target'},recoveries:{type:'recovery',recoveryClass:'ball-win'},creditedAssists:{type:'shot',result:true}};
const clock=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
const text={
 en:{overall:'So far',units:[['completed pass','completed passes'],['attempt','attempts'],['confirmed goal','confirmed goals'],['shot on target','shots on target'],['recovery','recoveries'],['credited assist','credited assists']],window:(a,b)=>`From ${a} to ${b}`,lead:(n,m,u)=>`${n} leads by ${m} ${u}.`,tie:(m,u)=>`Level: a difference of ${m} ${u}.`,first:'First',latest:'Latest',at:'at',none:u=>`No ${u} in this interval.`,unknown:'The available detail is incomplete, so this comparison cannot be established.',outcomes:{goal:'confirmed goal',saved:'saved',blocked:'blocked','off-target':'off target','on-target':'on target',pending:'awaiting an outcome',unknown:'outcome unknown',completed:'completed',recovery:'ball recovered',assist:'assist credited'}},
 es:{overall:'En total',units:[['pase completado','pases completados'],['intento','intentos'],['gol confirmado','goles confirmados'],['tiro a puerta','tiros a puerta'],['recuperación','recuperaciones'],['asistencia acreditada','asistencias acreditadas']],window:(a,b)=>`De ${a} a ${b}`,lead:(n,m,u)=>`${n} lleva una ventaja de ${m} ${u}.`,tie:(m,u)=>`Empate: una diferencia de ${m} ${u}.`,first:'Primero',latest:'Último',at:'a las',none:u=>`No hay ${u} en este intervalo.`,unknown:'Faltan detalles para establecer esta comparación.',outcomes:{goal:'gol confirmado',saved:'parado',blocked:'bloqueado','off-target':'fuera','on-target':'a puerta',pending:'a la espera del resultado',unknown:'resultado desconocido',completed:'completado',recovery:'balón recuperado',assist:'asistencia acreditada'}},
 fr:{overall:'Depuis le début',units:[['passe réussie','passes réussies'],['tentative','tentatives'],['but confirmé','buts confirmés'],['tir cadré','tirs cadrés'],['récupération','récupérations'],['passe décisive attribuée','passes décisives attribuées']],window:(a,b)=>`De ${a} à ${b}`,lead:(n,m,u)=>`${n} compte ${m} ${u} de plus.`,tie:(m,u)=>`Égalité : un écart de ${m} ${u}.`,first:'Premier',latest:'Dernier',at:'à',none:u=>`Aucun événement de ce type dans cet intervalle (${u}).`,unknown:'Les détails disponibles ne permettent pas d’établir cette comparaison.',outcomes:{goal:'but confirmé',saved:'arrêté',blocked:'contré','off-target':'non cadré','on-target':'cadré',pending:'résultat en attente',unknown:'résultat inconnu',completed:'réussie',recovery:'ballon récupéré',assist:'passe décisive attribuée'}},
 pt:{overall:'Até agora',units:[['passe completo','passes completos'],['tentativa','tentativas'],['gol confirmado','gols confirmados'],['chute no alvo','chutes no alvo'],['recuperação','recuperações'],['assistência creditada','assistências creditadas']],window:(a,b)=>`De ${a} a ${b}`,lead:(n,m,u)=>`${n} tem uma vantagem de ${m} ${u}.`,tie:(m,u)=>`Empate: uma diferença de ${m} ${u}.`,first:'Primeiro',latest:'Último',at:'aos',none:u=>`Nenhum evento deste tipo neste intervalo (${u}).`,unknown:'Faltam detalhes para estabelecer esta comparação.',outcomes:{goal:'gol confirmado',saved:'defendido',blocked:'bloqueado','off-target':'fora do alvo','on-target':'no alvo',pending:'aguardando o resultado',unknown:'resultado desconhecido',completed:'completo',recovery:'bola recuperada',assist:'assistência creditada'}}
};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exactKeys=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const cleanSpan=value=>value.trim().replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu,'');
const safeString=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u001f]/.test(value);
const uniqueReferences=references=>[...new Map(references.map(ref=>[`${ref.type}:${ref.id}@${ref.revision}`,ref])).values()];
const frozen=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;};
const combinedRatioLabel={en:'Both teams combined',es:'Ambos equipos combinados',fr:'Les deux équipes réunies',pt:'As duas equipes combinadas'};
const ratioCopy={
 en:(v,p)=>`${v.label}: ${p===null?'percentage unavailable':`${p}%`} — ${v.completed} completed of ${v.denominator} passes with a known outcome; ${v.pending} awaiting an outcome.`,
 es:(v,p)=>`${v.label}: ${p===null?'porcentaje no disponible':`${p}%`} — ${v.completed} pases completados de ${v.denominator} con resultado conocido; ${v.pending} pendientes de resultado.`,
 fr:(v,p)=>`${v.label} : ${p===null?'pourcentage indisponible':`${p} %`} — ${v.completed} passes réussies sur ${v.denominator} au résultat connu ; ${v.pending} en attente de résultat.`,
 pt:(v,p)=>`${v.label}: ${p===null?'percentual indisponível':`${p}%`} — ${v.completed} passes completos de ${v.denominator} com resultado conhecido; ${v.pending} aguardando resultado.`
};

/** Collapse only identical proved operations, retaining every request owner.
 * Proof identity includes source fingerprints, values, bounds and revisions;
 * equal rendered text alone never establishes equivalence. */
export function canonicalOperationSelection({proofs,claims}){
 if(!Array.isArray(proofs)||!Array.isArray(claims)||proofs.length!==claims.length)throw new TypeError('Operation claims and proofs must align.');
 const selectedProofs=[],selectedClaims=[],indices=[],seen=new Map();
 for(const [index,proof]of proofs.entries()){
  const {id,requestSpan,...meaning}=proof;
  const identity=proof.status==='proved'&&typeof id==='string'&&typeof requestSpan==='string'?JSON.stringify({proof:meaning,claim:claims[index]}):null;
  let selected=identity===null?undefined:seen.get(identity);
  if(selected===undefined){selected=selectedProofs.length;selectedProofs.push(structuredClone(proof));selectedClaims.push(structuredClone(claims[index]));if(identity!==null)seen.set(identity,selected);}
  else{
   const target=selectedProofs[selected];
   target.requestOwnership??=[{id:target.id,requestSpan:target.requestSpan}];
   target.requestOwnership.push({id,requestSpan});
  }
  indices.push(selected);
 }
 return frozen({proofs:selectedProofs,claims:selectedClaims,originalProofs:structuredClone(proofs),originalToSelectedIndex:indices});
}

/** Execute model-selected typed operations, never generated code or model-supplied
 * operands. The caller still must check whether the plan answers the question.
 * Missing classification is a typed limitation, not zero. All queries share one
 * received snapshot; up to three distinct query executions are allowed. */
export function executeOperationPlan(input,plan,{state,stateFactory=matchState}={}){
 if(!plain(input)||!safeString(input.question,2000)||!Number.isFinite(input.time)||input.time<0)throw new RangeError('An operation needs a current question and received time.');
 if(!exactKeys(plan,['version','obligations'])||plan.version!==1||!Array.isArray(plan.obligations)||plan.obligations.length>2)throw new RangeError('Use operation plan version 1 with at most two obligations.');
 const queryInput={kind:input.kind,seed:input.seed,time:input.time};
 const snapshot=structuredClone(state??stateFactory(queryInput));
 if(snapshot.time!==input.time||!Array.isArray(snapshot.events)||!Array.isArray(snapshot.frames)||!plain(snapshot.metadata?.teams))throw new RangeError('Operations require a pinned state at the question time.');
 snapshot.frames=snapshot.frames.filter(frame=>(frame.time===undefined||frame.time<=snapshot.time)&&(frame.arrivedAt===undefined||frame.arrivedAt<=snapshot.time)).sort((a,b)=>(a.time??0)-(b.time??0));
 const roster=snapshot.frames.at(-1)?.players||[],teams=snapshot.metadata.teams;
 if(roster.some(player=>!safeString(player.id,100)||!Object.hasOwn(teams,player.team))||new Set(roster.map(player=>player.id)).size!==roster.length)throw new RangeError('The received roster has invalid or ambiguous identities.');
 const player=id=>roster.find(p=>p.id===id),isTeam=id=>['home','away'].includes(id)&&Object.hasOwn(teams,id);
 const label=id=>isTeam(id)?teams[id]:player(id)?.name||id;
 const ids=new Set(),requests=new Map();
 const operations=plan.obligations.map(obligation=>{
  if(!exactKeys(obligation,['id','requestSpan','operator','metric','subjects','timeFrom','timeTo'])||!safeString(obligation.id,80)||ids.has(obligation.id)||
   !safeString(obligation.requestSpan,1000)||!cleanSpan(obligation.requestSpan)||!input.question.includes(cleanSpan(obligation.requestSpan))||
   !['difference','orderedEndpoints','ratio'].includes(obligation.operator)||!metrics.includes(obligation.metric)||!Array.isArray(obligation.subjects)||obligation.subjects.length>2||
   new Set(obligation.subjects).size!==obligation.subjects.length||obligation.subjects.some(id=>!safeString(id,100)||!isTeam(id)&&!player(id))||
   !Number.isFinite(obligation.timeFrom)||!Number.isFinite(obligation.timeTo)||obligation.timeFrom<0||obligation.timeTo<obligation.timeFrom||obligation.timeTo>snapshot.time)throw new RangeError('Invalid operation identity, request span, metric, subjects or received window.');
  ids.add(obligation.id);
  const subjects=obligation.subjects;
  if((obligation.operator==='ratio')!==(obligation.metric==='passCompletionRate')||obligation.operator==='ratio'&&subjects.some(id=>!isTeam(id)))throw new RangeError('Pass completion rate uses the ratio operator with combined scope [] or one or two canonical teams.');
  if(obligation.operator==='difference'&&(subjects.length!==2||isTeam(subjects[0])!==isTeam(subjects[1]))||obligation.operator==='orderedEndpoints'&&subjects.length>1)throw new RangeError('Compare two teams or two players; endpoints use a global or single-entity scope.');
  const queryBase={filters:{...filters[obligation.metric]},timeFrom:obligation.timeFrom,timeTo:obligation.timeTo};
  let queries;
  if(obligation.operator==='ratio'){
   queries=[true,false,null].map(result=>({...queryBase,filters:{type:'pass',result},aggregate:'by-team',order:'asc',limit:20}));
  }else if(obligation.operator==='difference'){
   // Compare player operands directly. A bounded global group display may
   // omit either player once more than twenty players contribute.
   queries=isTeam(subjects[0])?[{...queryBase,aggregate:obligation.metric==='creditedAssists'?'by-assister':'by-team',order:'asc',limit:20}]:
    subjects.map(id=>({...queryBase,filters:{...queryBase.filters,[obligation.metric==='creditedAssists'?'assistPlayer':'player']:id},aggregate:'count',order:'asc',limit:20}));
  }
  else{
   if(subjects.length)queryBase.filters[isTeam(subjects[0])?'team':obligation.metric==='creditedAssists'?'assistPlayer':'player']=subjects[0];
   queries=['asc','desc'].map(order=>({...queryBase,aggregate:obligation.metric==='creditedAssists'?'by-assister':'list',order,limit:1}));
  }
  const queryKeys=queries.map(query=>{const key=JSON.stringify(query);requests.set(key,query);return key;});
  return {obligation,queryKeys};
 });
 if(requests.size>3)throw new RangeError('Operation plans may execute at most three distinct queries.');
 const results=new Map([...requests].map(([key,query])=>[key,executeMatchQuery(queryInput,query,{stateFactory:()=>snapshot})]));
 const language=input.language??'en';if(!Object.hasOwn(text,language))throw new RangeError('Use en, es, fr or pt.');
 const words=text[language],proofs=[],claims=[];
 const sourceFingerprint=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
 const multipleWindows=new Set(operations.map(({obligation:o})=>JSON.stringify([o.timeFrom,o.timeTo]))).size>1;
 for(const {obligation:o,queryKeys} of operations){
  const queryResults=queryKeys.map(key=>results.get(key)),evidence=queryResults.map(result=>result.scopeReference);
  const unit=n=>words.units[metrics.indexOf(o.metric)][n===1?0:1],window=o.timeFrom>0||o.timeTo!==snapshot.time?`${words.window(clock(o.timeFrom),clock(o.timeTo))}: `:multipleWindows?`${words.overall}: `:'';
  const proof={id:o.id,requestSpan:o.requestSpan,operator:o.operator,metric:o.metric,subjects:o.subjects.map(id=>({id,label:label(id)})),window:{from:o.timeFrom,to:o.timeTo},sourceFingerprint,status:'proved',values:null,evidence:uniqueReferences(evidence)};
  const missing=queryResults.some(result=>Object.values(result.scope.missingFields).some(n=>n>0)||Object.values(result.entityResolution).some(entity=>entity.status!=='resolved'));
  const unavailable=reason=>{proof.status='unavailable';proof.reason=reason;proof.basis={type:'scope-not-covered',missingFields:queryResults.map(result=>result.scope.missingFields)};claims.push({kind:'limitation',text:`${window}${words.unknown}`,evidence:proof.evidence});};
  if(missing){unavailable('The complete requested metric has missing classification or unresolved identity.');proofs.push(proof);continue;}
  if(o.operator==='ratio'){
   // Query coverage reports absent result fields. Also reject malformed enum
   // values that cannot match any of the three disjoint result partitions.
   const current=new Map();
   for(const event of snapshot.events){
    if(event.time>snapshot.time||event.arrivedAt>snapshot.time)continue;
    const prior=current.get(event.id);
    if(!prior||event.revision>prior.revision||event.revision===prior.revision&&event.operation==='delete')current.set(event.id,event);
   }
   let valid=![...current.values()].some(event=>event.operation!=='delete'&&event.type==='pass'&&event.time>=o.timeFrom&&event.time<=o.timeTo&&![true,false,null].includes(event.result));
   const partitions=queryResults.map((source,index)=>{
    const counts=new Map(),expected=[true,false,null][index];
    valid=valid&&!source.truncated&&source.query.aggregate==='by-team'&&source.query.filters.type==='pass'&&source.query.filters.result===expected&&source.query.timeFrom===o.timeFrom&&source.query.timeTo===o.timeTo&&Number.isSafeInteger(source.count)&&source.count>=0;
    for(const group of source.groups){
     if(!isTeam(group.key)||counts.has(group.key)||!Number.isSafeInteger(group.count)||group.count<0)valid=false;
     counts.set(group.key,group.count);
    }
    valid=valid&&counts.size===2&&counts.has('home')&&counts.has('away')&&[...counts.values()].reduce((sum,n)=>sum+n,0)===source.count;
    return counts;
   });
   if(!valid){unavailable('Pass outcomes or team partitions are incomplete or invalid.');proofs.push(proof);continue;}
   const combined=o.subjects.length===0;
   const values=(combined?[null]:o.subjects).map(id=>{
    const [completed,failed,pending]=partitions.map(counts=>id===null?counts.get('home')+counts.get('away'):counts.get(id)),denominator=completed+failed;
    const ratio=denominator===0?null:completed/denominator,percentage=ratio===null?null:ratio*100;
    const displayPercent=percentage===null?null:String(Math.round(percentage*10)/10).replace('.',language==='en'?'.':',');
    return {id,label:id===null?combinedRatioLabel[language]:label(id),completed,failed,pending,numerator:completed,denominator,ratio,percentage,displayPercent};
   });
   proof.values={...(combined?{combined:values[0]}:{teams:values}),definition:'completed/(completed+failed)',pendingExcluded:true};
   claims.push({kind:'observation',text:`${window}${values.map(value=>ratioCopy[language](value,value.displayPercent)).join(' ')}`,evidence:proof.evidence});
  }else if(o.operator==='difference'){
   const counts=new Map();let valid=true;
   if(!isTeam(o.subjects[0])){
    const field=o.metric==='creditedAssists'?'assistPlayer':'player';
    for(const [index,source] of queryResults.entries()){
     const id=o.subjects[index],entity=source.entityResolution[field];
     if(source.truncated||source.query.aggregate!=='count'||source.query.filters[field]!==id||entity?.status!=='resolved'||entity.canonicalId!==id||
      source.query.timeFrom!==o.timeFrom||source.query.timeTo!==o.timeTo||!Number.isSafeInteger(source.count)||source.count<0){valid=false;break;}
     counts.set(id,source.count);
    }
   }else{
    const source=queryResults[0],seen=new Set();let total=0;valid=!source.truncated;
    for(const group of source.groups){
     const groupPlayer=player(group.key),id=source.query.aggregate==='by-team'?group.key:groupPlayer?.team;
     if(seen.has(group.key)||!Number.isSafeInteger(group.count)||group.count<0||!isTeam(id)||source.query.aggregate!=='by-team'&&!groupPlayer){valid=false;break;}
     seen.add(group.key);counts.set(id,(counts.get(id)||0)+group.count);total+=group.count;
    }
    valid=valid&&total===source.count;
   }
   if(!valid){unavailable('The metric operands are incomplete or have unresolved identities.');proofs.push(proof);continue;}
   const [left,right]=o.subjects.map(id=>({id,label:label(id),count:counts.get(id)||0}));
   const signedDelta=left.count-right.count,absoluteMargin=Math.abs(signedDelta),leader=signedDelta===0?null:signedDelta>0?left.id:right.id;
   proof.values={left,right,signedDelta,absoluteMargin,leader,tie:leader===null};
   claims.push({kind:'observation',text:`${window}${left.label}: ${left.count} ${unit(left.count)}; ${right.label}: ${right.count} ${unit(right.count)}. ${leader===null?words.tie(0,unit(0)):words.lead(label(leader),absoluteMargin,unit(absoluteMargin))}`,evidence:proof.evidence});
  }else{
   const [ascending,descending]=queryResults;
   if(ascending.count!==descending.count||ascending.rows.length!==Math.min(1,ascending.count)||descending.rows.length!==Math.min(1,descending.count)){
    unavailable('The ordered query endpoints do not cover the same received scope.');proofs.push(proof);continue;
   }
   const endpoint=row=>{
    if(!row)return null;
    const id=o.metric==='creditedAssists'?row.assist?.playerId:row.playerId,actor=player(id);
    if(!actor||row.time<o.timeFrom||row.time>o.timeTo||row.arrivedAt>snapshot.time||!Number.isSafeInteger(row.revision)||row.revision<1)return undefined;
    const outcome=o.metric==='completedPasses'?'completed':o.metric==='recoveries'?'recovery':o.metric==='creditedAssists'?'assist':row.result===true?'goal':row.outcome||'unknown';
    return {event:{id:row.id,revision:row.revision,type:row.type,time:row.time,clock:clock(row.time)},actor:{id,label:actor.name||id},outcome:Object.hasOwn(words.outcomes,outcome)?outcome:'unknown',evidence:row.evidence};
   };
   const first=endpoint(ascending.rows[0]),latest=endpoint(descending.rows[0]);
   if(first===undefined||latest===undefined){unavailable('An endpoint has an unknown actor or invalid received revision.');proofs.push(proof);continue;}
   proof.values={count:ascending.count,first,latest};
   proof.evidence=uniqueReferences([...proof.evidence,...(first?.evidence||[]),...(latest?.evidence||[])]);
   const subject=o.subjects.length?`${label(o.subjects[0])}, `:'';
   const feminine=language==='fr'?['completedPasses','attempts','recoveries','creditedAssists'].includes(o.metric):language==='es'?['recoveries','creditedAssists'].includes(o.metric):language==='pt'?['attempts','recoveries','creditedAssists'].includes(o.metric):false;
   const firstName=feminine?({es:'Primera',fr:'Première',pt:'Primeira'})[language]:language==='es'?'Primer':words.first;
   const latestName=feminine?({es:'Última',fr:'Dernière',pt:'Última'})[language]:words.latest;
   const format=(name,event)=>`${name} ${unit(1)}: ${event.actor.label} ${words.at} ${event.event.clock}, ${words.outcomes[event.outcome]}`;
   const same=first&&first.event.id===latest.event.id&&first.event.revision===latest.event.revision;
   const endpoints=first?(same?`${format(`${firstName} ${{en:'and',es:'y',fr:'et',pt:'e'}[language]} ${latestName.toLocaleLowerCase(language)}`,first)}.`:`${format(firstName,first)}; ${format(latestName,latest)}.`):words.none(unit(0));
   claims.push({kind:'observation',text:`${window}${subject}${endpoints}`,evidence:proof.evidence});
  }
  proofs.push(proof);
 }
 return frozen({version:1,...canonicalOperationSelection({proofs,claims}),queryResults:[...results.values()],queryCount:results.size});
}
