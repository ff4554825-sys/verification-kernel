import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runTestPatchDocker } from '../lib/test-patch-docker.js';

const run = promisify(execFile);
const GIT_CANDIDATES = [process.env.GIT_EXECUTABLE, 'git', 'D:\\workbuddy\\resources\\vendor\\PortableGit\\cmd\\git.exe'].filter(Boolean);
const WSL = process.env.WSL_EXECUTABLE || 'C:\\Windows\\System32\\wsl.exe';
const DISTRO = process.env.WSL_DISTRO || 'Ubuntu-22.04';
const IMAGE = process.env.DSH_TEST_IMAGE || 'ubuntu-base:local';

async function findGit() {
  for (const candidate of GIT_CANDIDATES) {
    try {
      await run(candidate, ['--version'], { timeout: 5_000 });
      return candidate;
    } catch {
      /* next */
    }
  }
  return null;
}

async function dockerReady() {
  try {
    await run(WSL, ['-d', DISTRO, '--exec', 'docker', 'image', 'inspect', IMAGE], { timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

test('runTestPatchDocker runs in a network-disabled container', async (t) => {
  if (!(await dockerReady())) {
    t.skip(`Docker image ${IMAGE} is not available`);
    return;
  }
  const gitPath = await findGit();
  if (gitPath === null) {
    t.skip('git is not available');
    return;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-test-patch-docker-'));
  const git = (args) => run(gitPath, args, { cwd: dir, timeout: 10_000 });
  await git(['init']);
  await git(['config', 'user.email', 'test@example.invalid']);
  await git(['config', 'user.name', 'Test']);
  await fs.writeFile(path.join(dir, 'value.js'), 'module.exports = 1;\n', 'utf8');
  await git(['add', '.']);
  await git(['commit', '-m', 'base']);
  await fs.writeFile(path.join(dir, 'value.js'), 'module.exports = 2;\n', 'utf8');
  const { stdout: patch } = await git(['diff']);
  const patchFile = path.join(dir, 'fix.patch');
  await fs.writeFile(patchFile, patch, 'utf8');
  await fs.writeFile(path.join(dir, 'value.js'), 'module.exports = 1;\n', 'utf8');

  const success = await runTestPatchDocker({
    cwd: dir,
    distro: DISTRO,
    image: IMAGE,
    patchPath: patchFile,
    command: ['node', '-e', "process.exit(require('./value.js') === 2 ? 0 : 1)"],
  });
  assert.equal(success.ok, true, success.error ?? success.stderr);
  assert.equal(success.stage, 'done');
  assert.match(await fs.readFile(path.join(dir, 'value.js'), 'utf8'), /1/);

  const failure = await runTestPatchDocker({
    cwd: dir,
    distro: DISTRO,
    image: IMAGE,
    patchPath: patchFile,
    command: ['node', '-e', 'process.exit(3)'],
  });
  assert.equal(failure.ok, false);
  assert.equal(failure.stage, 'test');
  assert.equal(failure.exitCode, 3);
  await fs.rm(dir, { recursive: true, force: true });
});
