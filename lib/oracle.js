/**
 * Relational oracles: judge a plan by how its results relate across runs,
 * instead of against a hand-written expected answer.
 *
 * This is the SQLancer idea (TLP, NoREC, PQS) moved to a verification plan. A
 * check that passes for the wrong reason is invisible to a pass/fail oracle;
 * it is visible the moment you require two runs to agree, or require the
 * verdict to be unchanged when nothing relevant changed.
 *
 * Every function returns a verdict-shaped object so the existing gate,
 * artifacts, and outcome store can consume it unchanged.
 */

import { normalizePlan, runPlan } from './kernel.js';

export const RELATION = Object.freeze({
  DETERMINISM: 'determinism',
  INVARIANCE: 'invariance',
  DECOMPOSITION: 'decomposition',
});

function makeVerdict(relation, status, reason, details) {
  return {
    version: 1,
    id: `oracle-${relation}`,
    status,
    reason,
    relation,
    details,
    startedAt: 0,
    finishedAt: 0,
    durationMs: 0,
    checks: [],
    counts: { required: 0, requiredPassed: 0, requiredFailed: 0, requiredUnknown: 0, optional: 0, optionalFailed: 0 },
  };
}

function statusMap(verdict) {
  return new Map((verdict.checks ?? []).map((check) => [check.id, check.status]));
}

function normalizeOrThrow(plan) {
  const { plan: normalized, errors } = normalizePlan(plan);
  if (normalized === null) throw new Error(`invalid plan: ${errors.join('; ')}`);
  return normalized;
}

/**
 * The same plan and the same input must produce the same per-check status.
 * @param options - `{ plan, cwd, runCommand, runs }`.
 */
export async function checkDeterminism(options = {}) {
  const plan = normalizeOrThrow(options.plan);
  const runs = Number.isInteger(options.runs) && options.runs >= 2 ? options.runs : 3;
  const observed = [];
  for (let index = 0; index < runs; index += 1) {
    const verdict = await runPlan(plan, { cwd: options.cwd, runCommand: options.runCommand });
    observed.push({ status: verdict.status, checks: statusMap(verdict) });
  }
  const baseline = observed[0];
  const diverged = new Set();
  for (const run of observed.slice(1)) {
    if (run.status !== baseline.status) diverged.add('<verdict>');
    for (const [id, status] of run.checks) {
      if (baseline.checks.get(id) !== status) diverged.add(id);
    }
  }
  const details = { runs, observed: observed.map((run) => ({ status: run.status, checks: Object.fromEntries(run.checks) })) };
  if (diverged.size === 0) {
    return makeVerdict(RELATION.DETERMINISM, 'pass', `${runs} runs agreed`, details);
  }
  return makeVerdict(
    RELATION.DETERMINISM,
    'fail',
    `results diverged across runs: ${[...diverged].join(', ')}`,
    { ...details, diverged: [...diverged].sort() },
  );
}

/** Ambient state that must not change a verdict. */
const DEFAULT_VARIANTS = [
  { label: 'TZ=UTC', env: { TZ: 'UTC' } },
  { label: 'TZ=Pacific/Kiritimati', env: { TZ: 'Pacific/Kiritimati' } },
];

/**
 * Run an async body with `env` applied, restoring afterwards.
 *
 * The body must be awaited inside the window: returning the promise from a
 * `try/finally` restores the environment at the first `await` boundary, so
 * every check after the first would observe the ambient value instead of the
 * variant. That turns the invariance oracle into a false-negative machine.
 */
async function withEnv(env, body) {
  const saved = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return await body();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/**
 * The verdict must not depend on ambient state that has nothing to do with the
 * task. Each variant runs the plan under a different environment.
 * @param options - `{ plan, cwd, runCommand, variants }`.
 */
export async function checkInvariance(options = {}) {
  const plan = normalizeOrThrow(options.plan);
  const variants = Array.isArray(options.variants) && options.variants.length > 0 ? options.variants : DEFAULT_VARIANTS;
  const observed = [];
  for (const variant of variants) {
    const verdict = await withEnv(variant.env ?? {}, () => runPlan(plan, { cwd: options.cwd, runCommand: options.runCommand }));
    observed.push({ label: variant.label, status: verdict.status, checks: Object.fromEntries(statusMap(verdict)) });
  }
  const baseline = observed[0];
  const divergent = observed.filter((run) => run.status !== baseline.status).map((run) => run.label);
  const details = { variants: observed };
  if (divergent.length === 0) {
    return makeVerdict(RELATION.INVARIANCE, 'pass', `verdict held across ${observed.length} environments`, details);
  }
  return makeVerdict(
    RELATION.INVARIANCE,
    'fail',
    `verdict depends on ambient state: ${divergent.join(', ')}`,
    { ...details, divergent },
  );
}

/** Combine sub-statuses the way the kernel combines required checks. */
function conjunction(statuses) {
  if (statuses.length === 0) return 'unknown';
  if (statuses.includes('fail')) return 'fail';
  if (statuses.every((status) => status === 'pass')) return 'pass';
  return 'unknown';
}

/**
 * A check that declares `composedOf: [id, ...]` must agree with the
 * conjunction of its parts. Catches a composite check that reports pass while
 * one of its own parts failed.
 * @param options - `{ plan, cwd, runCommand }`.
 */
export async function checkDecomposition(options = {}) {
  const raw = options.plan;
  const plan = normalizeOrThrow(raw);
  const verdict = await runPlan(plan, { cwd: options.cwd, runCommand: options.runCommand });
  const statuses = statusMap(verdict);
  const rawChecks = Array.isArray(raw?.checks) ? raw.checks : [];
  const composites = rawChecks.filter((check) => Array.isArray(check?.composedOf) && check.composedOf.length > 0);
  const details = {
    composites: composites.map((check) => ({
      id: check.id,
      composedOf: check.composedOf,
      observed: statuses.get(check.id) ?? 'missing',
      expected: conjunction(check.composedOf.map((id) => statuses.get(id) ?? 'unknown')),
    })),
  };
  if (composites.length === 0) {
    return makeVerdict(RELATION.DECOMPOSITION, 'unknown', 'no check declared composedOf', details);
  }
  const broken = details.composites.filter((entry) => entry.observed !== entry.expected);
  if (broken.length === 0) {
    return makeVerdict(RELATION.DECOMPOSITION, 'pass', `${composites.length} composite checks agreed with their parts`, details);
  }
  return makeVerdict(
    RELATION.DECOMPOSITION,
    'fail',
    `composite checks contradict their parts: ${broken.map((entry) => entry.id).join(', ')}`,
    { ...details, broken },
  );
}
