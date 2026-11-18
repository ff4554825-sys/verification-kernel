#!/usr/bin/env node
/** CLI: apply a patch to a detached git worktree and run a test command. */

import path from 'node:path';
import process from 'node:process';
import { runTestPatch } from '../lib/test-patch.js';
import { runTestPatchWsl } from '../lib/test-patch-wsl.js';
import { runTestPatchDocker } from '../lib/test-patch-docker.js';

function usage() {
  return [
    'Usage: dsh-test-patch --patch <file> --cmd <argv> [--arg <argv>]... [--cwd <dir>] [--base <rev>] [--git <path>] [--json]',
    '       dsh-test-patch --wsl [--distro Ubuntu-22.04] --patch <file> --cmd <linux-argv> [--arg <argv>]... [--json]',
    '       dsh-test-patch --docker [--image ubuntu-base:local] --patch <file> --cmd <linux-argv> [--arg <argv>]... [--json]',
    '',
    'Example: dsh-test-patch --patch fix.patch --cmd node --arg --test',
    'WSL:     dsh-test-patch --wsl --patch fix.patch --cmd node --arg --test',
    'Docker:  dsh-test-patch --docker --patch fix.patch --cmd node --arg --test',
    '',
    'The original working tree is not modified. The default adapter is a git',
    'worktree; --wsl uses a WSL2 temp dir; --docker runs in a network-disabled',
    'container inside WSL2.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    cwd: process.cwd(),
    base: 'HEAD',
    patch: '',
    gitPath: process.env.GIT_EXECUTABLE || 'git',
    command: [],
    json: false,
    wsl: false,
    docker: false,
    image: process.env.DSH_TEST_IMAGE || 'ubuntu-base:local',
    distro: process.env.WSL_DISTRO || 'Ubuntu-22.04',
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--cwd') options.cwd = path.resolve(argv[++index] ?? '.');
    else if (arg === '--base') options.base = argv[++index] ?? options.base;
    else if (arg === '--patch') options.patch = argv[++index] ?? '';
    else if (arg === '--git') options.gitPath = argv[++index] ?? options.gitPath;
    else if (arg === '--wsl') options.wsl = true;
    else if (arg === '--docker') options.docker = true;
    else if (arg === '--image') options.image = argv[++index] ?? options.image;
    else if (arg === '--distro') options.distro = argv[++index] ?? options.distro;
    else if (arg === '--cmd') options.command.push(argv[++index] ?? '');
    else if (arg === '--arg') options.command.push(argv[++index] ?? '');
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (options.help || options.patch === '' || options.command.length === 0) {
    console.log(usage());
    process.exitCode = options.help ? 0 : 2;
    return;
  }
  try {
    const result = options.docker
      ? await runTestPatchDocker({
        cwd: options.cwd,
        distro: options.distro,
        image: options.image,
        patchPath: options.patch,
        command: options.command,
      })
      : options.wsl
        ? await runTestPatchWsl({
          cwd: options.cwd,
          distro: options.distro,
          patchPath: options.patch,
          command: options.command,
        })
        : await runTestPatch({
          cwd: options.cwd,
          gitPath: options.gitPath,
          base: options.base,
          patchPath: options.patch,
          command: options.command,
        });
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Test-patch: ${result.ok ? 'PASS' : 'FAIL'} (${result.stage ?? 'error'})`);
      if (result.error) console.log(result.error);
      if (result.exitCode !== undefined) console.log(`Exit: ${result.exitCode}`);
      if (result.stdout) console.log(result.stdout);
      if (result.stderr) console.error(result.stderr);
    }
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(`Test-patch failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

await main();
