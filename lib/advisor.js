/** L1 agent-level advisory verifier.
 *
 * The advisor never changes the deterministic verdict. It can be an external
 * critic command (OpenHands-compatible custom service/CLI) or a local
 * heuristic. External commands receive JSON on stdin and must return JSON:
 * `{score: 0..1, risk: "low|medium|high", issues: string[], summary: string}`.
 */

import { spawn } from 'node:child_process';

function tail(value, max = 500) {
  if (typeof value !== 'string') return '';
  return value.length <= max ? value : value.slice(-max);
}

export function heuristicAdvice(verdict) {
  if (verdict === null || typeof verdict !== 'object') throw new Error('verdict is required');
  const checks = Array.isArray(verdict.checks) ? verdict.checks : [];
  const failed = checks.filter((check) => check.status === 'fail');
  const unknown = checks.filter((check) => check.status === 'unknown');
  const flaky = checks.filter((check) => check.status === 'flaky');
  const optionalFailed = checks.filter((check) => check.status === 'fail' && !check.required);
  const issues = [];
  for (const check of failed.slice(0, 5)) {
    issues.push(`${check.id}: fail${check.error?.message ? ` (${check.error.message})` : ''}`);
  }
  for (const check of unknown.slice(0, 5)) issues.push(`${check.id}: unknown`);
  for (const check of flaky.slice(0, 5)) issues.push(`${check.id}: flaky`);
  const score = verdict.status === 'pass'
    ? Math.max(0.6, 0.95 - optionalFailed.length * 0.05)
    : verdict.status === 'fail'
      ? 0.15
      : verdict.status === 'flaky'
        ? 0.55
        : 0.45;
  const risk = score >= 0.8 ? 'low' : score >= 0.5 ? 'medium' : 'high';
  return {
    source: 'heuristic',
    score: Number(score.toFixed(2)),
    risk,
    issues,
    summary: `${verdict.status}: ${verdict.reason ?? ''}`,
  };
}

function normalizeExternalAdvice(value) {
  if (value === null || typeof value !== 'object') throw new Error('advisor output must be an object');
  const score = Number(value.score);
  if (!Number.isFinite(score) || score < 0 || score > 1) throw new Error('advisor score must be 0..1');
  const risk = ['low', 'medium', 'high'].includes(value.risk)
    ? value.risk
    : score >= 0.8 ? 'low' : score >= 0.5 ? 'medium' : 'high';
  return {
    source: 'external',
    score: Number(score.toFixed(2)),
    risk,
    issues: Array.isArray(value.issues) ? value.issues.filter((item) => typeof item === 'string').slice(0, 10) : [],
    summary: typeof value.summary === 'string' ? value.summary.slice(0, 1_000) : '',
  };
}

function runCommandWithStdin(command, { cwd, input, timeoutMs }) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let child;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      child = spawn(command[0], command.slice(1), { cwd, windowsHide: true });
    } catch (error) {
      finish({ error: error instanceof Error ? error.message : String(error) });
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      finish({ error: `advisor timed out after ${timeoutMs}ms` });
    }, Math.max(1, timeoutMs));
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ error: error instanceof Error ? error.message : String(error) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) finish({ error: `advisor exited ${code}: ${tail(stderr, 300)}` });
      else finish({ stdout, stderr });
    });
    try {
      child.stdin.end(JSON.stringify(input));
    } catch (error) {
      finish({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

/** Run an external critic if configured; otherwise fall back to heuristic advice. */
export async function adviseVerdict(verdict, { project = null, command = null, cwd = process.cwd(), timeoutMs = 30_000 } = {}) {
  const heuristic = heuristicAdvice(verdict);
  if (!Array.isArray(command) || command.length === 0) return heuristic;
  const result = await runCommandWithStdin(command, {
    cwd,
    timeoutMs,
    input: {
      project,
      verdict: {
        id: verdict.id,
        status: verdict.status,
        reason: verdict.reason,
        planHash: verdict.planHash,
        counts: verdict.counts,
        checks: (verdict.checks ?? []).map((check) => ({
          id: check.id,
          required: check.required,
          status: check.status,
          exitCode: check.exitCode,
          durationMs: check.durationMs,
          stdout: tail(check.stdout),
          stderr: tail(check.stderr),
          error: check.error,
        })),
      },
    },
  });
  if (result.error !== undefined) {
    return { ...heuristic, source: 'heuristic-fallback', error: result.error };
  }
  try {
    return normalizeExternalAdvice(JSON.parse(result.stdout.trim()));
  } catch (error) {
    return { ...heuristic, source: 'heuristic-fallback', error: `invalid advisor JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}
