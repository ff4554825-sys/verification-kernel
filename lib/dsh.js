/** DSH adapter helpers: config/router resolution, subprocess execution, tool rendering. */

import path from 'node:path';
import { normalizeCheck, isInside, tailText } from './kernel.js';
import { DEFAULT_OVERRIDE_PATH } from './override.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_TOOL_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_WSL_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_WSL_DISTRO = 'Ubuntu-22.04';
const MODES = new Set(['off', 'dry-run', 'enforce']);
const ISOLATIONS = new Set(['host', 'wsl']);

function resolveMode(value, fallback, warnings, label) {
  if (value === undefined) return fallback;
  if (MODES.has(value)) return value;
  warnings.push(`${label} must be off|dry-run|enforce, using '${fallback}'`);
  return fallback;
}

function resolveIsolation(value, fallback, warnings, label) {
  if (value === undefined) return fallback;
  if (ISOLATIONS.has(value)) return value;
  warnings.push(`${label} must be host|wsl, using '${fallback}'`);
  return fallback;
}

function resolveWslDistro(value, fallback, warnings, label) {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  warnings.push(`${label} must be a non-empty string, using '${fallback}'`);
  return fallback;
}

function resolveWslTimeout(value, fallback, warnings, label) {
  if (value === undefined) return fallback;
  if (Number.isInteger(value) && value > 0) return value;
  warnings.push(`${label} must be a positive integer, using ${fallback}`);
  return fallback;
}

function normalizeChecks(rawChecks, defaultTimeoutMs, warnings, label) {
  const checks = [];
  const seen = new Set();
  for (const [index, rawCheck] of (Array.isArray(rawChecks) ? rawChecks : []).entries()) {
    const errors = [];
    const candidate = rawCheck !== null && typeof rawCheck === 'object' && !Array.isArray(rawCheck)
      ? { ...rawCheck, timeoutMs: rawCheck.timeoutMs === undefined ? defaultTimeoutMs : rawCheck.timeoutMs }
      : rawCheck;
    const check = normalizeCheck(candidate, index, errors);
    if (check === null) {
      warnings.push(`ignored ${label}[${index}]: ${errors.join('; ')}`);
      continue;
    }
    if (seen.has(check.id)) {
      warnings.push(`ignored duplicate check id '${check.id}' in ${label}`);
      continue;
    }
    seen.add(check.id);
    checks.push(check);
  }
  return checks;
}

function normalizeToolNames(raw, warnings, label) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every((value) => typeof value === 'string' && value !== '')) {
    warnings.push(`${label} must be an array of non-empty tool names`);
    return [];
  }
  return [...new Set(raw)];
}

function normalizeExecutables(raw, warnings, label) {
  const executables = {};
  if (raw === undefined) return executables;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push(`${label}.executables must be an object mapping bare names to absolute paths`);
    return executables;
  }
  for (const [name, value] of Object.entries(raw)) {
    if (typeof name === 'string' && name !== '' && typeof value === 'string' && value !== '') executables[name] = value;
    else warnings.push(`ignored invalid ${label}.executables entry '${name}'`);
  }
  return executables;
}

function normalizeAdvisor(raw, warnings) {
  if (raw === undefined) return { enabled: false, command: null, timeoutMs: 30_000, minScore: 0.5 };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push('advisor must be an object');
    return { enabled: false, command: null, timeoutMs: 30_000, minScore: 0.5 };
  }
  const enabled = raw.enabled !== false;
  const command = Array.isArray(raw.command) && raw.command.length > 0 && raw.command.every((value) => typeof value === 'string' && value !== '')
    ? [...raw.command]
    : null;
  if (raw.command !== undefined && command === null) warnings.push('advisor.command must be a non-empty argv array');
  const timeoutMs = Number.isInteger(raw.timeoutMs) && raw.timeoutMs > 0 ? raw.timeoutMs : 30_000;
  const minScore = Number.isFinite(raw.minScore) && raw.minScore >= 0 && raw.minScore <= 1 ? raw.minScore : 0.5;
  return { enabled, command, timeoutMs, minScore };
}

function normalizeFastPath(raw, warnings, label) {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push(`${label} must be an object`);
    return undefined;
  }
  const enabled = raw.enabled !== false;
  const maxFiles = Number.isInteger(raw.maxFiles) && raw.maxFiles > 0 ? raw.maxFiles : 10;
  const maxLines = Number.isInteger(raw.maxLines) && raw.maxLines > 0 ? raw.maxLines : 80;
  const allowPaths = Array.isArray(raw.allowPaths) ? raw.allowPaths.filter((value) => typeof value === 'string' && value !== '') : [];
  const checks = Array.isArray(raw.checks) ? raw.checks.filter((value) => typeof value === 'string' && value !== '') : [];
  if (checks.length === 0) {
    warnings.push(`${label}.checks must contain at least one check id`);
    return undefined;
  }
  return { enabled, maxFiles, maxLines, allowPaths, checks };
}

function normalizeProject(raw, index, defaults, warnings) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push(`ignored projects[${index}]: must be an object`);
    return null;
  }
  const id = typeof raw.id === 'string' && raw.id.trim() !== '' ? raw.id.trim() : `project-${index + 1}`;
  if (typeof raw.root !== 'string' || raw.root.trim() === '') {
    warnings.push(`ignored project '${id}': root is required`);
    return null;
  }
  if (!path.isAbsolute(raw.root)) warnings.push(`project '${id}' root is not absolute; resolving against the Host cwd`);
  const root = path.resolve(raw.root.trim());
  const checks = normalizeChecks(raw.checks, defaults.timeoutMs, warnings, `projects[${index}].checks`);
  if (checks.length === 0) warnings.push(`project '${id}' has no checks; it will not be gated`);
  const mode = resolveMode(raw.mode, defaults.mode, warnings, `projects[${index}].mode`);
  const maxAttempts = Number.isInteger(raw.maxAttempts) && raw.maxAttempts >= 0 ? raw.maxAttempts : defaults.maxAttempts;
  if (raw.maxAttempts !== undefined && maxAttempts !== raw.maxAttempts) warnings.push(`project '${id}' maxAttempts must be a non-negative integer`);
  const includeSubagents = typeof raw.includeSubagents === 'boolean' ? raw.includeSubagents : defaults.includeSubagents;
  const writeArtifacts = typeof raw.writeArtifacts === 'boolean' ? raw.writeArtifacts : defaults.writeArtifacts;
  const artifactDir = typeof raw.artifactDir === 'string' && raw.artifactDir !== '' ? raw.artifactDir : defaults.artifactDir;
  const overridePath = typeof raw.overridePath === 'string' && raw.overridePath !== '' ? raw.overridePath : defaults.overridePath;
  const expectedPlanHash = typeof raw.expectedPlanHash === 'string' && raw.expectedPlanHash !== '' ? raw.expectedPlanHash : defaults.expectedPlanHash;
  const denyTools = raw.denyTools === undefined ? defaults.denyTools : normalizeToolNames(raw.denyTools, warnings, `projects[${index}].denyTools`);
  const executables = normalizeExecutables(raw.executables, warnings, `projects[${index}]`);
  const outcomeStore = typeof raw.outcomeStore === 'string' && raw.outcomeStore !== '' ? raw.outcomeStore : defaults.outcomeStore;
  const signingKey = typeof raw.signingKey === 'string' && raw.signingKey !== '' ? raw.signingKey : defaults.signingKey;
  const fastPath = normalizeFastPath(raw.fastPath, warnings, `projects[${index}].fastPath`) ?? defaults.fastPath;
  const gitPath = typeof raw.gitPath === 'string' && raw.gitPath !== '' ? raw.gitPath : defaults.gitPath;
  const isolation = resolveIsolation(raw.isolation, defaults.isolation, warnings, `projects[${index}].isolation`);
  const wslDistro = resolveWslDistro(raw.wslDistro, defaults.wslDistro, warnings, `projects[${index}].wslDistro`);
  const wslTimeoutMs = resolveWslTimeout(raw.wslTimeoutMs, defaults.wslTimeoutMs, warnings, `projects[${index}].wslTimeoutMs`);
  return {
    id,
    root,
    checks,
    plan: checks.length === 0 ? null : { id, checks },
    mode,
    maxAttempts,
    includeSubagents,
    writeArtifacts,
    artifactDir,
    overridePath,
    ...(expectedPlanHash === undefined ? {} : { expectedPlanHash }),
    denyTools,
    executables,
    ...(outcomeStore === undefined ? {} : { outcomeStore }),
    ...(signingKey === undefined ? {} : { signingKey }),
    ...(fastPath === undefined ? {} : { fastPath }),
    ...(gitPath === undefined ? {} : { gitPath }),
    isolation,
    wslDistro,
    wslTimeoutMs,
  };
}

/**
 * Validate raw bundle config. Invalid entries are skipped with warnings so a
 * bad profile patch cannot prevent the plugin from loading (or trap a turn).
 *
 * Backward compatibility: when `projects` is empty, top-level `checks`,
 * `allowRoots`, `mode`, etc. define the legacy single plan.
 */
export function resolveKernelConfig(raw = {}) {
  const warnings = [];
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const mode = resolveMode(source.mode, 'off', warnings, 'mode');
  const defaultMode = resolveMode(source.defaultMode, 'off', warnings, 'defaultMode');
  const defaultTimeoutMs = Number.isInteger(source.timeoutMs) && source.timeoutMs > 0 ? source.timeoutMs : DEFAULT_TIMEOUT_MS;
  const checks = normalizeChecks(source.checks, defaultTimeoutMs, warnings, 'checks');
  const maxAttempts = Number.isInteger(source.maxAttempts) && source.maxAttempts >= 0 ? source.maxAttempts : 2;
  if (source.maxAttempts !== undefined && maxAttempts !== source.maxAttempts) warnings.push('maxAttempts must be a non-negative integer, using 2');
  const allowRoots = Array.isArray(source.allowRoots)
    ? source.allowRoots.filter((value) => typeof value === 'string' && value.trim() !== '')
    : [];
  const artifactDir = typeof source.artifactDir === 'string' && source.artifactDir !== '' ? source.artifactDir : '.dsh/verification';
  const overridePath = typeof source.overridePath === 'string' && source.overridePath !== '' ? source.overridePath : DEFAULT_OVERRIDE_PATH;
  const expectedPlanHash = typeof source.expectedPlanHash === 'string' && source.expectedPlanHash !== '' ? source.expectedPlanHash : undefined;
  if (expectedPlanHash !== undefined && !/^[a-f0-9]{64}$/i.test(expectedPlanHash)) warnings.push('expectedPlanHash should be a SHA-256 hex digest');
  const denyTools = normalizeToolNames(source.denyTools, warnings, 'denyTools');
  const toolTimeoutMs = Number.isInteger(source.toolTimeoutMs) && source.toolTimeoutMs > 0 ? source.toolTimeoutMs : DEFAULT_TOOL_TIMEOUT_MS;
  const executables = normalizeExecutables(source.executables, warnings, 'config');
  const includeSubagents = source.includeSubagents === true;
  const writeArtifacts = source.writeArtifacts !== false;
  const autoLoad = source.autoLoad === true;
  const autoFeedback = source.autoFeedback === true;
  const advisor = normalizeAdvisor(source.advisor, warnings);
  const isolation = resolveIsolation(source.isolation, 'host', warnings, 'isolation');
  const wslDistro = resolveWslDistro(source.wslDistro, DEFAULT_WSL_DISTRO, warnings, 'wslDistro');
  const wslTimeoutMs = resolveWslTimeout(source.wslTimeoutMs, DEFAULT_WSL_TIMEOUT_MS, warnings, 'wslTimeoutMs');
  const outcomeStore = typeof source.outcomeStore === 'string' && source.outcomeStore !== '' ? source.outcomeStore : undefined;
  if (source.outcomeStore !== undefined && outcomeStore === undefined) warnings.push('outcomeStore must be a non-empty string');
  const signingKey = typeof source.signingKey === 'string' && source.signingKey !== '' ? source.signingKey : undefined;
  if (source.signingKey !== undefined && signingKey === undefined) warnings.push('signingKey must be a non-empty string');
  const gitPath = typeof source.gitPath === 'string' && source.gitPath !== '' ? source.gitPath : undefined;

  const projects = [];
  const seenIds = new Set();
  const seenRoots = new Set();
  const defaults = { timeoutMs: defaultTimeoutMs, mode, maxAttempts, includeSubagents, writeArtifacts, artifactDir, overridePath, expectedPlanHash, denyTools, outcomeStore, signingKey, gitPath, isolation, wslDistro, wslTimeoutMs };
  for (const [index, rawProject] of (Array.isArray(source.projects) ? source.projects : []).entries()) {
    const project = normalizeProject(rawProject, index, defaults, warnings);
    if (project === null) continue;
    if (seenIds.has(project.id)) {
      warnings.push(`ignored duplicate project id '${project.id}'`);
      continue;
    }
    if (seenRoots.has(project.root)) {
      warnings.push(`ignored duplicate project root '${project.root}'`);
      continue;
    }
    seenIds.add(project.id);
    seenRoots.add(project.root);
    projects.push(project);
  }

  return {
    mode,
    defaultMode,
    checks,
    plan: checks.length === 0 ? null : { id: 'config', checks },
    maxAttempts,
    allowRoots,
    includeSubagents,
    writeArtifacts,
    artifactDir,
    overridePath,
    ...(expectedPlanHash === undefined ? {} : { expectedPlanHash }),
    denyTools,
    registerTool: source.registerTool !== false,
    toolTimeoutMs,
    executables,
    autoLoad,
    autoFeedback,
    advisor,
    isolation,
    wslDistro,
    wslTimeoutMs,
    ...(outcomeStore === undefined ? {} : { outcomeStore }),
    ...(signingKey === undefined ? {} : { signingKey }),
    ...(gitPath === undefined ? {} : { gitPath }),
    projects,
    warnings,
  };
}

function legacyProject(config, cwd) {
  return {
    id: 'default',
    root: typeof cwd === 'string' && cwd !== '' ? cwd : process.cwd(),
    plan: config.plan,
    mode: config.mode,
    maxAttempts: config.maxAttempts,
    includeSubagents: config.includeSubagents,
    writeArtifacts: config.writeArtifacts,
    artifactDir: config.artifactDir,
    overridePath: config.overridePath ?? DEFAULT_OVERRIDE_PATH,
    ...(config.expectedPlanHash === undefined ? {} : { expectedPlanHash: config.expectedPlanHash }),
    denyTools: config.denyTools ?? [],
    executables: {},
    isolation: config.isolation ?? 'host',
    wslDistro: config.wslDistro ?? DEFAULT_WSL_DISTRO,
    wslTimeoutMs: config.wslTimeoutMs ?? DEFAULT_WSL_TIMEOUT_MS,
    ...(config.outcomeStore === undefined ? {} : { outcomeStore: config.outcomeStore }),
    ...(config.signingKey === undefined ? {} : { signingKey: config.signingKey }),
    ...(config.fastPath === undefined ? {} : { fastPath: config.fastPath }),
    ...(config.gitPath === undefined ? {} : { gitPath: config.gitPath }),
    autoFeedback: config.autoFeedback === true,
    advisor: config.advisor ?? { enabled: false, command: null, timeoutMs: 30_000, minScore: 0.5 },
  };
}

/** Longest matching project root for a session cwd; null when no project matches. */
export function resolveProjectForCwd(config, cwd) {
  if (typeof cwd !== 'string' || cwd === '') return null;
  const projects = Array.isArray(config.projects) ? config.projects : [];
  if (projects.length > 0) {
    const matches = projects
      .filter((project) => isInside(project.root, cwd))
      .sort((left, right) => right.root.length - left.root.length);
    return matches[0] ?? null;
  }
  if (config.plan !== null && isAllowedCwd(config.allowRoots, cwd)) return legacyProject(config, cwd);
  return null;
}

export function resolveProjectById(config, id) {
  if (typeof id !== 'string' || id === '') return null;
  const projects = Array.isArray(config.projects) ? config.projects : [];
  return projects.find((project) => project.id === id) ?? null;
}

/**
 * Tool selection: explicit id first, then cwd, then the single configured
 * project (so a session outside the project can run its checks on demand).
 */
export function resolveProjectForCall(config, cwd, projectId) {
  const explicit = resolveProjectById(config, projectId);
  if (explicit !== null) return explicit;
  const byCwd = resolveProjectForCwd(config, cwd);
  if (byCwd !== null) return byCwd;
  const projects = Array.isArray(config.projects) ? config.projects : [];
  if (projects.length === 1) return projects[0];
  if (projects.length === 0 && config.plan !== null) return legacyProject(config, cwd ?? process.cwd());
  return null;
}

function readCollected(reader) {
  if (reader === undefined || reader === null) return { text: '', spillPath: null };
  try {
    const read = reader.readFrom(0);
    return {
      text: typeof read?.text === 'string' ? read.text : '',
      spillPath: typeof read?.spillPath === 'string' ? read.spillPath : null,
    };
  } catch {
    return { text: '', spillPath: null };
  }
}

/**
 * Build a runCommand implementation over the Host subprocess service.
 * A missing service or executable becomes an `unknown` evidence result, never
 * a silent pass.
 */
export function makeSubprocessRunner(ctx, executables = {}) {
  return async function runCommand(check, options = {}) {
    const subprocess = typeof ctx.get === 'function' ? ctx.get('subprocess') : undefined;
    if (subprocess === undefined) {
      return {
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        timedOut: false,
        spillPaths: [],
        error: { name: 'ServiceUnavailable', message: 'the subprocess service is not composed' },
      };
    }
    const cwd = typeof options.cwd === 'string' ? options.cwd : process.cwd();
    const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : check.timeoutMs;
    const turnSignal = options.signal;
    let program;
    const requested = check.argv[0];
    const mapped = typeof executables?.[requested] === 'string' ? executables[requested] : requested;
    try {
      program = await subprocess.resolveExecutable(mapped, process.env, turnSignal);
    } catch (error) {
      return {
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        timedOut: false,
        spillPaths: [],
        error: { name: error?.name ?? 'ResolveError', message: error?.message ?? String(error) },
      };
    }
    const controller = new AbortController();
    let timedOut = false;
    let handle = null;
    const startedAt = Date.now();
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        controller.abort();
      } catch {
        /* already aborted */
      }
      try {
        handle?.terminate();
      } catch {
        /* already exited */
      }
    }, Math.max(1, timeoutMs));
    const onAbort = () => {
      try {
        controller.abort();
      } catch {
        /* already aborted */
      }
      try {
        handle?.terminate();
      } catch {
        /* already exited */
      }
    };
    if (turnSignal !== undefined) {
      if (turnSignal.aborted === true) onAbort();
      else if (typeof turnSignal.addEventListener === 'function') turnSignal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      handle = subprocess.spawn({
        argv: [program, ...check.argv.slice(1)],
        cwd,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 200_000, spill: { maxBytes: 5_000_000 } },
          stderr: { maxBytes: 200_000 },
        },
        graceMs: 1_000,
        signal: controller.signal,
        env: process.env,
      });
    } catch (error) {
      clearTimeout(timer);
      if (turnSignal !== undefined && typeof turnSignal.removeEventListener === 'function') turnSignal.removeEventListener('abort', onAbort);
      return {
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        durationMs: Date.now() - startedAt,
        timedOut,
        spillPaths: [],
        error: { name: error?.name ?? 'SpawnError', message: error?.message ?? String(error) },
      };
    }
    let outcome = null;
    let failure = null;
    try {
      outcome = await handle.done;
    } catch (error) {
      failure = { name: error?.name ?? 'SubprocessError', message: error?.message ?? String(error) };
    } finally {
      clearTimeout(timer);
      if (turnSignal !== undefined && typeof turnSignal.removeEventListener === 'function') turnSignal.removeEventListener('abort', onAbort);
    }
    const stdout = readCollected(handle.collected?.stdout);
    const stderr = readCollected(handle.collected?.stderr);
    const spillPaths = [stdout.spillPath, stderr.spillPath].filter((value) => typeof value === 'string');
    return {
      exitCode: Number.isInteger(outcome?.exitCode) ? outcome.exitCode : null,
      signal: typeof outcome?.signal === 'string' ? outcome.signal : null,
      stdout: stdout.text,
      stderr: stderr.text,
      durationMs: Math.max(0, Date.now() - startedAt),
      timedOut,
      error: failure,
      spillPaths,
    };
  };
}

export function getAgentCwd(ctx, agent) {
  try {
    const session = ctx.sessions.get(agent.id);
    if (session === undefined) return null;
    return ctx.workingDirectory.get(session);
  } catch {
    return null;
  }
}

export function isSubagent(ctx, agent) {
  try {
    return ctx.sessions.get(agent.id)?.header?.origin === 'subagent';
  } catch {
    return false;
  }
}

export function isAllowedCwd(allowRoots, cwd) {
  if (allowRoots.length === 0) return true;
  return allowRoots.some((root) => isInside(root, cwd));
}

function detailForCheck(check) {
  const parts = [];
  if (check.exitCode !== null) parts.push(`exit ${check.exitCode}`);
  if (check.timedOut === true) parts.push('timed out');
  if (check.error !== null) parts.push(`${check.error.name}: ${check.error.message}`);
  const output = tailText(`${check.stdout ?? ''}\n${check.stderr ?? ''}`.trim(), 500).trim();
  if (output !== '') parts.push(output);
  return parts.join(' | ');
}

/** Convert a kernel verdict into the JSON value declared by the tool output. */
export function toolValueFromVerdict(verdict, artifactPath = '', projectId = '') {
  return {
    project: projectId,
    status: verdict.status,
    reason: verdict.reason,
    summary: verdict.summary,
    artifactPath,
    checks: verdict.checks.map((check) => ({
      id: check.id,
      status: check.status,
      required: check.required,
      durationMs: Math.round(check.durationMs),
      detail: detailForCheck(check),
    })),
  };
}

/** Text shown in the conversation for the tool result. */
export function renderToolValue(value) {
  const lines = [
    `${value.project === '' ? '' : `Project ${value.project}: `}Verification: ${String(value.status).toUpperCase()} — ${value.reason}`,
  ];
  for (const check of value.checks) {
    lines.push(`- ${check.id}: ${check.status}${check.detail === '' ? '' : ` — ${check.detail}`}`);
  }
  if (typeof value.artifactPath === 'string' && value.artifactPath !== '') lines.push(`Evidence: ${value.artifactPath}`);
  return lines.join('\n');
}
