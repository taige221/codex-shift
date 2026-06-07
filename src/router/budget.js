import { EFFORT_ORDER } from "./types.js";

export function downgradeEffort(effort) {
  const index = EFFORT_ORDER.indexOf(effort);
  if (index <= 0) return effort;
  return EFFORT_ORDER[Math.max(0, index - 1)];
}

export function shouldDowngradeForBudget(config, usage, classification) {
  if (!config.budget?.enabled) return false;
  if (classification === "critical") return false;
  if (config.budget.whenOverLimit !== "downgrade_noncritical") return false;
  if (typeof usage?.secondaryUsedPercent !== "number") return false;
  return usage.secondaryUsedPercent >= config.budget.weeklySoftLimitPercent;
}

