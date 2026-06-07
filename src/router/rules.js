import { createEmptyScores } from "./types.js";
import { hasRegressionOrRecurrence } from "./extractFeatures.js";

export function evaluateRules(features, options = {}) {
  const scores = createEmptyScores();
  const reasons = [];

  if (features.readOnlyReason) {
    reasons.push(features.readOnlyReason);
  }

  if (features.empty) {
    scores.coding = 1;
    return {
      scores,
      reasons: ["empty prompt defaults to coding"],
      hardClassification: null
    };
  }

  const criticalReason = detectCriticalRisk(features);
  const hardClassification = criticalReason ? "critical" : null;

  if (criticalReason) {
    scores.critical += 5;
    reasons.push(`critical +5: ${criticalReason}`);
  }

  applyReviewSignals(features, scores, reasons);
  applyComplexSignals(features, scores, reasons);
  applyCodingSignals(features, scores, reasons);
  applySimpleSignals(features, scores, reasons);
  applyTaskShapeSignals(features, scores, reasons);
  applyLengthSignals(features, scores, reasons);
  applyThreadSignals(options.threadState, scores, reasons);
  applyFallbackSignals(features, scores, reasons);

  return {
    scores,
    reasons,
    hardClassification
  };
}

function detectCriticalRisk(features) {
  if (features.riskState.dataLoss) {
    return "explicit data loss risk";
  }

  if (features.risk.security && (features.riskState.vulnerability || features.riskState.incident || features.riskState.userImpact)) {
    return "security/auth risk with vulnerability, incident, or user impact";
  }

  if ((features.risk.payment || features.risk.funds) && (features.riskState.failure || features.riskState.incident || features.riskState.userImpact)) {
    return "payment/funds risk with failure, incident, or user impact";
  }

  if (features.risk.production && (features.riskState.incident || features.riskState.failure || features.riskState.dataLoss)) {
    return "production risk with incident, failure, or data loss";
  }

  if (features.riskState.incident && (features.risk.data || features.riskState.rootCause)) {
    return "incident involving data or root-cause analysis";
  }

  return null;
}

function applyReviewSignals(features, scores, reasons) {
  if (features.review.followUp) {
    scores.complex += 4;
    reasons.push("complex +4: review follow-up request");
  }
  if (features.review.feedback) {
    scores.complex += 4;
    reasons.push("complex +4: review feedback follow-up signal");
  }
  if (features.review.review) {
    scores.complex += 3;
    reasons.push("complex +3: code review request");
  }
  if (features.review.prMr) {
    scores.complex += 3;
    reasons.push("complex +3: PR/MR review signal");
  }
  if (features.review.chineseReview) {
    scores.complex += 3;
    reasons.push("complex +3: Chinese review signal");
  }
}

function applyComplexSignals(features, scores, reasons) {
  if (features.complex.architecture) {
    scores.complex += 3;
    reasons.push("complex +3: architecture work");
  }
  if (features.complex.rootCauseOrMigration) {
    scores.complex += 3;
    reasons.push("complex +3: root-cause or migration work");
  }
  if (features.complex.chineseDesignOrScope) {
    scores.complex += 3;
    reasons.push("complex +3: complex design or debugging");
  }
  if (features.complex.multiStepEngineering) {
    scores.complex += 2;
    reasons.push("complex +2: multi-step engineering signal");
  }
  if (features.complex.chineseMultiStepEngineering) {
    scores.complex += 2;
    reasons.push("complex +2: multi-step Chinese engineering signal");
  }
  if (features.complex.refactor) {
    scores.complex += 1;
    reasons.push("complex +1: refactor signal");
  }
}

function applyCodingSignals(features, scores, reasons) {
  if (features.coding.taskTerm) {
    scores.coding += 3;
    reasons.push("coding +3: coding task term");
  }
  if (features.coding.artifactTerm) {
    scores.coding += 2;
    reasons.push("coding +2: engineering artifact term");
  }
  if (features.coding.chineseTaskTerm) {
    scores.coding += 3;
    reasons.push("coding +3: coding task Chinese term");
  }
  if (features.coding.chineseArtifactTerm) {
    scores.coding += 2;
    reasons.push("coding +2: engineering artifact Chinese term");
  }
}

function applySimpleSignals(features, scores, reasons) {
  if (features.simple.explanation) {
    scores.simple += 3;
    reasons.push("simple +3: simple explanation term");
  }
  if (features.simple.documentation) {
    scores.simple += 2;
    reasons.push("simple +2: documentation/question signal");
  }
  if (features.simple.chineseQuestion) {
    scores.simple += 3;
    reasons.push("simple +3: simple Chinese question term");
  }
  if (features.simple.lightweight) {
    scores.simple += 2;
    reasons.push("simple +2: explicit lightweight request");
  }
}

function applyTaskShapeSignals(features, scores, reasons) {
  if (features.technicalContext.any && features.intent.investigateOrFix && hasRegressionOrRecurrence(features)) {
    scores.complex += 4;
    reasons.push("complex +4: technical regression or repeated issue with inspect/fix intent");
  } else if (features.technicalContext.any && features.intent.investigateOrFix && features.surface.deepEngineering) {
    scores.complex += 3;
    reasons.push("complex +3: deep engineering surface with inspect/fix intent");
  }

  if (features.technicalContext.any && features.intent.change) {
    scores.coding += 3;
    reasons.push("coding +3: technical change request");
  }
}

function applyLengthSignals(features, scores, reasons) {
  if (features.charLength >= 600) {
    scores.complex += 2;
    reasons.push("complex +2: long prompt");
  } else if (features.charLength >= 220) {
    scores.complex += 1;
    reasons.push("complex +1: medium-length prompt");
  }

  if (features.lineCount >= 8) {
    scores.complex += 1;
    reasons.push("complex +1: multi-line prompt");
  }
}

function applyThreadSignals(threadState, scores, reasons) {
  if (!threadState) return;

  if (threadState.continuation) {
    scores.coding += 1;
    reasons.push("coding +1: continuing existing task");
  }

  if (threadState.previousEffort === "xhigh") {
    scores.complex += 2;
    reasons.push("complex +2: previous turn used xhigh");
  } else if (threadState.previousEffort === "high") {
    scores.complex += 1;
    reasons.push("complex +1: previous turn used high");
  }

  if (threadState.activeReview) {
    scores.complex += 3;
    reasons.push("complex +3: active review context");
  }
}

function applyFallbackSignals(features, scores, reasons) {
  if (Object.values(scores).some((score) => score > 0)) return;

  if (features.charLength < 80) {
    scores.simple += 1;
    reasons.push("simple +1: short prompt fallback");
  } else {
    scores.coding += 1;
    reasons.push("coding +1: default non-trivial prompt fallback");
  }
}

