import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { REVIEW_SCHEMA, normalizeReviews, reviewedIds } from '../lib/golden-review.js';

const run = promisify(execFile);

const ids = ['slugify-v1', 'clamp-v2'];

test('a review record needs a reviewer, a date, and a note', () => {
  const { reviews, errors } = normalizeReviews({
    schema: REVIEW_SCHEMA,
    tasks: {
      'slugify-v1': { by: 'ff4554825-sys', at: '2026-11-17', note: 'held-out test adds the edge cases the visible test misses' },
      'clamp-v2': { by: '', at: '2026-11-17', note: '' },
    },
  }, ids);
  assert.deepEqual(errors.sort(), [
    'review for clamp-v2 needs a note saying what was checked',
    'review for clamp-v2 needs a reviewer',
  ]);
  assert.deepEqual(Object.keys(reviews), ['slugify-v1']);
});

test('a review for a task that no longer exists is an error, not a silent drop', () => {
  const { errors } = normalizeReviews({
    schema: REVIEW_SCHEMA,
    tasks: { 'gone-v1': { by: 'x', at: '2026-11-17', note: 'reviewed' } },
  }, ids);
  assert.deepEqual(errors, ['reviewed.json names an unknown task: gone-v1']);
});

test('an unknown schema version and a malformed file are rejected', () => {
  assert.deepEqual(normalizeReviews({ schema: 99, tasks: {} }, ids).errors, ['reviewed.json schema 99 is not 1']);
  assert.deepEqual(normalizeReviews(null, ids).errors, ['reviewed.json must be an object']);
  assert.deepEqual(normalizeReviews({ schema: 1, tasks: 'x' }, ids).errors, ['reviewed.json tasks must be an object']);
});

test('reviewedIds follows manifest order and ignores unreviewed tasks', () => {
  const reviews = { 'clamp-v2': { by: 'x', at: '2026-11-17', note: 'ok' } };
  assert.deepEqual(reviewedIds([{ id: 'slugify-v1' }, { id: 'clamp-v2' }], reviews), ['clamp-v2']);
  assert.deepEqual(reviewedIds([], reviews), []);
  assert.deepEqual(reviewedIds(null, null), []);
});

test('the shipped review file is valid and covers every task', async () => {
  const fs = await import('node:fs/promises');
  const raw = JSON.parse(await fs.readFile(path.resolve('golden/reviewed.json'), 'utf8'));
  const manifest = JSON.parse(await fs.readFile(path.resolve('golden/manifest.json'), 'utf8'));
  const ids = manifest.tasks.map((task) => task.id);
  const { reviews, errors } = normalizeReviews(raw, ids);
  assert.deepEqual(errors, []);
  for (const id of ids) assert.ok(Object.hasOwn(reviews, id), `${id} is unreviewed`);
  for (const entry of Object.values(reviews)) {
    assert.ok(entry.note.length > 10, 'a review note must say what was checked');
  }
});

test('--only-reviewed refuses to report when no task has been reviewed', async () => {
  const fs = await import('node:fs/promises');
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-review-empty-'));
  try {
    const empty = path.join(cwd, 'reviewed.json');
    await fs.writeFile(empty, JSON.stringify({ schema: 1, tasks: {} }), 'utf8');
    await assert.rejects(
      run(process.execPath, [path.resolve('golden/run.js'), '--only-reviewed'], {
        timeout: 60_000,
        env: { ...process.env, GOLDEN_REVIEWED_FILE: empty },
      }),
      (error) => error.code === 1 && /no human-reviewed tasks/.test(String(error.stderr)),
    );
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('--only-reviewed runs the full set once every task is reviewed', async () => {
  const { stdout } = await run(process.execPath, [path.resolve('golden/run.js'), '--only-reviewed'], { timeout: 120_000 });
  assert.match(stdout, /Reviewed: 20\/20 human-confirmed \(restricted to these\)/);
});
