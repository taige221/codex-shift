import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SHIM_PATH = fileURLToPath(new URL("../src/cli/shim.js", import.meta.url));

test("shim routes codex exec prompts through codex-shift", () => {
  const fixture = createFakeCodex();

  try {
    const result = runShim(["exec", "--model", "gpt-lite", "-C", fixture.tmp, "fix bug"], fixture);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readArgs(fixture), [
      "exec",
      "-m",
      "gpt-lite",
      "-c",
      'model_reasoning_effort="medium"',
      "-C",
      fixture.tmp,
      "fix bug"
    ]);
  } finally {
    fixture.cleanup();
  }
});

test("shim routes and strips prompt effort directives for codex exec", () => {
  const fixture = createFakeCodex();

  try {
    const result = runShim(["exec", "/high 解释一下这个函数"], fixture);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readArgs(fixture), [
      "exec",
      "-m",
      "gpt-5.5",
      "-c",
      'model_reasoning_effort="high"',
      "解释一下这个函数"
    ]);
  } finally {
    fixture.cleanup();
  }
});

test("shim routes top-level initial prompts", () => {
  const fixture = createFakeCodex();

  try {
    const result = runShim(["review改修这个 PR"], fixture);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readArgs(fixture), [
      "-m",
      "gpt-5.5",
      "-c",
      'model_reasoning_effort="high"',
      "review改修这个 PR"
    ]);
  } finally {
    fixture.cleanup();
  }
});

test("shim routes and strips prompt effort directives for top-level prompts", () => {
  const fixture = createFakeCodex();

  try {
    const result = runShim(["/xhigh", "fix bug"], fixture);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readArgs(fixture), [
      "-m",
      "gpt-5.5",
      "-c",
      'model_reasoning_effort="xhigh"',
      "fix bug"
    ]);
  } finally {
    fixture.cleanup();
  }
});

test("shim forwards native codex commands unchanged", () => {
  const fixture = createFakeCodex();

  try {
    const result = runShim(["app-server", "proxy", "--sock", "/tmp/codex.sock"], fixture);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readArgs(fixture), ["app-server", "proxy", "--sock", "/tmp/codex.sock"]);
  } finally {
    fixture.cleanup();
  }
});

test("shim forwards codex exec subcommands unchanged", () => {
  const fixture = createFakeCodex();

  try {
    const result = runShim(["exec", "resume", "--last"], fixture);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readArgs(fixture), ["exec", "resume", "--last"]);
  } finally {
    fixture.cleanup();
  }
});

function createFakeCodex() {
  const tmp = mkdtempSync(join(tmpdir(), "codex-shift-shim-"));
  const fakeCodex = join(tmp, "codex-real");
  const argsPath = join(tmp, "args.json");

  writeFileSync(
    fakeCodex,
    [
      "#!/usr/bin/env node",
      "const { writeFileSync } = require('node:fs');",
      `writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));`
    ].join("\n")
  );
  chmodSync(fakeCodex, 0o755);

  return {
    argsPath,
    fakeCodex,
    tmp,
    cleanup: () => rmSync(tmp, { recursive: true, force: true })
  };
}

function runShim(args, fixture) {
  return spawnSync(process.execPath, [SHIM_PATH, ...args], {
    encoding: "utf8",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {
      ...process.env,
      CODEX_HOME: fixture.tmp,
      CODEX_SHIFT_NO_USAGE: "1",
      CODEX_SHIFT_REAL_CODEX: fixture.fakeCodex
    }
  });
}

function readArgs(fixture) {
  return JSON.parse(readFileSync(fixture.argsPath, "utf8"));
}
