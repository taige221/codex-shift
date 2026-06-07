export function classifySemantically(features, options = {}) {
  if (typeof options.semanticClassifier !== "function") {
    return null;
  }

  return options.semanticClassifier(features);
}

