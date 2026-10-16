import {readFile,writeFile} from 'node:fs/promises';
import {configuration} from './ai.js';
import {captureEvaluationIdentity,scoreConversationReports} from './conversational-evaluation.js';
import {createPersistentModelBudget} from './persistent-budget.js';
import {compareWatchWorkflow,summarizeWatchComparison} from './watch-comparison.js';

const args=process.argv.slice(2),options={};
if(!args.includes('--live'))throw new Error('No model calls made. Use --live only with explicit authorization, --plan=FILE --repeat-index=N --out=NEW_FILE.');
for(const arg of args.filter(value=>value!=='--live')){
 const match=/^--(plan|repeat-index|out|cases|interval-ms|pricing)=(.+)$/.exec(arg);
 if(!match||Object.hasOwn(options,match[1]))throw new Error('Invalid or duplicate comparison option.');
 options[match[1]]=match[2];
}
if(!options.plan||!options.out||!options['repeat-index'])throw new Error('Frozen plan, repeat index and new output path are required.');
const plan=JSON.parse(await readFile(options.plan,'utf8'));scoreConversationReports(plan,[]);
const identity=captureEvaluationIdentity(),repeatIndex=Number(options['repeat-index']);
if(identity.buildFingerprint!==plan.identity.buildFingerprint||identity.promptFingerprint!==plan.identity.promptFingerprint)throw new Error('Source changed since plan freeze. No model calls made.');
if(!Number.isInteger(repeatIndex)||repeatIndex<1||repeatIndex>plan.repeat)throw new Error('Repeat index outside plan.');
const selected=options.cases?.split(',');
if(selected&&(new Set(selected).size!==selected.length||selected.some(id=>!plan.cases.some(row=>row.id===id))))throw new Error('Unknown or duplicate selected case.');
const cases=plan.cases.filter(row=>!selected||selected.includes(row.id));
const intervalMs=Number(options['interval-ms']??30000);
if(!Number.isFinite(intervalMs)||intervalMs<0||intervalMs>60000)throw new Error('Interval must be 0–60000ms.');
const pricing=options.pricing?JSON.parse(await readFile(options.pricing,'utf8')):null;
const config=configuration();if(!config)throw new Error('Azure configuration missing. No model calls made.');
const budget=createPersistentModelBudget({limit:Number(process.env.MAX_DAILY_MODEL_CALLS),filename:process.env.MODEL_BUDGET_FILE});
const report={schema:'infinite-stadium.watch-comparison.v1',createdAt:new Date().toISOString(),mode:'real-azure',
 identity,evaluationIdentity:{planId:plan.planId,buildFingerprint:identity.buildFingerprint,promptFingerprint:identity.promptFingerprint,repeatIndex},
 selectedCaseIds:cases.map(row=>row.id),budgetBefore:budget.snapshot(),cases:[],
 limitation:'Paired review-boundary intervention with a shared analyst prefix; not independent systems, not a semantic quality score.'};
await writeFile(options.out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
let previousStarted=0;
for(const item of cases){
 const current=captureEvaluationIdentity();
 if(current.buildFingerprint!==identity.buildFingerprint){report.stopped='Source changed during run';break;}
 const remaining=budget.snapshot();if(remaining.limit-remaining.calls<5){report.stopped='Insufficient allowance for a bounded five-call case';break;}
 const waitMs=Math.max(0,previousStarted+intervalMs-Date.now());if(waitMs)await new Promise(resolve=>setTimeout(resolve,waitMs));
 previousStarted=Date.now();
 const result=await compareWatchWorkflow(item.input,{config,pricing,fetcher:async(url,request)=>{budget.take();return fetch(url,request);},
  canRepair:(required=2)=>{const remaining=budget.snapshot();return remaining.limit-remaining.calls>=required;}});
 report.cases.push({caseId:item.id,category:item.category,...result});report.budgetAfter=budget.snapshot();
 await writeFile(options.out,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({caseId:item.id,baseline:result.baseline.status,full:result.full.status,calls:result.full.measurements.modelCalls,delta:result.delta}));
 if(['azure-rate-limit','azure-http'].includes(result.full.error?.code)){report.stopped='Provider rejected request; no automatic retry';break;}
}
report.finishedAt=new Date().toISOString();report.budgetAfter=budget.snapshot();report.summary=summarizeWatchComparison(report.cases);
report.unexecutedCaseIds=cases.filter(item=>!report.cases.some(row=>row.caseId===item.id)).map(item=>item.id);
await writeFile(options.out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({file:options.out,summary:report.summary,unexecutedCaseIds:report.unexecutedCaseIds}));
