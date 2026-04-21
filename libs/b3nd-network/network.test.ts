/**
 * @module
 * Tests for `peer()` and `createNetwork(peers, policy?)` — the
 * participant primitive.
 *
 * `createNetwork` returns a callable (`(target, opts?) => unbind`) that
 * encapsulates both the data (peers+policy) and the attach behavior.
 * These tests cover both the construction contract and the attach
 * bridge's forwarding, policy hooks, error isolation, and teardown.
 *
 * No `noSanitize` anywhere — Deno's op and resource sanitizers are
 * active on every test.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import { MemoryStore } from "../b3nd-client-memory/store.ts";
import { SimpleClient } from "../b3nd-core/simple-client.ts";
import { Rig } from "../b3nd-rig/rig.ts";
import { connection } from "../b3nd-rig/connection.ts";
import type {
  Message,
  NodeProtocolInterface,
  ReadResult,
} from "../b3nd-core/types.ts";
import { createNetwork, peer } from "./mod.ts";
import type { Peer, Policy } from "./mod.ts";

function mem(): SimpleClient {
  return new SimpleClient(new MemoryStore());
}

/**
 * A test target that captures every receive() call. Used when a real Rig
 * would obscure which layer is doing the work.
 */
function capturingTarget() {
  const calls: Message[] = [];
  const target: NodeProtocolInterface = {
    receive: (msgs) => {
      calls.push(...msgs);
      return Promise.resolve(msgs.map(() => ({ accepted: true })));
    },
    read: () => Promise.resolve([]),
    observe: async function* () {},
    status: () => Promise.resolve({ status: "healthy" as const }),
  };
  return { target, calls };
}

async function until(
  cond: () => boolean | Promise<boolean>,
  { budgetMs = 500, stepMs = 5 } = {},
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (!(await cond())) {
    if (Date.now() > deadline) {
      throw new Error(`condition not met within ${budgetMs}ms`);
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
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

// ── Type-level guarantee ──────────────────────────────────────────────
//
// Network is a function — it has no NodeProtocolInterface methods, so
// passing it to `connection()` fails at compile time. Runtime spot-check.

Deno.test("createNetwork returns a function (participant-only)", () => {
  const net = createNetwork([peer(mem(), { id: "A" })]);
  assertEquals(typeof net, "function");
  // Casting to any to probe; production code never does this.
  // deno-lint-ignore no-explicit-any
  const asAny = net as any;
  assertEquals(typeof asAny.receive, "undefined");
  assertEquals(typeof asAny.read, "undefined");
  assertEquals(typeof asAny.observe, "undefined");
  assertEquals(typeof asAny.status, "undefined");
});

// ── Bridge forwarding ─────────────────────────────────────────────────

Deno.test("Network forwards events from a single peer into target.receive", async () => {
  const a = mem();
  const net = createNetwork([peer(a, { id: "A" })]);
  const { target, calls } = capturingTarget();

  const unbind = net(target);
  try {
    await a.receive([["mutable://x/1", {}, "hello"]]);
    await until(() => calls.length >= 1);
    assertEquals(calls[0][0], "mutable://x/1");
    assertEquals(calls[0][2], "hello");
  } finally {
    await unbind();
  }
});

Deno.test("Network forwards from every peer in parallel", async () => {
  const a = mem();
  const b = mem();
  const net = createNetwork([peer(a, { id: "A" }), peer(b, { id: "B" })]);
  const { target, calls } = capturingTarget();

  const unbind = net(target);
  try {
    await a.receive([["mutable://x/a", {}, 1]]);
    await b.receive([["mutable://x/b", {}, 2]]);
    await until(() => calls.length >= 2);
    const uris = calls.map((c) => c[0]).sort();
    assertEquals(uris, ["mutable://x/a", "mutable://x/b"]);
  } finally {
    await unbind();
  }
});

// ── policy.receive — source tagging ───────────────────────────────────

Deno.test("Network tags events with the source peer", async () => {
  const a = mem();
  const b = mem();
  const seen: { peerId: string; uri: string }[] = [];

  const policy: Policy = {
    async *receive(ev, source, _ctx) {
      if (ev.uri) seen.push({ peerId: source.id, uri: ev.uri });
      yield ev;
    },
  };

  const net = createNetwork(
    [peer(a, { id: "A" }), peer(b, { id: "B" })],
    policy,
  );
  const { target, calls } = capturingTarget();

  const unbind = net(target);
  try {
    await a.receive([["mutable://x/1", {}, 1]]);
    await b.receive([["mutable://x/2", {}, 2]]);
    await until(() => calls.length >= 2);
    seen.sort((x, y) => x.uri.localeCompare(y.uri));
    assertEquals(seen, [
      { peerId: "A", uri: "mutable://x/1" },
      { peerId: "B", uri: "mutable://x/2" },
    ]);
  } finally {
    await unbind();
  }
});

// ── policy.receive — silent consumption ──────────────────────────────

Deno.test("Network respects a policy that yields nothing (control-plane consumption)", async () => {
  const a = mem();
  const policy: Policy = {
    async *receive(ev) {
      // Consume every event silently — should never reach target.
      if (ev.uri && !ev.uri.startsWith("data://")) return;
      yield ev;
    },
  };
  const net = createNetwork([peer(a, { id: "A" })], policy);
  const { target, calls } = capturingTarget();

  const unbind = net(target);
  try {
    await a.receive([["mutable://noise/1", {}, "drop me"]]);
    await new Promise((r) => setTimeout(r, 30));
    assertEquals(calls.length, 0);
  } finally {
    await unbind();
  }
});

// ── policy.receive — transform ───────────────────────────────────────

Deno.test("Network forwards transformed events to target", async () => {
  const a = mem();
  const policy: Policy = {
    async *receive(ev) {
      if (ev.uri) {
        yield {
          success: true,
          uri: `wrapped://${ev.uri}`,
          record: {
            values: {},
            data: { wrapped: ev.record?.data },
          },
        };
      }
    },
  };
  const net = createNetwork([peer(a, { id: "A" })], policy);
  const { target, calls } = capturingTarget();

  const unbind = net(target);
  try {
    await a.receive([["mutable://raw/1", {}, 42]]);
    await until(() => calls.length >= 1);
    assertEquals(calls[0][0], "wrapped://mutable://raw/1");
    assertEquals(calls[0][2], { wrapped: 42 });
  } finally {
    await unbind();
  }
});

// ── policy.receive — side-read via ctx.source.client.read ────────────

Deno.test("Network exposes source.client.read for side-pulls", async () => {
  const a = mem();
  await a.receive([["data://full/payload", {}, { big: "content" }]]);

  const policy: Policy = {
    async *receive(ev, source, _ctx) {
      if (ev.uri?.startsWith("inv://")) {
        const want = (ev.record?.data as { have: string }).have;
        const results = await source.client.read<unknown>(want);
        for (const r of results) if (r.success) yield { ...r, uri: want };
        return;
      }
      yield ev;
    },
  };

  const net = createNetwork([peer(a, { id: "A" })], policy);
  const { target, calls } = capturingTarget();

  const unbind = net(target);
  try {
    await a.receive([["inv://1", {}, { have: "data://full/payload" }]]);
    await until(() => calls.some((c) => c[0] === "data://full/payload"));
    const hit = calls.find((c) => c[0] === "data://full/payload");
    assertEquals(hit?.[2], { big: "content" });
  } finally {
    await unbind();
  }
});

// ── Policy dependency self-injection ──────────────────────────────────

Deno.test("policies carry their own data dependencies via closure", async () => {
  const a = mem();
  const localStore = mem();
  await localStore.receive([["mutable://known", {}, "yes"]]);

  const policyWithStore = (store: typeof localStore): Policy => ({
    async *receive(ev, _source, _ctx) {
      const existing = await store.read<string>("mutable://known");
      if (existing[0]?.success && ev.uri) {
        yield {
          success: true,
          uri: `wrapped://${ev.uri}`,
          record: {
            values: {},
            data: existing[0].record?.data,
          },
        };
      }
    },
  });

  const net = createNetwork([peer(a, { id: "A" })], policyWithStore(localStore));
  const { target, calls } = capturingTarget();

  const unbind = net(target);
  try {
    await a.receive([["trigger://1", {}, 0]]);
    await until(() => calls.length >= 1);
    assertEquals(calls[0][0], "wrapped://trigger://1");
    assertEquals(calls[0][2], "yes");
  } finally {
    await unbind();
  }
});

// ── Pattern option ────────────────────────────────────────────────────

Deno.test("Network honors a narrowed observe pattern", async () => {
  const a = mem();
  const net = createNetwork([peer(a, { id: "A" })]);
  const { target, calls } = capturingTarget();

  const unbind = net(target, { pattern: "mutable://keep/:id" });
  try {
    await a.receive([["mutable://keep/1", {}, "match"]]);
    await a.receive([["mutable://drop/1", {}, "skip"]]);
    await until(() => calls.length >= 1);
    await new Promise((r) => setTimeout(r, 20));
    assertEquals(calls.length, 1);
    assertEquals(calls[0][0], "mutable://keep/1");
  } finally {
    await unbind();
  }
});

// ── Error isolation ───────────────────────────────────────────────────

Deno.test("Network catches target.receive errors without stalling the bridge", async () => {
  const a = mem();
  let count = 0;
  const errors: Error[] = [];
  const target: NodeProtocolInterface = {
    receive: () => {
      count++;
      if (count === 1) throw new Error("flaky");
      return Promise.resolve([{ accepted: true }]);
    },
    read: () => Promise.resolve([]),
    observe: async function* () {},
    status: () => Promise.resolve({ status: "healthy" as const }),
  };

  const net = createNetwork([peer(a, { id: "A" })]);
  const unbind = net(target, { onError: (err) => errors.push(err) });
  try {
    await a.receive([["mutable://x/1", {}, 1]]);
    await a.receive([["mutable://x/2", {}, 2]]);
    await until(() => count >= 2);
    assertEquals(errors.length, 1);
    assertEquals(errors[0].message, "flaky");
  } finally {
    await unbind();
  }
});

Deno.test("Network surfaces peer observe errors via onError", async () => {
  const errors: Error[] = [];
  const badPeer: NodeProtocolInterface = {
    receive: (m) => Promise.resolve(m.map(() => ({ accepted: true }))),
    read: () => Promise.resolve([]),
    observe: async function* () {
      throw new Error("observe broken");
    },
    status: () => Promise.resolve({ status: "unhealthy" as const }),
  };

  const net = createNetwork([peer(badPeer, { id: "X" })]);
  const { target } = capturingTarget();

  const unbind = net(target, {
    onError: (err, ctx) =>
      errors.push(new Error(`${ctx.peerId}: ${err.message}`)),
  });
  try {
    await until(() => errors.length >= 1);
    assertEquals(errors[0].message, "X: observe broken");
  } finally {
    await unbind();
  }
});

// ── Teardown ──────────────────────────────────────────────────────────

Deno.test("unbind() stops forwarding and awaits peer loops", async () => {
  const a = mem();
  const net = createNetwork([peer(a, { id: "A" })]);
  const { target, calls } = capturingTarget();

  const unbind = net(target);
  await a.receive([["mutable://pre/1", {}, 1]]);
  await until(() => calls.length >= 1);

  await unbind();

  await a.receive([["mutable://post/1", {}, 2]]);
  await new Promise((r) => setTimeout(r, 30));
  assertEquals(calls.length, 1);
});

Deno.test("unbind() is idempotent", async () => {
  const net = createNetwork([peer(mem(), { id: "A" })]);
  const { target } = capturingTarget();
  const unbind = net(target);
  await unbind();
  await unbind(); // must not throw
});

// ── Real Rig integration ──────────────────────────────────────────────

Deno.test("createNetwork against a real Rig fires reactions on peer-originated writes", async () => {
  const a = mem();
  const local = mem();
  const reactionCalls: { uri: string; id: string }[] = [];

  const rig = new Rig({
    connections: [connection(local, { receive: ["*"], read: ["*"] })],
    reactions: {
      "mutable://chat/:id": (uri, _data, params) => {
        reactionCalls.push({ uri, id: params.id });
      },
    },
  });

  const net = createNetwork([peer(a, { id: "A" })]);
  const unbind = net(rig);
  try {
    await a.receive([["mutable://chat/42", {}, "hello"]]);
    await until(() => reactionCalls.length >= 1);
    assertEquals(reactionCalls[0], { uri: "mutable://chat/42", id: "42" });
  } finally {
    await unbind();
  }
});

Deno.test("createNetwork persists bridged writes through the rig pipeline", async () => {
  const a = mem();
  const local = mem();
  const rig = new Rig({
    connections: [connection(local, { receive: ["*"], read: ["*"] })],
  });

  const net = createNetwork([peer(a, { id: "A" })]);
  const unbind = net(rig);
  try {
    await a.receive([["mutable://k/1", {}, { v: 1 }]]);
    await until(async () => {
      const r = await rig.read("mutable://k/1");
      return r[0]?.success === true;
    });
    const r = await rig.read("mutable://k/1");
    assertEquals(r[0].record?.data, { v: 1 });
  } finally {
    await unbind();
  }
});
