const PROMPT_EFFORT_DIRECTIVE_PATTERN = /^\s*([/#])(low|medium|high|xhigh)(?=$|\s)/i;

export const PROMPT_EFFORT_DIRECTIVES = ["low", "medium", "high", "xhigh"];

export function parsePromptEffortDirective(prompt) {
  return parsePromptEffortDirectivePrefix(prompt, { allowEmptyPrompt: false, trimPrompt: true });
}

export function stripPromptEffortDirectivePrefix(prompt) {
  return parsePromptEffortDirectivePrefix(prompt, { allowEmptyPrompt: true, trimPrompt: false });
}

function parsePromptEffortDirectivePrefix(prompt, options) {
  const text = String(prompt ?? "");
  const originalPrompt = options.trimPrompt ? text.trim() : text;
  const match = PROMPT_EFFORT_DIRECTIVE_PATTERN.exec(text);

  if (!match) {
    return noDirective(originalPrompt);
  }

  const prefix = match[1];
  const effort = match[2].toLowerCase();
  const strippedPrompt = text.slice(match[0].length).trimStart();
  const normalizedPrompt = options.trimPrompt ? strippedPrompt.trim() : strippedPrompt;

  if (!options.allowEmptyPrompt && normalizedPrompt.trim().length === 0) {
    return noDirective(originalPrompt);
  }

  return {
    directive: `${prefix}${effort}`,
    effort,
    prompt: normalizedPrompt,
    stripped: true
  };
}

function noDirective(prompt) {
  return {
    directive: null,
    effort: null,
    prompt,
    stripped: false
  };
}
