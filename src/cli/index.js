#!/usr/bin/env node
import { basename } from "node:path";
import { routePrompt } from "../router/index.js";
import { parsePromptEffortDirective } from "../router/directives.js";
import { loadConfig } from "../config/index.js";
import { readCodexUsage } from "../usage/index.js";
import { runCodex } from "../codex/index.js";
import { callTurnStart } from "../transports/app-server.js";
import { startRemoteProxy } from "../proxy/remote-proxy.js";
import { runTui } from "../ui/tui.js";
import { runHudCli } from "../ui/hud.js";
import { resolveStatusFile } from "../ui/status.js";
import { printHelp, printProxyHelp, printTuiHelp } from "./help.js";
import {
  buildAppServerOptions,
  buildTransportPreview,
  printDecision,
  printPreview
} from "./preview.js";

const VALID_COMMANDS = new Set(["route", "dry-run", "exec", "turn"]);
const VALID_TRANSPORTS = new Set(["exec", "app-server"]);

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
