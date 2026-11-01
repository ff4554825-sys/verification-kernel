# Phase 1 Implementation Report

| Field | Value |
|---|---|
| Document | `verification-kernel/docs/phase1-implementation.md` |
| Version | v1.0 |
| Date | 2026-10-28 (Asia/Shanghai) |
| Status | Locally verified; partial items stated explicitly |
| Scope | Phase 1 trust foundation + project router + skill/prompt/preset auto-load |
| Archive | `docs/archive/2026-10-28-phase1-implementation-v1.md` |
| Related | `verification-roadmap.md`, `accuracy-first-protocol.md`, `phase1-board.md` |

## 1. What was delivered

| Capability | Status | Evidence |
|---|---|---|
| Project router (`projects[]`, longest root, per-project mode/checks) | Done | `resolveKernelConfig`, `resolveProjectForCwd`, `resolveProjectForCall`; router unit test; live `Project verification-kernel: PASS` |
| Embedded `verification-protocol` skill | Done | Registered via `ctx.skills.register`; a new subagent's skill catalog contains it |
| Profile-wide accuracy-first prompt section | Done | New subagent's `system/message` contains `## Verification discipline` |
| Dedicated `verification` preset | Installed | `@local/dsh-verification-preset` with `preset-verification` row |
| Flaky policy | Done | `retries` 0–5; fail→pass is `flaky`; required flaky does not pass; gate allows |
| Human override | Done (CLI) | `bin/override.js`; gate reads unexpired matching override and records it; expired override does not apply |
| Evidence hashes | Done | `hashes.verdict` = SHA-256 of latest payload; per-check hashes |
| Trace + metrics | Done (local) | `trace.jsonl`; `bin/report.js` (verdicts, flaky, overrides, p50/p95) |
| Secret redaction | Done | `lib/redact.js`; stdout/stderr and evidence files redacted |
| External evidence store | Done | Absolute `artifactDir`; unit test writes outside workspace |
| Acceptance contract | Done (CLI) | `bin/contract.js`, `docs/templates/contract.json` |
| CI runner | Template + local pass | `ci/plan.json`, `ci/verify.sh`, `ci/verify.ps1`, GitHub Actions workflow |
| Pinned plan hash + `denyTools` | Done | `expectedPlanHash` mismatch refuses to run and records `unknown`; project `denyTools` guard denies matching tool calls |
| Golden benchmark | Still passes | full policy: 0 false accepts, 0 false rejects; robustness 4/4 |

## 2. Verification performed

### Unit and golden

```text
node --test test/kernel.test.js test/dsh.test.js test/override.test.js test/report.test.js test/contract.test.js
→ 33/33 pass

node golden/run.js
→ visible-only: 20/40 false accepts (50.0%)
→ full: 0/20 false rejects, 0/40 false accepts
→ robustness: timeout/spawn-error/empty-plan/nonzero all expected
```

### Local CI plan

```text
node bin/verify.js --plan ci/plan.json --cwd .
→ PASS (unit + golden, ~17.1s)
→ latest/history/trace + hashes written
node bin/report.js --dir .dsh/verification
→ verdicts pass 1; checks 2; latency p95 17060ms
```

### Live DSH checks

- `verification_run` with no project argument resolved the single configured
  project and returned `Project verification-kernel: PASS`.
- A new subagent in `default-workspace` received the profile-wide
  `## Verification discipline` system section and the
  `verification-protocol` skill catalog entry.
- A live flaky CLI run produced `status: flaky`, attempts `[fail, pass]`, and
  exit code 2 (not pass).
- The override CLI wrote, read, and revoked an override successfully.
- A subagent in `verification-kernel` is used as a dry-run gate probe; see the
  latest artifact/trace.

### Preset

- `@local/dsh-verification-preset` installed; `preset-verification` row exists
  in the bundle inventory. It is selectable as an agent preset; the profile-wide
  section and skill also apply to every other preset.

## 3. Important behavior changes

- The gate is now **routed by project root**. A session outside a configured
  project is not gated; `verification_run` still accepts an explicit project id
  or falls back to the only configured project.
- `autoLoad: true` injects a compact prompt section into every new session and
  publishes the full protocol as a skill. This is the auto-load mechanism; the
  preset is an additional explicit choice, not required for auto-load.
- `retries` produces `flaky`, not pass. The gate treats `flaky` like `unknown`
  for steering: it allows and reports; it does not claim success.
- A valid override suppresses steering and is recorded in the artifact; an
  expired/mismatched override is ignored.
- Evidence now includes hashes and a JSONL trace; artifacts can be stored
  outside the workspace.
- A pinned `expectedPlanHash` mismatch refuses to run, so an edited plan is
  visible as `unknown`.

## 4. Files changed

- `index.js` — router-aware tool/gate; auto-load; override; plan-hash refusal.
- `lib/kernel.js` — retries/flaky, plan hash, redaction, planHash.
- `lib/dsh.js` — project config/router, expectedPlanHash, override path,
  per-project runner/artifact handling.
- `lib/artifacts.js` — hashes, trace, redacted evidence, external dir.
- `lib/override.js` — override record lifecycle.
- `lib/report.js` — trace metrics.
- `lib/contract.js` — acceptance contract validation.
- `lib/redact.js` — secret redaction.
- `lib/auto-load.js` — embedded skill + prompt section.
- `bin/override.js`, `bin/report.js`, `bin/contract.js` — CLIs.
- `ci/` and `.github/workflows/verify.yml` — CI.
- `presets/verification/` — dedicated preset.
- `test/*.test.js` — router, flaky, override, hash, trace, report, contract.
- `cordis.patch.yml` — routed dry-run configuration + autoLoad.
- Docs: `README.md`, `phase1-board.md`, this report.

## 5. Known gaps and deferred work

| Item | Status | Why |
|---|---|---|
| Full policy isolation / managed policy | Partial | Same process/user; `denyTools` is a tool-call guard, but the agent can still edit files/config. Real enforcement needs a separate user/process or CI. |
| Human override UI / badge | Not done | CLI + file + artifact audit only. |
| Cost/escape-rate metrics | Partial | No token/cost data in the check trace; golden has false accept/reject. |
| Remote CI / branch protection / signing | Template | No remote repository configured here. |
| Docker/test-patch / hidden tests | Blocked | `docker`/`podman` absent; WSL distro unverified. |
| Trajectory critic (heuristics) | Deferred | Needs agent-level trace beyond verification checks; Phase 2. |
| Repo review/QA verifier | Deferred | On-demand Phase 2 layer. |
| Security scanners | Deferred | Semgrep/CodeQL/Trivy/Gitleaks not installed. |
| Claim/recompute check types | Deferred | Protocol documented; code is Phase 2. |
| OPA/Cedar, formal methods, Best-of-N, trained critic | Not now | Roadmap explicitly defers; no data/runtime justification. |
| Preset selection test in a live session | Not run | Preset row installed; UI selection is a manual step. |

## 6. Trust boundary

- The gate and agent share the Host process and OS user. The agent can edit the
  bundle/config under `danger-full-access`; this is **cooperative** enforcement.
- Hashes are tamper-evident, not tamper-proof. Store the expected hash outside
  the agent's write scope for audit.
- Overrides are cooperative workspace files; they record intent, not proof of
  user approval.
- CI is the stronger boundary because the agent does not run the CI job.

## 7. How to use

```bash
# Full local checks
node bin/verify.js --plan ci/plan.json --cwd .

# Metrics
node bin/report.js --dir .dsh/verification

# Override a known failure for 60 minutes, then revoke
node bin/override.js --reason "known flake" --minutes 60
node bin/override.js --revoke

# Validate an acceptance contract
node bin/contract.js --file docs/templates/contract.json
```

In a session:

```text
verification_run                         # cwd project, or the only project
verification_run({ project: "..." })     # explicit project
```

## 8. Next steps

1. P1.1 hardening: move trusted policy/expected hashes outside agent write
   scope; run the verifier in a separate user/process or CI (the tool-deny guard
   is already implemented but is not a process boundary).
2. P1.5: add token/cost data and false-accept/escape dashboards.
3. P1.7: run the workflow in a real remote CI; protect the branch.
4. Phase 2 only after Docker/WSL is available: test-patch, diff/security,
   trajectory heuristics, repo review.
