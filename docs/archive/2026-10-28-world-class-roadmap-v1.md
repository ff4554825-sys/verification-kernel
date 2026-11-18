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
| Real-task result | Without gold: **3 failures** in target tests; with gold: **97 passed, 4 expected fail, 7 environment exceptions**; the 3 target failures are gone |
| Real benchmark data | `swe-bench-tasks` archive downloaded; 500 Verified task specs available locally |

### Real task caveat

The gold run was under Miniconda Python 3.9.25, not the task's exact
`environment.yml` (Python 3.9.20). The 7 exceptions are identical before and
after gold and are unrelated environment/test-suite issues; the three
`FAIL_TO_PASS` tests are fixed. A world-class comparison requires the exact
task environment and full `PASS_TO_PASS` parsing.

## 2. Where we are vs the leaders

| Dimension | Current | Leader | Next step |
|---|---|---|---|
| Real benchmark scale | 1 real SWE-bench task + 20 synthetic | 500 Verified / 1,632 Multi-SWE | Run 10–20 SWE-bench Lite/Verified tasks with exact envs |
| Environment reproducibility | WSL2 + Docker local, one task | per-task image + pinned env | Use task `environment.yml`/images; record image digest |
| Mutation/check quality | 8 curated mutations, 100% | Stryker/mutmut with hundreds of mutants | Integrate StrykerJS via npm mirror |
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

1. Install StrykerJS from the npm mirror.
2. Run Stryker on `lib/kernel.js`/`lib/dsh.js` with the command runner.
3. Add mutation score to CI; fail below a measured threshold.
4. Add changed-line coverage/property tests where applicable.

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
