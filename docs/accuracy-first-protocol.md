# Accuracy-First Verification Protocol

| Field | Value |
|---|---|
| Document | `verification-kernel/docs/accuracy-first-protocol.md` |
| Version | v1.0 |
| Date | 2026-10-28 (Asia/Shanghai) |
| Status | Adopted as the working standard |
| Applies to | Agent answers, verifier design, acceptance contracts, research |
| Related | `verification-roadmap.md`, `phase1-board.md`, `README.md` |
| Archive | `docs/archive/2026-10-28-accuracy-first-protocol-v1.md` |

## 0. Purpose

Accuracy is the first guarantee. A fast wrong answer is worse than a slow
`unknown`. This protocol defines what "accurate" means, what counts as evidence,
when to search, how to verify independently, and when to stop.

It is deliberately stricter than "the model says it is correct":

- a claim is not true because it sounds plausible;
- a web page is not true because it appears first;
- a test is not sufficient if it does not exercise the claim;
- a verifier is not trustworthy because it passes its own run.

## 1. Define "accurate"

For every task, state which dimensions matter:

| Dimension | Question |
|---|---|
| Correctness | Does the result satisfy the stated acceptance criteria? |
| Completeness | Are all required parts present, including edge cases and error paths? |
| Scope | Did we change only what was required, without unrelated churn? |
| Freshness | Are APIs, versions, and facts current for the target date? |
| Reproducibility | Can another person rerun the evidence and get the same answer? |
| Honesty | Are `unknown`, limitations, and conflicts reported explicitly? |

If the acceptance criteria are missing or ambiguous, **stop and clarify**; do not
invent them. "Accurate" without criteria is only a feeling.

## 2. Evidence hierarchy

Use the strongest available evidence; never upgrade weak evidence to strong.

| Level | Evidence | May support `pass`? |
|---|---|---|
| E0 | Local executable evidence: tests, builds, measurements, reproductions, deterministic checks | Yes |
| E1 | Primary source: official docs, standard, paper, repo at a pinned commit, release notes | Yes, combined with E0 or a second independent E1/E2 |
| E2 | Multiple independent secondary sources agreeing, with dates/versions | Yes only for non-code factual claims, with explicit citations |
| E3 | Single secondary source, blog, forum, search snippet | No; advisory only |
| E4 | Model memory, intuition, "looks right" | No; hypothesis only |

Rules:

- **E0 outranks the web.** A Stack Overflow answer does not override a failing
  local test.
- **Web evidence is advisory by default.** A page can be stale, wrong, dynamic,
  or prompt-injected. It can make a claim `unknown`, not `pass`, unless it is a
  primary source and the claim is factual and independently corroborated.
- **Two independent sources** means different publishers/authors; two pages that
  copy the same source are one source.
- Record the source URL, title, publisher, version/date, access time, and the
  exact quoted passage. If possible, store a content hash.

## 3. When to search

Search **before** verification when the uncertainty is external:

- API behavior, version compatibility, deprecations, configuration semantics;
- known bugs, security advisories, release notes;
- algorithm/method selection, prior art, benchmark methodology;
- factual claims that cannot be settled locally;
- unfamiliar domain terminology.

Do **not** search to replace local evidence:

- code behavior that can be tested locally;
- measurements you can run yourself;
- private data or credentials;
- decisions where the local repository's conventions are authoritative.

Search for **methods, known failure modes, and primary sources**, not for an
answer to copy. If an answer is found, treat it as a hypothesis and verify it
against the local context and an independent source.

## 4. Research procedure

1. Write the claim or question in one sentence.
2. Choose 2–4 targeted queries; prefer official docs, papers, release notes,
   and pinned repositories.
3. Open primary sources; record URL, version/date, quote, access time.
4. Build a claim list (see §5); map each claim to evidence.
5. If sources conflict, run a discriminating local experiment or find a third
   independent source.
6. If still unresolved, mark `unknown`; do not average or guess.

Research log template:

| Field | Value |
|---|---|
| Claim ID | `C1` |
| Query | exact query |
| Source | URL / title / publisher |
| Version/date | version or publication date |
| Quote | exact supporting text |
| Access time | timestamp |
| Strength | E1/E2/E3 |
| Conflict | none / source URL / unresolved |

## 5. Claim decomposition

Break the answer into checkable claims; verify each independently.

| Field | Meaning |
|---|---|
| `id` | stable claim id |
| `statement` | one falsifiable sentence |
| `type` | fact / code / math / decision |
| `required` | must pass for the task to pass |
| `evidence` | E0 command/test, E1 source, E2 second source, recompute |
| `status` | pass / fail / unknown / overridden |
| `notes` | limitations, version, conflict |

A claim with only E3/E4 evidence is `unknown`, never `pass`.

### Code claims

- Reproduce first; then fix; then rerun the same reproduction.
- Run the narrowest relevant tests, then the broader suite; report both.
- Check edge cases, error paths, empty states, and the original failure.
- A test that does not exercise the claim is not evidence for it.
- Do not weaken, delete, or skip a test to make a gate pass.

### Math claims

- Recompute independently; use a different method than the one that produced the
  draft.
- Use property-based/numeric/symbolic cross-checks where possible.
- Check units, domain, boundary values, and assumptions.
- If two methods disagree, find the discrepancy; do not pick the convenient one.

### Factual claims

- Prefer E1 primary sources; corroborate with an independent E2 source.
- Record dates/versions; facts decay.
- Quote exactly; do not paraphrase a quote and present it as exact.
- If the source is unreachable, say so; do not invent a citation.

### Decision claims

- State the criteria and tradeoffs; separate facts from preferences.
- If the decision is ambiguous or value-laden, mark it for human review rather
  than presenting it as verified.

## 6. Research → verify → recompute loop

```
restate task + acceptance criteria
        ↓
classify claims (code / math / fact / decision)
        ↓
research only where external knowledge is needed
        ↓
independent verification (E0 first)
        ↓
conflict or failure?
   ├─ yes → diagnose → recompute/fix → retry (bounded)
   └─ no  → pass
        ↓
output with evidence, citations, limitations
```

Rules:

- Retry with a **different method** or new evidence, not the same prompt.
- Bound attempts; do not loop forever. After the budget, output `unknown` or
  `fail` with the evidence.
- Never change the acceptance criteria to make a failing result pass.
- Never convert `unknown` to `pass` for a quieter gate.

## 7. Output contract

For an answer that claims verification, include:

- **Verdict:** `pass` / `fail` / `unknown`.
- **Evidence:** commands run, tests passed, sources with URLs and versions.
- **Scope:** what was verified and what was not.
- **Limitations:** flaky checks, missing environment, inaccessible sources.
- **Conflicts:** unresolved disagreements and why.

Do not say "verified" when only "implemented" or "looks correct" is true. Do not
cite a source that was not opened. Do not present a `unknown` as a success.

## 8. Budget and stop conditions

- Accuracy target first; then set latency/cost budget.
- Tier research: quick lookup for low-risk facts; multi-source/primary research
  for high-stakes claims.
- Stop when every required claim has sufficient evidence, or when a conflict is
  explicit and documented as `unknown`.
- Do not over-search after the claim is settled; extra search can anchor and
  waste budget.
- Do not skip search for a high-stakes external claim just because the answer
  seems obvious.

## 9. Anti-patterns

| Anti-pattern | Problem |
|---|---|
| Search for the answer and copy it | Anchoring; the answer may not fit the local version/context |
| One source, one snippet | No independence; stale/wrong content |
| Web page as `pass` for code | Web cannot run the code; tests outrank it |
| Pure self-reflection / re-prompt | No new evidence; may reinforce the error |
| Weakening tests to pass | Fake compliance; destroys the verifier |
| Moving acceptance criteria | Goalpost drift |
| "Looks correct" | Not evidence |
| Fabricated citation | Trust violation |
| Infinite retry | Cost without progress |
| `unknown` → `pass` | Silently unsafe |

## 10. Integration with the verification kernel

Current state (v1.0):

- `command` checks are E0 and may gate.
- The web is not part of the gate.
- Artifacts are evidence, not a security boundary.

Next steps (see roadmap):

1. **Phase 1.6:** acceptance contract per task, with claims and required
   evidence. This protocol is the template.
2. **Phase 2:** add `claim` and `recompute` check types:
   - `claim`: one statement, evidence list, status;
   - `recompute`: independent calculation/comparison, mismatch → fail;
   - `source`: URL + exact quote + date/hash, **advisory** by default;
   - source-only claims → `unknown`, not `pass`.
3. **Phase 2/3:** source snapshots/hashes, research log, trace export,
   false-accept metrics for web evidence.
4. **Gate rule:** only E0 checks may contribute to `pass`; web/claim evidence may
   produce `warn`/`unknown` or require human override.

## 11. References

- [Chain-of-Verification Reduces Hallucination](https://aclanthology.org/2024.findings-acl.212/)
- [SelfCheckGPT](https://aclanthology.org/2023.emnlp-main.557/)
- [CRITIC: Tool-Interactive Critiquing](https://proceedings.iclr.cc/paper_files/paper/2024/file/fef126561bbf9d4467dbb8d27334b8fe-Paper-Conference.pdf)
- [OpenHands — The Verification Stack](https://www.openhands.dev/blog/20260506-the-verification-stack)
- [Claude Code — Hooks reference](https://code.claude.com/docs/en/hooks)
- [SWE-bench](https://github.com/SWE-bench/SWE-bench)
- [Inspect AI](https://github.com/UKGovernmentBEIS/inspect_ai)
