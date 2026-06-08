import { extractFeatures } from "./extractFeatures.js";
import { parsePromptEffortDirective } from "./directives.js";
import { finalizeDecision } from "./finalize.js";
import { mergeAssessments } from "./merge.js";
import { evaluateRules } from "./rules.js";
import { classifySemantically } from "./semantic.js";

export function routePrompt(prompt, options = {}) {
  const promptDirective = options.promptEffortDirective ?? parsePromptEffortDirective(prompt);
  const effectivePrompt = promptDirective.stripped ? promptDirective.prompt : prompt;
  const features = extractFeatures(effectivePrompt);
  const analysis = assessPrompt(features, options);
  return finalizeDecision(analysis, features, { ...options, promptEffortDirective: promptDirective });
}

export function classifyPrompt(prompt) {
  return analyzePrompt(prompt).classification;
}

export function analyzePrompt(prompt, options = {}) {
  const promptDirective = options.promptEffortDirective ?? parsePromptEffortDirective(prompt);
  const effectivePrompt = promptDirective.stripped ? promptDirective.prompt : prompt;
  const features = extractFeatures(effectivePrompt);
  return assessPrompt(features, options);
}

function assessPrompt(features, options) {
  const ruleResult = evaluateRules(features, options);
  const semanticResult = classifySemantically(features, options);
  return mergeAssessments(ruleResult, semanticResult);
}
