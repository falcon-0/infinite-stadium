import {matchState,matchExplanation} from './match-stream.js';
import {GenerationError} from './ai.js';
import {languagePreference} from './localization.js';
import {narrativePreferences} from './narratives.js';
import {matchChange} from './match-change.js';
import {sourceTeams} from './source-teams.js';

const definitions={
 get_event_sequence:'Read received events in the selected moment window. Includes event revision references.',
 get_position_samples:'Read received position samples up to the selected moment. Coordinates are metres; no interpolation.',
 measure_moment:'Read deterministic spatial measurements and their exact input references. Does not infer pressure or causation.',
 score_at_moment:'Read the recorded score at the selected moment, supported by received goal records.',
 get_match_patterns:'Read received counts and recovery-before-shot sequences in the 120-second window ending at the selected moment. Chronology does not establish tactical pressure or cause.'
};
export function createInvestigationTools(input,{compactPositions=false}={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.anchorId!=='string')throw new GenerationError('Select an integrated event to investigate.',400);
 const audience=input.audience??'newcomer';
 let language;try {language=languagePreference(input.language??'en');}catch {throw new GenerationError('Choose a supported investigation language.',400);}
 if(!['newcomer','analyst','player','spatial'].includes(audience))throw new GenerationError('Choose a valid investigation audience.',400);
 let preferences;
 try {const profile=narrativePreferences({...input,audience:audience==='spatial'?'newcomer':audience,language:language.code});preferences={favoriteClub:profile.favoriteClub,favoritePlayer:profile.favoritePlayer};}
 catch {throw new GenerationError('Choose a valid favorite club and player.',400);}
 let state,explanation;
 try {state=matchState(input);explanation=matchExplanation(state,input.anchorId);}catch {throw new GenerationError('Choose valid integrated match settings.',400);}
 if(!explanation)throw new GenerationError('The selected investigation event has not arrived.',400);
 const anchor=state.events.find(e=>e.id===input.anchorId);
 const goals=state.events.filter(e=>e.type==='shot'&&e.result&&e.time<=anchor.time);
 const goalRefs=goals.map(e=>({id:e.id,revision:e.revision,type:'event'}));
 const scope={observedAt:state.time,anchorId:anchor.id,eventTime:anchor.time,teams:sourceTeams(state.metadata.teams,state.events),limitation:state.limit};
 const changed=matchChange(state.events,anchor.time,{observedAt:state.time});
 const comparisonInputs=state.events.filter(event=>event.time>anchor.time-60&&event.time<=anchor.time).map(event=>
  ({id:event.id,revision:event.revision,time:event.time,arrivedAt:event.arrivedAt,type:event.type,team:event.team}));
 const comparison={status:changed.status,time:changed.time,scope:changed.scope,windows:changed.windows,teams:changed.teams,signal:changed.signal};
 const patternReferences=[...new Map([...explanation.patterns.evidence,...changed.windows.previous.evidence,...changed.windows.recent.evidence]
  .map(reference=>[`${reference.type}:${reference.id}`,reference])).values()];
 const selectedPlayers=new Set(explanation.sequence.flatMap(event=>[event.playerId,event.receiverId]).filter(Boolean));
 explanation.metrics.forEach(metric=>{if(metric.playerId)selectedPlayers.add(metric.playerId);if(metric.opponentId)selectedPlayers.add(metric.opponentId);});
 const positions=compactPositions?explanation.positions.map(frame=>({...frame,players:frame.players.filter(player=>selectedPlayers.has(player.id))})):explanation.positions;
 const outputs={
  get_match_patterns:{scope,analysis:explanation.patterns,comparison,comparisonInputs,references:patternReferences},
  get_event_sequence:{scope,events:explanation.sequence,references:explanation.evidence.filter(r=>r.type==='event')},
  get_position_samples:{scope,positions,references:explanation.evidence.filter(r=>r.type==='frame'),...(compactPositions?{
   coverage:'Only moment participants and opponents identified by deterministic measurements are included. This is a partial selection of tracks, not the full team configuration. Use measure_moment for nearest-opponent distances computed from the complete received sample.'}: {})},
  measure_moment:{scope,metrics:explanation.metrics,references:explanation.evidence.filter(r=>r.type==='metric'||explanation.metrics.some(m=>m.inputs.some(i=>i.id===r.id&&i.revision===r.revision)))},
  score_at_moment:{scope,score:{home:goals.filter(e=>e.team==='home').length,away:goals.filter(e=>e.team==='away').length},goals,
   references:goalRefs.length?goalRefs:[{id:anchor.id,revision:anchor.revision,type:'event'}]}
 };
 return {audience,language,preferences,anchorId:anchor.id,key:explanation.investigationKey,scope,
  definitions:Object.entries(definitions).map(([name,description])=>({type:'function',function:{name,description,parameters:{type:'object',properties:{},additionalProperties:false}}})),
  execute(name,args){
   if(!Object.hasOwn(outputs,name))throw new GenerationError('The investigator requested an unavailable tool.');
   if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length)throw new GenerationError('Investigation tools cannot change the selected time or event.');
   return structuredClone(outputs[name]);
  }};
}
