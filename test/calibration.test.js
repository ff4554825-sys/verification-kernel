import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { calibrateOutcomes } from '../lib/calibration.js';

const run = promisify(execFile);

function record(project, status, checksDetail, durationMs = 100) {
  return { project, status, durationMs, checksDetail };
}

test('calibration identifies stable, flaky, slow, and unknown checks', () => {
  const records = [];
  for (let i = 0; i < 6; i += 1) {
    records.push(record('p', i === 0 ? 'fail' : 'pass', [
      { id: 'stable', required: true, status: 'pass', durationMs: 10, attempts: 1 },
      { id: 'flaky', required: true, status: i < 2 ? 'flaky' : 'pass', durationMs: 20, attempts: 2 },
      { id: 'slow', required: true, status: 'pass', durationMs: 90_000, attempts: 1 },
    ], 1000));
  }
  for (let i = 0; i < 3; i += 1) {
    records.push(record('p', 'unknown', [
      { id: 'stable', required: true, status: 'pass', durationMs: 10, attempts: 1 },
      { id: 'missing', required: true, status: 'unknown', durationMs: 10, attempts: 1 },
    ], 1000));
  }
  const report = calibrateOutcomes(records, { minRuns: 3, fastP95Ms: 5_000, slowP95Ms: 60_000 });
  assert.equal(report.totalRecords, 9);
  assert.equal(report.recordsWithCheckDetails, 9);
  assert.equal(report.projects.p.checks.stable.fail, 0);
  assert.equal(report.projects.p.checks.flaky.flaky, 2);
  assert.ok(report.recommendations.some((item) => item.type === 'stabilize' && item.check === 'flaky'));
  assert.ok(report.recommendations.some((item) => item.type === 'slow-check' && item.check === 'slow'));
  assert.ok(report.recommendations.some((item) => item.type === 'investigate-unknown' && item.check === 'missing'));
  assert.ok(report.recommendations.some((item) => item.type === 'fast-candidate' && item.check === 'stable'));
});

test('calibrate CLI writes an advisory report', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-calibrate-'));
  const store = path.join(dir, 'outcomes.jsonl');
  const out = path.join(dir, 'calibration.json');
  const lines = Array.from({ length: 5 }, () => JSON.stringify(record('p', 'pass', [
    { id: 'stable', required: true, status: 'pass', durationMs: 5, attempts: 1 },
  ]))).join('\n');
  await fs.writeFile(store, `${lines}\n`, 'utf8');
  const result = await run(process.execPath, [path.resolve('bin/calibrate.js'), '--store', store, '--out', out, '--min-runs', '3', '--json']);
  const report = JSON.parse(result.stdout);
  assert.equal(report.projects.p.checks.stable.runs, 5);
  assert.ok(report.recommendations.some((item) => item.type === 'fast-candidate'));
  const written = JSON.parse(await fs.readFile(out, 'utf8'));
  assert.equal(written.projects.p.runs, 5);
  await fs.rm(dir, { recursive: true, force: true });
});
