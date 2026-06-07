import { accessSync, constants, existsSync, realpathSync } from "node:fs";
import { delimiter, resolve } from "node:path";

export const DEFAULT_APP_CODEX = "/Applications/Codex.app/Contents/Resources/codex";

export function resolveRealCodex(options = {}) {
  const explicit =
    options.codexBin ??
    process.env.CODEX_SHIFT_REAL_CODEX ??
    process.env.CODEX_REAL_BIN ??
    process.env.CODEX_BIN;

  if (explicit && explicit !== "codex") {
    return explicit;
  }

  if (isExecutable(DEFAULT_APP_CODEX)) {
    return DEFAULT_APP_CODEX;
  }

  return findCodexOnPath(options.shimPath) ?? "codex";
}

function findCodexOnPath(shimPath) {
  const pathEntries = String(process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean);
  const shimRealPath = maybeRealpath(shimPath);

  for (const entry of pathEntries) {
    const candidate = resolve(entry, "codex");
    if (!isExecutable(candidate)) continue;
    if (maybeRealpath(candidate) === shimRealPath) continue;
    return candidate;
  }

  return null;
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function maybeRealpath(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}
