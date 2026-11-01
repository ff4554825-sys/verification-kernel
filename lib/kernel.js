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
  const status = timedOut || error !== null ? 'unknown' : exitCode === null ? 'unknown' : exitCode === 0 ? 'pass' : 'fail';
  return {
    id: check.id,
    required: check.required,
    status,
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

function summarize(plan, checks, cwd, startedAt, finishedAt) {
  const required = checks.filter((check) => check.required);
  const optional = checks.filter((check) => !check.required);
  const passed = required.filter((check) => check.status === 'pass');
  const failed = required.filter((check) => check.status === 'fail');
  const flaky = required.filter((check) => check.status === 'flaky');
  const unknown = required.filter((check) => check.status === 'unknown');
  let status;
  let reason;
  if (required.length === 0) {
    status = 'unknown';
    reason = 'no required checks were configured';
  } else if (failed.length > 0) {
    status = 'fail';
    reason = `${failed.length} required check${failed.length === 1 ? '' : 's'} failed`;
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
  return {
    version: VERDICT_VERSION,
    id: plan.id,
    planHash: planHash(plan),
    ...(plan.title === undefined ? {} : { title: plan.title }),
    status,
    reason,
    summary: checks.map((check) => `${check.id}:${check.status}`).join(' '),
    cwd,
    startedAt,
    finishedAt,
    durationMs: Math.max(0, finishedAt - startedAt),
    checks,
    counts: {
      required: required.length,
      requiredPassed: passed.length,
      requiredFailed: failed.length,
      requiredFlaky: flaky.length,
      requiredUnknown: unknown.length,
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
    return summarize({ id }, checks, cwd, startedAt, now());
  }
  for (const check of plan.checks) {
    if (selected !== null && !selected.has(check.id)) continue;
    let checkCwd;
    try {
      checkCwd = check.cwd === undefined ? path.resolve(cwd) : resolveInside(cwd, check.cwd);
    } catch (error) {
      checks.push({
        id: check.id,
        required: check.required,
        status: 'unknown',
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
        result = await runCommand(check, { cwd: checkCwd, signal, timeoutMs: check.timeoutMs });
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
  return summarize(plan, checks, cwd, startedAt, now());
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
 * Build model-facing feedback for a failed or unverifiable verdict.
 * @param verdict - runPlan result.
 * @param options - `{ artifactPath?, maxChars? }`.
 */
export function formatFeedback(verdict, options = {}) {
  const maxChars = Number.isInteger(options.maxChars) && options.maxChars > 0 ? options.maxChars : 4_000;
  const lines = [];
  if (verdict.status === 'pass') {
    lines.push('Verification passed.');
  } else if (verdict.status === 'unknown' || verdict.status === 'flaky') {
    lines.push(`Verification could not be completed: ${verdict.reason}.`);
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
    if (stdout !== '') lines.push('  stdout tail:', ...indentLines(stdout, 12));
    const stderr = tailText(check.stderr ?? '', 800).trim();
    if (stderr !== '') lines.push('  stderr tail:', ...indentLines(stderr, 10));
  }
  if (verdict.status === 'fail') {
    lines.push('Fix the failing checks and verify again. Do not claim the task is complete while required checks fail.');
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
  if (verdict?.status === 'unknown') return { action: 'allow', attempt: current, reason: 'unknown' };
  if (verdict?.status === 'flaky') return { action: 'allow', attempt: current, reason: 'flaky' };
  if (cap <= 0) return { action: 'allow', attempt: current, reason: 'no-retry' };
  if (current < cap) return { action: 'steer', attempt: current + 1, reason: 'failed' };
  if (current === cap) return { action: 'steer-final', attempt: current + 1, reason: 'exhausted' };
  return { action: 'allow', attempt: current, reason: 'exhausted' };
}

/** Compact human-readable verdict. */
export function renderVerdict(verdict) {
  const lines = [`Verification: ${String(verdict.status).toUpperCase()} — ${verdict.reason}`];
  for (const check of verdict.checks) {
    const exit = check.exitCode === null ? '' : `, exit ${check.exitCode}`;
    lines.push(`- ${check.id}: ${check.status}${exit} — ${(check.durationMs / 1000).toFixed(2)}s`);
  }
  if (typeof verdict.artifactPath === 'string' && verdict.artifactPath !== '') lines.push(`Evidence: ${verdict.artifactPath}`);
  return lines.join('\n');
}
