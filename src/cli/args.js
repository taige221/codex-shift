import { resolveStatusFile } from "../ui/status.js";

const VALID_COMMANDS = new Set(["route", "dry-run", "exec", "turn"]);
const VALID_TRANSPORTS = new Set(["exec", "app-server"]);

export function parseArgs(inputArgs, env = process.env) {
  const args = [...inputArgs];
  const state = {
    command: "exec",
    promptParts: [],
    codexArgs: [],
    codexBin: env.CODEX_BIN ?? "codex",
    codexHome: env.CODEX_HOME,
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

export function parseProxyArgs(inputArgs, env = process.env) {
  const args = [...inputArgs];
  const state = {
    codexHome: env.CODEX_HOME,
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

export function parseTuiArgs(inputArgs, env = process.env) {
  const args = [...inputArgs];
  const state = {
    codexArgs: [],
    codexBin: env.CODEX_BIN,
    codexHome: env.CODEX_HOME,
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

export function resolveTransport(parsed) {
  if (parsed.command === "turn") return "app-server";
  return parsed.transport ?? "exec";
}
