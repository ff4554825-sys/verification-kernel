/** Functional test-patch isolation using a git worktree (not a security sandbox). */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function run(file, args, { cwd, timeoutMs, env } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
      env: env ?? process.env,
    });
    return { ok: true, exitCode: 0, stdout, stderr };
  } catch (error) {
    return {
      ok: false,
      exitCode: Number.isInteger(error.code) ? error.code : null,
      stdout: typeof error.stdout === 'string' ? error.stdout : '',
      stderr: typeof error.stderr === 'string' ? error.stderr : String(error.message ?? error),
      timedOut: error.killed === true,
    };
  }
}

/**
 * Apply a patch to a detached git worktree and run a command there.
 * The original working tree is not modified. This is process-level isolation,
 * not a container or a security boundary.
 */
export async function runTestPatch({
  cwd,
  gitPath = 'git',
  base = 'HEAD',
  patchPath,
  command,
  timeoutMs = 120_000,
} = {}) {
  if (typeof cwd !== 'string' || cwd === '') throw new Error('cwd is required');
  if (typeof patchPath !== 'string' || patchPath === '') throw new Error('patchPath is required');
  if (!Array.isArray(command) || command.length === 0) throw new Error('command must be a non-empty argv array');
  const rootResult = await run(gitPath, ['rev-parse', '--show-toplevel'], { cwd, timeoutMs: 10_000 });
  if (!rootResult.ok) return { ok: false, stage: 'repo', error: rootResult.stderr.trim() || 'not a git repository' };
  const root = rootResult.stdout.trim();
  await fs.mkdir(path.join(root, '.dsh'), { recursive: true });
  const worktree = path.join(root, '.dsh', `test-patch-${randomUUID()}`);
  const startedAt = Date.now();
  let added = false;
  try {
    const add = await run(gitPath, ['worktree', 'add', '--detach', worktree, base], { cwd: root, timeoutMs });
    if (!add.ok) return { ok: false, stage: 'worktree', error: add.stderr.trim() || 'worktree add failed' };
    added = true;
    const patchAbsolute = path.resolve(cwd, patchPath);
    const apply = await run(gitPath, ['apply', '--whitespace=nowarn', patchAbsolute], { cwd: worktree, timeoutMs: 30_000 });
    if (!apply.ok) {
      return { ok: false, stage: 'apply', error: apply.stderr.trim() || apply.stdout.trim() || 'patch apply failed' };
    }
    const result = await run(command[0], command.slice(1), {
      cwd: worktree,
      timeoutMs,
      env: {
        ...process.env,
        HOME: worktree,
        USERPROFILE: worktree,
        TMP: worktree,
        TEMP: worktree,
        TMPDIR: worktree,
      },
    });
    return {
      ok: result.ok,
      stage: result.ok ? 'done' : 'test',
      root,
      worktree,
      base,
      command,
      exitCode: result.exitCode,
      timedOut: result.timedOut === true,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    if (added) {
      await run(gitPath, ['worktree', 'remove', '--force', worktree], { cwd: root, timeoutMs: 30_000 });
      await run(gitPath, ['worktree', 'prune'], { cwd: root, timeoutMs: 10_000 });
    }
    await fs.rm(worktree, { recursive: true, force: true });
  }
}
