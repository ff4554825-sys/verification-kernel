# Extension Stack Verification

`bin/verify-stack.js` verifies the **local extension environment**, not just the
repository tests. It is wired into the profile's `verification-kernel` plan as
the required `extensions` check.

## Checks

| Check | Status semantics |
|---|---|
| `node` | Node LTS + npm present; version reported |
| `chrome` | Chrome executable found and version readable |
| `context7` | real `initialize` request to `mcp.context7.com` returns Context7 |
| `chrome-devtools-mcp` | real stdio `initialize` against the installed Chrome MCP server |
| `dshmarket` | installed in the active profile |
| `dsh-verify` | package and starter template present |
| `dsh-stall-guard` | installed in the active profile |
| `modlens` | installed; `unknown` when no vision provider is configured |
| `promptfoo` | wrapper/CLI reports its version |

Exit code is `0` when no check fails. `unknown` (for example modlens without a
vision engine) is reported separately and does not become a fake pass.

## Commands

```bash
node bin/verify-stack.js
# or, after installing the package
dsh-verify-stack
```

Environment overrides:

- `DSH_PROFILE_DIR` — profile directory (default `~/.dsh/profiles/desktop`)
- `DSH_NODE_HOME` — Node LTS directory
- `DSH_GLOBAL_PREFIX` — global npm prefix (default `C:/dsh-node-global`)
- `DSH_CHROME_MCP_ENTRY` — Chrome DevTools MCP entrypoint
- `PROMPTFOO_CMD` — promptfoo wrapper path

## Why this exists

During the extension installation, repository tests were green while Chrome
DevTools MCP was disconnected and promptfoo could not start because of a
missing VC++ runtime. Those are real completion failures that a pure repo test
plan cannot catch.

The extension check makes this visible:

```text
node: pass
chrome: pass
context7: pass
chrome-devtools-mcp: pass
dshmarket: pass
dsh-verify: pass
dsh-stall-guard: pass
modlens: unknown (no vision provider)
promptfoo: pass
```

The `modlens` provider must be configured locally (for example a Gemini API key)
before it can move from `unknown` to `pass`.
