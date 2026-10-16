import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
if(process.argv.slice(2).some(arg=>arg!=='--local-ai'))throw new Error('Usage: node check-setup.js [--local-ai]');
const nodeMajor=Number(process.versions.node.split('.')[0]);
console.log(`Replay runtime: Node ${process.versions.node} (${nodeMajor>=20?'ready':'Node 20 or newer required'}).`);
if(nodeMajor<20)process.exitCode=1;
console.log('Recorded replay requires no package install, credentials or AI model. Run npm start, then open http://127.0.0.1:4173.');
if(process.argv.includes('--local-ai')){
 const python=resolve(process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
 if(!existsSync(python)){console.log('Optional local AI: Python environment missing. Follow setup-local.ps1 / README.');process.exitCode=1;}
 else{
  const result=spawnSync(python,['-c','import sys; import agent_framework; print("Python "+sys.version.split()[0]+", Agent Framework import ready")'],{encoding:'utf8',timeout:20000,windowsHide:true});
  if(result.status===0)console.log(result.stdout.trim());else{console.log('Optional local AI: environment is unavailable or dependencies need setup.');process.exitCode=1;}
 }
 console.log('Ollama runtime and qwen3:4b model must also be ready. Check the site AI status after npm run start:local. No inference or downloads ran here.');
}
