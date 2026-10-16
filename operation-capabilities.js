// This registry licenses declared data filters, not answers or complete intent.
// A model still selects the operation and its scope; review checks relevance.
// Unsupported paraphrases keep the ordinary evidence/query route available.
export const operationMetricPolicyDescription='attempts means ALL shots, including blocked, off-target and pending attempts; recoveries means explicitly classified ball wins, excluding initial segment possession and unknown recovery kinds; raw provider recovery records are a separate query concept. Restrictive metrics require an explicit matching metric concept in the current question: completedPasses (completion/success), goals (goals/scoring), shotsOnTarget (a nominal on-target subset), creditedAssists (explicit assist credit). A question asking whether one shot was on target does not request an on-target-only timeline. Never substitute a restrictive metric for an unqualified one. History can supply a metric topic only for a deictic follow-up with no explicit current metric noun. Missing permission means use the ordinary evidence/query route, not a renamed or broadened metric. This conservative EN/ES/FR/PT lexical filter license is not universal natural-language entailment.';

const normalize=value=>typeof value==='string'?value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[’‘]/g,"'").replace(/[‐‑‒–—-]/g,' ').replace(/\s+/g,' ').trim():'';
const matches=(text,pattern)=>[...text.matchAll(new RegExp(pattern,'gu'))];
const bounded=pattern=>`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`;
const passNoun='pass(?:es)?|pases|passe';
const completion='completed|complete|successful|complet(?:ed|ados?|as?|os?|ou|o|ar|ee?s?)|reussi(?:e?s?|t)?|acertados?|exitosos?|certos?|bem sucedidos?';
const goalNoun='goals?|goles?|gols?|buts|(?:un|une|le|du|ce|quel|aucun|chaque|premier|dernier) but';
const assistNoun='assists?|assisted|assisting|asistencias?|asistio|assistencias?|assistiu|passes? decisiv(?:e?s?|os?|as?)';
const metricNoun=bounded(`${passNoun}|shots?|attempts?|tiros?|tirs?|chutes?|tentativ(?:e?s?|as?)|intentos?|${goalNoun}|${assistNoun}|recover(?:y|ies)|recupera(?:tion|tions|cao|coes|cion|ciones)|saves?|defesas?|arrets?|possession|pressure|pressing|probability|probabilite|probabilidad|probabilidade|xg|accuracy|precision|precisao|completion|score|scored|scoring`);
const explicitTopic=text=>new RegExp(metricNoun,'u').test(text);
const deictic=text=>new RegExp(bounded('and|what about|how about|same|those|that|them|again|he|she|his|her|they|it|which side|which team|who leads|how many|how much|first|latest|last|et|et ensuite|les memes|ceux|cela|il|elle|combien|y|y ahora|esos|eso|el mismo|ella|cuantos|cuantas|e|e agora|esses|isso|o mesmo|ele|ela|quantos|quantas'),'u').test(text);

function topicFor(input){
 const current=normalize(input?.question);
 if(explicitTopic(current)||!deictic(current))return current;
 const questions=Array.isArray(input?.conversation)?input.conversation.map(turn=>normalize(turn?.question)):[];
 if(!questions.length&&input?.previousQuestion)questions.push(normalize(input.previousQuestion));
 for(const question of questions.toReversed()){
  if(explicitTopic(question))return question;
  if(!deictic(question))break;
 }
 return current;
}

function broadens(text){
 return new RegExp(bounded('not just|not only|rather than|instead of|including|regardless of|whether or not|pas seulement|pas uniquement|y compris|plutot que|no solo|no solamente|incluidos?|incluyendo|en vez de|nao apenas|nao so|incluindo|em vez de'),'u').test(text);
}
function deniedBefore(text,index){
 return /\b(?:not|never|isn't|aren't|wasn't|weren't|didn't|without|excluding|except|non|sans|sauf|sin|excepto|nao|sem)\s+(?:\p{L}+\s+){0,2}$/u.test(text.slice(0,index));
}
function nominalOnTarget(text){
 if(broadens(text))return false;
 // These expressions describe a filtered set. Merely asking whether a given
 // shot had this outcome must retain the broader attempt inventory.
 const nouns='shots?|attempts?|tirs?|tiros?|chutes?';
 const patterns=[`(?:shots?|attempts?) on target`,`on target (?:shots?|attempts?)`,`tirs? cadres?`,`tiros? a puerta`,`(?:tiros?|chutes?) (?:no alvo|a baliza)`];
 return patterns.some(pattern=>matches(text,bounded(pattern)).some(match=>{
  if(deniedBefore(text,match.index))return false;
  const before=text.slice(0,match.index).split(/[.!?;,]/).at(-1);
  // Existential/count wording ('were there shots on target?') is a subset;
  // copular outcome questions ('was the first shot on target?') are not.
  if(/\b(?:was|were|is|are|est|etait|etaient|sont|fue|fueron|es|eran|era|foi|foram|e|sao)\s+(?!there\b|il\s+y\b|hay\b|ha\b)[^.!?;,]{0,100}$/u.test(before))return false;
  if(new RegExp(bounded(`(?:all|every|tous les|toutes les|todos los|todos os|todas as) (?:${nouns})`),'u').test(text))return false;
  return true;
 }));
}

/** Pure, total metric license. No model calls, fixture access, question catalog,
 * alias rewriting, answer-fact inheritance or user-language assumptions. */
export function allowedOperationMetrics(input={}){
 const current=normalize(input?.question),topic=topicFor(input),allowed=['attempts','recoveries'];
 const changesInheritedScope=topic!==current&&/\b(?:not|without|excluding|except|pas|sans|sin|nao|sem|all)\b/u.test(current);
 const restrictedBlocked=broadens(topic)||broadens(current)||changesInheritedScope;
 const completionPattern=bounded(`(?:${completion}) (?:${passNoun})|(?:${passNoun}) (?:${completion})|pass completions?`);
 const completionClause=topic.split(/[.!?;,]/).some(clause=>new RegExp(bounded(passNoun),'u').test(clause)&&new RegExp(bounded(completion),'u').test(clause)&&
  !explicitTopic(clause.replace(new RegExp(bounded(passNoun),'gu'),''))&&!new RegExp(bounded(`(?:not|never|weren't|wasn't|isn't|aren't|nao|non|sans|sin) (?:\\p{L}+ ){0,2}(?:${completion})`),'u').test(clause));
 if(!restrictedBlocked&&(matches(topic,completionPattern).some(match=>!deniedBefore(topic,match.index))||completionClause))allowed.push('completedPasses');
 const scoring=bounded(`${goalNoun}|score|scored|marcaron|marcou|marquer|(?:a|ont|avait) marque`);
 if(!restrictedBlocked&&matches(topic,scoring).some(match=>!deniedBefore(topic,match.index)))allowed.push('goals');
 if(!restrictedBlocked&&nominalOnTarget(topic))allowed.push('shotsOnTarget');
 if(!restrictedBlocked&&matches(topic,bounded(assistNoun)).some(match=>!deniedBefore(topic,match.index)))allowed.push('creditedAssists');
 if(!restrictedBlocked&&/\b(?:pass(?:ing|es)?|passes?|pases)\b/u.test(topic)&&/\b(?:accurate|accuracy|precision|precisao|percentage|percent|pourcentage|porcentaje|percentagem|completion rate|taux de reussite)\b/u.test(topic))allowed.push('passCompletionRate');
 return allowed;
}

// These licenses only restrict the optimized arithmetic route. Questions outside
// this deliberately small operation grammar still use free-form query planning.
// Entity licenses come from the request, never the latest event or answer text.
export function allowedOperationSubjects(input={}){
 const question=normalize(input?.question),roster=Array.isArray(input?.roster)?input.roster:[],teams=input?.teams||{};
 const contains=name=>{
  const value=normalize(name);
  return value.length>1&&new RegExp(bounded(value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),'u').test(question);
 };
 const namedPlayers=roster.filter(player=>{
  const name=normalize(player?.name),surname=name.split(/\s+/).at(-1);
  return contains(name)||(surname?.length>2&&roster.filter(other=>normalize(other?.name).split(/\s+/).at(-1)===surname).length===1&&contains(surname));
 }).map(player=>player.id).filter(id=>typeof id==='string');
 const namedTeams=['home','away'].filter(id=>contains(teams[id])||new RegExp(bounded(id==='home'?'home|domicile|local|casa':'away|visiteurs?|visitantes?|fora'),'u').test(question));
 const teamComparison=new RegExp(bounded('teams?|sides?|clubs?|both|each side|either side|equipes?|equipos?|times?|ambos|ambas|les deux|as duas'),'u').test(question)||namedTeams.length===2;
 const difference=[];
 if(teamComparison)difference.push(['home','away']);
 if(namedPlayers.length===2)difference.push(namedPlayers);
 // A comparative follow-up can preserve the previous question's explicit scope.
 // No inherited subject is allowed when the new question names a different one.
 if(!difference.length&&!namedPlayers.length&&!namedTeams.length&&deictic(question)){
  const previous=Array.isArray(input?.conversation)?input.conversation.at(-1)?.question:input?.previousQuestion;
  if(typeof previous==='string'&&previous!==input.question){
   const inherited=allowedOperationSubjects({...input,question:previous,conversation:[],previousQuestion:null});
   difference.push(...inherited.difference);
  }
 }
 const ratio=namedPlayers.length?[]:namedTeams.length===1?[namedTeams]:[['home','away']];
 return {difference,orderedEndpoints:[[],...[...new Set([...namedPlayers,...namedTeams])].map(id=>[id])],ratio};
}

export function allowedOperationOperators(input={}){
 const question=normalize(input?.question),topic=topicFor(input);
 const ratio=allowedTypedOperationMetrics(input).includes('passCompletionRate');
 // These require different tools than a count difference or two endpoints.
 if(new RegExp(bounded('why|pourquoi|por que|porque|standout|best|man of the match|player of the match|playing|lineup|offside|left foot|right foot|pied gauche|pied droit|pie izquierdo|pie derecho|pe esquerdo|pe direito|xg|probability|probabilite|probabilidad|probabilidade|speed|distance|vitesse|velocidad|velocidade|distancia'),'u').test(question))return [];
 if(ratio)return allowedOperationSubjects(input).ratio.length?['ratio']:[];
 if(new RegExp(bounded('accuracy|precision|precisao|percentage|percent|rate|ratio'),'u').test(question))return [];
 const supportedTopic=/\b(?:shots?|attempts?|tirs?|tiros?|chutes?|tentativ(?:es?|as?)|intentos?|recover(?:y|ies)|recupera\w*|goals?|goles?|gols?|buts|assists?|asistencias?|assistencias?|pass(?:es)?|passes?|pases)\b/u.test(topic);
 if(!supportedTopic||!allowedTypedOperationMetrics(input).length)return [];
 const result=[],subjects=allowedOperationSubjects(input);
 const first=/\b(?:first|earliest|premier\w*|primer\w*|primeir\w*)\b/u.test(question);
 const latest=/\b(?:latest|last|most recent|dernier\w*|ultim\w*)\b/u.test(question);
 if(first&&latest)result.push('orderedEndpoints');
 const comparative=/\b(?:more|fewer|less|most|difference|gap|margin|lead\w*|level|tie\w*|equal|compare|comparison|plus|moins|ecart|egal\w*|compar\w*|mas|menos|diferencia|empat\w*|mais|diferenca|vantagem)\b/u.test(question);
 if(comparative&&subjects.difference.length)result.push('difference');
 return result;
}

export function allowedTypedOperationMetrics(input={}){
 const topic=topicFor(input),licensed=allowedOperationMetrics(input);
 const domains={
  attempts:/\b(?:shots?|attempts?|tirs?|tiros?|chutes?|tentativ(?:es?|as?)|intentos?)\b/u,
  recoveries:/\b(?:recover(?:y|ies)|recupera\w*)\b/u,
  completedPasses:/\b(?:pass(?:es)?|passes?|pases|completion\w*)\b/u,
  goals:/\b(?:goals?|goles?|gols?|buts|scor\w*|marqu\w*|marcou|marcaron)\b/u,
  shotsOnTarget:/\b(?:shots?|attempts?|tirs?|tiros?|chutes?)\b/u,
  creditedAssists:/\b(?:assists?|assisted|asistencias?|assistencias?|decisiv\w*)\b/u,
  passCompletionRate:/\b(?:pass(?:ing|es)?|passes?|pases)\b/u
 };
 if(licensed.includes('passCompletionRate'))return ['passCompletionRate'];
 return licensed.filter(metric=>domains[metric].test(topic)&&!(metric==='attempts'&&licensed.includes('shotsOnTarget')));
}

export function allowedOperationWindow(input={}){
 const question=normalize(input?.question);
 const explicit=/\b\d{1,3}:\d{2}\b|\b(?:\d+(?:\.\d+)?|half|thirty|sixty|trente|treinta|trinta|one|two|une?|dos|dois|uma?)\s*(?:seconds?|minutes?|secondes?|segundos?|minutos?)\b/u.test(question);
 if(explicit)return {kind:'explicit'};
 // Leave implicit periods and conversational relative windows to query planning,
 // rather than silently treating them as the whole received segment.
 if(/\b(?:since|before|after|between|recently|half time|halftime|second half|first half|depuis|avant|apres|entre|desde|antes|despues|apos|intervalo|last few|past few|recent play)\b/u.test(question))return null;
 if(!Number.isFinite(input?.time)||input.time<0)return null;
 return {kind:'full',from:0,to:input.time};
}
