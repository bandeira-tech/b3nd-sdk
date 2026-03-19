/**
 * Encoding utilities test suite
 *
 * Tests for encodeHex, decodeHex, encodeBase64, decodeBase64.
 */

/// <reference lib="deno.ns" />

import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  decodeBase64,
  decodeHex,
  encodeBase64,
  encodeHex,
} from "./encoding.ts";

// ── encodeHex ────────────────────────────────────────────────────────

Deno.test("encodeHex: empty Uint8Array returns empty string", () => {
  assertEquals(encodeHex(new Uint8Array([])), "");
});

Deno.test("encodeHex: single byte", () => {
  assertEquals(encodeHex(new Uint8Array([0x00])), "00");
  assertEquals(encodeHex(new Uint8Array([0x0a])), "0a");
  assertEquals(encodeHex(new Uint8Array([0xff])), "ff");
});

Deno.test("encodeHex: multiple bytes", () => {
  assertEquals(encodeHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef])), "deadbeef");
});

Deno.test("encodeHex: all zeros", () => {
  assertEquals(encodeHex(new Uint8Array([0, 0, 0, 0])), "00000000");
});

Deno.test("encodeHex: sequential bytes", () => {
  const bytes = new Uint8Array([0, 1, 2, 15, 16, 127, 128, 255]);
  assertEquals(encodeHex(bytes), "0001020f107f80ff");
});

// ── decodeHex ────────────────────────────────────────────────────────

Deno.test("decodeHex: empty string returns empty Uint8Array", () => {
  const result = decodeHex("");
  assertEquals(result.length, 0);
});

Deno.test("decodeHex: single byte", () => {
  assertEquals(decodeHex("00"), new Uint8Array([0x00]));
  assertEquals(decodeHex("ff"), new Uint8Array([0xff]));
  assertEquals(decodeHex("0a"), new Uint8Array([0x0a]));
});

Deno.test("decodeHex: multiple bytes", () => {
  assertEquals(decodeHex("deadbeef"), new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
});

Deno.test("decodeHex: uppercase hex", () => {
  assertEquals(decodeHex("DEADBEEF"), new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
});

Deno.test("decodeHex: mixed case hex", () => {
  assertEquals(decodeHex("DeAdBeEf"), new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
});

Deno.test("decodeHex: odd-length string throws", () => {
  assertThrows(() => decodeHex("abc"), Error, "Invalid hex input");
});

Deno.test("decodeHex: single character throws", () => {
  assertThrows(() => decodeHex("f"), Error, "Invalid hex input");
});

// ── hex round-trip ───────────────────────────────────────────────────

Deno.test("hex round-trip: encode then decode preserves data", () => {
  const original = new Uint8Array([0, 1, 127, 128, 255, 42, 99]);
  const hex = encodeHex(original);
  const decoded = decodeHex(hex);
  assertEquals(decoded, original);
});

Deno.test("hex round-trip: large data", () => {
  const original = new Uint8Array(256);
  for (let i = 0; i < 256; i++) original[i] = i;
  const hex = encodeHex(original);
  assertEquals(hex.length, 512);
  const decoded = decodeHex(hex);
  assertEquals(decoded, original);
});

// ── encodeBase64 ─────────────────────────────────────────────────────

Deno.test("encodeBase64: empty Uint8Array returns empty string", () => {
  assertEquals(encodeBase64(new Uint8Array([])), "");
});

Deno.test("encodeBase64: 'Hello' bytes", () => {
  const bytes = new TextEncoder().encode("Hello");
  assertEquals(encodeBase64(bytes), "SGVsbG8=");
});

Deno.test("encodeBase64: single byte", () => {
  assertEquals(encodeBase64(new Uint8Array([0])), "AA==");
  assertEquals(encodeBase64(new Uint8Array([255])), "/w==");
});

Deno.test("encodeBase64: three bytes (no padding)", () => {
  assertEquals(encodeBase64(new Uint8Array([1, 2, 3])), "AQID");
});

Deno.test("encodeBase64: two bytes (one pad)", () => {
  assertEquals(encodeBase64(new Uint8Array([1, 2])), "AQI=");
});

// ── decodeBase64 ─────────────────────────────────────────────────────

Deno.test("decodeBase64: empty string returns empty Uint8Array", () => {
  const result = decodeBase64("");
  assertEquals(result.length, 0);
});

Deno.test("decodeBase64: 'Hello' from base64", () => {
  const decoded = decodeBase64("SGVsbG8=");
  assertEquals(new TextDecoder().decode(decoded), "Hello");
});

Deno.test("decodeBase64: no padding", () => {
  const decoded = decodeBase64("AQID");
  assertEquals(decoded, new Uint8Array([1, 2, 3]));
});

Deno.test("decodeBase64: with padding", () => {
  const decoded = decodeBase64("AQI=");
  assertEquals(decoded, new Uint8Array([1, 2]));
});

// ── base64 round-trip ────────────────────────────────────────────────

Deno.test("base64 round-trip: encode then decode preserves data", () => {
  const original = new Uint8Array([0, 1, 127, 128, 255, 42, 99]);
  const b64 = encodeBase64(original);
  const decoded = decodeBase64(b64);
  assertEquals(decoded, original);
});

Deno.test("base64 round-trip: all 256 byte values", () => {
  const original = new Uint8Array(256);
  for (let i = 0; i < 256; i++) original[i] = i;
  const b64 = encodeBase64(original);
  const decoded = decodeBase64(b64);
  assertEquals(decoded, original);
});

Deno.test("base64 round-trip: binary data with nulls", () => {
  const original = new Uint8Array([0, 0, 0, 1, 0, 0, 0]);
  const b64 = encodeBase64(original);
  const decoded = decodeBase64(b64);
  assertEquals(decoded, original);
});

// ── cross-format ─────────────────────────────────────────────────────

Deno.test("cross-format: hex and base64 represent same data", () => {
  const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  const hex = encodeHex(data);
  const b64 = encodeBase64(data);

  const fromHex = decodeHex(hex);
  const fromB64 = decodeBase64(b64);
  assertEquals(fromHex, fromB64);
});
