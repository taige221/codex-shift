# CLI Phase 1 Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the CLI entrypoint into low-risk help/preview, args, and command modules while preserving current command behavior.

**Architecture:** Keep `src/cli/index.js` as the executable wrapper, then extract pure or near-pure helpers in three phases. Phase 1A moves help and preview code, Phase 1B moves argument parsing and transport resolution, and Phase 1C moves command orchestration behind `runMainCommand()`.

**Tech Stack:** Node.js ESM, built-in `node:test`, `node:assert/strict`, existing zero-dependency project structure.

---

## File Structure

- Create: `src/cli/help.js`
  - Owns help text construction and printing for main, proxy, and TUI commands.
  - Imports `DEFAULT_STATUS_FILE` from `src/ui/status.js`.
- Create: `src/cli/preview.js`
  - Owns transport preview construction, app-server option construction, decision printing, preview printing, and shell quoting.
  - Imports command builders from `src/codex/index.js` and `src/transports/app-server.js`.
- Create: `src/cli/args.js`
  - Owns main/proxy/TUI argument parsing, value validation, launcher validation, and transport resolution.
  - Imports `resolveStatusFile` from `src/ui/status.js`.
- Create: `src/cli/commands.js`
  - Owns `runMainCommand()` and `runProxyCli()` after args/help/preview helpers have been extracted.
  - Coordinates router, config, usage, transports, TUI, HUD, and proxy execution.
- Modify: `src/cli/index.js`
  - Phase 1A: import help/preview helpers.
  - Phase 1B: import args helpers.
  - Phase 1C: reduce to shebang, top-level try/catch, exit handling, and `runMainCommand()` call.
- Create: `test/cli-help-preview.test.js`
  - Covers extracted help and preview behavior.
- Create: `test/cli-args.test.js`
  - Covers extracted parser behavior and error messages.
- Modify: `test/cli.test.js`
  - Add final subprocess checks for help and dry-run acceptance only if coverage is missing after new focused tests.

## Task 0: Baseline

**Files:**
- Read: `src/cli/index.js`
- Read: `test/cli.test.js`
- Read: `test/tui.test.js`
- Read: `test/shim.test.js`

- [ ] **Step 1: Confirm the working tree is clean**

Run:

```bash
rtk git status --short
```

Expected: no output.

- [ ] **Step 2: Capture the current test baseline**

Run:

```bash
rtk npm test
```

Expected: PASS with the current full test suite.

- [ ] **Step 3: Capture the current help output manually**

Run:

```bash
node src/cli/index.js --help
```

Expected: exit code `0`, stdout starts with:

```text
codex-router - choose model and reasoning effort before calling Codex CLI
```

- [ ] **Step 4: Capture the current dry-run output manually**

Run:

```bash
node src/cli/index.js dry-run "fix this failing test" --no-usage
```

Expected: exit code `0`, stdout includes:

```text
model: gpt-5.5
effort: medium
classification: coding
command: codex exec -m gpt-5.5 -c 'model_reasoning_effort="medium"' '[prompt omitted]'
```

## Task 1A: Extract CLI Help and Preview

**Files:**
- Create: `src/cli/help.js`
- Create: `src/cli/preview.js`
- Create: `test/cli-help-preview.test.js`
- Modify: `src/cli/index.js`

- [ ] **Step 1: Add tests for help and preview helpers**

Create `test/cli-help-preview.test.js` with:

```js
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
```

- [ ] **Step 2: Run the new tests and confirm they fail before extraction**

Run:

```bash
node --test test/cli-help-preview.test.js
```

Expected: FAIL with module-not-found errors for `src/cli/help.js` or `src/cli/preview.js`.

- [ ] **Step 3: Create `src/cli/help.js`**

Move the current `printHelp`, `printProxyHelp`, and `printTuiHelp` text from
`src/cli/index.js` into this file. Use this exported shape:

```js
import { DEFAULT_STATUS_FILE } from "../ui/status.js";

export function getHelpText() {
  return `codex-router - choose model and reasoning effort before calling Codex CLI

Usage:
  codex-router route "explain this function"
  codex-router dry-run "fix this failing test"
  codex-router exec "review改修这个 PR"
  codex-router turn --thread <thread-id> "fix this failing test"
  codex-shift tui
  codex-shift hud
  codex-shift proxy --listen ws://127.0.0.1:17891 --target ws://127.0.0.1:17890

Commands:
  route      Print the routing decision and Codex command, then exit
  dry-run    Same as route; preview only, never starts Codex
  exec       Run the selected transport with the routed model and effort (default)
  turn       Start an app-server turn/start request; always uses app-server
  tui        Start real Codex TUI through a local routing proxy
  proxy      Run the app-server WebSocket routing proxy
  hud        Show the latest routed turn from ${DEFAULT_STATUS_FILE}

Options:
  --model <name>        Override model
  --effort <level>      Override reasoning effort
  --cwd <dir>           Working directory passed to codex exec -C
  --config <file>       JSON config path
  --codex-bin <path>    Codex executable path
  --codex-home <dir>    Codex home for local usage reads
  --transport <name>    Select exec or app-server for route/dry-run/exec
  --thread <id>         App-server thread id; required for app-server preview/turn
  --sock <path>         App-server Unix socket for codex app-server proxy
  --summary <mode>      App-server summary mode; defaults to concise
  --no-summary          Omit app-server summary from turn/start params
  --include-prompt      Include the full prompt in previews; real runs always send it
  --no-usage            Do not read local Codex weekly usage
  --json                Print decision as JSON
  --                    Pass the rest through to codex exec

Behavior:
  route/dry-run never execute Codex. With --transport app-server they build the exact
  turn/start JSON-RPC request, so --thread is required.
  turn starts a new app-server turn on the given thread and forwards proxy stdout/stderr.
  A leading /low, /medium, /high, or /xhigh prompt directive forces effort for
  shell routes and is stripped before dispatch. In native TUI, use #low,
  #medium, #high, or #xhigh because / is reserved for Codex commands; the proxy
  keeps TUI input unchanged so the message is not duplicated. --effort still
  takes precedence.
`;
}

export function getProxyHelpText() {
  return `codex-shift proxy - route app-server turn/start messages

Usage:
  codex-shift proxy --listen ws://127.0.0.1:17891 --target ws://127.0.0.1:17890

Options:
  --listen <url>      Local ws:// URL for clients to connect to
  --target <url>      Real app-server ws:// URL to forward to
  --config <file>     JSON router config path
  --codex-home <dir>  Codex home for local usage reads
  --cwd-filter <dir>  Inject cwd into thread/list requests when absent
  --status-file <path> Write latest routed turn status; defaults to ${DEFAULT_STATUS_FILE}
  --no-status         Do not write a HUD status file
  --summary <mode>    Summary mode injected into turn/start; defaults to concise
  --no-summary        Do not inject summary
  --no-usage          Do not read local Codex weekly usage
  --trace             Print model/effort decisions without prompt text
`;
}

export function getTuiHelpText() {
  return `codex-shift tui - start native Codex TUI through the routing proxy

Usage:
  codex-shift tui
  codex-shift tui -- --no-alt-screen -C /path/to/project

Options:
  --codex-bin <path>   Real Codex executable path
  --host <host>        Local bind host; defaults to 127.0.0.1
  --hud                Open a HUD showing the latest routed turn
  --hud-verbose        Open the HUD in verbose mode
  --hud-launcher <mode> HUD launcher: auto, tmux, terminal; defaults to auto
  --hud-height <lines> HUD pane height for tmux; defaults to 8
  --real-port <port>   Port for real codex app-server; defaults to a free port
  --proxy-port <port>  Port for codex-shift proxy; defaults to a free port
  --config <file>      JSON router config path
  --codex-home <dir>   Codex home for local usage reads
  --cwd-filter <dir>   Internal: cwd filter passed through HUD tmux relaunch
  --status-file <path> Write latest routed turn status; defaults to ${DEFAULT_STATUS_FILE}
  --no-status          Do not write a HUD status file
  --summary <mode>     Summary mode injected into turn/start; defaults to concise
  --no-summary         Do not inject summary
  --no-usage           Do not read local Codex weekly usage
  --trace              Print model/effort decisions without prompt text
  --                   Pass remaining args to native Codex TUI

Behavior:
  --hud uses tmux by default. Inside tmux it opens a split pane; outside tmux it
  starts a temporary tmux session in the current terminal. Use --hud-launcher
  terminal to explicitly open a macOS Terminal.app HUD window.
`;
}

export function printHelp(writer = console.log) {
  writer(getHelpText());
}

export function printProxyHelp(writer = console.log) {
  writer(getProxyHelpText());
}

export function printTuiHelp(writer = console.log) {
  writer(getTuiHelpText());
}
```

- [ ] **Step 4: Create `src/cli/preview.js`**

Move the current preview and printing helpers from `src/cli/index.js` into this
file. Use this exported shape:

```js
import { buildCodexCommand } from "../codex/index.js";
import {
  buildAppServerProxyCommand,
  buildTurnStartRequest
} from "../transports/app-server.js";

export const OMITTED_PROMPT = "[prompt omitted]";

export function buildTransportPreview(decision, parsed, transport) {
  const prompt = parsed.includePrompt ? parsed.prompt : OMITTED_PROMPT;
  if (transport === "app-server") {
    const options = buildAppServerOptions(parsed, prompt);
    return {
      proxy: buildAppServerProxyCommand(options),
      request: buildTurnStartRequest(decision, options)
    };
  }

  return {
    command: buildCodexCommand(decision, {
      codexBin: parsed.codexBin,
      cwd: parsed.cwd,
      codexArgs: parsed.codexArgs,
      prompt
    })
  };
}

export function buildAppServerOptions(parsed, prompt) {
  return {
    codexBin: parsed.codexBin,
    cwd: parsed.cwd,
    prompt,
    sock: parsed.sock,
    summary: parsed.summary,
    threadId: parsed.threadId
  };
}

export function printDecision(decision, usage, writer = console.log) {
  writer(`model: ${decision.model}`);
  writer(`effort: ${decision.effort}`);
  writer(`classification: ${decision.classification}`);
  writer(`confidence: ${decision.confidence}`);
  writer(`mode: ${decision.mode}`);
  writer(`read_only: ${decision.readOnly}`);
  writer(`reason: ${decision.reasons.join("; ")}`);
  if (usage?.secondaryUsedPercent !== null && usage?.secondaryUsedPercent !== undefined) {
    writer(`weekly_usage: ${usage.secondaryUsedPercent}%`);
  }
}

export function printPreview(preview, writer = console.log) {
  if (preview.command) {
    writer(`command: ${shellQuote([preview.command.command, ...preview.command.args])}`);
    return;
  }

  if (preview.proxy) {
    writer(`proxy: ${shellQuote([preview.proxy.command, ...preview.proxy.args])}`);
  }
  if (preview.request) {
    writer(`request: ${JSON.stringify(preview.request)}`);
  }
}

export function shellQuote(parts) {
  return parts
    .map((part) => {
      if (/^[A-Za-z0-9_./:=@-]+$/.test(part)) return part;
      return `'${String(part).replaceAll("'", "'\\''")}'`;
    })
    .join(" ");
}
```

- [ ] **Step 5: Modify `src/cli/index.js` to import extracted helpers**

At the top of `src/cli/index.js`, add:

```js
import { printHelp, printProxyHelp, printTuiHelp } from "./help.js";
import {
  buildAppServerOptions,
  buildTransportPreview,
  printDecision,
  printPreview
} from "./preview.js";
```

Remove the local `OMITTED_PROMPT`, `buildTransportPreview`,
`buildAppServerOptions`, `printDecision`, `printPreview`, `printHelp`,
`printProxyHelp`, `printTuiHelp`, and `shellQuote` definitions from
`src/cli/index.js`. Keep `parseArgs`, `parseProxyArgs`, `parseTuiArgs`,
`resolveTransport`, and command orchestration in `src/cli/index.js` for this
phase.

- [ ] **Step 6: Run focused tests for Phase 1A**

Run:

```bash
node --test test/cli-help-preview.test.js test/cli.test.js
```

Expected: PASS.

- [ ] **Step 7: Run the full suite and manual acceptance**

Run:

```bash
rtk npm test
node src/cli/index.js --help
node src/cli/index.js dry-run "fix this failing test" --no-usage
```

Expected:

- `npm test` passes.
- `--help` exits `0` and prints the main help.
- `dry-run` exits `0` and includes `effort: medium`, `classification: coding`,
  and a command preview with `[prompt omitted]`.

- [ ] **Step 8: Commit Phase 1A**

Run:

```bash
rtk git add src/cli/index.js src/cli/help.js src/cli/preview.js test/cli-help-preview.test.js
rtk git commit -m "refactor(cli): extract help and preview helpers"
```

Expected: one commit containing only Phase 1A files.

## Task 1B: Extract CLI Args

**Files:**
- Create: `src/cli/args.js`
- Create: `test/cli-args.test.js`
- Modify: `src/cli/index.js`

- [ ] **Step 1: Add tests for parser behavior and exact error messages**

Create `test/cli-args.test.js` with:

```js
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
```

- [ ] **Step 2: Run the new tests and confirm they fail before extraction**

Run:

```bash
node --test test/cli-args.test.js
```

Expected: FAIL with module-not-found error for `src/cli/args.js`.

- [ ] **Step 3: Create `src/cli/args.js`**

Move parsing helpers from `src/cli/index.js` into `src/cli/args.js`. Use this
module shape and preserve the existing default values and error messages:

```js
import { resolveStatusFile } from "../ui/status.js";

const VALID_COMMANDS = new Set(["route", "dry-run", "exec", "turn"]);
const VALID_TRANSPORTS = new Set(["exec", "app-server"]);

export function parseArgs(inputArgs, env = process.env) {
  const args = [...inputArgs];
  const state = {
    command: "exec",
    promptParts: [],
    codexArgs: [],
    codexBin: env.CODEX_BIN ?? "codex",
    codexHome: env.CODEX_HOME,
    configPath: null,
    cwd: null,
    effort: null,
    help: false,
    includePrompt: false,
    json: false,
    model: null,
    noUsage: false,
    sock: null,
    summary: undefined,
    threadId: null,
    transport: null
  };

  if (VALID_COMMANDS.has(args[0])) {
    state.command = args.shift();
  }

  while (args.length) {
    const arg = args.shift();
    if (arg === "--") {
      state.codexArgs.push(...args);
      break;
    }
    if (arg === "-h" || arg === "--help") state.help = true;
    else if (arg === "--json") state.json = true;
    else if (arg === "--include-prompt") state.includePrompt = true;
    else if (arg === "--no-usage") state.noUsage = true;
    else if (arg === "--model") state.model = requireValue(arg, args);
    else if (arg === "--effort") state.effort = requireValue(arg, args);
    else if (arg === "--cwd") state.cwd = requireValue(arg, args);
    else if (arg === "--config") state.configPath = requireValue(arg, args);
    else if (arg === "--codex-bin") state.codexBin = requireValue(arg, args);
    else if (arg === "--codex-home") state.codexHome = requireValue(arg, args);
    else if (arg === "--sock") state.sock = requireValue(arg, args);
    else if (arg === "--summary") state.summary = requireValue(arg, args);
    else if (arg === "--no-summary") state.summary = false;
    else if (arg === "--thread") state.threadId = requireValue(arg, args);
    else if (arg === "--transport") state.transport = requireTransport(requireValue(arg, args));
    else state.promptParts.push(arg);
  }

  state.prompt = state.promptParts.join(" ").trim();
  if (!state.prompt && !state.help) {
    throw new Error("Missing prompt. Run codex-router --help for usage.");
  }

  return state;
}
```

In the same file, move `parseProxyArgs`, `parseTuiArgs`, `requireValue`,
`requireTransport`, `requirePositiveInteger`, `requireHudLauncher`, and
`resolveTransport`. Use `env.CODEX_HOME` and `env.CODEX_BIN` where the current
code reads from `process.env`. Keep `resolveStatusFile()` as the default status
file resolver.

- [ ] **Step 4: Modify `src/cli/index.js` to import args helpers**

At the top of `src/cli/index.js`, add:

```js
import {
  parseArgs,
  parseProxyArgs,
  parseTuiArgs,
  resolveTransport
} from "./args.js";
```

Remove local definitions for:

```text
VALID_COMMANDS
VALID_TRANSPORTS
parseArgs
parseProxyArgs
parseTuiArgs
requireValue
requireTransport
requirePositiveInteger
requireHudLauncher
resolveTransport
```

Keep `main()` and `runProxyCli()` in `src/cli/index.js` for this phase.

- [ ] **Step 5: Run focused tests for Phase 1B**

Run:

```bash
node --test test/cli-args.test.js test/cli-help-preview.test.js test/cli.test.js test/tui.test.js
```

Expected: PASS.

- [ ] **Step 6: Run the full suite and manual acceptance**

Run:

```bash
rtk npm test
node src/cli/index.js --help
node src/cli/index.js dry-run "fix this failing test" --no-usage
node src/cli/index.js proxy --help
node src/cli/index.js tui --help
```

Expected:

- `npm test` passes.
- All help commands exit `0`.
- `dry-run` exits `0` and preserves the Phase 1A output shape.

- [ ] **Step 7: Commit Phase 1B**

Run:

```bash
rtk git add src/cli/index.js src/cli/args.js test/cli-args.test.js
rtk git commit -m "refactor(cli): extract argument parsing"
```

Expected: one commit containing only Phase 1B files.

## Task 1C: Extract CLI Commands

**Files:**
- Create: `src/cli/commands.js`
- Modify: `src/cli/index.js`
- Modify: `test/cli.test.js` only if final wrapper behavior needs additional subprocess coverage.

- [ ] **Step 1: Add final subprocess checks if missing**

If `test/cli.test.js` does not already cover these paths after Phase 1A and
Phase 1B, add:

```js
test("main help exits successfully through CLI wrapper", () => {
  const result = runCli(["--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^codex-router - choose model and reasoning effort/m);
});

test("dry-run exec still routes through CLI wrapper", () => {
  const result = runCli(["dry-run", "fix this failing test"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /effort: medium/);
  assert.match(result.stdout, /classification: coding/);
  assert.match(result.stdout, /command: codex exec/);
});
```

Run:

```bash
node --test test/cli.test.js
```

Expected: PASS before moving orchestration. If the two checks already exist
from a previous phase, keep the file unchanged and continue.

- [ ] **Step 2: Create `src/cli/commands.js`**

Move the current `main()` body and `runProxyCli()` body from `src/cli/index.js`
into `src/cli/commands.js`. Export `runMainCommand()` and `runProxyCli()` using
this shape:

```js
import { basename } from "node:path";
import { routePrompt } from "../router/index.js";
import { parsePromptEffortDirective } from "../router/directives.js";
import { loadConfig } from "../config/index.js";
import { readCodexUsage } from "../usage/index.js";
import { runCodex } from "../codex/index.js";
import { callTurnStart } from "../transports/app-server.js";
import { startRemoteProxy } from "../proxy/remote-proxy.js";
import { runTui } from "../ui/tui.js";
import { runHudCli } from "../ui/hud.js";
import {
  parseArgs,
  parseProxyArgs,
  parseTuiArgs,
  resolveTransport
} from "./args.js";
import { printHelp, printProxyHelp, printTuiHelp } from "./help.js";
import {
  buildAppServerOptions,
  buildTransportPreview,
  printDecision,
  printPreview
} from "./preview.js";

export async function runMainCommand(rawArgs = process.argv.slice(2), options = {}) {
  const entrypoint = options.entrypoint ?? process.argv[1];

  if (basename(entrypoint ?? "") === "codex-shift-hud") {
    return runHudCli(rawArgs);
  }

  if (rawArgs[0] === "proxy") {
    await runProxyCli(rawArgs.slice(1));
    return 0;
  }

  if (rawArgs[0] === "hud") {
    return runHudCli(rawArgs.slice(1));
  }

  if (rawArgs[0] === "tui") {
    const tuiOptions = parseTuiArgs(rawArgs.slice(1), options.env ?? process.env);
    if (tuiOptions.help) {
      printTuiHelp();
      return 0;
    }
    const result = await runTui(tuiOptions);
    return result.status ?? 0;
  }

  const parsed = parseArgs(rawArgs, options.env ?? process.env);

  if (parsed.help) {
    printHelp();
    return 0;
  }

  const { config } = loadConfig(parsed.configPath);
  const usage = parsed.noUsage ? null : readCodexUsage(parsed.codexHome);
  const promptDirective = parsePromptEffortDirective(parsed.prompt);
  const routedPrompt = promptDirective.prompt;
  const routedParsed = { ...parsed, prompt: routedPrompt };
  const decision = routePrompt(routedPrompt, {
    config,
    model: parsed.model,
    effort: parsed.effort,
    promptEffortDirective: promptDirective,
    usage
  });
  const transport = resolveTransport(parsed);
  const preview = buildTransportPreview(decision, routedParsed, transport);

  if (parsed.json) {
    console.log(JSON.stringify({ decision, usage, transport, ...preview }, null, 2));
  } else {
    printDecision(decision, usage);
    printPreview(preview);
  }

  if (parsed.command === "route" || parsed.command === "dry-run") {
    return 0;
  }

  if (transport === "app-server") {
    const result = callTurnStart(decision, buildAppServerOptions(routedParsed, routedPrompt));
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (typeof result.status === "number") {
      return result.status;
    }
    if (result.error) {
      console.error(result.error.message);
      return 1;
    }
    return 0;
  }

  const result = runCodex(decision, {
    codexBin: parsed.codexBin,
    cwd: parsed.cwd,
    codexArgs: parsed.codexArgs,
    prompt: routedPrompt
  });

  if (typeof result.status === "number") {
    return result.status;
  }
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return 0;
}

export async function runProxyCli(args) {
  const options = parseProxyArgs(args);
  if (options.help) {
    printProxyHelp();
    return;
  }

  const proxy = await startRemoteProxy(options);
  console.error(`[codex-shift] proxy listening on ${proxy.url} -> ${proxy.target}`);

  await new Promise((resolve) => {
    const shutdown = async () => {
      await proxy.close();
      resolve();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
```

- [ ] **Step 3: Reduce `src/cli/index.js` to the executable wrapper**

Replace `src/cli/index.js` with:

```js
#!/usr/bin/env node
import { runMainCommand } from "./commands.js";

try {
  const status = await runMainCommand(process.argv.slice(2), {
    entrypoint: process.argv[1],
    env: process.env
  });
  process.exit(status ?? 0);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(1);
}
```

- [ ] **Step 4: Run focused tests for Phase 1C**

Run:

```bash
node --test test/cli.test.js test/shim.test.js test/tui.test.js test/cli-args.test.js test/cli-help-preview.test.js
```

Expected: PASS.

- [ ] **Step 5: Run the full suite and manual acceptance**

Run:

```bash
rtk npm test
node src/cli/index.js --help
node src/cli/index.js dry-run "fix this failing test" --no-usage
node src/cli/index.js dry-run --transport app-server --thread 019e-test-thread "fix app-server proxy parsing" --no-usage
```

Expected:

- `npm test` passes.
- Main help exits `0`.
- Exec dry-run exits `0`, omits prompt text, and previews `codex exec`.
- App-server dry-run exits `0`, omits prompt text, and previews `turn/start`.

- [ ] **Step 6: Confirm entrypoint size and imports**

Run:

```bash
wc -l src/cli/index.js src/cli/commands.js src/cli/args.js src/cli/help.js src/cli/preview.js
```

Expected: `src/cli/index.js` is a small executable wrapper with only the
shebang, import, top-level try/catch, and exit handling.

- [ ] **Step 7: Commit Phase 1C**

Run:

```bash
rtk git add src/cli/index.js src/cli/commands.js test/cli.test.js
rtk git commit -m "refactor(cli): extract command orchestration"
```

Expected: one commit containing only Phase 1C files. If `test/cli.test.js` was
not modified in Step 1, omit it from `git add`.

## Final Phase 1 Verification

**Files:**
- Verify: `src/cli/index.js`
- Verify: `src/cli/help.js`
- Verify: `src/cli/preview.js`
- Verify: `src/cli/args.js`
- Verify: `src/cli/commands.js`
- Verify: `test/cli-help-preview.test.js`
- Verify: `test/cli-args.test.js`
- Verify: `test/cli.test.js`

- [ ] **Step 1: Run full tests**

Run:

```bash
rtk npm test
```

Expected: PASS.

- [ ] **Step 2: Run manual acceptance commands requested by the user**

Run:

```bash
node src/cli/index.js --help
node src/cli/index.js dry-run "fix this failing test" --no-usage
```

Expected: both commands exit `0`; dry-run output includes a routing decision
and command preview.

- [ ] **Step 3: Run whitespace diff check**

Run:

```bash
rtk git diff --check
```

Expected: no output.

- [ ] **Step 4: Review commit boundaries**

Run:

```bash
rtk git log --oneline -3
rtk git status --short
```

Expected:

- Last three commits correspond to Phase 1A, Phase 1B, and Phase 1C.
- Working tree is clean.
