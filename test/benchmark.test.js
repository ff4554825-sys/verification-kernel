import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizeManifest, runBenchmark } from '../lib/benchmark.js';

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

test('runBenchmark matches expected pass/fail under worktree isolation', async (t) => {
  const gitPath = await findGit();
  if (gitPath === null) {
    t.skip('git is not available');
    return;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-benchmark-'));
  const git = (args) => run(gitPath, args, { cwd: dir, timeout: 10_000 });
  await git(['init']);
  await git(['config', 'user.email', 'test@example.invalid']);
  await git(['config', 'user.name', 'Test']);
  await fs.writeFile(path.join(dir, 'value.js'), 'module.exports = 1;\n', 'utf8');
  await git(['add', '.']);
  await git(['commit', '-m', 'base']);
  await fs.writeFile(path.join(dir, 'value.js'), 'module.exports = 2;\n', 'utf8');
  const { stdout: fix } = await git(['diff']);
  await fs.writeFile(path.join(dir, 'fix.patch'), fix, 'utf8');
  await fs.writeFile(path.join(dir, 'value.js'), 'module.exports = 3;\n', 'utf8');
  const { stdout: bad } = await git(['diff']);
  await fs.writeFile(path.join(dir, 'bad.patch'), bad, 'utf8');
  await fs.writeFile(path.join(dir, 'value.js'), 'module.exports = 1;\n', 'utf8');

  const raw = {
    tasks: [
      {
        id: 'good',
        cwd: dir,
        patch: 'fix.patch',
        command: [process.execPath, '-e', "process.exit(require('./value.js') === 2 ? 0 : 1)"],
        expected: 'pass',
      },
      {
        id: 'bad',
        cwd: dir,
        patch: 'bad.patch',
        command: [process.execPath, '-e', "process.exit(require('./value.js') === 2 ? 0 : 1)"],
        expected: 'fail',
      },
    ],
  };
  const normalized = normalizeManifest(raw, dir);
  assert.deepEqual(normalized.errors, []);
  const report = await runBenchmark({ manifest: normalized.manifest, isolation: 'worktree', gitPath });
  assert.equal(report.total, 2);
  assert.equal(report.matched, 2);
  assert.equal(report.falseAccept, 0);
  assert.equal(report.falseReject, 0);
  assert.equal(report.escapeRate, 0);
  assert.equal(report.falseRejectRate, 0);
  assert.equal(report.accuracy, 1);
  await fs.rm(dir, { recursive: true, force: true });
});
