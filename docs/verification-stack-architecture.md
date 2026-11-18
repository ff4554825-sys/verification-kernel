# Verification Stack Architecture (adapted)

This document copies the **architecture**, not the code, from:

- [OpenHands Verification Stack](https://www.openhands.dev/blog/20260506-the-verification-stack)
- [OpenHands critic](https://docs.openhands.dev/openhands/usage/agent-canvas/critic)
- [Hermes Agent](https://github.com/NousResearch/hermes-agent) verify-on-stop / learning loop

## Layers

| Layer | OpenHands idea | Ours | Status |
|---|---|---|---|
| **L0 — Deterministic kernel** | (implicit in verifier) | `runPlan`, `gateAction`, pass/fail/unknown/flaky, evidence, hashes | **Done, strong** |
| **L1 — Agent-level verifier** | Fast critic model scores trajectory before push; low score stops/retries | Turn-stopping gate runs checks before close; fast path; advisory critic adapter + heuristic fallback; advisory recorded in verdict/outcome | **Done advisory; no trained critic model** |
| **L2 — Repo-level verifier** | Code-review skill + QA agent that runs behavior | `dsh-pr-check`: review packet + custom guides + isolated worktree QA; GitHub Actions PR step | **Local pipeline + PR workflow done; no LLM QA agent** |
| **L3 — CI / PR gate** | PR review/QA automation | Workflow CLI, CI plan, signed artifact, outcome store, PR check in `.github/workflows/verify.yml` | **Remote workflow wired; no dashboard/merge policy** |
| **Feedback loop** | Traces train critic; review guide iterates | Outcome JSONL, calibration, fast path, weak retrieval feedback, A/B | **Partial; no trained model, no production labels** |

## Mapping

### L0 — deterministic authority

Unlike an LLM critic, L0 cannot be talked into a pass. The final verdict is
computed by checks and evidence. This remains the authority in all layers.

### L1 — agent-level verifier

Implemented:

- `agent/turn-stopping` gate;
- stop/steer/final-feedback ladder;
- fast path for docs/small changes;
- `lib/trajectory.js` heuristic critic (advisory, CLI);
- `verification-protocol` skill.

Now available:

- `lib/advisor.js` supports an external critic command via stdin/stdout JSON
  (`{score, risk, issues, summary}`) and a local heuristic fallback;
- the advisor is recorded in `verdict.advisor` and outcome records;
- it never changes L0's status.

Not copied:

- OpenHands' trained critic model. It needs production traces and model
  serving; we have no such model. The adapter is advisory only.

### L2 — repo-level verifier

Implemented:

- `docs`/`review` packet from diff + repository rules;
- `repo-review` independent read-only skill;
- `.agents/skills/custom-codereview-guide.md`;
- `.agents/skills/custom-qa-guide.md`;
- QA through `test-patch` (worktree / WSL2 / Docker).

Now available:

- `dsh-pr-check` builds the review packet, writes `review.md`, and optionally
  applies the PR diff to a detached worktree and runs a QA command there.

Not implemented:

- a four-phase LLM QA agent loop (understand → plan → execute → verify).
  `.github/workflows/verify.yml` triggers `dsh-pr-check` with an explicit QA
  command, which is deterministic.
- automatic PR comments/merge policy; the artifact is uploaded for review.

### L3 — CI / PR

Implemented:

- `ci/plan.json`, `ci/verify.sh`, `ci/verify.ps1`;
- deterministic workflow CLI;
- optional Ed25519 signing + verification;
- outcome/calibration artifacts.

Missing:

- remote GitHub Actions secrets run;
- PR comments/blocking checks;
- dashboard/parallel scheduling.

## What "copy" means here

We copy:

- **separation of layers** (agent-level vs repo-level vs CI);
- **fail-fast at the earliest layer**;
- **repo-specific review guide** loaded from the repo branch;
- **QA by running the software**, not just reading the diff;
- **feedback/eval loop** with observed outcomes.

We do not copy:

- Python agent runtime or UI;
- a trained critic model/weights;
- enterprise code/license;
- proprietary prompts from commercial agents.

## Next implementation steps

1. Wire `dsh-pr-check` into a real GitHub Actions workflow / PR trigger.
2. Add a deterministic QA runner with explicit evidence artifacts (beyond the
   command's stdout/stderr).
3. Feed production PR/merge outcomes into A/B/calibration before considering a
   trained critic.
4. Optionally connect a local/OpenHands-compatible critic command to
   `advisor.command`; keep it advisory.

## License

OpenHands is MIT outside its `enterprise/` directory; Hermes is MIT. No upstream
code was copied for this architecture. If code is copied later, preserve the
license and add `THIRD_PARTY_NOTICES.md`.
