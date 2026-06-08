import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(new URL("../src/cli/index.js", import.meta.url));

test("dry-run app-server previews turn/start without executing proxy", () => {
  const missingCodex = "/tmp/codex-shift-missing-codex";
  const result = runCli([
    "dry-run",
    "--transport",
    "app-server",
    "--thread",
    "019e-test-thread",
    "--codex-bin",
    missingCodex,
    "fix app-server proxy parsing"
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`proxy: ${escapeRegExp(missingCodex)} app-server proxy`));
  assert.match(result.stdout, /"method":"turn\/start"/);
  assert.match(result.stdout, /"text":"\[prompt omitted\]"/);
});

test("dry-run strips prompt effort directives from included previews", () => {
  const result = runCli([
    "dry-run",
    "--transport",
    "app-server",
    "--thread",
    "019e-test-thread",
    "--include-prompt",
    "/high 解释一下这个函数"
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /effort: high/);
  assert.match(result.stdout, /"text":"解释一下这个函数"/);
  assert.doesNotMatch(result.stdout, /"text":"\/high/);
});

test("dry-run supports tui-safe prompt effort directive aliases", () => {
  const result = runCli([
    "dry-run",
    "--include-prompt",
    "#high 解释一下这个函数"
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /effort: high/);
  assert.match(result.stdout, /'解释一下这个函数'/);
  assert.doesNotMatch(result.stdout, /'#high/);
});

test("dry-run app-server requires a thread id for exact request preview", () => {
  const result = runCli([
    "dry-run",
    "--transport",
    "app-server",
    "fix app-server proxy parsing"
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing --thread for app-server turn\/start/);
});

test("turn executes app-server proxy and sends the real prompt", () => {
  const tmp = mkdtempSync(join(tmpdir(), "codex-shift-cli-"));
  const fakeCodex = join(tmp, "codex");
  const requestPath = join(tmp, "request.jsonl");
  const argsPath = join(tmp, "args.txt");
  const prompt = "fix app-server proxy parsing";

  writeFileSync(
    fakeCodex,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" > ${shellQuote(argsPath)}`,
      `cat > ${shellQuote(requestPath)}`,
      "printf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"turnId\":\"turn-1\"}}'"
    ].join("\n")
  );
  chmodSync(fakeCodex, 0o755);

  try {
    const result = runCli([
      "turn",
      "--thread",
      "019e-test-thread",
      "--codex-bin",
      fakeCodex,
      prompt
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"text":"\[prompt omitted\]"/);
    assert.match(result.stdout, /"turnId":"turn-1"/);
    assert.equal(readFileSync(argsPath, "utf8").trim(), "app-server proxy");

    const request = JSON.parse(readFileSync(requestPath, "utf8").trim());
    assert.equal(request.method, "turn/start");
    assert.equal(request.params.threadId, "019e-test-thread");
    assert.equal(request.params.effort, "high");
    assert.equal(request.params.summary, "concise");
    assert.equal(request.params.input[0].text, prompt);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("turn strips prompt effort directives before sending app-server input", () => {
  const tmp = mkdtempSync(join(tmpdir(), "codex-shift-cli-directive-"));
  const fakeCodex = join(tmp, "codex");
  const requestPath = join(tmp, "request.jsonl");

  writeFileSync(
    fakeCodex,
    [
      "#!/bin/sh",
      `cat > ${shellQuote(requestPath)}`,
      "printf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"turnId\":\"turn-1\"}}'"
    ].join("\n")
  );
  chmodSync(fakeCodex, 0o755);

  try {
    const result = runCli([
      "turn",
      "--thread",
      "019e-test-thread",
      "--codex-bin",
      fakeCodex,
      "/xhigh fix bug"
    ]);

    assert.equal(result.status, 0, result.stderr);
    const request = JSON.parse(readFileSync(requestPath, "utf8").trim());
    assert.equal(request.params.effort, "xhigh");
    assert.equal(request.params.input[0].text, "fix bug");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("dry-run app-server can override or omit summary", () => {
  const withDetailed = runCli([
    "dry-run",
    "--transport",
    "app-server",
    "--thread",
    "019e-test-thread",
    "--summary",
    "detailed",
    "fix app-server proxy parsing"
  ]);
  assert.equal(withDetailed.status, 0, withDetailed.stderr);
  assert.match(withDetailed.stdout, /"summary":"detailed"/);

  const withoutSummary = runCli([
    "dry-run",
    "--transport",
    "app-server",
    "--thread",
    "019e-test-thread",
    "--no-summary",
    "fix app-server proxy parsing"
  ]);
  assert.equal(withoutSummary.status, 0, withoutSummary.stderr);
  assert.doesNotMatch(withoutSummary.stdout, /"summary":/);
});

function runCli(args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args, "--no-usage"], {
    encoding: "utf8",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: process.env
  });
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
