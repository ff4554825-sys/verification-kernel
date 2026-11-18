import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runPrCheck } from '../lib/pr-check.js';

const run = promisify(execFile);
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

async function fixture(gitPath) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-pr-check-'));
  const git = (args) => run(gitPath, args, { cwd: dir, timeout: 10_000 });
  await git(['init']);
  await git(['config', 'user.email', 'test@example.invalid']);
  await git(['config', 'user.name', 'Test']);
  await fs.mkdir(path.join(dir, '.agents', 'skills'), { recursive: true });
  await fs.writeFile(path.join(dir, 'app.js'), 'export const value = 1;\n', 'utf8');
  await fs.writeFile(path.join(dir, '.agents', 'skills', 'custom-codereview-guide.md'), 'Check app invariants.\n', 'utf8');
  await git(['add', '.']);
  await git(['commit', '-m', 'base']);
  await fs.writeFile(path.join(dir, 'app.js'), 'export const value = 2;\n', 'utf8');
  return dir;
}

test('PR check builds review packet and runs isolated QA', async (t) => {
  const gitPath = await findGit();
  if (gitPath === null) {
    t.skip('git is not available');
    return;
  }
  const dir = await fixture(gitPath);
  const result = await runPrCheck({
    cwd: dir,
    gitPath,
    qaCommand: [process.execPath, '-e', 'process.exit(0)'],
    outDir: '.dsh/pr-check-test',
  });
  assert.equal(result.status, 'pass');
  assert.equal(result.files, 1);
  assert.equal(result.qa.ok, true);
  assert.ok(result.review.rules.includes('.agents/skills/custom-codereview-guide.md'));
  const prompt = await fs.readFile(result.review.promptPath, 'utf8');
  assert.match(prompt, /Check app invariants/);
  const report = JSON.parse(await fs.readFile(result.reportPath, 'utf8'));
  assert.equal(report.qa.ok, true);
  await fs.rm(dir, { recursive: true, force: true });
});

test('PR check reports QA failure', async (t) => {
  const gitPath = await findGit();
  if (gitPath === null) {
    t.skip('git is not available');
    return;
  }
  const dir = await fixture(gitPath);
  const result = await runPrCheck({
    cwd: dir,
    gitPath,
    qaCommand: [process.execPath, '-e', 'process.exit(3)'],
    outDir: '.dsh/pr-check-test',
  });
  assert.equal(result.status, 'fail');
  assert.equal(result.qa.ok, false);
  assert.equal(result.qa.exitCode, 3);
  await fs.rm(dir, { recursive: true, force: true });
});
