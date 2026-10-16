import test from 'node:test';
import assert from 'node:assert/strict';
import {compactRepeatedSchema} from './schema-compaction.js';
test('schema compaction preserves every branch, nullable field and relative-query constraint',()=>{
 const filter={type:'object',properties:{player:{anyOf:[{type:'string',description:'A requested source player name or canonical ID, never an unrelated roster entry.'},{type:'null'}]},team:{anyOf:[{type:'string',enum:['home','away']},{type:'null'}]}},required:['player','team'],additionalProperties:false};
 const source={type:'object',properties:{queries:{type:'array',items:{anyOf:[{type:'object',properties:{filters:filter,relativeTo:{type:'null'}}},{type:'object',properties:{filters:structuredClone(filter),relativeTo:{type:'object',properties:{samePlayer:{type:'boolean',enum:[true]}}}}}]}}}};
 const original=structuredClone(source),compact=compactRepeatedSchema(source);
 const resolve=value=>Array.isArray(value)?value.map(resolve):value&&typeof value==='object'?value.$ref?resolve(compact.$defs[value.$ref.slice(8)]):Object.fromEntries(Object.entries(value).filter(([name])=>name!=='$defs').map(([name,item])=>[name,resolve(item)])):value;
 assert.deepEqual(resolve(compact),source);assert.deepEqual(source,original);assert.ok(JSON.stringify(compact).length<JSON.stringify(source).length);
});
test('existing definitions and repeated nested structures retain acyclic references',()=>{
 const leaf={type:'object',properties:{name:{type:'string',description:'A sufficiently detailed field description repeated in several bounded object branches.'},revision:{type:'integer',minimum:1}},required:['name','revision'],additionalProperties:false};
 const outer={type:'object',properties:{left:leaf,right:leaf},required:['left','right'],additionalProperties:false};
 const source={type:'object',properties:{a:outer,b:outer},$defs:{sharedQuerySchema0:{type:'string'}}};
 const compact=compactRepeatedSchema(source);assert.deepEqual(compact.$defs.sharedQuerySchema0,{type:'string'});
 const resolve=(value,trail=[])=>Array.isArray(value)?value.map(v=>resolve(v,trail)):value&&typeof value==='object'?value.$ref?(assert.ok(!trail.includes(value.$ref)),resolve(compact.$defs[value.$ref.slice(8)],[...trail,value.$ref])):Object.fromEntries(Object.entries(value).filter(([name])=>name!=='$defs').map(([name,item])=>[name,resolve(item,trail)])):value;
 const { $defs,...plain}=source;assert.deepEqual(resolve(compact),plain);
});
