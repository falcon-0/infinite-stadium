const normalize=text=>String(text??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
const has=(text,pattern)=>pattern.test(text);
const cited=(claim,ref)=>claim.evidence?.some(r=>r.id===ref.id&&r.revision===ref.revision);
const causal=/\b(resulted from|caused|led to|because of|effective attacking play|effective attack|active attacking play|causo|causou|provoco|provocou|debido a|devido a|a causa de|por causa de|resulto de|resultou de|resultou em|condujo a|llevo a|levou a|ataque eficaz|ataque efectivo|ataque efetivo|ataque activo|ataque ativo|a cause de|a entraine|a mene a|a provoque|attaque efficace|jeu offensif actif)\b/;
const score=/\b(score|equaliz\w*|equalis\w*|levelled|leveled|lead|leading|marcador|empato|empata\w*|igualo|iguala\w*|ventaja|egalise\w*|egalite|avance|placar|empate|vantagem)\b|\b\d{1,2}\s*[-–]\s*\d{1,2}\b/;
const rate=/\b(metres? per second|meters? per second|metres? par seconde|metros? por segundo|displacement rate|taux de deplacement|taxa de deslocamento|tasa de desplazamiento|vitesse|velocity|velocidade|velocidad)\b|\bm\s*\/\s*s\b/;
const sampled=/\b(sampled interval|interval sample|sample interval|sampled? displacement rate|intervalle echantillonne|intervalo amostrado|intervalo de amostragem|intervalo muestreado|intervalo de muestreo)\b/;
const instantaneous=/\b(at shot time|at the moment of the shot|instantaneous|instantanea\w*|instantane\w*|au moment du tir|no momento do remate|no momento do chute|en el momento del disparo)\b/;
const category=/\b(moderate|fast|slow|moderad\w*|rapido\w*|lento\w*|moderee?\w*|rapide\w*|lent\w*)\b/;
const recovery=/\b(recovery|recuperacion|recuperacao|recuperation)\b/;
const moment=/\b(shot|moment|disparo|remate|chute|tir|momento)\b/;
const seconds=/\b\d+(?:[.,]\d+)?\s*(seconds?|segundos?|secondes?|s)\b/;
const moving=/\b(moved at|moving at|se movio a|se mueve a|se deplacait a|se deplace a|moveu-se a|movia-se a|deslocou-se a)\b/;
const windowPhrase=/\b(window|ventana|fenetre|janela)\b|\b(last|previous|preceding|ultimos?|ultimas?|derniers?|dernieres?)\s+(\d+|one|two|three|un|una|uno|dos|tres|deux|trois|um|uma|dois|duas)\s+(minutes?|minutos?|seconds?|segundos?|secondes?)\b/;
const teamTerms={home:/\b(home|northbridge|local|domicile|casa)\b/,away:/\b(away|harbour(?: athletic)?|visitante|exterieur|visiteurs?|visiteuse|fora)\b/};
const quantity='(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|un|une|una|uno|dos|tres|cuatro|deux|trois|quatre|um|uma|dois|duas|quatro)';
const countTerms={
 shots:new RegExp(`\\b(shots|tirs|disparos|remates|chutes)\\b|\\b${quantity}\\s+(shot|tir|disparo|remate|chute)\\b`),
 completedPasses:/\b(completed|complete(?:e|es|s)?|completo|completou|reussi(?:e|es|s)?|completados?|completos?)\b(?:\s+\w+){0,3}\s+(pass|passes|passe|pases?)\b|\b(pass|passes|passe|pases?)\s+(completed|complete(?:e|es|s)?|completados?|completos?|reussi(?:e|es|s)?)\b/,
 pendingPasses:/\b(pending|pendientes?|pendentes?)\b(?:\s+\w+){0,3}\s+(pass|passes|passe|pases?)\b|\b(pass|passes|passe|pases?)\s+(pending|pendientes?|pendentes?|en attente)\b/,
 recoveries:new RegExp(`\\b(recoveries|recuperaciones|recuperacoes|recuperations)\\b|\\b${quantity}\\s+(possession\\s+)?(recovery|recuperacion|recuperacao|recuperation)\\b`)
};

// Narrow, transparent safeguards for known failure phrases and citation gaps.
// An empty result is not a factual, linguistic, or semantic correctness proof.
export function reviewClaimRisks(draft,{outputs={},language='en'}={}){
 const code=typeof language==='string'?language:language?.code;
 if(!['en','es','fr','pt'].includes(code))return ['Claim safeguards do not cover the requested language.'];
 const tools=Array.isArray(outputs)?Object.fromEntries(outputs.map(item=>[item.tool,item.output])):outputs||{};
 const scoreRefs=tools.score_at_moment?.references||[];
 const sequence=tools.get_event_sequence;
 const events=sequence?.events||[];
 const anchor=events.find(e=>e.id===sequence?.scope?.anchorId);
 const prior=anchor?events.filter(e=>e.type==='recovery'&&e.team===anchor.team&&e.time<anchor.time).sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id)):[];
 const latest=prior.at(-1);
 const boundary=latest&&prior.filter(e=>e.time===latest.time).length===1?[latest,anchor]:[];
 const issues=[];
 for(const [index,claim] of (draft?.claims||[]).entries()){
  const text=normalize(claim.text),prefix=`Claim ${index+1}: `;
  if(has(text,score)&&scoreRefs.length&&scoreRefs.some(ref=>!cited(claim,ref)))issues.push(prefix+'A score, equalizer or lead statement must cite every supplied score-support reference in that claim.');
  if(has(text,causal))issues.push(prefix+'Explicit causal or attacking-effectiveness language exceeds recorded temporal evidence; state neutral chronology.');
  if(has(text,rate)&&has(text,instantaneous)&&!has(text,sampled))issues.push(prefix+'A displacement rate is a sampled interval measurement, not instantaneous movement velocity at shot time.');
  if(has(text,rate)&&has(text,moving)&&!has(text,sampled))issues.push(prefix+'Moved at wording needs explicit sampled interval qualification; displacement is not directly observed movement velocity.');
  if(has(text,rate)&&has(text,category))issues.push(prefix+'A fast, slow or moderate rate category has no supplied threshold; report the sampled value without categorization.');
  if(boundary.length&&has(text,recovery)&&has(text,moment)&&has(text,seconds)&&boundary.some(ref=>!cited(claim,ref)))issues.push(prefix+'A recovery-to-moment timing statement must cite both uniquely identified event boundaries in that claim.');
  const kinds=Object.entries(countTerms).filter(([,pattern])=>has(text,pattern)).map(([kind])=>kind);
  if(has(text,windowPhrase)&&kinds.length){
   const teams=Object.entries(teamTerms).filter(([,pattern])=>has(text,pattern)).map(([team])=>team);
   if(teams.length!==1)issues.push(prefix+'The received-window count has an ambiguous team; name one team per count claim.');
   else for(const metric of tools.get_match_patterns?.analysis?.metrics||[]){
    if(metric.team===teams[0]&&kinds.includes(metric.kind)&&metric.value>0&&(metric.evidence||[]).some(ref=>!cited(claim,ref)))issues.push(prefix+`The ${metric.team} window ${metric.kind} count must cite every counted received input in that claim.`);
   }
  }else if(boundary.length&&kinds.includes('completedPasses')&&has(text,/\b(between|entre)\b/)&&has(text,recovery)){
   const passes=events.filter(e=>e.type==='pass'&&e.result===true&&e.team===anchor.team&&e.time>latest.time&&e.time<anchor.time);
   if([...boundary,...passes].some(ref=>!cited(claim,ref)))issues.push(prefix+'A completed-pass count between recovery and moment must cite both boundaries and every counted pass in that claim.');
  }
 }
 return issues;
}
