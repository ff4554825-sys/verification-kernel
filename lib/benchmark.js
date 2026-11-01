/** Run a manifest of patch tasks under worktree, WSL, or Docker isolation. */

import fs from 'node:fs/promises';
import path from 'node:path';
import { runTestPatch } from './test-patch.js';
import { runTestPatchWsl } from './test-patch-wsl.js';
import { runTestPatchDocker } from './test-patch-docker.js';

const EXPECTED = new Set(['pass', 'fail']);

function tail(value, max = 2_000) {
  if (typeof value !== 'string') return '';
  return value.length <= max ? value : value.slice(-max);
}

/** Validate and resolve a benchmark manifest. */
export function normalizeManifest(raw, baseDir = process.cwd()) {
  const errors = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { manifest: null, errors: ['manifest must be an object'] };
  }
  if (!Array.isArray(raw.tasks) || raw.tasks.length === 0) errors.push('manifest.tasks must be a non-empty array');
  const tasks = [];
  for (const [index, rawTask] of (Array.isArray(raw.tasks) ? raw.tasks : []).entries()) {
    const label = `tasks[${index}]`;
    if (rawTask === null || typeof rawTask !== 'object') {
      errors.push(`${label} must be an object`);
      continue;
    }
    const id = typeof rawTask.id === 'string' && rawTask.id !== '' ? rawTask.id : `${label}`;
    const expected = rawTask.expected ?? 'pass';
    if (!EXPECTED.has(expected)) errors.push(`${label}.expected must be pass|fail`);
    const command = Array.isArray(rawTask.command) && rawTask.command.every((part) => typeof part === 'string' && part !== '')
      ? [...rawTask.command]
      : null;
    if (command === null) errors.push(`${label}.command must be a non-empty argv array`);
    const patch = typeof rawTask.patch === 'string' && rawTask.patch !== '' ? rawTask.patch : '';
    if (patch === '') errors.push(`${label}.patch is required`);
    const cwd = rawTask.cwd === undefined ? baseDir : path.resolve(baseDir, rawTask.cwd);
    const task = {
      id,
      cwd,
      base: typeof rawTask.base === 'string' && rawTask.base !== '' ? rawTask.base : 'HEAD',
      patch: patch === '' ? '' : path.resolve(cwd, patch),
      command: command ?? [],
      expected,
      timeoutMs: Number.isInteger(rawTask.timeoutMs) && rawTask.timeoutMs > 0 ? rawTask.timeoutMs : 120_000,
    };
    if (command !== null && patch !== '' && EXPECTED.has(expected)) tasks.push(task);
  }
  if (errors.length > 0) return { manifest: null, errors };
  return { manifest: { tasks }, errors: [] };
}

export async function runBenchmark({
  manifest,
  isolation = 'worktree',
  distro = process.env.WSL_DISTRO || 'Ubuntu-22.04',
  image = process.env.DSH_TEST_IMAGE || 'ubuntu-base:local',
  gitPath = process.env.GIT_EXECUTABLE || 'git',
  failFast = false,
  onProgress = () => {},
} = {}) {
  if (manifest === null || !Array.isArray(manifest.tasks)) throw new Error('manifest is required');
  if (!['worktree', 'wsl', 'docker'].includes(isolation)) throw new Error('isolation must be worktree|wsl|docker');
  const results = [];
  const startedAt = Date.now();
  for (const task of manifest.tasks) {
    let run;
    try {
      if (isolation === 'docker') {
        run = await runTestPatchDocker({ cwd: task.cwd, distro, image, patchPath: task.patch, command: task.command, timeoutMs: task.timeoutMs });
      } else if (isolation === 'wsl') {
        run = await runTestPatchWsl({ cwd: task.cwd, distro, patchPath: task.patch, command: task.command, timeoutMs: task.timeoutMs });
      } else {
        run = await runTestPatch({ cwd: task.cwd, gitPath, base: task.base, patchPath: task.patch, command: task.command, timeoutMs: task.timeoutMs });
      }
    } catch (error) {
      run = { ok: false, stage: 'error', error: error instanceof Error ? error.message : String(error) };
    }
    const actual = run.ok ? 'pass' : 'fail';
    const result = {
      id: task.id,
      expected: task.expected,
      actual,
      matched: actual === task.expected,
      stage: run.stage,
      exitCode: run.exitCode,
      durationMs: run.durationMs ?? 0,
      error: run.error,
      stdout: tail(run.stdout),
      stderr: tail(run.stderr),
    };
    results.push(result);
    onProgress(result);
    if (failFast && !result.matched) break;
  }
  const falseAccept = results.filter((result) => result.expected === 'fail' && result.actual === 'pass').length;
  const falseReject = results.filter((result) => result.expected === 'pass' && result.actual === 'fail').length;
  const bad = results.filter((result) => result.expected === 'fail').length;
  const good = results.filter((result) => result.expected === 'pass').length;
  return {
    isolation,
    total: results.length,
    matched: results.filter((result) => result.matched).length,
    falseAccept,
    falseReject,
    escapeRate: bad === 0 ? 0 : Number((falseAccept / bad).toFixed(4)),
    falseRejectRate: good === 0 ? 0 : Number((falseReject / good).toFixed(4)),
    accuracy: results.length === 0 ? 0 : Number((results.filter((result) => result.matched).length / results.length).toFixed(4)),
    durationMs: Date.now() - startedAt,
    results,
  };
}
