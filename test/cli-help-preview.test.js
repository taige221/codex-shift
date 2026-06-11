import test from "node:test";
import assert from "node:assert/strict";
import {
  getHelpText,
  getProxyHelpText,
  getTuiHelpText
} from "../src/cli/help.js";
import {
  buildAppServerOptions,
  buildTransportPreview,
  printDecision,
  printPreview,
  shellQuote
} from "../src/cli/preview.js";

test("main help text preserves command summary and status file mention", () => {
  const text = getHelpText();

  assert.match(text, /^codex-router - choose model and reasoning effort/m);
  assert.match(text, /codex-router dry-run "fix this failing test"/);
  assert.match(text, /hud\s+Show the latest routed turn from/);
});

test("proxy help text preserves proxy usage", () => {
  const text = getProxyHelpText();

  assert.match(text, /^codex-shift proxy - route app-server turn\/start messages/m);
  assert.match(text, /--listen <url>/);
  assert.match(text, /--target <url>/);
});

test("tui help text preserves TUI usage and HUD options", () => {
  const text = getTuiHelpText();

  assert.match(text, /^codex-shift tui - start native Codex TUI through the routing proxy/m);
  assert.match(text, /--hud-verbose/);
  assert.match(text, /--\s+Pass remaining args to native Codex TUI/);
});

test("shellQuote preserves current quoting behavior", () => {
  assert.equal(
    shellQuote(["codex", "exec", "-m", "gpt-5.5", "fix bug"]),
    "codex exec -m gpt-5.5 'fix bug'"
  );
  assert.equal(
    shellQuote(["codex", "exec", "can't fail"]),
    "codex exec 'can'\\''t fail'"
  );
});

test("buildAppServerOptions preserves app-server option shape", () => {
  assert.deepEqual(
    buildAppServerOptions(
      {
        codexBin: "/tmp/codex",
        cwd: "/tmp/project",
        sock: "/tmp/codex.sock",
        summary: false,
        threadId: "thread-1"
      },
      "fix bug"
    ),
    {
      codexBin: "/tmp/codex",
      cwd: "/tmp/project",
      prompt: "fix bug",
      sock: "/tmp/codex.sock",
      summary: false,
      threadId: "thread-1"
    }
  );
});

test("buildTransportPreview omits prompt by default for exec transport", () => {
  const preview = buildTransportPreview(
    { model: "gpt-5.5", effort: "medium", readOnly: false },
    {
      codexArgs: ["--json"],
      codexBin: "codex",
      cwd: "/tmp/project",
      includePrompt: false,
      prompt: "fix bug"
    },
    "exec"
  );

  assert.deepEqual(preview.command.args, [
    "exec",
    "-m",
    "gpt-5.5",
    "-c",
    'model_reasoning_effort="medium"',
    "-C",
    "/tmp/project",
    "--json",
    "[prompt omitted]"
  ]);
});

test("buildTransportPreview includes prompt for app-server preview when requested", () => {
  const preview = buildTransportPreview(
    { model: "gpt-5.5", effort: "high", readOnly: false },
    {
      codexBin: "/tmp/codex",
      includePrompt: true,
      prompt: "review this PR",
      summary: "concise",
      threadId: "thread-1"
    },
    "app-server"
  );

  assert.deepEqual(preview.proxy, {
    command: "/tmp/codex",
    args: ["app-server", "proxy"]
  });
  assert.equal(preview.request.params.input[0].text, "review this PR");
  assert.equal(preview.request.params.effort, "high");
});

test("printDecision and printPreview preserve current output lines", () => {
  const lines = [];
  const writer = (line) => lines.push(line);

  printDecision(
    {
      model: "gpt-5.5",
      effort: "medium",
      classification: "coding",
      confidence: 0.8,
      mode: "default",
      readOnly: false,
      reasons: ["classified as coding"]
    },
    { secondaryUsedPercent: 42 },
    writer
  );
  printPreview(
    {
      command: {
        command: "codex",
        args: ["exec", "-m", "gpt-5.5", "fix bug"]
      }
    },
    writer
  );

  assert.deepEqual(lines, [
    "model: gpt-5.5",
    "effort: medium",
    "classification: coding",
    "confidence: 0.8",
    "mode: default",
    "read_only: false",
    "reason: classified as coding",
    "weekly_usage: 42%",
    "command: codex exec -m gpt-5.5 'fix bug'"
  ]);
});
