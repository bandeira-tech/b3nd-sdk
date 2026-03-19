/**
 * Encoding Utilities Test Suite
 *
 * Tests for hex and base64 encoding/decoding functions.
 */

/// <reference lib="deno.ns" />

import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  decodeBase64,
  decodeHex,
  encodeBase64,
  encodeHex,
} from "./encoding.ts";

// ============================================================================
// Hex Encoding
// ============================================================================

Deno.test("encodeHex — empty array", () => {
  assertEquals(encodeHex(new Uint8Array([])), "");
});

Deno.test("encodeHex — single byte", () => {
  assertEquals(encodeHex(new Uint8Array([0])), "00");
  assertEquals(encodeHex(new Uint8Array([255])), "ff");
  assertEquals(encodeHex(new Uint8Array([16])), "10");
  assertEquals(encodeHex(new Uint8Array([1])), "01");
});

Deno.test("encodeHex — multiple bytes", () => {
  assertEquals(encodeHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef])), "deadbeef");
  assertEquals(
    encodeHex(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f])),
    "48656c6c6f",
  );
});

Deno.test("encodeHex — all zeros", () => {
  assertEquals(encodeHex(new Uint8Array([0, 0, 0, 0])), "00000000");
});

// ============================================================================
// Hex Decoding
// ============================================================================

Deno.test("decodeHex — empty string", () => {
  assertEquals(decodeHex(""), new Uint8Array([]));
});

Deno.test("decodeHex — valid hex", () => {
  assertEquals(decodeHex("deadbeef"), new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  assertEquals(decodeHex("00ff"), new Uint8Array([0, 255]));
});

Deno.test("decodeHex — uppercase hex", () => {
  assertEquals(decodeHex("DEADBEEF"), new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
});

Deno.test("decodeHex — odd-length string throws", () => {
  assertThrows(() => decodeHex("abc"), Error, "Invalid hex input");
  assertThrows(() => decodeHex("a"), Error, "Invalid hex input");
});

// ============================================================================
// Hex Round-trip
// ============================================================================

Deno.test("hex round-trip — encode then decode", () => {
  const original = new Uint8Array([1, 2, 3, 100, 200, 255]);
  const hex = encodeHex(original);
  const decoded = decodeHex(hex);
  assertEquals(decoded, original);
});

Deno.test("hex round-trip — decode then encode", () => {
  const original = "0102036400c8ff";
  const bytes = decodeHex(original);
  const reEncoded = encodeHex(bytes);
  assertEquals(reEncoded, original);
});

Deno.test("hex round-trip — 32-byte key-sized data", () => {
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key[i] = i;
  const hex = encodeHex(key);
  assertEquals(hex.length, 64);
  const decoded = decodeHex(hex);
  assertEquals(decoded, key);
});

// ============================================================================
// Base64 Encoding
// ============================================================================

Deno.test("encodeBase64 — empty array", () => {
  assertEquals(encodeBase64(new Uint8Array([])), "");
});

Deno.test("encodeBase64 — known values", () => {
  // "Hello" in base64 = "SGVsbG8="
  const hello = new TextEncoder().encode("Hello");
  assertEquals(encodeBase64(hello), "SGVsbG8=");
});

Deno.test("encodeBase64 — single byte", () => {
  assertEquals(encodeBase64(new Uint8Array([0])), "AA==");
  assertEquals(encodeBase64(new Uint8Array([255])), "/w==");
});

Deno.test("encodeBase64 — binary data with padding", () => {
  // 1 byte → 4 chars with ==
  assertEquals(encodeBase64(new Uint8Array([65])).endsWith("="), true);
  // 2 bytes → 4 chars with =
  assertEquals(encodeBase64(new Uint8Array([65, 66])).endsWith("="), true);
  // 3 bytes → 4 chars, no padding
  const noPad = encodeBase64(new Uint8Array([65, 66, 67]));
  assertEquals(noPad.endsWith("="), false);
});

// ============================================================================
// Base64 Decoding
// ============================================================================

Deno.test("decodeBase64 — empty string", () => {
  assertEquals(decodeBase64(""), new Uint8Array([]));
});

Deno.test("decodeBase64 — known values", () => {
  const decoded = decodeBase64("SGVsbG8=");
  assertEquals(new TextDecoder().decode(decoded), "Hello");
});

Deno.test("decodeBase64 — single byte", () => {
  assertEquals(decodeBase64("AA=="), new Uint8Array([0]));
  assertEquals(decodeBase64("/w=="), new Uint8Array([255]));
});

// ============================================================================
// Base64 Round-trip
// ============================================================================

Deno.test("base64 round-trip — encode then decode", () => {
  const original = new Uint8Array([0, 1, 2, 127, 128, 255]);
  const b64 = encodeBase64(original);
  const decoded = decodeBase64(b64);
  assertEquals(decoded, original);
});

Deno.test("base64 round-trip — text content", () => {
  const text = "The quick brown fox jumps over the lazy dog";
  const bytes = new TextEncoder().encode(text);
  const b64 = encodeBase64(bytes);
  const decoded = decodeBase64(b64);
  assertEquals(new TextDecoder().decode(decoded), text);
});

Deno.test("base64 round-trip — large data (1024 bytes)", () => {
  const data = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) data[i] = i % 256;
  const b64 = encodeBase64(data);
  const decoded = decodeBase64(b64);
  assertEquals(decoded, data);
});

// ============================================================================
// Determinism
// ============================================================================

Deno.test("encoding determinism — same input always produces same output", () => {
  const data = new Uint8Array([42, 137, 200, 0, 255]);
  const hex1 = encodeHex(data);
  const hex2 = encodeHex(data);
  assertEquals(hex1, hex2);

  const b64_1 = encodeBase64(data);
  const b64_2 = encodeBase64(data);
  assertEquals(b64_1, b64_2);
});
