#!/usr/bin/env node
import { basename } from "node:path";
import { routePrompt } from "../router/index.js";
import { parsePromptEffortDirective } from "../router/directives.js";
import { loadConfig } from "../config/index.js";
import { readCodexUsage } from "../usage/index.js";
import { buildCodexCommand, runCodex } from "../codex/index.js";
import { buildAppServerProxyCommand, buildTurnStartRequest, callTurnStart } from "../transports/app-server.js";
import { startRemoteProxy } from "../proxy/remote-proxy.js";
import { runTui } from "../ui/tui.js";
import { runHudCli } from "../ui/hud.js";
import { DEFAULT_STATUS_FILE, resolveStatusFile } from "../ui/status.js";

const VALID_COMMANDS = new Set(["route", "dry-run", "exec", "turn"]);
const VALID_TRANSPORTS = new Set(["exec", "app-server"]);
const OMITTED_PROMPT = "[prompt omitted]";

try {
  await main();
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(1);
}

async function main() {
  const rawArgs = process.argv.slice(2);

  if (basename(process.argv[1] ?? "") === "codex-shift-hud") {
    const status = await runHudCli(rawArgs);
    process.exit(status);
  }

  if (rawArgs[0] === "proxy") {
    await runProxyCli(rawArgs.slice(1));
    return;
  }

  if (rawArgs[0] === "hud") {
    const status = await runHudCli(rawArgs.slice(1));
    process.exit(status);
  }

  if (rawArgs[0] === "tui") {
    const options = parseTuiArgs(rawArgs.slice(1));
    if (options.help) {
      printTuiHelp();
      return;
    }
    const result = await runTui(options);
    process.exit(result.status ?? 0);
  }

  const parsed = parseArgs(rawArgs);

  if (parsed.help) {
    printHelp();
    return;
  }

  const { config } = loadConfig(parsed.configPath);
  const usage = parsed.noUsage ? null : readCodexUsage(parsed.codexHome);
  const promptDirective = parsePromptEffortDirective(parsed.prompt);
  const routedPrompt = promptDirective.prompt;
  const routedParsed = { ...parsed, prompt: routedPrompt };
  const decision = routePrompt(routedPrompt, {
    config,
    model: parsed.model,
    effort: parsed.effort,
    promptEffortDirective: promptDirective,
    usage
  });
  const transport = resolveTransport(parsed);
  const preview = buildTransportPreview(decision, routedParsed, transport);

  if (parsed.json) {
    console.log(JSON.stringify({ decision, usage, transport, ...preview }, null, 2));
  } else {
    printDecision(decision, usage);
    printPreview(preview);
  }

  if (parsed.command === "route" || parsed.command === "dry-run") {
    return;
  }

  if (transport === "app-server") {
    const result = callTurnStart(decision, buildAppServerOptions(routedParsed, routedPrompt));
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (typeof result.status === "number") {
      process.exit(result.status);
    }
    if (result.error) {
      console.error(result.error.message);
      process.exit(1);
    }
    return;
  }

  const result = runCodex(decision, {
    codexBin: parsed.codexBin,
    cwd: parsed.cwd,
    codexArgs: parsed.codexArgs,
    prompt: routedPrompt
  });

  if (typeof result.status === "number") {
    process.exit(result.status);
  }
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
}

async function runProxyCli(args) {
  const options = parseProxyArgs(args);
  if (options.help) {
    printProxyHelp();
    return;
  }

  const proxy = await startRemoteProxy(options);
  console.error(`[codex-shift] proxy listening on ${proxy.url} -> ${proxy.target}`);

  await new Promise((resolve) => {
    const shutdown = async () => {
      await proxy.close();
      resolve();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

function parseArgs(args) {
  const state = {
    command: "exec",
    promptParts: [],
    codexArgs: [],
    codexBin: process.env.CODEX_BIN ?? "codex",
    codexHome: process.env.CODEX_HOME,
    configPath: null,
    cwd: null,
    effort: null,
    help: false,
    includePrompt: false,
    json: false,
    model: null,
    noUsage: false,
    sock: null,
    summary: undefined,
    threadId: null,
    transport: null
  };

  if (VALID_COMMANDS.has(args[0])) {
    state.command = args.shift();
  }

  while (args.length) {
    const arg = args.shift();
    if (arg === "--") {
      state.codexArgs.push(...args);
      break;
    }
    if (arg === "-h" || arg === "--help") state.help = true;
    else if (arg === "--json") state.json = true;
    else if (arg === "--include-prompt") state.includePrompt = true;
    else if (arg === "--no-usage") state.noUsage = true;
    else if (arg === "--model") state.model = requireValue(arg, args);
    else if (arg === "--effort") state.effort = requireValue(arg, args);
    else if (arg === "--cwd") state.cwd = requireValue(arg, args);
    else if (arg === "--config") state.configPath = requireValue(arg, args);
    else if (arg === "--codex-bin") state.codexBin = requireValue(arg, args);
    else if (arg === "--codex-home") state.codexHome = requireValue(arg, args);
    else if (arg === "--sock") state.sock = requireValue(arg, args);
    else if (arg === "--summary") state.summary = requireValue(arg, args);
    else if (arg === "--no-summary") state.summary = false;
    else if (arg === "--thread") state.threadId = requireValue(arg, args);
    else if (arg === "--transport") state.transport = requireTransport(requireValue(arg, args));
    else state.promptParts.push(arg);
  }

  state.prompt = state.promptParts.join(" ").trim();
  if (!state.prompt && !state.help) {
    throw new Error("Missing prompt. Run codex-router --help for usage.");
  }

  return state;
}

function parseProxyArgs(args) {
  const state = {
    codexHome: process.env.CODEX_HOME,
    configPath: null,
    help: false,
    listen: "ws://127.0.0.1:0",
    cwdFilter: null,
    noUsage: false,
    statusFile: resolveStatusFile(),
    summary: undefined,
    target: null,
    trace: false
  };

  while (args.length) {
    const arg = args.shift();
    if (arg === "-h" || arg === "--help") state.help = true;
    else if (arg === "--listen") state.listen = requireValue(arg, args);
    else if (arg === "--target") state.target = requireValue(arg, args);
    else if (arg === "--config") state.configPath = requireValue(arg, args);
    else if (arg === "--codex-home") state.codexHome = requireValue(arg, args);
    else if (arg === "--cwd-filter") state.cwdFilter = requireValue(arg, args);
    else if (arg === "--no-usage") state.noUsage = true;
    else if (arg === "--status-file") state.statusFile = requireValue(arg, args);
    else if (arg === "--no-status") state.statusFile = null;
    else if (arg === "--summary") state.summary = requireValue(arg, args);
    else if (arg === "--no-summary") state.summary = false;
    else if (arg === "--trace") state.trace = true;
    else throw new Error(`Unknown proxy option ${arg}.`);
  }

  if (!state.help && !state.target) {
    throw new Error("Missing --target for proxy.");
  }

  return state;
}

function parseTuiArgs(args) {
  const state = {
    codexArgs: [],
    codexBin: process.env.CODEX_BIN,
    codexHome: process.env.CODEX_HOME,
    configPath: null,
    cwdFilter: null,
    help: false,
    host: "127.0.0.1",
    hud: false,
    hudHeight: undefined,
    hudLauncher: "auto",
    hudVerbose: false,
    noUsage: false,
    proxyPort: null,
    realPort: null,
    statusFile: resolveStatusFile(),
    summary: undefined,
    trace: false
  };

  while (args.length) {
    const arg = args.shift();
    if (arg === "--") {
      state.codexArgs.push(...args);
      break;
    }
    if (arg === "-h" || arg === "--help") state.help = true;
    else if (arg === "--codex-bin") state.codexBin = requireValue(arg, args);
    else if (arg === "--codex-home") state.codexHome = requireValue(arg, args);
    else if (arg === "--config") state.configPath = requireValue(arg, args);
    else if (arg === "--cwd-filter") state.cwdFilter = requireValue(arg, args);
    else if (arg === "--host") state.host = requireValue(arg, args);
    else if (arg === "--hud") state.hud = true;
    else if (arg === "--hud-height") state.hudHeight = requirePositiveInteger(arg, args);
    else if (arg === "--hud-launcher") state.hudLauncher = requireHudLauncher(requireValue(arg, args));
    else if (arg === "--hud-verbose") {
      state.hud = true;
      state.hudVerbose = true;
    }
    else if (arg === "--real-port") state.realPort = Number(requireValue(arg, args));
    else if (arg === "--proxy-port") state.proxyPort = Number(requireValue(arg, args));
    else if (arg === "--no-usage") state.noUsage = true;
    else if (arg === "--status-file") state.statusFile = requireValue(arg, args);
    else if (arg === "--no-status") state.statusFile = null;
    else if (arg === "--summary") state.summary = requireValue(arg, args);
    else if (arg === "--no-summary") state.summary = false;
    else if (arg === "--trace") state.trace = true;
    else state.codexArgs.push(arg);
  }

  return state;
}

function requireValue(flag, args) {
  const value = args.shift();
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function requireTransport(value) {
  if (!VALID_TRANSPORTS.has(value)) {
    throw new Error(`Invalid transport ${value}. Expected exec or app-server.`);
  }
  return value;
}

function requirePositiveInteger(flag, args) {
  const value = Number(requireValue(flag, args));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return value;
}

function requireHudLauncher(value) {
  if (!["auto", "tmux", "terminal"].includes(value)) {
    throw new Error("--hud-launcher must be one of auto, tmux, terminal.");
  }
  return value;
}

function resolveTransport(parsed) {
  if (parsed.command === "turn") return "app-server";
  return parsed.transport ?? "exec";
}

function buildTransportPreview(decision, parsed, transport) {
  const prompt = parsed.includePrompt ? parsed.prompt : OMITTED_PROMPT;
  if (transport === "app-server") {
    const options = buildAppServerOptions(parsed, prompt);
    return {
      proxy: buildAppServerProxyCommand(options),
      request: buildTurnStartRequest(decision, options)
    };
  }

  return {
    command: buildCodexCommand(decision, {
      codexBin: parsed.codexBin,
      cwd: parsed.cwd,
      codexArgs: parsed.codexArgs,
      prompt
    })
  };
}

function buildAppServerOptions(parsed, prompt) {
  return {
    codexBin: parsed.codexBin,
    cwd: parsed.cwd,
    prompt,
    sock: parsed.sock,
    summary: parsed.summary,
    threadId: parsed.threadId
  };
}

function printDecision(decision, usage) {
  console.log(`model: ${decision.model}`);
  console.log(`effort: ${decision.effort}`);
  console.log(`classification: ${decision.classification}`);
  console.log(`confidence: ${decision.confidence}`);
  console.log(`mode: ${decision.mode}`);
  console.log(`read_only: ${decision.readOnly}`);
  console.log(`reason: ${decision.reasons.join("; ")}`);
  if (usage?.secondaryUsedPercent !== null && usage?.secondaryUsedPercent !== undefined) {
    console.log(`weekly_usage: ${usage.secondaryUsedPercent}%`);
  }
}

function printPreview(preview) {
  if (preview.command) {
    console.log(`command: ${shellQuote([preview.command.command, ...preview.command.args])}`);
    return;
  }

  if (preview.proxy) {
    console.log(`proxy: ${shellQuote([preview.proxy.command, ...preview.proxy.args])}`);
  }
  if (preview.request) {
    console.log(`request: ${JSON.stringify(preview.request)}`);
  }
}

function printHelp() {
  console.log(`codex-router - choose model and reasoning effort before calling Codex CLI

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
`);
}

function printProxyHelp() {
  console.log(`codex-shift proxy - route app-server turn/start messages

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
`);
}

function printTuiHelp() {
  console.log(`codex-shift tui - start native Codex TUI through the routing proxy

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
`);
}

function shellQuote(parts) {
  return parts
    .map((part) => {
      if (/^[A-Za-z0-9_./:=@-]+$/.test(part)) return part;
      return `'${String(part).replaceAll("'", "'\\''")}'`;
    })
    .join(" ");
}
