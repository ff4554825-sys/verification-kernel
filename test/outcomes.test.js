import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendOutcome, outcomeFromVerdict, readOutcomes, summarizeOutcomes } from '../lib/outcomes.js';

const run = promisify(execFile);

function verdict(overrides = {}) {
  return {
    id: 'demo',
    status: 'pass',
    reason: 'ok',
    planHash: 'a'.repeat(64),
    durationMs: 120,
    checks: [
      { id: 'a', required: true, status: 'pass', durationMs: 40, attempts: 1 },
      { id: 'b', required: false, status: 'pass', durationMs: 60, attempts: 1 },
    ],
    ...overrides,
  };
}

test('outcome store records cost, latency, and project aggregates', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-outcomes-'));
  const store = path.join(dir, 'outcomes.jsonl');
  const first = await appendOutcome(store, outcomeFromVerdict(verdict(), { project: 'p1', artifactPath: 'C:/a' }));
  assert.equal(first.project, 'p1');
  assert.equal(first.cost.checkMs, 100);
  assert.equal(first.cost.overheadMs, 20);
  assert.match(first.evidenceHash, /^[a-f0-9]{64}$/);
  assert.equal(first.artifactPath, 'C:/a');

  const failed = outcomeFromVerdict(verdict({
    status: 'fail',
    durationMs: 80,
    checks: [
      { id: 'a', required: true, status: 'fail', durationMs: 20, attempts: 2 },
      { id: 'b', required: true, status: 'unknown', durationMs: 30, attempts: 1 },
    ],
  }), { project: 'p2' });
  await appendOutcome(store, failed);
  await fs.appendFile(store, 'not json\n');
  const records = await readOutcomes(store);
  assert.equal(records.length, 2);
  const summary = summarizeOutcomes(records);
  assert.equal(summary.total, 2);
  assert.deepEqual(summary.counts, { pass: 1, fail: 1, unknown: 0, flaky: 0 });
  assert.equal(summary.passRate, 0.5);
  assert.equal(summary.cost.retries, 1);
  assert.equal(summary.byProject.p1.total, 1);
  assert.equal(summary.byProject.p2.fail, 1);
  assert.equal(summary.latencyMs.p95, 120);

  const cli = path.resolve('bin/outcomes.js');
  const latest = path.join(dir, 'latest.json');
  await fs.writeFile(latest, JSON.stringify(verdict()), 'utf8');
  const cliStore = path.join(dir, 'cli.jsonl');
  await run(process.execPath, [cli, '--append', latest, '--store', cliStore, '--project', 'cli', '--json']);
  const report = await run(process.execPath, [cli, '--report', '--store', cliStore, '--json']);
  const payload = JSON.parse(report.stdout);
  assert.equal(payload.total, 1);
  assert.equal(payload.byProject.cli.pass, 1);
  await fs.rm(dir, { recursive: true, force: true });
});
