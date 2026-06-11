import { DEFAULT_STATUS_FILE } from "../ui/status.js";

export function getHelpText() {
  return `codex-router - choose model and reasoning effort before calling Codex CLI

Usage:
  codex-router route "explain this function"
  codex-router dry-run "fix this failing test"
  codex-router exec "review改修这个 PR"
  codex-router turn --thread <thread-id> "fix this failing test"
  codex-shift tui
  codex-shift hud
  codex-shift proxy --listen ws://127.0.0.1:17891 --target ws://127.0.0.1:17890

Commands:
  route      Print the routing decision and Codex command, then exit
  dry-run    Same as route; preview only, never starts Codex
  exec       Run the selected transport with the routed model and effort (default)
  turn       Start an app-server turn/start request; always uses app-server
  tui        Start real Codex TUI through a local routing proxy
  proxy      Run the app-server WebSocket routing proxy
  hud        Show the latest routed turn from ${DEFAULT_STATUS_FILE}

Options:
  --model <name>        Override model
  --effort <level>      Override reasoning effort
  --cwd <dir>           Working directory passed to codex exec -C
  --config <file>       JSON config path
  --codex-bin <path>    Codex executable path
  --codex-home <dir>    Codex home for local usage reads
  --transport <name>    Select exec or app-server for route/dry-run/exec
  --thread <id>         App-server thread id; required for app-server preview/turn
  --sock <path>         App-server Unix socket for codex app-server proxy
  --summary <mode>      App-server summary mode; defaults to concise
  --no-summary          Omit app-server summary from turn/start params
  --include-prompt      Include the full prompt in previews; real runs always send it
  --no-usage            Do not read local Codex weekly usage
  --json                Print decision as JSON
  --                    Pass the rest through to codex exec

Behavior:
  route/dry-run never execute Codex. With --transport app-server they build the exact
  turn/start JSON-RPC request, so --thread is required.
  turn starts a new app-server turn on the given thread and forwards proxy stdout/stderr.
  A leading /low, /medium, /high, or /xhigh prompt directive forces effort for
  shell routes and is stripped before dispatch. In native TUI, use #low,
  #medium, #high, or #xhigh because / is reserved for Codex commands; the proxy
  keeps TUI input unchanged so the message is not duplicated. --effort still
  takes precedence.
`;
}

export function getProxyHelpText() {
  return `codex-shift proxy - route app-server turn/start messages

Usage:
  codex-shift proxy --listen ws://127.0.0.1:17891 --target ws://127.0.0.1:17890

Options:
  --listen <url>      Local ws:// URL for clients to connect to
  --target <url>      Real app-server ws:// URL to forward to
  --config <file>     JSON router config path
  --codex-home <dir>  Codex home for local usage reads
  --cwd-filter <dir>  Inject cwd into thread/list requests when absent
  --status-file <path> Write latest routed turn status; defaults to ${DEFAULT_STATUS_FILE}
  --no-status         Do not write a HUD status file
  --summary <mode>    Summary mode injected into turn/start; defaults to concise
  --no-summary        Do not inject summary
  --no-usage          Do not read local Codex weekly usage
  --trace             Print model/effort decisions without prompt text
`;
}

export function getTuiHelpText() {
  return `codex-shift tui - start native Codex TUI through the routing proxy

Usage:
  codex-shift tui
  codex-shift tui -- --no-alt-screen -C /path/to/project

Options:
  --codex-bin <path>   Real Codex executable path
  --host <host>        Local bind host; defaults to 127.0.0.1
  --hud                Open a HUD showing the latest routed turn
  --hud-verbose        Open the HUD in verbose mode
  --hud-launcher <mode> HUD launcher: auto, tmux, terminal; defaults to auto
  --hud-height <lines> HUD pane height for tmux; defaults to 8
  --real-port <port>   Port for real codex app-server; defaults to a free port
  --proxy-port <port>  Port for codex-shift proxy; defaults to a free port
  --config <file>      JSON router config path
  --codex-home <dir>   Codex home for local usage reads
  --cwd-filter <dir>   Internal: cwd filter passed through HUD tmux relaunch
  --status-file <path> Write latest routed turn status; defaults to ${DEFAULT_STATUS_FILE}
  --no-status          Do not write a HUD status file
  --summary <mode>     Summary mode injected into turn/start; defaults to concise
  --no-summary         Do not inject summary
  --no-usage           Do not read local Codex weekly usage
  --trace              Print model/effort decisions without prompt text
  --                   Pass remaining args to native Codex TUI

Behavior:
  --hud uses tmux by default. Inside tmux it opens a split pane; outside tmux it
  starts a temporary tmux session in the current terminal. Use --hud-launcher
  terminal to explicitly open a macOS Terminal.app HUD window.
`;
}

export function printHelp(writer = console.log) {
  writer(getHelpText());
}

export function printProxyHelp(writer = console.log) {
  writer(getProxyHelpText());
}

export function printTuiHelp(writer = console.log) {
  writer(getTuiHelpText());
}
