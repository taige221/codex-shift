#!/usr/bin/env node
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { routePrompt } from "../router/index.js";
import { parsePromptEffortDirective } from "../router/directives.js";
import { loadConfig } from "../config/index.js";
import { readCodexUsage } from "../usage/index.js";
import { runCodex } from "../codex/index.js";
import { resolveRealCodex } from "../codex/real-codex.js";

const SHIM_PATH = fileURLToPath(import.meta.url);
const CLI_PATH = join(dirname(SHIM_PATH), "index.js");

const ROUTER_COMMANDS = new Set(["route", "dry-run", "turn"]);
const NATIVE_SUBCOMMANDS = new Set([
  "exec",
  "e",
  "review",
  "login",
  "logout",
  "mcp",
  "plugin",
  "mcp-server",
  "app-server",
  "remote-control",
  "app",
  "completion",
  "update",
  "doctor",
  "sandbox",
  "debug",
  "apply",
  "a",
  "resume",
  "archive",
  "unarchive",
  "fork",
  "cloud",
  "exec-server",
  "features",
  "help"
]);
const EXEC_SUBCOMMANDS = new Set(["resume", "review", "help"]);
const VALUE_OPTIONS = new Set([
  "-c",
  "--config",
  "-i",
  "--image",
  "-m",
  "--model",
  "--local-provider",
  "-p",
  "--profile",
  "-s",
  "--sandbox",
  "-C",
  "--cd",
  "--add-dir",
  "-a",
  "--ask-for-approval",
  "--remote",
  "--remote-auth-token-env",
  "--output-schema",
  "-o",
  "--output-last-message",
  "--color"
]);
const VALUE_OPTION_PREFIXES = ["--config=", "--model=", "--cd=", "--sandbox="];

try {
  main();
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  const realCodex = resolveRealCodex({ shimPath: process.argv[1] });

  if (process.env.CODEX_SHIFT_BYPASS) {
    exitWith(runRealCodex(realCodex, args));
  }

  if (args[0] === "shift") {
    exitWith(runRouterCli(args.slice(1)));
  }

  if (ROUTER_COMMANDS.has(args[0])) {
    exitWith(runRouterCli(args));
  }

  if (args[0] === "exec" || args[0] === "e") {
    exitWith(runExecShim(args, realCodex));
  }

  if (shouldStartProxiedResume(args)) {
    exitWith(runRouterCli(["tui", "--codex-bin", realCodex, "--", ...args]));
  }

  if (shouldRouteTopLevelPrompt(args)) {
    exitWith(runTopLevelPromptShim(args, realCodex));
  }

  if (shouldStartProxiedTui(args)) {
    exitWith(runRouterCli(["tui", "--codex-bin", realCodex, "--", ...args]));
  }

  exitWith(runRealCodex(realCodex, args));
}

function runExecShim(args, realCodex) {
  const execArgs = args.slice(1);
  const parsed = parsePromptInvocation(execArgs);

  if (!parsed.prompt || parsed.prompt === "-" || EXEC_SUBCOMMANDS.has(parsed.firstPositional)) {
    return runRealCodex(realCodex, args);
  }

  return runRoutedCodexExec(realCodex, prepareRoutedPromptInvocation(parsed));
}

function runTopLevelPromptShim(args, realCodex) {
  const parsed = parsePromptInvocation(args);
  if (!parsed.prompt || parsed.prompt === "-") {
    return runRealCodex(realCodex, args);
  }

  const routed = prepareRoutedPromptInvocation(parsed);
  const decision = buildDecision(routed);
  if (process.env.CODEX_SHIFT_TRACE) {
    printTrace(decision);
  }

  const routedArgs = [
    "-m",
    decision.model,
    "-c",
    `model_reasoning_effort="${decision.effort}"`
  ];

  if (routed.cwd) {
    routedArgs.push("-C", routed.cwd);
  }
  if (decision.readOnly && !hasSandboxOption(routed.codexArgs)) {
    routedArgs.push("-s", "read-only");
  }
  routedArgs.push(...routed.codexArgs, routed.prompt);

  return runRealCodex(realCodex, routedArgs, routed.cwd);
}

function runRoutedCodexExec(realCodex, parsed) {
  const decision = buildDecision(parsed);
  if (process.env.CODEX_SHIFT_TRACE) {
    printTrace(decision);
  }

  return runCodex(decision, {
    codexBin: realCodex,
    cwd: parsed.cwd,
    codexArgs: parsed.codexArgs,
    prompt: parsed.prompt
  });
}

function buildDecision(parsed) {
  const { config } = loadConfig(process.env.CODEX_SHIFT_CONFIG);
  const usage = process.env.CODEX_SHIFT_NO_USAGE ? null : readCodexUsage(process.env.CODEX_HOME);
  return routePrompt(parsed.prompt, {
    config,
    model: parsed.model,
    promptEffortDirective: parsed.promptEffortDirective,
    usage
  });
}

function prepareRoutedPromptInvocation(parsed) {
  const promptEffortDirective = parsePromptEffortDirective(parsed.prompt);
  return {
    ...parsed,
    prompt: promptEffortDirective.prompt,
    promptEffortDirective
  };
}

function parsePromptInvocation(args) {
  const codexArgs = [];
  const promptParts = [];
  let cwd = null;
  let firstPositional = null;
  let model = null;
  let parseOptions = true;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (parseOptions && arg === "--") {
      promptParts.push(...args.slice(index + 1));
      if (!firstPositional && args[index + 1]) firstPositional = args[index + 1];
      break;
    }

    if (parseOptions && arg.startsWith("-")) {
      const inline = parseInlineValueOption(arg);
      if (inline) {
        if (inline.name === "--model") model = inline.value;
        else if (inline.name === "--cd") cwd = inline.value;
        else codexArgs.push(arg);
        continue;
      }

      if (VALUE_OPTIONS.has(arg)) {
        const value = args[index + 1];
        if (value === undefined) {
          codexArgs.push(arg);
          continue;
        }
        index += 1;
        if (arg === "-m" || arg === "--model") model = value;
        else if (arg === "-C" || arg === "--cd") cwd = value;
        else codexArgs.push(arg, value);
        continue;
      }

      codexArgs.push(arg);
      continue;
    }

    parseOptions = false;
    if (!firstPositional) firstPositional = arg;
    promptParts.push(arg);
  }

  return {
    codexArgs,
    cwd,
    firstPositional,
    model,
    prompt: promptParts.join(" ").trim()
  };
}

function parseInlineValueOption(arg) {
  for (const prefix of VALUE_OPTION_PREFIXES) {
    if (!arg.startsWith(prefix)) continue;
    return {
      name: prefix.slice(0, -1),
      value: arg.slice(prefix.length)
    };
  }
  return null;
}

function shouldRouteTopLevelPrompt(args) {
  if (!args.length) return false;

  const parsed = parsePromptInvocation(args);
  if (!parsed.firstPositional) return false;
  if (NATIVE_SUBCOMMANDS.has(parsed.firstPositional)) return false;
  return Boolean(parsed.prompt && parsed.prompt !== "-");
}

function shouldStartProxiedTui(args) {
  if (!args.length) return true;
  if (args.some((arg) => arg === "-h" || arg === "--help" || arg === "-V" || arg === "--version")) {
    return false;
  }
  if (args.some((arg) => arg === "--remote" || arg.startsWith("--remote="))) return false;

  const parsed = parsePromptInvocation(args);
  if (parsed.firstPositional && NATIVE_SUBCOMMANDS.has(parsed.firstPositional)) return false;
  return !parsed.prompt;
}

function shouldStartProxiedResume(args) {
  return args[0] === "resume";
}

function runRouterCli(args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env
  });
}

function runRealCodex(realCodex, args, cwd = process.cwd()) {
  return spawnSync(realCodex, args, {
    stdio: "inherit",
    cwd: cwd ?? process.cwd(),
    env: process.env
  });
}

function hasSandboxOption(args) {
  return args.some((arg) => arg === "-s" || arg === "--sandbox" || arg.startsWith("--sandbox="));
}

function printTrace(decision) {
  console.error(
    `[codex-shift] model=${decision.model} effort=${decision.effort} classification=${decision.classification}`
  );
}

function exitWith(result) {
  if (typeof result.status === "number") {
    process.exit(result.status);
  }
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
}
