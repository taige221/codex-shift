import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { resolveRealCodex } from "../codex/real-codex.js";

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), "../cli/index.js");
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_HUD_HEIGHT = 8;
const DEFAULT_TMUX_HISTORY_LIMIT = 50_000;
const STARTUP_TIMEOUT_MS = 10_000;
const NATIVE_VALUE_OPTIONS = new Set([
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
  "--color",
  "--enable",
  "--disable"
]);
const NATIVE_VALUE_OPTION_PREFIXES = [
  "--config=",
  "--image=",
  "--model=",
  "--local-provider=",
  "--profile=",
  "--sandbox=",
  "--cd=",
  "--add-dir=",
  "--ask-for-approval=",
  "--remote=",
  "--remote-auth-token-env=",
  "--output-schema=",
  "--output-last-message=",
  "--color=",
  "--enable=",
  "--disable="
];

export async function runTui(options = {}) {
  const env = options.env ?? process.env;
  if (options.hud && !options.statusFile) {
    throw new Error("codex-shift tui --hud requires a status file. Remove --no-status or pass --status-file <path>.");
  }
  if (shouldRelaunchInTmux(options, env)) {
    return runTuiInTmux(options, env);
  }
  const trace = Boolean(options.trace || process.env.CODEX_SHIFT_TRACE);
  if (options.hud && env.TMUX) {
    configureTmuxForHud(options, trace);
  }

  const host = options.host ?? DEFAULT_HOST;
  const realPort = Number(options.realPort ?? (await getFreePort(host)));
  let proxyPort = Number(options.proxyPort ?? (await getFreePort(host)));
  if (realPort === proxyPort && options.proxyPort) {
    throw new Error("Proxy port must be different from real app-server port.");
  }
  while (realPort === proxyPort) {
    proxyPort = Number(await getFreePort(host));
  }
  const realCodex = resolveRealCodex({ codexBin: options.codexBin });
  const plan = buildTuiPlan({
    ...options,
    env,
    host,
    launchCwd: process.cwd(),
    realCodex,
    realPort,
    proxyPort
  });
  const children = [];
  const hudHandles = [];
  const cleanup = () => {
    for (const child of children.toReversed()) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
    }
    for (const handle of hudHandles.toReversed()) {
      cleanupHud(handle);
    }
  };
  const signalHandlers = installSignalHandlers(cleanup);

  try {
    const appServer = spawn(plan.appServer.command, plan.appServer.args, {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    children.push(appServer);
    const appLog = captureChildOutput(appServer, "app-server", trace);
    await waitForWebSocket(host, realPort, appServer, appLog);

    const proxy = spawn(plan.proxy.command, plan.proxy.args, {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    children.push(proxy);
    const proxyLog = captureChildOutput(proxy, "proxy", trace);
    await waitForWebSocket(host, proxyPort, proxy, proxyLog);

    if (plan.hud) {
      hudHandles.push(startHud(plan.hud));
    }

    const tui = spawn(plan.tui.command, plan.tui.args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit"
    });
    children.push(tui);
    return await waitForExit(tui);
  } finally {
    cleanup();
    uninstallSignalHandlers(signalHandlers);
  }
}

export function buildTuiPlan(options = {}) {
  const host = options.host ?? DEFAULT_HOST;
  const realPort = Number(options.realPort);
  const proxyPort = Number(options.proxyPort);
  if (!realPort || !proxyPort) {
    throw new Error("buildTuiPlan requires realPort and proxyPort.");
  }
  if (options.hud && !options.statusFile) {
    throw new Error("codex-shift tui --hud requires a status file. Remove --no-status or pass --status-file <path>.");
  }

  const realCodex = options.realCodex ?? resolveRealCodex({ codexBin: options.codexBin });
  const realUrl = `ws://${host}:${realPort}`;
  const proxyUrl = `ws://${host}:${proxyPort}`;
  const proxyArgs = [
    CLI_PATH,
    "proxy",
    "--listen",
    proxyUrl,
    "--target",
    realUrl
  ];

  if (options.configPath) proxyArgs.push("--config", options.configPath);
  if (options.codexHome) proxyArgs.push("--codex-home", options.codexHome);
  if (options.noUsage) proxyArgs.push("--no-usage");
  if (options.statusFile === null) proxyArgs.push("--no-status");
  else if (options.statusFile !== undefined) proxyArgs.push("--status-file", options.statusFile);
  if (options.summary === false) proxyArgs.push("--no-summary");
  else if (options.summary !== undefined) proxyArgs.push("--summary", options.summary);
  if (options.trace) proxyArgs.push("--trace");
  const cwdFilter = options.cwdFilter ?? resolveResumeCwdFilter(options.codexArgs ?? [], options.launchCwd ?? process.cwd());
  if (cwdFilter) proxyArgs.push("--cwd-filter", cwdFilter);

  const plan = {
    appServer: {
      command: realCodex,
      args: ["app-server", "--listen", realUrl]
    },
    proxy: {
      command: process.execPath,
      args: proxyArgs
    },
    tui: {
      command: realCodex,
      args: buildNativeTuiArgs(proxyUrl, options.codexArgs ?? [])
    },
    realUrl,
    proxyUrl
  };

  if (options.hud) {
    plan.hud = buildHudPlan({
      env: options.env ?? process.env,
      height: options.hudHeight ?? DEFAULT_HUD_HEIGHT,
      launcher: options.hudLauncher ?? "auto",
      parentPid: options.parentPid ?? process.pid,
      platform: options.platform ?? process.platform,
      statusFile: options.statusFile,
      verbose: options.hudVerbose
    });
  }

  return plan;
}

export function buildTmuxRelaunchPlan(options = {}) {
  const args = ["tui", "--hud", "--hud-launcher", "tmux"];

  if (options.codexBin) args.push("--codex-bin", options.codexBin);
  if (options.codexHome) args.push("--codex-home", options.codexHome);
  if (options.configPath) args.push("--config", options.configPath);
  if (options.host) args.push("--host", options.host);
  if (options.hudHeight !== undefined) args.push("--hud-height", String(options.hudHeight));
  if (options.hudVerbose) args.push("--hud-verbose");
  if (options.realPort !== null && options.realPort !== undefined) args.push("--real-port", String(options.realPort));
  if (options.proxyPort !== null && options.proxyPort !== undefined) args.push("--proxy-port", String(options.proxyPort));
  if (options.noUsage) args.push("--no-usage");
  if (options.statusFile === null) args.push("--no-status");
  else if (options.statusFile !== undefined) args.push("--status-file", options.statusFile);
  if (options.summary === false) args.push("--no-summary");
  else if (options.summary !== undefined) args.push("--summary", options.summary);
  if (options.trace) args.push("--trace");
  if (options.codexArgs?.length) args.push("--", ...options.codexArgs);

  const commandParts = [process.execPath, CLI_PATH, ...args];
  return {
    command: "tmux",
    args: ["new-session", shellQuote(commandParts)],
    relaunch: {
      command: process.execPath,
      args: [CLI_PATH, ...args]
    }
  };
}

function shouldRelaunchInTmux(options, env) {
  if (!options.hud || env.TMUX) return false;
  const launcher = options.hudLauncher ?? "auto";
  return launcher === "auto" || launcher === "tmux";
}

function runTuiInTmux(options, env) {
  const plan = buildTmuxRelaunchPlan(options);
  const result = spawnSync(plan.command, plan.args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit"
  });

  if (result.error) {
    throw new Error(
      `codex-shift tui --hud requires tmux. Install tmux, or use --hud-launcher terminal on macOS.\n${result.error.message}`
    );
  }

  return {
    status: result.status ?? signalToExitCode(result.signal),
    signal: result.signal
  };
}

function configureTmuxForHud(options, trace) {
  for (const args of buildTmuxHudOptionCommands(options)) {
    const result = spawnSync("tmux", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (result.status === 0) continue;
    if (trace) {
      const detail = (result.stderr || result.stdout || "").trim();
      process.stderr.write(`[codex-shift:tui] tmux ${args.join(" ")} failed${detail ? `: ${detail}` : ""}\n`);
    }
  }
}

export function buildTmuxHudOptionCommands(options = {}) {
  const historyLimit = Number(options.tmuxHistoryLimit ?? DEFAULT_TMUX_HISTORY_LIMIT);
  return [
    ["set-option", "-q", "mouse", "on"],
    ["set-option", "-q", "history-limit", String(historyLimit)]
  ];
}

function buildNativeTuiArgs(proxyUrl, codexArgs) {
  const commandIndex = findNativeCommandIndex(codexArgs);
  if (commandIndex !== -1 && codexArgs[commandIndex] === "resume") {
    return [
      ...codexArgs.slice(0, commandIndex),
      "resume",
      "--remote",
      proxyUrl,
      ...codexArgs.slice(commandIndex + 1)
    ];
  }
  return ["--remote", proxyUrl, ...codexArgs];
}

function resolveResumeCwdFilter(codexArgs, launchCwd) {
  const commandIndex = findNativeCommandIndex(codexArgs);
  if (commandIndex === -1 || codexArgs[commandIndex] !== "resume") return null;
  if (hasNativeFlag(codexArgs, "--all")) return null;

  const explicitCwd = findNativeOptionValue(codexArgs, new Set(["-C", "--cd"]), "--cd=");
  return resolve(launchCwd, explicitCwd ?? ".");
}

function findNativeCommandIndex(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") return -1;
    if (!arg.startsWith("-")) return index;
    if (NATIVE_VALUE_OPTIONS.has(arg)) index += 1;
    else if (NATIVE_VALUE_OPTION_PREFIXES.some((prefix) => arg.startsWith(prefix))) continue;
  }
  return -1;
}

function hasNativeFlag(args, flag) {
  for (const arg of args) {
    if (arg === "--") return false;
    if (arg === flag) return true;
  }
  return false;
}

function findNativeOptionValue(args, names, inlinePrefix) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") return null;
    if (names.has(arg)) return args[index + 1] ?? null;
    if (arg.startsWith(inlinePrefix)) return arg.slice(inlinePrefix.length);
  }
  return null;
}

function buildHudPlan(options) {
  const hudCommand = {
    command: process.execPath,
    args: [
      CLI_PATH,
      "hud",
      "--file",
      options.statusFile
    ]
  };
  if (options.verbose) hudCommand.args.push("--verbose");
  const launcher = resolveHudLauncher(options);

  if (launcher === "tmux") {
    return {
      type: "tmux",
      command: "tmux",
      args: [
        "split-window",
        "-d",
        "-v",
        "-l",
        String(options.height),
        "-P",
        "-F",
        "#{pane_id}",
        shellQuote([hudCommand.command, ...hudCommand.args])
      ],
      hudCommand
    };
  }

  return {
    type: "macos-terminal",
    command: "osascript",
    args: [
      "-e",
      [
        'tell application "Terminal"',
        `  do script ${appleScriptString(buildTerminalHudCommand(hudCommand, options.parentPid))}`,
        "  activate",
        "end tell"
      ].join("\n")
    ],
    hudCommand
  };
}

function resolveHudLauncher(options) {
  const launcher = options.launcher ?? "auto";
  if (!["auto", "tmux", "terminal"].includes(launcher)) {
    throw new Error("--hud-launcher must be one of auto, tmux, terminal.");
  }

  if (launcher === "tmux") {
    return "tmux";
  }

  if (launcher === "terminal") {
    if (options.platform !== "darwin") {
      throw new Error("codex-shift tui --hud-launcher terminal is only supported on macOS.");
    }
    return "macos-terminal";
  }

  if (options.env?.TMUX) return "tmux";
  return "tmux";
}

function startHud(hud) {
  if (hud.type === "tmux") {
    return {
      type: "tmux",
      paneId: startTmuxHudPane(hud)
    };
  }

  startMacTerminalHud(hud);
  return {
    type: hud.type
  };
}

function startTmuxHudPane(hud) {
  const result = spawnSync(hud.command, hud.args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`Failed to start HUD pane.${detail ? `\n${detail}` : ""}`);
  }

  const paneId = result.stdout.trim().split(/\s+/)[0];
  if (!paneId) {
    throw new Error("Failed to start HUD pane: tmux did not return a pane id.");
  }
  return paneId;
}

function startMacTerminalHud(hud) {
  const result = spawnSync(hud.command, hud.args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`Failed to start HUD terminal.${detail ? `\n${detail}` : ""}`);
  }
}

function cleanupHud(handle) {
  if (handle?.type !== "tmux" || !handle.paneId) return;
  spawnSync("tmux", ["kill-pane", "-t", handle.paneId], {
    stdio: "ignore"
  });
}

async function getFreePort(host) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address !== "object") {
    throw new Error("Unable to allocate a local port.");
  }
  return address.port;
}

async function waitForWebSocket(host, port, child, log) {
  const started = Date.now();
  while (Date.now() - started < STARTUP_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(`Process exited before listening on ${host}:${port}.\n${log.text()}`);
    }
    if (await canOpenWebSocket(host, port)) return;
    await delay(100);
  }

  throw new Error(`Timed out waiting for ${host}:${port}.\n${log.text()}`);
}

function canOpenWebSocket(host, port) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${host}:${port}`);
    const timeout = setTimeout(() => {
      ws.close();
      resolve(false);
    }, 500);

    ws.addEventListener("open", () => {
      clearTimeout(timeout);
      ws.close();
      resolve(true);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

function captureChildOutput(child, label, trace) {
  const chunks = [];
  const capture = (stream, chunk) => {
    const text = String(chunk);
    chunks.push(text);
    if (chunks.join("").length > 4000) chunks.shift();
    if (trace) stream.write(`[codex-shift:${label}] ${text}`);
  };

  child.stdout?.on("data", (chunk) => capture(process.stderr, chunk));
  child.stderr?.on("data", (chunk) => capture(process.stderr, chunk));

  return {
    text: () => chunks.join("").trim()
  };
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      resolve({
        status: code ?? signalToExitCode(signal),
        signal
      });
    });
  });
}

function installSignalHandlers(cleanup) {
  const handlers = [];
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => {
      cleanup();
      process.exit(signalToExitCode(signal));
    };
    process.once(signal, handler);
    handlers.push([signal, handler]);
  }
  return handlers;
}

function uninstallSignalHandlers(handlers) {
  for (const [signal, handler] of handlers) {
    process.off(signal, handler);
  }
}

function signalToExitCode(signal) {
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  if (signal === "SIGHUP") return 129;
  return 1;
}

function shellQuote(parts) {
  return parts
    .map((part) => {
      if (/^[A-Za-z0-9_./:=@-]+$/.test(part)) return part;
      return `'${String(part).replaceAll("'", "'\\''")}'`;
    })
    .join(" ");
}

function appleScriptString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function buildTerminalHudCommand(hudCommand, parentPid) {
  const pid = Number(parentPid);
  const guardedPid = Number.isInteger(pid) && pid > 0 ? pid : process.pid;
  const hud = shellQuote([
    hudCommand.command,
    ...hudCommand.args,
    "--exit-when-parent",
    String(guardedPid)
  ]);
  return `${hud}; exit`;
}
