# Deterministic Verification Workflow

This is the explicit five-phase workflow built on the same kernel as the
turn-stopping gate. It never asks an LLM to decide pass/fail.

```text
resolve → execute → evidence → gate → report
```

## Phases

| Phase | What happens | Evidence |
|---|---|---|
| `resolve` | Read and normalize the plan; compute plan hash; reject invalid plans | normalized check list |
| `execute` | Run the checks on Host **or** in the hardened WSL2 boundary | per-check stdout/stderr/exit/duration |
| `evidence` | Optional Ed25519 signature; write latest/history/trace/evidence; append outcome JSONL | artifacts + hashes + outcome |
| `gate` | `pass/unknown/flaky` allow; `fail` → `steer`/`steer-final` or `record` in dry-run | gateAction decision |
| `report` | Write `.dsh/verification/workflow.json` with phases, verdict, gate, timing | workflow record |

## CLI

```bash
# Host execution, enforce gate, evidence + outcome
node bin/workflow.js --plan ci/plan.json --cwd . --json

# WSL boundary (no network, nobody, read-only project copy)
node bin/workflow.js \
  --plan ../verification-kernel/benchmarks/session-view-plan.json \
  --cwd ../session-view --isolation wsl --json

# Signed workflow for CI or archival
node bin/workflow.js --plan ci/plan.json --cwd . \
  --sign-key .dsh/keys/verification.key --json

# Dry-run: run and record, never steer
node bin/workflow.js --plan ci/plan.json --cwd . --mode dry-run
```

Exit codes:

- `0`: verdict `pass`
- `1`: verdict `fail`
- `2`: verdict `unknown` or workflow/evidence error

`--mode` affects `gate` only; it does not turn a failed verdict into a pass.
`--no-artifacts` skips verdict/workflow files, while `--outcome-store ''`
disables the outcome JSONL.

## WSL boundary

`--isolation wsl`:

1. copies the project and a fresh verifier into a WSL2 temp dir;
2. makes the project copy read-only;
3. runs under `unshare -n` (no network) and `setpriv` as `nobody`;
4. returns verdict to the Host, which writes the evidence.

## Relation to the turn gate

The runtime gate runs the same `runPlan` / `gateAction` / evidence machinery at
`agent/turn-stopping`. This CLI is the explicit, reproducible workflow for local
runs, CI, or manual verification. It does not replace the gate; it exposes the
same deterministic path with phase-level reporting.

## Workflow record

Example shape:

```json
{
  "version": 1,
  "workflow": "verification",
  "project": "demo",
  "phases": [
    { "name": "resolve", "status": "pass" },
    { "name": "execute", "status": "pass" },
    { "name": "evidence", "status": "pass" },
    { "name": "gate", "status": "pass" },
    { "name": "report", "status": "pass" }
  ],
  "verdict": { "status": "pass", "reason": "all required checks passed" },
  "gate": { "action": "allow", "attempt": 0, "reason": "passed" },
  "artifactPath": ".dsh/verification/latest.json",
  "signed": false
}
```

## Boundaries

- This is a deterministic workflow, not a multi-agent debate.
- Host execution is cooperative; WSL is the stronger boundary.
- Signing is tamper evidence, not remote attestation.
- The workflow does not decide whether a task is "good"; it decides whether
  the configured checks passed, failed, were unknown, or were flaky.
