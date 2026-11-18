import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SUBCOMMANDS, subcommandNames } from '../lib/cli.js';

/**
 * Documentation that names a command or a file which does not exist is worse
 * than no documentation: it fails exactly when someone trusts it. Four drifts
 * in docs/verifier-borrowings.md were fixed by hand this month; this makes the
 * fifth one fail the build instead.
 *
 * Only commands are checked — the first word of a line inside a fenced block,
 * or an inline code span that is a bare command. Plugin names such as
 * `@local/dsh-verification-kernel` and paths such as `.dsh/dsh-runtimes` share
 * the `dsh-` prefix and must not be treated as executables.
 */

const ROOT = path.resolve('.');
const SUBCOMMAND_SET = new Set(subcommandNames());
const PATH_PREFIXES = ['bin/', 'lib/', 'test/', 'golden/', 'scripts/', 'ci/', 'policies/', 'presets/'];

/**
 * Commands from other plugins that these docs describe but this package does
 * not ship. They are checked by hand; adding one here is a deliberate act, not
 * a way to silence a missing binary.
 */
const EXTERNAL_COMMANDS = new Set([
  'dsh-stall-guard',
  'dsh-session-purge',
  'dsh-market',
  'dsh-node-global',
  'dsh-verification-preset',
]);

async function markdownFiles() {
  const docs = await fs.readdir(path.join(ROOT, 'docs'));
  const files = ['README.md', 'CHANGELOG.md'];
  for (const name of docs) {
    if (name.endsWith('.md')) files.push(path.join('docs', name));
  }
  return files;
}

async function binNames() {
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  return new Set(Object.keys(pkg.bin ?? {}));
}

/** Split a markdown file into fenced code lines and inline code spans, with line numbers. */
function extract(text) {
  const fenced = [];
  const spans = [];
  let inFence = false;
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      const trimmed = line.trim().replace(/^\$\s+/, '');
      if (trimmed !== '') fenced.push({ text: trimmed, number: index + 1 });
      continue;
    }
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      spans.push({ text: match[1].trim(), number: index + 1 });
    }
  }
  return { fenced, spans };
}

function commandWords(entry) {
  const words = entry.split(/\s+/);
  const raw = words[0];
  // `dsh-verify: pass` is a health-check key/value, not a command.
  const isKeyValue = raw.endsWith(':');
  const head = raw.replace(/['"`,;:]+$/g, '');
  return { head, rest: words.slice(1), isKeyValue };
}

test('every command named in the docs exists', async () => {
  const bins = await binNames();
  const problems = [];
  for (const file of await markdownFiles()) {
    const { fenced, spans } = extract(await fs.readFile(path.join(ROOT, file), 'utf8'));
    for (const entry of [...fenced, ...spans]) {
      const { head, rest, isKeyValue } = commandWords(entry.text);
      if (isKeyValue || !head.startsWith('dsh-')) continue;
      // `dsh-tools/lib/index.js` is a path to another package, not a command.
      if (/[\\/]/.test(entry.text)) continue;
      if (!bins.has(head) && !EXTERNAL_COMMANDS.has(head)) {
        problems.push(`${file}:${entry.number} runs ${head}, which is not a package.json bin`);
        continue;
      }
      if (head === 'dsh-verify' && rest.length > 0 && /^[a-z]/.test(rest[0])) {
        // `dsh-verify <sub>`: either a subcommand or the first value of a flag.
        const sub = rest[0];
        if (!SUBCOMMAND_SET.has(sub) && !sub.startsWith('-') && !entry.text.includes('--')) {
          problems.push(`${file}:${entry.number} uses 'dsh-verify ${sub}', which is not a subcommand (${[...SUBCOMMAND_SET].join(', ')})`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('every subcommand is reachable through the facade', () => {
  for (const [name, script] of Object.entries(SUBCOMMANDS)) {
    assert.ok(script.endsWith('.js'), `${name} maps to a script`);
    assert.ok(SUBCOMMAND_SET.has(name));
  }
  assert.ok(SUBCOMMAND_SET.has('run'));
});

test('--help lists every subcommand', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const { stdout } = await run(process.execPath, [path.join(ROOT, 'bin/verify.js'), '--help'], { timeout: 20_000 });
  for (const name of subcommandNames()) {
    assert.ok(stdout.includes(name), `--help omits '${name}'`);
  }
});

test('repository paths named in fenced commands exist', async () => {
  const problems = [];
  for (const file of await markdownFiles()) {
    const { fenced } = extract(await fs.readFile(path.join(ROOT, file), 'utf8'));
    for (const entry of fenced) {
      // Only shell-looking lines: a YAML/JSON block may name files of another project.
      if (!/^(node|bash|sh|dsh-|npx|java|git|\.\/)/.test(entry.text)) continue;
      for (const word of entry.text.split(/\s+/)) {
        const candidate = word.replace(/^[\s'"[({]+/, '').replace(/[.,;:'")\]}]+$/, '');
        if (!PATH_PREFIXES.some((prefix) => candidate.startsWith(prefix))) continue;
        if (candidate.includes('<') || candidate.includes('*')) continue;
        try {
          await fs.access(path.join(ROOT, candidate));
        } catch {
          problems.push(`${file}:${entry.number} references ${candidate}, which does not exist`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});
