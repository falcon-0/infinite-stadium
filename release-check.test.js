import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {captureReleaseDistribution,captureReleaseArchive,archiveMatchesCleanroom,releaseEnvironment} from './release-check.js';

test('release requires browser checks even when caller disables them, and strips inference settings',()=>{
 const env=releaseEnvironment({REQUIRE_BROWSER_TESTS:'0',AI_PROVIDER:'azure',AZURE_OPENAI_ENDPOINT:'private',AZURE_OPENAI_DEPLOYMENT:'private',AZURE_OPENAI_API_KEY:'private'});
 assert.equal(env.REQUIRE_BROWSER_TESTS,'1');
 for(const key of ['AI_PROVIDER','AZURE_OPENAI_ENDPOINT','AZURE_OPENAI_DEPLOYMENT','AZURE_OPENAI_API_KEY'])assert.equal(env[key],'');
});

test('release distribution binds packaged assets, docs and configuration and matches archive manifest',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'stadium-release-integrity-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const original=captureReleaseDistribution(process.cwd());
 for(const name of Object.keys(original.sourceHashes)){
  const destination=join(directory,name);await mkdir(dirname(destination),{recursive:true});await copyFile(name,destination);
 }
 const before=captureReleaseDistribution(directory);
 assert.equal(before.distributionFingerprint,original.distributionFingerprint);
 execFileSync('python',['-B',join(directory,'package_judge.py')],{windowsHide:true});
 assert.deepEqual(captureReleaseArchive(directory).sourceHashes,before.sourceHashes);
 for(const name of ['index.html','style.css','fan-experience.css','api/index.js','vercel.json','docs/JUDGE_SETUP.md','.github/workflows/verify.yml']){
  await writeFile(join(directory,name),'changed release input');
  const after=captureReleaseDistribution(directory);
  assert.notEqual(after.sourceHashes[name],before.sourceHashes[name],name);
  assert.notEqual(after.distributionFingerprint,before.distributionFingerprint,name);
  await copyFile(name,join(directory,name));
 }
 await writeFile(join(directory,'new-tool.js'),'// newly packaged tool');
 assert.notEqual(captureReleaseDistribution(directory).distributionFingerprint,before.distributionFingerprint);
 assert.deepEqual(captureReleaseArchive(directory).sourceHashes,before.sourceHashes,'Previously built archive remains identifiable after source changes');
});

test('final archive rejects payload replacement after cleanroom even if embedded manifest is unchanged',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'stadium-archive-binding-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 await mkdir(join(directory,'artifacts','judge'),{recursive:true});
 const makeArchive=`import json,sys,zipfile
from pathlib import Path
archive=Path(sys.argv[1])/'artifacts/judge/infinite-stadium-test-build.zip'
with zipfile.ZipFile(archive,'w') as bundle:
 bundle.writestr('infinite-stadium/BUILD_MANIFEST.json',json.dumps({'index.html':'a'*64}))
 bundle.writestr('infinite-stadium/index.html',sys.argv[2])`;
 execFileSync('python',['-B','-c',makeArchive,directory,'original'],{windowsHide:true});
 const original=captureReleaseArchive(directory);
 const cleanroom={passed:true,sha256:original.sha256};
 assert.equal(archiveMatchesCleanroom(original,cleanroom),true);
 assert.equal(archiveMatchesCleanroom(original,{...cleanroom,passed:false}),false);
 assert.equal(archiveMatchesCleanroom(original,{}),false);
 execFileSync('python',['-B','-c',makeArchive,directory,'modified'],{windowsHide:true});
 const modified=captureReleaseArchive(directory);
 assert.deepEqual(modified.sourceHashes,original.sourceHashes);
 assert.equal(archiveMatchesCleanroom(modified,cleanroom),false);
});
