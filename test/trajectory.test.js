import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { readSessionEvents } from '../lib/session-log.js';
import { analyzeTrajectory, formatCritic } from '../lib/trajectory.js';

const call = (callId, name, args) => ({
  type: 'tool/call',
  data: { callId, name, arguments: JSON.stringify(args) },
});
const result = (callId, text) => ({
  type: 'tool/result',
  data: { message: { toolCallId: callId, content: [{ type: 'text', text }] } },
});

test('analyzeTrajectory flags repeats, failures, and repeats after failure', () => {
  const events = [
    { type: 'step/end' },
    call('1', 'read', { file_path: 'a.js' }),
    result('1', 'Error: permission denied'),
    call('2', 'read', { file_path: 'a.js' }),
    result('2', 'ok'),
    call('3', 'read', { file_path: 'a.js' }),
    result('3', 'ok'),
    { type: 'assistant/message', data: { message: { content: [] } } },
  ];
  const report = analyzeTrajectory(events);
  assert.equal(report.metrics.toolCalls, 3);
  assert.equal(report.metrics.uniqueCalls, 1);
  assert.equal(report.metrics.repeatedCalls, 2);
  assert.equal(report.metrics.failedResults, 1);
  assert.equal(report.metrics.repeatedAfterFailure, 2);
  assert.equal(report.severity, 'warn');
  assert.ok(report.reasons.some((reason) => reason.includes('repeated')));
  assert.match(formatCritic(report), /Advisory only/);
});

test('readSessionEvents reads concatenated zstd frames', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-session-log-'));
  const file = path.join(dir, 'session.v4.jsonl.zstd');
  const first = Buffer.from(`${JSON.stringify({ type: 'tool/call', data: { name: 'read', arguments: '{}' } })}\n`);
  const second = Buffer.from(`${JSON.stringify({ type: 'tool/result', data: { message: { content: [] } } })}\n`);
  await fs.writeFile(file, Buffer.concat([zlib.zstdCompressSync(first), zlib.zstdCompressSync(second)]));
  const events = await readSessionEvents(file);
  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'tool/call');
  await fs.rm(dir, { recursive: true, force: true });
});
