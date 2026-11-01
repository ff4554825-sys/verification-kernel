# Changelog

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
