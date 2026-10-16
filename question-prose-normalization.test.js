import test from 'node:test';
import assert from 'node:assert/strict';
import {omitLeadingCountProse} from './question-prose-normalization.js';
const claim=text=>({kind:'interpretation',text,evidence:[],dependsOn:[0,1]});
const options={proofs:[{kind:'count'}]};
test('a timed action repeated before a specific limitation is omitted without verifying discarded prose',()=>{
 const input={kind:'limitation',text:'A. Reed took a shot at 01:36 that was saved, confirming he shot rather than passed. However, the specific reason why he shot instead of passing is not recorded.',evidence:[],dependsOn:[]};
 const proof={kind:'event',eventId:'shot',time:96};const result=omitLeadingCountProse(input,{proofs:[proof]});
 assert.equal(result.claim.text,'However, the specific reason why he shot instead of passing is not recorded.');assert.equal(result.normalization.removedTextVerified,false);
 for(const extra of [{contradicted:true},{proofs:[]},{proofs:[{kind:'count'}]}])assert.equal(omitLeadingCountProse(input,{proofs:[proof],...extra}).normalization,null);
 assert.equal(omitLeadingCountProse({...input,text:'He shot at 01:36. He had 2 better options.'},{proofs:[proof]}).normalization,null);
});
test('leading quantitative prose is omitted before review while the conclusion and support remain unchanged',()=>{
 const input=claim('Portwell has 2 shots while Highfield has 3 shots. On the recorded measure, Portwell has tested the opposing keeper more.');const result=omitLeadingCountProse(input,options);
 assert.equal(result.claim.text,'On the recorded measure, Portwell has tested the opposing keeper more.');assert.deepEqual(result.claim.dependsOn,[0,1]);assert.equal(result.normalization.removedTextVerified,false);assert.equal(result.normalization.originalText,input.text);assert.match(input.text,/2 shots/);
});
test('normalization preserves corrections, single numeric answers, later quantities, observations and incomplete conclusions',()=>{
 for(const [input,extra] of [[claim('There were 2 shots.'),{}],[claim('There were 2 shots. The team leads by 1 goal.'),{}],[claim('There were 2 shots. This means more on-target-sh'),{}],[claim('There were 2 shots. That assumption is incorrect.'),{contradicted:true}],[{...claim('There were 2 shots. A conclusion.'),kind:'observation'},{}],[claim('There were 2 shots. A conclusion.'),{proofs:[{kind:'event'}]}]])assert.equal(omitLeadingCountProse(input,{...options,...extra}).normalization,null,input.text);
});
test('player initials and decimal text do not create false sentence boundaries',()=>{
 const result=omitLeadingCountProse(claim('J. Cole had 2 shots. His on-target attempts give him the edge on that measure.'),options);assert.equal(result.claim.text,'His on-target attempts give him the edge on that measure.');
});
