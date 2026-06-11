import test from "node:test";
import assert from "node:assert/strict";
import {
  parseArgs,
  parseProxyArgs,
  parseTuiArgs,
  resolveTransport
} from "../src/cli/args.js";

test("parseArgs preserves main defaults and command parsing", () => {
  const parsed = parseArgs(["dry-run", "--json", "fix", "bug"], {
    CODEX_BIN: "codex-from-env",
    CODEX_HOME: "/tmp/codex-home"
  });

  assert.equal(parsed.command, "dry-run");
  assert.equal(parsed.json, true);
  assert.equal(parsed.codexBin, "codex-from-env");
  assert.equal(parsed.codexHome, "/tmp/codex-home");
  assert.equal(parsed.prompt, "fix bug");
});

test("parseArgs preserves codex arg passthrough after separator", () => {
  const parsed = parseArgs([
    "exec",
    "--cwd",
    "/tmp/project",
    "fix bug",
    "--",
    "--json",
    "--color",
    "never"
  ]);

  assert.equal(parsed.cwd, "/tmp/project");
  assert.equal(parsed.prompt, "fix bug");
  assert.deepEqual(parsed.codexArgs, ["--json", "--color", "never"]);
});

test("parseArgs keeps required value error messages", () => {
  assert.throws(
    () => parseArgs(["dry-run", "--model"]),
    /Missing value for --model/
  );
  assert.throws(
    () => parseArgs(["dry-run", "--transport", "bad", "fix bug"]),
    /Invalid transport bad\. Expected exec or app-server\./
  );
  assert.throws(
    () => parseArgs(["dry-run"]),
    /Missing prompt\. Run codex-router --help for usage\./
  );
});

test("parseArgs allows help without prompt", () => {
  const parsed = parseArgs(["--help"]);

  assert.equal(parsed.help, true);
  assert.equal(parsed.prompt, "");
});

test("resolveTransport preserves turn and explicit transport behavior", () => {
  assert.equal(resolveTransport({ command: "turn", transport: "exec" }), "app-server");
  assert.equal(resolveTransport({ command: "dry-run", transport: "app-server" }), "app-server");
  assert.equal(resolveTransport({ command: "exec", transport: null }), "exec");
});

test("parseProxyArgs preserves proxy defaults and required target", () => {
  const parsed = parseProxyArgs([
    "--target",
    "ws://127.0.0.1:17890",
    "--cwd-filter",
    "/tmp/project",
    "--no-status",
    "--trace"
  ], {
    CODEX_HOME: "/tmp/codex-home"
  });

  assert.equal(parsed.codexHome, "/tmp/codex-home");
  assert.equal(parsed.listen, "ws://127.0.0.1:0");
  assert.equal(parsed.target, "ws://127.0.0.1:17890");
  assert.equal(parsed.cwdFilter, "/tmp/project");
  assert.equal(parsed.statusFile, null);
  assert.equal(parsed.trace, true);

  assert.throws(
    () => parseProxyArgs([]),
    /Missing --target for proxy\./
  );
});

test("parseProxyArgs allows help without target", () => {
  const parsed = parseProxyArgs(["--help"]);

  assert.equal(parsed.help, true);
  assert.equal(parsed.target, null);
});

test("parseTuiArgs preserves TUI options and native passthrough", () => {
  const parsed = parseTuiArgs([
    "--hud-verbose",
    "--hud-height",
    "12",
    "--hud-launcher",
    "terminal",
    "--real-port",
    "18000",
    "--proxy-port",
    "18001",
    "--",
    "--no-alt-screen",
    "-C",
    "/tmp/project"
  ], {
    CODEX_BIN: "/tmp/codex",
    CODEX_HOME: "/tmp/codex-home"
  });

  assert.equal(parsed.codexBin, "/tmp/codex");
  assert.equal(parsed.codexHome, "/tmp/codex-home");
  assert.equal(parsed.hud, true);
  assert.equal(parsed.hudVerbose, true);
  assert.equal(parsed.hudHeight, 12);
  assert.equal(parsed.hudLauncher, "terminal");
  assert.equal(parsed.realPort, 18000);
  assert.equal(parsed.proxyPort, 18001);
  assert.deepEqual(parsed.codexArgs, ["--no-alt-screen", "-C", "/tmp/project"]);
});

test("parseTuiArgs keeps numeric and launcher validation messages", () => {
  assert.throws(
    () => parseTuiArgs(["--hud-height", "zero"]),
    /--hud-height must be a positive integer\./
  );
  assert.throws(
    () => parseTuiArgs(["--hud-launcher", "bad"]),
    /--hud-launcher must be one of auto, tmux, terminal\./
  );
});
