import { readFile, writeFile } from 'node:fs/promises';
import {
  captureEvaluationIdentity,
  createConversationPlan,
  scoreConversationReports,
} from './conversational-evaluation.js';

// Entirely offline: this CLI imports no model adapter and cannot execute a plan.
const [command, ...args] = process.argv.slice(2),
  options = { report: [] };
for (const arg of args) {
  const match = /^--(out|plan|report|reviews|repeat)=(.+)$/.exec(arg);
  if (!match)
    throw new Error(
      'Use prepare --out=FILE [--repeat=3], or score --plan=FILE --report=FILE [--report=FILE] [--reviews=FILE] --out=FILE. No live execution is supported.',
    );
  const [, key, value] = match;
  if (key === 'report') options.report.push(value);
  else {
    if (options[key]) throw new Error(`Duplicate --${key}`);
    options[key] = value;
  }
}
if (!options.out) throw new Error('--out=FILE is required. Existing files are never overwritten.');
const read = async (path) => JSON.parse(await readFile(path, 'utf8'));
let output;
if (command === 'prepare') {
  if (options.plan || options.report.length || options.reviews)
    throw new Error('prepare accepts only --out and --repeat.');
  output = createConversationPlan(captureEvaluationIdentity(), {
    repeat: Number(options.repeat ?? 3),
  });
} else if (command === 'score') {
  if (!options.plan || !options.report.length || options.repeat)
    throw new Error(
      'score requires --plan and at least one --report; repeat belongs to the frozen plan.',
    );
  output = scoreConversationReports(
    await read(options.plan),
    await Promise.all(options.report.map(read)),
    { reviews: options.reviews ? await read(options.reviews) : [] },
  );
} else throw new Error('Choose prepare or score. This offline CLI never invokes a model.');
await writeFile(options.out, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
console.log(
  JSON.stringify({
    file: options.out,
    modelCalls: 0,
    planId: output.planId,
    coverage: output.coverage,
    quality: output.quality,
  }),
);
