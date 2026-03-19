import { assertEquals } from "@std/assert";
import { uri } from "./uri.ts";

// ── parse ──

Deno.test("uri.parse - mutable URI", () => {
  const result = uri.parse("mutable://open/items/42");
  assertEquals(result, {
    protocol: "mutable",
    segments: ["open", "items", "42"],
    raw: "mutable://open/items/42",
  });
});

Deno.test("uri.parse - hash URI", () => {
  const result = uri.parse("hash://sha256/abc123");
  assertEquals(result, {
    protocol: "hash",
    segments: ["sha256", "abc123"],
    raw: "hash://sha256/abc123",
  });
});

Deno.test("uri.parse - accounts URI", () => {
  const result = uri.parse("accounts://deadbeef/profile");
  assertEquals(result, {
    protocol: "accounts",
    segments: ["deadbeef", "profile"],
    raw: "accounts://deadbeef/profile",
  });
});

Deno.test("uri.parse - protocol only", () => {
  const result = uri.parse("mutable://");
  assertEquals(result?.protocol, "mutable");
  assertEquals(result?.segments, []);
});

Deno.test("uri.parse - invalid URI returns null", () => {
  assertEquals(uri.parse("bad-uri"), null);
  assertEquals(uri.parse("ftp://foo/bar"), null);
  assertEquals(uri.parse(""), null);
  assertEquals(uri.parse("://empty"), null);
});

// ── isValid ──

Deno.test("uri.isValid - valid URIs", () => {
  assertEquals(uri.isValid("mutable://open/test"), true);
  assertEquals(uri.isValid("hash://sha256/abc"), true);
  assertEquals(uri.isValid("accounts://pk/data"), true);
});

Deno.test("uri.isValid - invalid URIs", () => {
  assertEquals(uri.isValid("bad-uri"), false);
  assertEquals(uri.isValid("http://example.com"), false);
  assertEquals(uri.isValid(""), false);
});

// ── protocol checks ──

Deno.test("uri.isMutable", () => {
  assertEquals(uri.isMutable("mutable://open/test"), true);
  assertEquals(uri.isMutable("hash://sha256/abc"), false);
});

Deno.test("uri.isHash", () => {
  assertEquals(uri.isHash("hash://sha256/abc"), true);
  assertEquals(uri.isHash("mutable://open/test"), false);
});

Deno.test("uri.isAccounts", () => {
  assertEquals(uri.isAccounts("accounts://pk/data"), true);
  assertEquals(uri.isAccounts("mutable://open/test"), false);
});

// ── builders ──

Deno.test("uri.mutable - builds mutable URI", () => {
  assertEquals(uri.mutable("open", "items", "42"), "mutable://open/items/42");
});

Deno.test("uri.mutable - single segment", () => {
  assertEquals(uri.mutable("open"), "mutable://open");
});

Deno.test("uri.hash - builds hash URI", () => {
  assertEquals(uri.hash("sha256", "abc123"), "hash://sha256/abc123");
});

Deno.test("uri.accounts - builds accounts URI", () => {
  const pk = "deadbeef".repeat(8);
  assertEquals(
    uri.accounts(pk, "profile"),
    `accounts://${pk}/profile`,
  );
});

Deno.test("uri.accounts - pubkey only", () => {
  assertEquals(uri.accounts("deadbeef"), "accounts://deadbeef");
});

Deno.test("uri.accounts - with multiple path segments", () => {
  assertEquals(
    uri.accounts("pk", "nodes", "n1", "config"),
    "accounts://pk/nodes/n1/config",
  );
});

// ── parent ──

Deno.test("uri.parent - returns parent path", () => {
  assertEquals(uri.parent("mutable://open/items/42"), "mutable://open/items");
});

Deno.test("uri.parent - single segment returns protocol root", () => {
  assertEquals(uri.parent("mutable://open"), "mutable://");
});

Deno.test("uri.parent - protocol root returns null", () => {
  assertEquals(uri.parent("mutable://"), null);
});

Deno.test("uri.parent - invalid URI returns null", () => {
  assertEquals(uri.parent("bad-uri"), null);
});

// ── key ──

Deno.test("uri.key - returns last segment", () => {
  assertEquals(uri.key("mutable://open/items/42"), "42");
});

Deno.test("uri.key - single segment", () => {
  assertEquals(uri.key("mutable://open"), "open");
});

Deno.test("uri.key - no segments returns null", () => {
  assertEquals(uri.key("mutable://"), null);
});

Deno.test("uri.key - invalid URI returns null", () => {
  assertEquals(uri.key("bad"), null);
});

// ── join ──

Deno.test("uri.join - appends segments", () => {
  assertEquals(
    uri.join("mutable://open/items", "42", "meta"),
    "mutable://open/items/42/meta",
  );
});

Deno.test("uri.join - handles trailing slash", () => {
  assertEquals(
    uri.join("mutable://open/", "test"),
    "mutable://open/test",
  );
});

Deno.test("uri.join - single segment", () => {
  assertEquals(
    uri.join("mutable://open", "key"),
    "mutable://open/key",
  );
});
