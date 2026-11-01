import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compareAB, pairOutcomes } from '../lib/ab.js';

const run = promisify(execFile);

const row = (task, status, durationMs = 100, costMs = 80) => ({
  task,
  project: 'p',
  status,
  durationMs,
  cost: { checkMs: costMs, overheadMs: durationMs - costMs, retries: 0 },
});

test('paired A/B reports deltas, wins/losses, and bootstrap CI', () => {
  const control = [row('a', 'pass'), row('b', 'pass'), row('c', 'fail', 200), row('d', 'unknown')];
  const treatment = [row('a', 'pass'), row('b', 'pass'), row('c', 'pass', 150), row('d', 'pass')];
  const pairs = pairOutcomes(control, treatment);
  assert.equal(pairs.length, 4);
  assert.equal(pairs.every((pair) => pair.control !== null), true);
  const report = compareAB(control, treatment, { bootstrap: 500, seed: 42 });
  assert.equal(report.paired.total, 4);
  assert.equal(report.paired.wins, 2);
  assert.equal(report.paired.losses, 0);
  assert.equal(report.paired.ties, 2);
  assert.equal(report.paired.passRateDelta, 0.5);
  assert.ok(report.paired.bootstrapMeanDelta.low <= report.paired.bootstrapMeanDelta.high);
  assert.equal(report.paired.bootstrapMeanDelta.rounds, 500);
});

test('A/B CLI reads two JSONL stores', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-ab-'));
  const control = path.join(dir, 'control.jsonl');
  const treatment = path.join(dir, 'treatment.jsonl');
  await fs.writeFile(control, [row('a', 'fail'), row('b', 'pass')].map(JSON.stringify).join('\n') + '\n', 'utf8');
  await fs.writeFile(treatment, [row('a', 'pass'), row('b', 'pass')].map(JSON.stringify).join('\n') + '\n', 'utf8');
  const result = await run(process.execPath, [path.resolve('bin/ab.js'), '--control', control, '--treatment', treatment, '--bootstrap', '100', '--json']);
  const report = JSON.parse(result.stdout);
  assert.equal(report.paired.wins, 1);
  assert.equal(report.paired.passRateDelta, 0.5);
  await fs.rm(dir, { recursive: true, force: true });
});
