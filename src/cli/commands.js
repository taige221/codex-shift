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
import {
  parseArgs,
  parseProxyArgs,
  parseTuiArgs,
  resolveTransport
} from "./args.js";
import { printHelp, printProxyHelp, printTuiHelp } from "./help.js";
import {
  buildAppServerOptions,
  buildTransportPreview,
  printDecision,
  printPreview
} from "./preview.js";

export async function runMainCommand(rawArgs = process.argv.slice(2), options = {}) {
  const entrypoint = options.entrypoint ?? process.argv[1];
  const env = options.env ?? process.env;

  if (basename(entrypoint ?? "") === "codex-shift-hud") {
    return runHudCli(rawArgs);
  }

  if (rawArgs[0] === "proxy") {
    await runProxyCli(rawArgs.slice(1));
    return 0;
  }

  if (rawArgs[0] === "hud") {
    return runHudCli(rawArgs.slice(1));
  }

  if (rawArgs[0] === "tui") {
    const tuiOptions = parseTuiArgs(rawArgs.slice(1), env);
    if (tuiOptions.help) {
      printTuiHelp();
      return 0;
    }
    const result = await runTui(tuiOptions);
    return result.status ?? 0;
  }

  const parsed = parseArgs(rawArgs, env);

  if (parsed.help) {
    printHelp();
    return 0;
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
    return 0;
  }

  if (transport === "app-server") {
    const result = callTurnStart(decision, buildAppServerOptions(routedParsed, routedPrompt));
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (typeof result.status === "number") {
      return result.status;
    }
    if (result.error) {
      console.error(result.error.message);
      return 1;
    }
    return 0;
  }

  const result = runCodex(decision, {
    codexBin: parsed.codexBin,
    cwd: parsed.cwd,
    codexArgs: parsed.codexArgs,
    prompt: routedPrompt
  });

  if (typeof result.status === "number") {
    return result.status;
  }
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return 0;
}

export async function runProxyCli(args) {
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
