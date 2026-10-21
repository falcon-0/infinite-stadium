import test from 'node:test';
import assert from 'node:assert/strict';
import {matchState} from './match-stream.js';
import {buildSourceContextAnswer as build,checkSourceContextSelection as check} from './source-context-answer.js';
const input={kind:'duel',seed:2401,time:0};
const selection={kind:'roster-inventory',scope:'all',fields:['name']};

test('typed selection rejects extra fields, malformed scope and non-name inventory',()=>{
 assert.deepEqual(check({kind:'roster-inventory',scope:'home',fields:['team','name','number']}),{kind:'roster-inventory',scope:'home',fields:['name','number','team']});
 for(const value of [null,[],{}, {...selection,scope:'both'}, {...selection,fields:[]},{...selection,fields:['number']},{...selection,fields:['name','name']},{...selection,fields:['name','captain']},{...selection,playerId:'home-1'},{kind:'future-result-limitation',winner:'home'},{kind:'future-result-limitation',probability:0.5}])assert.throws(()=>check(value),RangeError);
});

test('real current roster includes every player without requiring an event',()=>{
 const state=matchState(input);state.events=[];
 const result=build(input,state,selection);
 assert.equal(result.claims.length,1);assert.equal(result.claims[0].kind,'observation');
 assert.deepEqual(result.proof.selectedPlayerIds,state.frames.at(-1).players.map(p=>p.id));
 for(const p of state.frames.at(-1).players)assert.ok(result.claims[0].text.includes(p.name));
 assert.equal(result.proof.completeForSuppliedFrame,true);assert.equal(result.moments.length,0);
 assert.equal(result.evidence[0].type,'source-context');assert.equal(result.modelGenerated,false);assert.equal(result.requiresIndependentCoverageReview,true);
 assert.ok(Object.isFrozen(result.source.players));assert.match(result.proof.contentHash,/^[a-f0-9]{64}$/);
});

test('team scopes and requested numbers retain exact IDs and source values in four languages',()=>{
 const state=matchState(input);
 for(const language of ['en','es','fr','pt'])for(const scope of ['home','away']){
  const result=build({...input,language},state,{kind:'roster-inventory',scope,fields:['name','number','team']});
  const wanted=state.frames.at(-1).players.filter(p=>p.team===scope);
  assert.deepEqual(result.proof.selectedPlayerIds,wanted.map(p=>p.id));
  assert.ok(result.claims[0].text.includes(state.metadata.teams[scope]));
  for(const p of wanted)assert.ok(result.claims[0].text.includes(`${p.name} (#${p.number})`));
  assert.ok(!result.claims[0].text.includes(state.metadata.teams[scope==='home'?'away':'home']));
 }
});

test('incomplete, duplicate or malformed roster snapshots cannot prove an inventory',()=>{
 const state=matchState(input);
 const changes=[s=>s.frames=[],s=>s.frames.at(-1).players=[],s=>delete s.frames.at(-1).players[0].id,s=>s.frames.at(-1).players[1].id=s.frames.at(-1).players[0].id,s=>s.frames.at(-1).players[1].name=s.frames.at(-1).players[0].name,s=>s.frames.at(-1).players[0].name='',s=>s.frames.at(-1).players[0].team='third',s=>s.frames.at(-1).players[0].number=0,s=>s.frames.at(-1).players[0].number='1',s=>s.frames.at(-1).players[1].number=s.frames.at(-1).players[0].number,s=>s.frames.at(-1).players=s.frames.at(-1).players.filter(p=>p.team==='home'),s=>s.frames.at(-1).operation='delete',s=>s.frames.at(-1).arrivedAt=1,s=>s.frames.at(-1).revision=0,s=>s.metadata.teams.home=''];
 for(const change of changes){const bad=structuredClone(state);change(bad);assert.throws(()=>build(input,bad,selection),RangeError);}
 const missing=structuredClone(state);delete missing.frames.at(-1).players[0].number;
 assert.doesNotThrow(()=>build(input,missing,selection));
 assert.throws(()=>build(input,missing,{...selection,fields:['name','number']}),/missing/);
});

test('proof identity changes for requested fields, source revisions, team membership and names',()=>{
 const state=matchState(input),base=build(input,state,selection);
 for(const change of [s=>s.frames.at(-1).revision++,s=>s.frames.at(-1).players[0].name='Recorded replacement',s=>s.metadata.teams.home='Recorded club']){
  const other=structuredClone(state);change(other);const result=build(input,other,selection);
  assert.notEqual(result.proof.sourceFingerprint,base.proof.sourceFingerprint);assert.notEqual(result.proof.contentHash,base.proof.contentHash);
 }
 const numbered=build(input,state,{...selection,fields:['name','number']});
 assert.notEqual(numbered.proof.contentHash,base.proof.contentHash);assert.equal(numbered.proof.sourceFingerprint,base.proof.sourceFingerprint);
 assert.throws(()=>build({...input,time:1},state,selection),/time/);assert.throws(()=>build({...input,seed:1},state,selection),/identity/);assert.throws(()=>build({...input,language:'de'},state,selection),/language/);
});

test('future-result limitation supplies no winner, score, probability or fictitious event proof',()=>{
 for(const language of ['en','es','fr','pt'])for(const time of [0,60,120]){
  const i={...input,time,language},state=matchState(i),result=build(i,state,{kind:'future-result-limitation'});
  assert.equal(result.claims[0].kind,'limitation');assert.equal(result.proof.available,false);assert.equal(result.proof.basis,'declared-source-capability');assert.equal(result.moments.length,0);
  assert.ok(!result.claims[0].text.includes(state.metadata.teams.home));assert.ok(!/\d|%/.test(result.claims[0].text));
  assert.ok(!Object.hasOwn(result.proof,'winner'));assert.ok(!Object.hasOwn(result.proof,'probability'));
  const altered=structuredClone(state);altered.stats.home.goals=99;altered.events=[];
  assert.deepEqual(build(i,altered,{kind:'future-result-limitation'}),result,'Past score/event changes do not invent a forecast');
 }
});
