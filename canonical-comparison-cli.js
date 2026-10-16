import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {runCanonicalComparison} from './canonical-comparison.js';

if(process.argv.length>2)throw new Error('Usage: node canonical-comparison-cli.js (offline only). Live providers require shared persistent-budget integration and are not available here.');
const report=await runCanonicalComparison();
const directory=new URL('./artifacts/evaluations/',import.meta.url);
await mkdir(directory,{recursive:true});
const destination=new URL(`canonical-comparison-${Date.now()}.json`,directory);
await writeFile(destination,JSON.stringify(report,null,2)+'\n');
for(const arm of ['deterministic','single-selector','selector-reviewer']){
 const rows=report.results.filter(row=>row.arm===arm);
 console.log(`${arm}: ${rows.filter(row=>row.status==='draft').length} drafts, ${rows.filter(row=>row.status==='correct-abstention').length} abstentions, ${rows.filter(row=>row.status==='skipped').length} skipped, ${rows.filter(row=>row.status==='failed').length} failed.`);
}
console.log('No model calls; human ratings are empty. This is prepared comparison material, not an AI quality result.');
console.log(`Report: ${fileURLToPath(destination)}`);
if(report.results.some(row=>row.status==='failed'))process.exitCode=1;
