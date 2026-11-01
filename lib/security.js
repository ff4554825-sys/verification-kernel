/** Security audit adapters: gitleaks, semgrep, and trivy (secret scan). */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function firstExisting(candidates) {
  return candidates.find((candidate) => typeof candidate === 'string' && candidate !== '');
}

export async function findSecurityTools({ toolsDir = '', env = process.env } = {}) {
  const candidates = {
    gitleaks: [
      env.GITLEAKS_EXECUTABLE,
      toolsDir === '' ? '' : path.join(toolsDir, 'gitleaks.exe'),
      toolsDir === '' ? '' : path.join(toolsDir, 'gitleaks'),
      'gitleaks',
    ].filter(Boolean),
    trivy: [
      env.TRIVY_EXECUTABLE,
      toolsDir === '' ? '' : path.join(toolsDir, 'trivy.exe'),
      toolsDir === '' ? '' : path.join(toolsDir, 'trivy'),
      'trivy',
    ].filter(Boolean),
    semgrep: [
      env.SEMGREP_EXECUTABLE,
      path.join(env.APPDATA ?? '', 'Python', 'Python312', 'Scripts', 'semgrep.exe'),
      'semgrep',
    ].filter(Boolean),
  };
  const tools = {};
  for (const [name, list] of Object.entries(candidates)) {
    tools[name] = null;
    for (const candidate of list) {
      if (candidate.includes(path.sep) ? await exists(candidate) : await exists(candidate)) {
        tools[name] = candidate;
        break;
      }
    }
  }
  return tools;
}

function normalizeSeverity(value, fallback = 'medium') {
  const text = String(value ?? '').toLowerCase();
  if (text === 'critical' || text === 'error') return 'high';
  if (text === 'high') return 'high';
  if (text === 'medium' || text === 'warning') return 'medium';
  if (text === 'low' || text === 'info') return 'low';
  return fallback;
}

export function normalizeGitleaks(raw) {
  const list = Array.isArray(raw?.findings) ? raw.findings : Array.isArray(raw) ? raw : [];
  return list.map((finding) => ({
    tool: 'gitleaks',
    severity: 'high',
    rule: finding.RuleID ?? finding.rule ?? 'secret',
    file: finding.File ?? finding.file ?? '',
    line: finding.StartLine ?? finding.startLine ?? 0,
    message: finding.Description ?? finding.description ?? 'possible secret',
  }));
}

export function normalizeSemgrep(raw) {
  const list = Array.isArray(raw?.results) ? raw.results : [];
  return list.map((result) => ({
    tool: 'semgrep',
    severity: normalizeSeverity(result.extra?.severity, 'medium'),
    rule: result.check_id ?? result.rule_id ?? 'semgrep',
    file: result.path ?? '',
    line: result.start?.line ?? 0,
    message: result.extra?.message ?? 'semgrep finding',
  }));
}

export function normalizeTrivy(raw) {
  const findings = [];
  for (const result of Array.isArray(raw?.Results) ? raw.Results : []) {
    for (const secret of Array.isArray(result.Secrets) ? result.Secrets : []) {
      findings.push({
        tool: 'trivy',
        severity: normalizeSeverity(secret.Severity, 'high'),
        rule: secret.RuleID ?? 'secret',
        file: result.Target ?? '',
        line: secret.StartLine ?? 0,
        message: secret.Title ?? 'secret',
      });
    }
  }
  return findings;
}

async function runJson(tool, args, { cwd, timeoutMs, env }) {
  try {
    const { stdout, stderr } = await execFileAsync(tool, args, {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, ...env },
    });
    return { ok: true, stdout, stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: typeof error.stdout === 'string' ? error.stdout : '',
      stderr: typeof error.stderr === 'string' ? error.stderr : String(error.message ?? error),
      code: error.code,
      timedOut: error.killed === true,
    };
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Run available scanners and return normalized findings.
 * A scanner that is missing or fails is reported in `tools`, not treated as clean.
 */
export async function auditSecurity({ cwd, toolsDir = '', semgrepRules = '', timeoutMs = 120_000, run = runJson } = {}) {
  if (typeof cwd !== 'string' || cwd === '') throw new Error('cwd is required');
  const tools = await findSecurityTools({ toolsDir });
  const findings = [];
  const status = [];
  await fs.mkdir(path.join(cwd, '.dsh'), { recursive: true });
  const temp = await fs.mkdtemp(path.join(cwd, '.dsh', 'security-'));
  const toolEnv = {
    ...process.env,
    TMP: temp,
    TEMP: temp,
    TMPDIR: temp,
  };
  try {
    if (tools.gitleaks !== null) {
      const report = path.join(temp, 'gitleaks.json');
      const result = await run(tools.gitleaks, ['detect', '--source', cwd, '--no-git', '--redact', '--report-format', 'json', '--report-path', report, '--no-banner'], { cwd, timeoutMs, env: toolEnv });
      const parsed = await readJson(report);
      if (parsed !== null) findings.push(...normalizeGitleaks(parsed));
      status.push({ name: 'gitleaks', status: parsed === null ? 'unknown' : 'ok', error: parsed === null ? result.stderr || 'no report' : '' });
    } else {
      status.push({ name: 'gitleaks', status: 'missing', error: 'gitleaks not installed' });
    }

    if (tools.semgrep !== null && semgrepRules !== '' && await exists(semgrepRules)) {
      const result = await run(tools.semgrep, ['scan', '--config', semgrepRules, '--json', '--quiet', '--timeout', '60', '--exclude', 'test', '--exclude', 'docs', '--exclude', 'golden', cwd], {
        cwd,
        timeoutMs,
        env: { ...process.env, PATH: `${path.dirname(tools.semgrep)}${path.delimiter}${process.env.PATH ?? ''}` },
      });
      let parsed = null;
      try {
        parsed = JSON.parse(result.stdout);
      } catch {
        parsed = null;
      }
      if (parsed !== null) findings.push(...normalizeSemgrep(parsed));
      status.push({ name: 'semgrep', status: parsed === null ? 'unknown' : 'ok', error: parsed === null ? result.stderr || 'no json output' : '' });
    } else {
      status.push({ name: 'semgrep', status: semgrepRules === '' ? 'skipped' : 'missing', error: semgrepRules === '' ? 'no rules file' : 'semgrep not installed' });
    }

    if (tools.trivy !== null) {
      const report = path.join(temp, 'trivy.json');
      const result = await run(tools.trivy, ['fs', '--scanners', 'secret', '--format', 'json', '--output', report, '--quiet', '--skip-dirs', 'node_modules', '--skip-dirs', '.dsh', '--skip-dirs', 'test', '--skip-dirs', 'docs', cwd], { cwd, timeoutMs, env: toolEnv });
      const parsed = await readJson(report);
      if (parsed !== null) findings.push(...normalizeTrivy(parsed));
      status.push({ name: 'trivy', status: parsed === null ? 'unknown' : 'ok', error: parsed === null ? result.stderr || 'no report' : '' });
    } else {
      status.push({ name: 'trivy', status: 'missing', error: 'trivy not installed' });
    }
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
  const summary = {
    total: findings.length,
    high: findings.filter((finding) => finding.severity === 'high').length,
    medium: findings.filter((finding) => finding.severity === 'medium').length,
    low: findings.filter((finding) => finding.severity === 'low').length,
  };
  return { findings, tools: status, summary, ok: summary.high === 0 };
}
