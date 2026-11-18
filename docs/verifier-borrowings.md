# External Verifier Borrowings

This document copies **patterns**, not code, from six external systems. It is the
companion to [verification-stack-architecture.md](verification-stack-architecture.md),
which covers the OpenHands / Hermes lineage. Here the question is narrower:
*what do mature verification systems do that this kernel does not, and which of
those things are worth taking.*

Baseline at the time of writing:

- `node --test test/all.test.js` → 113 tests, 107 pass, 6 skip, 0 fail (162 at
  the bottom of this page, after B1–B6 landed).
- `node golden/run.js` → full strategy 0/40 false accepts, 0/20 false rejects;
  visible-only 20/40 false accepts.
- `node bin/mutation.js` → 8/8 curated mutations killed.

## 1. Sources and what each one is actually good at

| Source | What it solved | Our gap it maps to |
|---|---|---|
| [SWE-bench](https://github.com/SWE-bench/SWE-bench) harness | Grading as a separate, repeatable step over saved logs (`swebench report <run_id>`) | Evidence cannot be re-judged without re-running |
| [Inspect AI](https://inspect.aisi.org.uk/scorers.html) (UK AISI) | `Score(value, explanation, reason)`; deferred scoring (`inspect score`) | One undifferentiated `unknown`; no reason codes |
| [SQLancer](https://github.com/sqlancer/sqlancer) | Oracles that need no reference implementation (TLP, NoREC, PQS) | Every check needs a hand-written expected answer |
| [sigstore / SLSA](https://slsa.dev/provenance) | Keyless signing + transparency log; identity is the OIDC issuer, not a local key | Ed25519 key lives on the same machine as the verdict |
| [Hypothesis](https://hypothesis.readthedocs.io/) / [fast-check](https://fast-check.dev/) | Properties over generated inputs; finds counterexamples, not just examples | Example-based unit tests only |
| SWE-bench **Verified** | 500 tasks a human confirmed are solvable | 20 generated tasks, none human-reviewed |

## 2. Borrowing matrix

| ID | Pattern | Lands in | Effort | Status |
|---|---|---|---|---|
| **B1** | Verdict reason codes + an unknown policy | `lib/kernel.js`, `lib/outcomes.js` | S | **Done** — 8 tests |
| **B2** | Rescore without re-execution | `bin/rescore.js`, `lib/artifacts.js` | M | **Done** — 9 tests |
| **B3** | Keyless attestation in CI | `lib/attest.js`, `.github/workflows/verify.yml` | S | **Done** — 8 tests, CI path unverified until a run |
| **B4** | Relational oracles (no reference answer) | `lib/oracle.js`, `bin/oracle.js` | L | **Done** — 12 tests, 3 of 3 relations |
| **B5** | Property-based kernel invariants | `test/properties.test.js` | M | **Done** — 6 properties, no new dependency |
| **B6** | Human-confirmed golden subset | `golden/reviewed.json`, `golden/run.js` | S | **Done** — 6 tests; 0/20 reviewed, deliberately |

Order of work: **B1 → B2 → B6 → B3 → B4 → B5**. B1 is a prerequisite for B2
(rescoring is only meaningful if the reason survives the round trip), B6 is
cheap and makes the benchmark defensible, B4 is the only one that changes what
the system can verify rather than how it reports.

---

## B1 — Verdict reason codes and an unknown policy

### What the reference does

Inspect's scorers return a structured `Score` whose `reason` is an enumerated
code, not prose: `invalid_response_format`, `no_response`. The distinction
matters because "the output was malformed" and "the model produced nothing" call
for different follow-up actions.

### Our gap

`lib/kernel.js` collapses every non-failure into `unknown`: timeout, spawn error,
aborted turn, invalid `cwd`, and a plan with no required checks. `evidenceFromResult`
records `error.name` but nothing downstream reads it.

Worse, `gateAction` returns `allow` for every `unknown` without reading the
reason at all. A turn whose checks never executed closes the gate silently. The
verdict says `unknown`, but the agent receives no signal, so nothing changes and
the next turn repeats it. This is weaker than it looks: the honest verdict is
recorded, and then ignored.

### Change

```js
// lib/kernel.js
export const UNKNOWN_REASON = Object.freeze({
  TIMEOUT: 'timeout',
  SPAWN: 'spawn',
  ABORTED: 'aborted',
  INVALID_CWD: 'invalid-cwd',
  NO_REQUIRED_CHECKS: 'no-required-checks',
  ENV_MISSING: 'env-missing',   // ENOENT on argv[0], missing WSL distro, no docker
  POLICY: 'policy',             // plan hash mismatch, refused to run
});

/** How the gate treats an unverifiable turn. */
const UNKNOWN_POLICY = Object.freeze({
  [UNKNOWN_REASON.ENV_MISSING]: 'allow',   // blocking cannot fix a missing tool
  [UNKNOWN_REASON.ABORTED]: 'allow',
  [UNKNOWN_REASON.TIMEOUT]: 'steer',       // a retry can fix a slow or hung check
  [UNKNOWN_REASON.SPAWN]: 'steer',
  [UNKNOWN_REASON.INVALID_CWD]: 'steer',
  [UNKNOWN_REASON.NO_REQUIRED_CHECKS]: 'allow',
  [UNKNOWN_REASON.POLICY]: 'allow',
});
```

Each check evidence gains `reason` plus `reasonDetail`; `summarize()` adds
`counts.requiredUnknownByReason`; `outcomeFromVerdict` copies the map into the
outcome record so it can be aggregated later.

### Acceptance

- A check killed by `timeoutMs` yields `unknown` + `reason: 'timeout'` and
  `gateAction` steers once before allowing.
- A check whose `argv[0]` does not exist yields `reason: 'env-missing'` and
  allows immediately.
- `dsh-outcomes --report` prints the unknown-reason histogram.
- Existing 113 tests still pass; `unknown` without a reason is a test failure.

### Risk

Callers that compare `verdict.reason` as free text will see new values. The
field is already a string, so this is additive, but the two golden benchmark
robustness probes assert on it and must be updated together.

---

## B2 — Rescore without re-execution

### What the reference does

`swebench report <run_id>` re-grades saved evaluation logs with no container
start. Inspect does the same with `inspect score`, including editing scores by
hand. Both treat the run log as the evidence and grading as a pure function of
it.

### Our gap

`lib/report.js` only summarises traces; `bin/report.js` cannot turn stored
evidence into a verdict. Every re-judgement costs a full re-run, so a parser
fix, a policy change, or a new reason code (B1) cannot be applied retroactively.

### Change

```js
// lib/artifacts.js — artifacts already store per-check evidence; pin the shape.
{ schema: 2, planHash, checks: [...], verdictVersion }
```

```bash
dsh-verify-rescore --run <artifact-dir> --json            # re-derives status from stored checks
dsh-verify-rescore --run <artifact-dir> --expect pass     # assert the reassessed status
dsh-verify-rescore --run <artifact-dir> --write           # emit latest.rescored.json beside it
```

`rescore` calls `summarize()` on the stored checks with the current code and
writes `latest.rescored.json` next to the original. It never spawns a process;
assert that by injecting a `runCommand` that throws.

Rules: an artifact whose `schema` is older than the running kernel is rescored
with a `stale-schema` note in the output rather than silently reinterpreted.

### Acceptance

- Flip `required` on one check in a fixture plan, rescore, get a different
  status from identical evidence.
- Rescore never calls `runCommand` (test asserts a throwing stub is untouched).
- `rescore` output carries `originalStatus` and `originalVerdictHash`.

### Risk

Rescoring can disagree with a signed verdict. Never overwrite the signed file;
write a sibling and record both hashes.

---

## B3 — Keyless attestation in CI

### What the reference does

SLSA / in-toto provenance is signed with a short-lived certificate bound to a
workflow identity (OIDC), and the signature is published to a transparency log.
Verification answers "which workflow, on which repo, at what time" — not "which
key on this laptop".

### Our gap

`lib/sign.js` is sound cryptography and useless as evidence: the private key sits
next to the thing it signs, so anyone who can write the verdict can also sign it.
The scorecard already lists this as a gap ("Local signing key … not remote
attestation").

### Change

Keep local Ed25519 for offline work. Add a CI path:

```yaml
permissions:
  id-token: write      # Fulcio certificate
  contents: read
steps:
  - run: node bin/verify.js --plan ci/plan.json --json > latest.json
  - run: cosign sign-blob --yes --bundle verdict.sigstore.json latest.json
```

Verification from any machine:

```bash
cosign verify-blob latest.json \
  --bundle verdict.sigstore.json \
  --certificate-identity-regexp '^https://github.com/ff4554825-sys/verification-kernel/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

### Acceptance

- `cosign verify-blob` succeeds on a machine that never held the private key.
- The workflow fails closed if `id-token: write` is absent.
- Local Ed25519 verdicts still verify offline; the two schemes are labelled
  distinctly in the artifact.

### Risk

Adds a CI dependency on sigstore infrastructure. Treat the local signature as
the offline path and the bundle as the published one; never let a missing bundle
downgrade an enforced gate.

---

## B4 — Relational oracles

### What the reference does

SQLancer finds logic bugs in databases without a reference result set. TLP splits
a query into three predicates whose union must equal the original; NoREC compares
optimised against unoptimised execution; PQS synthesises a row that must appear
in the answer. All three judge *relations between runs*, never a golden answer.

The general form is metamorphic testing: assert how output must change when the
input changes, instead of asserting the output itself.

### Our gap

Every check in a plan carries an implicit expected answer (usually "exit 0").
Nothing expresses "these two runs must agree", so the kernel cannot detect the
most common agent failure: a check that passes for the wrong reason, or a plan
whose verdict depends on something it should not depend on.

### Change

`lib/oracle.js`, three relations to start:

| Relation | Assertion | Catches |
|---|---|---|
| `determinism` | same plan + same input, two runs, identical per-check status | flaky checks, hidden clock/rand dependence |
| `invariance` | verdict unchanged when irrelevant context changes (temp dir name, `TZ`, `PATH` order, file mtimes) | accidental coupling to environment |
| `decomposition` | a composite check's status equals the conjunction of its declared sub-checks | checks that pass because a sibling masked the failure |

```bash
dsh-oracle determinism --plan plan.json --runs 3 --json
dsh-oracle invariance  --plan plan.json --vary TZ,tmpdir --json
```

Output is a verdict-shaped object so the existing gate and artifacts apply
unchanged.

### Acceptance

- A deliberately flaky check is caught by `determinism` with no reference answer.
- A check that reads `Date.now()` is caught by `invariance` when `TZ` varies.
- A check that swallows a sibling's failure is caught by `decomposition`.

### Risk

Every oracle multiplies runtime. `determinism --runs 3` triples cost; keep it
advisory-by-default and enforced only on the fast path's slow branch.

---

## B5 — Property-based kernel invariants

### What the reference does

Hypothesis and fast-check generate inputs and shrink failures to a minimal
counterexample. Properties replace a fraction of example-based tests and, unlike
mutation testing, they generate the inputs rather than only grading the tests.

### Our gap

`lib/kernel.js` invariants are encoded as examples. `bin/mutation.js` proves the
suite kills curated mutations, which is a strong signal, but it only tests the
mutations we thought of — the 27 surviving Stryker mutants are exactly the ones
nobody thought about.

### Change

`fast-check` is the obvious tool, but this repo keeps the test suite
dependency-free, so the landed version ships a 40-line seeded xorshift generator
(`test/support/gen.js`) instead: same properties, no lockfile churn, and a
failing case prints its seed rather than shrinking to a minimal input. Swap in
`fast-check` later if shrinking is worth a devDependency. The properties over
generated plans are:

- `allRequiredPass(plan) ⇒ status === 'pass'` — for any plan, any check ids.
- `anyRequiredFail(plan) ⇒ status === 'fail'`.
- `status ∈ {'pass','fail','unknown','flaky'}` for arbitrary malformed plans.
- `planHash(normalize(plan))` is stable across key order and absent optionals.
- `required` defaults to `true` for any check object without the field.
- `resolveInside(base, p)` never returns a path outside `base`, for arbitrary
  `p` including `..`, symlink-ish strings, and absolute paths.

### Acceptance

- Six properties, each of which fails when the corresponding mutation from
  `DEFAULT_MUTATIONS` is applied.
- Property suite runtime under 20 s so it can join the default `npm test`.

### Risk

Property tests that mirror the implementation add coverage without adding
information. Each property above is written as an assertion about *observable
behaviour*, not about internal structure.

---

## B6 — Human-confirmed golden subset

### What the reference does

SWE-bench Verified is not a harder subset; it is 500 tasks that human engineers
confirmed are solvable. It exists because a benchmark nobody reviewed measures
the benchmark's bugs as much as the model's ability.

### Our gap

`golden/manifest.json` lists 20 generated tasks. Nothing records whether a human
looked at them, so "0/40 false accepts" is a statement about our own generator.

### Change

`golden/reviewed.json` is a separate file rather than a field on each task, so
regenerating the golden set cannot silently erase a review:

```json
{
  "schema": 1,
  "tasks": {
    "slugify-v1": { "by": "<reviewer>", "at": "2026-11-17", "note": "spec is unambiguous; the held-out test adds the edge cases the visible test misses" }
  }
}
```

`golden/run.js` prints reviewed and unreviewed results separately, and CI gates
on the reviewed subset only.

### Acceptance

- Report line splits `reviewed` / `unreviewed` counts.
- `--only-reviewed` exits non-zero when zero tasks are reviewed.
- Adding a `reviewed` block requires a note; an empty note is a validation error.

### Risk

Reviewing 20 tasks is a few hours of human time that cannot be delegated to a
model — a model confirming its own benchmark is the thing this borrow avoids.

---

## 3. Deliberately not borrowed

**Model-as-gate.** Inspect ships `model_graded_qa`, and it is right for
evaluation. It is wrong for a gate: a model scorer is optimised against by the
same model being scored, which is the failure this kernel exists to prevent. The
existing `lib/advisor.js` already has the correct shape — advisory, recorded,
never authoritative.

**SWE-bench's cache semantics.** Their README warns that results are cached by
`run_id` and `instance_id`, so re-running the same instance with a different
prediction reuses the old result. That is a documented footgun, not a pattern.
Any caching here must key on `planHash + working-tree hash + check argv`, and
must be invalidated by a schema bump.

**Leaderboard-scale infrastructure.** 120 GB disk, 16 GB RAM, 8 workers. Nothing
in this repo should grow toward that shape; the value here is a small,
auditable kernel, not a distributed fleet.

## 4. Sequence and rationale

| Step | Item | Why here |
|---|---|---|
| 1 | B1 reason codes | Unblocks everything else; smallest diff with the largest diagnostic gain |
| 2 | B2 rescore | Only useful once reasons are stable; makes B1 retroactive |
| 3 | B6 reviewed subset | Cheap, and it hardens the claim the whole system rests on |
| 4 | B3 keyless | Isolated to CI; removes the last "trust me" in the evidence chain |
| 5 | B4 relational oracles | The only item that expands what can be verified |
| 6 | B5 properties | Best value after B4; can land incrementally |

## 5. References

- SWE-bench harness and `report` re-grading — <https://github.com/SWE-bench/SWE-bench>
- Inspect AI scorers, `Score.reason`, deferred scoring — <https://inspect.aisi.org.uk/scorers.html>
- SQLancer oracles (TLP / NoREC / PQS / DQP) — <https://github.com/sqlancer/sqlancer>
- SLSA provenance and attestation distribution — <https://slsa.dev/provenance>
- Metamorphic testing for LLMs (oracle problem) — <https://arxiv.org/html/2603.23611v1>
- fast-check — <https://fast-check.dev/>

## 6. What landed

| Item | Where | Evidence |
|---|---|---|
| B1 | `UNKNOWN_REASON`, `classifyUnknown`, `UNKNOWN_REASON_GATE`, `gateUnknownReason` in `lib/kernel.js` | `test/reason-codes.test.js`; a timed-out check now steers once instead of closing the gate silently |
| B2 | `resummarize()` + `bin/rescore.js` (`dsh-verify-rescore`) | `test/rescore.test.js`; proves rescoring does not create a file a stored check would have created |
| B3 | `lib/attest.js` + `bin/attest.js` (`dsh-attest`) + workflow steps | `test/attest.test.js`; exit 3 for "cosign absent" is not success |
| B4 | `checkDeterminism`, `checkInvariance`, `checkDecomposition` in `lib/oracle.js`, `bin/oracle.js` | `test/oracle.test.js`; a check reading `TZ` is caught with no reference answer |
| B5 | `test/properties.test.js`, `test/support/gen.js` | seeded generator, no new dependency; six properties over generated plans |
| B6 | `golden/reviewed.json`, `--only-reviewed` | fails closed at 0 reviewed tasks rather than reporting a green benchmark |

Verification after the change: 162 tests (156 pass, 6 skip, 0 fail), mutation
audit 8/8 killed, golden 0/40 false accepts under `full` and 20/40 under
`visible-only` — unchanged, which is the point: these additions did not move the
numbers they were supposed to explain.
