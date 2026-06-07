import { CLASSIFICATIONS, createEmptyScores } from "./types.js";

export function mergeAssessments(ruleResult, semanticResult) {
  const scores = {
    ...createEmptyScores(),
    ...ruleResult.scores
  };
  const reasons = [...ruleResult.reasons];

  if (semanticResult?.scores) {
    for (const classification of CLASSIFICATIONS) {
      scores[classification] += semanticResult.scores[classification] ?? 0;
    }
    reasons.push(...(semanticResult.reasons ?? []));
  }

  const classification = ruleResult.hardClassification ?? semanticResult?.classification ?? pickClassification(scores);

  return {
    classification,
    confidence: calculateConfidence(scores, classification, Boolean(ruleResult.hardClassification)),
    scores,
    reasons
  };
}

export function pickClassification(scores) {
  if (scores.critical >= 4) return "critical";
  if (scores.complex >= 3 || (scores.coding >= 2 && scores.complex >= 2)) return "complex";

  const ranked = CLASSIFICATIONS
    .map((classification) => ({ classification, score: scores[classification] }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return CLASSIFICATIONS.indexOf(right.classification) - CLASSIFICATIONS.indexOf(left.classification);
    });

  return ranked[0].score > 0 ? ranked[0].classification : "coding";
}

export function calculateConfidence(scores, classification, hardClassification = false) {
  const rankedScores = Object.values(scores).sort((left, right) => right - left);
  const top = rankedScores[0] ?? 0;
  const second = rankedScores[1] ?? 0;
  const margin = Math.max(0, top - second);
  const signalCount = Object.values(scores).filter((score) => score > 0).length;
  const confidence = 0.48
    + margin * 0.08
    + signalCount * 0.04
    + (classification === "critical" ? 0.08 : 0)
    + (hardClassification ? 0.04 : 0);
  return Math.max(0.5, Math.min(0.95, Number(confidence.toFixed(2))));
}

