import test from 'node:test';
import assert from 'node:assert/strict';
import {requestedPassMetrics} from './requested-pass-metrics.js';
import {executeMatchQuery} from './match-query.js';
import {matchState} from './match-stream.js';
const input={kind:'interrupted',seed:41,time:118};
const query=(filters={type:'pass'},extra={})=>({filters,aggregate:'count',timeFrom:80,timeTo:118,...extra});
const execute=q=>executeMatchQuery(input,q);
function expand(sources,runner=execute){const calls=[];const results=requestedPassMetrics(sources,q=>{calls.push(q);return runner(q);});return {calls,results};}

test('actual requested window obtains all four complete pass partitions with no arithmetic inference',()=>{
 const source=execute(query()),{calls,results}=expand([source,source,execute(query({type:'pass',result:true}))]);
 assert.equal(calls.length,4);assert.deepEqual(results.map(r=>r.count),[4,3,0,1]);
 assert.deepEqual(calls.map(q=>Object.hasOwn(q.filters,'result')?q.filters.result:'all'),['all',true,false,null]);
 for(const result of results){assert.equal(result.query.timeFrom,80);assert.equal(result.query.timeTo,118);assert.equal(result.truncated,false);assert.ok(result.scopeReference.id);}
 assert.equal(results[0].scopeReference.id,source.scopeReference.id);
});

test('team and resolved actor scopes remain exact, and filtered player grouping becomes actor count',()=>{
 const team=expand([execute(query({type:'pass',team:'away'}))]);
 assert.deepEqual(team.results.map(r=>r.count),[3,3,0,0]);assert.ok(team.calls.every(q=>q.filters.team==='away'));
 const actor=expand([execute(query({type:'pass',player:'Kamau'}, {aggregate:'by-player'}))]);
 assert.deepEqual(actor.results.map(r=>r.count),[2,2,0,0]);
 assert.ok(actor.calls.every(q=>q.filters.player==='away-7'&&q.aggregate==='count'));
 const grouped=expand([execute(query({type:'pass'},{aggregate:'by-team'}))]);
 assert.ok(grouped.calls.every(q=>q.aggregate==='by-team'));
 assert.deepEqual(grouped.results[0].groups.map(g=>[g.key,g.count]),[['away',3],['home',1]]);
});

test('exclusive time boundaries are preserved instead of broadening a relative window',()=>{
 const {calls,results}=expand([execute(query({type:'pass'},{timeFrom:88,timeTo:118,timeFromExclusive:true,timeToExclusive:true}))]);
 assert.deepEqual(results.map(r=>r.count),[2,2,0,0]);assert.ok(calls.every(q=>q.timeFromExclusive===true&&q.timeToExclusive===true));
});

test('unresolved identities, unsupported restrictions and non-pass requests add no queries',()=>{
 const sources=[execute(query({type:'pass',player:'Absent Person'})),execute(query({type:'shot'})),execute(query({type:'pass',bodyPart:'left-foot'})),
  execute(query({type:'pass'},{aggregate:'list'})),execute(query({type:'pass'},{aggregate:'by-player'})),
  execute(query({type:'pass'},{aggregate:'by-team',groupCount:{min:2}}))];
 const source=execute(query());sources.push({...source,query:{...source.query,relativeTo:{queryIndex:0}}});
 sources.push({...source,entityResolution:{player:{status:'ambiguous'}}});
 sources.push({...source,query:{...source.query,filters:{type:'pass',team:'unknown'}}});
 sources.push({...source,scope:{...source.scope,timeFrom:0}});
 const {calls,results}=expand(sources);assert.equal(calls.length,0);assert.deepEqual(results,[]);
});

test('outcome subsets deduplicate, distinct windows are bounded before any engine execution',()=>{
 const source=execute(query());
 assert.equal(expand([source,{...source,query:{...source.query,timeFromExclusive:false,timeToExclusive:false}}]).calls.length,4);
 const many=[0,10,20,30].map(timeFrom=>execute(query({type:'pass'},{timeFrom})));
 let calls=0;assert.throws(()=>requestedPassMetrics(many,()=>{calls++;}),/at most three/);assert.equal(calls,0);
});

test('current revisions, deleted and late records stay engine-owned in all partitions',()=>{
 const state=structuredClone(matchState(input));
 const original=state.events.find(e=>e.type==='pass'&&e.time===100);
 state.events.push({...original,revision:0,result:false},{...original,revision:3,result:false,arrivedAt:120});
 const gone={...original,id:'deleted-pass',time:103,arrivedAt:103,result:false};
 state.events.push(gone,{...gone,revision:2,operation:'delete',arrivedAt:104});
 const runner=q=>executeMatchQuery(input,q,{stateFactory:()=>state});
 const result=expand([runner(query())],runner);
 assert.deepEqual(result.results.map(r=>r.count),[4,3,0,1]);
});

test('missing result metadata remains a coverage gap rather than a derived completion',()=>{
 const state=structuredClone(matchState(input)),record=state.events.find(e=>e.type==='pass'&&e.time===100);delete record.result;
 const runner=q=>executeMatchQuery(input,q,{stateFactory:()=>state});
 const {results}=expand([runner(query())],runner);
 assert.deepEqual(results.map(r=>r.count),[4,2,0,1]);
 assert.ok(results.slice(1).every(r=>r.scope.missingFields.result===1));
 assert.notEqual(results[1].count,results[0].count-results[3].count);
});
