/**
 * @module
 * Tests for `peer()` and `createNetwork(peers, policy?)` — the
 * participant-primitive factory.
 *
 * Network is data-only (peers + policy + originId); its NodeProtocolInterface
 * surface lives on `Federation` and is tested in `federation.test.ts`.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import { MemoryStore } from "../b3nd-client-memory/store.ts";
import { SimpleClient } from "../b3nd-core/simple-client.ts";
import type { NodeProtocolInterface } from "../b3nd-core/types.ts";
import { createNetwork, peer } from "./mod.ts";

function mem(): SimpleClient {
  return new SimpleClient(new MemoryStore());
}

// ── peer() ────────────────────────────────────────────────────────────

Deno.test("peer() assigns a runtime id when none is supplied", () => {
  const p1 = peer(mem());
  const p2 = peer(mem());
  if (!p1.id.startsWith("peer-")) throw new Error("auto id shape unexpected");
  if (p1.id === p2.id) throw new Error("auto ids must be unique");
});

Deno.test("peer() honors explicit id", () => {
  const p = peer(mem(), { id: "alice-pubkey" });
  assertEquals(p.id, "alice-pubkey");
});

Deno.test("peer() applies decorators in order", () => {
  const calls: string[] = [];
  const deco =
    (name: string) => (client: NodeProtocolInterface): NodeProtocolInterface =>
      ({
        receive: (msgs) => {
          calls.push(name);
          return client.receive(msgs);
        },
        read: (u) => client.read(u),
        observe: (p, s) => client.observe(p, s),
        status: () => client.status(),
      });

  const p = peer(mem(), { via: [deco("outer"), deco("inner")] });
  // Outer is applied last, so calls happen outer → inner.
  p.client.receive([["mutable://x/1", {}, "v"]]);
  assertEquals(calls, ["inner", "outer"]);
});

// ── createNetwork — shape & validation ────────────────────────────────

Deno.test("createNetwork returns a Network with peers, policy, originId", () => {
  const a = peer(mem(), { id: "A" });
  const b = peer(mem(), { id: "B" });
  const policy = { read: "first-match" as const };
  const net = createNetwork([a, b], policy);

  assertEquals(net.peers.length, 2);
  assertEquals(net.peers[0].id, "A");
  assertEquals(net.peers[1].id, "B");
  assertEquals(net.policy, policy);
  if (!net.originId.startsWith("net-")) {
    throw new Error("originId should be a generated network id");
  }
});

Deno.test("createNetwork freezes the peer list", () => {
  const a = peer(mem(), { id: "A" });
  const net = createNetwork([a]);
  // peers is declared `readonly`; runtime-freeze makes the guarantee real.
  let threw = false;
  try {
    (net.peers as Peer[]).push(peer(mem(), { id: "B" }));
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("expected frozen peers array");
});

// Import for the freeze test above.
import type { Peer } from "./mod.ts";

Deno.test("createNetwork rejects empty peer list", () => {
  let threw = false;
  try {
    createNetwork([]);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("expected empty peers to throw");
});

Deno.test("createNetwork rejects duplicate peer ids", () => {
  let threw = false;
  try {
    createNetwork([
      peer(mem(), { id: "X" }),
      peer(mem(), { id: "X" }),
    ]);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("expected duplicate ids to throw");
});

// ── Type-level guarantee ──────────────────────────────────────────────
//
// Network has no `receive`/`read`/`observe`/`status`, so passing it to
// anything expecting a NodeProtocolInterface fails at compile time. The
// best we can do at runtime is assert the properties are absent.

Deno.test("Network instances intentionally lack NodeProtocolInterface methods", () => {
  const net = createNetwork([peer(mem(), { id: "A" })]);
  // Cast to any to probe; production code never does this.
  // deno-lint-ignore no-explicit-any
  const asAny = net as any;
  assertEquals(typeof asAny.receive, "undefined");
  assertEquals(typeof asAny.read, "undefined");
  assertEquals(typeof asAny.observe, "undefined");
  assertEquals(typeof asAny.status, "undefined");
});
