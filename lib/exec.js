/** Node child-process runner used by the CLI, tests, and golden benchmark. */

import { spawn } from 'node:child_process';

const CAPTURE_LIMIT = 200_000;

function appendCapped(current, chunk) {
  if (current.length >= CAPTURE_LIMIT) return current;
  const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  return current + text.slice(0, CAPTURE_LIMIT - current.length);
}

/**
 * Run one check as an argv process.
 * @param check - normalized check.
 * @param options - `{ cwd, timeoutMs?, signal?, attempt?, planId? }`.
 * @returns command evidence for the kernel.
 */
export function runCommand(check, options = {}) {
  const cwd = typeof options.cwd === 'string' ? options.cwd : process.cwd();
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : check.timeoutMs;
  const signal = options.signal;
  const argv = Array.isArray(check.argv) ? check.argv : [];
  if (argv.length === 0) {
    return Promise.resolve({
      exitCode: null,
      signal: null,
      stdout: '',
      stderr: '',
      durationMs: 0,
      timedOut: false,
      spillPaths: [],
      error: { name: 'InvalidArgv', message: 'check.argv is empty' },
    });
  }
  const program = argv[0] === 'node' ? process.execPath : argv[0];
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timer = null;
    let forceTimer = null;
    let child = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      if (forceTimer !== null) clearTimeout(forceTimer);
      if (signal !== undefined && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort);
      resolve({ ...result, durationMs: Math.max(0, Date.now() - startedAt) });
    };

    const kill = (name) => {
      try {
        child?.kill(name);
      } catch {
        /* the process may already be gone */
      }
    };

    const onAbort = () => {
      kill('SIGTERM');
      forceTimer = setTimeout(() => kill('SIGKILL'), 2_000);
      if (typeof forceTimer.unref === 'function') forceTimer.unref();
    };

    try {
      // A check can tell a first attempt from a retry. Without this the only
      // place that knew was the caller, which is exactly what
      // stop_hook_active exists to avoid in Claude Code.
      const attempt = Number.isInteger(options.attempt) && options.attempt >= 0 ? options.attempt : 0;
      const env = {
        ...process.env,
        VERIFICATION_CHECK_ID: check.id,
        VERIFICATION_ATTEMPT: String(attempt),
        ...(typeof options.planId === 'string' && options.planId !== '' ? { VERIFICATION_PLAN_ID: options.planId } : {}),
      };
      child = spawn(program, argv.slice(1), {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      finish({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        timedOut: false,
        spillPaths: [],
        error: { name: error?.name ?? 'Error', message: error?.message ?? String(error) },
      });
      return;
    }

    child.stdout?.on('data', (chunk) => {
      stdout = appendCapped(stdout, chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = appendCapped(stderr, chunk);
    });
    timer = setTimeout(() => {
      timedOut = true;
      onAbort();
    }, Math.max(1, timeoutMs));
    if (signal !== undefined) {
      if (signal.aborted === true) onAbort();
      else if (typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort, { once: true });
    }
    child.on('error', (error) => {
      finish({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        timedOut,
        spillPaths: [],
        error: { name: error?.name ?? 'Error', message: error?.message ?? String(error) },
      });
    });
    child.on('close', (exitCode, signalName) => {
      finish({
        exitCode: Number.isInteger(exitCode) ? exitCode : null,
        signal: typeof signalName === 'string' ? signalName : null,
        stdout,
        stderr,
        timedOut,
        spillPaths: [],
        error: null,
      });
    });
  });
}
