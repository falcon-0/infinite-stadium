const ref=e=>({id:e.id,revision:e.revision});
// Factual writing guidance from the selected received window, never intent.
export function momentBrief(explanation){
 const events=explanation.sequence||[],anchor=events.find(e=>e.id===explanation.anchorId);
 if(!anchor||explanation.task==='recap')return null;
 const facts=[{kind:'moment',text:`${anchor.player}: ${anchor.type} at ${anchor.time}s${anchor.type==='shot'?anchor.result===true?' (goal)':anchor.result===false?' (no goal)':' (outcome pending)':''}.`,evidence:[ref(anchor)]}];
 const prior=events.filter(e=>e.time<anchor.time&&e.team===anchor.team);
 const recovery=prior.filter(e=>e.type==='recovery').at(-1);
 const unbroken=recovery&&prior.filter(e=>e.type==='recovery'&&e.time===recovery.time).length===1&&!events.some(e=>e.type==='recovery'&&e.team!==anchor.team&&e.time>=recovery.time&&e.time<=anchor.time);
 if(unbroken)facts.push({kind:'buildup',text:`A recorded recovery by ${recovery.player} preceded this moment by ${anchor.time-recovery.time} seconds. This is chronology, not proof of causation.`,evidence:[ref(recovery),ref(anchor)]});
 const passes=prior.filter(e=>e.type==='pass'&&e.result===true&&(!unbroken||e.time>recovery.time));
 if(passes.length)facts.push({kind:'buildup',text:`${passes.length} completed pass${passes.length===1?'':'es'} recorded ${unbroken?'between that recovery and the moment':'in the preceding received window'}.`,evidence:[...(unbroken?[ref(recovery)]:[]),...passes.map(ref),ref(anchor)]});
 return {facts:facts.slice(0,3),guidance:'Describe the moment, then add supported buildup context when supplied. Cite every event used in a timing or count claim. Do not imply that the buildup caused the outcome.'};
}
export function briefCoverage(draft,brief){
 const cited=draft.claims.map(c=>new Set(c.evidence.map(r=>`${r.id}@${r.revision}`)));
 const available=brief?.facts.filter(f=>f.kind==='buildup')||[];
 const covered=available.filter(f=>cited.some(claim=>f.evidence.every(r=>claim.has(`${r.id}@${r.revision}`)))).length;
 return {availableBuildupFacts:available.length,citedBuildupFacts:covered,
  warning:available.length&&!covered?'The draft may not explain the supplied buildup; no buildup fact has all its supporting references cited.':null,
  limitation:'Reference coverage does not establish that the wording is correct or useful.'};
}
