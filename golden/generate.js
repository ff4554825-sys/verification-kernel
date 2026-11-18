/**
 * Generate the golden set: 10 small JS tasks × 2 variants = 20 tasks.
 *
 * Each task has a visible test, a held-out test, and three candidates:
 *   - good:        passes both
 *   - bad-visible: fails the visible test
 *   - bad-hidden:  passes the visible test, fails the held-out test
 *
 * The benchmark uses the last kind to show why independent checks matter.
 * These cases measure the verifier's mechanics, not a model's coding ability.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tasksDir = path.join(here, 'tasks');
const heldoutDir = path.join(here, 'heldout');

const templates = [
  {
    id: 'sum-even',
    title: 'Sum even numbers',
    signature: 'sumEven(values)',
    name: 'sumEven',
    good: String.raw`export function sumEven(values) {
  return values.filter((value) => value % 2 === 0).reduce((sum, value) => sum + value, 0);
}`,
    badVisible: String.raw`export function sumEven(values) {
  return values.filter((value) => value % 2 === 1).reduce((sum, value) => sum + value, 0);
}`,
    badHidden: String.raw`export function sumEven(values) {
  return values.filter((value) => value > 0 && value % 2 === 0).reduce((sum, value) => sum + value, 0);
}`,
    visible: [
      { args: [[1, 2, 3, 4]], expected: 6 },
      { args: [[]], expected: 0 },
      { args: [[2, 4]], expected: 6 },
    ],
    hidden: [
      { args: [[-2, 4, 5]], expected: 2 },
      { args: [[-3, -1]], expected: 0 },
    ],
    extraVisible: [{ args: [[10, 11, 12]], expected: 22 }],
    extraHidden: [{ args: [[-4, 6, 7]], expected: 2 }],
  },
  {
    id: 'slugify',
    title: 'Slugify text',
    signature: 'slugify(text)',
    name: 'slugify',
    good: String.raw`export function slugify(text) {
  return String(text).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}`,
    badVisible: String.raw`export function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}`,
    badHidden: String.raw`export function slugify(text) {
  return String(text).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}`,
    visible: [
      { args: ['Hello World'], expected: 'hello-world' },
      { args: ['DSH 2026'], expected: 'dsh-2026' },
    ],
    hidden: [
      { args: ['--Hi--'], expected: 'hi' },
      { args: ['  A  B  '], expected: 'a-b' },
    ],
    extraVisible: [{ args: ['A B'], expected: 'a-b' }],
    extraHidden: [{ args: ['((Hi))'], expected: 'hi' }],
  },
  {
    id: 'parse-duration',
    title: 'Parse a duration',
    signature: 'parseDuration(text)',
    name: 'parseDuration',
    good: String.raw`export function parseDuration(text) {
  const match = String(text).trim().match(/^(\d+)\s*([hms])$/i);
  if (match === null) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  return unit === 'h' ? value * 3600 : unit === 'm' ? value * 60 : value;
}`,
    badVisible: String.raw`export function parseDuration(text) {
  return String(text);
}`,
    badHidden: String.raw`export function parseDuration(text) {
  const match = String(text).trim().match(/^(\d+)\s*([hm])$/i);
  if (match === null) return null;
  const value = Number(match[1]);
  return match[2].toLowerCase() === 'h' ? value * 3600 : value * 60;
}`,
    visible: [
      { args: ['5m'], expected: 300 },
      { args: ['2h'], expected: 7200 },
    ],
    hidden: [
      { args: ['30s'], expected: 30 },
      { args: ['bad'], expected: null },
    ],
    extraVisible: [{ args: ['3h'], expected: 10800 }],
    extraHidden: [{ args: ['10s'], expected: 10 }],
  },
  {
    id: 'chunk',
    title: 'Chunk an array',
    signature: 'chunk(values, size)',
    name: 'chunk',
    good: String.raw`export function chunk(values, size) {
  if (!Number.isInteger(size) || size <= 0) return [];
  const out = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}`,
    badVisible: String.raw`export function chunk(values, size) {
  return [values];
}`,
    badHidden: String.raw`export function chunk(values, size) {
  if (!Number.isInteger(size) || size <= 0) return [];
  const out = [];
  for (let index = 0; index + size <= values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}`,
    visible: [
      { args: [[1, 2, 3, 4], 2], expected: [[1, 2], [3, 4]] },
      { args: [[1, 2, 3, 4], 4], expected: [[1, 2, 3, 4]] },
    ],
    hidden: [
      { args: [[1, 2, 3, 4, 5], 2], expected: [[1, 2], [3, 4], [5]] },
      { args: [[1, 2, 3], 2], expected: [[1, 2], [3]] },
    ],
    extraVisible: [{ args: [[9, 8], 1], expected: [[9], [8]] }],
    extraHidden: [{ args: [[7, 6, 5], 4], expected: [[7, 6, 5]] }],
  },
  {
    id: 'get-path',
    title: 'Read a nested path',
    signature: 'getPath(object, path)',
    name: 'getPath',
    good: String.raw`export function getPath(object, path) {
  let current = object;
  for (const key of String(path).split('.')) {
    if (current === null || current === undefined) return undefined;
    current = current[key];
  }
  return current;
}`,
    badVisible: String.raw`export function getPath(object, path) {
  return object[path];
}`,
    badHidden: String.raw`export function getPath(object, path) {
  let current = object;
  for (const key of String(path).split('.')) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) return undefined;
    current = current[key];
  }
  return current;
}`,
    visible: [
      { args: [{ a: { b: 1 } }, 'a.b'], expected: 1 },
      { args: [{ a: { b: 2 } }, 'a.b'], expected: 2 },
    ],
    hidden: [
      { args: [{ items: [{ id: 1 }] }, 'items.0.id'], expected: 1 },
      { args: [{ list: [10, 20] }, 'list.1'], expected: 20 },
    ],
    extraVisible: [{ args: [{ x: 3 }, 'x'], expected: 3 }],
    extraHidden: [{ args: [{ rows: [{ v: 7 }] }, 'rows.0.v'], expected: 7 }],
  },
  {
    id: 'clamp',
    title: 'Clamp a number',
    signature: 'clamp(value, min, max)',
    name: 'clamp',
    good: String.raw`export function clamp(value, min, max) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.min(high, Math.max(low, value));
}`,
    badVisible: String.raw`export function clamp(value, min, max) {
  return value;
}`,
    badHidden: String.raw`export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}`,
    visible: [
      { args: [5, 0, 10], expected: 5 },
      { args: [-1, 0, 10], expected: 0 },
      { args: [11, 0, 10], expected: 10 },
    ],
    hidden: [
      { args: [5, 10, 0], expected: 5 },
      { args: [7, 10, 0], expected: 7 },
    ],
    extraVisible: [{ args: [7, 0, 10], expected: 7 }],
    extraHidden: [{ args: [3, 10, 0], expected: 3 }],
  },
  {
    id: 'unique-by',
    title: 'Deduplicate by key',
    signature: 'uniqueBy(values, key)',
    name: 'uniqueBy',
    good: String.raw`export function uniqueBy(values, key) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const id = typeof key === 'function' ? key(value) : value[key];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(value);
  }
  return out;
}`,
    badVisible: String.raw`export function uniqueBy(values, key) {
  return values;
}`,
    badHidden: String.raw`export function uniqueBy(values, key) {
  const index = new Map();
  for (const value of values) {
    const id = typeof key === 'function' ? key(value) : value[key];
    index.set(id, value);
  }
  return [...index.values()];
}`,
    visible: [
      {
        args: [[{ id: 1, v: 'a' }, { id: 1, v: 'a' }, { id: 2, v: 'b' }], 'id'],
        expected: [{ id: 1, v: 'a' }, { id: 2, v: 'b' }],
      },
      {
        args: [[{ k: 'x' }, { k: 'x' }], 'k'],
        expected: [{ k: 'x' }],
      },
    ],
    hidden: [
      {
        args: [[{ id: 1, v: 'a' }, { id: 2, v: 'b' }, { id: 1, v: 'c' }], 'id'],
        expected: [{ id: 1, v: 'a' }, { id: 2, v: 'b' }],
      },
      {
        args: [[{ k: 'x', v: 1 }, { k: 'x', v: 2 }], 'k'],
        expected: [{ k: 'x', v: 1 }],
      },
    ],
    extraVisible: [{ args: [[{ z: 1 }, { z: 2 }], 'z'], expected: [{ z: 1 }, { z: 2 }] }],
    extraHidden: [
      {
        args: [[{ z: 1, n: 'first' }, { z: 1, n: 'last' }], 'z'],
        expected: [{ z: 1, n: 'first' }],
      },
    ],
  },
  {
    id: 'title-case',
    title: 'Title-case words',
    signature: 'titleCase(text)',
    name: 'titleCase',
    good: String.raw`export function titleCase(text) {
  return String(text).trim().split(/\s+/).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}`,
    badVisible: String.raw`export function titleCase(text) {
  return String(text).toUpperCase();
}`,
    badHidden: String.raw`export function titleCase(text) {
  const words = String(text).trim().split(/\s+/);
  if (words.length > 0) words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
  return words.join(' ');
}`,
    visible: [
      { args: ['hello'], expected: 'Hello' },
      { args: ['DSH'], expected: 'Dsh' },
    ],
    hidden: [
      { args: ['hello world'], expected: 'Hello World' },
      { args: ['multi word title'], expected: 'Multi Word Title' },
    ],
    extraVisible: [{ args: ['code'], expected: 'Code' }],
    extraHidden: [{ args: ['hello there'], expected: 'Hello There' }],
  },
  {
    id: 'range',
    title: 'Build a numeric range',
    signature: 'range(start, end, step)',
    name: 'range',
    good: String.raw`export function range(start, end, step = 1) {
  if (step === 0) return [];
  const out = [];
  if (step > 0) for (let value = start; value < end; value += step) out.push(value);
  else for (let value = start; value > end; value += step) out.push(value);
  return out;
}`,
    badVisible: String.raw`export function range(start, end, step = 1) {
  return [];
}`,
    badHidden: String.raw`export function range(start, end, step = 1) {
  if (step <= 0) return [];
  const out = [];
  for (let value = start; value < end; value += step) out.push(value);
  return out;
}`,
    visible: [
      { args: [0, 3], expected: [0, 1, 2] },
      { args: [1, 4, 2], expected: [1, 3] },
      { args: [0, 5, 2], expected: [0, 2, 4] },
    ],
    hidden: [
      { args: [3, 0, -1], expected: [3, 2, 1] },
      { args: [5, 0, -2], expected: [5, 3, 1] },
    ],
    extraVisible: [{ args: [2, 5], expected: [2, 3, 4] }],
    extraHidden: [{ args: [4, 0, -2], expected: [4, 2] }],
  },
  {
    id: 'group-by',
    title: 'Group values by key',
    signature: 'groupBy(values, key)',
    name: 'groupBy',
    good: String.raw`export function groupBy(values, key) {
  const out = {};
  for (const value of values) {
    const id = typeof key === 'function' ? key(value) : value[key];
    (out[id] ??= []).push(value);
  }
  return out;
}`,
    badVisible: String.raw`export function groupBy(values, key) {
  return values;
}`,
    badHidden: String.raw`export function groupBy(values, key) {
  const out = {};
  for (const value of values) {
    const id = typeof key === 'function' ? key(value) : value[key];
    out[id] = [value];
  }
  return out;
}`,
    visible: [
      { args: [[{ g: 'a' }, { g: 'b' }], 'g'], expected: { a: [{ g: 'a' }], b: [{ g: 'b' }] } },
      { args: [[{ g: 'x' }], 'g'], expected: { x: [{ g: 'x' }] } },
    ],
    hidden: [
      {
        args: [[{ g: 'a', v: 1 }, { g: 'a', v: 2 }], 'g'],
        expected: { a: [{ g: 'a', v: 1 }, { g: 'a', v: 2 }] },
      },
      {
        args: [[{ g: 'b', v: 1 }, { g: 'b', v: 2 }, { g: 'c', v: 3 }], 'g'],
        expected: {
          b: [{ g: 'b', v: 1 }, { g: 'b', v: 2 }],
          c: [{ g: 'c', v: 3 }],
        },
      },
    ],
    extraVisible: [{ args: [[{ k: 'z' }, { k: 'y' }], 'k'], expected: { z: [{ k: 'z' }], y: [{ k: 'y' }] } }],
    extraHidden: [
      {
        args: [[{ k: 'q', v: 1 }, { k: 'q', v: 2 }], 'k'],
        expected: { q: [{ k: 'q', v: 1 }, { k: 'q', v: 2 }] },
      },
    ],
  },
];

function renderTest(name, cases) {
  const lines = [
    "import assert from 'node:assert/strict';",
    `import { ${name} } from './solution.mjs';`,
    '',
  ];
  for (const testCase of cases) {
    const args = testCase.args.map((arg) => JSON.stringify(arg)).join(', ');
    lines.push(`assert.deepEqual(${name}(${args}), ${JSON.stringify(testCase.expected)});`);
  }
  lines.push("console.log('ok');");
  return `${lines.join('\n')}\n`;
}

function renderTaskMarkdown(template) {
  return [
    `# ${template.title}`,
    '',
    `Implement \`${template.signature}\` in \`solution.mjs\`.`,
    '',
    'Run `node test.mjs` to check your work.',
    '',
  ].join('\n');
}

async function main() {
  await fs.rm(tasksDir, { recursive: true, force: true });
  await fs.rm(heldoutDir, { recursive: true, force: true });
  await fs.mkdir(tasksDir, { recursive: true });
  await fs.mkdir(heldoutDir, { recursive: true });

  const manifest = { generatedAt: new Date().toISOString(), templates: templates.length, tasks: [] };

  for (const template of templates) {
    for (const variant of [1, 2]) {
      const id = `${template.id}-v${variant}`;
      const visible = variant === 1 ? template.visible : [...template.visible, ...(template.extraVisible ?? [])];
      const hidden = variant === 1 ? template.hidden : [...template.hidden, ...(template.extraHidden ?? [])];
      const taskDir = path.join(tasksDir, id);
      await fs.mkdir(taskDir, { recursive: true });
      await fs.writeFile(path.join(taskDir, 'test.mjs'), renderTest(template.name, visible));
      await fs.writeFile(path.join(heldoutDir, `${id}.mjs`), renderTest(template.name, hidden));
      await fs.writeFile(path.join(taskDir, 'solution.good.mjs'), `${template.good}\n`);
      await fs.writeFile(path.join(taskDir, 'solution.bad-visible.mjs'), `${template.badVisible}\n`);
      await fs.writeFile(path.join(taskDir, 'solution.bad-hidden.mjs'), `${template.badHidden}\n`);
      await fs.writeFile(path.join(taskDir, 'task.md'), renderTaskMarkdown(template));
      const plan = {
        id,
        checks: [
          { id: 'visible', argv: ['node', 'test.mjs'], required: true, timeoutMs: 10_000 },
          { id: 'heldout', argv: ['node', 'heldout.mjs'], required: true, timeoutMs: 10_000 },
        ],
      };
      const visibleOnlyPlan = {
        id: `${id}-visible`,
        checks: [{ id: 'visible', argv: ['node', 'test.mjs'], required: true, timeoutMs: 10_000 }],
      };
      const task = {
        id,
        template: template.id,
        variant,
        title: template.title,
        signature: template.signature,
        dir: path.relative(here, taskDir).split(path.sep).join('/'),
        candidates: {
          good: 'solution.good.mjs',
          'bad-visible': 'solution.bad-visible.mjs',
          'bad-hidden': 'solution.bad-hidden.mjs',
        },
        plan,
        visibleOnlyPlan,
      };
      await fs.writeFile(path.join(taskDir, 'task.json'), `${JSON.stringify(task, null, 2)}\n`);
      manifest.tasks.push(task);
    }
  }

  await fs.writeFile(path.join(here, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Generated ${manifest.tasks.length} tasks in ${tasksDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
