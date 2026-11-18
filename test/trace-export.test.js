import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exportRuns, exportTraceFile, writeExport } from '../lib/trace-export.js';

const event = {
  time: '2026-10-28T00:00:00.000Z',
  id: 'demo',
  status: 'pass',
  reason: 'all required checks passed',
  durationMs: 12,
  counts: { required: 1, requiredPassed: 1 },
  checks: [{ id: 'a', status: 'pass' }],
  planHash: 'abc',
  hashes: { verdict: 'def' },
};

test('exportRuns carries verdicts, checks, hashes, and metrics', () => {
  const exported = exportRuns([event, null, 'bad'], { generatedAt: '2026-10-28T00:00:00.000Z' });
  assert.equal(exported.format, 'dsh-verification-trace');
  assert.equal(exported.runs.length, 1);
  assert.equal(exported.runs[0].id, 'demo');
  assert.equal(exported.runs[0].hashes.verdict, 'def');
  assert.equal(exported.metrics.total, 1);
  assert.equal(exported.metrics.byStatus.pass, 1);
});

test('exportTraceFile reads JSONL and writeExport writes JSON', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-trace-export-'));
  const trace = path.join(dir, 'trace.jsonl');
  await fs.writeFile(trace, `${JSON.stringify(event)}\n`, 'utf8');
  const document = await exportTraceFile(trace);
  assert.equal(document.runs.length, 1);
  const output = path.join(dir, 'export.json');
  const result = await writeExport(trace, output);
  assert.equal(result.outputPath, output);
  const written = JSON.parse(await fs.readFile(output, 'utf8'));
  assert.equal(written.runs[0].status, 'pass');
  await fs.rm(dir, { recursive: true, force: true });
});
