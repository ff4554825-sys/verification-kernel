import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildReviewPacket, formatReviewPrompt } from '../lib/review.js';

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

test('buildReviewPacket includes diff, files, and repository rules', async (t) => {
  const gitPath = await findGit();
  if (gitPath === null) {
    t.skip('git is not available');
    return;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-review-'));
  const git = (args) => run(gitPath, args, { cwd: dir, timeout: 10_000 });
  await git(['init']);
  await git(['config', 'user.email', 'test@example.invalid']);
  await git(['config', 'user.name', 'Test']);
  await fs.writeFile(path.join(dir, 'src.js'), 'one\n', 'utf8');
  await fs.writeFile(path.join(dir, 'README.md'), '# Rules\nDo not edit unrelated files.\n', 'utf8');
  await fs.mkdir(path.join(dir, '.agents', 'skills'), { recursive: true });
  await fs.writeFile(path.join(dir, '.agents', 'skills', 'custom-codereview-guide.md'), 'Check repository-specific invariants.\n', 'utf8');
  await git(['add', '.']);
  await git(['commit', '-m', 'base']);
  await fs.writeFile(path.join(dir, 'src.js'), 'one\ntwo\n', 'utf8');
  const packet = await buildReviewPacket({ cwd: dir, gitPath });
  assert.equal(packet.totals.files, 1);
  assert.match(packet.diff, /\+two/);
  assert.ok(packet.rules.some((rule) => rule.path === 'README.md'));
  assert.ok(packet.rules.some((rule) => rule.path === '.agents/skills/custom-codereview-guide.md'));
  const prompt = formatReviewPrompt(packet);
  assert.match(prompt, /custom-codereview-guide/);
  assert.match(prompt, /Read-only repo review/);
  assert.match(prompt, /Do not edit files/);
  assert.match(prompt, /src\.js/);
  await fs.rm(dir, { recursive: true, force: true });
});
