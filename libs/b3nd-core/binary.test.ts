/**
 * Binary utilities test suite
 *
 * Tests for isBinary, isEncodedBinary, encodeBinaryForJson, decodeBinaryFromJson.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import {
  decodeBinaryFromJson,
  encodeBinaryForJson,
  isBinary,
  isEncodedBinary,
} from "./binary.ts";

// ── isBinary ─────────────────────────────────────────────────────────

Deno.test("isBinary: Uint8Array returns true", () => {
  assertEquals(isBinary(new Uint8Array([1, 2, 3])), true);
});

Deno.test("isBinary: empty Uint8Array returns true", () => {
  assertEquals(isBinary(new Uint8Array([])), true);
});

Deno.test("isBinary: ArrayBuffer returns true", () => {
  assertEquals(isBinary(new ArrayBuffer(8)), true);
});

Deno.test("isBinary: empty ArrayBuffer returns true", () => {
  assertEquals(isBinary(new ArrayBuffer(0)), true);
});

Deno.test("isBinary: string returns false", () => {
  assertEquals(isBinary("hello"), false);
});

Deno.test("isBinary: number returns false", () => {
  assertEquals(isBinary(42), false);
});

Deno.test("isBinary: null returns false", () => {
  assertEquals(isBinary(null), false);
});

Deno.test("isBinary: undefined returns false", () => {
  assertEquals(isBinary(undefined), false);
});

Deno.test("isBinary: plain object returns false", () => {
  assertEquals(isBinary({ data: [1, 2, 3] }), false);
});

Deno.test("isBinary: array returns false", () => {
  assertEquals(isBinary([1, 2, 3]), false);
});

// ── isEncodedBinary ──────────────────────────────────────────────────

Deno.test("isEncodedBinary: valid encoded object returns true", () => {
  assertEquals(
    isEncodedBinary({ __b3nd_binary__: true, data: "AQID" }),
    true,
  );
});

Deno.test("isEncodedBinary: missing marker returns false", () => {
  assertEquals(isEncodedBinary({ data: "AQID" }), false);
});

Deno.test("isEncodedBinary: marker is false returns false", () => {
  assertEquals(
    isEncodedBinary({ __b3nd_binary__: false, data: "AQID" }),
    false,
  );
});

Deno.test("isEncodedBinary: null returns false", () => {
  assertEquals(isEncodedBinary(null), false);
});

Deno.test("isEncodedBinary: string returns false", () => {
  assertEquals(isEncodedBinary("hello"), false);
});

Deno.test("isEncodedBinary: number returns false", () => {
  assertEquals(isEncodedBinary(42), false);
});

Deno.test("isEncodedBinary: Uint8Array returns false", () => {
  assertEquals(isEncodedBinary(new Uint8Array([1, 2])), false);
});

// ── encodeBinaryForJson ──────────────────────────────────────────────

Deno.test("encodeBinaryForJson: Uint8Array produces encoded object", () => {
  const result = encodeBinaryForJson(new Uint8Array([1, 2, 3]));
  assertEquals(isEncodedBinary(result), true);
});

Deno.test("encodeBinaryForJson: ArrayBuffer produces encoded object", () => {
  const buf = new ArrayBuffer(3);
  const view = new Uint8Array(buf);
  view[0] = 1;
  view[1] = 2;
  view[2] = 3;
  const result = encodeBinaryForJson(buf);
  assertEquals(isEncodedBinary(result), true);
});

Deno.test("encodeBinaryForJson: empty Uint8Array produces encoded object", () => {
  const result = encodeBinaryForJson(new Uint8Array([]));
  assertEquals(isEncodedBinary(result), true);
});

Deno.test("encodeBinaryForJson: string passes through unchanged", () => {
  assertEquals(encodeBinaryForJson("hello"), "hello");
});

Deno.test("encodeBinaryForJson: number passes through unchanged", () => {
  assertEquals(encodeBinaryForJson(42), 42);
});

Deno.test("encodeBinaryForJson: null passes through unchanged", () => {
  assertEquals(encodeBinaryForJson(null), null);
});

Deno.test("encodeBinaryForJson: object passes through unchanged", () => {
  const obj = { key: "value" };
  assertEquals(encodeBinaryForJson(obj), obj);
});

Deno.test("encodeBinaryForJson: boolean passes through unchanged", () => {
  assertEquals(encodeBinaryForJson(true), true);
});

// ── decodeBinaryFromJson ─────────────────────────────────────────────

Deno.test("decodeBinaryFromJson: encoded object returns Uint8Array", () => {
  const encoded = encodeBinaryForJson(new Uint8Array([1, 2, 3]));
  const decoded = decodeBinaryFromJson(encoded);
  assertEquals(decoded instanceof Uint8Array, true);
  assertEquals(decoded, new Uint8Array([1, 2, 3]));
});

Deno.test("decodeBinaryFromJson: string passes through unchanged", () => {
  assertEquals(decodeBinaryFromJson("hello"), "hello");
});

Deno.test("decodeBinaryFromJson: number passes through unchanged", () => {
  assertEquals(decodeBinaryFromJson(42), 42);
});

Deno.test("decodeBinaryFromJson: null passes through unchanged", () => {
  assertEquals(decodeBinaryFromJson(null), null);
});

Deno.test("decodeBinaryFromJson: plain object passes through unchanged", () => {
  const obj = { key: "value" };
  assertEquals(decodeBinaryFromJson(obj), obj);
});

// ── round-trip ───────────────────────────────────────────────────────

Deno.test("binary round-trip: encode then decode preserves Uint8Array", () => {
  const original = new Uint8Array([0, 1, 127, 128, 255]);
  const encoded = encodeBinaryForJson(original);
  const decoded = decodeBinaryFromJson(encoded);
  assertEquals(decoded, original);
});

Deno.test("binary round-trip: encode then decode preserves ArrayBuffer", () => {
  const buf = new ArrayBuffer(4);
  const view = new Uint8Array(buf);
  view.set([0xde, 0xad, 0xbe, 0xef]);
  const encoded = encodeBinaryForJson(buf);
  const decoded = decodeBinaryFromJson(encoded) as Uint8Array;
  assertEquals(decoded, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
});

Deno.test("binary round-trip: empty binary data", () => {
  const original = new Uint8Array([]);
  const encoded = encodeBinaryForJson(original);
  const decoded = decodeBinaryFromJson(encoded) as Uint8Array;
  assertEquals(decoded.length, 0);
});

Deno.test("binary round-trip: all 256 byte values", () => {
  const original = new Uint8Array(256);
  for (let i = 0; i < 256; i++) original[i] = i;
  const encoded = encodeBinaryForJson(original);
  const decoded = decodeBinaryFromJson(encoded);
  assertEquals(decoded, original);
});

// ── JSON serialization ───────────────────────────────────────────────

Deno.test("JSON serialization: encoded binary survives JSON.stringify/parse", () => {
  const original = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);
  const encoded = encodeBinaryForJson(original);
  const json = JSON.stringify(encoded);
  const parsed = JSON.parse(json);
  assertEquals(isEncodedBinary(parsed), true);
  const decoded = decodeBinaryFromJson(parsed);
  assertEquals(decoded, original);
});

Deno.test("JSON serialization: non-binary values serialize normally", () => {
  const data = { name: "test", count: 42 };
  const encoded = encodeBinaryForJson(data);
  const json = JSON.stringify(encoded);
  assertEquals(JSON.parse(json), data);
});
