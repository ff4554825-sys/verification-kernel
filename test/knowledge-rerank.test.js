import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { indexKnowledge, searchKnowledge } from '../lib/knowledge.js';

test('learned policy can rerank local knowledge results', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-knowledge-rerank-'));
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.writeFile(path.join(root, 'docs', 'a.md'), '# Alpha A\nalpha best practices\n', 'utf8');
  await fs.writeFile(path.join(root, 'docs', 'b.md'), '# Alpha B\nalpha best practices\n', 'utf8');
  await indexKnowledge({ root });
  await fs.mkdir(path.join(root, '.dsh', 'learning'), { recursive: true });
  await fs.writeFile(path.join(root, '.dsh', 'learning', 'retrieval-policy.json'), JSON.stringify({
    version: 1,
    baseline: 0,
    weights: { 'doc:docs/b.md': 10, 'term:alpha': 0.5 },
    history: [],
  }), 'utf8');
  const result = await searchKnowledge({ root, query: 'alpha best practices', limit: 2 });
  assert.equal(result.results[0].path, 'docs/b.md');
  assert.equal(result.results[0].learnedBoost, 10.5);
  assert.equal(result.results[0].adjustedScore, Number((result.results[0].score - 10.5).toFixed(6)));
  await fs.rm(root, { recursive: true, force: true });
});
