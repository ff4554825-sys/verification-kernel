/**
 * DSH Host half: a deterministic verification gate with a project router.
 *
 * - `verification_run` runs a project's plan on demand.
 * - `enforce` mode runs the matching project's checks at `agent/turn-stopping`
 *   and steers failures back into the turn, bounded by `maxAttempts`.
 * - `dry-run` records evidence without steering; `off` disables the gate.
 * - When `autoLoad` is enabled, a compact accuracy-first prompt section and an
 *   embedded `verification-protocol` skill are published to every new session.
 *
 * The gate is cooperative: it runs in the same process/user as the agent and
 * is not a security boundary. Put trusted policy outside the agent's write
 * scope for real enforcement.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runPlan, gateAction, formatFeedback, formatFinalFeedback, planHash } from './lib/kernel.js';
import { writeVerdictArtifacts } from './lib/artifacts.js';
import { verifyInWsl } from './lib/verify-wsl.js';
import { appendOutcome, outcomeFromVerdict, readOutcomes } from './lib/outcomes.js';
import { signVerdict } from './lib/sign.js';
import { selectFastPath } from './lib/complexity.js';
import { searchKnowledge } from './lib/knowledge.js';
import { attributeOutcome, recordRetrieval } from './lib/feedback-loop.js';
import { calibrateOutcomes } from './lib/calibration.js';
import { adviseVerdict } from './lib/advisor.js';
import {
  resolveKernelConfig,
  resolveProjectForCall,
  resolveProjectForCwd,
  makeSubprocessRunner,
  getAgentCwd,
  isSubagent,
  toolValueFromVerdict,
  renderToolValue,
} from './lib/dsh.js';
import { registerAutoLoad } from './lib/auto-load.js';
import { overrideMatches, readOverride, resolveOverridePath } from './lib/override.js';

export const inject = ['tools', 'agents', 'sessions', 'workingDirectory'];

export const TOOL_NAME = 'verification_run';

const CHECK_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'status', 'required', 'durationMs', 'detail'],
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['pass', 'fail', 'unknown', 'flaky'] },
    required: { type: 'boolean' },
    durationMs: { type: 'number' },
    detail: { type: 'string' },
  },
};

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['project', 'status', 'reason', 'summary', 'artifactPath', 'checks'],
  properties: {
    project: { type: 'string' },
    status: { type: 'string', enum: ['pass', 'fail', 'unknown', 'flaky'] },
    reason: { type: 'string' },
    summary: { type: 'string' },
    artifactPath: { type: 'string' },
    checks: { type: 'array', items: CHECK_OUTPUT_SCHEMA },
  },
};

function emptyVerdict(reason) {
  return {
    status: 'unknown',
    reason,
    summary: '',
    checks: [],
    counts: { required: 0, requiredPassed: 0, requiredFailed: 0, requiredUnknown: 0, optional: 0, optionalFailed: 0 },
  };
}

async function attachAdvisor(project, config, verdict) {
  if (config.advisor?.enabled !== true) return verdict;
  try {
    const advisor = await adviseVerdict(verdict, {
      project: project.id,
      cwd: project.root ?? process.cwd(),
      command: config.advisor.command,
      timeoutMs: config.advisor.timeoutMs,
    });
    return { ...verdict, advisor };
  } catch (error) {
    console.warn('[verification-kernel] advisor failed:', error);
    return verdict;
  }
}

async function signProjectVerdict(project, config, verdict) {
  const configured = project.signingKey ?? config.signingKey;
  if (typeof configured !== 'string' || configured === '') return verdict;
  const base = project.root ?? process.cwd();
  const keyPath = path.isAbsolute(configured) ? configured : path.resolve(base, configured);
  try {
    return signVerdict(verdict, await fs.readFile(keyPath, 'utf8'));
  } catch (error) {
    return {
      ...emptyVerdict(`verdict signing failed: ${error instanceof Error ? error.message : String(error)}`),
      id: verdict.id ?? project.id,
      planHash: verdict.planHash ?? '',
      isolation: verdict.isolation ?? project.isolation ?? 'host',
    };
  }
}

async function recordProjectOutcome(project, config, verdict, artifactPath, agentId = null) {
  const configured = project.outcomeStore ?? config.outcomeStore;
  if (typeof configured !== 'string' || configured === '') return;
  const base = project.root ?? process.cwd();
  const store = path.isAbsolute(configured) ? configured : path.resolve(base, configured);
  try {
    await appendOutcome(store, outcomeFromVerdict(verdict, { project: project.id, artifactPath }));
    if (config.autoFeedback === true) {
      try {
        await attributeOutcome({
          root: base,
          project: project.id,
          agentId,
          status: verdict.status,
        });
        const records = await readOutcomes(store);
        const calibration = calibrateOutcomes(records);
        const calibrationPath = path.join(base, '.dsh', 'verification', 'calibration.json');
        await fs.mkdir(path.dirname(calibrationPath), { recursive: true });
        await fs.writeFile(calibrationPath, `${JSON.stringify(calibration, null, 2)}\n`, 'utf8');
      } catch (error) {
        console.warn('[verification-kernel] automatic feedback failed:', error);
      }
    }
  } catch (error) {
    console.warn('[verification-kernel] could not append outcome:', error);
  }
}

async function runWslProjectPlan(project, config, { checkIds } = {}) {
  const selected = Array.isArray(checkIds) && checkIds.length > 0
    ? project.plan.checks.filter((check) => checkIds.includes(check.id))
    : project.plan.checks;
  if (selected.length === 0) return emptyVerdict('no checks matched the requested check ids');
  const plan = { ...project.plan, checks: selected };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-wsl-plan-'));
  try {
    const planPath = path.join(dir, 'plan.json');
    await fs.writeFile(planPath, JSON.stringify(plan), 'utf8');
    const result = await verifyInWsl({
      cwd: project.root,
      planPath,
      distro: project.wslDistro ?? config.wslDistro,
      timeoutMs: project.wslTimeoutMs ?? config.wslTimeoutMs,
    });
    if (!result.ok || result.verdict === null) {
      return emptyVerdict(`WSL verifier failed: ${result.error ?? result.stderr ?? result.stage ?? 'unknown error'}`);
    }
    const verdict = {
      ...result.verdict,
      cwd: project.root,
      isolation: 'wsl',
      remote: { isolation: 'wsl', distro: project.wslDistro ?? config.wslDistro },
    };
    delete verdict.artifactPath;
    return verdict;
  } catch (error) {
    return emptyVerdict(`WSL verifier failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function runnerFor(ctx, config, project) {
  const projectExecutables = project !== null && project !== undefined && project.executables !== null && typeof project.executables === 'object'
    ? project.executables
    : {};
  return makeSubprocessRunner(ctx, Object.keys(projectExecutables).length > 0 ? projectExecutables : config.executables);
}

async function runChecks(ctx, config, { agent, signal, checkIds, projectId }) {
  const cwd = agent === undefined ? ctx.workingDirectory.defaultDirectory : getAgentCwd(ctx, agent);
  const project = resolveProjectForCall(config, cwd, projectId);
  if (project === null) {
    return toolValueFromVerdict(emptyVerdict('no verification project is configured for this workspace'), '', '');
  }
  if (project.plan === null) {
    return toolValueFromVerdict(emptyVerdict(`project '${project.id}' has no checks`), '', project.id);
  }
  const expectedPlanHash = project.expectedPlanHash ?? config.expectedPlanHash;
  if (expectedPlanHash !== undefined && planHash(project.plan) !== expectedPlanHash) {
    return toolValueFromVerdict(emptyVerdict(`project '${project.id}' plan hash mismatch; refusing to run an untrusted plan`), '', project.id);
  }
  const base = project.root ?? cwd ?? process.cwd();
  let verdict;
  try {
    verdict = project.isolation === 'wsl'
      ? await runWslProjectPlan(project, config, {
          checkIds: Array.isArray(checkIds) ? checkIds.filter((value) => typeof value === 'string') : undefined,
        })
      : await runPlan(project.plan, {
          cwd: base,
          runCommand: runnerFor(ctx, config, project),
          signal,
          selectedCheckIds: Array.isArray(checkIds) ? checkIds.filter((value) => typeof value === 'string') : undefined,
        });
  } catch (error) {
    return toolValueFromVerdict(emptyVerdict(`check execution failed: ${error instanceof Error ? error.message : String(error)}`), '', project.id);
  }
  verdict = await attachAdvisor(project, config, verdict);
  verdict = await signProjectVerdict(project, config, verdict);
  let artifactPath = '';
  const writeArtifacts = project.writeArtifacts ?? config.writeArtifacts;
  if (writeArtifacts) {
    const artifacts = await writeVerdictArtifacts(base, verdict, { dir: project.artifactDir ?? config.artifactDir });
    if (artifacts !== null) artifactPath = artifacts.latest;
  }
  await recordProjectOutcome(project, config, verdict, artifactPath, agent?.id);
  return toolValueFromVerdict(verdict, artifactPath, project.id);
}

async function deliverSteer(agent, text) {
  if (typeof agent.steer !== 'function') return false;
  try {
    const maybe = agent.steer({
      // `steer` takes a complete user message. Omitting `role`/`id` inserts a
      // malformed message and the next provider request fails validation.
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'verification' },
    });
    if (maybe !== null && maybe !== undefined && typeof maybe.then === 'function') await maybe;
    return true;
  } catch (error) {
    console.warn('[verification-kernel] failed to steer verification feedback:', error);
    return false;
  }
}

/**
 * Build the per-agent gate.
 * Exported for tests; the plugin entry owns its lifecycle.
 */
export function createGate(ctx, config, injectedRunner = null) {
  const disposers = new Map();
  const guards = new Map();
  const states = new Map();
  const running = new Set();
  const runnerForProject = (project) => injectedRunner ?? runnerFor(ctx, config, project);
  const hasDenyTools = (config.denyTools ?? []).length > 0
    || (Array.isArray(config.projects) && config.projects.some((project) => (project.denyTools ?? []).length > 0));

  async function handle(agent, payload) {
    const cwd = getAgentCwd(ctx, agent);
    const project = resolveProjectForCwd(config, cwd);
    if (project === null || project.plan === null) return;
    const mode = project.mode ?? config.mode;
    if (mode === 'off') return;
    if (!(project.includeSubagents ?? config.includeSubagents) && isSubagent(ctx, agent)) return;
    const expectedPlanHash = project.expectedPlanHash ?? config.expectedPlanHash;
    if (expectedPlanHash !== undefined && planHash(project.plan) !== expectedPlanHash) {
      const base = project.root ?? cwd;
      const mismatch = emptyVerdict(`project '${project.id}' plan hash mismatch; refusing to run an untrusted plan`);
      if (project.writeArtifacts ?? config.writeArtifacts) {
        await writeVerdictArtifacts(base, mismatch, { dir: project.artifactDir ?? config.artifactDir });
      }
      return;
    }
    if (running.has(agent.id)) return;
    const turn = typeof payload?.turn === 'number' ? payload.turn : -1;
    let state = states.get(agent.id);
    if (state === undefined || state.turn !== turn || state.projectId !== project.id) {
      state = { turn, attempts: 0, projectId: project.id };
      states.set(agent.id, state);
    }
    running.add(agent.id);
    let verdict;
    try {
      const fastPath = await selectFastPath({ cwd: project.root ?? cwd, project, config });
      const selectedCheckIds = fastPath === null ? undefined : fastPath.ids;
      verdict = project.isolation === 'wsl'
        ? await runWslProjectPlan(project, config, { checkIds: selectedCheckIds })
        : await runPlan(project.plan, {
            cwd: project.root ?? cwd,
            runCommand: runnerForProject(project),
            signal: payload?.signal,
            selectedCheckIds,
          });
      if (fastPath !== null) {
        verdict = {
          ...verdict,
          fastPath: fastPath.classification,
          selectedCheckIds: fastPath.ids,
        };
      }
    } catch (error) {
      console.warn('[verification-kernel] check run failed:', error);
      return;
    } finally {
      running.delete(agent.id);
    }
    if (payload?.signal?.aborted === true) return;
    const base = project.root ?? cwd;
    const overridePath = resolveOverridePath(base, project.overridePath ?? config.overridePath);
    const override = await readOverride(overridePath);
    let effective = verdict;
    if (override !== null && verdict.status !== 'pass' && overrideMatches(override, {
      projectId: project.id,
      planHash: verdict.planHash ?? '',
    })) {
      effective = {
        ...verdict,
        override: {
          reason: override.reason,
          project: override.project,
          createdAt: override.createdAt,
          expiresAt: override.expiresAt,
          path: overridePath,
        },
      };
      state.attempts = 0;
    }
    effective = await attachAdvisor(project, config, effective);
    effective = await signProjectVerdict(project, config, effective);
    let artifactPath = '';
    if (project.writeArtifacts ?? config.writeArtifacts) {
      const artifacts = await writeVerdictArtifacts(base, effective, { dir: project.artifactDir ?? config.artifactDir });
      if (artifacts !== null) artifactPath = artifacts.latest;
    }
    await recordProjectOutcome(project, config, effective, artifactPath, agent.id);
    const action = effective.override === undefined
      ? gateAction(effective, state.attempts, project.maxAttempts ?? config.maxAttempts, mode)
      : { action: 'allow', attempt: state.attempts, reason: 'override' };
    if (action.action === 'steer' || action.action === 'steer-final') {
      const text = action.action === 'steer'
        ? formatFeedback(effective, { artifactPath })
        : formatFinalFeedback(effective, state.attempts, { artifactPath });
      state.attempts = action.attempt;
      await deliverSteer(agent, text);
    } else if (effective.status === 'pass' || effective.override !== undefined) {
      state.attempts = 0;
    }
  }

  function attach(agent) {
    if (agent === null || typeof agent !== 'object' || typeof agent.id !== 'string') return;
    if (disposers.has(agent.id)) return;
    const agentCtx = agent.ctx;
    if (agentCtx === null || typeof agentCtx !== 'object' || typeof agentCtx.effect !== 'function' || typeof agentCtx.on !== 'function') {
      console.warn(`[verification-kernel] agent '${agent.id}' has no scoped context; gate not attached`);
      return;
    }
    try {
      const dispose = agentCtx.effect(() => {
        const off = agentCtx.on('agent/turn-stopping', (event) => handle(agent, event));
        return () => off();
      }, `verification-kernel: gate ${agent.id}`);
      disposers.set(agent.id, dispose);
    } catch (error) {
      console.warn(`[verification-kernel] could not attach gate to '${agent.id}':`, error);
    }
    if (hasDenyTools && agentCtx.tools !== null && typeof agentCtx.tools === 'object' && typeof agentCtx.tools.guard === 'function') {
      try {
        const disposeGuard = agentCtx.effect(() => agentCtx.tools.guard((exec) => {
          const cwd = getAgentCwd(ctx, agent);
          const project = resolveProjectForCwd(config, cwd);
          if (project === null) return undefined;
          const denied = project.denyTools ?? config.denyTools ?? [];
          const name = typeof exec?.name === 'string'
            ? exec.name
            : typeof exec?.toolName === 'string'
              ? exec.toolName
              : typeof exec?.tool?.name === 'string'
                ? exec.tool.name
                : '';
          return name !== '' && denied.includes(name)
            ? `tool '${name}' is denied by verification policy for project '${project.id}'`
            : undefined;
        }), `verification-kernel: deny tools ${agent.id}`);
        guards.set(agent.id, disposeGuard);
      } catch (error) {
        console.warn(`[verification-kernel] could not attach tool guard to '${agent.id}':`, error);
      }
    }
  }

  function detach(agentId) {
    const dispose = disposers.get(agentId);
    if (dispose !== undefined) {
      try {
        dispose();
      } catch {
        /* the agent scope may already be unwound */
      }
    }
    const guardDispose = guards.get(agentId);
    if (guardDispose !== undefined) {
      try {
        guardDispose();
      } catch {
        /* the agent scope may already be unwound */
      }
    }
    disposers.delete(agentId);
    guards.delete(agentId);
    states.delete(agentId);
    running.delete(agentId);
  }

  function dispose() {
    for (const agentId of [...disposers.keys()]) detach(agentId);
  }

  return { attach, detach, dispose, handle };
}

/** Whether any configured project (or the legacy plan) wants a gate. */
export function hasGate(config) {
  if (config.plan !== null && config.mode !== 'off') return true;
  const projects = Array.isArray(config.projects) ? config.projects : [];
  return projects.some((project) => project.plan !== null && (project.mode ?? config.mode) !== 'off');
}

export function apply(ctx, rawConfig = {}) {
  const config = resolveKernelConfig(rawConfig);
  for (const warning of config.warnings) console.warn(`[verification-kernel] ${warning}`);

  if (config.autoLoad) registerAutoLoad(ctx);

  if (config.registerTool) {
    ctx.effect(() => ctx.tools.register({
      name: TOOL_NAME,
      description: 'Run a configured project verification plan and return pass/fail/unknown with evidence. Use it before claiming a task is complete. With multiple projects, pass `project` to select one.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project: {
            type: 'string',
            description: 'Optional project id from the profile verification router.',
          },
          checkIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional subset of configured check ids to run.',
          },
        },
      },
      output: {
        schema: OUTPUT_SCHEMA,
        render: (_args, value) => [{ type: 'text', text: renderToolValue(value) }],
      },
      isConcurrencySafe: () => false,
      timeoutMs: config.toolTimeoutMs,
      execute: async (args, exec) => runChecks(ctx, config, {
        agent: exec.agent,
        signal: exec.signal,
        checkIds: args?.checkIds,
        projectId: args?.project,
      }),
    }), 'verification-kernel: tool');

    ctx.effect(() => ctx.tools.register({
      name: 'knowledge_search',
      description: 'Search local project documentation (README/AGENTS.md/docs) with the FTS5 knowledge base. Use it for local conventions, ADRs, and prior decisions; it does not answer from model memory.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'Keyword or CJK phrase to search for.' },
          project: { type: 'string', description: 'Optional project id from the profile verification router.' },
          limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum results (default 5).' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['root', 'query', 'results'],
          properties: {
            root: { type: 'string' },
            query: { type: 'string' },
            policyPath: { type: 'string' },
            results: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['path', 'title', 'startLine', 'endLine', 'snippet', 'score', 'learnedBoost', 'adjustedScore'],
                properties: {
                  path: { type: 'string' },
                  title: { type: 'string' },
                  startLine: { type: 'number' },
                  endLine: { type: 'number' },
                  snippet: { type: 'string' },
                  score: { type: 'number' },
                  learnedBoost: { type: 'number' },
                  adjustedScore: { type: 'number' },
                },
              },
            },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.results.length === 0
            ? `No local knowledge results for: ${value.query}`
            : [`Local knowledge for: ${value.query}`,
                ...value.results.map((item) => `- ${item.path}:${item.startLine} ${item.title}\n  ${item.snippet.replace(/<[^>]+>/g, '')}`)].join('\n'),
        }],
      },
      isConcurrencySafe: () => false,
      timeoutMs: config.toolTimeoutMs,
      execute: async (args, exec) => {
        const cwd = getAgentCwd(ctx, exec.agent);
        const project = resolveProjectForCall(config, cwd, args?.project);
        const root = project?.root ?? cwd;
        const query = typeof args?.query === 'string' ? args.query : '';
        const result = await searchKnowledge({
          root,
          query,
          limit: Number.isInteger(args?.limit) ? args.limit : 5,
        });
        if (result.results.length > 0) {
          try {
            const agentId = exec.agent?.id ?? null;
            const sessionId = agentId === null ? null : (ctx.sessions?.get?.(agentId)?.id ?? agentId);
            await recordRetrieval({
              root: result.root,
              project: project?.id ?? 'workspace',
              agentId,
              sessionId,
              query,
              results: result.results,
            });
          } catch (error) {
            console.warn('[verification-kernel] could not record retrieval:', error);
          }
        }
        return {
          root: result.root,
          query: result.query,
          policyPath: result.policyPath,
          results: result.results,
        };
      },
    }), 'verification-kernel: knowledge tool');
  }

  if (!hasGate(config)) return;

  const gate = createGate(ctx, config);
  ctx.effect(() => {
    const offCreated = ctx.on('agent/created', (payload) => {
      gate.attach(payload.agent);
    });
    const offDisposed = ctx.on('agent/disposed', (payload) => {
      gate.detach(payload.agent?.id);
    });
    for (const agent of ctx.agents.list()) gate.attach(agent);
    return () => {
      offCreated();
      offDisposed();
      gate.dispose();
    };
  }, 'verification-kernel: gate');
}
