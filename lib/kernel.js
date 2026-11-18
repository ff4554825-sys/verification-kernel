/**
 * Host-agnostic verification kernel.
 *
 * A plan is a list of deterministic checks. A check is an argv array (never a
 * shell string), an optional relative cwd, a timeout, and whether it is
 * required. Running a plan produces an evidence-bearing verdict that a gate
 * can act on. Nothing in this module knows about DSH, React, or a specific
 * model; adapters supply `runCommand`.
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { redactSensitive } from './redact.js';

export const VERDICT_VERSION = 1;
export const DEFAULT_TIMEOUT_MS = 60_000;
export const MAX_CAPTURE_CHARS = 200_000;

/**
 * Exit code a check uses to say "I cannot decide this; a person has to".
 * Distinct from a failure (the check ran and the answer was no) and from
 * `unknown` (the check could not run at all). Claude Code has the same third
 * state on the tool boundary as `ask`; this is it at the check boundary.
 *
 * 78 is sysexits EX_CONFIG, chosen because low codes are already taken in the
 * wild: the golden benchmark's own `nonzero` probe exits 3 and means "plain
 * failure", and reserving 3 would have silently reinterpreted it. Overloading a
 * common exit code is how a verification change breaks somebody else's check.
 */
export const ASK_EXIT_CODE = 78;
export const VERDICT_SCHEMA = 2;

/**
 * Why a check produced `unknown`. `unknown` is one status but several very
 * different situations: a missing tool cannot be fixed by retrying, a hung
 * check can. Recording the reason lets the gate treat them differently.
 */
export const UNKNOWN_REASON = Object.freeze({
  TIMEOUT: 'timeout',
  SPAWN: 'spawn',
  ABORTED: 'aborted',
  INVALID_CWD: 'invalid-cwd',
  NO_REQUIRED_CHECKS: 'no-required-checks',
  ENV_MISSING: 'env-missing',
  POLICY: 'policy',
});

/**
 * What the gate does with an unverifiable turn, per reason.
 * `allow` closes the turn but keeps the `unknown` verdict on record;
 * `steer` sends the evidence back and spends a feedback attempt.
 */
export const UNKNOWN_REASON_GATE = Object.freeze({
  [UNKNOWN_REASON.TIMEOUT]: 'steer',
  // A spawn failure is environmental: the runner could not start the check at
  // all (missing interpreter, EACCES, a broken sandbox). Retrying inside the
  // same turn almost never fixes that, and it burns a feedback attempt that a
  // real failure would need. `env-missing` is the same situation with a clearer
  // cause, and both stay on record as `unknown`.
  [UNKNOWN_REASON.SPAWN]: 'allow',
  [UNKNOWN_REASON.INVALID_CWD]: 'steer',
  [UNKNOWN_REASON.ENV_MISSING]: 'allow',
  [UNKNOWN_REASON.ABORTED]: 'allow',
  [UNKNOWN_REASON.NO_REQUIRED_CHECKS]: 'allow',
  [UNKNOWN_REASON.POLICY]: 'allow',
});

const UNKNOWN_REASONS = new Set(Object.values(UNKNOWN_REASON));

/**
 * Classify an `unknown` check result.
 * @param result - runner output `{ exitCode, error, timedOut }`.
 * @returns a member of UNKNOWN_REASON.
 */
export function classifyUnknown(result) {
  if (result?.timedOut === true) return UNKNOWN_REASON.TIMEOUT;
  if (result?.error != null) {
    const code = typeof result.error.code === 'string' ? result.error.code : '';
    const name = typeof result.error.name === 'string' ? result.error.name : '';
    if (code === 'ENOENT' || name === 'ENOENT') return UNKNOWN_REASON.ENV_MISSING;
    return UNKNOWN_REASON.SPAWN;
  }
  return UNKNOWN_REASON.SPAWN;
}

/** Sum unknown reasons across the required checks of a verdict. */
export function unknownReasonCounts(checks) {
  const counts = {};
  for (const check of Array.isArray(checks) ? checks : []) {
    if (check?.status !== 'unknown' || check.required !== true) continue;
    const reason = UNKNOWN_REASONS.has(check.reason) ? check.reason : UNKNOWN_REASON.SPAWN;
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
}


/** Stable SHA-256 of a string or JSON-serializable value. */
export function hashValue(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha256').update(text).digest('hex');
}

/** Hash a normalized plan, including its checks and options. */
export function planHash(plan) {
  return hashValue({
    id: plan?.id,
    ...(plan?.title === undefined ? {} : { title: plan.title }),
    checks: Array.isArray(plan?.checks) ? plan.checks : [],
  });
}

/** Return the last `maxChars` characters, marking anything omitted. */
export function tailText(value, maxChars = MAX_CAPTURE_CHARS) {
  const text = typeof value === 'string' ? value : '';
  if (text.length <= maxChars) return text;
  return `…[${text.length - maxChars} chars omitted]\n${text.slice(-maxChars)}`;
}

/** Resolve `target` under `base`, refusing escapes. */
export function resolveInside(base, target) {
  const root = path.resolve(base);
  const resolved = path.resolve(root, target);
  const relative = path.relative(root, resolved);
  if (relative !== '' && (relative.startsWith('..') || path.isAbsolute(relative))) {
    throw new Error(`path escapes its base: ${target}`);
  }
  return resolved;
}

/** Whether `target` is `root` or lies below it (case-insensitive on Windows). */
export function isInside(root, target) {
  if (typeof root !== 'string' || typeof target !== 'string' || root === '' || target === '') return false;
  const normalize = process.platform === 'win32'
    ? (value) => path.resolve(value).toLowerCase()
    : (value) => path.resolve(value);
  const base = normalize(root);
  const candidate = normalize(target);
  const relative = path.relative(base, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Validate one check object.
 * @param raw - untrusted check value.
 * @param index - position for diagnostics and default id.
 * @param errors - collector for validation messages.
 * @returns a normalized check, or null when invalid.
 */
export function normalizeCheck(raw, index, errors = []) {
  const prefix = `checks[${index}]`;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(`${prefix} must be an object`);
    return null;
  }
  const id = typeof raw.id === 'string' && raw.id.trim() !== '' ? raw.id.trim() : `check-${index + 1}`;
  const argv = Array.isArray(raw.argv)
    && raw.argv.length > 0
    && raw.argv.every((part) => typeof part === 'string' && part !== '')
    ? [...raw.argv]
    : null;
  if (argv === null) errors.push(`${prefix}.argv must be a non-empty array of non-empty strings`);
  const timeoutMs = raw.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : raw.timeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) errors.push(`${prefix}.timeoutMs must be a positive integer`);
  const required = raw.required === undefined ? true : raw.required;
  if (typeof required !== 'boolean') errors.push(`${prefix}.required must be a boolean`);
  const cwd = raw.cwd === undefined ? undefined : raw.cwd;
  if (cwd !== undefined && (typeof cwd !== 'string' || cwd === '')) errors.push(`${prefix}.cwd must be a non-empty string`);
  const retries = raw.retries === undefined ? 0 : raw.retries;
  if (!Number.isInteger(retries) || retries < 0 || retries > 5) errors.push(`${prefix}.retries must be an integer between 0 and 5`);
  if (argv === null || !Number.isInteger(timeoutMs) || timeoutMs <= 0 || typeof required !== 'boolean' || (cwd !== undefined && (typeof cwd !== 'string' || cwd === '')) || !Number.isInteger(retries) || retries < 0 || retries > 5) {
    return null;
  }
  return {
    id,
    argv,
    timeoutMs,
    required,
    retries,
    ...(cwd === undefined ? {} : { cwd }),
    ...(typeof raw.title === 'string' && raw.title !== '' ? { title: raw.title } : {}),
  };
}

/**
 * Validate a plan.
 * @param input - untrusted plan value.
 * @returns `{ plan, errors }`; `plan` is null when any error exists.
 */
export function normalizePlan(input) {
  const errors = [];
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { plan: null, errors: ['plan must be an object'] };
  }
  const id = typeof input.id === 'string' && input.id.trim() !== '' ? input.id.trim() : 'verification';
  if (!Array.isArray(input.checks)) errors.push('plan.checks must be an array');
  const checks = [];
  for (const [index, raw] of (Array.isArray(input.checks) ? input.checks : []).entries()) {
    const check = normalizeCheck(raw, index, errors);
    if (check !== null) checks.push(check);
  }
  if (errors.length === 0 && checks.length === 0) errors.push('plan has no checks');
  if (errors.length > 0) return { plan: null, errors };
  return {
    plan: {
      id,
      ...(typeof input.title === 'string' && input.title !== '' ? { title: input.title } : {}),
      checks,
    },
    errors: [],
  };
}

function abortEvidence(check) {
  return {
    id: check.id,
    required: check.required,
    status: 'unknown',
    reason: UNKNOWN_REASON.ABORTED,
    exitCode: null,
    signal: null,
    timedOut: false,
    durationMs: 0,
    stdout: '',
    stderr: '',
    cwd: '',
    error: { name: 'AbortError', message: 'the turn was cancelled before the check ran' },
  };
}

export function evidenceFromResult(check, result, cwd, now, startedAt) {
  const timedOut = result?.timedOut === true;
  const error = result?.error ?? null;
  const exitCode = typeof result?.exitCode === 'number' && Number.isInteger(result.exitCode) ? result.exitCode : null;
  const status = timedOut || error !== null
    ? 'unknown'
    : exitCode === null
      ? 'unknown'
      : exitCode === 0
        ? 'pass'
        : exitCode === ASK_EXIT_CODE
          ? 'ask'
          : 'fail';
  return {
    id: check.id,
    required: check.required,
    status,
    ...(status === 'unknown' ? { reason: classifyUnknown(result) } : {}),
    exitCode,
    signal: typeof result?.signal === 'string' ? result.signal : null,
    timedOut,
    durationMs: Number.isFinite(result?.durationMs) ? Math.max(0, result.durationMs) : Math.max(0, now() - startedAt),
    stdout: tailText(redactSensitive(result?.stdout ?? ''), MAX_CAPTURE_CHARS),
    stderr: tailText(redactSensitive(result?.stderr ?? ''), MAX_CAPTURE_CHARS),
    cwd,
    error: error === null
      ? null
      : {
          name: typeof error.name === 'string' ? error.name : 'Error',
          message: redactSensitive(typeof error.message === 'string' ? error.message : String(error)),
        },
    ...(Array.isArray(result?.spillPaths) && result.spillPaths.length > 0
      ? { spillPaths: result.spillPaths.filter((value) => typeof value === 'string') }
      : {}),
  };
}

function summarize(planMeta, checks, cwd, startedAt, finishedAt, coverage = null) {
  const required = checks.filter((check) => check.required);
  const optional = checks.filter((check) => !check.required);
  const passed = required.filter((check) => check.status === 'pass');
  const failed = required.filter((check) => check.status === 'fail');
  const flaky = required.filter((check) => check.status === 'flaky');
  const ask = required.filter((check) => check.status === 'ask');
  const unknown = required.filter((check) => check.status === 'unknown');
  let status;
  let reason;
  if (required.length === 0) {
    status = 'unknown';
    reason = 'no required checks were configured';
  } else if (failed.length > 0) {
    status = 'fail';
    reason = `${failed.length} required check${failed.length === 1 ? '' : 's'} failed`;
  } else if (ask.length > 0) {
    status = 'ask';
    reason = `${ask.length} required check${ask.length === 1 ? ' needs' : 's need'} a human decision`;
  } else if (flaky.length > 0) {
    status = 'flaky';
    reason = `${flaky.length} required check${flaky.length === 1 ? ' is' : 's are'} flaky`;
  } else if (unknown.length > 0) {
    status = 'unknown';
    reason = `${unknown.length} required check${unknown.length === 1 ? '' : 's'} could not be verified`;
  } else {
    status = 'pass';
    reason = 'all required checks passed';
  }
  const unknownReasons = unknownReasonCounts(checks);
  if (required.length === 0) unknownReasons[UNKNOWN_REASON.NO_REQUIRED_CHECKS] = 1;
  return {
    version: VERDICT_VERSION,
    schema: VERDICT_SCHEMA,
    id: planMeta.id,
    planHash: planMeta.planHash ?? '',
    ...(planMeta.title === undefined ? {} : { title: planMeta.title }),
    status,
    reason,
    summary: checks.map((check) => `${check.id}:${check.status}`).join(' '),
    unknownReasons,
    cwd,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt - startedAt),
    checks,
    // Every "this did not get checked" decision is recorded here, so a partial
    // run can never be mistaken for a full one.
    coverage: coverage ?? {
      planned: checks.length,
      ran: checks.length,
      skipped: [],
      optionalFailed: [],
      optionalAsk: [],
      optionalUnknown: [],
      partial: false,
    },
    counts: {
      required: required.length,
      requiredPassed: passed.length,
      requiredFailed: failed.length,
      requiredFlaky: flaky.length,
      requiredAsk: ask.length,
      requiredUnknown: unknown.length,
      requiredUnknownByReason: unknownReasons,
      optional: optional.length,
      optionalFailed: optional.filter((check) => check.status === 'fail').length,
      optionalFlaky: optional.filter((check) => check.status === 'flaky').length,
    },
  };
}

/**
 * Run a normalized plan.
 * @param plan - output of normalizePlan().plan.
 * @param options - `{ cwd, runCommand, signal?, selectedCheckIds?, now? }`.
 * @returns an evidence-bearing verdict.
 */
export async function runPlan(plan, options = {}) {
  const cwd = typeof options.cwd === 'string' && options.cwd !== '' ? options.cwd : process.cwd();
  const runCommand = options.runCommand;
  if (typeof runCommand !== 'function') throw new TypeError('runPlan requires a runCommand function');
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const signal = options.signal;
  const selected = Array.isArray(options.selectedCheckIds) && options.selectedCheckIds.length > 0
    ? new Set(options.selectedCheckIds)
    : null;
  const checks = [];
  const startedAt = now();
  if (plan === null || typeof plan !== 'object' || !Array.isArray(plan.checks) || plan.checks.length === 0) {
    const id = plan !== null && typeof plan === 'object' && typeof plan.id === 'string' && plan.id !== '' ? plan.id : 'verification';
    return summarize({ id, planHash: '' }, checks, cwd, startedAt, now());
  }
  const skipped = [];
  const optionalIds = (statuses) => checks
    .filter((check) => check.required === false && statuses.includes(check.status))
    .map((check) => check.id);
  const selectionReason = typeof options.selectionReason === 'string' && options.selectionReason !== ''
    ? options.selectionReason
    : 'selected-check-ids';
  for (const check of plan.checks) {
    if (selected !== null && !selected.has(check.id)) {
      skipped.push({ id: check.id, required: check.required, reason: selectionReason });
      continue;
    }
    let checkCwd;
    try {
      checkCwd = check.cwd === undefined ? path.resolve(cwd) : resolveInside(cwd, check.cwd);
    } catch (error) {
      checks.push({
        id: check.id,
        required: check.required,
        status: 'unknown',
        reason: UNKNOWN_REASON.INVALID_CWD,
        exitCode: null,
        signal: null,
        timedOut: false,
        durationMs: 0,
        stdout: '',
        stderr: '',
        cwd: '',
        error: { name: 'InvalidCwd', message: error instanceof Error ? error.message : String(error) },
      });
      continue;
    }

    const attemptStatuses = [];
    const attemptDurations = [];
    let lastEvidence = null;
    const attempts = 1 + (check.retries ?? 0);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (signal?.aborted === true) {
        lastEvidence = abortEvidence(check);
        attemptStatuses.push(lastEvidence.status);
        attemptDurations.push(lastEvidence.durationMs);
        break;
      }
      const checkStartedAt = now();
      let result;
      try {
        result = await runCommand(check, {
          cwd: checkCwd,
          signal,
          timeoutMs: check.timeoutMs,
          attempt,
          planId: plan.id,
        });
      } catch (error) {
        result = {
          exitCode: null,
          signal: null,
          stdout: '',
          stderr: '',
          durationMs: now() - checkStartedAt,
          timedOut: false,
          error: { name: error?.name ?? 'Error', message: error?.message ?? String(error) },
        };
      }
      lastEvidence = evidenceFromResult(check, result, checkCwd, now, checkStartedAt);
      attemptStatuses.push(lastEvidence.status);
      attemptDurations.push(lastEvidence.durationMs);
      if (lastEvidence.status === 'pass') break;
    }

    const passedAt = attemptStatuses.indexOf('pass');
    let status;
    if (passedAt === 0) status = 'pass';
    else if (passedAt > 0) status = 'flaky';
    else if (attemptStatuses.includes('fail')) status = 'fail';
    // A check may answer "ask" on the first attempt and "pass" on a retry the
    // human green-lit; until then it stays an ask, not an unknown.
    else if (attemptStatuses.includes('ask')) status = 'ask';
    else status = 'unknown';
    const evidence = lastEvidence ?? abortEvidence(check, now(), now);
    checks.push({
      ...evidence,
      status,
      attempts: attemptStatuses.length,
      attemptStatuses,
      attemptDurations,
      retries: check.retries ?? 0,
      ...(status === 'flaky' ? { flaky: true } : {}),
    });
  }
  const coverage = {
    planned: plan.checks.length,
    ran: checks.length,
    skipped,
    // Optional checks never decide the verdict, so what they said has to be
    // readable: a failed optional check and one waiting for a human are
    // different situations and used to land in the same list.
    optionalFailed: optionalIds(['fail', 'flaky']),
    optionalAsk: optionalIds(['ask']),
    optionalUnknown: optionalIds(['unknown']),
    partial: skipped.some((entry) => entry.required === true),
  };
  return summarize({ id: plan.id, ...(plan.title === undefined ? {} : { title: plan.title }), planHash: planHash(plan) }, checks, cwd, startedAt, now(), coverage);
}

export function clampText(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[truncated]`;
}

function indentLines(text, limit) {
  const lines = text.split(/\r?\n/).filter((line) => line !== '');
  return lines.slice(-limit).map((line) => `  | ${line}`);
}

/**
 * Keep the part of a test log that says what failed.
 *
 * Taking the last N lines keeps the wrong end of a failure block: the reporter
 * puts `✖ name` and the assertion message first, then ten lines of stack. With
 * several failures the tail is pure stack, so the feedback names no test and no
 * reason — measured on a real regression, not assumed.
 *
 * Failure markers are collected with the first non-stack line after each, and
 * the raw tail is used only when the log has no markers at all.
 */
export function failureHighlights(text, limit = 12) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!/^(\s*)(✖|not ok|AssertionError|Error:)/m.test(text)) return lines.slice(-limit);
  const picked = [];
  const seen = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^\s*(✖|not ok|AssertionError|Error:)/.test(line)) continue;
    const trimmed = line.trimEnd();
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    picked.push(trimmed);
    for (let next = index + 1; next < Math.min(index + 8, lines.length); next += 1) {
      const candidate = lines[next];
      if (/^\s+at /.test(candidate) || /^\s*\}?\s*$/.test(candidate)) continue;
      const detail = candidate.trimEnd();
      if (!seen.has(detail)) {
        seen.add(detail);
        picked.push(detail);
      }
      break;
    }
    if (picked.length >= limit) break;
  }
  return picked.slice(0, limit);
}

/**
 * Build model-facing feedback for a failed or unverifiable verdict.
 * @param verdict - runPlan result.
 * @param options - `{ artifactPath?, maxChars? }`.
 */
export function formatFeedback(verdict, options = {}) {
  const maxChars = Number.isInteger(options.maxChars) && options.maxChars > 0 ? options.maxChars : 4_000;
  const lines = [];
  const coverage = describeCoverage(verdict.coverage);
  if (verdict.status === 'pass') {
    lines.push(coverage === '' ? 'Verification passed.' : `Verification passed for the checks that ran. ${coverage}.`);
  } else if (verdict.status === 'ask') {
    lines.push(`Verification needs a human decision: ${verdict.reason}.`);
  } else if (verdict.status === 'unknown' || verdict.status === 'flaky') {
    const reasons = verdict.unknownReasons === undefined
      ? ''
      : Object.entries(verdict.unknownReasons).map(([key, count]) => `${key}×${count}`).join(', ');
    lines.push(`Verification could not be completed: ${verdict.reason}${reasons === '' ? '' : ` (${reasons})`}.`);
  } else {
    lines.push(`Verification failed: ${verdict.reason}.`);
  }
  const relevant = verdict.checks.filter((check) => check.status !== 'pass');
  for (const check of relevant.slice(0, 3)) {
    const exit = check.exitCode === null ? '' : `, exit ${check.exitCode}`;
    const seconds = Number.isFinite(check.durationMs) ? `, ${(check.durationMs / 1000).toFixed(2)}s` : '';
    lines.push(`- ${check.id}: ${check.status}${exit}${seconds}`);
    if (Array.isArray(check.attemptStatuses) && check.attemptStatuses.length > 1) {
      lines.push(`  attempts: ${check.attemptStatuses.join(' -> ')}`);
    }
    if (check.error !== null) lines.push(`  error: ${check.error.name}: ${check.error.message}`);
    const stdout = tailText(check.stdout ?? '', 1_200).trim();
    if (stdout !== '') lines.push('  stdout:', ...failureHighlights(stdout, 12).map((line) => `  | ${line}`));
    const stderr = tailText(check.stderr ?? '', 800).trim();
    if (stderr !== '') lines.push('  stderr tail:', ...indentLines(stderr, 10));
  }
  if (verdict.status === 'fail') {
    lines.push('Fix the failing checks and verify again. Do not claim the task is complete while required checks fail.');
  } else if (verdict.status === 'ask') {
    lines.push(`A check reported exit code ${ASK_EXIT_CODE}. Stop and ask the user; do not guess a pass or a fail.`);
  } else if (verdict.status === 'unknown') {
    lines.push('Do not claim verified success; report what could not be checked.');
  } else if (verdict.status === 'flaky') {
    lines.push('A required check was flaky. Do not treat the pass-after-retry as proof; rerun or quarantine it and report the instability.');
  }
  if (typeof options.artifactPath === 'string' && options.artifactPath !== '') {
    lines.push(`Evidence: ${options.artifactPath}`);
  }
  return clampText(lines.join('\n'), maxChars);
}

/** Feedback used once the retry budget is exhausted. */
export function formatFinalFeedback(verdict, attempts, options = {}) {
  const lines = [
    `Verification is still failing after ${attempts} feedback attempt${attempts === 1 ? '' : 's'}.`,
    `Latest verdict: ${verdict.status} — ${verdict.reason}.`,
    'Stop retrying. Report the failure and the remaining failing checks honestly; do not claim success.',
  ];
  if (typeof options.artifactPath === 'string' && options.artifactPath !== '') {
    lines.push(`Evidence: ${options.artifactPath}`);
  }
  return lines.join('\n');
}

/**
 * Pick the reason that decides the gate for an unknown verdict. Retryable
 * reasons win over non-retryable ones: if any required check could plausibly
 * pass on a second attempt, steering is worth the attempt.
 */
export function gateUnknownReason(verdict) {
  const counts = verdict?.unknownReasons;
  if (counts === null || typeof counts !== 'object') return null;
  let fallback = null;
  for (const reason of Object.keys(counts)) {
    if (!UNKNOWN_REASONS.has(reason)) continue;
    if (UNKNOWN_REASON_GATE[reason] === 'steer') return reason;
    fallback ??= reason;
  }
  return fallback ?? null;
}

/**
 * Decide what the gate should do.
 * @param verdict - runPlan result.
 * @param attempt - feedback attempts already sent for this turn.
 * @param maxAttempts - maximum feedback attempts.
 * @param mode - off | dry-run | enforce.
 */
export function gateAction(verdict, attempt, maxAttempts, mode = 'enforce') {
  const current = Number.isInteger(attempt) && attempt >= 0 ? attempt : 0;
  const cap = Number.isInteger(maxAttempts) && maxAttempts >= 0 ? maxAttempts : 0;
  if (mode === 'off') return { action: 'allow', attempt: current, reason: 'off' };
  if (mode === 'dry-run') return { action: 'record', attempt: current, reason: 'dry-run' };
  if (verdict?.status === 'pass') return { action: 'allow', attempt: current, reason: 'passed' };
  if (verdict?.status === 'unknown') {
    const reason = gateUnknownReason(verdict);
    if (reason === null || UNKNOWN_REASON_GATE[reason] !== 'steer') return { action: 'allow', attempt: current, reason: 'unknown' };
    if (cap <= 0) return { action: 'allow', attempt: current, reason: 'no-retry' };
    if (current < cap) return { action: 'steer', attempt: current + 1, reason: `unknown-${reason}` };
    if (current === cap) return { action: 'steer-final', attempt: current + 1, reason: 'exhausted' };
    return { action: 'allow', attempt: current, reason: 'exhausted' };
  }
  if (verdict?.status === 'ask') return { action: 'allow', attempt: current, reason: 'ask' };
  if (verdict?.status === 'flaky') return { action: 'allow', attempt: current, reason: 'flaky' };
  if (cap <= 0) return { action: 'allow', attempt: current, reason: 'no-retry' };
  if (current < cap) return { action: 'steer', attempt: current + 1, reason: 'failed' };
  if (current === cap) return { action: 'steer-final', attempt: current + 1, reason: 'exhausted' };
  return { action: 'allow', attempt: current, reason: 'exhausted' };
}

/**
 * Recompute a verdict from stored check evidence, without running anything.
 * Used by `dsh-verify rescore` to apply a new policy or reason code to
 * evidence that was captured earlier.
 * @param stored - a verdict as written to `latest.json`.
 * @returns a fresh verdict; `rescoredFrom` records the status it replaced.
 */
export function resummarize(stored, options = {}) {
  if (stored === null || typeof stored !== 'object' || !Array.isArray(stored.checks)) {
    throw new Error('rescore requires a stored verdict with a checks array');
  }
  const planMeta = {
    id: typeof stored.id === 'string' && stored.id !== '' ? stored.id : 'verification',
    planHash: typeof stored.planHash === 'string' ? stored.planHash : '',
    ...(typeof stored.title === 'string' && stored.title !== '' ? { title: stored.title } : {}),
  };
  const startedAt = Number.isFinite(stored.startedAt) ? stored.startedAt : 0;
  const finishedAt = Number.isFinite(stored.finishedAt) ? stored.finishedAt : startedAt;
  const verdict = summarize(
    planMeta,
    stored.checks,
    typeof stored.cwd === 'string' ? stored.cwd : '',
    startedAt,
    finishedAt,
    stored.coverage ?? null,
  );
  const schema = Number.isInteger(stored.schema) ? stored.schema : 1;
  return {
    ...verdict,
    rescoredFrom: {
      status: typeof stored.status === 'string' ? stored.status : 'unknown',
      schema,
      staleSchema: schema < VERDICT_SCHEMA,
      verdictHash: hashValue(stored),
    },
  };
}

/** One line describing what was and was not checked, or '' when nothing was skipped. */
export function describeCoverage(coverage) {
  if (coverage === null || typeof coverage !== 'object') return '';
  const skipped = Array.isArray(coverage.skipped) ? coverage.skipped : [];
  const list = (value) => (Array.isArray(value) ? value : []);
  const optionalFailed = list(coverage.optionalFailed);
  const optionalAsk = list(coverage.optionalAsk);
  const optionalUnknown = list(coverage.optionalUnknown);
  if (skipped.length === 0 && optionalFailed.length === 0 && optionalAsk.length === 0 && optionalUnknown.length === 0) return '';
  const parts = [`${coverage.ran}/${coverage.planned} checks ran`];
  if (skipped.length > 0) {
    const reasons = [...new Set(skipped.map((entry) => entry.reason))].join(', ');
    const requiredSkipped = skipped.filter((entry) => entry.required).map((entry) => entry.id);
    parts.push(`${skipped.length} skipped (${reasons})${requiredSkipped.length > 0 ? `: ${requiredSkipped.join(', ')}` : ''}`);
  }
  if (optionalFailed.length > 0) parts.push(`optional failed: ${optionalFailed.join(', ')}`);
  if (optionalAsk.length > 0) parts.push(`optional needs a human: ${optionalAsk.join(', ')}`);
  if (optionalUnknown.length > 0) parts.push(`optional unverified: ${optionalUnknown.join(', ')}`);
  return parts.join('; ');
}

/** Compact human-readable verdict. */
export function renderVerdict(verdict) {
  const lines = [`Verification: ${String(verdict.status).toUpperCase()} — ${verdict.reason}`];
  for (const check of verdict.checks) {
    const exit = check.exitCode === null ? '' : `, exit ${check.exitCode}`;
    const why = check.status === 'unknown' && typeof check.reason === 'string' ? ` (${check.reason})` : '';
    lines.push(`- ${check.id}: ${check.status}${why}${exit} — ${(check.durationMs / 1000).toFixed(2)}s`);
  }
  const coverage = describeCoverage(verdict.coverage);
  if (coverage !== '') lines.push(`Coverage: ${coverage}`);
  if (typeof verdict.artifactPath === 'string' && verdict.artifactPath !== '') lines.push(`Evidence: ${verdict.artifactPath}`);
  return lines.join('\n');
}
