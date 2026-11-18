import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runTestPatch } from '../lib/test-patch.js';

const run = promisify(execFile);
const NODE = process.execPath;
const GIT_CANDIDATES = [process.env.GIT_EXECUTABLE, 'git', 'D:\\workbuddy\\resources\\vendor\\PortableGit\\cmd\\git.exe'].filter(Boolean);

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

test('runTestPatch applies in a worktree without changing the original', async (t) => {
  const gitPath = await findGit();
  if (gitPath === null) {
    t.skip('git is not available');
    return;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-test-patch-'));
  const git = (args, options = {}) => run(gitPath, args, { cwd: dir, timeout: 10_000, ...options });
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

  const success = await runTestPatch({
    cwd: dir,
    gitPath,
    patchPath: patchFile,
    command: [NODE, '-e', "process.exit(require('./value.js') === 2 ? 0 : 1)"],
  });
  assert.equal(success.ok, true);
  assert.equal(success.stage, 'done');
  assert.match(await fs.readFile(path.join(dir, 'value.js'), 'utf8'), /1/);

  const failure = await runTestPatch({
    cwd: dir,
    gitPath,
    patchPath: patchFile,
    command: [NODE, '-e', 'process.exit(3)'],
  });
  assert.equal(failure.ok, false);
  assert.equal(failure.stage, 'test');
  assert.equal(failure.exitCode, 3);
  await fs.rm(dir, { recursive: true, force: true });
});
