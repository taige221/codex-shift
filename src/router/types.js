export const DEFAULT_CONFIG = {
  defaultModel: "gpt-5.5",
  defaultEffort: "medium",
  efforts: {
    simple: "low",
    coding: "medium",
    complex: "high",
    critical: "xhigh"
  },
  budget: {
    enabled: true,
    weeklySoftLimitPercent: 85,
    whenOverLimit: "downgrade_noncritical"
  },
  modelCapabilities: {}
};

export const VALID_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"];
export const EFFORT_ORDER = VALID_EFFORTS;
export const CLASSIFICATIONS = ["simple", "coding", "complex", "critical"];

export function createEmptyScores() {
  return Object.fromEntries(CLASSIFICATIONS.map((classification) => [classification, 0]));
}

