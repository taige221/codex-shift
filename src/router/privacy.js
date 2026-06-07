export const PROMPT_OMITTED = "[prompt omitted]";

export const READ_ONLY_SIGNALS = [
  { pattern: /不用改代码|不要改代码|先别改|只读|只看|不修改|不要修改/, reason: "explicit Chinese read-only request" },
  { pattern: /\b(read[- ]?only|do not edit|don't edit|no code changes|no changes)\b/i, reason: "explicit read-only request" }
];

export function normalizePrompt(prompt) {
  return String(prompt ?? "").trim();
}

export function detectReadOnly(text) {
  for (const signal of READ_ONLY_SIGNALS) {
    if (!signal.pattern.test(text)) continue;
    return {
      readOnly: true,
      reason: `readOnly: ${signal.reason}`
    };
  }

  return { readOnly: false, reason: null };
}

export function stripReadOnlySignals(text) {
  let stripped = text;
  for (const signal of READ_ONLY_SIGNALS) {
    stripped = stripped.replace(signal.pattern, " ");
  }
  return stripped;
}

export function omitPrompt() {
  return PROMPT_OMITTED;
}

