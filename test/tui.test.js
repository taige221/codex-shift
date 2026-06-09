import test from "node:test";
import assert from "node:assert/strict";
import { buildTmuxHudOptionCommands, buildTmuxRelaunchPlan, buildTuiPlan } from "../src/ui/tui.js";

test("builds remote TUI supervisor commands", () => {
  const plan = buildTuiPlan({
    codexArgs: ["-C", "/tmp/project", "--no-alt-screen"],
    configPath: "/tmp/router.json",
    host: "127.0.0.1",
    noUsage: true,
    proxyPort: 19001,
    realCodex: "/opt/codex",
    realPort: 19000,
    statusFile: "/tmp/codex-shift-test.json",
    summary: "concise",
    trace: true
  });

  assert.deepEqual(plan.appServer, {
    command: "/opt/codex",
    args: ["app-server", "--listen", "ws://127.0.0.1:19000"]
  });
  assert.equal(plan.proxy.command, process.execPath);
  assert.deepEqual(plan.proxy.args.slice(1), [
    "proxy",
    "--listen",
    "ws://127.0.0.1:19001",
    "--target",
    "ws://127.0.0.1:19000",
    "--config",
    "/tmp/router.json",
    "--no-usage",
    "--status-file",
    "/tmp/codex-shift-test.json",
    "--summary",
    "concise",
    "--trace",
    "--cwd-filter",
    "/tmp/project"
  ]);
  assert.deepEqual(plan.tui, {
    command: "/opt/codex",
    args: ["--remote", "ws://127.0.0.1:19001", "-C", "/tmp/project", "--no-alt-screen"]
  });
});

test("builds cwd-aware remote TUI supervisor commands for plain launch", () => {
  const plan = buildTuiPlan({
    codexArgs: ["--no-alt-screen"],
    host: "127.0.0.1",
    launchCwd: "/tmp/project",
    proxyPort: 19003,
    realCodex: "/opt/codex",
    realPort: 19002
  });

  assert.deepEqual(plan.tui, {
    command: "/opt/codex",
    args: ["-C", "/tmp/project", "--remote", "ws://127.0.0.1:19003", "--no-alt-screen"]
  });
  assert.deepEqual(plan.proxy.args.slice(-2), ["--cwd-filter", "/tmp/project"]);
});

test("builds remote TUI supervisor commands for resume", () => {
  const plan = buildTuiPlan({
    codexArgs: ["resume", "--last"],
    host: "127.0.0.1",
    launchCwd: "/tmp/project",
    proxyPort: 19011,
    realCodex: "/opt/codex",
    realPort: 19010
  });

  assert.deepEqual(plan.tui, {
    command: "/opt/codex",
    args: ["-C", "/tmp/project", "resume", "--remote", "ws://127.0.0.1:19011", "--last"]
  });
  assert.deepEqual(plan.proxy.args.slice(-2), ["--cwd-filter", "/tmp/project"]);
});

test("builds remote TUI supervisor commands for resume after native options", () => {
  const plan = buildTuiPlan({
    codexArgs: ["--no-alt-screen", "-C", "/tmp/project", "resume", "--last"],
    host: "127.0.0.1",
    proxyPort: 19013,
    realCodex: "/opt/codex",
    realPort: 19012
  });

  assert.deepEqual(plan.tui, {
    command: "/opt/codex",
    args: ["--no-alt-screen", "-C", "/tmp/project", "resume", "--remote", "ws://127.0.0.1:19013", "--last"]
  });
  assert.deepEqual(plan.proxy.args.slice(-2), ["--cwd-filter", "/tmp/project"]);
});

test("does not treat resume after native separator as a command", () => {
  const plan = buildTuiPlan({
    codexArgs: ["--", "resume"],
    host: "127.0.0.1",
    launchCwd: "/tmp/project",
    proxyPort: 19015,
    realCodex: "/opt/codex",
    realPort: 19014
  });

  assert.deepEqual(plan.tui, {
    command: "/opt/codex",
    args: ["-C", "/tmp/project", "--remote", "ws://127.0.0.1:19015", "--", "resume"]
  });
  assert.deepEqual(plan.proxy.args.slice(-2), ["--cwd-filter", "/tmp/project"]);
});

test("does not add cwd filter for resume --all", () => {
  const plan = buildTuiPlan({
    codexArgs: ["resume", "--all"],
    host: "127.0.0.1",
    launchCwd: "/tmp/project",
    proxyPort: 19017,
    realCodex: "/opt/codex",
    realPort: 19016
  });

  assert.deepEqual(plan.tui, {
    command: "/opt/codex",
    args: ["resume", "--remote", "ws://127.0.0.1:19017", "--all"]
  });
  assert.equal(plan.proxy.args.includes("--cwd-filter"), false);
});

test("builds tmux HUD pane command when enabled", () => {
  const plan = buildTuiPlan({
    codexArgs: ["--no-alt-screen"],
    env: { TMUX: "/tmp/tmux-1/default,123,0" },
    host: "127.0.0.1",
    hud: true,
    hudHeight: 9,
    hudLauncher: "tmux",
    launchCwd: "/tmp/project",
    proxyPort: 19021,
    realCodex: "/opt/codex",
    realPort: 19020,
    statusFile: "/tmp/codex-shift-hud-test.json"
  });

  assert.equal(plan.hud.command, "tmux");
  assert.equal(plan.hud.type, "tmux");
  assert.deepEqual(plan.hud.args.slice(0, 8), [
    "split-window",
    "-d",
    "-v",
    "-l",
    "9",
    "-P",
    "-F",
    "#{pane_id}"
  ]);
  assert.deepEqual(plan.hud.hudCommand.args.slice(1), [
    "hud",
    "--file",
    "/tmp/codex-shift-hud-test.json"
  ]);
  assert.deepEqual(plan.tui.args, [
    "-C",
    "/tmp/project",
    "--remote",
    "ws://127.0.0.1:19021",
    "--no-alt-screen"
  ]);
});

test("builds tmux HUD pane command in verbose mode", () => {
  const plan = buildTuiPlan({
    codexArgs: ["--no-alt-screen"],
    env: { TMUX: "/tmp/tmux-1/default,123,0" },
    host: "127.0.0.1",
    hud: true,
    hudVerbose: true,
    hudLauncher: "tmux",
    proxyPort: 19023,
    realCodex: "/opt/codex",
    realPort: 19022,
    statusFile: "/tmp/codex-shift-hud-test.json"
  });

  assert.deepEqual(plan.hud.hudCommand.args.slice(1), [
    "hud",
    "--file",
    "/tmp/codex-shift-hud-test.json",
    "--verbose"
  ]);
  assert.match(plan.hud.args.at(-1), /--verbose/);
});

test("builds macOS Terminal HUD command outside tmux", () => {
  const plan = buildTuiPlan({
    codexArgs: ["--no-alt-screen"],
    env: {},
    host: "127.0.0.1",
    hud: true,
    hudLauncher: "terminal",
    parentPid: 12345,
    platform: "darwin",
    proxyPort: 19031,
    realCodex: "/opt/codex",
    realPort: 19030,
    statusFile: "/tmp/codex-shift-hud-test.json"
  });

  assert.equal(plan.hud.type, "macos-terminal");
  assert.equal(plan.hud.command, "osascript");
  assert.equal(plan.hud.args[0], "-e");
  assert.match(plan.hud.args[1], /tell application "Terminal"/);
  assert.match(plan.hud.args[1], /--exit-when-parent 12345/);
  assert.match(plan.hud.args[1], /codex-shift-hud-test\.json/);
  assert.deepEqual(plan.hud.hudCommand.args.slice(1), [
    "hud",
    "--file",
    "/tmp/codex-shift-hud-test.json"
  ]);
});

test("builds macOS Terminal HUD command in verbose mode", () => {
  const plan = buildTuiPlan({
    codexArgs: ["--no-alt-screen"],
    env: {},
    host: "127.0.0.1",
    hud: true,
    hudVerbose: true,
    hudLauncher: "terminal",
    parentPid: 12345,
    platform: "darwin",
    proxyPort: 19033,
    realCodex: "/opt/codex",
    realPort: 19032,
    statusFile: "/tmp/codex-shift-hud-test.json"
  });

  assert.deepEqual(plan.hud.hudCommand.args.slice(1), [
    "hud",
    "--file",
    "/tmp/codex-shift-hud-test.json",
    "--verbose"
  ]);
  assert.match(plan.hud.args[1], /--verbose/);
});

test("builds tmux relaunch command for HUD outside tmux", () => {
  const plan = buildTmuxRelaunchPlan({
    codexArgs: ["--no-alt-screen", "resume"],
    codexBin: "/opt/codex",
    configPath: "/tmp/router.json",
    host: "127.0.0.1",
    hudHeight: 7,
    hudVerbose: true,
    launchCwd: "/tmp/project",
    noUsage: true,
    statusFile: "/tmp/codex-shift-hud-test.json",
    trace: true
  });

  assert.equal(plan.command, "tmux");
  assert.equal(plan.args[0], "new-session");
  assert.deepEqual(plan.args.slice(1, 3), ["-c", "/tmp/project"]);
  assert.match(plan.args[3], /tui --hud --hud-launcher tmux/);
  assert.match(plan.args[3], /--codex-bin \/opt\/codex/);
  assert.match(plan.args[3], /--config \/tmp\/router\.json/);
  assert.match(plan.args[3], /--cwd-filter \/tmp\/project/);
  assert.match(plan.args[3], /--hud-height 7/);
  assert.match(plan.args[3], /--hud-verbose/);
  assert.match(plan.args[3], /--no-usage/);
  assert.match(plan.args[3], /--status-file \/tmp\/codex-shift-hud-test\.json/);
  assert.match(plan.args[3], /--trace/);
  assert.match(plan.args[3], /-- --no-alt-screen resume/);
  assert.deepEqual(plan.relaunch.args.slice(1, 5), [
    "tui",
    "--hud",
    "--hud-launcher",
    "tmux"
  ]);
  const cwdFilterIndex = plan.relaunch.args.indexOf("--cwd-filter");
  assert.equal(plan.relaunch.args[cwdFilterIndex + 1], "/tmp/project");
});

test("builds tmux scroll-friendly HUD options", () => {
  assert.deepEqual(buildTmuxHudOptionCommands(), [
    ["set-option", "-q", "mouse", "on"],
    ["set-option", "-q", "history-limit", "50000"]
  ]);

  assert.deepEqual(buildTmuxHudOptionCommands({ tmuxHistoryLimit: 100000 }), [
    ["set-option", "-q", "mouse", "on"],
    ["set-option", "-q", "history-limit", "100000"]
  ]);
});
