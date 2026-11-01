# Verification Kernel

A small, host-agnostic verification kernel plus a DSH Host adapter and a golden
benchmark.

The kernel turns a **plan** of deterministic checks into an evidence-bearing
**verdict**. The DSH adapter runs that plan when a turn is about to close and,
on failure, steers the evidence back into the turn. It is intentionally
conservative: the plugin ships `off`, checks live in **trusted profile config**
rather than the agent's workspace, and a check that cannot be verified produces
`unknown`, never `pass`.

## What is here

| Path | Purpose |
|---|---|
| `lib/kernel.js` | Plan validation, verdict aggregation, flaky/retry policy, feedback text, gate ladder. No DSH or React imports. |
| `lib/exec.js` | Node `child_process` runner (CLI, tests, golden benchmark). |
| `lib/artifacts.js` | Writes latest/history/trace evidence, hashes, and redacted per-check output. |
| `lib/dsh.js` | DSH config/project-router resolution, Host `subprocess` runner, tool rendering. |
| `lib/auto-load.js` | Embedded `verification-protocol` and `repo-review` skills + profile-wide prompt section. |
| `lib/override.js` | Human override record read/write/expiry/match. |
| `lib/report.js` | Trace metrics: verdicts, flaky checks, overrides, latency. |
| `lib/contract.js` | Acceptance-contract validation and checklist. |
| `lib/redact.js` | Best-effort secret redaction for evidence. |
| `lib/diff.js` | Git diff collection + allow/deny/size scope audit. |
| `lib/security.js` | Gitleaks/Semgrep/Trivy adapters and normalized findings. |
| `lib/trajectory.js` + `lib/session-log.js` | Session log decoder and heuristic trajectory critic. |
| `lib/review.js` | Read-only repo review packet (diff + rules + prompt). |
| `lib/test-patch.js` | Detached git-worktree test-patch runner (fast fallback). |
| `lib/test-patch-wsl.js` | WSL2 Linux VM test-patch runner. |
| `lib/test-patch-docker.js` | Network-disabled Docker container test-patch runner inside WSL2. |
| `lib/verify-wsl.js` | Copies a project to WSL2 and runs the verifier outside the Host process. |
| `lib/outcomes.js` | Append-only outcome store + latency/cost-proxy summary. |
| `lib/sign.js` | Ed25519 verdict signing and verification (tamper evidence). |
| `lib/workflow.js` | Deterministic five-phase workflow (resolve/execute/evidence/gate/report). |
| `lib/calibration.js` | Outcome calibration: per-check reliability/latency recommendations. |
| `lib/complexity.js` | Deterministic diff/snapshot fast-path classifier. |
| `lib/knowledge.js` | Local docs FTS5 index with Latin + CJK bigram search. |
| `lib/ab.js` | Paired outcome A/B comparison with bootstrap CI. |
| `lib/advisor.js` | L1 advisory critic adapter (external command or heuristic). |
| `lib/pr-check.js` | L2 review packet + isolated QA test-patch. |
| `lib/mutation.js` | Mutation-based check-quality audit. |
| `lib/benchmark.js` | Patch-task benchmark runner (worktree/WSL/Docker) with false accept/reject. |
| `lib/trace-export.js` | Eval-friendly trace export. |
| `index.js` | DSH Host plugin: `verification_run` tool + routed `agent/turn-stopping` gate. |
| `bin/verify.js` | CLI: exit 0 pass, 1 fail, 2 unknown/error. |
| `bin/override.js` | CLI: create/revoke a human override. |
| `bin/report.js` | CLI: summarize verifier trace metrics. |
| `bin/contract.js` | CLI: validate an acceptance contract. |
| `bin/diff-audit.js` | CLI: audit git diff scope and size. |
| `bin/security-audit.js` | CLI: run available security scanners. |
| `bin/export-trace.js` | CLI: export trace JSONL. |
| `bin/critic.js` | CLI: heuristic trajectory critic. |
| `bin/review-packet.js` | CLI: build a read-only review packet. |
| `bin/policy-check.js` | CLI: evaluate a verdict with OPA. |
| `bin/test-patch.js` | CLI: apply a patch in a worktree, WSL2, or Docker and test. |
| `bin/mutation.js` | CLI: curated mutation score for the test suite. |
| `bin/mutation-gate.js` | CLI: enforce a Stryker mutation-score threshold. |
| `bin/verify-wsl.js` | CLI: run the verifier in a WSL2 temp copy (independent boundary). |
| `bin/outcomes.js` | CLI: append verdicts and report pass rate, p50/p95 latency, cost proxy. |
| `bin/workflow.js` | CLI: deterministic resolve→execute→evidence→gate→report workflow. |
| `bin/verification-keygen.js` | CLI: generate an Ed25519 signing key pair. |
| `bin/verdict-verify.js` | CLI: verify a signed verdict artifact. |
| `bin/calibrate.js` | CLI: outcome calibration report. |
| `bin/knowledge.js` | CLI: build/search the local knowledge index. |
| `bin/ab.js` | CLI: paired A/B outcome comparison. |
| `bin/pr-check.js` | CLI: local PR review packet + isolated QA. |
| `bin/benchmark.js` | CLI: run a manifest of patch tasks and report false accept/reject. |
| `policies/` | OPA Rego policy for verdicts. |
| `tools/` | Locally installed scanners and Semgrep rules (binaries are not shipped). |
| `ci/` | CI plan, POSIX/PowerShell runners, GitHub Actions workflow. |
| `presets/verification/` | Installable `verification` agent preset (standard toolset + accuracy-first persona). |
| `golden/` | 20 generated tasks, held-out tests, and the benchmark runner. |

## Plan

```json
{
  "id": "my-plan",
  "checks": [
    { "id": "visible", "argv": ["node", "test.mjs"], "required": true, "timeoutMs": 60000 },
    { "id": "heldout", "argv": ["node", "../heldout/test.mjs"], "required": true }
  ]
}
```

- Checks are **argv arrays**, never shell strings.
- `required` defaults to `true`; optional failures are recorded but do not fail
  the verdict.
- A nonzero exit code is `fail`; a timeout, spawn error, or aborted turn is
  `unknown`.
- `retries` (0–5) reruns a failed check. If a retry passes, the check is
  `flaky` and a required flaky check makes the verdict `flaky`, never a silent
  pass.
- `cwd` is relative to the plan root and cannot escape it.
- No required checks means `unknown`, not pass.
- `expectedPlanHash` (profile/project) pins the SHA-256 of the normalized plan;
  a mismatch refuses to run and records `unknown`.

## CLI

```bash
node bin/verify.js --plan plan.json --cwd . --json
node bin/report.js --dir .dsh/verification
node bin/contract.js --file docs/templates/contract.json
node bin/override.js --reason "known flake" --minutes 60
node bin/override.js --revoke
```

Artifacts are written under `<cwd>/.dsh/verification/` unless `--no-artifacts`
is passed. Each run writes `latest.json`, a history entry, `trace.jsonl`, and a
`hashes.verdict` SHA-256. Set `artifactDir` to an absolute path to store
evidence outside the workspace. The override file is cooperative: it is a
workspace file, not a security boundary.

## P2/P3 tools

```bash
# diff/scope budget
node bin/diff-audit.js --cwd . --allow src/ --max-files 20 --max-lines 500

# security scanners (installed locally under tools/bin)
node bin/security-audit.js --cwd .

# eval-friendly trace export
node bin/export-trace.js --dir .dsh/verification --out .dsh/verification/export.json

# heuristic trajectory critic (advisory)
node bin/critic.js --session <path-to-session.v4.jsonl.zstd> --json

# read-only review packet + reviewer prompt
node bin/review-packet.js --cwd . --base HEAD --prompt --out .dsh/verification/review.md

# OPA policy decision
node bin/policy-check.js --input .dsh/verification/latest.json

# functional test-patch isolation (git worktree, fast fallback)
node bin/test-patch.js --patch fix.patch --cmd node --arg --test

# Linux/VM-isolated test-patch (WSL2)
node bin/test-patch.js --wsl --patch fix.patch --cmd node --arg --test

# independent verifier boundary: copy project to WSL2 and run checks there
node bin/verify-wsl.js --cwd ../session-view --plan ../verification-kernel/benchmarks/session-view-plan.json --json

# container-isolated test-patch (Docker Engine inside WSL2, network disabled)
node bin/test-patch.js --docker --patch fix.patch --cmd node --arg --test

# check-quality and task benchmark
node bin/mutation.js --cwd .
node bin/mutation-gate.js --report .dsh/mutation/stryker.json --min 80
node bin/benchmark.js --manifest tasks.json --isolation docker --json
node bin/outcomes.js --append .dsh/verification/latest.json --store .dsh/verification/outcomes.jsonl
node bin/outcomes.js --report --store .dsh/verification/outcomes.jsonl --json

# deterministic five-phase workflow
node bin/workflow.js --plan ci/plan.json --cwd . --json

# outcome calibration and local knowledge base
node bin/calibrate.js --store .dsh/verification/outcomes.jsonl --json
node bin/knowledge.js --root . --index
node bin/knowledge.js --root . --query "mutation score" --limit 5

# paired A/B from two outcome stores
node bin/ab.js --control control.jsonl --treatment treatment.jsonl --json

# L2 local PR review + isolated QA
node bin/pr-check.js --qa-command '["node","--test","test/all.test.js"]' --json

# verdict signing (tamper evidence; not remote attestation)
node bin/verification-keygen.js --out-dir .dsh/keys
node bin/verify.js --plan ci/plan.json --cwd . --sign-key .dsh/keys/verification.key
node bin/verdict-verify.js --verdict .dsh/verification/latest.json --pub .dsh/keys/verification.pub --json
```

Dependencies installed locally:

| Tool | Version | Location |
|---|---|---|
| Semgrep | 1.182.1 | user Python `Scripts\semgrep.exe` |
| Gitleaks | 8.30.1 | `tools/bin/gitleaks.exe` |
| Trivy | 0.76.1 | `tools/bin/trivy.exe` |
| OPA | 1.21.4 | `tools/bin/opa.exe` |
| Git | PortableGit 2.55 | `D:\workbuddy\resources\vendor\PortableGit\cmd\git.exe` |
| WSL2 | Ubuntu 22.04, kernel 6.18 | imported offline from Ubuntu base rootfs |
| Linux Node | 24.12.0 | `/opt/node` in WSL |
| Linux Git | 2.34.1 | apt in WSL |
| Docker Engine | 29.1.3 | inside WSL; local `ubuntu-base:local` image |
| Miniconda | Python 3.9 | for real SWE-bench task environments |

Docker Desktop/Podman is **not required**: Docker Engine runs inside WSL2 and
`dsh-test-patch --docker` uses a network-disabled container. The worktree mode
remains as a fast fallback. The security audit excludes `test/`, `docs/`, and
`golden/` to avoid flagging deliberate test fixtures.

## Golden benchmark

```bash
node golden/generate.js
node golden/run.js
```

Generated set: 10 tasks × 2 variants = 20 tasks, three candidates each
(`good`, `bad-visible`, `bad-hidden`), two policies (`visible-only`, `full`),
plus four robustness probes.

Latest result:

```
policy        pass  fail  unknown  false-reject   false-accept
visible-only    40    20        0  0/20 (0.0%)    20/40 (50.0%)
full            20    40        0  0/20 (0.0%)    0/40 (0.0%)
```

`bad-hidden` passes the visible test and fails the held-out test. The
`visible-only` policy accepts all of them (50% false accept); adding the
independent held-out check removes both false accepts and false rejects.
Robustness probes cover timeout, spawn error, empty plan, and nonzero exit.

**What this measures:** the verifier's mechanics and the cost of weak check
coverage. It does **not** measure a model's coding ability. An agent baseline
requires running real sessions; `golden/tasks/*/task.md` and the plans are ready
for that harness, but it is not executed by `run.js`.

## Real SWE-bench subset

Ten real sympy tasks from `SWE-bench/swe-bench-tasks` were run via
`scripts/run-sympy-tasks.sh` in WSL (Python 3.9, task `test.patch`/`gold.patch`):

| Task | No gold | With gold | Assessment |
|---|---|---|---|
| `sympy__sympy-11232` | 4 failed, 7 exceptions | 0 failed, 7 exceptions | target fixed; environment noise |
| `sympy__sympy-11384` | 0 failed, 1 XPASS | 0 failed | not reproducible |
| `sympy__sympy-11400` | 2 failed, 0 exceptions | 0 failed, 0 exceptions, exit 0 | clean real-task pass |
| `sympy__sympy-11438` | 1 failed, 0 exceptions | 0 failed, 15 exceptions | target fixed; environment noise |
| `sympy__sympy-11618` | 1 failed, 1 exception | 0 failed, 1 exception | target fixed; environment noise |
| `sympy__sympy-11787` | 1 failed, 0 exceptions | 0 failed, exit 0 | clean real-task pass |
| `sympy__sympy-11788` | 1 failed, 7 exceptions | 0 failed, 7 exceptions | target fixed; environment noise |
| `sympy__sympy-11794` | 1 failed, 1 XPASS | 0 failed, 14 exceptions, 1 XPASS | target fixed; noise |
| `sympy__sympy-11818` | 1 failed, 9 exceptions | 0 failed, 10 exceptions | target fixed; environment noise |
| `sympy__sympy-11831` | 0 failed, 8 exceptions | 0 failed, 7 exceptions | not reproducible |

Summary: **2 clean / 6 target-fixed-with-noise / 2 not reproducible**.
The measured **pre-gold escape rate is 2/10 = 20%**: two tasks passed their
target test before the gold patch, so this environment cannot certify those
FAIL_TO_PASS transitions. This is a **real task measurement**, not a
leaderboard claim.

A full pinned `environment.yml` was then installed in `/opt/testbed-full`
(by dropping the unreachable `conda-forge` channel; all packages are in
`defaults`) and all 10 tasks were rerun. Exceptions persist
(`11788`: 5–6; `11794`: 14), so the remaining gap is the old sympy test
suite/runner, not missing packages. Results are in
`benchmarks/sympy-full-env.json`; the earlier partial run is in
`benchmarks/sympy-exact-env.json`. Docker Hub is unreachable here; local
containers and WSL are used instead.

## Enabling the DSH gate

The installed profile routes three workspace projects in `enforce` mode and
enables the accuracy-first context:

```yaml
- id: verification-kernel
  config:
    mode: enforce
    autoLoad: true
    includeSubagents: true
    executables:
      node: 'C:\Users\<you>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
    projects:
      - id: verification-kernel
        root: 'C:\Users\<you>\...\verification-kernel'
        mode: enforce
        includeSubagents: true
        checks:
          - id: unit
            argv: ['node', '--test', 'test/kernel.test.js', 'test/dsh.test.js', 'test/override.test.js', 'test/report.test.js', 'test/contract.test.js']
            required: true
            timeoutMs: 120000
          - id: golden
            argv: ['node', 'golden/run.js']
            required: true
            timeoutMs: 180000
      - id: browser-automation
        root: 'C:\Users\<you>\...\browser-automation'
        mode: enforce
        checks:
          - id: actions
            argv: ['node', '--test', 'test/actions.test.js']
            required: true
            timeoutMs: 120000
      - id: session-view
        root: 'C:\Users\<you>\...\session-view'
        mode: enforce
        checks:
          - id: syntax-index
            argv: ['node', '--check', 'index.js']
            required: true
          - id: syntax-client
            argv: ['node', '--check', 'client.js']
            required: true
```

- `projects` is the router: the longest matching `root` wins for a session cwd.
  No match means no gate (the safe default). `defaultMode` defaults to `off`.
- `verification_run` with no `project` resolves by cwd. With multiple projects,
  a session at the workspace root has no match and should pass an explicit
  `project` id; the single-project fallback only applies when exactly one
  project is configured.
- `mode: dry-run` runs and records checks at turn end but never steers.
- `mode: enforce` steers failing required checks back into the turn.
- `maxAttempts` bounds feedback steers; after the budget the gate sends one
  final "report the failure honestly" message and then allows the turn to close.
- `includeSubagents` is `false` by default, so child agents are not gated twice.
- `isolation: wsl` runs the project's checks in a WSL2 temp copy through
  `dsh-verify-wsl`, not through the Host subprocess runner. `wslDistro`
  defaults to `Ubuntu-22.04` and `wslTimeoutMs` to 5 minutes. The copy is
  writable and networking is not disabled yet; this is an execution boundary,
  not a read-only sandbox.
- `autoLoad: true` registers the `verification-protocol` and `repo-review`
  skills plus a compact profile-wide prompt section; every new session/preset
  gets the section, and the skills are loadable on demand.
- `autoFeedback: true` links recent `knowledge_search` retrievals to the next
  same-project/agent pass/fail outcome, updates a small bounded retrieval
  policy, and refreshes calibration. It is labeled `weak-retrieval-window` and
  does not train unknown/flaky outcomes.
- `advisor` is the L1 advisory critic. With no `command`, a local heuristic
  scores the verdict; with `command`, an external critic receives JSON on stdin
  and returns `{score, risk, issues, summary}`. It is stored but never changes
  the deterministic pass/fail.
- `writeArtifacts` / `artifactDir` control evidence location; an absolute
  `artifactDir` stores it outside the workspace. Each run writes hashes and a
  JSONL trace.
- `outcomeStore` optionally appends every gate/tool verdict as JSONL, including
  latency and a deterministic check-time cost proxy. `dsh-outcomes --report`
  aggregates pass rate, p50/p95 latency, retries, and per-project buckets.
- `signingKey` optionally signs the verdict with Ed25519 before writing
  artifacts; verify with `dsh-verdict-verify`. This is local tamper evidence,
  not remote attestation or protection from a hostile local admin.
- `overridePath` (default `.dsh/verification/override.json`) is read by the
  gate; a valid, unexpired override suppresses steering and is recorded.
- `expectedPlanHash` pins the normalized plan SHA-256; a mismatch refuses to
  run and records `unknown`.
- `retries` on a check marks pass-after-failure as `flaky`; required flaky
  checks do not pass.
- The `verification_run` tool is always available (unless `registerTool: false`)
  so the agent can run the same checks before stopping.
- `executables` maps a bare check name to an absolute executable. Host children
  start from a scrubbed environment, so bare `node` may not resolve; pin it.

The desktop runtime also ships `D:\deepseek\resources\runtime\bin\node.cmd`, but
that wrapper depends on `DSH_DESKTOP_NODE_EXECUTABLE` being present in the child
environment; an explicit absolute `node.exe` is the more portable pin.

The gate listens to `agent/turn-stopping`, which runs before an otherwise
completed turn closes and can steer to keep it open. A slow check therefore
delays turn closure; keep timeouts tight. The gate is cooperative: it runs in
the same process/user as the agent. Enabling enforcement is an explicit profile
decision; use CI for a boundary the agent cannot edit.

### Agent preset

`presets/verification/` is installed as `@local/dsh-verification-preset`; select
**Verification** in the agent preset picker. It uses the standard coding
toolset plus an accuracy-first persona. The profile-wide prompt section and
`verification-protocol` skill apply to every preset, so auto-load does not
depend on selecting this preset. The main verifier plugin is profile-level, not
part of the preset.

### Project policy

The routed project sets `denyTools: [plugin_manager]`. When a session's cwd is
inside that project, a tool guard denies `plugin_manager`; the guard is
cooperative and does not prevent filesystem/config edits. `expectedPlanHash`
can pin the normalized plan. Neither is a substitute for a separate process,
user, or CI boundary.

## Verification performed

- `node --test test/all.test.js` — 113 tests: 112 pass, 1 optional Docker skip across kernel semantics/contracts, router, override, report, contract, diff, security, trace-export, trajectory, review, policy, worktree/WSL/Docker test-patch, WSL verifier, outcomes, signing, workflow, calibration, complexity, knowledge, local learning, automatic feedback, L1 advisor, L2 PR check, A/B, benchmark, mutation, mutation-gate, and auto-load tests.
- StrykerJS 10.1.1 sample on `lib/kernel.js:191-215`: **100% (46/46 killed)**, improved from 43.48% after adding verdict reason/summary/title contract tests.
- StrykerJS full `lib/kernel.js`: **96.94%** (853 killed, 1 timeout, 27 survived, 0 errors, 4m22s; 881 mutants). `dsh-mutation-gate --min 96` passes. See [mutation-equivalents.md](docs/mutation-equivalents.md) for the 27 classified survivors.
- Project router: `verification_run` resolved `verification-kernel` (48/48),
  `browser-automation` (4/4), and `session-view` (2/2 syntax checks); all PASS.
- Auto-load: a new subagent's session log contains the profile-wide
  `## Verification discipline` system section and the `verification-protocol`
  skill in its catalog; the skill body loads on demand.
- Flaky policy: a fail-then-pass check is `flaky`, required flaky yields
  `flaky` (not pass), and the gate allows instead of steering.
- Override: a valid unexpired override suppresses steering; an expired override
  does not. The override CLI writes/revokes the record.
- Evidence: latest/history/trace are written; `hashes.verdict` is a SHA-256 of
  the payload and verifies after removing `hashes`; stdout/stderr secrets are
  redacted; an absolute `artifactDir` stores evidence outside the workspace.
- Metrics: `bin/report.js` summarizes verdicts, flaky checks, overrides, and
  p50/p95 latency from `trace.jsonl`.
- Acceptance contract: `bin/contract.js` validates criteria/claims and prints a
  checklist; invalid contracts exit 2.
- `golden/run.js` — under the full policy (visible + held-out): 0 false accepts,
  0 false rejects, 0 unknown across 20 tasks / 120 candidate runs. Under
  visible-only: 50% false accepts, all from `bad-hidden`. All 4 robustness
  probes (timeout, spawn error, empty plan, nonzero exit) produced the expected
  verdict.
- `verification_run` ran a real Host `subprocess` check and wrote
  `.dsh/verification/latest.json` plus per-check evidence.
- A live subagent turn in `dry-run` mode triggered `agent/turn-stopping`, ran a
  passing smoke check, and wrote the same artifact shape. This exercises the real
  per-agent gate wiring, not just the unit harness.
- Live executable probe: bare `node` fails with
  `SubprocessExecutableNotFoundError` on the Host subprocess PATH. An
  `executables` mapping from `dshnode` to the bundled `node.exe` resolves and
  runs; pin absolute executables in real check plans.
- Live enforced gate (failing required check, `maxAttempts: 1`,
  `includeSubagents: true`, `allowRoots` limited to a test workspace): the first
  run exposed a real bug — the steered message lacked `id` and `role`, so the
  next provider request failed with `422 missing field role`. The fix sends a
  complete user message; the retest delivered the failure evidence to the child,
  which investigated and produced a second failing verdict instead of claiming
  success. A second artifact was recorded; the child was interrupted before the
  final allow step to bound the test. The attempt ladder remains unit-tested.
- Live pass gate (same setup, passing check): the gate ran once, recorded
  `pass`, did not steer, and the child completed normally.
- This also exposed a governance gap: the bundle source patch lives in the agent
  workspace, and an agent with `plugin_manager` access could edit and reinstall
  it. For real enforcement, keep trusted bundle sources outside the agent's
  write scope and do not give gated agents plugin-management tools.

## Trust boundary

- Check definitions come from profile config, not from a file the agent can
  rewrite. Do not point `argv` at an agent-writable script if the result must be
  trustworthy.
- Artifacts are evidence, not a security boundary; the agent can edit its
  workspace. For audit, set an absolute `artifactDir` outside the workspace and
  verify `hashes.verdict`; a hash is tamper-evident only if the expected value
  is stored somewhere the agent cannot rewrite.
- `expectedPlanHash` makes a changed plan visible, but the expected value and
  the plugin config live in the same profile; it is not an adversarial boundary.
- The human override is a cooperative workspace file. It records intent; it does
  not prove the user approved it unless stored outside agent write scope.
- The kernel enforces filesystem-scoped sandbox policy only as far as the Host
  `subprocess` service does; network isolation is not provided here.
- `unknown` is a first-class verdict. Do not convert it to pass to make a gate
  quiet. `flaky` is also not a pass.

## Development

```bash
node --test test/kernel.test.js test/dsh.test.js test/override.test.js test/report.test.js test/contract.test.js
node bin/verify.js --plan ci/plan.json --cwd .
node --check index.js
```

## Docs

- [Roadmap & Operating Model](docs/verification-roadmap.md)
- [Accuracy-First Verification Protocol](docs/accuracy-first-protocol.md)
- [Phase 1 Task Board](docs/phase1-board.md)
- [Phase 1 Implementation Report](docs/phase1-implementation.md)
- [P2/P3 Implementation Report](docs/p2-p3-implementation.md)
- [World-Class Roadmap & Progress](docs/world-class-roadmap.md)
- [World-Class Scorecard](docs/world-class-scorecard.md)
- [Deterministic Verification Workflow](docs/verification-workflow.md)
- [Calibration, Fast Path, Knowledge, A/B](docs/calibration-fastpath-knowledge-ab.md)
- [Local Policy Learning](docs/local-policy-learning.md)
- [Verification Stack Architecture](docs/verification-stack-architecture.md)
- [Plugin Catalog](docs/plugin-catalog.md)
- [Hermes Agent Reuse Notes](docs/reuse-hermes-agent.md)
- [Archived roadmap v1](docs/archive/2026-10-27-verification-roadmap-v1.md)
- [Archived accuracy protocol v1](docs/archive/2026-10-28-accuracy-first-protocol-v1.md)
- [Archived Phase 1 implementation v1.1](docs/archive/2026-10-28-phase1-implementation-v1.1.md)
- [Archive manifest](docs/archive/MANIFEST.md)
