import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { emptyPolicy, policyScore, readPolicy, rewardFromStatus, updatePolicy, writePolicy } from '../lib/local-learner.js';

const run = promisify(execFile);

test('three-factor local update is bounded, signed, and auditable', () => {
  const policy = emptyPolicy();
  const result = updatePolicy(policy, { key: 'term:verification', pre: 1, post: 0.5, reward: 1 }, {
    eta: 0.1, lambda: 0.9, rho: 1, sigma: 1,
  });
  assert.equal(result.delta, 0.045);
  assert.equal(result.weight, 0.045);
  assert.equal(result.policy.weights['term:verification'], 0.045);
  assert.equal(result.policy.history.length, 1);
  assert.equal(result.policy.baseline, 0.1);

  const negative = updatePolicy(policy, { key: 'term:verification', pre: 1, post: 1, reward: -1 }, {
    eta: 0.1, lambda: 0.9, rho: 1, sigma: 1,
  });
  assert.equal(negative.delta, -0.09);
  assert.equal(negative.weight, -0.09);

  const clipped = updatePolicy(policy, { key: 'x', pre: 100, post: 100, reward: 100 }, { maxStep: 0.1, maxWeight: 1 });
  assert.equal(clipped.delta, 0.1);
  assert.equal(clipped.weight, 0.1);
  assert.equal(rewardFromStatus('pass'), 1);
  assert.equal(rewardFromStatus('fail'), -1);
  assert.equal(rewardFromStatus('unknown'), 0);
  assert.equal(policyScore({ weights: { a: 0.2, b: -0.1 } }, ['a', 'b', 'missing']), 0.1);
});

test('local policy persists and CLI updates it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-local-learn-'));
  const file = path.join(dir, 'policy.json');
  const written = updatePolicy(emptyPolicy(), { key: 'term:evidence', pre: 1, post: 1, reward: 1 }).policy;
  await writePolicy(file, written);
  const loaded = await readPolicy(file);
  assert.equal(loaded.weights['term:evidence'], 0.0475);
  const result = await run(process.execPath, [
    path.resolve('bin/local-learn.js'),
    '--policy', file,
    '--key', 'term:evidence',
    '--pre', '1',
    '--post', '0.5',
    '--status', 'fail',
    '--eta', '0.1',
    '--lambda', '0.9',
    '--json',
  ]);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.reward, -1);
  assert.ok(payload.delta < 0);
  const after = await readPolicy(file);
  assert.ok(after.weights['term:evidence'] < loaded.weights['term:evidence']);
  await fs.rm(dir, { recursive: true, force: true });
});
