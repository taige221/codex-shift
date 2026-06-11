import test from "node:test";
import assert from "node:assert/strict";
import { buildListenUrl, parseWsUrl } from "../src/proxy/ws-url.js";

test("parses ws URLs with host and port", () => {
  const url = parseWsUrl("ws://127.0.0.1:17891", "listen");

  assert.equal(url.protocol, "ws:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "17891");
});

test("rejects missing ws URL values", () => {
  assert.throws(
    () => parseWsUrl(null, "target"),
    /Missing --target\./
  );
});

test("rejects unsupported ws URL protocols", () => {
  assert.throws(
    () => parseWsUrl("wss://127.0.0.1:17891", "listen"),
    /Unsupported listen URL wss:\/\/127\.0\.0\.1:17891\. Only ws:\/\/ is supported in this preview\./
  );
});

test("rejects ws URLs without explicit port", () => {
  assert.throws(
    () => parseWsUrl("ws://127.0.0.1", "listen"),
    /listen URL must include host and port\./
  );
});

test("builds the listen URL from the bound server port", () => {
  assert.equal(
    buildListenUrl(new URL("ws://127.0.0.1:0"), { port: 43210 }),
    "ws://127.0.0.1:43210"
  );
});
