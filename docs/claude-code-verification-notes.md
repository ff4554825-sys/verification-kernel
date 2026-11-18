# Claude Code verification notes

Reverse engineering of the **published client-side artifact**, not of the model
or of any server-side evaluation. Everything below is quoted from files on disk
or cited by symbol; nothing here is an inference about how Claude is trained.

Artifact: `@anthropic-ai/claude-agent-sdk` (the agent runtime Claude Code ships
inside), present in this profile as a dependency of
`@deepseek-ai/dsh-subagent-claude-code`.

Method: read the published type declarations, then grep the bundled runtime for
the prose the runtime emits. Type names are stable; **line numbers are for the
version installed here** and drift between releases.

```
$ ls ~/.dsh/profiles/web/node_modules/@anthropic-ai/claude-agent-sdk/
sdk.d.ts   sdk.mjs   bridge.mjs   browser-sdk.js   manifest.json  ...
```

## 1. The gate is five hooks, not one

`sdk.d.ts` declares a 35-member `HookEvent` union (`sdk.d.ts:873`). Four of them
form the gate chain; the rest are lifecycle or UI.

| Event | What it may return | Semantics | Cite |
|---|---|---|---|
| `PreToolUse` | `permissionDecision: allow/deny/ask/defer`, `permissionDecisionReason`, `updatedInput`, `additionalContext` | gate **before** the call executes; may rewrite the arguments | `sdk.d.ts:2565` |
| `PostToolUse`, `PostToolUseFailure`, `PostToolBatch` | `decision: approve/block`, `continueOnBlock` | judge **after** execution; a block feeds the reason to the model and the turn continues | runtime string, see §2 |
| `Stop` | `additionalContext` only — **no veto** | non-error feedback delivered to the model; the conversation continues so the model can act | `sdk.d.ts:8443` |
| `SubagentStop` | `additionalContext`; input carries `stop_hook_active` | same at the subagent boundary, plus a re-entry flag | `sdk.d.ts:8459` |

Two structural facts fall out of this:

1. **`Stop` cannot deny a stop.** Its typed output has exactly one field,
   `additionalContext`, and the doc comment says the conversation continues so
   the model can act on it. Stopping is prevented by giving the model more work,
   not by refusing to end.
2. **The real gate is `PreToolUse`.** That is the only event whose decision is
   consulted before the side effect happens.

## 2. The allowlist bypasses the gate, and the runtime says so

The bundle carries the warning verbatim:

> `canUseTool will not be invoked: permissionMode 'bypassPermissions'
> auto-approves every tool call (except explicit deny rules) before the callback
> is consulted. To gate every tool call, use a PreToolUse hook instead.`

> `Bare allowedTools entries auto-approve the whole tool before the callback is
> consulted.`

And, for `continueOnBlock`:

> `Sets the continue value for the decision:"block" produced when ok is false.
> Default false (turn ends). Whether continue:true lets the turn proceed depends
> on the event's decision:"block" semantics. On PostToolUse, the reason is fed
> back to Claude and the turn continues.`

A permission callback is therefore not a gate: it runs **after** the allowlist,
so every allow rule is a hole. The designers put that sentence into the product
rather than into a doc.

## 3. Four permission values, one of them "ask"

```
export declare type HookPermissionDecision = 'allow' | 'deny' | 'ask' | 'defer';
```

`sdk.d.ts:879`

`ask` is not "unknown". It means *escalate to a human and wait*. `defer` is
closer to "not my decision". This kernel has one bucket (`unknown`) for both
"I cannot determine" and "a person should decide", which are different
outcomes with different follow-up.

## 4. Re-entry is visible to the hook

`Stop` and `SubagentStop` inputs carry `stop_hook_active: boolean`
(`sdk.d.ts:8421`, `sdk.d.ts:8459`), plus `last_assistant_message`,
`background_tasks`, and `session_crons` so a hook can tell "the session is done"
from "the session is waiting for background work".

This kernel's equivalent is `maxAttempts` inside `gateAction`: the **caller**
counts and the check never learns that it is being re-run. Moving the counter
into the evidence lets a check behave differently on the second attempt — which
is what `stop_hook_active` exists to allow.

## 5. Where this kernel sits

| | Claude Code | verification-kernel |
|---|---|---|
| When it judges | before each tool call, after each tool call, and at Stop | once, at turn end |
| Can it prevent an action | yes (`PreToolUse` deny) | **no** — the turn already happened |
| Vocabulary | allow / deny / ask / defer | pass / fail / unknown / flaky |
| Re-entry visible to the check | yes (`stop_hook_active`) | no (`maxAttempts` in the caller) |
| Allowlist interaction | documented hole, gated by hooks | `fastPath.allowPaths`, `denyTools`, optional checks |
| Evidence | hook stdout, transcript file | verdict + hashes + artifacts |

The difference that matters is row two. A turn-end gate cannot stop `rm -rf`;
it can only report afterwards that the turn was not good enough.

## 6. What to take, in order

| ID | Change | Lands in | Effort |
|---|---|---|---|
| **C1** | A pre-execution verdict for destructive tools, same three-valued semantics as the turn gate | `lib/pretool.js` + `index.js` tool guard | **Done, rules only** |
| **C2** | Split `unknown` into `unknown` and `ask` (needs a human) | `lib/kernel.js` | **Done** |
| **C3** | Put the attempt count in the evidence so a check can see it is a retry | `lib/exec.js`, `runPlan()` | **Done** |
| **C4** | Audit every allowlist: `denyTools`, `fastPath.allowPaths`, optional checks — each is a documented "this does not get checked" and must appear in the verdict | `lib/overrides.js` → `lib/kernel.js` | **Done** |

**C4 first.** It is the cheapest and it is the same failure the Claude Code
runtime warns about: a rule that skips checks is indistinguishable from a check
that passes, unless the verdict says which one happened.

### C4 landed

`runPlan()` now returns a `coverage` block on every verdict:

```json
{ "planned": 3, "ran": 1,
  "skipped": [{ "id": "unit", "required": true, "reason": "fast-path: documentation-only change" }],
  "optionalFailed": ["lint"], "partial": true }
```

`partial` is true when a **required** check was skipped, which is the case a
turn-end gate must never hide. `renderVerdict()` prints
`Coverage: 1/3 checks ran; 2 skipped (fast-path…): unit, golden`, `formatFeedback()`
changes its opening line to "passed for the checks that ran", `resummarize()`
keeps the recorded coverage instead of recomputing a full one, and the outcome
record carries `{planned, ran, skipped, partial}` for later aggregation.

The fast path passes `selectionReason` from `lib/complexity.js`, so the reason a
check was skipped is in the evidence rather than in the caller's head.

### C1–C3 landed, with one limit found in the host

- **C1** `lib/pretool.js`: rules matched against the invocation text, optionally
  scoped to tool names, enforced through `agentCtx.tools.guard()`. The host
  guard is **synchronous** (`dsh-tools/lib/index.js:771` calls `guard(exec)` and
  uses the value immediately), so this is a policy matcher, not a plan runner.
  A pre-execution *plan* would need an async hook DSH does not currently expose.
- **C2** `ASK_EXIT_CODE = 78`: a check can answer `ask`. Precedence is
  fail > ask > flaky > unknown > pass, and the gate allows the turn with reason
  `ask`. 3 was tried first and rejected: the golden benchmark's `nonzero` probe
  exits 3 and means plain failure, so the benchmark failed within minutes of
  the change. Overloading a common exit code breaks somebody else's check.
- **C3** `VERIFICATION_ATTEMPT` / `VERIFICATION_CHECK_ID` / `VERIFICATION_PLAN_ID`
  are set for every check process, so a check can tell a first attempt from a
  retry — the `stop_hook_active` idea, at the process boundary.

## 7. Deliberately not copied

- **35 hook events.** Most exist for UI and lifecycle. Adding events without a
  consumer is the complexity creep this repo already suffers from.
- **`updatedInput` rewriting.** A gate that edits the input is no longer a
  judge; keep rewriting and judging in separate components.
- **`defer`.** It presumes a queue and an owner. Without both it is `ask` that
  never gets answered.

## 8. Re-verifying this

```bash
SDK=~/.dsh/profiles/web/node_modules/@anthropic-ai/claude-agent-sdk
grep -n 'export declare type HookEvent' "$SDK/sdk.d.ts"
grep -n 'HookPermissionDecision =' "$SDK/sdk.d.ts"
grep -n -A6 'export declare type StopHookSpecificOutput' "$SDK/sdk.d.ts"
node -e 'const s=require("node:fs").readFileSync(process.argv[1],"utf8");
  const i=s.indexOf("canUseTool will not be invoked");console.log(s.slice(i-260,i+340))' "$SDK/sdk.mjs"
```

If those four commands stop producing the quotes above, this document is stale —
which is the same rule the rest of `docs/` follows.
