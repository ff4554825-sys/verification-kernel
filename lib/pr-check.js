/** L2 repo-level PR check: review packet + isolated QA test-patch. */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git } from './diff.js';
import { buildReviewPacket, formatReviewPrompt } from './review.js';
import { runTestPatch } from './test-patch.js';

/**
 * Build a local PR verification report.
 * Review is advisory; QA is an actual isolated execution and can fail the check.
 */
export async function runPrCheck({
  cwd,
  gitPath = 'git',
  base = 'HEAD',
  qaCommand = null,
  timeoutMs = 120_000,
  outDir = '.dsh/pr-check',
} = {}) {
  const rootPath = path.resolve(cwd);
  const packet = await buildReviewPacket({ cwd: rootPath, gitPath, base, timeoutMs: Math.min(timeoutMs, 30_000) });
  const prompt = formatReviewPrompt(packet);
  const target = path.resolve(rootPath, outDir);
  await fs.mkdir(target, { recursive: true });
  const promptPath = path.join(target, 'review.md');
  const reportPath = path.join(target, 'report.json');
  await fs.writeFile(promptPath, `${prompt}\n`, 'utf8');

  let qa = null;
  let patchPath = null;
  let patchTemp = null;
  if (Array.isArray(qaCommand) && qaCommand.length > 0) {
    const diff = await git(gitPath, ['diff', '--binary', '--no-ext-diff', base, '--'], {
      cwd: packet.root,
      timeoutMs: Math.min(timeoutMs, 30_000),
    });
    if (diff.stdout.trim() === '') {
      qa = { ok: false, stage: 'patch', error: 'no diff to QA' };
    } else {
      patchTemp = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-pr-check-'));
      patchPath = path.join(patchTemp, 'change.patch');
      await fs.writeFile(patchPath, diff.stdout, 'utf8');
      const result = await runTestPatch({
        cwd: packet.root,
        gitPath,
        base,
        patchPath,
        command: qaCommand,
        timeoutMs,
      });
      qa = {
        ok: result.ok,
        stage: result.stage,
        exitCode: result.exitCode ?? null,
        durationMs: result.durationMs ?? 0,
        stdout: typeof result.stdout === 'string' ? result.stdout.slice(-8_000) : '',
        stderr: typeof result.stderr === 'string' ? result.stderr.slice(-8_000) : '',
        error: result.error ?? null,
        worktree: result.worktree ?? null,
      };
    }
  }

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    root: packet.root,
    base: packet.base,
    files: packet.totals.files,
    lines: packet.totals,
    review: {
      promptPath,
      rules: packet.rules.map((rule) => rule.path),
      advisory: true,
    },
    qa,
    status: qa === null ? 'review-only' : qa.ok ? 'pass' : 'fail',
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (patchTemp !== null) await fs.rm(patchTemp, { recursive: true, force: true });
  return { ...report, reportPath, patchPath: null, prompt };
}
