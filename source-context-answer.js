import {createHash} from 'node:crypto';

// A semantic planner chooses a variant; independent relevance
// review is still required. No natural-language question matching happens here.
const languages=['en','es','fr','pt'];
const fields=['name','number','team'];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'&&value.trim().length>0&&!/[\u0000-\u001f\u007f]/u.test(value);
const exactKeys=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const fail=message=>{throw new RangeError(message);};

export function checkSourceContextSelection(selection){
 if(!object(selection))fail('A typed source-context selection is required.');
 if(selection.kind==='future-result-limitation'){
  if(!exactKeys(selection,['kind']))fail('Future-result limitation accepts no winner, probability or other parameters.');
  return freeze({kind:selection.kind});
 }
 if(selection.kind!=='roster-inventory'||!exactKeys(selection,['kind','scope','fields']))fail('Use a roster inventory or a future-result limitation.');
 if(!['all','home','away'].includes(selection.scope))fail('Roster scope must be all, home or away.');
 if(!Array.isArray(selection.fields)||!selection.fields.includes('name')||new Set(selection.fields).size!==selection.fields.length||selection.fields.some(field=>!fields.includes(field)))fail('Request unique roster fields, including name; only number and team are optional.');
 return freeze({kind:selection.kind,scope:selection.scope,fields:fields.filter(field=>selection.fields.includes(field))});
}

function sourceIdentity(input,state){
 if(!object(input)||!object(state)||!Number.isFinite(state.time)||state.time<0||!text(state.metadata?.id))fail('A current match snapshot with an identity and observed time is required.');
 if(input.time!==undefined&&input.time!==state.time)fail('Input time must match the supplied observed snapshot.');
 for(const field of ['kind','seed'])if(input[field]!==undefined&&input[field]!==state.metadata[field])fail('Input identity must match the supplied snapshot.');
 const language=input.language??'en';if(!languages.includes(language))fail('Use a supported output language.');
 return {matchId:state.metadata.id,observedAt:state.time,language};
}

function rosterSource(state){
 const frame=Array.isArray(state.frames)&&state.frames.at(-1);
 if(!object(frame)||!text(frame.id)||!Number.isSafeInteger(frame.revision)||frame.revision<1||frame.operation==='delete'||!Number.isFinite(frame.time)||frame.time>state.time||!Number.isFinite(frame.arrivedAt)||frame.arrivedAt>state.time)fail('A received current roster frame is required.');
 if(!Array.isArray(frame.players)||!frame.players.length)fail('An empty or missing roster cannot prove an inventory.');
 const teams=state.metadata.teams;
 if(!object(teams)||!text(teams.home)||!text(teams.away)||teams.home===teams.away)fail('Both distinct recorded team labels are required.');
 const ids=new Set(),names=new Set(),numbers={home:new Set(),away:new Set()};
 const players=frame.players.map(player=>{
  if(!object(player)||!text(player.id)||!text(player.name)||!['home','away'].includes(player.team))fail('Every roster entry needs an exact ID, name and valid team.');
  const nameKey=player.name.normalize('NFKC').trim().toLowerCase();
  if(ids.has(player.id)||names.has(nameKey))fail('Duplicate roster IDs or names are ambiguous.');
  ids.add(player.id);names.add(nameKey);
  const result={id:player.id,name:player.name,team:player.team};
  if(Object.hasOwn(player,'number')){
   if(!Number.isSafeInteger(player.number)||player.number<=0||numbers[player.team].has(player.number))fail('Recorded shirt numbers must be positive safe integers and unique within their team.');
   numbers[player.team].add(player.number);result.number=player.number;
  }
  return result;
 });
 if(!players.some(player=>player.team==='home')||!players.some(player=>player.team==='away'))fail('The supplied complete roster must include both teams.');
 return {frame:{id:frame.id,revision:frame.revision,time:frame.time,arrivedAt:frame.arrivedAt},teams:{home:teams.home,away:teams.away},players};
}

const futureCopy={
 en:['It\'s too early to pick a winner.','I cannot reliably predict a winner from the play so far.'],
 es:['Es demasiado pronto para elegir un ganador.','No puedo predecir con fiabilidad quién ganará con lo visto hasta ahora.'],
 fr:['Il est trop tôt pour désigner un vainqueur.','Je ne peux pas prédire de façon fiable qui gagnera avec le jeu observé jusqu’ici.'],
 pt:['É muito cedo para escolher um vencedor.','Não posso prever com segurança quem ganhará com o jogo até agora.']
};
const headings={en:'Players',es:'Jugadores',fr:'Joueurs',pt:'Jogadores'};

export function buildSourceContextAnswer(input,state,selection){
 const selected=checkSourceContextSelection(selection),identity=sourceIdentity(input,state);
 let source,proof,textValue,kind;
 if(selected.kind==='roster-inventory'){
  source=rosterSource(state);
  const players=source.players.filter(player=>selected.scope==='all'||player.team===selected.scope);
  if(selected.fields.includes('number')&&players.some(player=>!Object.hasOwn(player,'number')))fail('The requested shirt-number inventory has missing values.');
  const groups=['home','away'].filter(team=>players.some(player=>player.team===team));
  textValue=groups.map(team=>`${headings[identity.language]} — ${source.teams[team]}: ${players.filter(player=>player.team===team).map(player=>player.name+(selected.fields.includes('number')?` (#${player.number})`:'')).join(', ')}.`).join(' ');
  kind='observation';
  proof={kind:'source-roster-inventory',basis:'received-roster-frame',...identity,selection:selected,sourceFingerprint:hash(source),frame:source.frame,selectedPlayerIds:players.map(player=>player.id),completeForSuppliedFrame:true,fields:selected.fields,teams:source.teams,modelGenerated:false};
 }else{
  // This is a declared application capability boundary, NOT a claim inferred
  // from a score, absence of events, or any estimated probability.
  source={capability:'future-match-result',available:false,basis:'no-verified-future-result-or-calibrated-predictor-in-this-source-contract',...identity};
  textValue=futureCopy[identity.language][state.time===0?0:1];kind='limitation';
  proof={kind:'source-future-result-limitation',basis:'declared-source-capability',...identity,selection:selected,sourceFingerprint:hash(source),capability:source.capability,available:false,modelGenerated:false};
 }
 const contentHash=hash({proof,text:textValue}),reference={type:'source-context',id:`source-context-${contentHash}`,revision:1};
 return freeze({version:'source-context-v1',claims:[{kind,text:textValue,evidence:[reference]}],evidence:[reference],proof:{...proof,contentHash},source,moments:[],modelGenerated:false,requiresIndependentCoverageReview:true});
}
