/** Local policy/retrieval learning: a bounded three-factor update.
 *
 * Δω = η · (tracePre · tracePost · (reward - baseline)) · (λ · ρ · σ)
 *
 * ω is a local retrieval/policy weight, NOT an LLM parameter. The update is
 * clipped and bounded; it is suitable for an auditable reranker, not training.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_PARAMS = Object.freeze({
  eta: 0.05,
  lambda: 0.95,
  rho: 1,
  sigma: 1,
  minWeight: -1,
  maxWeight: 1,
  maxStep: 0.1,
});

export function rewardFromStatus(status) {
  if (status === 'pass') return 1;
  if (status === 'fail') return -1;
  return 0; // unknown/flaky carry no learning signal
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

export function emptyPolicy() {
  return {
    version: 1,
    updatedAt: Date.now(),
    baseline: 0,
    weights: {},
    history: [],
  };
}

/** Apply the bounded three-factor rule to one key. */
export function updatePolicy(policy, feedback, params = {}) {
  if (policy === null || typeof policy !== 'object' || typeof policy.weights !== 'object') throw new Error('policy is required');
  if (feedback === null || typeof feedback !== 'object') throw new Error('feedback is required');
  if (typeof feedback.key !== 'string' || feedback.key === '') throw new Error('feedback.key is required');
  const options = { ...DEFAULT_PARAMS, ...params };
  const pre = finite(feedback.pre, 0);
  const post = finite(feedback.post, 0);
  const reward = finite(feedback.reward, 0);
  const baseline = finite(policy.baseline, 0);
  const rawDelta = options.eta * (pre * post * (reward - baseline)) * (options.lambda * options.rho * options.sigma);
  const delta = clamp(rawDelta, -options.maxStep, options.maxStep);
  const previous = finite(policy.weights[feedback.key], 0);
  const weight = clamp(previous + delta, options.minWeight, options.maxWeight);
  const next = {
    ...policy,
    version: 1,
    updatedAt: Date.now(),
    baseline: Number((baseline * 0.9 + reward * 0.1).toFixed(6)),
    weights: { ...policy.weights, [feedback.key]: Number(weight.toFixed(6)) },
    history: [
      ...(Array.isArray(policy.history) ? policy.history : []),
      {
        at: Date.now(),
        key: feedback.key,
        pre: Number(pre.toFixed(6)),
        post: Number(post.toFixed(6)),
        reward: Number(reward.toFixed(6)),
        delta: Number(delta.toFixed(6)),
        weight: Number(weight.toFixed(6)),
      },
    ].slice(-500),
  };
  return { policy: next, delta: Number(delta.toFixed(6)), weight: Number(weight.toFixed(6)), baseline: next.baseline };
}

export function policyScore(policy, keys) {
  if (policy === null || typeof policy !== 'object' || typeof policy.weights !== 'object') return 0;
  const list = Array.isArray(keys) ? keys : [keys];
  return Number(list.reduce((sum, key) => sum + finite(policy.weights[key], 0), 0).toFixed(6));
}

export async function readPolicy(file) {
  try {
    const parsed = JSON.parse(await fs.readFile(path.resolve(file), 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || typeof parsed.weights !== 'object') return emptyPolicy();
    return {
      ...emptyPolicy(),
      ...parsed,
      weights: { ...parsed.weights },
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return emptyPolicy();
  }
}

export async function writePolicy(file, policy) {
  const absolute = path.resolve(file);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(policy, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, absolute);
  return policy;
}

export function policyKeysForQuery(query) {
  const tokens = [...String(query).toLowerCase().matchAll(/[\p{L}][\p{L}\p{N}_-]+/gu)].map((match) => match[0]);
  const keys = tokens.map((token) => `term:${token}`);
  for (const match of String(query).matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu)) {
    const run = match[0];
    for (let index = 0; index + 1 < run.length; index += 1) keys.push(`term:${run.slice(index, index + 2)}`);
  }
  return [...new Set(keys)];
}
