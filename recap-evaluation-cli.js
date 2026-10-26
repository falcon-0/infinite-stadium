import { recapEvaluationAdapters, runRecapEvaluation } from './recap-evaluation.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const usage =
  'Usage: node recap-evaluation-cli.js [--adapter=template|fact-selection] [--live]. Model execution requires explicit --adapter=fact-selection.';
try {
  const args = process.argv.slice(2);
  let adapter = 'template',
    chosen = false,
    live = false;
  for (const arg of args) {
    if (arg.startsWith('--adapter=')) {
      if (chosen) throw new Error('Choose only one recap evaluation adapter.');
      chosen = true;
      adapter = arg.slice(10);
    } else if (arg === '--live') {
      if (live) throw new Error(usage);
      live = true;
    } else throw new Error(usage);
  }
  if (live && (!chosen || adapter !== 'fact-selection')) throw new Error(usage);
  const report = await runRecapEvaluation({
    adapters: recapEvaluationAdapters({
      adapter,
      live,
    }),
  });
  report.provider = live ? 'azure' : 'offline';
  report.adapter = adapter;
  const directory = new URL('./artifacts/evaluations/', import.meta.url);
  await mkdir(directory, {
    recursive: true,
  });
  const destination = new URL(`recap-evaluation-${Date.now()}.json`, directory);
  await writeFile(destination, JSON.stringify(report, null, 2) + '\n');
  for (const row of report.summaries)
    console.log(
      `${row.adapter}: ${row.drafts} drafts, ${row.correctAbstentions} correct abstentions, ${row.withheld} withheld, ${row.failed} failed, ${row.skipped} skipped.`,
    );
  console.log(
    'Semantic quality: pending human review. Canonical references and fixture checks do not establish editorial quality.',
  );
  console.log(`Report: ${fileURLToPath(destination)}`);
  if (report.summaries.some((s) => s.failed)) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
