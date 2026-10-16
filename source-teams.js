import {isSafePlayerName} from './viewer-preferences.js';

/** Club labels are source identity, not inferred from action counts. Callers
 * supplying records must first materialize current received revisions. */
export function sourceTeams(explicitTeams,records=[]){
 if(explicitTeams!==undefined&&(!explicitTeams||typeof explicitTeams!=='object'||Array.isArray(explicitTeams)||
    Object.keys(explicitTeams).length!==2||!['home','away'].every(side=>Object.hasOwn(explicitTeams,side)&&isSafePlayerName(explicitTeams[side]))||
    explicitTeams.home===explicitTeams.away))throw new TypeError('Provide exactly two distinct bounded source club names.');
 if(!Array.isArray(records))throw new TypeError('Provide current received records for club labels.');
 const result={};
 for(const side of ['home','away']){
  const names=records.filter(row=>row?.team===side&&row.operation!=='delete'&&row.teamName!==undefined).map(row=>row.teamName);
  if(names.some(name=>!isSafePlayerName(name))||new Set(names).size>1||explicitTeams&&names.some(name=>name!==explicitTeams[side]))
   throw new TypeError('Received club labels conflict with the current source identity.');
  result[side]=explicitTeams?.[side]??names[0]??(side==='home'?'Home':'Away');
 }
 if(result.home===result.away)throw new TypeError('The two source club names must be distinct.');
 return Object.freeze(result);
}
