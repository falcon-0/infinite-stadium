import {investigateLocally,localStatus} from './local-ai.js';
import {investigateLocalFactStory} from './local-fact-workflow.js';
import {writeFile,mkdir} from 'node:fs/promises';
try {
 const status=await localStatus();
 if(!status.configured)throw new Error(`Local AI is not ready: Python provider=${status.installed}, Ollama=${status.runtime}, model=${status.modelReady}.`);
 const canonical=process.argv.includes('--fact');
 const input=canonical?{source:'integrated-match',kind:'extended',seed:17,time:32,anchorId:'extended-17-0-shot',audience:'newcomer',favoritePlayer:'A. Reed',language:'en'}:{kind:'central',seed:101,time:8,anchorId:'central-101-shot',audience:'analyst',language:'en'};
 const result=await (canonical?investigateLocalFactStory:investigateLocally)(input);
 if(canonical){
  await mkdir(new URL('./artifacts/local/',import.meta.url),{recursive:true});
  await writeFile(new URL('./artifacts/local/fact-story-check.json',import.meta.url),JSON.stringify({input,result},null,2));
  console.log(JSON.stringify({status:result.status,claims:result.claims,execution:result.execution,authorship:result.authorship},null,2));
 }else console.log(JSON.stringify(result,null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
