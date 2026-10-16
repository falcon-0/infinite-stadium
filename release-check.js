import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {captureEvaluationIdentity} from './conversational-evaluation.js';

// Reproducible local release gate. Explicitly remove provider configuration;
// this command must never infer, deploy, upload or modify the usage ledger.
const cwd=fileURLToPath(new URL('.',import.meta.url));
const destination=new URL('./artifacts/release/',import.meta.url);
await mkdir(destination,{recursive:true});
const env={...process.env,AI_PROVIDER:'',AZURE_OPENAI_ENDPOINT:'',AZURE_OPENAI_DEPLOYMENT:'',AZURE_OPENAI_API_KEY:'',PYTHONUTF8:'1'};
const stages=[
 ['tests',process.execPath,['--test','--test-concurrency=4',...await (async()=>{
  const {readdir}=await import('node:fs/promises');return (await readdir(cwd)).filter(name=>name.endsWith('.test.js')).sort();
 })()]],
 ['data',process.execPath,['fixture-validation-cli.js']],
 ['catalogue',process.execPath,['catalogue-evaluation-cli.js']],
 ['moments',process.execPath,['evaluation-cli.js','--adapter=template']],
 ['recaps',process.execPath,['recap-evaluation-cli.js','--adapter=template']],
 ['packaging-tests','python',['-m','unittest','package_judge_test.py']],
 ['package','python',['package_judge.py']],
 ['cleanroom','python',['verify_judge_package.py','--report','artifacts/release/cleanroom.json']]
];
const runtimeSourceIdentity=captureEvaluationIdentity(cwd);
const report={startedAt:new Date().toISOString(),modelCalls:0,runtimeSourceIdentity,stages:[],
 limitation:'Local automated validation only; excludes cloud inference, container runtime, human feedback, publication and final submission.'};
for(const [name,command,args] of stages){
 console.log(`Checking ${name}...`);
 const started=Date.now();let output='';
 const code=await new Promise(resolve=>{
  const child=spawn(command,args,{cwd,env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
  child.once('error',error=>{output+=error.message;resolve(-1);});
  child.once('close',exit=>resolve(exit??-1));
 });
 await writeFile(new URL(`${name}.log`,destination),output);
 report.stages.push({name,code,durationMs:Date.now()-started,log:`artifacts/release/${name}.log`});
 if(code!==0){console.error(`${name} failed. See artifacts/release/${name}.log`);process.exitCode=1;break;}
}
report.runtimeSourceUnchanged=captureEvaluationIdentity(cwd).buildFingerprint===runtimeSourceIdentity.buildFingerprint;
report.finishedAt=new Date().toISOString();report.passed=report.runtimeSourceUnchanged&&report.stages.length===stages.length&&report.stages.every(row=>row.code===0);
if(!report.runtimeSourceUnchanged){process.exitCode=1;console.error('Runtime source changed during validation; the release is not verified.');}
await writeFile(new URL('report.json',destination),JSON.stringify(report,null,2)+'\n');
console.log(report.passed?'All eight local release gates passed. No model calls.':'Release checks incomplete; see artifacts/release/report.json.');
