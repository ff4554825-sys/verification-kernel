# P2/P3 Implementation Report

| Field | Value |
|---|---|
| Document | `verification-kernel/docs/p2-p3-implementation.md` |
| Version | v1.0 |
| Date | 2026-10-28 (Asia/Shanghai) |
| Status | P2 and feasible P3 implemented; container/training/formal items remain blocked/deferred |
| Scope | Diff/scope, security scanners, trajectory critic, review packet, trace export, OPA, test-patch fallback |
| Archive | `docs/archive/2026-10-28-p2-p3-implementation-v1.md` |
| Related | `phase1-implementation.md`, `phase1-board.md`, `README.md` |

## 1. Dependencies installed

| Dependency | Version | Location / note |
|---|---|---|
| Semgrep | 1.182.1 | bundled Python user site `Scripts\semgrep.exe` |
| Gitleaks | 8.30.1 | `verification-kernel/tools/bin/gitleaks.exe` |
| Trivy | 0.76.1 | `verification-kernel/tools/bin/trivy.exe` |
| OPA | 1.21.4 | `verification-kernel/tools/bin/opa.exe` |
| Python | 3.12.14 | DSH bundled runtime |
| Node | DSH bundled `node.exe` | not on the Host subprocess PATH |
| Git | PortableGit 2.55 | `D:\workbuddy\resources\vendor\PortableGit\cmd\git.exe` |
| Docker / Podman | **not installed** | non-admin machine; `wsl --install -d Ubuntu --no-launch` exited 1; WSL has no distro |

## 2. P2 delivery

| Item | Status | Evidence |
|---|---|---|
| P2.1 test-patch / hidden tests | **functional fallback** | `dsh-test-patch` applies a patch in a detached git worktree, runs a command with scrubbed HOME/TMP, cleans up; original tree unchanged. Container isolation is still blocked. |
| P2.2 diff / scope / API budget | **done** | `lib/diff.js` + `bin/diff-audit.js`; allow/deny/ignore patterns, file and line budgets; tests cover prefix/glob and a real git repo. |
| P2.3 security scans | **done** | `lib/security.js` + `bin/security-audit.js`; Gitleaks, Semgrep (local rules), Trivy secret scan; project audit found 0 high/medium/low findings with all three scanners `ok`. |
| P2.4 trajectory critic | **done (heuristic)** | `lib/trajectory.js` + `lib/session-log.js` + `bin/critic.js`; counts repeats, failures, consecutive failures, repeats after failure; advisory score. Real session scored 100/100 high; this is intentionally advisory, not a gate. |
| P2.5 repo review/QA | **packet + skill** | `bin/review-packet.js` builds diff/rules/prompt; embedded `repo-review` skill instructs a read-only subagent. The reviewer itself is a process, not an automated LLM judge. |
| P2.6 trace export | **done** | `bin/export-trace.js`; eval-friendly JSON with runs + metrics; tested. |

## 3. P3 delivery

| Item | Status | Evidence |
|---|---|---|
| OPA policy-as-code | **done (CLI)** | `policies/verification.rego` + `bin/policy-check.js`; pass→allow, fail→deny, fail+override→allow, flaky/unknown→deny; tested with OPA 1.21.4. |
| Advisory verifier | **partial** | `repo-review` skill + review packet + read-only subagent process. No model-graded judge is wired into the gate. |
| Heuristic critic | **done** | P2.4; scored a real session and returned reasons. |
| Best-of-N | **not done** | The verifier does not generate candidate solutions; there is no candidate generator or outcome data to select from. |
| Trained critic | **not done** | No production outcome dataset (PR merge/code survival); a benchmark-only critic would not transfer. |
| Formal methods | **not done** | No Lean/Kani/Dafny installation or high-assurance invariant target; installing them without a use case would add noise. |
| Cedar | **not installed** | OPA covers the current policy use case; Cedar would duplicate it. |
| Container isolation | **blocked** | Non-admin; no Docker/Podman; WSL installation failed. Worktree fallback is functional, not security-grade. |

## 4. Verification performed

```text
node --test test/kernel.test.js test/dsh.test.js test/override.test.js \
  test/report.test.js test/contract.test.js test/diff.test.js \
  test/security.test.js test/trace-export.test.js test/trajectory.test.js \
  test/review.test.js test/policy.test.js test/test-patch.test.js \
  test/auto-load.test.js
→ 47/47 pass

node bin/security-audit.js --cwd .
→ gitleaks ok · semgrep ok · trivy ok · 0 findings

node bin/policy-check.js --input .dsh/verification/latest.json
→ ALLOW (pass)

node bin/critic.js --session <real session>
→ 100/100 high (advisory), reasons: repeats, failures, consecutive failures

verification_run
→ Project verification-kernel: PASS
→ unit 47/47, golden full 0 false accepts / 0 false rejects
```

## 5. How to use

```bash
node bin/diff-audit.js --cwd . --allow src/ --max-files 20 --max-lines 500
node bin/security-audit.js --cwd .
node bin/export-trace.js --dir .dsh/verification --out .dsh/verification/export.json
node bin/critic.js --session <session.v4.jsonl.zstd> --json
node bin/review-packet.js --cwd . --base HEAD --prompt --out .dsh/verification/review.md
node bin/policy-check.js --input .dsh/verification/latest.json
node bin/test-patch.js --patch fix.patch --cmd node --arg --test
```

The `repo-review` skill is in the profile-wide skill catalog. It tells the agent
to build a review packet and delegate to a read-only subagent; it does not make
the subagent independent by itself.

## 6. Remaining gaps

| Gap | Why it remains |
|---|---|
| Container/test-patch isolation | No Docker/Podman; WSL install failed on this non-admin machine |
| Automated independent LLM reviewer | Requires a model route and an agent-spawn contract; packet + skill is the current safe step |
| Best-of-N / trained critic | No candidate generator or outcome dataset |
| Formal verification | No high-assurance invariant target; tools not justified |
| Gate-integrated security/policy | Scans/policy are CLI/CI checks; running them every turn would be too slow and noisy |
| Whole-repo security scan | Current audit excludes `test/`, `docs/`, `golden/` to avoid deliberate fixtures |

## 7. Trust boundary

- Worktree test-patch isolates filesystem changes from the original tree, but it
  shares the OS user and network. It is not a container or a security boundary.
- Security scanners and OPA are local binaries; their output is evidence, not a
  proof of non-tampering.
- The review packet is read-only input for a reviewer; the reviewer's
  independence depends on actually using a separate agent/process.
- Policies and tools are in the workspace; a dangerous agent could modify them.
  Use a separate process/user or CI for adversarial guarantees.
