import { spawnSync } from "node:child_process";

export function buildTurnStartRequest(decision, options = {}) {
  if (!options.threadId) {
    throw new Error("Missing --thread for app-server turn/start.");
  }
  const prompt = requirePrompt(options.prompt);

  const params = {
    threadId: options.threadId,
    input: [{ type: "text", text: prompt }],
    model: decision.model,
    effort: decision.effort,
    summary: options.summary ?? "concise"
  };

  if (params.summary === false) {
    delete params.summary;
  }

  copyIfSet(params, "cwd", options.cwd);
  copyIfSet(params, "approvalPolicy", options.approvalPolicy);
  copyIfSet(
    params,
    "sandboxPolicy",
    options.sandboxPolicy ?? (decision.readOnly ? { type: "readOnly", networkAccess: false } : null)
  );

  return {
    jsonrpc: "2.0",
    id: options.requestId ?? 1,
    method: "turn/start",
    params
  };
}

export function buildAppServerProxyCommand(options = {}) {
  const command = options.codexBin ?? "codex";
  const args = ["app-server", "proxy"];

  if (options.sock) {
    args.push("--sock", options.sock);
  }

  return { command, args };
}

export function callTurnStart(decision, options = {}) {
  const request = buildTurnStartRequest(decision, options);
  const proxy = buildAppServerProxyCommand(options);
  const result = spawnSync(proxy.command, proxy.args, {
    input: `${JSON.stringify(request)}\n`,
    encoding: "utf8",
    cwd: options.cwd ?? process.cwd(),
    env: process.env
  });

  return {
    ...result,
    proxy,
    request,
    response: parseJsonRpcResponse(result.stdout, { requestId: request.id })
  };
}

export function parseJsonRpcResponse(stdout, options = {}) {
  const messages = extractJsonObjects(String(stdout ?? ""));
  const expectedId = options.requestId ?? options.id;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isJsonRpcResponse(message)) continue;
    if (expectedId !== undefined && message.id !== expectedId) continue;
    return message;
  }

  return null;
}

function extractJsonObjects(text) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (start === -1) {
      if (char === "{") {
        start = index;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }

    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const candidate = text.slice(start, index + 1);
        try {
          objects.push(JSON.parse(candidate));
        } catch {
          // Ignore diagnostic text that only looks like JSON.
        }
        start = -1;
      }
    }
  }

  return objects;
}

function isJsonRpcResponse(message) {
  return Boolean(
    message &&
    typeof message === "object" &&
    message.jsonrpc === "2.0" &&
    Object.hasOwn(message, "id") &&
    (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))
  );
}

function copyIfSet(target, key, value) {
  if (value !== null && value !== undefined) {
    target[key] = value;
  }
}

function requirePrompt(prompt) {
  const text = String(prompt ?? "").trim();
  if (!text) throw new Error("Missing prompt for app-server transport.");
  return text;
}
