# Changelog

## Unreleased

- Override records can be signed (Ed25519) and the gate refuses unsigned ones
  when `overridePublicKey` (config or `VERIFICATION_OVERRIDE_PUBLIC_KEY`) is set.
- `spawn` unknowns no longer steer: a runner that cannot start is environmental,
  like `env-missing`, and retrying does not fix it.
- `dsh-verify <subcommand>` facade over report/rescore/oracle/attest/override/
  contract/mutation; the standalone binaries keep working.
- `test/docs.test.js` fails the build when the docs name a command or a
  repository path that does not exist. It immediately found
  `bin/verification-workflow.js`, a file that never existed.
- Verdicts carry a `coverage` block: planned vs ran checks, which were skipped
  and why, which optional checks failed, and whether the run was partial. A
  fast-path turn now says so in its own verdict.
- Failure feedback keeps test names and assertion messages instead of ten lines
  of stack (`failureHighlights`).
- `preTool` rules deny a tool call before it dispatches (synchronous guard; text
  matching, optionally scoped by tool name).
- Exit code 78 makes a check answer `ask` — a human decision, not a failure.
- Checks receive `VERIFICATION_ATTEMPT` so they can tell a retry from a first
  attempt.
- Optional checks report three separate buckets: `optionalFailed`,
  `optionalAsk`, `optionalUnknown`. A check waiting for a human is no longer
  filed as a failure.
- Verdict reason codes: seven enumerated `unknown` reasons, a per-reason gate
  policy, `unknownReasons` in verdicts and outcomes, verdict schema 2.
- `dsh-verify-rescore`: re-judge stored evidence without re-running a check.
- `dsh-attest`: keyless sigstore attestation; exit 3 means "cosign absent",
  which is not an attestation. CI signs and verifies the verdict bundle.
- `dsh-oracle`: determinism, invariance, and decomposition relations for cases
  where no expected answer exists.
- Property tests over generated plans (seeded, no new dependency).
- `golden/reviewed.json`: human-reviewed tasks are reported separately and
  `--only-reviewed` fails closed while the list is empty.

## 0.1.1 — 2026-11-06

- Add `dsh-verify-stack`: fixture checks for Node/npm, Chrome, Context7,
  Chrome DevTools MCP, dsh-market, dsh-verify, dsh-stall-guard, modlens and
  promptfoo.
- Wire `extensions` into the profile verification plan.
- Treat transient Context7 network failures as `unknown`, not installation
  failure.
- Document the extension health check.

## 0.1.0 — 2026-11-01

Initial public-source candidate.

- Deterministic verification kernel: pass/fail/unknown/flaky, retries, plan hash.
- DSH turn-stopping gate with `verification_run` and `knowledge_search`.
- Evidence artifacts with SHA-256 hashes, trace/history, secret redaction.
- WSL2 independent boundary, Docker test-patch, worktree test-patch.
- Ed25519 verdict signing, OPA policy check, security scanner adapters.
- Five-phase deterministic workflow.
- Outcome store, calibration, mutation audit/gate, golden benchmark.
- Local FTS5 knowledge base with Latin + CJK bigram search.
- Complexity fast path (git diff + snapshot fallback).
- Automatic weak feedback from retrieval to verification outcome.
- L1 advisory critic adapter (external command or heuristic).
- L2 local PR review + isolated QA, plus GitHub Actions PR check.
- Paired A/B outcome comparison with deterministic bootstrap CI.
- 113 tests: 112 pass, 1 optional Docker skip.
