# World-Class Roadmap — Progress Log

| Field | Value |
|---|---|
| Document | `verification-kernel/docs/world-class-roadmap.md` |
| Version | v2.3 |
| Date | 2026-10-28 (Asia/Shanghai) |
| Status | Strong local verifier; scorecard documents remaining world-class gaps |
| Related | `p2-p3-implementation.md`, `README.md`, `archive/MANIFEST.md` |

## 1. What changed in this round

| Work | Evidence |
|---|---|
| Mutation audit | `dsh-mutation`; 8 curated kernel mutations; **8 killed / 0 survived = 100%** |
| Docker Engine in WSL2 | Docker 29.1.3; local `ubuntu-base:local`; daemon `overlayfs` |
| Container test-patch | `dsh-test-patch --docker`; network-disabled container, cap-drop, no-new-privileges; tests pass |
| Benchmark harness | `dsh-benchmark`; manifests, worktree/WSL/Docker isolation; false accept/reject/accuracy; tests pass |
| Real SWE-bench task | `sympy__sympy-11232` from `swe-bench-tasks`; base commit fetched; test.patch applied |
| Real-task result | Without gold: **4 failures**; with gold: **0 failures**, 97 passed, 4 expected fail, 7 environment exceptions |
| Real benchmark subset | 10 real sympy tasks run; **2 fully clean**, 6 target-fixed with environment noise, 2 not reproducible |
| Independent verifier | `isolation: wsl` in the turn gate; per-run verifier copy; **network namespace off, run as `nobody`, read-only project copy**; session-view/browser-automation pass |
| Outcome store | `dsh-outcomes` + automatic `outcomeStore` JSONL; pass rate, p50/p95 latency, retries, cost proxy |
| Signed verdicts | Ed25519 sign/verify; WSL gate artifact verifies; **CI-equivalent `ci/verify.ps1` produced a valid signed artifact**; tamper evidence, not remote attestation |
| Measured latency | 22 recorded runs: pass 21 / fail 1; p50 20.4s, p95 23.8s, max 23.9s | production dashboards | collect labeled production runs |
| Exact full env | `/opt/testbed-full` (python 3.9.20/mpmath 1.3.0); 10 tasks rerun | official SWE-bench image | compare against official harness |
| Real benchmark data | `swe-bench-tasks` archive downloaded; 500 Verified task specs available locally |
| StrykerJS sample | `lib/kernel.js:191-215`: 43.48% → 89.13% → **100% (46/46 killed)** after contract tests |
| StrykerJS full | `lib/kernel.js`: **96.94%** (853 killed, 1 timeout, 27 survived); 4m22s; 881 mutants; 27 equivalents classified |

### Real task subset (10 tasks)

| Task | No gold | With gold | Assessment |
|---|---|---|---|
| `sympy__sympy-11232` | 4 failed, 7 exceptions | 0 failed, 7 exceptions | target fixed; environment noise |
| `sympy__sympy-11384` | 0 failed, 1 XPASS | 0 failed, 0 exceptions | **not reproducible**; test passes before gold |
| `sympy__sympy-11400` | 2 failed, 0 exceptions | 0 failed, 0 exceptions, exit 0 | **clean real-task pass** |
| `sympy__sympy-11438` | 1 failed, 0 exceptions | 0 failed, 15 exceptions | target fixed; environment noise |
| `sympy__sympy-11618` | 1 failed, 1 exception | 0 failed, 1 exception | target fixed; environment noise |
| `sympy__sympy-11787` | 1 failed, 0 exceptions | 0 failed, exit 0 | **clean real-task pass** |
| `sympy__sympy-11788` | 1 failed, 7 exceptions | 0 failed, 7 exceptions | target fixed; environment noise |
| `sympy__sympy-11794` | 1 failed, 1 XPASS | 0 failed, 14 exceptions, 1 XPASS | target fixed; noise |
| `sympy__sympy-11818` | 1 failed, 9 exceptions | 0 failed, 10 exceptions | target fixed; environment noise |
| `sympy__sympy-11831` | 0 failed, 8 exceptions | 0 failed, 7 exceptions | **not reproducible** |

Summary: **10 tasks — 2 clean, 6 target-fixed-with-environment-noise,
2 not reproducible; pre-gold escape rate 2/10 = 20%.** The clean tasks prove
the harness can reproduce a real FAIL_TO_PASS→PASS transition. The two escapes
passed the target test before gold, so this environment cannot certify them.
This is exactly why a world-class benchmark needs pinned per-task images/envs,
not a single generic environment.

### Real task caveat

The first runs used Miniconda Python 3.9.25. A second environment with
**Python 3.9.20 + mpmath 1.3.0 + flake8 7.1.1** was built, then the **full
pinned `environment.yml`** was installed by dropping the unreachable
`conda-forge` channel (all packages are in `defaults`). All 10 tasks were rerun
in `/opt/testbed-full`; exceptions still remain (`11788`: 5–6; `11794`: 14).
So the gap is the old sympy test suite/runner, not missing packages. A
world-class comparison still needs `FAIL_TO_PASS`/`PASS_TO_PASS` parsing and
the official harness image.

## 2. Where we are vs the leaders

| Dimension | Current | Leader | Next step |
|---|---|---|---|
| Real benchmark scale | **10 real sympy tasks, full pinned env** (2 clean, 20% pre-gold escape) | 500 Verified / 1,632 Multi-SWE | Add more repos/tasks and official images |
| Environment reproducibility | **full pinned env built** (`/opt/testbed-full`); exceptions persist | per-task image + official harness | Record image digest; use official eval image |
| Mutation/check quality | 8 curated mutations 100%; Stryker sample 100%; **full kernel 96.94%**; 27 survivors classified | Stryker/mutmut with high coverage | Prove/suppress equivalents; POSIX mutation run |
| Independent verifier | **WSL gate wired**, per-run copy, **read-only + network-off + nobody**; Ed25519-signed verdicts; Docker test-patch | separate service/CI/user, remote attestation | Wire to CI; move key outside local admin scope |
| Trajectory critic | heuristic, advisory | production-trained critic, early-stop/Best-of-N | collect traces/outcomes; calibrate |
| Review/QA | packet + read-only subagent skill | reviewer/QA agent that runs software | automated read-only subagent + behavior checks |
| Data loop | **outcome JSONL + latency/cost proxy**; trace/report/benchmark | production PR/merge/code-survival labels | add labeled outcomes and drift report |
| UX/scale | local CLI/docs | PR annotations, dashboards, parallel jobs | CI/PR integration, dashboard, parallel workers |
| Formal/high assurance | none | Lean/Kani/Jepsen for invariants | only for high-assurance targets |

## 3. Immediate roadmap

### Phase A — real benchmark, 10–20 tasks

1. Select a small set of SWE-bench Verified/Lite tasks (prefer small repos/deps).
2. Fetch base commits with `git -c http.version=HTTP/1.1` (fixes HTTP2 framing).
3. Use exact `environment.yml` or a local image; record Python/tool versions.
4. Run `test.patch` (expect fail) and `gold.patch` (expect pass); parse
   `FAIL_TO_PASS` / `PASS_TO_PASS`.
5. Store results in `benchmarks/results.json`; compare against the leaderboard
   baselines without claiming parity.

### Phase B — check quality

1. StrykerJS is installed and the command runner works.
2. The sample range `lib/kernel.js:191-215` reached **46/46 killed** after adding
   verdict reason/summary/title and singular/plural contract tests.
3. The full 881-mutant `lib/kernel.js` run scores **96.94%** (853 killed,
   1 timeout, 27 survived, 0 no-coverage).
4. `dsh-mutation-gate` enforces a threshold from the Stryker JSON:
   `node bin/mutation-gate.js --min 96` passes.
   The 27 survivors are manually classified in
   `docs/mutation-equivalents.md`: 10 Windows-platform branches, 7 redundant
   validation guards, and 7 empty-plan/fallback branches. No `Stryker disable`
   annotations are used, so the raw score stays at 96.94%; proving/suppressing
   these is the next mutation step.

### Phase C — independent verifier boundary

1. **Done:** `isolation: wsl` is supported by the project router, the
   `verification_run` tool, and the `agent/turn-stopping` gate. Each run copies
   the verifier and project into a WSL2 temp dir; the Host runner is not used.
   Session-view/browser-automation gates pass.
2. **Hardened:** network namespace is disabled (`unshare -n`), checks run as
   `nobody` via `setpriv`, and the project copy is read-only; a write test gets
   `EACCES`. A host user can still write the profile key if one is added later.
3. **Ed25519 signing added:** `signingKey` signs the verdict before artifacts;
   `dsh-verify --sign-key` supports CI; `dsh-verdict-verify` checks the artifact.
   A CI-equivalent run produced a **valid** signed artifact. This is tamper
   evidence; the key is still readable by the local user/admin.
4. Remove `plugin_manager`/policy write access from gated agents; the WSL copy
   is per-run, so concurrent gates do not share verifier state.

### Phase D — data loop

1. **Done:** `outcomeStore` appends gate/tool verdicts with status, isolation,
   duration, check-time cost proxy, retries, evidence hash, and optional
   signature; `dsh-outcomes` reports pass rate and p50/p95 latency.
2. Still missing: git commit/tool versions and production PR/merge/code-survival
   labels.
3. Calibrate the heuristic critic only after labeled outcomes exist; then
   consider a trained critic, early-stop, or Best-of-N.

## 4. Non-goals for now

- Training a critic without production outcome data.
- Formal verification for general code.
- Running full security scans on every turn.
- Replacing deterministic checks with an LLM judge.

## 5. Reproduce

```bash
# check quality
node bin/mutation.js --cwd .

# container test-patch
node bin/test-patch.js --docker --patch fix.patch --cmd node --arg --test

# benchmark manifest
node bin/benchmark.js --manifest tasks.json --isolation docker --json

# real task (manual, inside WSL)
# /opt/sympy at 4c8a8590...; test.patch/gold.patch from sympy__sympy-11232
```
