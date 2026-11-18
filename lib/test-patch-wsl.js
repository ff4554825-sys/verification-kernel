/** Test-patch isolation inside a WSL2 distribution (a real Linux VM boundary). */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const WSL = process.env.WSL_EXECUTABLE || 'C:\\Windows\\System32\\wsl.exe';

async function runWsl(args, { timeoutMs = 120_000 } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(WSL, args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
      encoding: 'utf8',
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

function toWslPath(windowsPath) {
  const absolute = path.resolve(windowsPath).replace(/\\/g, '/');
  const match = /^([A-Za-z]):\/(.*)$/.exec(absolute);
  return match === null ? absolute : `/mnt/${match[1].toLowerCase()}/${match[2]}`;
}

/**
 * Copy the project into a WSL temp dir, apply the patch, run a Linux argv
 * command, and clean up. The Windows working tree is never modified.
 */
export async function runTestPatchWsl({
  cwd,
  distro = process.env.WSL_DISTRO || 'Ubuntu-22.04',
  patchPath,
  command,
  timeoutMs = 120_000,
} = {}) {
  if (typeof cwd !== 'string' || cwd === '') throw new Error('cwd is required');
  if (typeof patchPath !== 'string' || patchPath === '') throw new Error('patchPath is required');
  if (!Array.isArray(command) || command.length === 0) throw new Error('command must be a non-empty argv array');

  const startedAt = Date.now();
  const cwdWsl = toWslPath(cwd);
  const patchWsl = toWslPath(path.resolve(cwd, patchPath));
  const tempResult = await runWsl(['-d', distro, '--exec', 'mktemp', '-d', '/tmp/dsh-test-patch.XXXXXX'], { timeoutMs: 30_000 });
  if (!tempResult.ok) return { ok: false, stage: 'temp', error: tempResult.stderr.trim() || 'mktemp failed' };
  const temp = tempResult.stdout.trim();
  const base = { distro, temp, cwdWsl, patchWsl, command };

  try {
    const copyScript = 'set -e; cd "$1"; tar --exclude=.git --exclude=.dsh --exclude=tools --exclude=node_modules -cf - . | tar -xf - -C "$2"';
    const copy = await runWsl(['-d', distro, '--exec', 'bash', '-lc', copyScript, '_', cwdWsl, temp], { timeoutMs });
    if (!copy.ok) return { ...base, ok: false, stage: 'copy', error: copy.stderr.trim() || copy.stdout.trim() || 'copy failed' };

    const apply = await runWsl(['-d', distro, '--exec', 'bash', '-lc', 'set -e; cd "$1"; patch -p1 --batch --forward < "$2"', '_', temp, patchWsl], { timeoutMs: 30_000 });
    if (!apply.ok) return { ...base, ok: false, stage: 'apply', error: apply.stderr.trim() || apply.stdout.trim() || 'patch apply failed' };

    const runScript = 'set -e; cd "$0"; export HOME="$0" TMPDIR="$0"; exec "$@"';
    const result = await runWsl(['-d', distro, '--exec', 'bash', '-lc', runScript, temp, ...command], { timeoutMs });
    return {
      ...base,
      ok: result.ok,
      stage: result.ok ? 'done' : 'test',
      exitCode: result.exitCode,
      timedOut: result.timedOut === true,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await runWsl(['-d', distro, '--exec', 'rm', '-rf', temp], { timeoutMs: 30_000 });
  }
}
