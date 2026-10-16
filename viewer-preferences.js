export const VIEWER_PREFERENCES_KEY='infinite-stadium.viewer-preferences.v1';
const fields=['audience','language','favoriteClub','favoritePlayer'];
const audiences=new Set(['newcomer','analyst','player']);
const languages=new Set(['en','es','fr','pt']);
// Persistence accepts bounded display names, not a fixed roster or an identity
// assertion. The UI offers received-roster choices; stale safe choices may be
// retained and explicitly shown as unavailable in the current match.
export const isSafePlayerName=value=>typeof value==='string'&&value.length>0&&value.length<=100&&value===value.trim()&&/^[\p{L}][\p{L}\p{M} .’'\-]*$/u.test(value);
export const defaultViewerPreferences=()=>({audience:'newcomer',language:'en',favoriteClub:null,favoritePlayer:null});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
function valid(value){
 return plain(value)&&Object.keys(value).length===fields.length&&fields.every(field=>Object.hasOwn(value,field))&&
  audiences.has(value.audience)&&languages.has(value.language)&&
  [null,'home','away'].includes(value.favoriteClub)&&(value.favoritePlayer===null||isSafePlayerName(value.favoritePlayer));
}
const copy=value=>Object.fromEntries(fields.map(field=>[field,value[field]]));

/** This one project key contains viewing choices only, never access data. */
export function loadViewerPreferences(storage){
 try{
  const raw=storage?.getItem(VIEWER_PREFERENCES_KEY);
  if(typeof raw!=='string'||raw.length>1000)return defaultViewerPreferences();
  const record=JSON.parse(raw);
  if(!plain(record)||Object.keys(record).length!==2||!Object.hasOwn(record,'version')||!Object.hasOwn(record,'preferences')||
     record.version!==1||!valid(record.preferences))return defaultViewerPreferences();
  return copy(record.preferences);
 }catch{return defaultViewerPreferences();}
}
export function saveViewerPreferences(storage,preferences){
 if(!valid(preferences))return false;
 try{storage.setItem(VIEWER_PREFERENCES_KEY,JSON.stringify({version:1,preferences:copy(preferences)}));return true;}
 catch{return false;}
}
export function clearViewerPreferences(storage){
 try{storage.removeItem(VIEWER_PREFERENCES_KEY);return true;}catch{return false;}
}
