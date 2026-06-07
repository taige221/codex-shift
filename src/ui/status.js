import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

export const DEFAULT_STATUS_FILE = process.platform === "win32"
  ? join(tmpdir(), "codex-shift-current.json")
  : "/tmp/codex-shift-current.json";

export function buildRouteStatus(message, decision, options = {}) {
  const now = options.now ?? new Date();
  const params = message?.params ?? {};

  return {
    schemaVersion: 1,
    threadId: safeJsonScalar(params.threadId),
    requestId: safeJsonScalar(message?.id),
    model: decision.model,
    effort: decision.effort,
    requestedEffort: decision.requestedEffort,
    classification: decision.classification,
    confidence: decision.confidence,
    mode: decision.mode,
    readOnly: decision.readOnly,
    updatedAt: now.toISOString()
  };
}

export function buildTokenUsageStatus(message, options = {}) {
  const now = options.now ?? new Date();
  const params = message?.params ?? {};
  const tokenUsage = params.tokenUsage ?? {};
  const last = tokenUsage.last ?? {};
  const total = tokenUsage.total ?? {};
  const status = {
    schemaVersion: 1,
    tokenUsage: {
      turnId: safeJsonScalar(params.turnId),
      inputTokens: safeNumber(last.inputTokens),
      cachedInputTokens: safeNumber(last.cachedInputTokens),
      totalInputTokens: safeNumber(total.inputTokens),
      totalCachedInputTokens: safeNumber(total.cachedInputTokens),
      modelContextWindow: safeNumber(tokenUsage.modelContextWindow),
      updatedAt: now.toISOString()
    }
  };

  const threadId = safeJsonScalar(params.threadId);
  if (threadId !== null) status.threadId = threadId;
  return status;
}

export function resolveStatusFile(value) {
  if (value === false || value === null) return null;
  return value || process.env.CODEX_SHIFT_STATUS_FILE || DEFAULT_STATUS_FILE;
}

export function writeRouteStatus(filePath, status) {
  if (!filePath) return null;

  const directory = dirname(filePath);
  mkdirSync(directory, { recursive: true });

  const tempPath = join(
    directory,
    `.${basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  writeFileSync(tempPath, `${JSON.stringify(status, null, 2)}\n`, {
    mode: 0o600
  });
  renameSync(tempPath, filePath);
  return status;
}

export function updateRouteStatus(filePath, patch) {
  if (!filePath) return null;
  const current = readRouteStatus(filePath) ?? { schemaVersion: 1 };
  return writeRouteStatus(filePath, {
    ...current,
    ...patch,
    schemaVersion: current.schemaVersion ?? patch.schemaVersion ?? 1
  });
}

export function readRouteStatus(filePath = DEFAULT_STATUS_FILE) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function safeJsonScalar(value) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

function safeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
