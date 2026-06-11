import { buildRouteStatus, buildTokenUsageStatus, updateRouteStatus, writeRouteStatus } from "../ui/status.js";
import { trace } from "./trace.js";

export function writeStatusForTurn(message, decision, options = {}) {
  const statusFile = resolveProxyStatusFile(options);
  if (!statusFile) return;

  try {
    writeRouteStatus(statusFile, buildRouteStatus(message, decision));
  } catch (error) {
    trace(options, `status write failed: ${error.message}`);
  }
}

export function writeStatusForServerPayload(payload, options = {}) {
  const statusFile = resolveProxyStatusFile(options);
  if (!statusFile) return;

  let parsed;
  try {
    parsed = JSON.parse(String(payload));
  } catch {
    return;
  }

  const messages = Array.isArray(parsed) ? parsed : [parsed];
  for (const message of messages) {
    writeStatusForServerMessage(message, statusFile, options);
  }
}

export function resolveProxyStatusFile(options = {}) {
  return options.statusFile === null || options.statusFile === false
    ? null
    : options.statusFile ?? process.env.CODEX_SHIFT_STATUS_FILE;
}

function writeStatusForServerMessage(message, statusFile, options) {
  if (!isTokenUsageNotification(message)) return;

  try {
    updateRouteStatus(statusFile, buildTokenUsageStatus(message));
  } catch (error) {
    trace(options, `token usage status write failed: ${error.message}`);
  }
}

function isTokenUsageNotification(message) {
  return Boolean(
    message &&
    typeof message === "object" &&
    message.method === "thread/tokenUsage/updated" &&
    message.params &&
    typeof message.params === "object"
  );
}
