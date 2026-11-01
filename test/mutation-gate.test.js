import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

test('mutation gate computes detected/total and enforces the minimum', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-mutation-gate-'));
  const report = path.join(dir, 'report.json');
  await fs.writeFile(report, JSON.stringify({
    files: {
      'a.js': {
        mutants: [
          { status: 'Killed' },
          { status: 'Killed' },
          { status: 'Timeout' },
          { status: 'Survived' },
        ],
      },
    },
  }), 'utf8');
  const cli = path.resolve('bin/mutation-gate.js');
  const pass = await run(process.execPath, [cli, '--report', report, '--min', '75']);
  assert.match(pass.stdout, /75% \(3\/4 detected; minimum 75%\)/);
  await assert.rejects(run(process.execPath, [cli, '--report', report, '--min', '80']), /Command failed/);
  await fs.rm(dir, { recursive: true, force: true });
});
