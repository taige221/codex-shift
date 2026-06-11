export function traceClientMessage(data, options, label) {
  if (!shouldTrace(options)) return;
  let parsed;
  try {
    parsed = JSON.parse(String(data));
  } catch {
    trace(options, `${label} client -> target non-json text`);
    return;
  }

  if (Array.isArray(parsed)) {
    trace(options, `${label} client -> target batch size=${parsed.length}`);
    return;
  }

  trace(options, `${label} client -> target method=${parsed.method ?? "response"} id=${parsed.id ?? "-"}`);
}

export function traceServerMessage(data, options, label) {
  if (!shouldTrace(options)) return;
  let parsed;
  try {
    parsed = JSON.parse(String(data));
  } catch {
    trace(options, `${label} target -> client non-json text`);
    return;
  }

  if (Array.isArray(parsed)) {
    trace(options, `${label} target -> client batch size=${parsed.length}`);
    return;
  }

  const method = parsed.method ?? "response";
  const suffix = summarizeServerMessage(parsed);
  trace(options, `${label} target -> client method=${method} id=${parsed.id ?? "-"}${suffix}`);
}

export function traceTurnStart(message, decision, options) {
  if (!shouldTrace(options)) return;
  console.error(
    `[codex-shift] turn/start id=${message.id ?? "-"} model=${decision.model} effort=${decision.effort} classification=${decision.classification}`
  );
}

export function summarizeServerMessage(message) {
  const params = message.params ?? {};
  if (message.method === "thread/settings/updated") {
    const settings = params.settings ?? params;
    return formatModelEffort(settings, " settings");
  }
  if (message.method === "turn/started") {
    return formatModelEffort(params, " turn");
  }
  if (message.method === "model/rerouted") {
    return formatModelEffort(params, " reroute");
  }
  if (message.method === "thread/tokenUsage/updated") {
    return formatTokenUsage(params.tokenUsage?.last, " token_usage");
  }
  if (message.result && typeof message.result === "object") {
    const result = message.result;
    const candidates = [
      result,
      result.thread,
      result.thread?.settings,
      result.settings
    ];
    for (const candidate of candidates) {
      const formatted = formatModelEffort(candidate, " result");
      if (formatted) return formatted;
    }
  }
  return "";
}

export function trace(options, message) {
  if (!shouldTrace(options)) return;
  console.error(`[codex-shift:proxy] ${message}`);
}

export function shouldTrace(options = {}) {
  return Boolean(options.trace || process.env.CODEX_SHIFT_TRACE);
}

export function formatEventError(event) {
  return event?.message ?? event?.error?.message ?? "";
}

function formatTokenUsage(value, label) {
  if (!value || typeof value !== "object") return "";
  const inputTokens = value.inputTokens;
  const cachedInputTokens = value.cachedInputTokens;
  if (typeof inputTokens !== "number" && typeof cachedInputTokens !== "number") return "";
  return `${label} input_tokens=${inputTokens ?? "-"} cached_input_tokens=${cachedInputTokens ?? "-"}`;
}

function formatModelEffort(value, label) {
  if (!value || typeof value !== "object") return "";
  const model = value.model ?? value.settings?.model ?? null;
  const effort = value.effort ?? value.reasoning_effort ?? value.settings?.effort ?? null;
  if (!model && !effort) return "";
  return `${label} model=${model ?? "-"} effort=${effort ?? "-"}`;
}
