import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { GenerationError } from './ai.js';
import { createPersistentModelBudget } from './persistent-budget.js';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawn } from 'node:child_process';

const folder = () => {
  const base = resolve('artifacts/budget-tests');
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, 'ledger-'));
};
const date = () => new Date('2026-10-06T12:00:00.000Z');
const rejects = (action, status) =>
  assert.throws(
    action,
    (error) =>
      error instanceof GenerationError &&
      error.status === status &&
      error.message ===
        (status === 429
          ? 'Daily model-call limit reached.'
          : 'Persistent model-call budget is unavailable.'),
  );
const budget = (filename, limit = 2, clock = date) =>
  createPersistentModelBudget({ filename, limit, clock });
function withStorageFaults(replacements, action) {
  const originals = Object.fromEntries(Object.keys(replacements).map((name) => [name, fs[name]]));
  try {
    for (const [name, replace] of Object.entries(replacements)) fs[name] = replace(originals[name]);
    syncBuiltinESMExports();
    return action();
  } finally {
    Object.assign(fs, originals);
    syncBuiltinESMExports();
  }
}
const sharingError = (code) =>
  Object.assign(new Error('simulated transient sharing failure'), { code });

test('creation and status do not write; reservations survive restart and same-file instances', () => {
  const dir = folder(),
    file = join(dir, 'ledger.json'),
    one = budget(file),
    two = budget(file);
  assert.deepEqual(readdirSync(dir), []);
  assert.deepEqual(one.snapshot(), { day: '2026-10-06', calls: 0, limit: 2 });
  assert.deepEqual(readdirSync(dir), []);
  one.take();
  two.take();
  assert.deepEqual(budget(file).snapshot(), { day: '2026-10-06', calls: 2, limit: 2 });
  rejects(() => one.take(), 429);
  rejects(() => two.take(), 429);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
    version: 1,
    day: '2026-10-06',
    calls: 2,
  });
  assert.deepEqual(readdirSync(dir), ['ledger.json']);
});

test('reservation precedes provider work and is retained after a provider failure', () => {
  const file = join(folder(), 'ledger.json'),
    one = budget(file, 1);
  const provider = () => {
    one.take();
    assert.equal(budget(file, 1).snapshot().calls, 1);
    throw new Error('provider rejected');
  };
  assert.throws(provider, /provider rejected/);
  rejects(provider, 429);
  assert.equal(budget(file, 1).snapshot().calls, 1);
});

test('configuration changes retain calls and next UTC day resets without status writes', () => {
  const file = join(folder(), 'ledger.json');
  let now = new Date('2026-10-06T23:59:59Z');
  const one = budget(file, 3, () => now);
  one.take();
  one.take();
  assert.equal(budget(file, 1, () => now).snapshot().calls, 2);
  rejects(() => budget(file, 1, () => now).take(), 429);
  now = new Date('2026-10-07T00:00:00Z');
  assert.deepEqual(one.snapshot(), { day: '2026-10-07', calls: 0, limit: 3 });
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).day, '2026-10-06');
  one.take();
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
    version: 1,
    day: '2026-10-07',
    calls: 1,
  });
});

test('invalid and backwards UTC clocks fail closed, including persisted future day', () => {
  const file = join(folder(), 'ledger.json');
  let now = date();
  const one = budget(file, 2, () => now);
  one.take();
  now = new Date('2026-10-05T23:59:59Z');
  rejects(() => one.snapshot(), 503);
  rejects(() => one.take(), 503);
  rejects(() => budget(file, 2, () => now).take(), 503);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).calls, 1);
  for (const clock of [
    () => new Date(NaN),
    () => null,
    () => {
      throw new Error('clock secret');
    },
  ])
    rejects(() => budget(file, 2, clock).snapshot(), 503);
});

test('malformed, oversized, unknown-field and impossible ledger dates never reset usage', () => {
  const dir = folder(),
    file = join(dir, 'ledger.json');
  for (const data of [
    '{',
    'null',
    '[]',
    ' '.repeat(4097),
    JSON.stringify({ version: 2, day: '2026-10-06', calls: 1 }),
    JSON.stringify({ version: 1, day: '2026-02-30', calls: 1 }),
    JSON.stringify({ version: 1, day: '2026-10-06', calls: -1 }),
    JSON.stringify({ version: 1, day: '2026-10-06', calls: 1.5 }),
    JSON.stringify({ version: 1, day: '2026-10-06', calls: 1, secret: 'do-not-leak' }),
  ]) {
    writeFileSync(file, data);
    const one = budget(file);
    rejects(() => one.snapshot(), 503);
    rejects(() => one.take(), 503);
    assert.equal(readFileSync(file, 'utf8'), data);
    assert.equal(existsSync(file + '.lock'), false);
  }
});

test('foreign lock is never removed or modified; successful reservation removes only its own lock', () => {
  const dir = folder(),
    file = join(dir, 'ledger.json'),
    lock = file + '.lock';
  writeFileSync(lock, 'another-process-owner');
  const one = budget(file);
  rejects(() => one.take(), 503);
  assert.equal(readFileSync(lock, 'utf8'), 'another-process-owner');
  assert.equal(existsSync(file), false);
  assert.deepEqual(one.snapshot(), { day: '2026-10-06', calls: 0, limit: 2 });
  unlinkSync(lock);
  one.take();
  assert.equal(existsSync(lock), false);
  assert.equal(one.snapshot().calls, 1);
});

test('failed storage cannot reserve or reach provider and cleans owned temporary paths', () => {
  const dir = folder(),
    parent = join(dir, 'not-a-directory');
  writeFileSync(parent, 'blocked');
  const blocked = budget(join(parent, 'ledger.json'));
  rejects(() => blocked.take(), 503);
  const file = join(dir, 'directory-ledger');
  mkdirSync(file);
  const one = budget(file);
  rejects(() => one.snapshot(), 503);
  rejects(() => one.take(), 503);
  assert.equal(existsSync(file + '.lock'), false);
  assert.equal(
    readdirSync(dir).some((name) => name.includes('.tmp-')),
    false,
  );
  for (const options of [
    { limit: 0, filename: join(dir, 'bad') },
    { limit: 1.5, filename: join(dir, 'bad') },
    { limit: 1, filename: '' },
  ])
    rejects(() => createPersistentModelBudget(options), 503);
});

test('atomic temporary-write failure preserves existing usage and releases the owned lock', () => {
  const dir = folder(),
    file = join(dir, 'x'.repeat(230) + '.json');
  // The ledger and lock components fit the filesystem's 255-character limit;
  // the unique atomic-temp component exceeds it and its creation must fail.
  const original = JSON.stringify({ version: 1, day: '2026-10-06', calls: 1 });
  writeFileSync(file, original);
  const one = budget(file, 3);
  rejects(() => one.take(), 503);
  assert.equal(readFileSync(file, 'utf8'), original);
  assert.equal(existsSync(file + '.lock'), false);
  assert.equal(one.snapshot().calls, 1);
  assert.deepEqual(readdirSync(dir), ['x'.repeat(230) + '.json']);
});

test('transient atomic replacement retries the same reservation without resetting or doubling usage', () => {
  const file = join(folder(), 'ledger.json'),
    one = budget(file, 4);
  one.take();
  let attempts = 0;
  withStorageFaults(
    {
      renameSync: (original) => (from, to) => {
        if (to === file && ++attempts <= 2) throw sharingError(attempts === 1 ? 'EPERM' : 'EBUSY');
        return original(from, to);
      },
    },
    () => one.take(),
  );
  assert.equal(attempts, 3);
  assert.equal(one.snapshot().calls, 2);
  assert.equal(existsSync(file + '.lock'), false);
});

test('lock cleanup closes its descriptor first and recovers from a transient sharing failure', () => {
  const file = join(folder(), 'ledger.json'),
    one = budget(file, 3);
  let lockDescriptor,
    attempts = 0;
  withStorageFaults(
    {
      openSync:
        (original) =>
        (path, ...args) => {
          const descriptor = original(path, ...args);
          if (path === file + '.lock') lockDescriptor = descriptor;
          return descriptor;
        },
      unlinkSync: (original) => (path) => {
        if (path === file + '.lock') {
          assert.throws(
            () => fs.fstatSync(lockDescriptor),
            (error) => error.code === 'EBADF',
          );
          if (++attempts === 1) throw sharingError('EPERM');
        }
        return original(path);
      },
    },
    () => one.take(),
  );
  assert.equal(attempts, 2);
  assert.equal(existsSync(file + '.lock'), false);
  one.take();
  assert.equal(one.snapshot().calls, 2);
});

test('a lock replaced during cleanup is never deleted on retry', () => {
  const file = join(folder(), 'ledger.json'),
    one = budget(file, 3);
  let attempts = 0;
  withStorageFaults(
    {
      unlinkSync: (original) => (path) => {
        if (path === file + '.lock' && ++attempts === 1) {
          writeFileSync(path, 'foreign-owner');
          throw sharingError('EBUSY');
        }
        return original(path);
      },
    },
    () => one.take(),
  );
  assert.equal(attempts, 1);
  assert.equal(readFileSync(file + '.lock', 'utf8'), 'foreign-owner');
  rejects(() => one.take(), 503);
  assert.equal(one.snapshot().calls, 1);
});

test('persistent sharing failure is bounded and leaves prior usage intact', () => {
  const file = join(folder(), 'ledger.json'),
    one = budget(file, 3);
  one.take();
  const previous = readFileSync(file, 'utf8');
  let attempts = 0;
  withStorageFaults(
    {
      renameSync: (original) => (from, to) => {
        if (to === file) {
          attempts++;
          throw sharingError('EACCES');
        }
        return original(from, to);
      },
    },
    () => rejects(() => one.take(), 503),
  );
  assert.equal(attempts, 3);
  assert.equal(readFileSync(file, 'utf8'), previous);
  assert.equal(existsSync(file + '.lock'), false);
  assert.deepEqual(readdirSync(resolve(file, '..')), ['ledger.json']);
});

test('atomic replacement rechecks lock ownership after a sharing failure', () => {
  const file = join(folder(), 'ledger.json'),
    one = budget(file, 3);
  one.take();
  const previous = readFileSync(file, 'utf8');
  let attempts = 0;
  withStorageFaults(
    {
      renameSync: (original) => (from, to) => {
        if (to === file) {
          attempts++;
          writeFileSync(file + '.lock', 'foreign-owner');
          throw sharingError('EBUSY');
        }
        return original(from, to);
      },
    },
    () => rejects(() => one.take(), 503),
  );
  assert.equal(attempts, 1);
  assert.equal(readFileSync(file, 'utf8'), previous);
  assert.equal(readFileSync(file + '.lock', 'utf8'), 'foreign-owner');
});

test('permanent lock cleanup failure preserves the committed reservation and blocks subsequent spending', () => {
  const file = join(folder(), 'ledger.json'),
    one = budget(file, 3);
  let attempts = 0;
  withStorageFaults(
    {
      unlinkSync: (original) => (path) => {
        if (path === file + '.lock') {
          attempts++;
          throw sharingError('EBUSY');
        }
        return original(path);
      },
    },
    () => one.take(),
  );
  assert.equal(attempts, 3);
  assert.equal(one.snapshot().calls, 1);
  assert.equal(existsSync(file + '.lock'), true);
  rejects(() => one.take(), 503);
  assert.equal(one.snapshot().calls, 1);
});

test('independent processes cannot overspend a shared ledger under simultaneous reservations', async () => {
  const file = join(folder(), 'ledger.json'),
    limit = 20;
  const source = `import {createPersistentModelBudget} from './persistent-budget.js';
 const budget=createPersistentModelBudget({filename:process.argv[1],limit:20,clock:()=>new Date('2026-10-06T12:00:00Z')});
 process.stdout.write('ready\\n');process.stdin.once('data',()=>{let accepted=0;const denied=[];
 for(let i=0;i<50;i++)try{budget.take();accepted++;}catch(error){denied.push(error.status);}
 process.stdout.write(JSON.stringify({accepted,denied})+'\\n');process.stdin.destroy();});`;
  const workers = Array.from({ length: 2 }, () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, file], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '',
      errors = '';
    let readyResolve;
    const ready = new Promise((resolve) => {
      readyResolve = resolve;
    });
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('ready\n')) readyResolve();
    });
    child.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) =>
        code === 0
          ? resolve(JSON.parse(output.trim().split('\n').at(-1)))
          : reject(new Error(errors || `worker exited ${code}`)),
      );
    });
    return { child, ready, done };
  });
  await Promise.all(workers.map((worker) => worker.ready));
  workers.forEach((worker) => worker.child.stdin.end('start\n'));
  const results = await Promise.all(workers.map((worker) => worker.done));
  const accepted = results.reduce((sum, result) => sum + result.accepted, 0);
  assert.ok(accepted > 0 && accepted <= limit);
  assert.ok(
    results.every((result) => result.denied.every((status) => status === 429 || status === 503)),
  );
  const final = budget(file, limit);
  assert.equal(final.snapshot().calls, accepted);
  assert.equal(existsSync(file + '.lock'), false);
  for (let i = accepted; i < limit; i++) final.take();
  rejects(() => final.take(), 429);
  assert.equal(final.snapshot().calls, limit);
});
