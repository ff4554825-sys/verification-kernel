#!/usr/bin/env node
/** Verify the local DSH extension stack (MCP/plugins/CLI), not just repo tests. */

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const profileDir = process.env.DSH_PROFILE_DIR
  ? path.resolve(process.env.DSH_PROFILE_DIR)
  : path.join(os.homedir(), '.dsh', 'profiles', 'desktop');
const globalPrefix = process.env.DSH_GLOBAL_PREFIX ?? 'C:/dsh-node-global';
const home = os.homedir();
const results = [];

function record(id, status, detail) {
  results.push({ id, status, detail });
}

function exists(file) {
  return fs.access(file).then(() => true, () => false);
}

async function findNodeHome() {
  if (process.env.DSH_NODE_HOME) return process.env.DSH_NODE_HOME;
  const winget = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Packages');
  try {
    const dirs = await fs.readdir(winget);
    for (const dir of dirs.filter((name) => name.startsWith('OpenJS.NodeJS.LTS_'))) {
      const base = path.join(winget, dir);
      const versions = await fs.readdir(base);
      for (const version of versions.filter((name) => name.startsWith('node-v'))) {
        const candidate = path.join(base, version);
        if (await exists(path.join(candidate, 'node.exe'))) return candidate;
      }
    }
  } catch {
    /* no winget node */
  }
  return null;
}

async function run(file, args, { timeoutMs = 20_000, env = process.env } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, {
      timeout: timeoutMs,
      windowsHide: true,
      env,
      // Windows .cmd shims (npm/npx/promptfoo) cannot be spawned directly by Node.
      shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(file),
    }, (error, stdout, stderr) => {
      resolve({
        ok: error === null,
        code: error ? (Number.isInteger(error.code) ? error.code : null) : 0,
        stdout: typeof stdout === 'string' ? stdout : '',
        stderr: typeof stderr === 'string' ? stderr : '',
        error: error ? String(error.message) : '',
      });
    });
  });
}

async function checkNode() {
  const homeDir = await findNodeHome();
  if (!homeDir) {
    record('node', 'fail', 'Node.js LTS install not found (set DSH_NODE_HOME)');
    return null;
  }
  const node = path.join(homeDir, 'node.exe');
  const npm = path.join(homeDir, 'npm.cmd');
  const npx = path.join(homeDir, 'npx.cmd');
  const version = await run(node, ['--version']);
  const npmVersion = await run(npm, ['--version']);
  const ok = version.ok && npmVersion.ok && (await exists(npx));
  record('node', ok ? 'pass' : 'fail', `${version.stdout.trim()} / npm ${npmVersion.stdout.trim()}`);
  return ok ? { homeDir, node, npm, npx } : null;
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    path.join(process.env.PROGRAMFILES ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

async function checkChrome() {
  const chrome = await findChrome();
  if (!chrome) {
    record('chrome', 'fail', 'chrome.exe not found');
    return null;
  }
  const result = await run(chrome, ['--version'], { timeoutMs: 10_000 });
  record('chrome', result.ok ? 'pass' : 'fail', result.stdout.trim() || result.stderr.trim());
  return result.ok ? chrome : null;
}

async function checkContext7() {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch('https://mcp.context7.com/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dsh-verify-stack', version: '1' } },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.text();
      if (response.ok && /Context7/.test(body)) {
        record('context7', 'pass', `Context7 initialize ok (attempt ${attempt})`);
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  // A reachable endpoint is an installation property; a transient network
  // failure is explicitly unknown, not a fake pass or an installation failure.
  record('context7', 'unknown', `network check failed after 3 attempts: ${lastError}`);
}

async function checkChromeMcp() {
  const entry = process.env.DSH_CHROME_MCP_ENTRY
    ?? path.join(globalPrefix, 'node_modules', 'chrome-devtools-mcp', 'build', 'src', 'bin', 'chrome-devtools-mcp.js');
  if (!(await exists(entry))) {
    record('chrome-devtools-mcp', 'fail', `entry not found: ${entry}`);
    return;
  }
  const chrome = await findChrome();
  const child = spawn(process.execPath, [entry, '--no-usage-statistics'], {
    env: { ...process.env, ...(chrome ? { CHROME_PATH: chrome } : {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let buffer = '';
  let settled = false;
  const finish = (ok, detail) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try { child.kill(); } catch { /* ignore */ }
    record('chrome-devtools-mcp', ok ? 'pass' : 'fail', detail);
  };
  const timer = setTimeout(() => finish(false, 'initialize timed out'), 30_000);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim() === '') continue;
      try {
        const message = JSON.parse(line);
        if (message.id === 1 && message.result) {
          finish(true, `server ${message.result.serverInfo?.name ?? 'unknown'} initialize ok`);
          return;
        }
      } catch {
        /* partial/non-JSON log line */
      }
    }
  });
  child.on('error', (error) => finish(false, error.message));
  child.on('exit', (code) => finish(false, `server exited ${code}`));
  child.stdin.end(`${JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dsh-verify-stack', version: '1' } },
  })}\n`);
}

async function checkProfilePlugin(id) {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(profileDir, 'package.json'), 'utf8'));
    const present = Object.prototype.hasOwnProperty.call(pkg.dependencies ?? {}, id);
    record(id, present ? 'pass' : 'fail', present ? 'installed in profile' : 'missing from profile dependencies');
    return present;
  } catch (error) {
    record(id, 'fail', error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function checkDshVerify() {
  const packageDir = path.join(profileDir, 'node_modules', 'dsh-verify');
  const bin = path.join(packageDir, 'bin', 'verify.mjs');
  const templates = path.join(packageDir, 'templates', 'starter');
  const ok = await exists(bin) && await exists(templates);
  record('dsh-verify', ok ? 'pass' : 'fail', ok ? 'package + starter present' : 'package or starter missing');
}

async function checkModlens() {
  const packageDir = path.join(profileDir, 'node_modules', '@liustack', 'modlens');
  if (!(await exists(packageDir))) {
    record('modlens', 'fail', 'package missing');
    return;
  }
  const config = path.join(home, '.modlens', 'config.json');
  if (!(await exists(config))) {
    record('modlens', 'unknown', 'installed; no vision engine configured (run modlens doctor)');
    return;
  }
  try {
    const parsed = JSON.parse(await fs.readFile(config, 'utf8'));
    const provider = String(parsed.provider ?? 'gemini-api');
    const gemini = parsed.providers?.['gemini-api'] ?? parsed.providers?.gemini;
    const key = gemini?.apiKey;
    if (provider !== 'gemini-api' && provider !== 'gemini') {
      record('modlens', 'unknown', `configured provider: ${provider}; no non-invasive health probe`);
      return;
    }
    if (typeof key !== 'string' || key.trim() === '') {
      record('modlens', 'unknown', 'gemini-api selected but no apiKey configured');
      return;
    }
    try {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
        headers: { 'x-goog-api-key': key },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        record('modlens', 'pass', 'gemini-api reachable and authenticated');
      } else if (response.status === 401 || response.status === 403) {
        record('modlens', 'fail', `gemini-api authentication failed (HTTP ${response.status})`);
      } else {
        record('modlens', 'unknown', `gemini-api returned HTTP ${response.status}; not a clear install failure`);
      }
    } catch (error) {
      record('modlens', 'unknown', `gemini-api network probe failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } catch {
    record('modlens', 'unknown', 'config exists but is not readable JSON');
  }
}

async function checkPromptfoo() {
  const wrapper = process.env.PROMPTFOO_CMD ?? path.join(globalPrefix, 'promptfoo.cmd');
  if (!(await exists(wrapper))) {
    record('promptfoo', 'fail', `wrapper not found: ${wrapper}`);
    return;
  }
  const shell = process.env.ComSpec ?? 'C:/Windows/System32/cmd.exe';
  const result = await run(shell, ['/d', '/s', '/c', `${wrapper} --version`], { timeoutMs: 30_000 });
  const text = `${result.stdout}\n${result.stderr}`;
  const version = text.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? null;
  record('promptfoo', version === null ? 'fail' : 'pass', version ?? text.trim().slice(-500));
}

async function main() {
  const node = await checkNode();
  const chrome = await checkChrome();
  await checkContext7();
  await checkChromeMcp();
  await checkProfilePlugin('dshmarket');
  await checkDshVerify();
  await checkProfilePlugin('dsh-stall-guard');
  await checkModlens();
  await checkPromptfoo();
  const failed = results.filter((check) => check.status === 'fail');
  const unknown = results.filter((check) => check.status === 'unknown');
  const payload = {
    generatedAt: new Date().toISOString(),
    profileDir,
    node: node?.homeDir ?? null,
    chrome,
    status: failed.length === 0 ? 'pass' : 'fail',
    checks: results,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (failed.length > 0) process.exitCode = 1;
  else if (unknown.length > 0) process.exitCode = 0;
}

await main();
