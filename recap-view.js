const inventory=records=>[...records].map(e=>[e.id,e.revision]).sort((a,b)=>a[0].localeCompare(b[0]));
export function recapViewKey(records,time,preferences){
 return JSON.stringify([preferences,time,inventory(records)]);
}
export function currentRecap(draft,{records,time,preferences,requestKey}){
 if(!draft||!requestKey||draft.scope?.observedAt!==time||draft.scope?.task!=='recap'||
    draft.scope.fixture?.kind!==preferences.kind||draft.scope.fixture?.seed!==preferences.seed||
    draft.audience!==preferences.audience||draft.language!==preferences.language||
    draft.preferences?.favoriteClub!==(preferences.favoriteClub||null)||
    draft.preferences?.favoritePlayer!==(preferences.favoritePlayer||null)||!Array.isArray(draft.dependencies))return false;
 const activeRecords=[...records],active=inventory(activeRecords);
 const expected=draft.dependencies.map(r=>[r.id,r.revision]).sort((a,b)=>a[0].localeCompare(b[0]));
 return draft.dependencies.every(r=>r.type==='event')&&JSON.stringify(active)===JSON.stringify(expected)&&
  recapViewKey(activeRecords,time,preferences)===requestKey;
}
