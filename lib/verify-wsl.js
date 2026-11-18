/** Run the verification CLI inside WSL2, outside the Host agent process. */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

async function installVerifier(temp, distro, timeoutMs) {
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const source = toWslPath(path.join(root, 'bin'));
  const libSource = toWslPath(path.join(root, 'lib'));
  const packageSource = toWslPath(path.join(root, 'package.json'));
  const verifier = `${temp}/verifier`;
  const script = [
    'set -e',
    `mkdir -p '${verifier}'`,
    `cp -r '${source}' '${verifier}/bin'`,
    `cp -r '${libSource}' '${verifier}/lib'`,
    `cp '${packageSource}' '${verifier}/package.json'`,
  ].join('; ');
  const result = await runWsl(['-d', distro, '--exec', 'bash', '-lc', script], { timeoutMs });
  if (!result.ok) throw new Error(`could not install WSL verifier: ${result.stderr.trim() || 'unknown error'}`);
  return verifier;
}

/**
 * Copy a project to a WSL2 temp dir, run the verifier there, and clean up.
 * The Host process does not execute the checks.
 */
export async function verifyInWsl({
  cwd,
  planPath,
  distro = process.env.WSL_DISTRO || 'Ubuntu-22.04',
  node = '/opt/node/bin/node',
  timeoutMs = 120_000,
  network = 'none',
  readOnly = true,
  runAsUser = 'nobody',
  keep = false,
} = {}) {
  if (typeof cwd !== 'string' || cwd === '') throw new Error('cwd is required');
  if (typeof planPath !== 'string' || planPath === '') throw new Error('planPath is required');
  const planAbsolute = path.resolve(cwd, planPath);
  const tempResult = await runWsl(['-d', distro, '--exec', 'mktemp', '-d', '/tmp/dsh-verify.XXXXXX'], { timeoutMs: 30_000 });
  if (!tempResult.ok) return { ok: false, stage: 'temp', error: tempResult.stderr.trim() || 'mktemp failed' };
  const temp = tempResult.stdout.trim();
  const target = `${temp}/project`;
  const plan = `${temp}/plan.json`;
  const tempMode = await runWsl(['-d', distro, '--exec', 'chmod', '755', temp], { timeoutMs: 30_000 });
  if (!tempMode.ok) return { ok: false, stage: 'temp', error: tempMode.stderr.trim() || 'chmod temp failed' };
  try {
    let verifier;
    try {
      verifier = await installVerifier(temp, distro, timeoutMs);
    } catch (error) {
      return { ok: false, stage: 'verifier', error: error instanceof Error ? error.message : String(error) };
    }
    const readOnlyScript = readOnly ? `; chmod -R a-w '${target}'` : '';
    const copyScript = `set -e; mkdir -p '${target}'; cd '${toWslPath(cwd)}'; tar --exclude=.git --exclude=.dsh --exclude=.stryker-tmp -cf - . | tar -xf - -C '${target}'${readOnlyScript}`;
    const copy = await runWsl(['-d', distro, '--exec', 'bash', '-lc', copyScript], { timeoutMs });
    if (!copy.ok) return { ok: false, stage: 'copy', error: copy.stderr.trim() || copy.stdout.trim() || 'copy failed' };
    const planCopy = await runWsl(['-d', distro, '--exec', 'cp', toWslPath(planAbsolute), plan], { timeoutMs: 30_000 });
    if (!planCopy.ok) return { ok: false, stage: 'plan', error: planCopy.stderr.trim() || 'plan copy failed' };

    const verifyArgs = [
      `${verifier}/bin/verify.js`,
      '--plan', plan,
      '--cwd', target,
      '--json',
      ...(readOnly ? ['--no-artifacts'] : []),
    ];
    const prefix = network === 'none' ? ['unshare', '-n'] : [];
    const privilege = runAsUser === null
      ? []
      : ['setpriv', `--reuid=${runAsUser}`, '--regid=nogroup', '--clear-groups', 'env', 'HOME=/tmp'];
    const run = await runWsl(['-d', distro, '--exec', ...prefix, ...privilege, node, ...verifyArgs], { timeoutMs });
    let verdict = null;
    try {
      verdict = JSON.parse(run.stdout);
    } catch {
      /* keep raw output for diagnostics */
    }
    return {
      ok: run.ok && verdict !== null && verdict.verdict?.status === 'pass',
      stage: run.ok ? 'done' : 'verify',
      exitCode: run.exitCode,
      verdict: verdict?.verdict ?? null,
      stdout: run.stdout,
      stderr: run.stderr,
      temp: keep ? temp : undefined,
    };
  } finally {
    if (!keep) await runWsl(['-d', distro, '--exec', 'rm', '-rf', temp], { timeoutMs: 30_000 });
  }
}
