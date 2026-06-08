# codex-model-router

Automatically choose the right model and reasoning effort before launching Codex CLI.

This project is a thin pre-flight router for Codex. It does not replace Codex. It reads a task prompt, classifies the task, chooses a model plus reasoning effort, and then dispatches through a transport such as `codex exec` or app-server `turn/start`.

## Why

Codex model and effort selection happens before a request starts. A skill can recommend a better effort level, but it cannot change a model that is already thinking. A wrapper can make that decision before invoking Codex:

```text
prompt -> router -> model/effort -> transport -> Codex
```

## Quick Start

```bash
npm install
npm link

codex-router route "解释一下这个函数"
codex-router dry-run "fix this failing test"
codex-router exec "review改修这个 PR"
codex-shift turn --thread 019e... "实现一个多文件 API 兼容改造"
codex-shift tui --hud
codex-shift hud --once
```

Example output:

```text
model: gpt-5.5
effort: medium
classification: coding
confidence: 0.72
mode: default
read_only: false
reason: classified as coding
weekly_usage: 40%
command: codex exec -m gpt-5.5 -c 'model_reasoning_effort="medium"' '[prompt omitted]'
```

## Routing Rules

Default MVP rules:

| Task type | Examples | Effort |
| --- | --- | --- |
| Simple | explanation, summary, translation, short Q&A | `low` |
| Coding | implementation, logs, tests, traceback, API, database | `medium` |
| Complex | code review, PR/MR, multi-file changes, integration, CI, compatibility, migration, architecture | `high` |
| Critical | security, auth, payment, production incident, data loss | `xhigh` |

When local Codex weekly usage is above the soft limit, non-critical tasks are downgraded by one effort level. Critical tasks keep `xhigh`.

Supported efforts are `minimal`, `low`, `medium`, `high`, and `xhigh`. The router validates requested and configured efforts before returning a decision. If a model does not support the requested effort, the router falls back to the nearest lower supported effort, for example `xhigh` to `high`.

Prompt effort directives can force a turn without changing config:

```bash
codex-router dry-run "/high fix this failing test"
codex-shift turn --thread 019e... "/xhigh diagnose production data loss"
codex-shift tui
# then type: #high fix this failing test
```

Only a leading `/low`, `/medium`, `/high`, `/xhigh`, `#low`, `#medium`, `#high`, or `#xhigh` token is recognized. The directive must be followed by actual prompt text and is lower priority than `--effort`. `/minimal` and `#minimal` are not prompt directives.

In the native Codex TUI, `/` is reserved for Codex's own slash-command parser. Use the `#...` aliases there, for example `#high fix this failing test`. The TUI proxy keeps the input text unchanged so Codex's local echo and server echo stay in sync; this means the visible message still contains `#high`. The `/...` form is intended for shell paths such as `codex-router`, `codex-shift turn`, and routed `codex exec`, where the directive is stripped before dispatch.

Explicit read-only language such as "不要改代码" or "do not edit" sets `readOnly: true` and selects read-only execution controls. It does not by itself make the prompt `simple`.

## Commands

```bash
codex-router route "prompt"
codex-router dry-run "prompt"
codex-router exec "prompt"
codex-shift turn --thread <thread-id> "prompt"
codex-shift tui
codex-shift tui --hud
codex-shift hud
```

`route` and `dry-run` print the decision and transport payload without executing it. `exec` runs the selected transport (`exec` by default, or app-server when `--transport app-server` is passed). `turn` calls app-server `turn/start` through `codex app-server proxy`.

`dry-run --transport app-server --thread <thread-id> "prompt"` builds the exact `turn/start` JSON-RPC request that would be sent, but it never launches the proxy. The preview omits the prompt text unless `--include-prompt` is passed.

`turn --thread <thread-id> "prompt"` always uses the app-server transport. It starts a new turn on that existing thread, sends the full prompt to `turn/start`, forwards proxy stdout/stderr, and exits with the proxy status. It sends per-turn `model`, `effort`, and `summary` params. It does not change the effort of a response that is already running.

`tui` starts the real Codex app-server, starts a local routing proxy, then launches the real Codex TUI with `--remote <proxy>`. This preserves continuous TUI chat while routing every `turn/start` through `codex-shift`.

`hud` shows the latest routed TUI/app-server turn from the local status file. By default it displays the actual routed model, effort, classification, mode, relative update time, and the latest `input_tokens` / `cached_input_tokens` when app-server reports token usage. Use `codex-shift hud --verbose` for thread id, request id, confidence, total token counters, and status file. It does not display or store the prompt. It renders once on startup and refreshes only when the status file changes, which normally means a new `turn/start` was routed or token usage was updated. `tui --hud` opens that HUD automatically in tmux: a split pane inside an existing tmux session, or a temporary tmux session in the current terminal when launched from a normal shell.

## Remote TUI Proxy

Run the native Codex TUI through the routing proxy:

```bash
codex-shift tui
codex-shift tui --hud
```

Pass native TUI options after `--`:

```bash
codex-shift tui -- --no-alt-screen -C /Users/pengfeihao/code/codex-shift
```

The process graph is:

```text
codex TUI --remote ws://127.0.0.1:<proxyPort>
  -> codex-shift proxy
  -> real codex app-server --listen ws://127.0.0.1:<realPort>
```

For `resume`, the supervisor invokes the native command as `codex resume --remote <proxy> ...` rather than `codex --remote <proxy> resume ...`, because `resume` owns its own remote connection flow. If native Codex options precede the command, for example `--no-alt-screen resume`, they stay before `resume` while `--remote <proxy>` is still injected after `resume`. Resume mode also injects the launch cwd into `thread/list` requests so the picker keeps native cwd filtering; `resume --all` disables that filter.

The proxy rewrites JSON-RPC `turn/start` requests and, when configured by resume mode, fills a missing `thread/list.cwd` filter. For turns, it extracts text input, runs `routePrompt`, injects `model`, `effort`, and `summary`, and adds read-only sandbox policy for explicit no-edit prompts. Other requests, responses, notifications, tool events, approvals, and streaming messages pass through unchanged.

Debug without logging prompt text:

```bash
CODEX_SHIFT_TRACE=1 codex-shift tui
```

Watch the actual routed effort in another terminal:

```bash
codex-shift hud
codex-shift hud --once
codex-shift-hud --file /tmp/codex-shift-current.json
```

`codex-shift tui --hud` auto-selects the HUD launcher. Inside tmux it opens a split pane. Outside tmux it starts a temporary tmux session in the current terminal, then opens the Codex TUI plus HUD split there. To force a launcher:

```bash
codex-shift tui --hud --hud-launcher tmux
codex-shift tui --hud --hud-launcher terminal
codex-shift tui --hud-verbose
```

`--hud-launcher terminal` is explicit opt-in and opens a macOS Terminal.app window for the HUD. It is not the default.

HUD tmux sessions enable `mouse on` and set `history-limit` to `50000` for scrollback. Mouse or trackpad scrolling should work in tmux; keyboard scrollback is available through tmux copy mode with `Ctrl-b [` and exits with `q`.

By default, the proxy writes the latest route status to `/tmp/codex-shift-current.json`. Override or disable this:

```bash
codex-shift tui --status-file /tmp/my-codex-shift.json
codex-shift tui --hud --status-file /tmp/my-codex-shift.json
codex-shift tui --no-status
codex-shift proxy --status-file /tmp/my-codex-shift.json --listen ws://127.0.0.1:17891 --target ws://127.0.0.1:17890
```

Preview limitations: this first proxy version supports local `ws://` endpoints. It does not expose a network listener beyond `127.0.0.1` by default, and it does not log full prompts. The HUD status file also omits prompts and only stores routing metadata.

## Codex CLI Shim

For a more seamless CLI workflow, install the shim and point it at the real Codex binary:

```bash
npm link
export CODEX_SHIFT_REAL_CODEX=/Applications/Codex.app/Contents/Resources/codex
alias codex='codex-shift-shim'
```

With that alias:

```bash
codex
codex resume
codex exec "fix this failing test"
codex "review改修这个 PR"
codex app-server proxy
codex mcp list
```

The shim routes empty `codex` and `codex resume` into `codex-shift tui`, so continuous TUI chat can route each turn, including resumed sessions. It also routes `codex exec <prompt>` and top-level initial prompts through `codex-shift` before invoking the real Codex binary with `-m ... -c model_reasoning_effort=...`. Native Codex subcommands such as `app-server`, `mcp`, `login`, `doctor`, and `exec resume` are forwarded unchanged.

Bypass the shim for one command:

```bash
CODEX_SHIFT_BYPASS=1 codex
```

For a PATH shim instead of a shell alias:

```bash
mkdir -p ~/.local/bin
ln -sf /Users/pengfeihao/code/codex-shift/src/cli/shim.js ~/.local/bin/codex
export CODEX_SHIFT_REAL_CODEX=/Applications/Codex.app/Contents/Resources/codex
export PATH="$HOME/.local/bin:$PATH"
```

Do not point `CODEX_SHIFT_REAL_CODEX` at the shim itself. If it is unset, the shim tries the Codex Desktop bundle path first, then searches `PATH` for another `codex` executable that is not itself.

## Options

```text
--model <name>        Override model
--effort <level>      Override reasoning effort
--cwd <dir>           Working directory passed to codex exec -C
--config <file>       JSON config path
--codex-bin <path>    Codex executable path
--codex-home <dir>    Codex home for local usage reads
--cwd-filter <dir>    Inject cwd into thread/list requests when absent
--status-file <path>  HUD status JSON path for proxy/TUI
--no-status           Do not write a HUD status file for proxy/TUI
--hud                 Open a HUD for codex-shift tui
--hud-verbose         Open the HUD in verbose mode
--hud-launcher <mode> HUD launcher: auto, tmux, terminal
--hud-height <lines>  HUD pane height for tmux launcher
--transport <name>    Select exec or app-server for route/dry-run/exec
--thread <id>         App-server thread id; required for app-server preview/turn
--sock <path>         App-server Unix socket for codex app-server proxy
--summary <mode>      App-server summary mode; defaults to concise
--no-summary          Omit app-server summary from turn/start params
--include-prompt      Include the full prompt in previews; real runs always send it
--no-usage            Do not read local Codex weekly usage
--json                Print decision as JSON
--                    Pass the rest through to codex exec
```

## Config

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

## Boundary

This can automatically switch the model and reasoning effort before a new Codex request starts.

Supported transports:

- `exec`: calls `codex exec -m ... -c model_reasoning_effort=...`
- `app-server`: calls `turn/start` through `codex app-server proxy` and passes per-turn `model`, `effort`, and `summary`

Route decisions do not include the full prompt by default. `route` and `dry-run` previews also omit prompt text unless `--include-prompt` is passed.

It cannot force an already-open Codex Desktop chat, or an already-running model response, to change effort mid-turn. That decision must happen before the model request starts.

## Eval Fixtures

Router changes are covered by `test/fixtures/router-eval.json`. The fixture suite includes simple Q&A, coding, read-only diagnosis, PR/MR review, CI/migration, and critical production/security/data-loss prompts.

## Roadmap

- TOML config support
- Rule explanations with confidence scores
- `codex-router init`
- npm package publishing
- Optional LLM classifier
- Codex skill that recommends the same routing policy inside Desktop chats
