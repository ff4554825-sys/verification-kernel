/** Mutation-based check-quality audit: do the tests kill injected bugs? */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 120_000;
const EXCLUDED = new Set(['.git', '.dsh', 'tools', 'node_modules', 'presets', 'docs', 'golden', '.github']);

/** Curated mutations of verification-kernel logic. */
export const DEFAULT_MUTATIONS = [
  {
    id: 'required-default',
    file: 'lib/kernel.js',
    find: 'const required = raw.required === undefined ? true : raw.required;',
    replace: 'const required = raw.required === undefined ? false : raw.required;',
    description: 'make an unspecified check optional instead of required',
  },
  {
    id: 'exit-code-inverted',
    file: 'lib/kernel.js',
    find: "exitCode === 0 ? 'pass' : 'fail'",
    replace: "exitCode !== 0 ? 'pass' : 'fail'",
    description: 'invert the exit-code verdict',
  },
  {
    id: 'failed-summary-inverted',
    file: 'lib/kernel.js',
    find: '} else if (failed.length > 0) {',
    replace: '} else if (failed.length === 0) {',
    description: 'invert the required-failure summary branch',
  },
  {
    id: 'unknown-summary-inverted',
    file: 'lib/kernel.js',
    find: '} else if (unknown.length > 0) {',
    replace: '} else if (unknown.length === 0) {',
    description: 'invert the required-unknown summary branch',
  },
  {
    id: 'pass-marked-fail',
    file: 'lib/kernel.js',
    find: "if (passedAt === 0) status = 'pass';",
    replace: "if (passedAt === 0) status = 'fail';",
    description: 'mark a first-attempt pass as fail',
  },
  {
    id: 'flaky-marked-pass',
    file: 'lib/kernel.js',
    find: "else if (passedAt > 0) status = 'flaky';",
    replace: "else if (passedAt > 0) status = 'pass';",
    description: 'silence flaky checks as pass',
  },
  {
    id: 'fail-marked-pass',
    file: 'lib/kernel.js',
    find: "else if (attemptStatuses.includes('fail')) status = 'fail';",
    replace: "else if (attemptStatuses.includes('fail')) status = 'pass';",
    description: 'mark exhausted failures as pass',
  },
  {
    id: 'dry-run-treated-enforce',
    file: 'lib/kernel.js',
    find: "if (mode === 'dry-run') return { action: 'record', attempt: current, reason: 'dry-run' };",
    replace: "if (mode === 'dry-run') return { action: 'steer', attempt: current, reason: 'dry-run' };",
    description: 'make dry-run steer instead of record',
  },
];

export function applyMutation(content, mutation) {
  if (typeof content !== 'string' || typeof mutation?.find !== 'string' || typeof mutation?.replace !== 'string') {
    throw new Error('invalid mutation');
  }
  const first = content.indexOf(mutation.find);
  if (first < 0) throw new Error(`mutation '${mutation.id}' target not found`);
  if (content.indexOf(mutation.find, first + 1) >= 0) throw new Error(`mutation '${mutation.id}' target is not unique`);
  return `${content.slice(0, first)}${mutation.replace}${content.slice(first + mutation.find.length)}`;
}

async function copyProject(source, target) {
  await fs.cp(source, target, {
    recursive: true,
    filter: (item) => {
      if (item === source) return true;
      const relative = path.relative(source, item);
      const top = relative.split(path.sep)[0];
      return !EXCLUDED.has(top);
    },
  });
}

async function runTest(testCommand, cwd, timeoutMs) {
  const env = { ...process.env, CI: '1' };
  // A nested `node --test` inherits NODE_TEST_CONTEXT and refuses to run files.
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  try {
    const { stdout, stderr } = await execFileAsync(testCommand[0], testCommand.slice(1), {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
      env,
    });
    return { exitCode: 0, stdout, stderr, timedOut: false };
  } catch (error) {
    return {
      exitCode: Number.isInteger(error.code) ? error.code : null,
      stdout: typeof error.stdout === 'string' ? error.stdout : '',
      stderr: typeof error.stderr === 'string' ? error.stderr : String(error.message ?? error),
      timedOut: error.killed === true,
    };
  }
}

/**
 * Run each mutation in an isolated project copy and classify it.
 * Killed = tests fail (or time out); survived = tests still pass.
 */
export async function runMutations({
  cwd,
  mutations = DEFAULT_MUTATIONS,
  testCommand = [process.execPath, '--test', 'test/kernel.test.js', 'test/dsh.test.js'],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onProgress = () => {},
} = {}) {
  if (typeof cwd !== 'string' || cwd === '') throw new Error('cwd is required');
  if (!Array.isArray(mutations) || mutations.length === 0) throw new Error('mutations are required');
  if (!Array.isArray(testCommand) || testCommand.length === 0) throw new Error('testCommand is required');
  const results = [];
  for (const mutation of mutations) {
    const startedAt = Date.now();
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-mutation-'));
    try {
      const source = await fs.readFile(path.join(cwd, mutation.file), 'utf8');
      const mutated = applyMutation(source, mutation);
      await copyProject(cwd, path.join(temp, 'project'));
      await fs.writeFile(path.join(temp, 'project', mutation.file), mutated, 'utf8');
      const run = await runTest(testCommand, path.join(temp, 'project'), timeoutMs);
      const status = run.exitCode === 0 ? 'survived' : 'killed';
      const result = {
        id: mutation.id,
        file: mutation.file,
        description: mutation.description,
        status,
        exitCode: run.exitCode,
        timedOut: run.timedOut,
        durationMs: Date.now() - startedAt,
      };
      results.push(result);
      onProgress(result);
    } catch (error) {
      results.push({
        id: mutation.id,
        file: mutation.file,
        description: mutation.description,
        status: 'invalid',
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  }
  const killed = results.filter((result) => result.status === 'killed').length;
  const survived = results.filter((result) => result.status === 'survived').length;
  const invalid = results.filter((result) => result.status === 'invalid').length;
  return {
    results,
    score: killed + survived === 0 ? 0 : Math.round((killed / (killed + survived)) * 100),
    killed,
    survived,
    invalid,
    total: results.length,
  };
}
