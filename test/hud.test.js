import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("../src/cli/index.js", import.meta.url));
const HUD_BIN_PATH = fileURLToPath(new URL("../src/cli/hud-bin.js", import.meta.url));

test("hud renders latest routed status", () => {
  const tmp = mkdtempSync(join(tmpdir(), "codex-shift-hud-"));
  const statusFile = join(tmp, "status.json");
  writeFileSync(
    statusFile,
    JSON.stringify({
      schemaVersion: 1,
      threadId: "019e-test-thread",
      requestId: 17,
      model: "gpt-5.5",
      effort: "high",
      requestedEffort: "high",
      classification: "complex",
      confidence: 0.82,
      mode: "default",
      readOnly: false,
      tokenUsage: {
        inputTokens: 100,
        cachedInputTokens: 80,
        totalInputTokens: 400,
        totalCachedInputTokens: 240,
        updatedAt: "2026-06-04T08:10:30.000Z"
      },
      updatedAt: "2026-06-04T08:10:00.000Z"
    })
  );

  try {
    const result = runCli(["hud", "--once", "--file", statusFile]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Codex Shift  gpt-5\.5  high/);
    assert.match(result.stdout, /complex/);
    assert.match(result.stdout, /input_tokens=100 cached_input_tokens=80/);
    assert.doesNotMatch(result.stdout, /thread=/);
    assert.doesNotMatch(result.stdout, /file=/);

    const verbose = runCli(["hud", "--once", "--verbose", "--file", statusFile]);
    assert.equal(verbose.status, 0, verbose.stderr);
    assert.match(verbose.stdout, /confidence=0\.82 thread=019e-test-thread request=17/);
    assert.match(verbose.stdout, /total_input_tokens=400 total_cached_input_tokens=240/);
    assert.match(verbose.stdout, new RegExp(`file=${escapeRegExp(statusFile)}`));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("codex-shift-hud bin renders hud mode", () => {
  const tmp = mkdtempSync(join(tmpdir(), "codex-shift-hud-bin-"));

  try {
    const result = spawnSync(process.execPath, [
      HUD_BIN_PATH,
      "--once",
      "--file",
      join(tmp, "missing.json")
    ], {
      encoding: "utf8",
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: process.env
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Codex Shift  waiting/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("hud only rerenders when the status file changes", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "codex-shift-hud-watch-"));
  const statusFile = join(tmp, "status.json");
  const child = spawn(process.execPath, [
    CLI_PATH,
    "hud",
    "--file",
    statusFile,
    "--interval",
    "50",
    "--no-clear"
  ], {
    encoding: "utf8",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitFor(() => countHudRenders(stdout) >= 1);
    assert.equal(countHudRenders(stdout), 1, stderr);
    assert.match(stdout, /Codex Shift  waiting/);

    writeFileSync(
      statusFile,
      JSON.stringify({
        schemaVersion: 1,
        threadId: "019e-test-thread",
        requestId: 18,
        model: "gpt-5.5",
        effort: "medium",
        requestedEffort: "medium",
        classification: "coding",
        confidence: 0.7,
        mode: "default",
        readOnly: false,
        updatedAt: "2026-06-04T08:11:00.000Z"
      })
    );

    await waitFor(() => countHudRenders(stdout) >= 2);
    assert.match(stdout, /Codex Shift  gpt-5\.5  medium/);
    assert.match(stdout, /coding/);
    assert.doesNotMatch(stdout, /request=18/);

    await delay(180);
    assert.equal(countHudRenders(stdout), 2, stdout);
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    rmSync(tmp, { recursive: true, force: true });
  }
});

function runCli(args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf8",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: process.env
  });
}

function countHudRenders(text) {
  return (text.match(/Codex Shift/g) ?? []).length;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitFor(predicate) {
  const started = Date.now();
  while (Date.now() - started < 1500) {
    if (predicate()) return;
    await delay(25);
  }
  assert.fail("timed out waiting for condition");
}

function waitForExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.once("exit", resolve);
  });
}
