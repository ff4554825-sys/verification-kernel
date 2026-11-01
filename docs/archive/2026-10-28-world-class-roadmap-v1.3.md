# World-Class Roadmap — Progress Log

| Field | Value |
|---|---|
| Document | `verification-kernel/docs/world-class-roadmap.md` |
| Version | v1.0 |
| Date | 2026-10-28 (Asia/Shanghai) |
| Status | In progress; first real SWE-bench task measured, gaps remain |
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
| Real benchmark subset | 4 real sympy tasks run; **1 fully clean**, 2 target-fixed with environment noise, 1 not reproducible |
| Real benchmark data | `swe-bench-tasks` archive downloaded; 500 Verified task specs available locally |
| StrykerJS sample | `lib/kernel.js:191-215`: 43.48% → 89.13% → **100% (46/46 killed)** after contract tests |
| StrykerJS full | `lib/kernel.js`: **90.83%** (801 killed, 1 timeout, 81 survived); 4m51s; was 81.73% before wave 3 tests |

### Real task subset (4 tasks)

| Task | No gold | With gold | Assessment |
|---|---|---|---|
| `sympy__sympy-11232` | 4 failed, 7 exceptions | 0 failed, 7 exceptions | target fixed; environment noise |
| `sympy__sympy-11384` | 0 failed, 1 XPASS | 0 failed, 0 exceptions | **not reproducible**; test passes before gold |
| `sympy__sympy-11400` | 2 failed, 0 exceptions | 0 failed, 0 exceptions, exit 0 | **clean real-task pass** |
| `sympy__sympy-11438` | 1 failed, 0 exceptions | 0 failed, 15 exceptions | target fixed; environment noise |

The clean task proves the harness can reproduce a real FAIL_TO_PASS→PASS
transition. The other results expose the environment reproducibility gap:
Python 3.9.25 vs the task's 3.9.20 and missing exact dependencies. This is
exactly why a world-class benchmark needs pinned per-task images/envs, not a
single generic environment.

### Real task caveat

The gold runs used Miniconda Python 3.9.25, not the task's exact
`environment.yml` (Python 3.9.20). The 7/15 exceptions are identical before and
after gold in their tasks and are unrelated environment/test-suite issues.
A world-class comparison requires the exact task environment and full
`FAIL_TO_PASS`/`PASS_TO_PASS` parsing.

## 2. Where we are vs the leaders

| Dimension | Current | Leader | Next step |
|---|---|---|---|
| Real benchmark scale | 1 real SWE-bench task + 20 synthetic | 500 Verified / 1,632 Multi-SWE | Run 10–20 SWE-bench Lite/Verified tasks with exact envs |
| Environment reproducibility | WSL2 + Docker local, one task | per-task image + pinned env | Use task `environment.yml`/images; record image digest |
| Mutation/check quality | 8 curated mutations 100%; Stryker sample 46/46; **full kernel 90.83%** | Stryker/mutmut with high coverage | CI threshold at 90%; push survivors toward 95% |
| Independent verifier | Docker test-patch, separate container | separate service/CI/user, read-only, signed | Move gate/checks to CI or a separate service |
| Trajectory critic | heuristic, advisory | production-trained critic, early-stop/Best-of-N | collect traces/outcomes; calibrate |
| Review/QA | packet + read-only subagent skill | reviewer/QA agent that runs software | automated read-only subagent + behavior checks |
| Data loop | trace/report/benchmark | production PR/merge/code-survival labels | build a labeled run store and drift report |
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
3. The full 883-mutant `lib/kernel.js` run scores **90.83%** (801 killed,
   1 timeout, 81 survived, 0 no-coverage); it was **81.73%** before the third
   wave of hashing/path/evidence/formatting tests.
4. `dsh-mutation-gate` enforces a threshold from the Stryker JSON:
   `node bin/mutation-gate.js --min 90` passes at 802/883 detected.
   Remaining survivors cluster in `hashValue` string handling, `isInside`
   platform branches, `normalizeCheck` boundary merges, `formatFeedback`
   filtering, and `gateAction` optional chaining.

### Phase C — independent verifier boundary

1. Run the verifier in WSL/Docker or CI, not in the Host agent process.
2. Read-only source mount, writable temp, network disabled.
3. Sign/hash the verdict; store expected hashes outside the agent workspace.
4. Remove `plugin_manager`/policy write access from gated agents.

### Phase D — data loop

1. Store every benchmark and gate run with git commit, tool versions, verdict,
   duration, and evidence hash.
2. Collect outcomes (pass/fail/override/PR merge where available).
3. Calibrate the heuristic critic; only then consider trained critic,
   early-stop, or Best-of-N.

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
