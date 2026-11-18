# World-Class Verification Scorecard

| Field | Value |
|---|---|
| Date | 2026-10-28 (Asia/Shanghai) |
| Scope | verification-kernel, real SWE-bench sympy subset, WSL boundary, outcome loop |
| Status | Strong local verifier; **not** claimed as world-class overall |
| Raw artifacts | `.dsh/verification/`, `.dsh/mutation/`, `benchmarks/` |

## 1. Hard evidence

| Dimension | Result | Evidence |
|---|---|---|
| Unit/contract tests | **113 tests: 112 pass, 1 optional Docker skip** | `node --test test/all.test.js` |
| Golden false accept | **0/40** | `golden/run.js` full strategy |
| Golden false reject | **0/20** | `golden/run.js` full strategy |
| Stryker raw mutation score | **96.94%** (853 killed + 1 timeout / 881; 27 survived) | `.dsh/mutation/stryker.json` |
| Mutation threshold | `--min 96` PASS | `dsh-mutation-gate` |
| Survivor classification | 27 survivors: 10 Windows platform, 7 redundant validation, 7 empty/fallback | `docs/mutation-equivalents.md` |
| Full pinned env | `/opt/testbed-full` built from exact `environment.yml` (defaults-only) | `benchmarks/sympy-full-env.json` |
| Real task subset | 10 sympy tasks: **2 clean / 6 target-fixed-with-noise / 2 not reproducible** | `benchmarks/sympy-full-env.json` |
| Pre-gold escape | **2/10 = 20%** | same |
| Independent WSL boundary | no network namespace, `nobody`, read-only copy; write test `EACCES`; DNS fails | `test/verify-wsl.test.js` |
| WSL gate/tool | session-view and browser-automation PASS; Host runner not called | `test/dsh.test.js`, tool runs |
| Signed verdicts | Ed25519 sign/verify; CI-equivalent signed artifact valid | `lib/sign.js`, `ci/verify.ps1` |
| Latency | 22 recorded runs: p50 **20.4s**, p95 **23.8s**, max **23.9s** | `dsh-outcomes --report` |
| Explicit workflow | resolve → execute → evidence → gate → report; 5-phase CLI and workflow.json | `dsh-verification-workflow` |
| Outcome calibration | Per-check reliability/latency recommendations; advisory only | `dsh-calibrate` |
| Complexity fast path | git/snapshot classifier; docs-only/small scope runs a subset | `lib/complexity.js` |
| Local knowledge base | SQLite FTS5, Latin+CJK bigrams, `knowledge_search` tool | `lib/knowledge.js` |
| Automatic feedback | retrieval → next pass/fail outcome → bounded doc weights; weak/correlational | `lib/feedback-loop.js` |
| L1 advisory critic | external critic command receives verdict JSON; heuristic fallback; never overrides L0 | `lib/advisor.js` |
| L2 PR review/QA | repo review packet + custom guides + isolated worktree QA | `dsh-pr-check` |
| A/B evaluation | Paired outcomes, wins/losses/ties, bootstrap CI | `dsh-ab` |
| Cost proxy | check-time + overhead + retries; not tokens/money | `lib/outcomes.js` |
| Security | Gitleaks/Semgrep/Trivy 0 findings | `dsh-security-audit` |
| Policy | OPA ALLOW | `dsh-policy-check` |
| Docker test-patch | network-disabled container passes | `test-patch-docker.test.js` |

## 2. What is genuinely strong

- Deterministic pass/fail/unknown/flaky semantics and a completion gate.
- Golden set proves the gate catches weak visible checks (20/40 false accepts
  for visible-only vs 0/40 for full).
- Mutation score is high with an explicit survivor-equivalence report; no
  suppression annotations inflate it.
- WSL boundary is materially harder to escape than a Host subprocess:
  no network, unprivileged user, read-only project copy, per-run verifier copy.
- Verdicts can be signed and verified in CI; outcome JSONL records latency,
  isolation, retries, and a deterministic cost proxy.
- Real task runs use the full pinned environment, not just a Python patch.

## 3. What prevents a world-class claim

| Gap | Why it matters | Next step |
|---|---|---|
| Only 10 real tasks | 500 Verified / 1,632 Multi-SWE is the leaderboard scale | Run Lite/Verified subsets with official images |
| Old sympy suite exceptions | 6 tasks still have 5–15 exceptions after gold; cannot certify all PASS_TO_PASS | Use official SWE-bench harness/image; parse full PASS_TO_PASS |
| 27 equivalent mutants | Raw 96.94%; no formal proof/suppression | Prove or reviewed-annotate each equivalence; POSIX run |
| Local signing key | Tamper evidence, not remote attestation | KMS/HSM/CI OIDC key outside local admin scope |
| Production outcome labels | No PR merge/code-survival data | Ingest PR outcomes; calibrate critic on labeled data |
| No remote CI run | Local CI-equivalent only | Run GitHub Actions with secrets; publish signed evidence |
| No A/B model baseline | Cannot claim model IQ improvement | Run paired sessions with/without gate |

## 4. False accept / reject interpretation

- Golden set: full strategy has **0 false accepts and 0 false rejects** on the
  curated 60-task fixture.
- This is a verifier-mechanics result, not a model-quality result.
- Real 10-task subset: **20% pre-gold escape** (2 tasks passed target tests
  before gold). Those are reproducibility failures, not verifier false accepts.
- The patch-task benchmark harness measures false accept/reject and escape rate
  on synthetic manifests; it has not been run at leaderboard scale.

## 5. Bottom line

The system is now a **strong, auditable local verification kernel**: deterministic
semantics, high mutation score, hardened WSL boundary, signed CI artifacts,
full pinned environment, real-task evidence, and an outcome store.

It is **not** a world-class benchmark competitor yet: scale, official harness
alignment, formal mutant equivalence, remote attestation, and production
outcome labels remain.

No claim of model-intelligence improvement is made; no A/B measurement exists.
