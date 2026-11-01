import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { summarizeEvents, summarizeTrace, readTrace, formatSummary } from '../lib/report.js';

const event = (status, durationMs, overrides = {}) => ({
  id: 'demo',
  status,
  reason: status,
  durationMs,
  checks: [{ id: 'a', status }],
  ...overrides,
});

test('summarizeEvents counts verdicts, flaky checks, overrides, and latency', () => {
  const summary = summarizeEvents([
    event('pass', 10),
    event('fail', 20),
    event('unknown', 30),
    event('flaky', 40, { checks: [{ id: 'a', status: 'flaky' }] }),
    event('pass', 50, { override: { reason: 'approved' } }),
    null,
    'not-an-object',
  ]);
  assert.equal(summary.total, 5);
  assert.deepEqual(summary.byStatus, { pass: 2, fail: 1, unknown: 1, flaky: 1, other: 0 });
  assert.equal(summary.checkRuns, 5);
  assert.equal(summary.flakyChecks, 1);
  assert.equal(summary.overrides, 1);
  assert.equal(summary.durationMs.max, 50);
  assert.equal(summary.durationMs.p50, 30);
  assert.equal(summary.passRate, 0.4);
});

test('readTrace ignores corrupt lines and summarizeTrace reads a file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-vk-trace-'));
  const trace = path.join(dir, 'trace.jsonl');
  await fs.writeFile(trace, `${JSON.stringify(event('pass', 5))}\nnot json\n${JSON.stringify(event('fail', 7))}\n`, 'utf8');
  const events = await readTrace(trace);
  assert.equal(events.length, 2);
  const summary = await summarizeTrace(trace);
  assert.equal(summary.total, 2);
  assert.match(formatSummary(summary), /Verifier runs: 2/);
  assert.match(formatSummary(summary), /pass 1/);
  await fs.rm(dir, { recursive: true, force: true });
});
