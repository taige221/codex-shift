import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { routePrompt } from "../src/router/index.js";

const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/router-eval.json", import.meta.url), "utf8")
);

for (const fixture of fixtures) {
  test(`router eval: ${fixture.name}`, () => {
    const decision = routePrompt(fixture.prompt, fixture.options ?? {});
    assert.equal(decision.classification, fixture.classification);
    assert.equal(decision.effort, fixture.effort);
    assert.equal(decision.readOnly, fixture.readOnly);
    assert.equal(Object.hasOwn(decision, "prompt"), false);
  });
}
