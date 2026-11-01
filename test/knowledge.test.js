import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { indexKnowledge, searchKnowledge } from '../lib/knowledge.js';

test('local knowledge base indexes docs, searches Latin/CJK, and refreshes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-knowledge-'));
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.writeFile(path.join(root, 'docs', 'guide.md'), [
    '# Verification guide',
    'Use evidence and deterministic checks before claiming completion.',
    '验证系统需要证据和确定性检查。',
  ].join('\n'), 'utf8');
  await fs.writeFile(path.join(root, 'AGENTS.md'), '# Rules\nAlways run tests.\n', 'utf8');
  const first = await indexKnowledge({ root });
  assert.ok(first.chunks >= 2);
  const english = await searchKnowledge({ root, query: 'deterministic evidence' });
  assert.ok(english.results.some((item) => item.path === 'docs/guide.md'));
  assert.match(english.results[0].snippet, /evidence|deterministic/i);
  const chinese = await searchKnowledge({ root, query: '验证 证据' });
  assert.ok(chinese.results.some((item) => item.path === 'docs/guide.md'));
  const cached = await indexKnowledge({ root });
  assert.equal(cached.rebuilt, false);

  await fs.writeFile(path.join(root, 'docs', 'guide.md'), '# Verification guide\nNew unique term: quasar.\n', 'utf8');
  const refreshed = await indexKnowledge({ root });
  assert.equal(refreshed.rebuilt, true);
  const quasar = await searchKnowledge({ root, query: 'quasar' });
  assert.equal(quasar.results[0].path, 'docs/guide.md');
  await fs.rm(root, { recursive: true, force: true });
});
