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
 const input=claim('Portwell has 2 shots while Highfield has 3 shots. On the recorded measure, Portwell has tested the opposing keeper more.');const result=omitLeadingCountProse(input,{...options,observations:['Portwell has 2 shots while Highfield has 3 shots.']});
 assert.equal(result.claim.text,'On the recorded measure, Portwell has tested the opposing keeper more.');assert.deepEqual(result.claim.dependsOn,[0,1]);assert.equal(result.normalization.removedTextVerified,false);assert.equal(result.normalization.originalText,input.text);assert.match(input.text,/2 shots/);
});
test('normalization preserves corrections, single numeric answers, later quantities, observations and incomplete conclusions',()=>{
 for(const [input,extra] of [[claim('There were 2 shots.'),{}],[claim('There were 2 shots. The team leads by 1 goal.'),{}],[claim('There were 2 shots. This means more on-target-sh'),{}],[claim('There were 2 shots. That assumption is incorrect.'),{contradicted:true}],[{...claim('There were 2 shots. A conclusion.'),kind:'observation'},{}],[claim('There were 2 shots. A conclusion.'),{proofs:[{kind:'event'}]}]])assert.equal(omitLeadingCountProse(input,{...options,...extra}).normalization,null,input.text);
});
test('player initials and decimal text do not create false sentence boundaries',()=>{
 const result=omitLeadingCountProse(claim('J. Cole had 2 shots. His on-target attempts give him the edge on that measure.'),{...options,observations:['J. Cole had 2 shots.']});assert.equal(result.claim.text,'His on-target attempts give him the edge on that measure.');
});

test('verified measured comparison can retain a nonnumeric limitation after discarding an unverified numeric preamble',()=>{
 const input={kind:'limitation',text:'Northbridge produced more shots than Harbour Athletic in the last half-minute, with 2 shots to 0. However, this alone is not enough to conclude that Northbridge was the fitter side.',evidence:[],dependsOn:[]};
 const opts={proofs:[{kind:'team-comparison',metric:'attempts',modelGenerated:false,assessmentBounds:'this-measure-only'}]};const result=omitLeadingCountProse(input,opts);
 assert.equal(result.claim.text,'However, this alone is not enough to conclude that Northbridge was the fitter side.');assert.equal(result.normalization.removedTextVerified,false);assert.deepEqual(result.claim.evidence,[]);assert.deepEqual(result.claim.dependsOn,[]);
 for(const proof of [{kind:'count'},{kind:'team-comparison',modelGenerated:true,assessmentBounds:'this-measure-only'},{kind:'event'}])assert.equal(omitLeadingCountProse(input,{proofs:[proof]}).normalization,null);
 for(const text of ['They had 2 shots.','They had 2 shots. They had 1 goal.','They had 2 shots. They were fitter.','They had 2 shots. This is not enough'])assert.equal(omitLeadingCountProse({...input,text},opts).normalization,null);
 assert.equal(omitLeadingCountProse(input,{...opts,contradicted:true}).normalization,null);
});


test('verified comparison removes repeated numeric preamble but preserves the original measurement limitation for review',()=>{
 const input=claim('Northbridge produced more shots than Harbour Athletic in the last half-minute, with 2 shots to 0. However, this alone is not enough to conclude that Northbridge was the fitter side, as shot count does not directly measure fitness or overall team performance.');
 const proof={kind:'team-comparison',modelGenerated:false,assessmentBounds:'this-measure-only'},result=omitLeadingCountProse(input,{proofs:[proof],observations:['Northbridge produced more shots than Harbour Athletic in the last half-minute, with 2 shots to 0.']});
 assert.match(result.claim.text,/^However/);assert.match(result.claim.text,/overall team performance/);assert.deepEqual(result.claim.dependsOn,input.dependsOn);assert.equal(result.normalization.removedTextVerified,false);
 assert.equal(omitLeadingCountProse(input,{proofs:[{...proof,modelGenerated:true}]}).normalization,null);
});


test('a mixed numeric judgment is preserved for verification rather than silently discarded',()=>{
 for(const text of ['J. Cole has 5 completed passes and no shots, indicating a provider role. His passing contributed to the buildup.','He had 2 shots, suggesting greater involvement. The shot was saved.','He has 5 passes because he is the creator. There is a credited assist.','He had 2 shots and drove the attack. His last shot was saved.','He made 5 passes and dictated the tempo. The recipient was Cole.']){
  const input=claim(text),result=omitLeadingCountProse(input,options);assert.equal(result.normalization,null);assert.equal(result.claim.text,text);
 }
});


test('an unselected numeric prefix is never assumed redundant',()=>{
 const input=claim('He had 2 shots. He looked dangerous.');
 assert.equal(omitLeadingCountProse(input,options).normalization,null);
 assert.equal(omitLeadingCountProse(input,{...options,observations:['He had 3 shots.']}).normalization,null);
 assert.equal(omitLeadingCountProse(input,{...options,observations:['He had 2 shots.']}).claim.text,'He looked dangerous.');
});
