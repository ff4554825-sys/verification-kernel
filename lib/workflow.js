/** Deterministic verification workflow: resolve → execute → evidence → gate → report. */

import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizePlan, runPlan, gateAction, planHash } from './kernel.js';
import { runCommand } from './exec.js';
import { writeVerdictArtifacts } from './artifacts.js';
import { appendOutcome, outcomeFromVerdict } from './outcomes.js';
import { signVerdict } from './sign.js';
import { verifyInWsl } from './verify-wsl.js';

export const WORKFLOW_PHASES = ['resolve', 'execute', 'evidence', 'gate', 'report'];

function emptyVerdict(reason) {
  return {
    version: 1,
    id: 'verification',
    planHash: '',
    status: 'unknown',
    reason,
    summary: '',
    checks: [],
    counts: { required: 0, requiredPassed: 0, requiredFailed: 0, requiredFlaky: 0, requiredUnknown: 0, optional: 0, optionalFailed: 0, optionalFlaky: 0 },
  };
}

/**
 * Run one deterministic verification workflow.
 * The workflow never asks an LLM to decide pass/fail; `gateAction` only decides
 * whether the caller may continue, retry, or must report honestly.
 */
export async function runVerificationWorkflow({
  planPath,
  cwd = process.cwd(),
  project = null,
  isolation = 'host',
  mode = 'enforce',
  attempt = 0,
  maxAttempts = 2,
  signKey = null,
  outcomeStore = null,
  artifacts = true,
  distro = process.env.WSL_DISTRO || 'Ubuntu-22.04',
  wslTimeoutMs = 5 * 60_000,
} = {}) {
  if (typeof planPath !== 'string' || planPath === '') throw new Error('planPath is required');
  if (!['host', 'wsl'].includes(isolation)) throw new Error('isolation must be host|wsl');
  if (!['off', 'dry-run', 'enforce'].includes(mode)) throw new Error('mode must be off|dry-run|enforce');
  const base = path.resolve(cwd);
  const absolutePlan = path.resolve(base, planPath);
  const phases = [];
  const startedAt = Date.now();

  const phase = async (name, callback) => {
    const phaseStarted = Date.now();
    const value = await callback();
    phases.push({ name, status: 'pass', startedAt: phaseStarted, durationMs: Date.now() - phaseStarted });
    return value;
  };

  let raw;
  let normalized;
  let verdict;
  let artifactPath = '';
  let gate = null;
  let outcome = null;
  let signed = false;

  const result = await phase('resolve', async () => {
    raw = JSON.parse(await fs.readFile(absolutePlan, 'utf8'));
    normalized = normalizePlan(raw);
    if (normalized.plan === null) throw new Error(`invalid plan: ${normalized.errors.join('; ')}`);
    return normalized.plan;
  }).catch((error) => {
    return { error };
  });
  if (result?.error) {
    phases.push({ name: 'resolve', status: 'fail', startedAt, durationMs: Date.now() - startedAt });
    return {
      ok: false,
      stage: 'resolve',
      error: result.error instanceof Error ? result.error.message : String(result.error),
      phases,
      verdict: null,
      gate: null,
      artifactPath: '',
      workflowPath: '',
    };
  }

  try {
    verdict = await phase('execute', async () => {
      if (isolation === 'wsl') {
        const wsl = await verifyInWsl({ cwd: base, planPath: absolutePlan, distro, timeoutMs: wslTimeoutMs });
        if (!wsl.ok || wsl.verdict === null) {
          return emptyVerdict(`WSL verifier failed: ${wsl.error ?? wsl.stderr ?? wsl.stage ?? 'unknown error'}`);
        }
        return {
          ...wsl.verdict,
          cwd: base,
          isolation: 'wsl',
          remote: { isolation: 'wsl', distro },
        };
      }
      return runPlan(normalized.plan, { cwd: base, runCommand });
    });
  } catch (error) {
    verdict = emptyVerdict(`check execution failed: ${error instanceof Error ? error.message : String(error)}`);
    phases.push({ name: 'execute', status: 'fail', startedAt: Date.now(), durationMs: 0 });
  }

  try {
    await phase('evidence', async () => {
      if (signKey !== null) {
        verdict = signVerdict(verdict, await fs.readFile(path.resolve(base, signKey), 'utf8'));
        signed = true;
      }
      if (artifacts) {
        const written = await writeVerdictArtifacts(base, verdict);
        if (written !== null) artifactPath = written.latest;
      }
      if (typeof outcomeStore === 'string' && outcomeStore !== '') {
        outcome = outcomeFromVerdict(verdict, { project: project ?? verdict.id, artifactPath });
        await appendOutcome(path.resolve(base, outcomeStore), outcome);
      }
    });
  } catch (error) {
    phases.push({ name: 'evidence', status: 'fail', startedAt: Date.now(), durationMs: 0 });
    return {
      ok: false,
      stage: 'evidence',
      error: error instanceof Error ? error.message : String(error),
      phases,
      verdict,
      gate: null,
      artifactPath,
      workflowPath: '',
    };
  }

  gate = await phase('gate', async () => gateAction(verdict, attempt, maxAttempts, mode));

  const workflowPath = artifacts ? path.join(base, '.dsh', 'verification', 'workflow.json') : '';
  const record = {
    version: 1,
    workflow: 'verification',
    project: project ?? verdict.id,
    planHash: planHash(normalized.plan),
    isolation,
    mode,
    attempt,
    maxAttempts,
    phases,
    verdict,
    gate,
    artifactPath,
    signed,
    outcome,
    startedAt,
    durationMs: Date.now() - startedAt,
  };

  try {
    await phase('report', async () => {
      if (workflowPath !== '') {
        await fs.mkdir(path.dirname(workflowPath), { recursive: true });
        await fs.writeFile(workflowPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
      }
    });
  } catch (error) {
    phases.push({ name: 'report', status: 'fail', startedAt: Date.now(), durationMs: 0 });
    return {
      ok: false,
      stage: 'report',
      error: error instanceof Error ? error.message : String(error),
      phases,
      verdict,
      gate,
      artifactPath,
      workflowPath,
    };
  }

  return {
    ok: verdict.status === 'pass',
    stage: 'done',
    phases,
    verdict,
    gate,
    artifactPath,
    workflowPath,
    signed,
    outcome,
  };
}
