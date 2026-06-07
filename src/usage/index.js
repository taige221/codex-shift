import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export function readCodexUsage(codexHome = join(homedir(), ".codex")) {
  const sessionsDir = join(codexHome, "sessions");
  if (!existsSync(sessionsDir)) return null;

  const files = collectJsonlFiles(sessionsDir)
    .map((file) => ({ file, mtimeMs: statSync(file).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 40)
    .map((entry) => entry.file);

  let latest = null;
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const line of content.split("\n")) {
      if (!line.includes('"token_count"')) continue;
      const event = parseJsonLine(line);
      const payload = event?.payload;
      if (payload?.type !== "token_count") continue;
      if (!event.timestamp) continue;
      if (!latest || event.timestamp > latest.timestamp) {
        latest = {
          timestamp: event.timestamp,
          primaryUsedPercent: payload.rate_limits?.primary?.used_percent ?? null,
          secondaryUsedPercent: payload.rate_limits?.secondary?.used_percent ?? null,
          secondaryResetsAt: payload.rate_limits?.secondary?.resets_at ?? null
        };
      }
    }
  }

  return latest;
}

function collectJsonlFiles(dir, depth = 0) {
  if (depth > 5) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsonlFiles(path, depth + 1));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(path);
    }
  }
  return files;
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
