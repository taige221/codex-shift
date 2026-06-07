import test from "node:test";
import assert from "node:assert/strict";
import { analyzePrompt, classifyPrompt, routePrompt } from "../src/router/index.js";
import { buildCodexCommand } from "../src/codex/index.js";
import {
  buildAppServerProxyCommand,
  buildTurnStartRequest,
  parseJsonRpcResponse
} from "../src/transports/app-server.js";

test("classifies simple prompts", () => {
  assert.equal(classifyPrompt("解释一下这个概念"), "simple");
  assert.equal(classifyPrompt("translate this sentence"), "simple");
  assert.equal(classifyPrompt("try again"), "simple");
  assert.equal(classifyPrompt("production config 是什么"), "simple");
  assert.equal(classifyPrompt("资金是什么意思"), "simple");
  assert.equal(classifyPrompt("incident response template"), "simple");
});

test("classifies coding prompts", () => {
  assert.equal(classifyPrompt("fix this failing test"), "coding");
  assert.equal(classifyPrompt("看下日志里的 traceback"), "coding");
  assert.equal(classifyPrompt("run tests again"), "coding");
  assert.equal(classifyPrompt("再加一个 --verbose flag"), "coding");
});

test("classifies complex prompts", () => {
  assert.equal(classifyPrompt("实现一个多文件 API 兼容改造"), "complex");
  assert.equal(classifyPrompt("排查 CI 偶发失败并做全链路修复"), "complex");
  assert.equal(classifyPrompt("review改修这个 PR"), "complex");
  assert.equal(classifyPrompt("审查这个 MR 的全仓影响"), "complex");
  assert.equal(classifyPrompt("处理刚刚的指摘，需要修改代码"), "complex");
  assert.equal(classifyPrompt("レビュー対応お願いします"), "complex");
  assert.equal(classifyPrompt("缓存状态还是有点问题，需要再检查一下"), "complex");
  assert.equal(classifyPrompt("loginFlow 又不对了，排查一下"), "complex");
  assert.equal(classifyPrompt("resume还是有点问题，需要再检查一下"), "complex");
  assert.equal(classifyPrompt("检查 proxy 有没有破坏 ws 行为"), "complex");
  assert.equal(classifyPrompt("除了 resume 还有哪些内容会透过 ws 吗"), "simple");
});

test("classifies critical prompts", () => {
  assert.equal(classifyPrompt("安全支付链路生产事故"), "critical");
  assert.equal(classifyPrompt("root cause production incident"), "critical");
  assert.equal(classifyPrompt("security review for token handling"), "critical");
  assert.equal(classifyPrompt("payment reconciliation issue"), "critical");
});

test("routes default efforts", () => {
  assert.equal(routePrompt("解释一下").effort, "low");
  assert.equal(routePrompt("fix bug").effort, "medium");
  assert.equal(routePrompt("实现一个多文件 API 兼容改造").effort, "high");
  assert.equal(routePrompt("review改修").effort, "high");
  assert.equal(routePrompt("处理刚刚的指摘，需要修改代码").effort, "high");
  assert.equal(routePrompt("缓存状态还是有点问题，需要再检查一下").effort, "high");
  assert.equal(routePrompt("resume还是有点问题，需要再检查一下").effort, "high");
  assert.equal(routePrompt("production data loss incident").effort, "xhigh");
  assert.equal(routePrompt("production config 是什么").effort, "low");
});

test("returns confidence, scores, and reasons", () => {
  const decision = routePrompt("fix this failing test");
  assert.equal(typeof decision.confidence, "number");
  assert.ok(decision.confidence >= 0.5);
  assert.ok(decision.scores.coding > 0);
  assert.ok(decision.reasons.some((reason) => reason.includes("coding")));
  assert.equal(Object.hasOwn(decision, "prompt"), false);
});

test("uses thread state to avoid dropping ongoing difficult work too far", () => {
  const decision = routePrompt("继续处理这个问题", {
    threadState: {
      continuation: true,
      previousEffort: "xhigh"
    }
  });
  assert.equal(decision.classification, "complex");
  assert.equal(decision.effort, "high");
});

test("downgrades non-critical work over budget", () => {
  const decision = routePrompt("fix bug", {
    usage: { secondaryUsedPercent: 90 }
  });
  assert.equal(decision.effort, "low");
});

test("keeps critical work over budget", () => {
  const decision = routePrompt("production data loss incident", {
    usage: { secondaryUsedPercent: 90 }
  });
  assert.equal(decision.effort, "xhigh");
});

test("validates requested and configured efforts", () => {
  assert.throws(
    () => routePrompt("fix bug", { effort: "none" }),
    /options\.effort must be one of/
  );
  assert.throws(
    () => routePrompt("fix bug", { config: { efforts: { coding: "none" } } }),
    /config\.efforts\.coding must be one of/
  );
});

test("falls back when selected model does not support xhigh", () => {
  const decision = routePrompt("production data loss incident", {
    model: "gpt-lite",
    modelCapabilities: {
      "gpt-lite": ["minimal", "low", "medium", "high"]
    }
  });
  assert.equal(decision.requestedEffort, "xhigh");
  assert.equal(decision.effort, "high");
  assert.ok(decision.reasons.some((reason) => reason.includes("fell back to high")));
});

test("treats no-code requests as read-only without making them simple", () => {
  const decision = routePrompt("fix this failing test，不要改代码");
  assert.equal(decision.classification, "coding");
  assert.equal(decision.effort, "medium");
  assert.equal(decision.readOnly, true);
  assert.equal(decision.mode, "read-only");
});

test("builds codex exec command", () => {
  const decision = { model: "gpt-5.5", effort: "medium", readOnly: false };
  const command = buildCodexCommand(
    decision,
    { codexBin: "codex", cwd: "/tmp/project", codexArgs: ["--json"], prompt: "fix bug" }
  );
  assert.deepEqual(command, {
    command: "codex",
    args: [
      "exec",
      "-m",
      "gpt-5.5",
      "-c",
      'model_reasoning_effort="medium"',
      "-C",
      "/tmp/project",
      "--json",
      "fix bug"
    ]
  });
});

test("builds read-only codex exec command", () => {
  const command = buildCodexCommand(
    { model: "gpt-5.5", effort: "medium", readOnly: true },
    { codexBin: "codex", prompt: "fix bug，不要改代码" }
  );
  assert.deepEqual(command.args, [
    "exec",
    "-m",
    "gpt-5.5",
    "-c",
    'model_reasoning_effort="medium"',
    "-s",
    "read-only",
    "fix bug，不要改代码"
  ]);
});

test("builds app-server turn/start request", () => {
  const request = buildTurnStartRequest(
    { model: "gpt-5.5", effort: "high", readOnly: false },
    { threadId: "019e-test-thread", cwd: "/tmp/project", prompt: "实现一个多文件 API 兼容改造" }
  );
  assert.deepEqual(request, {
    jsonrpc: "2.0",
    id: 1,
    method: "turn/start",
    params: {
      threadId: "019e-test-thread",
      input: [{ type: "text", text: "实现一个多文件 API 兼容改造" }],
      model: "gpt-5.5",
      effort: "high",
      summary: "concise",
      cwd: "/tmp/project"
    }
  });
});

test("builds read-only app-server turn/start request", () => {
  const request = buildTurnStartRequest(
    { model: "gpt-5.5", effort: "medium", readOnly: true },
    { threadId: "019e-test-thread", prompt: "fix bug，不要改代码" }
  );
  assert.deepEqual(request.params.sandboxPolicy, {
    type: "readOnly",
    networkAccess: false
  });
  assert.equal(request.params.summary, "concise");
});

test("can override or omit app-server summary", () => {
  assert.equal(
    buildTurnStartRequest(
      { model: "gpt-5.5", effort: "medium", readOnly: false },
      { threadId: "019e-test-thread", prompt: "fix bug", summary: "detailed" }
    ).params.summary,
    "detailed"
  );

  assert.equal(
    Object.hasOwn(
      buildTurnStartRequest(
        { model: "gpt-5.5", effort: "medium", readOnly: false },
        { threadId: "019e-test-thread", prompt: "fix bug", summary: false }
      ).params,
      "summary"
    ),
    false
  );
});

test("builds app-server proxy command", () => {
  const command = buildAppServerProxyCommand({
    codexBin: "codex",
    sock: "/tmp/codex.sock"
  });
  assert.deepEqual(command, {
    command: "codex",
    args: ["app-server", "proxy", "--sock", "/tmp/codex.sock"]
  });
});

test("parses app-server JSON-RPC response from noisy stdout", () => {
  const response = { jsonrpc: "2.0", id: 1, result: { turnId: "turn-123" } };
  const stdout = [
    "connected to codex app-server proxy",
    JSON.stringify({ jsonrpc: "2.0", method: "turn/started", params: { turnId: "turn-123" } }),
    JSON.stringify(response)
  ].join("\n");

  assert.deepEqual(parseJsonRpcResponse(stdout), response);
});

test("parses matching app-server JSON-RPC response by request id", () => {
  const first = { jsonrpc: "2.0", id: 1, result: { turnId: "turn-1" } };
  const second = { jsonrpc: "2.0", id: 2, result: { turnId: "turn-2" } };
  const stdout = `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`;

  assert.deepEqual(parseJsonRpcResponse(stdout), second);
  assert.deepEqual(parseJsonRpcResponse(stdout, { requestId: 1 }), first);
});

test("parses app-server JSON-RPC error response", () => {
  const response = {
    jsonrpc: "2.0",
    id: 7,
    error: { code: -32602, message: "invalid thread id" }
  };

  assert.deepEqual(parseJsonRpcResponse(JSON.stringify(response)), response);
});

test("parses pretty or framed app-server JSON-RPC response", () => {
  const response = {
    jsonrpc: "2.0",
    id: 1,
    result: {
      turnId: "turn-pretty",
      nested: { ok: true }
    }
  };
  const body = JSON.stringify(response, null, 2);
  const stdout = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}\n`;

  assert.deepEqual(parseJsonRpcResponse(stdout), response);
});

test("returns null when app-server stdout has no JSON-RPC response", () => {
  const stdout = [
    "connected to codex app-server proxy",
    JSON.stringify({ jsonrpc: "2.0", method: "turn/started", params: {} }),
    "{not actually json}"
  ].join("\n");

  assert.equal(parseJsonRpcResponse(stdout), null);
});
