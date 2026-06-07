import { watchFile, unwatchFile } from "node:fs";
import { DEFAULT_STATUS_FILE, readRouteStatus } from "./status.js";

const DEFAULT_INTERVAL_MS = 1000;

export async function runHudCli(args = process.argv.slice(2), io = process) {
  const options = parseHudArgs(args);
  if (options.help) {
    io.stdout.write(`${hudHelp()}\n`);
    return 0;
  }

  if (options.once) {
    io.stdout.write(renderHud(options));
    return 0;
  }

  io.stdout.write(renderHud(options, { clear: options.clear }));
  return new Promise((resolve) => {
    const file = options.file || DEFAULT_STATUS_FILE;
    const renderOnChange = (current, previous) => {
      if (!hasFileChanged(current, previous)) return;
      io.stdout.write(renderHud(options, { clear: options.clear }));
    };
    watchFile(file, { interval: options.intervalMs }, renderOnChange);

    const parentInterval = options.exitWhenParent
      ? setInterval(() => {
        if (isProcessAlive(options.exitWhenParent)) return;
        shutdown();
      }, options.intervalMs)
      : null;

    const shutdown = () => {
      unwatchFile(file, renderOnChange);
      if (parentInterval) clearInterval(parentInterval);
      io.stdout.write("\n");
      resolve(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

export function parseHudArgs(args) {
  const state = {
    clear: true,
    exitWhenParent: null,
    file: process.env.CODEX_SHIFT_STATUS_FILE || DEFAULT_STATUS_FILE,
    help: false,
    intervalMs: DEFAULT_INTERVAL_MS,
    json: false,
    once: false,
    verbose: false
  };

  while (args.length) {
    const arg = args.shift();
    if (arg === "-h" || arg === "--help") state.help = true;
    else if (arg === "--exit-when-parent") state.exitWhenParent = requirePositiveInteger(arg, args);
    else if (arg === "--file" || arg === "--status-file") state.file = requireValue(arg, args);
    else if (arg === "--interval") state.intervalMs = requirePositiveInteger(arg, args);
    else if (arg === "--once") state.once = true;
    else if (arg === "--json") state.json = true;
    else if (arg === "--no-clear") state.clear = false;
    else if (arg === "--verbose") state.verbose = true;
    else throw new Error(`Unknown hud option ${arg}.`);
  }

  return state;
}

export function renderHud(options = {}, renderOptions = {}) {
  const file = options.file || DEFAULT_STATUS_FILE;
  const snapshot = readHudSnapshot(file);
  if (options.json) {
    return `${JSON.stringify(snapshot, null, 2)}\n`;
  }

  const prefix = renderOptions.clear ? "\x1b[2J\x1b[H" : "";
  if (snapshot.error) {
    return [
      prefix,
      "Codex Shift  error",
      snapshot.error,
      ""
    ].join("\n");
  }

  if (!snapshot.status) {
    return [
      prefix,
      "Codex Shift  waiting",
      "no routed turn yet",
      ""
    ].join("\n");
  }

  return `${prefix}${formatStatus(snapshot.status, { file, verbose: options.verbose })}`;
}

export function formatStatus(status, options = {}) {
  const requested = status.requestedEffort && status.requestedEffort !== status.effort
    ? ` requested=${status.requestedEffort}`
    : "";
  const readOnly = status.readOnly ? " read-only" : "";
  const mode = status.mode && status.mode !== "default" ? ` ${status.mode}` : "";
  const lines = [
    `Codex Shift  ${status.model ?? "-"}  ${status.effort ?? "-"}${requested}`,
    `${status.classification ?? "-"}${mode}${readOnly}  ${formatRelativeTime(status.updatedAt)}`
  ];
  const tokenLine = formatTokenUsage(status.tokenUsage);
  if (tokenLine) lines.push(tokenLine);

  if (options.verbose) {
    lines.push(
      `confidence=${formatConfidence(status.confidence)} thread=${status.threadId ?? "-"} request=${status.requestId ?? "-"}`,
      formatTotalTokenUsage(status.tokenUsage),
      `file=${options.file ?? DEFAULT_STATUS_FILE}`
    );
  }

  lines.push("");
  return lines.join("\n");
}

export function hudHelp() {
  return `codex-shift-hud - show the latest routed Codex turn

Usage:
  codex-shift hud
  codex-shift hud --once
  codex-shift-hud --file /tmp/codex-shift-current.json

Options:
  --file <path>        Status JSON file to read; defaults to ${DEFAULT_STATUS_FILE}
  --status-file <path> Alias for --file
  --interval <ms>      File watch interval; defaults to ${DEFAULT_INTERVAL_MS}
  --exit-when-parent <pid> Exit when the parent process is gone
  --once               Render once and exit
  --json               Print raw status JSON
  --no-clear           Do not clear the terminal between refreshes
  --verbose            Show thread, request id, confidence, and status file
`;
}

function readHudSnapshot(file) {
  try {
    return {
      file,
      status: readRouteStatus(file)
    };
  } catch (error) {
    return {
      error: error.message,
      file,
      status: null
    };
  }
}

function requireValue(flag, args) {
  const value = args.shift();
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function requirePositiveInteger(flag, args) {
  const value = Number(requireValue(flag, args));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return value;
}

function formatConfidence(value) {
  if (typeof value !== "number") return "-";
  return value.toFixed(2);
}

function formatTokenUsage(tokenUsage) {
  if (!tokenUsage || typeof tokenUsage !== "object") return "";
  return `input_tokens=${formatTokenCount(tokenUsage.inputTokens)} cached_input_tokens=${formatTokenCount(tokenUsage.cachedInputTokens)}`;
}

function formatTotalTokenUsage(tokenUsage) {
  if (!tokenUsage || typeof tokenUsage !== "object") {
    return "total_input_tokens=- total_cached_input_tokens=-";
  }
  return `total_input_tokens=${formatTokenCount(tokenUsage.totalInputTokens)} total_cached_input_tokens=${formatTokenCount(tokenUsage.totalCachedInputTokens)}`;
}

function formatTokenCount(value) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "-";
}

function formatRelativeTime(value) {
  if (!value) return "not routed yet";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return String(value);
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleString();
}

function hasFileChanged(current, previous) {
  return current.mtimeMs !== previous.mtimeMs ||
    current.size !== previous.size ||
    current.ino !== previous.ino;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
