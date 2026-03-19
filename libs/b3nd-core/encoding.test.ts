import { assertEquals, assertThrows } from "@std/assert";
import {
  decodeBase64,
  decodeHex,
  encodeBase64,
  encodeHex,
} from "./encoding.ts";

// ── encodeHex ──

Deno.test("encodeHex - empty array returns empty string", () => {
  assertEquals(encodeHex(new Uint8Array([])), "");
});

Deno.test("encodeHex - single byte", () => {
  assertEquals(encodeHex(new Uint8Array([0])), "00");
  assertEquals(encodeHex(new Uint8Array([255])), "ff");
  assertEquals(encodeHex(new Uint8Array([15])), "0f");
  assertEquals(encodeHex(new Uint8Array([16])), "10");
});

Deno.test("encodeHex - multiple bytes", () => {
  assertEquals(encodeHex(new Uint8Array([1, 2, 3])), "010203");
  assertEquals(encodeHex(new Uint8Array([222, 173, 190, 239])), "deadbeef");
});

Deno.test("encodeHex - all zero bytes", () => {
  assertEquals(encodeHex(new Uint8Array([0, 0, 0])), "000000");
});

Deno.test("encodeHex - all 0xff bytes", () => {
  assertEquals(encodeHex(new Uint8Array([255, 255])), "ffff");
});

// ── decodeHex ──

Deno.test("decodeHex - empty string returns empty array", () => {
  assertEquals(decodeHex(""), new Uint8Array([]));
});

Deno.test("decodeHex - single byte", () => {
  assertEquals(decodeHex("00"), new Uint8Array([0]));
  assertEquals(decodeHex("ff"), new Uint8Array([255]));
  assertEquals(decodeHex("0f"), new Uint8Array([15]));
  assertEquals(decodeHex("FF"), new Uint8Array([255]));
});

Deno.test("decodeHex - multiple bytes", () => {
  assertEquals(decodeHex("010203"), new Uint8Array([1, 2, 3]));
  assertEquals(decodeHex("deadbeef"), new Uint8Array([222, 173, 190, 239]));
});

Deno.test("decodeHex - throws on odd-length input", () => {
  assertThrows(() => decodeHex("abc"), Error, "Invalid hex input");
  assertThrows(() => decodeHex("0"), Error, "Invalid hex input");
});

// ── hex round-trip ──

Deno.test("hex round-trip - encode then decode", () => {
  const original = new Uint8Array([0, 127, 128, 255, 1, 42]);
  assertEquals(decodeHex(encodeHex(original)), original);
});

Deno.test("hex round-trip - 32-byte key-like data", () => {
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key[i] = i * 8;
  assertEquals(decodeHex(encodeHex(key)), key);
});

// ── encodeBase64 ──

Deno.test("encodeBase64 - empty array", () => {
  assertEquals(encodeBase64(new Uint8Array([])), "");
});

Deno.test("encodeBase64 - known values", () => {
  // "Hello" in ASCII
  assertEquals(
    encodeBase64(new Uint8Array([72, 101, 108, 108, 111])),
    "SGVsbG8=",
  );
});

Deno.test("encodeBase64 - single byte", () => {
  assertEquals(encodeBase64(new Uint8Array([0])), "AA==");
  assertEquals(encodeBase64(new Uint8Array([255])), "/w==");
});

Deno.test("encodeBase64 - binary data", () => {
  assertEquals(encodeBase64(new Uint8Array([1, 2, 3])), "AQID");
});

// ── decodeBase64 ──

Deno.test("decodeBase64 - empty string", () => {
  assertEquals(decodeBase64(""), new Uint8Array([]));
});

Deno.test("decodeBase64 - known values", () => {
  assertEquals(
    decodeBase64("SGVsbG8="),
    new Uint8Array([72, 101, 108, 108, 111]),
  );
});

Deno.test("decodeBase64 - binary data", () => {
  assertEquals(decodeBase64("AQID"), new Uint8Array([1, 2, 3]));
});

// ── base64 round-trip ──

Deno.test("base64 round-trip - encode then decode", () => {
  const original = new Uint8Array([0, 127, 128, 255, 1, 42]);
  assertEquals(decodeBase64(encodeBase64(original)), original);
});

Deno.test("base64 round-trip - large data", () => {
  const data = new Uint8Array(256);
  for (let i = 0; i < 256; i++) data[i] = i;
  assertEquals(decodeBase64(encodeBase64(data)), data);
});

// ── cross-codec consistency ──

Deno.test("hex and base64 encode same input consistently", () => {
  const input = new Uint8Array([222, 173, 190, 239]);
  const hex = encodeHex(input);
  const b64 = encodeBase64(input);
  assertEquals(decodeHex(hex), decodeBase64(b64));
});
