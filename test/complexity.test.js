import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { classifyChange, isNonCodePath, selectFastPath } from '../lib/complexity.js';

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

test('documentation-only changes take the fast path; source changes do not', async (t) => {
  const gitPath = await findGit();
  if (gitPath === null) {
    t.skip('git is not available');
    return;
  }
  assert.equal(isNonCodePath('docs/readme.md'), true);
  assert.equal(isNonCodePath('src/app.js'), false);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-complexity-'));
  const git = (args) => run(gitPath, args, { cwd: dir, timeout: 10_000 });
  await git(['init']);
  await git(['config', 'user.email', 'test@example.invalid']);
  await git(['config', 'user.name', 'Test']);
  await fs.mkdir(path.join(dir, 'docs'));
  await fs.mkdir(path.join(dir, 'src'));
  await fs.writeFile(path.join(dir, 'docs', 'readme.md'), '# base\n', 'utf8');
  await fs.writeFile(path.join(dir, 'src', 'app.js'), 'export const value = 1;\n', 'utf8');
  await git(['add', '.']);
  await git(['commit', '-m', 'base']);

  const fastPath = {
    enabled: true,
    maxFiles: 5,
    maxLines: 80,
    allowPaths: ['docs/', 'README.md'],
    checks: ['syntax'],
  };
  await fs.writeFile(path.join(dir, 'docs', 'readme.md'), '# updated\n', 'utf8');
  const docs = await classifyChange({ cwd: dir, fastPath, gitPath });
  assert.equal(docs.available, true);
  assert.equal(docs.simple, true);
  assert.equal(docs.docsOnly, true);
  assert.deepEqual(docs.selected, ['syntax']);

  await git(['checkout', '--', '.']);
  await fs.writeFile(path.join(dir, 'src', 'app.js'), 'export const value = 2;\n', 'utf8');
  const source = await classifyChange({ cwd: dir, fastPath, gitPath });
  assert.equal(source.simple, false);
  assert.equal(source.selected, null);

  await git(['checkout', '--', '.']);
  await fs.writeFile(path.join(dir, 'docs', 'readme.md'), '# updated again\n', 'utf8');
  const project = {
    plan: { id: 'p', checks: [{ id: 'syntax' }, { id: 'unit' }] },
    fastPath,
  };
  const selected = await selectFastPath({ cwd: dir, project, config: { gitPath } });
  await fs.rm(dir, { recursive: true, force: true });
  assert.deepEqual(selected.ids, ['syntax']);
  assert.equal(selected.classification.docsOnly, true);
});

test('complexity falls back to a snapshot without git', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-complexity-no-git-'));
  await fs.writeFile(path.join(dir, 'README.md'), '# base\n', 'utf8');
  const fastPath = { enabled: true, maxFiles: 3, maxLines: 80, allowPaths: ['README.md'], checks: ['x'] };
  const baseline = await classifyChange({ cwd: dir, fastPath, gitPath: 'definitely-not-git' });
  assert.equal(baseline.available, false);
  assert.match(baseline.reason, /baseline/);
  await fs.writeFile(path.join(dir, 'README.md'), '# updated with more text\n', 'utf8');
  const changed = await classifyChange({ cwd: dir, fastPath, gitPath: 'definitely-not-git' });
  assert.equal(changed.available, true);
  assert.equal(changed.simple, true);
  assert.equal(changed.source, 'snapshot');
  assert.deepEqual(changed.selected, ['x']);
  assert.equal(await selectFastPath({ cwd: dir, project: { plan: { checks: [] } }, config: {} }), null);
  await fs.rm(dir, { recursive: true, force: true });
});
