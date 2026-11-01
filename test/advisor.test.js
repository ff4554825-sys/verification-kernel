import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { adviseVerdict, heuristicAdvice } from '../lib/advisor.js';

const verdict = {
  id: 'v1',
  status: 'pass',
  reason: 'all required checks passed',
  counts: { pass: 1, fail: 0, unknown: 0 },
  checks: [{ id: 'unit', required: true, status: 'pass', exitCode: 0 }],
};

test('L1 heuristic advisor is advisory and verdict-preserving', () => {
  const pass = heuristicAdvice(verdict);
  assert.equal(pass.score, 0.95);
  assert.equal(pass.risk, 'low');
  const fail = heuristicAdvice({ ...verdict, status: 'fail', checks: [{ id: 'unit', required: true, status: 'fail', error: { message: 'boom' } }] });
  assert.equal(fail.score, 0.15);
  assert.equal(fail.risk, 'high');
  assert.match(fail.issues[0], /unit: fail/);
});

test('L1 external critic adapter receives JSON and returns advisory JSON', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-advisor-'));
  const script = path.join(dir, 'critic.mjs');
  await fs.writeFile(script, [
    'let data = "";',
    'process.stdin.on("data", (chunk) => data += chunk);',
    'process.stdin.on("end", () => {',
    '  const input = JSON.parse(data);',
    '  process.stdout.write(JSON.stringify({ score: 0.7, risk: "medium", issues: [input.verdict.status], summary: "external" }));',
    '});',
  ].join('\n'), 'utf8');
  const advice = await adviseVerdict(verdict, { command: [process.execPath, script], cwd: dir });
  assert.equal(advice.source, 'external');
  assert.equal(advice.score, 0.7);
  assert.deepEqual(advice.issues, ['pass']);
  await fs.rm(dir, { recursive: true, force: true });
});

test('L1 invalid external critic falls back to heuristic advice', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-advisor-bad-'));
  const script = path.join(dir, 'bad.mjs');
  await fs.writeFile(script, 'process.stdout.write("not json");\n', 'utf8');
  const advice = await adviseVerdict(verdict, { command: [process.execPath, script], cwd: dir });
  assert.equal(advice.source, 'heuristic-fallback');
  assert.equal(advice.score, 0.95);
  assert.match(advice.error, /invalid advisor JSON/);
  await fs.rm(dir, { recursive: true, force: true });
});
