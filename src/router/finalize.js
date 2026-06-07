import { shouldDowngradeForBudget, downgradeEffort } from "./budget.js";
import { CLASSIFICATIONS, DEFAULT_CONFIG, EFFORT_ORDER, VALID_EFFORTS } from "./types.js";

export function finalizeDecision(analysis, features, options = {}) {
  const config = mergeConfig(DEFAULT_CONFIG, options.config ?? {});
  validateRouterConfig(config);
  validateModelCapabilities(options.modelCapabilities, "options.modelCapabilities");

  const classification = analysis.classification;
  let effort = config.efforts[classification] ?? config.defaultEffort;
  const usage = options.usage ?? null;
  const reasons = [
    `classified as ${classification}`,
    ...analysis.reasons
  ];

  if (options.model) {
    reasons.push("model overridden by flag");
  }

  if (options.effort) {
    assertValidEffort(options.effort, "options.effort");
    effort = options.effort;
    reasons.push("effort overridden by flag");
  } else if (shouldDowngradeForBudget(config, usage, classification)) {
    const downgraded = downgradeEffort(effort);
    if (downgraded !== effort) {
      reasons.push(
        `weekly usage ${usage.secondaryUsedPercent}% >= ${config.budget.weeklySoftLimitPercent}%, downgraded non-critical task`
      );
      effort = downgraded;
    }
  }

  const model = options.model ?? config.defaultModel;
  const resolvedEffort = resolveEffortForModel(effort, model, {
    config,
    modelCapabilities: options.modelCapabilities,
    reasons
  });

  return {
    model,
    effort: resolvedEffort,
    requestedEffort: effort,
    classification,
    confidence: analysis.confidence,
    readOnly: features.readOnly,
    mode: features.readOnly ? "read-only" : "default",
    scores: analysis.scores,
    reasons
  };
}

export function mergeConfig(base, override) {
  return {
    ...base,
    ...override,
    efforts: {
      ...base.efforts,
      ...(override.efforts ?? {})
    },
    budget: {
      ...base.budget,
      ...(override.budget ?? {})
    },
    modelCapabilities: {
      ...base.modelCapabilities,
      ...(override.modelCapabilities ?? {})
    }
  };
}

export function isValidEffort(effort) {
  return VALID_EFFORTS.includes(effort);
}

export function assertValidEffort(effort, label = "effort") {
  if (!isValidEffort(effort)) {
    throw new Error(`${label} must be one of ${VALID_EFFORTS.join(", ")}.`);
  }
}

export function validateRouterConfig(config) {
  assertValidEffort(config.defaultEffort, "config.defaultEffort");
  for (const classification of CLASSIFICATIONS) {
    const effort = config.efforts?.[classification];
    if (effort === undefined) continue;
    assertValidEffort(effort, `config.efforts.${classification}`);
  }

  validateModelCapabilities(config.modelCapabilities, "config.modelCapabilities");
}

export function validateModelCapabilities(capabilitiesByModel, label) {
  for (const [model, capabilities] of Object.entries(capabilitiesByModel ?? {})) {
    const supportedEfforts = normalizeSupportedEfforts(capabilities);
    if (!supportedEfforts) continue;
    if (supportedEfforts.length === 0) {
      throw new Error(`${label}.${model} must list at least one effort.`);
    }
    for (const effort of supportedEfforts) {
      assertValidEffort(effort, `${label}.${model}`);
    }
  }
}

export function resolveEffortForModel(effort, model, options = {}) {
  assertValidEffort(effort, "effort");
  const capabilities = {
    ...(options.config?.modelCapabilities ?? {}),
    ...(options.modelCapabilities ?? {})
  };
  const supportedEfforts = normalizeSupportedEfforts(capabilities[model] ?? capabilities.default);

  if (!supportedEfforts || supportedEfforts.includes(effort)) {
    return effort;
  }

  const requestedIndex = EFFORT_ORDER.indexOf(effort);
  for (let index = requestedIndex - 1; index >= 0; index -= 1) {
    const fallback = EFFORT_ORDER[index];
    if (supportedEfforts.includes(fallback)) {
      options.reasons?.push(`model ${model} does not support ${effort}, fell back to ${fallback}`);
      return fallback;
    }
  }

  const fallback = supportedEfforts
    .slice()
    .sort((left, right) => EFFORT_ORDER.indexOf(left) - EFFORT_ORDER.indexOf(right))[0];
  options.reasons?.push(`model ${model} does not support ${effort}, fell back to ${fallback}`);
  return fallback;
}

function normalizeSupportedEfforts(capabilities) {
  if (!capabilities) return null;
  if (Array.isArray(capabilities)) return capabilities;
  if (Array.isArray(capabilities.efforts)) return capabilities.efforts;
  if (Array.isArray(capabilities.reasoningEfforts)) return capabilities.reasoningEfforts;
  return null;
}

