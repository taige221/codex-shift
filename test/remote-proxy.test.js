import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractPromptText,
  rewriteJsonRpcMessage,
  rewriteJsonRpcPayload,
  summarizeServerMessage,
  writeStatusForServerPayload
} from "../src/proxy/remote-proxy.js";

test("extracts text prompt from app-server input", () => {
  assert.equal(
    extractPromptText([
      { type: "text", text: "第一段" },
      { type: "image", path: "/tmp/a.png" },
      { type: "text", text: "第二段" }
    ]),
    "第一段\n第二段"
  );
});

test("rewrites turn/start with routed model and effort", () => {
  const request = {
    jsonrpc: "2.0",
    id: 7,
    method: "turn/start",
    params: {
      threadId: "019e-test-thread",
      input: [{ type: "text", text: "review改修这个 PR" }]
    }
  };

  const result = rewriteJsonRpcMessage(request, { noUsage: true });

  assert.equal(result.routed, true);
  assert.equal(result.decision.classification, "complex");
  assert.equal(result.message.params.model, "gpt-5.5");
  assert.equal(result.message.params.effort, "high");
  assert.equal(result.message.params.summary, "concise");
  assert.equal(Object.hasOwn(result.decision, "prompt"), false);
});

test("writes routed status without prompt text", () => {
  const tmp = mkdtempSync(join(tmpdir(), "codex-shift-status-"));
  const statusFile = join(tmp, "status.json");
  const prompt = "fix this failing test with secret_api_key=abc123";
  const request = {
    jsonrpc: "2.0",
    id: 9,
    method: "turn/start",
    params: {
      threadId: "019e-test-thread",
      input: [{ type: "text", text: prompt }]
    }
  };

  try {
    const result = rewriteJsonRpcMessage(request, { noUsage: true, statusFile });
    const rawStatus = readFileSync(statusFile, "utf8");
    const status = JSON.parse(rawStatus);

    assert.equal(result.routed, true);
    assert.equal(status.threadId, "019e-test-thread");
    assert.equal(status.requestId, 9);
    assert.equal(status.model, "gpt-5.5");
    assert.equal(status.effort, "medium");
    assert.equal(status.classification, "coding");
    assert.equal(rawStatus.includes(prompt), false);
    assert.equal(rawStatus.includes("secret_api_key"), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("updates routed status with token usage notifications", () => {
  const tmp = mkdtempSync(join(tmpdir(), "codex-shift-token-status-"));
  const statusFile = join(tmp, "status.json");
  const request = {
    jsonrpc: "2.0",
    id: 9,
    method: "turn/start",
    params: {
      threadId: "019e-test-thread",
      input: [{ type: "text", text: "fix this failing test" }]
    }
  };
  const notification = {
    jsonrpc: "2.0",
    method: "thread/tokenUsage/updated",
    params: {
      threadId: "019e-test-thread",
      turnId: "turn-1",
      tokenUsage: {
        last: {
          totalTokens: 130,
          inputTokens: 100,
          cachedInputTokens: 80,
          outputTokens: 20,
          reasoningOutputTokens: 10
        },
        total: {
          totalTokens: 530,
          inputTokens: 400,
          cachedInputTokens: 240,
          outputTokens: 90,
          reasoningOutputTokens: 40
        },
        modelContextWindow: 200000
      }
    }
  };

  try {
    rewriteJsonRpcMessage(request, { noUsage: true, statusFile });
    writeStatusForServerPayload(JSON.stringify(notification), { statusFile });
    const status = JSON.parse(readFileSync(statusFile, "utf8"));

    assert.equal(status.model, "gpt-5.5");
    assert.equal(status.effort, "medium");
    assert.deepEqual(status.tokenUsage, {
      turnId: "turn-1",
      inputTokens: 100,
      cachedInputTokens: 80,
      totalInputTokens: 400,
      totalCachedInputTokens: 240,
      modelContextWindow: 200000,
      updatedAt: status.tokenUsage.updatedAt
    });
    assert.match(status.tokenUsage.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("does not write routed status when disabled", () => {
  const tmp = mkdtempSync(join(tmpdir(), "codex-shift-no-status-"));
  const envStatusFile = join(tmp, "env-status.json");
  const previousStatusFile = process.env.CODEX_SHIFT_STATUS_FILE;
  const request = {
    jsonrpc: "2.0",
    id: 10,
    method: "turn/start",
    params: {
      threadId: "019e-test-thread",
      input: [{ type: "text", text: "fix this failing test" }]
    }
  };

  try {
    process.env.CODEX_SHIFT_STATUS_FILE = envStatusFile;
    const result = rewriteJsonRpcMessage(request, { noUsage: true, statusFile: null });

    assert.equal(result.routed, true);
    assert.equal(existsSync(envStatusFile), false);
  } finally {
    if (previousStatusFile === undefined) delete process.env.CODEX_SHIFT_STATUS_FILE;
    else process.env.CODEX_SHIFT_STATUS_FILE = previousStatusFile;
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("rewrites read-only turn/start sandbox without logging prompt into decision", () => {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 8,
    method: "turn/start",
    params: {
      threadId: "019e-test-thread",
      input: [{ type: "text", text: "fix this failing test，不要改代码" }]
    }
  });

  const result = rewriteJsonRpcPayload(payload, { noUsage: true });
  const message = JSON.parse(result.payload);

  assert.equal(result.routed, true);
  assert.equal(message.params.effort, "medium");
  assert.deepEqual(message.params.sandboxPolicy, {
    type: "readOnly",
    networkAccess: false
  });
  assert.equal(Object.hasOwn(result.decision, "prompt"), false);
});

test("leaves non turn/start payloads unchanged apart from JSON normalization", () => {
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "thread/list",
    params: {}
  };

  const result = rewriteJsonRpcPayload(JSON.stringify(request), { noUsage: true });

  assert.equal(result.routed, false);
  assert.deepEqual(JSON.parse(result.payload), request);
});

test("injects cwd filter into thread/list when configured", () => {
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "thread/list",
    params: {
      limit: 20
    }
  };

  const result = rewriteJsonRpcPayload(JSON.stringify(request), {
    cwdFilter: "/tmp/project",
    noUsage: true
  });

  assert.equal(result.routed, false);
  assert.deepEqual(JSON.parse(result.payload), {
    ...request,
    params: {
      limit: 20,
      cwd: "/tmp/project"
    }
  });
});

test("respects explicit cwd in thread/list", () => {
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "thread/list",
    params: {
      cwd: "/tmp/other"
    }
  };

  const result = rewriteJsonRpcPayload(JSON.stringify(request), {
    cwdFilter: "/tmp/project",
    noUsage: true
  });

  assert.equal(result.routed, false);
  assert.deepEqual(JSON.parse(result.payload), request);
});

test("leaves thread/resume payloads unchanged", () => {
  const request = {
    jsonrpc: "2.0",
    id: 2,
    method: "thread/resume",
    params: {
      threadId: "019e-test-thread",
      model: "gpt-5.5"
    }
  };

  const result = rewriteJsonRpcPayload(JSON.stringify(request), { noUsage: true });

  assert.equal(result.routed, false);
  assert.deepEqual(JSON.parse(result.payload), request);
});

test("leaves non-JSON WebSocket payloads unchanged", () => {
  const result = rewriteJsonRpcPayload("hello", { noUsage: true });

  assert.equal(result.routed, false);
  assert.equal(result.payload, "hello");
});

test("summarizes server model and effort notifications for trace", () => {
  assert.equal(
    summarizeServerMessage({
      method: "thread/settings/updated",
      params: {
        settings: {
          model: "gpt-5.5",
          effort: "medium"
        }
      }
    }),
    " settings model=gpt-5.5 effort=medium"
  );

  assert.equal(
    summarizeServerMessage({
      jsonrpc: "2.0",
      id: 12,
      result: {
        thread: {
          settings: {
            model: "gpt-5.5",
            effort: "high"
          }
        }
      }
    }),
    " result model=gpt-5.5 effort=high"
  );
});

test("summarizes token usage notifications for trace", () => {
  assert.equal(
    summarizeServerMessage({
      method: "thread/tokenUsage/updated",
      params: {
        tokenUsage: {
          last: {
            inputTokens: 100,
            cachedInputTokens: 80
          }
        }
      }
    }),
    " token_usage input_tokens=100 cached_input_tokens=80"
  );
});
