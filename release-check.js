import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { captureEvaluationIdentity } from './conversational-evaluation.js';

// Use the packager's own inputs so additions to its allowlist remain covered.
export function captureReleaseDistribution(directory) {
  const script = `import hashlib,json,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from package_judge import REQUIRED_FILES,SOURCE_SUFFIXES
root=Path(sys.argv[1]).resolve()
files={root/name for name in REQUIRED_FILES}
for suffix in SOURCE_SUFFIXES:
 files.update(path for path in root.glob('*'+suffix) if not path.name.startswith('.'))
if any(not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(root) for path in files):
 raise RuntimeError('Invalid release distribution input')
print(json.dumps({path.relative_to(root).as_posix():hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(files)},sort_keys=True))`;
  const sourceHashes = JSON.parse(
    execFileSync('python', ['-B', '-c', script, directory], {
      encoding: 'utf8',
      windowsHide: true,
    }),
  );
  return {
    distributionFingerprint: createHash('sha256')
      .update(JSON.stringify(sourceHashes))
      .digest('hex'),
    sourceHashes,
  };
}
export function releaseEnvironment(environment = process.env) {
  return {
    ...environment,
    AI_PROVIDER: '',
    AZURE_OPENAI_ENDPOINT: '',
    AZURE_OPENAI_DEPLOYMENT: '',
    AZURE_OPENAI_API_KEY: '',
    PYTHONUTF8: '1',
    REQUIRE_BROWSER_TESTS: '1',
  };
}
export function captureReleaseArchive(directory) {
  const script = `import hashlib,io,json,sys,zipfile
from pathlib import Path
archive=Path(sys.argv[1])/'artifacts/judge/infinite-stadium-test-build.zip'
archive_bytes=archive.read_bytes()
with zipfile.ZipFile(io.BytesIO(archive_bytes)) as bundle:
 manifest=json.loads(bundle.read('infinite-stadium/BUILD_MANIFEST.json'))
print(json.dumps({'sha256':hashlib.sha256(archive_bytes).hexdigest(),'sourceHashes':manifest}))`;
  return JSON.parse(
    execFileSync('python', ['-B', '-c', script, directory], {
      encoding: 'utf8',
      windowsHide: true,
    }),
  );
}
export function archiveMatchesCleanroom(archive, cleanroom) {
  return (
    cleanroom?.passed === true &&
    typeof cleanroom.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(cleanroom.sha256) &&
    archive.sha256 === cleanroom.sha256
  );
}
// Reproducible local release gate. Never infer, deploy or reset usage ledgers.
export async function runReleaseCheck() {
  const cwd = fileURLToPath(new URL('.', import.meta.url));
  const destination = new URL('./artifacts/release/', import.meta.url);
  await mkdir(destination, { recursive: true });
  const env = releaseEnvironment();
  const stages = [
    [
      'tests',
      process.execPath,
      [
        '--test',
        '--test-concurrency=4',
        ...(await (async () => {
          const { readdir } = await import('node:fs/promises');
          return (await readdir(cwd)).filter((name) => name.endsWith('.test.js')).sort();
        })()),
      ],
    ],
    ['data', process.execPath, ['fixture-validation-cli.js']],
    ['catalogue', process.execPath, ['catalogue-evaluation-cli.js']],
    ['moments', process.execPath, ['evaluation-cli.js', '--adapter=template']],
    ['recaps', process.execPath, ['recap-evaluation-cli.js', '--adapter=template']],
    ['packaging-tests', 'python', ['-m', 'unittest', 'package_judge_test.py']],
    ['package', 'python', ['package_judge.py']],
    [
      'cleanroom',
      'python',
      ['verify_judge_package.py', '--report', 'artifacts/release/cleanroom.json'],
    ],
  ];
  const runtimeSourceIdentity = captureEvaluationIdentity(cwd);
  const distributionIdentity = captureReleaseDistribution(cwd);
  const report = {
    startedAt: new Date().toISOString(),
    modelCalls: 0,
    runtimeSourceIdentity,
    distributionIdentity,
    browserChecksRequired: true,
    stages: [],
    limitation:
      'Local automated validation only; excludes cloud inference, container runtime, human feedback, publication and final submission.',
  };
  for (const [name, command, args] of stages) {
    console.log(`Checking ${name}...`);
    const started = Date.now();
    let output = '';
    const code = await new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd,
        env,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (data) => {
        output += data;
      });
      child.stderr.on('data', (data) => {
        output += data;
      });
      child.once('error', (error) => {
        output += error.message;
        resolve(-1);
      });
      child.once('close', (exit) => resolve(exit ?? -1));
    });
    await writeFile(new URL(`${name}.log`, destination), output);
    report.stages.push({
      name,
      code,
      durationMs: Date.now() - started,
      log: `artifacts/release/${name}.log`,
    });
    if (code !== 0) {
      console.error(`${name} failed. See artifacts/release/${name}.log`);
      process.exitCode = 1;
      break;
    }
  }
  report.runtimeSourceUnchanged =
    captureEvaluationIdentity(cwd).buildFingerprint === runtimeSourceIdentity.buildFingerprint;
  report.distributionUnchanged =
    captureReleaseDistribution(cwd).distributionFingerprint ===
    distributionIdentity.distributionFingerprint;
  if (report.stages.length === stages.length && report.stages.every((row) => row.code === 0)) {
    const archive = captureReleaseArchive(cwd);
    report.archiveSha256 = archive.sha256;
    const cleanroom = JSON.parse(await readFile(new URL('cleanroom.json', destination), 'utf8'));
    report.archiveMatchesCleanroom = archiveMatchesCleanroom(archive, cleanroom);
    report.archiveMatchesDistribution =
      JSON.stringify(Object.entries(archive.sourceHashes).sort()) ===
      JSON.stringify(Object.entries(distributionIdentity.sourceHashes).sort());
  }
  report.finishedAt = new Date().toISOString();
  report.passed =
    report.runtimeSourceUnchanged &&
    report.distributionUnchanged &&
    report.archiveMatchesDistribution === true &&
    report.archiveMatchesCleanroom === true &&
    report.stages.length === stages.length &&
    report.stages.every((row) => row.code === 0);
  if (!report.runtimeSourceUnchanged) {
    process.exitCode = 1;
    console.error('Runtime source changed during validation; the release is not verified.');
  }
  await writeFile(new URL('report.json', destination), JSON.stringify(report, null, 2) + '\n');
  console.log(
    report.passed
      ? 'All eight local release gates passed. No model calls.'
      : 'Release checks incomplete; see artifacts/release/report.json.',
  );

  if (!report.passed) process.exitCode = 1;
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runReleaseCheck();
