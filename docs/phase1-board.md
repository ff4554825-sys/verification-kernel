# Phase 1 Task Board — Trust Foundation

Status: **Phase 1 implemented to the feasible local scope; policy and CI remain
cooperative/template-level.**
Source: `docs/verification-roadmap.md` §4 and §8
WIP limit: 1 write lane + 1 read-only lane; one profile change at a time.

## Board

| ID | Task | Depends | Risk | Lane | Status | Acceptance evidence |
|---|---|---|---|---|---|---|
| P1.1 | Policy/trust boundary: pinned plan hash, `denyTools`, hashes, prompt/skill behavior, documented threat model | — | R2 | W | **partial** | `expectedPlanHash` refuses a changed plan; `denyTools` guard denies matching tool calls; artifacts carry hashes; same-process boundary documented. Process isolation/managed policy not implemented. |
| P1.2 | Human override + audit | P1.1, P1.6 | R2 | W | **done (CLI)** | `bin/override.js` writes/revokes; the gate suppresses steering for an unexpired, matching override and records it; no deadlock. UI badge not implemented. |
| P1.3 | Flaky policy: retries, quarantine, environment vs code classification | — | R1 | W | **done** | fail→pass is `flaky`; required flaky does not pass and does not steer; attempts/statuses are in evidence and trace. |
| P1.4 | Evidence integrity: hash/sign, external store, redaction | P1.1 | R2 | W | **done** | latest/history/trace + `hashes.verdict`; absolute `artifactDir` stores outside workspace; secret-like output redacted. Signing is not implemented. |
| P1.5 | Metrics/trace: verdicts, flaky, overrides, latency; JSONL trace | P1.3 | R1 | W | **done (local)** | `bin/report.js`; golden false-accept/reject remains in `golden/run.js`. Cost/escape-rate dashboards are not implemented. |
| P1.6 | Acceptance criteria / task contract | — | R1 | W/R | **done (CLI)** | `bin/contract.js` + `docs/templates/contract.json`; validates criteria/claims and prints a checklist. Not yet consumed by the gate. |
| P1.7 | CI runner: `dsh-verify` in CI, branch protection, signed artifacts | P1.5 | R1 | W | **partial** | Local `ci/plan.json` passes; `ci/verify.sh`, `ci/verify.ps1`, GitHub Actions workflow are templates. No remote branch protection or signing. |

## Router and auto-load

| ID | Task | Status | Evidence |
|---|---|---|---|
| R1 | Project router: per-project root/checks/mode, longest-root match, single-project tool fallback | **done** | `verification_run` resolved `Project verification-kernel: PASS`; unit router tests pass |
| R2 | Embedded `verification-protocol` skill | **done** | New subagent log contains the skill catalog entry; skill body loads on demand |
| R3 | Profile-wide accuracy-first prompt section | **done** | New subagent system message contains `## Verification discipline`; current session too |
| R4 | Dedicated `verification` agent preset | **installed** | `@local/dsh-verification-preset` bundle with `preset-verification` row; selectable in the agent preset UI |

## Ready queue

No Phase 1 task is currently `ready`. The remaining work is deliberately
blocked or deferred:

1. **P1.1 hardening** — move trusted policy outside the agent write scope /
   implement `denyTools`; needs a separate-process or permission decision.
2. **P1.5 hardening** — cost/escape-rate metrics and a dashboard; needs
   token/cost data not present in the current trace.
3. **P1.7 hardening** — run the workflow in a real remote CI and enable branch
   protection; needs a repository/remote.
4. **Phase 2** — Docker/test-patch is blocked: no Docker/Podman and no verified
   WSL distribution.

## Dependency order

```
P1.1 ──┬── P1.2 (also needs P1.6)
       ├── P1.4
       └── P1.7 (also needs P1.5)
P1.3 ────── P1.5 ── P1.7
P1.6 ────── P1.2
R1/R2/R3/R4: independent, done
```

## Scheduling rules for this board

- P1.1 is R2: compute the final config first, make one profile change, then
  verify; no repeated install/remove churn.
- R3 actions (restart, live page reload, system install) are never performed
  during an active turn.
- Isolate gate tests in a separate profile/session or a subagent in a temp
  workspace; do not use the live conversation as the test fixture.
- A task is `done` only when its acceptance evidence is recorded in the board.
- Stop at the feasible Phase 1 exit criteria; do not pull Phase 2 forward while
  Docker/WSL is unavailable.

## Phase 1 exit checklist

- [~] P1.1 pinned plan hash + `denyTools` + hashes + threat model documented;
      process isolation/managed policy not done
- [x] P1.2 override + audit works; no deadlock
- [x] P1.3 flaky vs real failure distinguishable
- [x] P1.4 verdict hashed; external store supported; secrets redacted
- [~] P1.5 trace/report exists; golden false-accept/reject exists; cost/escape
      dashboard not done
- [x] P1.6 sample task contract validated end-to-end
- [~] P1.7 CI plan + workflow template pass locally; no remote CI/branch
      protection/signing

## Implementation evidence

- Unit tests: 33/33 pass (`test/kernel.test.js`, `test/dsh.test.js`,
  `test/override.test.js`, `test/report.test.js`, `test/contract.test.js`).
- Golden: full policy 0 false accepts / 0 false rejects; robustness 4/4.
- Local CI plan: PASS (unit + golden, ~17s), trace/report produced.
- Live tool: `verification_run` returned `Project verification-kernel: PASS`.
- Live flaky CLI: fail→pass produced `status: flaky`, attempts `[fail, pass]`,
  exit 2.
- Live override CLI: write/read/revoke worked.
- `denyTools` guard: a matching project denies `plugin_manager` and allows
  unlisted tools; unit test covers registration and disposal.
- New subagent: system prompt contains the verification section; skill catalog
  contains `verification-protocol`.
- Preset bundle: `@local/dsh-verification-preset` installed with
  `preset-verification` row.
