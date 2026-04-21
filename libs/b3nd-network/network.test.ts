/**
 * @module
 * Tests for `createNetwork(peers, policy?)` — the core primitive.
 *
 * Uses `MemoryStore + SimpleClient` as test peers so each peer emits
 * observe events when it receives a write. No sanitizers disabled —
 * every test is a real exercise of the fan-out / fan-in paths.
 */

/// <reference lib="deno.ns" />

import { assertEquals, assertRejects } from "jsr:@std/assert";
import { MemoryStore } from "../b3nd-client-memory/store.ts";
import { SimpleClient } from "../b3nd-core/simple-client.ts";
import type {
  Message,
  NodeProtocolInterface,
  ReadResult,
  StatusResult,
} from "../b3nd-core/types.ts";
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

// ── createNetwork — validation ────────────────────────────────────────

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

// ── receive — fan-out ─────────────────────────────────────────────────

Deno.test("network.receive fans out to every peer (default flood)", async () => {
  const a = mem();
  const b = mem();
  const net = createNetwork([peer(a, { id: "A" }), peer(b, { id: "B" })]);

  const results = await net.receive([
    ["mutable://shared/x", {}, "hello"],
  ]);
  assertEquals(results, [{ accepted: true }]);

  const ra = await a.read("mutable://shared/x");
  const rb = await b.read("mutable://shared/x");
  assertEquals(ra[0].record?.data, "hello");
  assertEquals(rb[0].record?.data, "hello");
});

Deno.test("network.receive lets policy.send skip a peer via empty batch", async () => {
  const a = mem();
  const b = mem();
  const net = createNetwork(
    [peer(a, { id: "A" }), peer(b, { id: "B" })],
    { send: (msgs, p) => p.id === "B" ? [] : msgs },
  );

  await net.receive([["mutable://shared/x", {}, 1]]);
  const ra = await a.read("mutable://shared/x");
  const rb = await b.read("mutable://shared/x");
  assertEquals(ra[0].success, true);
  assertEquals(rb[0].success, false);
});

Deno.test("network.receive lets policy.send rewrite messages per peer", async () => {
  const a = mem();
  const b = mem();
  const net = createNetwork(
    [peer(a, { id: "A" }), peer(b, { id: "B" })],
    {
      // Send full payload to A, only an announcement to B.
      send: (msgs, p): Message[] =>
        p.id === "A" ? msgs : msgs.map(([uri]) => [
          `mutable://inv/${uri}`,
          {},
          { have: uri },
        ]),
    },
  );

  await net.receive([["mutable://data/big", {}, "payload"]]);
  const aGot = await a.read("mutable://data/big");
  const bGotFull = await b.read("mutable://data/big");
  const bGotInv = await b.read("mutable://inv/mutable://data/big");
  assertEquals(aGot[0].record?.data, "payload");
  assertEquals(bGotFull[0].success, false);
  assertEquals(bGotInv[0].success, true);
  assertEquals(bGotInv[0].record?.data, { have: "mutable://data/big" });
});

Deno.test("network.receive propagates transport errors", async () => {
  const broken: NodeProtocolInterface = {
    receive: () => Promise.reject(new Error("peer offline")),
    read: <T,>(u: string | string[]) =>
      Promise.resolve(
        (Array.isArray(u) ? u : [u]).map(() => ({
          success: false,
          error: "x",
        } as ReadResult<T>)),
      ),
    observe: async function* () {},
    status: () => Promise.resolve({ status: "unhealthy" } as StatusResult),
  };
  const net = createNetwork([peer(broken, { id: "X" })]);
  await assertRejects(
    () => net.receive([["mutable://x", {}, 1]]),
    Error,
    "peer offline",
  );
});

// ── read — first-match ────────────────────────────────────────────────

Deno.test("network.read tries peers in order and returns the first hit", async () => {
  const a = mem();
  const b = mem();
  await b.receive([["mutable://only/on/b", {}, "B-has-it"]]);
  const net = createNetwork([peer(a, { id: "A" }), peer(b, { id: "B" })]);

  const results = await net.read("mutable://only/on/b");
  assertEquals(results[0].success, true);
  assertEquals(results[0].record?.data, "B-has-it");
});

Deno.test("network.read falls through failing peers", async () => {
  const broken: NodeProtocolInterface = {
    receive: (m) => Promise.resolve(m.map(() => ({ accepted: true }))),
    read: () => Promise.reject(new Error("broken")),
    observe: async function* () {},
    status: () => Promise.resolve({ status: "unhealthy" } as StatusResult),
  };
  const good = mem();
  await good.receive([["mutable://z", {}, "ok"]]);
  const net = createNetwork(
    [peer(broken, { id: "X" }), peer(good, { id: "Y" })],
  );

  const results = await net.read("mutable://z");
  assertEquals(results[0].record?.data, "ok");
});

Deno.test("network.read returns not-found when no peer has it", async () => {
  const net = createNetwork([peer(mem(), { id: "A" }), peer(mem(), { id: "B" })]);
  const results = await net.read("mutable://nope");
  assertEquals(results[0].success, false);
});

// ── observe — merged stream ───────────────────────────────────────────

Deno.test("network.observe merges writes from every peer", async () => {
  const a = mem();
  const b = mem();
  const net = createNetwork([peer(a, { id: "A" }), peer(b, { id: "B" })]);

  const ac = new AbortController();
  const seen: string[] = [];
  const done = (async () => {
    for await (const ev of net.observe("mutable://shared/*", ac.signal)) {
      if (ev.uri) seen.push(ev.uri);
      if (seen.length >= 2) ac.abort();
    }
  })();

  // Let the observe loops register on each peer.
  await new Promise((r) => setTimeout(r, 10));

  // Each peer sees its own write and emits via SimpleClient's ObserveEmitter.
  await a.receive([["mutable://shared/a-write", {}, 1]]);
  await b.receive([["mutable://shared/b-write", {}, 2]]);

  await done;
  seen.sort();
  assertEquals(seen, ["mutable://shared/a-write", "mutable://shared/b-write"]);
});

Deno.test("network.observe unwinds cleanly on abort", async () => {
  const a = mem();
  const net = createNetwork([peer(a, { id: "A" })]);

  const ac = new AbortController();
  const done = (async () => {
    const seen: string[] = [];
    for await (const _ of net.observe("mutable://x/*", ac.signal)) {
      seen.push("yielded");
    }
    return seen;
  })();

  await new Promise((r) => setTimeout(r, 5));
  ac.abort();
  const result = await done;
  assertEquals(result, []);
});

// ── status — aggregated ───────────────────────────────────────────────

Deno.test("network.status reports healthy when all peers are healthy", async () => {
  const net = createNetwork([peer(mem(), { id: "A" }), peer(mem(), { id: "B" })]);
  const s = await net.status();
  assertEquals(s.status, "healthy");
  assertEquals(s.details?.peerCount, 2);
  assertEquals(s.details?.healthyPeers, 2);
});

Deno.test("network.status reports degraded when a peer is unhealthy", async () => {
  const sick: NodeProtocolInterface = {
    receive: (m) => Promise.resolve(m.map(() => ({ accepted: true }))),
    read: <T,>(u: string | string[]) =>
      Promise.resolve(
        (Array.isArray(u) ? u : [u]).map(() => ({
          success: false,
          error: "x",
        } as ReadResult<T>)),
      ),
    observe: async function* () {},
    status: () => Promise.resolve({ status: "unhealthy" }),
  };
  const net = createNetwork(
    [peer(mem(), { id: "A" }), peer(sick, { id: "B" })],
  );
  const s = await net.status();
  assertEquals(s.status, "degraded");
  assertEquals(s.details?.healthyPeers, 1);
});

Deno.test("network.status reports unhealthy when all peers are unhealthy", async () => {
  const sick = (): NodeProtocolInterface => ({
    receive: (m) => Promise.resolve(m.map(() => ({ accepted: true }))),
    read: <T,>(u: string | string[]) =>
      Promise.resolve(
        (Array.isArray(u) ? u : [u]).map(() => ({
          success: false,
          error: "x",
        } as ReadResult<T>)),
      ),
    observe: async function* () {},
    status: () => Promise.resolve({ status: "unhealthy" }),
  });
  const net = createNetwork(
    [peer(sick(), { id: "A" }), peer(sick(), { id: "B" })],
  );
  const s = await net.status();
  assertEquals(s.status, "unhealthy");
});
