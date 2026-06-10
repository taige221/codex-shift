# codex-model-router

Route Codex CLI requests through a small pre-flight classifier that chooses the model and reasoning effort before each request starts.

Chinese documentation: [README.zh.md](./README.zh.md)

## What It Does

Codex model and effort are request parameters. They must be chosen before a turn starts. This project adds a wrapper/proxy in front of Codex so each prompt can be classified first:

```text
prompt -> router -> model/effort -> Codex transport
```

Supported transports:

- `exec`: builds and runs `codex exec -m ... -c model_reasoning_effort=...`
- `app-server`: rewrites app-server `turn/start` requests with per-turn `model`, `effort`, and `summary`
- `tui`: runs native Codex TUI through a local app-server proxy so continuous chat can route each turn

It cannot change an already-running model response or force an already-open Codex Desktop conversation to switch effort.

## Install

```bash
npm install
npm link
```

This exposes:

- `codex-shift`
- `codex-router`
- `codex-shift-hud`
- `codex-shift-shim`

## Common Commands

Preview a routing decision:

```bash
codex-router route "explain this function"
codex-router dry-run "fix this failing test"
codex-router dry-run --json "review this pull request"
```

Run a one-shot routed Codex exec:

```bash
codex-shift exec "fix this failing test"
codex-shift exec --effort high "review this pull request"
```

Run continuous TUI routing:

```bash
codex-shift tui
codex-shift tui --hud
codex-shift tui --hud-verbose
```

Pass native Codex TUI arguments after `--`:

```bash
codex-shift tui -- --no-alt-screen
codex-shift tui -- --no-alt-screen -C /path/to/project
```

Show the latest routed turn:

```bash
codex-shift hud
codex-shift hud --once
codex-shift hud --verbose
```

Start a routed app-server turn:

```bash
codex-shift turn --thread <thread-id> "fix this failing test"
codex-shift dry-run --transport app-server --thread <thread-id> "fix this failing test"
```

## TUI And HUD

`codex-shift tui` starts:

```text
native Codex TUI --remote ws://127.0.0.1:<proxyPort>
  -> codex-shift proxy
  -> real codex app-server --listen ws://127.0.0.1:<realPort>
```

The proxy rewrites `turn/start` requests and injects the selected `model`, `effort`, and `summary`. It also fills missing or null `thread/list.cwd` values in TUI mode so resume lists stay scoped to the launch directory. `resume --all` disables that cwd filter.

HUD commands:

```bash
codex-shift tui --hud
codex-shift tui --hud --hud-launcher tmux
codex-shift tui --hud --hud-launcher terminal
codex-shift-hud --file /tmp/codex-shift-current.json
```

By default, the status file is `/tmp/codex-shift-current.json`. It stores routing metadata and token counters, not prompt text.

## CLI Shim

For a more seamless CLI workflow, point the shim at the real Codex binary:

```bash
export CODEX_SHIFT_REAL_CODEX=/Applications/Codex.app/Contents/Resources/codex
alias codex='codex-shift-shim'
```

With that alias:

```bash
codex
codex resume
codex exec "fix this failing test"
codex "review this pull request"
```

The shim routes empty `codex` and `codex resume` into `codex-shift tui`. It routes `codex exec <prompt>` and top-level prompt invocations through the router. Native Codex subcommands such as `app-server`, `mcp`, `login`, `doctor`, and `exec resume` are forwarded unchanged.

Bypass the shim for one command:

```bash
CODEX_SHIFT_BYPASS=1 codex
```

For a PATH shim instead of a shell alias:

```bash
mkdir -p ~/.local/bin
ln -sf /path/to/codex-shift/src/cli/shim.js ~/.local/bin/codex
export CODEX_SHIFT_REAL_CODEX=/Applications/Codex.app/Contents/Resources/codex
export PATH="$HOME/.local/bin:$PATH"
```

## Effort Overrides

Supported efforts:

- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`

Shell commands can use prompt directives:

```bash
codex-shift exec "/high fix this failing test"
codex-shift turn --thread <thread-id> "/xhigh diagnose a production incident"
```

Inside native Codex TUI, `/` is reserved for Codex slash commands. Use `#` aliases instead:

```text
#low explain this function
#medium fix this failing test
#high review this pull request
#xhigh diagnose a production incident
```

## Configuration

Create `.codex-model-router.json` in the project root or `~/.codex-model-router.json`:

```json
{
  "defaultModel": "gpt-5.5",
  "defaultEffort": "medium",
  "efforts": {
    "simple": "low",
    "coding": "medium",
    "complex": "high",
    "critical": "xhigh"
  },
  "budget": {
    "enabled": true,
    "weeklySoftLimitPercent": 85,
    "whenOverLimit": "downgrade_noncritical"
  },
  "modelCapabilities": {
    "gpt-lite": {
      "efforts": ["minimal", "low", "medium", "high"]
    }
  }
}
```

## Privacy

Route decisions and HUD status files do not include full prompt text by default. `route` and `dry-run` previews also omit prompt text unless `--include-prompt` is passed.

## Development

```bash
npm test
node --test test/router.test.js
node --test test/tui.test.js
```

Router evaluation fixtures live in `test/fixtures/router-eval.json`.
