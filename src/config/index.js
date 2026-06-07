import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export function loadConfig(explicitPath) {
  const candidates = [
    explicitPath,
    join(process.cwd(), ".codex-model-router.json"),
    join(homedir(), ".codex-model-router.json")
  ].filter(Boolean);

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const raw = readFileSync(path, "utf8");
    try {
      return { path, config: JSON.parse(raw) };
    } catch (error) {
      throw new Error(`Failed to parse config at ${path}: ${error.message}`);
    }
  }

  return { path: null, config: {} };
}
