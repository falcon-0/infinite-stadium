import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {matchCatalogue} from './fixture-settings.js';
import {matchState} from './match-stream.js';
import {executeMatchQuery} from './match-query.js';
import {watchSnapshot} from './watch-snapshot.js';

// Cross-check three independently consumed views of each fixture: stream state,
// the AI's query tool, and the viewer's displayed-clock reconstruction. No model.
const cases=[];
for(const match of matchCatalogue){
 for(const time of [0,30,60,96,98,116,118,120]){
  const input={kind:match.kind,seed:match.seed,time};
  const state=matchState(input),snapshot=watchSnapshot(state.events,time);
  const goals=executeMatchQuery(input,{filters:{type:'shot',result:true},aggregate:'by-team'});
  const shots=executeMatchQuery(input,{filters:{type:'shot'},aggregate:'by-team'});
  const target=executeMatchQuery(input,{filters:{type:'shot',outcome:'on-target'},aggregate:'by-team'});
  assert.equal(goals.scope.matchId,state.metadata.id);
  for(const team of ['home','away']){
   assert.equal(snapshot.score[team],state.stats[team].goals,`${match.id}/${time} stream score`);
   assert.equal(snapshot.score[team],goals.groups.find(g=>g.key===team).count,`${match.id}/${time} queried score`);
   assert.equal(snapshot.totals[team].shots,shots.groups.find(g=>g.key===team).count);
   assert.equal(snapshot.totals[team].onTarget,target.groups.find(g=>g.key===team).count);
  }
  for(const query of [goals,shots,target]){
   assert.ok(query.rows.every(row=>row.time<=time&&row.arrivedAt<=time));
   assert.equal(query.scope.observedAt,time);
  }
  cases.push({matchId:match.id,kind:match.kind,seed:match.seed,time,score:snapshot.score,totals:snapshot.totals,status:'passed'});
 }
}
const directory=new URL('./artifacts/evaluations/',import.meta.url);
await mkdir(directory,{recursive:true});
const report={createdAt:new Date().toISOString(),provider:'none',matches:matchCatalogue.length,cases,
 limitation:'Offline consistency checks; not model interpretation, fan enjoyment or football realism validation.'};
await writeFile(new URL('catalogue-consistency.json',directory),JSON.stringify(report,null,2)+'\n');
console.log(`${report.matches} matches, ${cases.length} clock snapshots: stream, AI query and Watch totals agree. No model calls.`);
