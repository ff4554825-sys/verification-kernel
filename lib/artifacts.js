/** Durable verdict evidence written beside the workspace under `.dsh/verification`. */

import fs from 'node:fs/promises';
import path from 'node:path';
import { hashValue } from './kernel.js';
import { redactSensitive } from './redact.js';

function safeSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '-');
}

/**
 * Write the latest verdict plus its per-check output, a JSONL trace event, and
 * hashes for the verdict and each check.
 * @param cwd - workspace root.
 * @param verdict - runPlan result.
 * @param options - `{ dir? }`; an absolute dir stores evidence outside the workspace.
 * @returns artifact paths, or null when writing failed.
 */
export async function writeVerdictArtifacts(cwd, verdict, options = {}) {
  try {
    const dir = path.resolve(cwd, typeof options.dir === 'string' && options.dir !== '' ? options.dir : '.dsh/verification');
    const stamp = new Date(Number.isFinite(verdict.finishedAt) ? verdict.finishedAt : Date.now())
      .toISOString()
      .replace(/[:.]/g, '-');
    const base = `${stamp}-${safeSegment(verdict.id ?? 'verification')}`;
    const evidenceDir = path.join(dir, 'evidence');
    const historyDir = path.join(dir, 'history');
    await fs.mkdir(evidenceDir, { recursive: true });
    await fs.mkdir(historyDir, { recursive: true });
    const evidence = [];
    for (const check of verdict.checks) {
      const id = safeSegment(check.id);
      if (typeof check.stdout === 'string' && check.stdout !== '') {
        const file = path.join(evidenceDir, `${base}-${id}.stdout.txt`);
        await fs.writeFile(file, redactSensitive(check.stdout));
        evidence.push(file);
      }
      if (typeof check.stderr === 'string' && check.stderr !== '') {
        const file = path.join(evidenceDir, `${base}-${id}.stderr.txt`);
        await fs.writeFile(file, redactSensitive(check.stderr));
        evidence.push(file);
      }
    }
    const latest = path.join(dir, 'latest.json');
    const history = path.join(historyDir, `${base}.json`);
    const trace = path.join(dir, 'trace.jsonl');
    const basePayload = { ...verdict, artifacts: { latest, history, evidence } };
    const hashes = {
      verdict: hashValue(basePayload),
      checks: Object.fromEntries(verdict.checks.map((check) => [check.id, hashValue(check)])),
    };
    const payload = { ...basePayload, hashes };
    const json = JSON.stringify(payload, null, 2);
    await fs.writeFile(latest, json);
    await fs.writeFile(history, json);
    try {
      const event = {
        time: new Date(Number.isFinite(verdict.finishedAt) ? verdict.finishedAt : Date.now()).toISOString(),
        id: verdict.id,
        planHash: verdict.planHash,
        status: verdict.status,
        reason: verdict.reason,
        durationMs: verdict.durationMs,
        counts: verdict.counts,
        checks: verdict.checks.map((check) => ({
          id: check.id,
          status: check.status,
          required: check.required,
          durationMs: check.durationMs,
          attempts: check.attempts,
          attemptStatuses: check.attemptStatuses,
        })),
        ...(verdict.override === undefined ? {} : { override: verdict.override }),
        hashes,
      };
      await fs.appendFile(trace, `${JSON.stringify(event)}\n`, 'utf8');
    } catch {
      /* trace is best-effort; latest/history remain authoritative */
    }
    return { latest, history, evidence, trace, hashes };
  } catch {
    return null;
  }
}
