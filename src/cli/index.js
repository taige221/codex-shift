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
import { printHelp, printProxyHelp, printTuiHelp } from "./help.js";
import {
  buildAppServerOptions,
  buildTransportPreview,
  printDecision,
  printPreview
} from "./preview.js";
import {
  parseArgs,
  parseProxyArgs,
  parseTuiArgs,
  resolveTransport
} from "./args.js";

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
