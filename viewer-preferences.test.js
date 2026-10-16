import test from 'node:test';
import assert from 'node:assert/strict';
import {VIEWER_PREFERENCES_KEY,defaultViewerPreferences,loadViewerPreferences,saveViewerPreferences,clearViewerPreferences,isSafePlayerName} from './viewer-preferences.js';
import {matchState} from './match-stream.js';
function storage(entries=[]){
 const values=new Map(entries),operations=[];
 return {values,operations,getItem:key=>{operations.push(['get',key]);return values.get(key)??null;},
  setItem:(key,value)=>{operations.push(['set',key]);values.set(key,value);},removeItem:key=>{operations.push(['remove',key]);values.delete(key);}};
}
const chosen={audience:'player',language:'fr',favoriteClub:'away',favoritePlayer:'D. Silva'};
test('validated choices round-trip through only the project key and return detached values',()=>{
 const adapter=storage([['other-project','untouched'],['access-code','do not read']]);
 assert.equal(saveViewerPreferences(adapter,chosen),true);
 const loaded=loadViewerPreferences(adapter);assert.deepEqual(loaded,chosen);loaded.language='es';
 assert.deepEqual(loadViewerPreferences(adapter),chosen);
 assert.deepEqual(adapter.operations.map(([,key])=>key),Array(3).fill(VIEWER_PREFERENCES_KEY));
 assert.equal(adapter.values.get('other-project'),'untouched');assert.equal(adapter.values.get('access-code'),'do not read');
 assert.deepEqual(Object.keys(JSON.parse(adapter.values.get(VIEWER_PREFERENCES_KEY)).preferences).sort(),Object.keys(chosen).sort());
});
test('missing, malformed, unknown-version, extra fields and unsupported choices fail closed',()=>{
 const record=preferences=>JSON.stringify({version:1,preferences});
 const invalid=[null,'{','null','[]','"execute()"',JSON.stringify({version:2,preferences:chosen}),
  JSON.stringify({version:1,preferences:chosen,accessToken:'secret'}),record({...chosen,fixture:'wide'}),
  record({...chosen,time:30}),record({...chosen,seed:17}),record({...chosen,accessCode:'secret'}),
  record({...chosen,audience:'spatial'}),record({...chosen,language:'de'}),record({...chosen,favoriteClub:'Arsenal'}),
  record({...chosen,favoritePlayer:'<script>'}),record({...chosen,favoritePlayer:''}),record({audience:'analyst'}),
  '{"version":1,"preferences":{"audience":"player","language":"en","favoriteClub":null,"favoritePlayer":null,"__proto__":{"admin":true}}}',
  ' '.repeat(1001)];
 for(const raw of invalid){const adapter=storage([[VIEWER_PREFERENCES_KEY,raw]]);assert.deepEqual(loadViewerPreferences(adapter),defaultViewerPreferences());assert.equal(adapter.operations.length,1);}
 assert.equal({}.admin,undefined);
});
test('storage denial and quota failures keep defaults and do not throw',()=>{
 const denied={getItem(){throw new Error('denied');},setItem(){throw new Error('quota');},removeItem(){throw new Error('denied');}};
 assert.deepEqual(loadViewerPreferences(denied),defaultViewerPreferences());assert.equal(saveViewerPreferences(denied,chosen),false);assert.equal(clearViewerPreferences(denied),false);
 assert.deepEqual(loadViewerPreferences(undefined),defaultViewerPreferences());assert.equal(saveViewerPreferences(undefined,chosen),false);assert.equal(clearViewerPreferences(undefined),false);
});
test('reset removes only the preferences key; invalid saves never invoke storage',()=>{
 const adapter=storage([['auth','untouched'],[VIEWER_PREFERENCES_KEY,'old']]);
 assert.equal(clearViewerPreferences(adapter),true);assert.deepEqual([...adapter.values],[['auth','untouched']]);
 assert.deepEqual(adapter.operations,[['remove',VIEWER_PREFERENCES_KEY]]);
 for(const bad of [{...chosen,token:'secret'},{...chosen,favoritePlayer:'player\nname'},[],Object.assign(Object.create({}),chosen)])assert.equal(saveViewerPreferences(adapter,bad),false);
 assert.equal(adapter.operations.length,1);
});

test('all received roster names and safe stale selections persist without storing roster or credentials',()=>{
 const roster=matchState({kind:'quiet',seed:2719,time:0}).frames[0].players;assert.equal(roster.length,22);
 for(const favoritePlayer of [...roster.map(p=>p.name),'É. Núñez',"D’Arcy O'Neill",'Jean-Luc Martin','A player from an earlier match']){
  assert.equal(isSafePlayerName(favoritePlayer),true);const adapter=storage(),preferences={...chosen,favoritePlayer};
  assert.equal(saveViewerPreferences(adapter,preferences),true);assert.deepEqual(loadViewerPreferences(adapter),preferences);
  assert.deepEqual(Object.keys(JSON.parse(adapter.values.get(VIEWER_PREFERENCES_KEY))),['version','preferences']);
 }
 for(const favoritePlayer of [' A. Reed','A. Reed ','A'.repeat(101),'A\u202eReed','A\u0000Reed','A\nReed','https://example.com','Bearer abc123','<img src=x>','1234',{},['Reed']]){
  assert.equal(isSafePlayerName(favoritePlayer),false);const adapter=storage();assert.equal(saveViewerPreferences(adapter,{...chosen,favoritePlayer}),false);assert.equal(adapter.operations.length,0);
 }
});
test('all UI-supported choices remain valid, including null favorites and independent defaults',()=>{
 for(const audience of ['newcomer','analyst','player'])for(const language of ['en','es','fr','pt'])for(const favoritePlayer of [null,'A. Reed','J. Cole','L. Park','D. Silva']){
  const adapter=storage(),value={audience,language,favoriteClub:null,favoritePlayer};
  assert.ok(saveViewerPreferences(adapter,value));assert.deepEqual(loadViewerPreferences(adapter),value);
 }
 const defaults=defaultViewerPreferences();defaults.language='pt';assert.equal(defaultViewerPreferences().language,'en');
});
