/**
 * @module
 * Tests for `pathVector()` — loop avoidance via signer-chain inspection.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import type { Message } from "../../b3nd-core/types.ts";
import type { Peer } from "../types.ts";
import { pathVector } from "./path-vector.ts";

function fakePeer(id: string): Peer {
  return {
    id,
    client: {
      receive: (m) => Promise.resolve(m.map(() => ({ accepted: true }))),
      read: () => Promise.resolve([]),
      observe: async function* () {},
      status: () => Promise.resolve({ status: "healthy" as const }),
    },
  };
}

/**
 * Build an AuthenticatedMessage-shaped payload whose signer chain
 * contains the given pubkeys in order. Signatures are fake — pathVector
 * only reads pubkeys, it does not verify.
 */
function authMsg(uri: string, signers: string[]): Message {
  return [
    uri,
    {},
    {
      auth: signers.map((pubkey) => ({ pubkey, signature: "fake" })),
      payload: { hello: "world" },
    },
  ];
}

const CTX = { originId: "me" };

// ── Skips peers in the signer chain ──────────────────────────────────

Deno.test("pathVector skips peers that appear in the signer chain", () => {
  const p = pathVector();
  const a = fakePeer("peer-A-pubkey");
  const b = fakePeer("peer-B-pubkey");
  const msg = authMsg("mutable://x/1", ["peer-A-pubkey"]);

  assertEquals(p.send!([msg], a, CTX), []);
  assertEquals(p.send!([msg], b, CTX), [msg]);
});

Deno.test("pathVector handles multi-hop chains", () => {
  const p = pathVector();
  const a = fakePeer("pk-A");
  const b = fakePeer("pk-B");
  const c = fakePeer("pk-C");
  const msg = authMsg("mutable://x/1", ["pk-A", "pk-B"]);

  // A and B are in the chain; C is fresh — only C is eligible.
  assertEquals(p.send!([msg], a, CTX), []);
  assertEquals(p.send!([msg], b, CTX), []);
  assertEquals(p.send!([msg], c, CTX), [msg]);
});

// ── No-op for messages without auth chain ────────────────────────────

Deno.test("pathVector passes through messages lacking an auth chain", () => {
  const p = pathVector();
  const a = fakePeer("pk-A");
  const plain: Message = ["mutable://x/1", {}, { no: "auth here" }];
  assertEquals(p.send!([plain], a, CTX), [plain]);
});

Deno.test("pathVector treats malformed auth as empty chain", () => {
  const p = pathVector();
  const a = fakePeer("pk-A");
  const weird1: Message = ["mutable://x/1", {}, { auth: "not-an-array" }];
  const weird2: Message = [
    "mutable://x/1",
    {},
    { auth: [{ no_pubkey: true }, { pubkey: 42 }] },
  ];
  assertEquals(p.send!([weird1, weird2], a, CTX), [weird1, weird2]);
});

Deno.test("pathVector handles null data gracefully", () => {
  const p = pathVector();
  const a = fakePeer("pk-A");
  const plain: Message = ["mutable://x/1", {}, null];
  assertEquals(p.send!([plain], a, CTX), [plain]);
});

// ── Mixed batches ────────────────────────────────────────────────────

Deno.test("pathVector filters per-message within a batch", () => {
  const p = pathVector();
  const a = fakePeer("pk-A");
  const filtered = authMsg("mutable://x/1", ["pk-A"]);
  const passed = authMsg("mutable://x/2", ["pk-B"]);
  const plain: Message = ["mutable://x/3", {}, "bare"];

  assertEquals(p.send!([filtered, passed, plain], a, CTX), [passed, plain]);
});
