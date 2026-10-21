import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { evaluationAdapters, evaluationCases, runEvaluation } from './evaluation.js';

const args = process.argv.slice(2);
if (
  args.some(
    (arg) =>
      !['--live', '--local', '--smoke'].includes(arg) &&
      !/^--repeat=([1-9]|10)$/.test(arg) &&
      !/^--adapter=(fact-selection|template|single-call|investigator-reviewer)$/.test(arg),
  )
)
  throw new Error(
    'Usage: npm run evaluate -- [--live | --local] [--smoke] [--repeat=1..10] [--adapter=fact-selection|template|single-call|investigator-reviewer]',
  );
if (args.filter((arg) => arg.startsWith('--adapter=')).length > 1)
  throw new Error('Choose only one evaluation adapter.');
if (args.includes('--live') && args.includes('--local'))
  throw new Error('Choose one model provider.');
const live = args.includes('--live'),
  local = args.includes('--local'),
  repeat = Number(args.find((a) => a.startsWith('--repeat='))?.split('=')[1] || 1);
const adapter =
  args.find((arg) => arg.startsWith('--adapter='))?.slice('--adapter='.length) || null;
const cases = args.includes('--smoke')
  ? evaluationCases().filter((row) =>
      [
        'central-101-received-pass',
        'central-101-goal-corrected',
        'central-101-future-goal',
      ].includes(row.id),
    )
  : evaluationCases();
const report = await runEvaluation({
  cases,
  adapters: evaluationAdapters({ live, local, adapter }),
  repeat,
});
report.provider = local ? 'local' : live ? 'azure' : 'offline';
report.adapter = adapter || 'all';
const directory = new URL('./artifacts/evaluations/', import.meta.url);
await mkdir(directory, { recursive: true });
const destination = new URL(`evaluation-${Date.now()}.json`, directory);
await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
for (const row of report.summaries)
  console.log(
    `${row.adapter}: ${row.drafts} drafts, ${row.correctAbstentions} correct abstentions, ${row.withheld} withheld, ${row.failed} failed, ${row.skipped} skipped.`,
  );
console.log(
  'Semantic quality: pending human review. No AI comparison result is established by an offline run.',
);
console.log(`Report: ${fileURLToPath(destination)}`);
if (report.summaries.some((row) => row.failed)) process.exitCode = 1;
