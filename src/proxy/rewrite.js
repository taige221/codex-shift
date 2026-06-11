import { routePrompt } from "../router/index.js";
import { parsePromptEffortDirective } from "../router/directives.js";
import { loadConfig } from "../config/index.js";
import { readCodexUsage } from "../usage/index.js";
import { writeStatusForTurn } from "./status.js";
import { trace, traceTurnStart } from "./trace.js";

const DEFAULT_SUMMARY = "concise";

export function rewriteJsonRpcPayload(payload, options = {}) {
  const text = String(payload ?? "");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { payload: text, routed: false, decision: null };
  }

  if (Array.isArray(parsed)) {
    let routed = false;
    let decision = null;
    const messages = parsed.map((message) => {
      const result = rewriteJsonRpcMessage(message, options);
      if (result.routed) {
        routed = true;
        decision = result.decision;
      }
      return result.message;
    });
    return { payload: JSON.stringify(messages), routed, decision };
  }

  const result = rewriteJsonRpcMessage(parsed, options);
  return {
    payload: JSON.stringify(result.message),
    routed: result.routed,
    decision: result.decision
  };
}

export function rewriteJsonRpcMessage(message, options = {}) {
  if (isThreadListRequest(message)) {
    return rewriteThreadListRequest(message, options);
  }

  if (!isTurnStartRequest(message)) {
    return { message, routed: false, decision: null };
  }

  const prompt = extractPromptText(message.params.input);
  const promptEffortDirective = parsePromptEffortDirective(prompt);
  const configPath = options.configPath ?? process.env.CODEX_SHIFT_CONFIG;
  const { config } = loadConfig(configPath);
  const usage = options.noUsage || process.env.CODEX_SHIFT_NO_USAGE
    ? null
    : readCodexUsage(options.codexHome ?? process.env.CODEX_HOME);
  const decision = routePrompt(promptEffortDirective.prompt, {
    config,
    model: message.params.model ?? undefined,
    promptEffortDirective,
    usage
  });

  const params = {
    ...message.params,
    model: decision.model,
    effort: decision.effort
  };

  const summary = options.summary ?? DEFAULT_SUMMARY;
  if (summary === false) {
    delete params.summary;
  } else if (summary !== undefined) {
    params.summary = summary;
  }

  if (decision.readOnly) {
    params.sandboxPolicy = {
      type: "readOnly",
      networkAccess: false
    };
  }

  traceTurnStart(message, decision, options);
  writeStatusForTurn(message, decision, options);

  return {
    message: {
      ...message,
      params
    },
    routed: true,
    decision
  };
}

export function extractPromptText(input) {
  if (!Array.isArray(input)) return "";
  return input
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      if (typeof item.text === "string") return item.text;
      if (typeof item.content === "string") return item.content;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function rewriteThreadListRequest(message, options) {
  const cwdFilter = options.cwdFilter ?? process.env.CODEX_SHIFT_CWD_FILTER;
  if (!cwdFilter) {
    return { message, routed: false, decision: null };
  }

  const params = message.params && typeof message.params === "object"
    ? { ...message.params }
    : {};
  if (params.cwd !== undefined && params.cwd !== null) {
    return { message, routed: false, decision: null };
  }

  params.cwd = cwdFilter;
  trace(options, `thread/list id=${message.id ?? "-"} cwd filter applied`);
  return {
    message: {
      ...message,
      params
    },
    routed: false,
    decision: null
  };
}

function isTurnStartRequest(message) {
  return Boolean(
    message &&
    typeof message === "object" &&
    message.method === "turn/start" &&
    message.params &&
    typeof message.params === "object"
  );
}

function isThreadListRequest(message) {
  return Boolean(
    message &&
    typeof message === "object" &&
    message.method === "thread/list"
  );
}
