import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { attributeOutcome, recordRetrieval } from '../lib/feedback-loop.js';
import { readPolicy } from '../lib/local-learner.js';

test('retrieval outcomes automatically update a weak local policy once', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-feedback-'));
  await recordRetrieval({
    root,
    project: 'p',
    agentId: 'a',
    sessionId: 's',
    query: 'verification evidence',
    results: [
      { path: 'docs/a.md', score: -1 },
      { path: 'docs/b.md', score: -2 },
    ],
  });
  const passed = await attributeOutcome({ root, project: 'p', agentId: 'a', status: 'pass' });
  assert.equal(passed.updated, true);
  assert.equal(passed.attribution, 'weak-retrieval-window');
  assert.deepEqual(passed.keys, ['doc:docs/a.md', 'doc:docs/b.md']);
  let policy = await readPolicy(path.join(root, '.dsh', 'learning', 'retrieval-policy.json'));
  assert.ok(policy.weights['doc:docs/a.md'] > 0);
  assert.ok(policy.weights['doc:docs/a.md'] > policy.weights['doc:docs/b.md']);
  const duplicate = await attributeOutcome({ root, project: 'p', agentId: 'a', status: 'pass' });
  assert.equal(duplicate.updated, false);

  const beforeFail = policy.weights['doc:docs/a.md'];
  await recordRetrieval({
    root,
    project: 'p',
    agentId: 'a',
    query: 'fail path',
    results: [{ path: 'docs/a.md', score: -1 }],
  });
  const failed = await attributeOutcome({ root, project: 'p', agentId: 'a', status: 'fail' });
  assert.equal(failed.updated, true);
  policy = await readPolicy(path.join(root, '.dsh', 'learning', 'retrieval-policy.json'));
  assert.ok(policy.weights['doc:docs/a.md'] < beforeFail);
  const attribution = await fs.readFile(path.join(root, '.dsh', 'learning', 'attributions.jsonl'), 'utf8');
  assert.match(attribution, /weak-retrieval-window/);
  await fs.rm(root, { recursive: true, force: true });
});

test('unknown outcomes and expired retrievals do not train', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-feedback-skip-'));
  await recordRetrieval({ root, project: 'p', agentId: 'a', query: 'q', results: [{ path: 'docs/a.md' }], now: 1_000 });
  const unknown = await attributeOutcome({ root, project: 'p', agentId: 'a', status: 'unknown', now: 2_000 });
  assert.equal(unknown.updated, false);
  const expired = await attributeOutcome({ root, project: 'p', agentId: 'a', status: 'pass', now: 10_000_000, windowMs: 1000 });
  assert.equal(expired.updated, false);
  await fs.rm(root, { recursive: true, force: true });
});
