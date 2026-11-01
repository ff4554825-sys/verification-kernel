# Verification Kernel — Roadmap & Operating Model

| Field | Value |
|---|---|
| Document | `verification-kernel/docs/verification-roadmap.md` |
| Version | v1.0 |
| Date | 2026-10-27 (Asia/Shanghai) |
| Status | Current recommendation; Phase 1 awaiting decision |
| Scope | Verification kernel, DSH gate, metrics, evidence, roadmap |
| Related | `verification-kernel/README.md`, `verification-kernel/cordis.patch.yml`, `session-view/README.md` |
| Archive | `verification-kernel/docs/archive/2026-10-27-verification-roadmap-v1.md` |

## 0. Executive summary

v1 of the verifier is working: deterministic checks, a `turn-stopping` gate,
a `verification_run` tool, evidence artifacts, a 20-task golden set, and live
pass/fail/steer tests. The problem now is not "can it run" but "can it be
trusted, measured, and operated".

**Do not build all six proposed capabilities at once.** Sequence them:

1. **Phase 1 — trust foundation (P0):** policy outside the agent's authority,
   human override, flaky handling, evidence integrity, verifier metrics/trace,
   CI integration.
2. **Phase 2 — coverage (P1):** test-patch/hidden tests (requires a container
   runtime), diff/security checks, trajectory heuristics, on-demand repo
   review/QA.
3. **Phase 3 — intelligence (P2):** read-only verifier subagent / LLM judge,
   best-of-N, small trained critic, OPA/Cedar, formal methods.

Container isolation is currently **blocked**: `docker` and `podman` are absent,
and WSL has the command but no verified usable distribution. Do not schedule
Docker-based test-patch work until that is resolved.

## 1. Current state (v1.0, 2026-10-27)

### 1.1 What v1 does

- Host-agnostic kernel: `Check` (argv, cwd, timeout, required) → `Verdict`
  (`pass` / `fail` / `unknown`) with per-check evidence.
- DSH adapter: `verification_run` tool, `agent/turn-stopping` gate,
  `maxAttempts`, `allowRoots`, `includeSubagents`, `executables`,
  `dry-run` / `enforce` / `off`.
- Evidence: `.dsh/verification/latest.json`, history, per-check stdout/stderr.
- Golden set: 10 templates × 2 variants = 20 tasks, 120 candidate runs,
  4 robustness probes; false accept/reject measured.
- Tests: 18/18 unit tests; live tool pass/fail/unknown; live gate fail→steer
  (after the `role`/`id` fix) and pass→allow.

### 1.2 Live evidence

- Kernel unit tests: 18/18 pass.
- Golden set, `full` policy: 0 false accepts / 40 bad candidates, 0 false
  rejects / 20 good candidates; robustness 4/4.
- Golden set, `visible-only`: 50% false accepts, demonstrating check-coverage
  risk.
- Project self-check (current configuration): `unit` + `golden`, PASS, 17.1s,
  verdict at `verification-kernel/.dsh/verification/latest.json`.
- A real subagent in the project triggered the dry-run gate and recorded PASS.

### 1.3 Environment constraints

| Dependency | State |
|---|---|
| Node / pnpm | Bundled; not on the Host subprocess PATH (`node` must be pinned) |
| Git | Not installed system-wide; PortableGit 2.55 is available |
| Docker / Podman | Missing |
| WSL | `wsl.exe` exists; no verified usable distribution |
| CDP | Enabled on `127.0.0.1:9222`; used for visual checks |
| Browser automation | `playwright-core` + Edge; separate browser, not the Electron page |

### 1.4 Trust boundary

The gate currently runs in the **same DSH Host process and same OS user** as the
agent. The bundle source and checks live in the agent-writable workspace. An
agent with `plugin_manager` or filesystem access can modify or reinstall the
gate. This is acceptable for a cooperative local workflow, but it is **not a
security boundary**.

Consequences:

- A verdict is evidence, not proof of non-tampering.
- "Policy outside the workspace" is necessary but insufficient under
  `danger-full-access`; real enforcement needs a separate process/user or CI.
- Do not claim adversarial guarantees from the current plugin.

## 2. Principles

1. **Deterministic evidence before model judgment.** Tests, builds, static
   analysis, hashes; an LLM judge may add judgment but cannot replace evidence.
2. **One source of truth.** Verdict + evidence + trace; never self-reported
   completion.
3. **Completion is a gate.** No `pass` without evidence; `unknown` is a valid
   outcome and never silently becomes `pass`.
4. **Policy is outside the agent's authority.** Managed config, allowlists,
   signed checks; same-process enforcement is cooperative, not adversarial.
5. **Tiered verification.** Fast checks every turn; deep checks on demand/CI;
   do not run a 17s golden suite every turn by default.
6. **Build thin, adopt mature tools.** Keep the DSH adapter small; integrate
   test harnesses, static analysis, eval frameworks, and CI rather than
   reimplementing them.
7. **Measure the verifier.** False accept/reject, block rate, escape rate,
   flaky rate, cost, latency; a verifier without metrics is another linter.
8. **Human override with audit.** False positives must be appealable without
   destroying the evidence trail.
9. **Reproducibility.** Pin toolchains, lockfiles, environment, seeds; clean up
   temporary state.
10. **Least authority for the verifier.** Read-only inputs, separate
    credentials, no agent-writable policy.

## 3. Capability assessment

| Capability | Current | Priority | Decision |
|---|---|---|---|
| Completion gate (unknown, attempts, allowRoots, subagents) | Partial | P0 | Extend: human override, task-completed/teammate-idle equivalents, managed policy |
| Verifier metrics (false accept/reject, cost, latency, escape) | Partial | P0 | Build: metrics report + trace + CI |
| Evidence chain (hash/sign, external store, audit) | Partial | P0/P1 | Build: hash + external store + redaction; OPA/Cedar later |
| Test-patch / hidden tests / Docker | Not started | P1 | Defer until Docker/WSL is available; use temp dirs + PortableGit worktree as weak interim |
| Trajectory critic | Not started | P1 heuristics / P2 model | Start with heuristics; train a model only with production data |
| Repo-level review/QA verifier | Not started | P1 | On-demand/PR only; read-only subagent; not every turn |
| Acceptance criteria / task contract | Not started | P0/P1 | Build first-class task contract; the largest functional gap |
| Diff/scope/API compatibility | Not started | P1 | Add diff-aware checks and public API checks |
| Security verification | Not started | P1 | Adopt Semgrep/CodeQL/Trivy/Gitleaks |
| Flaky handling | Not started | P0 | Retry/quarantine; separate environment vs code failure |
| Human override / UX | Not started | P0 | Override with reason + audit; verdict badge/history |
| CI enforcement | Not started | P0 | Run the CLI in CI; branch protection |
| Cost/latency tiering | Partial (17.1s project gate) | P0/P1 | Fast/medium/deep lanes |
| Data privacy/retention | Not started | P0/P1 | Redact, retain, access-control artifacts |
| Failure taxonomy | Not started | P1 | Classify spec/impl/test/env/flaky/security |
| Cross-session learning | Not started | P2 | Only after metrics; avoid overfitting |

## 4. Roadmap

### Phase 0 — v1 (done)

Deterministic kernel, DSH gate/tool, artifacts, golden set, unit tests, live
verification, `role`/`id` steer fix, project self-check in `dry-run`.

### Phase 1 — Trust foundation (P0, next)

Goal: make enforcement defensible and measurable before adding coverage.

| ID | Task | Depends | Risk | Acceptance |
|---|---|---|---|---|
| P1.1 | Policy/trust boundary: move bundle/check config outside agent write scope; define managed policy; remove `plugin_manager` from gated agents; document same-process limits | — | R2 | A gated agent cannot edit/reinstall checks with normal tools; documented threat model |
| P1.2 | Human override + `blocked`/`unknown` UX + audit | P1.1 | R2 | Failed verdict can be overridden with reason; override recorded; no deadlock |
| P1.3 | Flaky policy: retries, quarantine, environment vs code classification | — | R1 | Simulated flaky check is retried/quarantined; metrics separate flaky from fail |
| P1.4 | Evidence integrity: hash/sign, external store, redaction | P1.1 | R2 | Verdict hash and external copy exist; tamper detectable; secrets redacted |
| P1.5 | Metrics/trace: false accept/reject, block rate, escape, cost, latency, flaky; JSONL trace; CI report | P1.3 | R1 | Golden + mutation report produced; trace export documented |
| P1.6 | Acceptance criteria / task contract: goal, non-goals, criteria, evidence, unknown policy | — | R1 | Sample tasks carry a contract; each criterion is checked or marked unknown/overridden |
| P1.7 | CI runner: `dsh-verify` in CI, branch protection, signed artifacts | P1.5 | R1 | CI fails on required fail; artifact retained outside workspace |

Phase 1 exit criteria:

- A gated agent cannot change its own checks.
- A failed check can be overridden with an auditable reason.
- Flaky vs real failure is distinguishable.
- Verdicts are hashed and stored outside the agent workspace.
- Metrics report has false accept/reject, escape, cost, latency, flaky.
- CI runs the same plan as the local gate.
- A sample task contract is checked end-to-end.

### Phase 2 — Coverage (P1)

Entry criteria: Phase 1 exit criteria met; Docker/WSL available for isolation.

| ID | Task | Depends | Acceptance |
|---|---|---|---|
| P2.1 | Container runtime (Docker/WSL) and test-patch harness | Phase 1 | Reproducible `FAIL_TO_PASS` / `PASS_TO_PASS` runs in a clean container |
| P2.2 | Diff/scope/API compatibility checks | P2.1 | Only intended files/behavior change; public API compatibility reported |
| P2.3 | Security checks: Semgrep/CodeQL/Trivy/Gitleaks | Phase 1 | Security findings appear as checks with severity |
| P2.4 | Trajectory heuristics: loops, repeated tool calls, repeated test failure, oversized diff, scope creep | P1.5 | Heuristic score and reasons in verdict/trace; early-stop option |
| P2.5 | On-demand repo review/QA verifier subagent | P1.1 | Read-only subagent reads diff + repo rules, returns risk + evidence; not on every turn |
| P2.6 | Export trace to Inspect AI / EvalScope | P1.5 | A run can be scored/compared outside DSH |

### Phase 3 — Intelligence (P2)

- Read-only verifier subagent / Agent-as-a-Judge as an advisory score, not the
  sole gate.
- Best-of-N / early-stop using critic scores.
- Small trained critic only with production outcome data (PR merge/code
  survival); benchmark-only critics transfer poorly (OpenHands reports
  near-random AUC on production when trained on benchmark data).
- OPA/Cedar policy-as-code for multi-user/team deployments.
- Formal methods (Lean/Kani/Dafny) only for high-assurance invariants.

## 5. Do not do now

| Not now | Why |
|---|---|
| Train a critic model / Best-of-N | No production outcome data or metrics baseline; benchmark-only critics do not transfer |
| OPA/Cedar | Single-user local deployment; JSON policy + allowlist is enough for Phase 1 |
| Formal verification | Expensive and narrow; not a general task verifier |
| Docker for every check | Missing runtime; heavy; deep checks belong in CI/on demand |
| LLM judge as the only gate | Can be fooled by plausible output; keep deterministic evidence primary |
| Vendoring OpenHands/Inspect/EvalScope into the DSH plugin | Large, Python-heavy, different lifecycle; integrate externally/CLI/JSON |
| Cross-session learning before metrics | Risks overfitting and silent policy drift |
| Enforce mode before P1.1/P1.2 | A gate the agent can edit is theater; false positives will cause deadlocks |
| Reloading the live Electron page during an active turn | Caused a client boot hang/restart during verification; use idle or a separate target |

## 6. Build vs adopt

| Need | Adopt / reference | Integration |
|---|---|---|
| test-patch, FAIL_TO_PASS/PASS_TO_PASS | SWE-bench, Multi-SWE-bench, SWE-smith, mini-swe-agent | External CI/Docker; import task format |
| Repo review/QA | OpenHands Verification Stack / Extensions | Reference design; optional external agent |
| Trajectory critic | OpenHands critic, Agent-as-a-Judge | External scorer; advisory only |
| Eval/trace | Inspect AI, EvalScope, AgentScope | Export JSONL; run outside DSH |
| Structured output / assertions | PydanticAI, DSPy Assertions, Guardrails AI | Patterns; use in external validators or port concepts |
| Security | Semgrep, CodeQL, Trivy, Gitleaks | CLI checks via `argv` |
| Check quality | Stryker, mutmut, Hypothesis, fast-check | CLI checks; mutation score |
| Policy | OPA, Cedar | Phase 3; external policy engine |
| GitHub access (CN) | `github.akams.cn` + `gh.dpik.top`; Gitee/GitCode import | Read/clone/mirror; verify hashes |

License check is required before copying code or skills; prefer reference
designs and external processes over vendoring.

## 7. Metrics and initial targets

| Metric | Definition | Initial target |
|---|---|---|
| False accept | Known-bad candidate receives `pass` | < 1% (golden), 0 on fixed set |
| False reject | Known-good candidate receives `fail` | < 5% |
| Unknown rate | Required checks cannot decide | < 5% |
| Escape rate | Bad change passes all required checks | 0 on golden; track per release |
| Block rate | Required fails per turn | Monitor; no hard target |
| Flaky rate | Same input, different verdict | < 1% after retries |
| Gate latency | p95 fast gate | < 5s; deep checks separate |
| Cost | Tokens + compute per verification | Budget per task class |
| Override rate | Human overrides per week | Monitor; investigate > 10% |

Golden set should grow from 20 to 50–100 tasks, including real project tasks,
ambiguous requirements, flaky tests, security regressions, and non-code
artifacts. Add mutation testing to measure whether checks catch injected bugs.
Export a JSONL trace (tool calls, timings, tokens, verdict, evidence hashes) for
Inspect/EvalScope-style evaluation.

## 8. Task decomposition and scheduling model

### 8.1 What I actually did in this project

The work was **linear and reactive**, driven by the current request:

- Skill-first discovery (`cordis-plugin-development`) → inspection → build →
  unit tests → install → live test → research.
- A coarse `todo_write` list, updated occasionally.
- Repeated `remove_bundle`/`install_bundle` cycles for each configuration
  change.
- Live-environment tests (CDP page reload during an active turn) that caused a
  client hang/restart.
- Research and implementation interleaved without a fixed timebox.

### 8.2 What worked

- Inspection before writing code; no guessed APIs.
- Safe defaults (`off`, then `dry-run`), explicit `unknown`.
- Unit tests + golden set + live tool/gate checks.
- Real bugs found and fixed (steer `role`/`id`; scroll position; stat grid).
- Cleanup of test artifacts and processes.

### 8.3 Weaknesses

1. **No upfront task graph or acceptance criteria.** Requirements expanded
   mid-flight (research, CDP, crash recovery).
2. **No risk classes.** Profile changes, restarts, and live-page reloads were
   treated like ordinary edits.
3. **Repeated configuration churn.** Each test used a separate install cycle
   instead of batching the final config or using an isolated profile.
4. **Live environment used for destructive tests.** A page reload during an
   active turn should have used an idle window or a separate target.
5. **Research creep.** GitHub/verifier research continued after the core
   decision was clear.
6. **Coarse tracking.** The todo list had no dependencies, evidence, or exit
   criteria per item.
7. **No explicit stop rule.** "More verification" could continue indefinitely.

### 8.4 Proposed model

**Work item schema**

```
id, title, objective, inputs, outputs, depends_on, risk_class,
lane, acceptance, evidence, rollback, status
```

Status: `proposed → ready → in_progress → verifying → done | blocked`.

**Risk classes**

| Class | Example | Rule |
|---|---|---|
| R0 | Read files, inspect, fetch docs | No checkpoint |
| R1 | Workspace code/test edits | Run unit/golden; no profile change |
| R2 | Profile config, plugin install/remove, system PATH | One batch, checkpoint, explicit approval |
| R3 | Restart app, system install, live page reload | Never during an active turn; explicit approval |

**Lanes / WIP**

- One **write lane** (code/config/profile changes) and one **read-only research
  lane**; do not run two profile changes concurrently.
- Parallelize only read-only work (research, independent test runs).

**Phase gates**

- Plan: write the task DAG and acceptance criteria.
- Build: smallest batch; no live destructive tests.
- Verify: unit → golden → isolated live test → evidence.
- Archive: update docs, write manifest, clean temp state.

**Scheduling rules**

1. P0 before P1 before P2; a P1 cannot start while a P0 exit criterion is open.
2. Batch R2 changes into one install; compute the final config first.
3. R3 actions require a checkpoint and an idle window.
4. Isolate gate tests: separate profile/session or subagent in a temp workspace;
   never reload the live page mid-turn.
5. Timebox research; return to the write lane with a decision note.
6. Every task has acceptance evidence; no evidence, no `done`.
7. Stop at the phase exit criteria; do not add speculative variants.

### 8.5 Phase 1 task DAG

```
P1.1 Policy/trust ──┬── P1.2 Override/UX ── P1.4 Evidence integrity
                    └── P1.7 CI runner
P1.3 Flaky policy ───── P1.5 Metrics/trace ── P1.7 CI
P1.6 Acceptance contract ── P1.2
```

### 8.6 Stop criteria

- All Phase 1 exit criteria have evidence.
- False accept/reject/flaky metrics are recorded.
- No P0 open; risks documented.
- The document and archive are updated.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| A verifier the agent can edit | Separate process/user or CI; managed policy; remove plugin_manager |
| False confidence from a weak check | Golden + mutation testing; false accept/reject metrics; `unknown` |
| Flaky checks destroy trust | Retries, quarantine, environment classification |
| Gate deadlock / false positives | Human override, continuation cap, timeout, `unknown` exit |
| Secrets/PII in artifacts | Redaction, retention policy, external storage, access control |
| Cost/latency | Tiered checks; fast local, deep CI |
| Overfitting to the golden set | Rotate tasks, real-project cases, held-out tests |
| Tool/API drift | Pin versions, hash configs, adapter tests |
| Docker/WSL unavailable | Weak interim: temp dirs + PortableGit worktree; defer container claims |
| Public proxy supply chain | Verify hashes; no credentials; prefer Gitee/GitCode/official sources |

## 10. Decision log

| Decision | Rationale |
|---|---|
| Keep v1 in `dry-run` for the verifier project | Safe observation; 17.1s/turn; no steer |
| Defer Docker/test-patch | No Docker/Podman; WSL unverified |
| Start with heuristics, not a trained critic | No production outcome data; benchmark critics transfer poorly |
| Keep LLM judge advisory | Deterministic evidence must remain primary |
| Defer OPA/Cedar | Single-user local deployment; JSON policy + allowlist first |
| Defer formal methods | Narrow, expensive; use only for high-assurance invariants |
| Archive v1 roadmap | Stable decision snapshot; future changes get a new version |

## 11. References

- [OpenHands — The Verification Stack](https://www.openhands.dev/blog/20260506-the-verification-stack)
- [OpenHands — Learning to Verify AI-Generated Code](https://openhands.dev/blog/20260305-learning-to-verify-ai-generated-code)
- [Claude Code — Hooks reference](https://code.claude.com/docs/en/hooks)
- [SWE-bench](https://github.com/SWE-bench/SWE-bench)
- [SWE-agent](https://github.com/SWE-agent/SWE-agent)
- [Multi-SWE-bench](https://github.com/multi-swe-bench/multi-swe-bench)
- [Aider](https://github.com/Aider-AI/aider)
- [Inspect AI](https://github.com/UKGovernmentBEIS/inspect_ai)
- [EvalScope](https://github.com/modelscope/evalscope)
- [AgentScope evaluation](https://doc.agentscope.io/tutorial/task_eval.html)
- [Agent-as-a-Judge](https://github.com/metauto-ai/agent-as-a-judge)
- [AgentUniverse PEER](https://github.com/agentuniverse-ai/agentUniverse)
- [PydanticAI output validators](https://ai.pydantic.dev/output/)
- [DSPy Assertions](https://dspy.ai/learn/programming/assertions/)
- [Guardrails AI](https://github.com/guardrails-ai/guardrails)
- [OPA](https://github.com/open-policy-agent/opa) / [Cedar](https://github.com/cedar-policy/cedar)
- [github.akams.cn](https://github.akams.cn) (domestic GitHub proxy portal)
