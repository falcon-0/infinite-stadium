import test from 'node:test';
import assert from 'node:assert/strict';
import {integratedMatch} from './match-stream.js';
import {generateDraft,buildRequest} from './ai.js';
import {createInvestigationTools} from './investigation-tools.js';
import {localizedMoment} from './localization.js';

test('localized unknown shot outcomes remain unknown, while explicit outcomes retain their meaning',()=>{
 const wording={es:{pending:/resultado aún no se conoce/,goal:/marcó/,miss:/disparó sin marcar/},fr:{pending:/résultat n’est pas encore connu/,goal:/a marqué/,miss:/a tiré sans marquer/},pt:{pending:/resultado ainda não é conhecido/,goal:/marcou/,miss:/rematou sem marcar/}};
 for(const [language,patterns] of Object.entries(wording))for(const audience of ['newcomer','analyst','player']){
  const write=result=>localizedMoment(language,{player:'A. Reed',result},'Northbridge',{home:0,away:0},audience,'');
  for(const result of [null,undefined]){assert.match(write(result),patterns.pending);assert.doesNotMatch(write(result),patterns.miss);}
  assert.match(write(true),patterns.goal);assert.match(write(false),patterns.miss);
 }
});

test('all languages distinguish explicit miss categories without inventing a direction or overriding pending flags',()=>{
 for(const language of ['en','es','fr','pt']){
  const write=(outcome,result=false)=>localizedMoment(language,{player:'D. Silva',result,outcome},'Harbour Athletic',{home:1,away:0},'newcomer','');
  const categories=['off-target','saved','blocked','on-target'].map(outcome=>write(outcome));
  assert.equal(new Set(categories).size,4);
  for(const text of categories){assert.match(text,/D\. Silva/);assert.match(text,/1-0/);assert.doesNotMatch(text,/wide|over the bar|goalkeeper|tactical cause/);}
  for(const outcome of ['off-target','saved','blocked','on-target','toString','goal']){
   assert.equal(write(outcome,true),write('goal',true));
   assert.equal(write(outcome,null),write(undefined,null));
   assert.equal(write(outcome,'false'),write(undefined,'false'));
  }
  assert.equal(write('unsupported'),write(undefined));
 }
 assert.match(localizedMoment('en',{player:'D. Silva',result:false,outcome:'saved'},'Harbour Athletic',{home:1,away:0},'newcomer',''),/had a shot saved/);
});

test('localized templates retain identities, score, evidence and correction dependency',()=>{
 const english=integratedMatch({time:8,audience:'analyst'});
 for(const language of ['es','fr','pt']){
  const before=integratedMatch({time:8,audience:'analyst',language}),after=integratedMatch({time:10,audience:'analyst',language});
  assert.equal(before.recap.preferences.language,language);assert.deepEqual(before.recap.score,english.recap.score);
  assert.deepEqual(before.recap.entries[0].evidence,english.recap.entries[0].evidence);
  assert.notEqual(before.recap.entries[0].text,english.recap.entries[0].text);
  assert.notEqual(before.recap.entries[0].key,after.recap.entries[0].key);
  assert.match(before.recap.summary,/1-0/);
 }
 assert.throws(()=>buildRequest({source:'integrated-match',time:8,mode:'recap',language:'invented'}),/language/);
 assert.throws(()=>createInvestigationTools({time:8,anchorId:'central-17-shot',language:'invented'}),/language/);
});
test('AI receives an explicit output language and returns it as metadata',async()=>{
 const draft=await generateDraft({source:'integrated-match',time:8,anchorId:'central-17-shot',language:'fr'},
  {config:{url:'https://test.openai.azure.com',key:'test',deployment:'test'},fetcher:async(url,options)=>{
   const payload=JSON.parse(JSON.parse(options.body).messages[1].content);assert.equal(payload.outputLanguage,'French');
   return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({claims:[{text:'A. Reed a marqué.',evidence:[{id:'central-17-shot',revision:1}]}]})}}]}));
  }});
 assert.equal(draft.language,'fr');
});
