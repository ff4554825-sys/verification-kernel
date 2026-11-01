import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { auditDiff, collectDiff, matchesPath } from '../lib/diff.js';

const GIT_CANDIDATES = [
  process.env.GIT_EXECUTABLE,
  'git',
  'D:\\workbuddy\\resources\\vendor\\PortableGit\\cmd\\git.exe',
].filter(Boolean);

async function findGit() {
  for (const candidate of GIT_CANDIDATES) {
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      await promisify(execFile)(candidate, ['--version'], { timeout: 5_000 });
      return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

test('matchesPath supports prefixes and simple globs', () => {
  assert.equal(matchesPath('src/a.js', 'src/'), true);
  assert.equal(matchesPath('src/a.js', 'src'), true);
  assert.equal(matchesPath('src/a.js', 'test/'), false);
  assert.equal(matchesPath('src/deep/a.js', 'src/*.js'), false);
  assert.equal(matchesPath('src/deep/a.js', 'src/**/*.js'), true);
});

test('auditDiff reports scope, deny, and budget violations', () => {
  const diff = {
    files: [
      { path: 'src/a.js', added: 10, deleted: 1 },
      { path: 'README.md', added: 2, deleted: 0 },
      { path: 'docs/x.md', added: 3, deleted: 0 },
      { path: 'node_modules/x.js', added: 99, deleted: 0 },
    ],
  };
  const audit = auditDiff(diff, { allow: ['src/'], deny: ['README.md'], maxFiles: 1, maxLines: 100 });
  assert.equal(audit.ok, false);
  assert.equal(audit.totals.files, 3);
  assert.ok(audit.violations.some((violation) => violation.kind === 'denied-path'));
  assert.ok(audit.violations.some((violation) => violation.kind === 'outside-scope'));
  assert.ok(audit.ignored.includes('node_modules/x.js'));
});

test('collectDiff reads tracked and untracked changes', async (t) => {
  const gitPath = await findGit();
  if (gitPath === null) {
    t.skip('git is not available');
    return;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-diff-'));
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const git = (args) => run(gitPath, args, { cwd: dir, timeout: 10_000 });
  await git(['init']);
  await git(['config', 'user.email', 'test@example.invalid']);
  await git(['config', 'user.name', 'Test']);
  await fs.writeFile(path.join(dir, 'src.js'), 'one\n', 'utf8');
  await git(['add', '.']);
  await git(['commit', '-m', 'base']);
  await fs.writeFile(path.join(dir, 'src.js'), 'one\ntwo\n', 'utf8');
  await fs.writeFile(path.join(dir, 'new.js'), 'a\nb\n', 'utf8');
  const diff = await collectDiff({ cwd: dir, gitPath });
  assert.equal(diff.root.length > 0, true);
  const names = diff.files.map((file) => file.path);
  assert.ok(names.includes('src.js'));
  assert.ok(names.includes('new.js'));
  const audit = auditDiff(diff, { allow: ['src.js'], maxFiles: 2, maxLines: 10 });
  assert.equal(audit.ok, false);
  assert.ok(audit.violations.some((violation) => violation.path === 'new.js'));
  await fs.rm(dir, { recursive: true, force: true });
});
