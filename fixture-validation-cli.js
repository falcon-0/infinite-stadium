import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {integratedFeed} from './match-stream.js';
import {validateFixture} from './fixture-validation.js';
import {matchCatalogue} from './fixture-settings.js';

const args=process.argv.slice(2);
if(args.length>1||args.some(arg=>!/^--kind=(central|wide|extended|withdrawal|sustained|interrupted|quiet|counter|duel)$/.test(arg)))throw new Error('Choose one supported --kind or omit it to validate all fixtures.');
const kinds=args.length?[args[0].split('=')[1]]:['central','wide','extended','withdrawal','sustained','interrupted','quiet','counter','duel'];
const inputs=kinds.flatMap(kind=>[17,101,902].map(seed=>({kind,seed})));
if(!args.length)for(const match of matchCatalogue)if(!inputs.some(row=>row.kind===match.kind&&row.seed===match.seed))inputs.push({kind:match.kind,seed:match.seed});
const cases=inputs.map(({kind,seed})=>({kind,seed,...validateFixture(integratedFeed(kind,seed))}));
const report={createdAt:new Date().toISOString(),source:'authored-synthetic-fixtures',
 interpretation:'These checks validate explicit data contracts and configurable sample heuristics. They do not certify football realism, tactical intent or full-match validity.',cases};
const directory=new URL('./artifacts/data-validation/',import.meta.url);
await mkdir(directory,{recursive:true});
const destination=new URL(`fixture-validation-${Date.now()}.json`,directory);
await writeFile(destination,JSON.stringify(report,null,2)+'\n');
for(const row of cases)console.log(`${row.kind}/${row.seed}: ${row.errors.length} contract errors, ${row.warnings.length} heuristic warnings.`);
console.log(report.interpretation);
console.log(`Report: ${fileURLToPath(destination)}`);
if(cases.some(row=>!row.valid))process.exitCode=1;
