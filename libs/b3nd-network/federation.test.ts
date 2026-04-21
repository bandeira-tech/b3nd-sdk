/**
 * @module
 * Tests for `createFederation(peers, policy?)` — the remote-client
 * primitive's NodeProtocolInterface surface.
 *
 * Uses `MemoryStore + SimpleClient` as test peers so each peer emits
 * observe events when it receives a write. No sanitizers disabled.
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
import { createFederation, peer } from "./mod.ts";

function mem(): SimpleClient {
  return new SimpleClient(new MemoryStore());
}

// ── shape ─────────────────────────────────────────────────────────────

Deno.test("createFederation returns a NodeProtocolInterface", () => {
  const fed = createFederation([peer(mem(), { id: "A" })]);
  assertEquals(typeof fed.receive, "function");
  assertEquals(typeof fed.read, "function");
  assertEquals(typeof fed.observe, "function");
  assertEquals(typeof fed.status, "function");
  // Federation deliberately does not expose peers/policy/originId so it
  // cannot be mistaken for a Network at a type level.
  // deno-lint-ignore no-explicit-any
  assertEquals(typeof (fed as any).peers, "undefined");
  // deno-lint-ignore no-explicit-any
  assertEquals(typeof (fed as any).policy, "undefined");
});

// ── receive — fan-out ─────────────────────────────────────────────────

Deno.test("federation.receive fans out to every peer (default flood)", async () => {
  const a = mem();
  const b = mem();
  const fed = createFederation([peer(a, { id: "A" }), peer(b, { id: "B" })]);

  const results = await fed.receive([["mutable://shared/x", {}, "hello"]]);
  assertEquals(results, [{ accepted: true }]);

  const ra = await a.read("mutable://shared/x");
  const rb = await b.read("mutable://shared/x");
  assertEquals(ra[0].record?.data, "hello");
  assertEquals(rb[0].record?.data, "hello");
});

Deno.test("federation.receive lets policy.send skip a peer via empty batch", async () => {
  const a = mem();
  const b = mem();
  const fed = createFederation(
    [peer(a, { id: "A" }), peer(b, { id: "B" })],
    { send: (msgs, p) => p.id === "B" ? [] : msgs },
  );

  await fed.receive([["mutable://shared/x", {}, 1]]);
  const ra = await a.read("mutable://shared/x");
  const rb = await b.read("mutable://shared/x");
  assertEquals(ra[0].success, true);
  assertEquals(rb[0].success, false);
});

Deno.test("federation.receive lets policy.send rewrite messages per peer", async () => {
  const a = mem();
  const b = mem();
  const fed = createFederation(
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

  await fed.receive([["mutable://data/big", {}, "payload"]]);
  const aGot = await a.read("mutable://data/big");
  const bGotFull = await b.read("mutable://data/big");
  const bGotInv = await b.read("mutable://inv/mutable://data/big");
  assertEquals(aGot[0].record?.data, "payload");
  assertEquals(bGotFull[0].success, false);
  assertEquals(bGotInv[0].success, true);
  assertEquals(bGotInv[0].record?.data, { have: "mutable://data/big" });
});

Deno.test("federation.receive propagates transport errors", async () => {
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
  const fed = createFederation([peer(broken, { id: "X" })]);
  await assertRejects(
    () => fed.receive([["mutable://x", {}, 1]]),
    Error,
    "peer offline",
  );
});

// ── read — first-match ────────────────────────────────────────────────

Deno.test("federation.read tries peers in order and returns the first hit", async () => {
  const a = mem();
  const b = mem();
  await b.receive([["mutable://only/on/b", {}, "B-has-it"]]);
  const fed = createFederation([peer(a, { id: "A" }), peer(b, { id: "B" })]);

  const results = await fed.read("mutable://only/on/b");
  assertEquals(results[0].success, true);
  assertEquals(results[0].record?.data, "B-has-it");
});

Deno.test("federation.read falls through failing peers", async () => {
  const broken: NodeProtocolInterface = {
    receive: (m) => Promise.resolve(m.map(() => ({ accepted: true }))),
    read: () => Promise.reject(new Error("broken")),
    observe: async function* () {},
    status: () => Promise.resolve({ status: "unhealthy" } as StatusResult),
  };
  const good = mem();
  await good.receive([["mutable://z", {}, "ok"]]);
  const fed = createFederation(
    [peer(broken, { id: "X" }), peer(good, { id: "Y" })],
  );

  const results = await fed.read("mutable://z");
  assertEquals(results[0].record?.data, "ok");
});

Deno.test("federation.read returns not-found when no peer has it", async () => {
  const fed = createFederation(
    [peer(mem(), { id: "A" }), peer(mem(), { id: "B" })],
  );
  const results = await fed.read("mutable://nope");
  assertEquals(results[0].success, false);
});

// ── observe — merged stream ───────────────────────────────────────────

Deno.test("federation.observe merges writes from every peer", async () => {
  const a = mem();
  const b = mem();
  const fed = createFederation([peer(a, { id: "A" }), peer(b, { id: "B" })]);

  const ac = new AbortController();
  const seen: string[] = [];
  const done = (async () => {
    for await (const ev of fed.observe("mutable://shared/*", ac.signal)) {
      if (ev.uri) seen.push(ev.uri);
      if (seen.length >= 2) ac.abort();
    }
  })();

  await new Promise((r) => setTimeout(r, 10));

  await a.receive([["mutable://shared/a-write", {}, 1]]);
  await b.receive([["mutable://shared/b-write", {}, 2]]);

  await done;
  seen.sort();
  assertEquals(seen, ["mutable://shared/a-write", "mutable://shared/b-write"]);
});

Deno.test("federation.observe unwinds cleanly on abort", async () => {
  const a = mem();
  const fed = createFederation([peer(a, { id: "A" })]);

  const ac = new AbortController();
  const done = (async () => {
    const seen: string[] = [];
    for await (const _ of fed.observe("mutable://x/*", ac.signal)) {
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

Deno.test("federation.status reports healthy when all peers are healthy", async () => {
  const fed = createFederation(
    [peer(mem(), { id: "A" }), peer(mem(), { id: "B" })],
  );
  const s = await fed.status();
  assertEquals(s.status, "healthy");
  assertEquals(s.details?.peerCount, 2);
  assertEquals(s.details?.healthyPeers, 2);
});

Deno.test("federation.status reports degraded when a peer is unhealthy", async () => {
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
  const fed = createFederation(
    [peer(mem(), { id: "A" }), peer(sick, { id: "B" })],
  );
  const s = await fed.status();
  assertEquals(s.status, "degraded");
  assertEquals(s.details?.healthyPeers, 1);
});

Deno.test("federation.status reports unhealthy when all peers are unhealthy", async () => {
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
  const fed = createFederation(
    [peer(sick(), { id: "A" }), peer(sick(), { id: "B" })],
  );
  const s = await fed.status();
  assertEquals(s.status, "unhealthy");
});
