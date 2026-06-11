import test from "node:test";
import assert from "node:assert/strict";
import {
  OPCODE_BINARY,
  OPCODE_TEXT,
  encodeFrame,
  readFrame
} from "../src/proxy/ws-frame.js";

test("encodes and decodes an unmasked text frame", () => {
  const encoded = encodeFrame(Buffer.from("hello"), OPCODE_TEXT);
  const decoded = readFrame(encoded);

  assert.equal(decoded.frame.fin, true);
  assert.equal(decoded.frame.opcode, OPCODE_TEXT);
  assert.equal(decoded.frame.payload.toString("utf8"), "hello");
  assert.equal(decoded.remaining.length, 0);
});

test("decodes masked client frames", () => {
  const decoded = readFrame(buildMaskedFrame("hello", OPCODE_TEXT));

  assert.equal(decoded.frame.opcode, OPCODE_TEXT);
  assert.equal(decoded.frame.payload.toString("utf8"), "hello");
});

test("returns null for incomplete frames", () => {
  assert.equal(readFrame(Buffer.from([0x81])), null);
  assert.equal(readFrame(Buffer.from([0x81, 126, 0x00])), null);
});

test("decodes extended payload lengths", () => {
  const payload = Buffer.alloc(130, "a");
  const decoded = readFrame(encodeFrame(payload, OPCODE_BINARY));

  assert.equal(decoded.frame.opcode, OPCODE_BINARY);
  assert.deepEqual(decoded.frame.payload, payload);
});

test("rejects frames larger than safe integer length", () => {
  const frame = Buffer.alloc(10);
  frame[0] = 0x82;
  frame[1] = 127;
  frame.writeBigUInt64BE(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 2);

  const decoded = readFrame(frame);

  assert.match(decoded.error.message, /too large/);
});

function buildMaskedFrame(text, opcode) {
  const payload = Buffer.from(text);
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] ^= mask[index % 4];
  }
  return Buffer.concat([header, mask, masked]);
}
