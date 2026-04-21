/**
 * @module
 * Tests for `work(target, network, opts?)` — the inbound bridge.
 *
 * Uses `SimpleClient + MemoryStore` peers so each peer emits observe events
 * when it receives a write (exercises the real observe path, not a mock).
 * No sanitizer overrides — resource-sanitizer-clean teardown is part of the
 * contract.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import { MemoryStore } from "../b3nd-client-memory/store.ts";
import { SimpleClient } from "../b3nd-core/simple-client.ts";
import type {
  Message,
  NodeProtocolInterface,
  ReadResult,
} from "../b3nd-core/types.ts";
import { createNetwork, peer, work } from "./mod.ts";
import type { Policy } from "./mod.ts";

function mem(): SimpleClient {
  return new SimpleClient(new MemoryStore());
}

/**
 * A test target that captures every receive() call. Stands in for a Rig
 * when we only want to assert forwarding — using a real Rig here would
 * pull in the whole pipeline and obscure which layer is doing the work.
 */
function capturingTarget() {
  const calls: Message[] = [];
  const target: NodeProtocolInterface = {
    receive: (msgs) => {
      calls.push(...msgs);
      return Promise.resolve(msgs.map(() => ({ accepted: true })));
    },
    read: <T,>(u: string | string[]) =>
      Promise.resolve(
        (Array.isArray(u) ? u : [u]).map(() =>
          ({ success: false, error: "n/a" } as ReadResult<T>)
        ),
      ),
    observe: async function* () {},
    status: () => Promise.resolve({ status: "healthy" as const }),
  };
  return { target, calls };
}

/** Poll for a condition with a fixed budget; fails loudly on timeout. */
async function until(
  cond: () => boolean,
  { budgetMs = 500, stepMs = 5 } = {},
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (!cond()) {
    if (Date.now() > deadline) {
      throw new Error(`condition not met within ${budgetMs}ms`);
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

// ── forwarding ────────────────────────────────────────────────────────

Deno.test("work() forwards events from a single peer into target.receive", async () => {
  const a = mem();
  const net = createNetwork([peer(a, { id: "A" })]);
  const { target, calls } = capturingTarget();

  const unbind = work(target, net);
  try {
    await a.receive([["mutable://x/1", {}, "hello"]]);
    await until(() => calls.length >= 1);
    assertEquals(calls[0][0], "mutable://x/1");
    assertEquals(calls[0][2], "hello");
  } finally {
    await unbind();
  }
});

Deno.test("work() forwards from every peer in parallel", async () => {
  const a = mem();
  const b = mem();
  const net = createNetwork([peer(a, { id: "A" }), peer(b, { id: "B" })]);
  const { target, calls } = capturingTarget();

  const unbind = work(target, net);
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

Deno.test("work() tags events with the source peer", async () => {
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

  const unbind = work(target, net);
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

Deno.test("work() respects a policy that yields nothing (control-plane consumption)", async () => {
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

  const unbind = work(target, net);
  try {
    await a.receive([["mutable://noise/1", {}, "drop me"]]);
    // Wait a tick to let the bridge observe and (not) forward.
    await new Promise((r) => setTimeout(r, 30));
    assertEquals(calls.length, 0);
  } finally {
    await unbind();
  }
});

// ── policy.receive — transform (yield a different event) ─────────────

Deno.test("work() forwards transformed events to target", async () => {
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

  const unbind = work(target, net);
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

Deno.test("work() exposes source.client.read for side-pulls", async () => {
  // A holds the full payload; it announces only a pointer. The bridge's
  // policy pulls via source.client.read and yields the full content.
  const a = mem();
  await a.receive([["data://full/payload", {}, { big: "content" }]]);

  const policy: Policy = {
    async *receive(ev, source, _ctx) {
      if (ev.uri?.startsWith("inv://")) {
        const want = (ev.record?.data as { have: string }).have;
        const results = await source.client.read<unknown>(want);
        // Single-URI reads return results without `uri` set; the policy
        // stamps it on so the bridge can forward into target.receive.
        for (const r of results) if (r.success) yield { ...r, uri: want };
        return;
      }
      yield ev;
    },
  };

  const net = createNetwork([peer(a, { id: "A" })], policy);
  const { target, calls } = capturingTarget();

  const unbind = work(target, net);
  try {
    // Announcement flows through — policy pulls the real data.
    await a.receive([["inv://1", {}, { have: "data://full/payload" }]]);
    await until(() => calls.some((c) => c[0] === "data://full/payload"));
    const hit = calls.find((c) => c[0] === "data://full/payload");
    assertEquals(hit?.[2], { big: "content" });
  } finally {
    await unbind();
  }
});

// ── InboundCtx.local ──────────────────────────────────────────────────

Deno.test("work() wires InboundCtx.local when opts.local is provided", async () => {
  const a = mem();
  const localStore = mem();
  await localStore.receive([["mutable://known", {}, "yes"]]);

  const seen: { has: boolean; data: unknown }[] = [];
  const policy: Policy = {
    async *receive(_ev, _source, ctx) {
      seen.push({
        has: await ctx.local.has("mutable://known"),
        data: (await ctx.local.read<string>("mutable://known")).record?.data,
      });
      // No yield — pure probe.
    },
  };

  const net = createNetwork([peer(a, { id: "A" })], policy);
  const { target } = capturingTarget();

  const unbind = work(target, net, { local: localStore });
  try {
    await a.receive([["trigger://1", {}, 0]]);
    await until(() => seen.length >= 1);
    assertEquals(seen[0], { has: true, data: "yes" });
  } finally {
    await unbind();
  }
});

Deno.test("work() falls back to not-available local when opts.local omitted", async () => {
  const a = mem();

  const seen: { has: boolean; readErr?: string }[] = [];
  const policy: Policy = {
    async *receive(_ev, _source, ctx) {
      const has = await ctx.local.has("mutable://anything");
      const read = await ctx.local.read<unknown>("mutable://anything");
      seen.push({ has, readErr: read.error });
    },
  };
  const net = createNetwork([peer(a, { id: "A" })], policy);
  const { target } = capturingTarget();

  const unbind = work(target, net);
  try {
    await a.receive([["trigger://1", {}, 0]]);
    await until(() => seen.length >= 1);
    assertEquals(seen[0].has, false);
    // Error message is stable; assert presence rather than exact wording.
    if (!seen[0].readErr) throw new Error("expected a read error");
  } finally {
    await unbind();
  }
});

// ── pattern option ────────────────────────────────────────────────────

Deno.test("work() respects a narrowed observe pattern", async () => {
  const a = mem();
  const net = createNetwork([peer(a, { id: "A" })]);
  const { target, calls } = capturingTarget();

  const unbind = work(target, net, { pattern: "mutable://keep/:id" });
  try {
    await a.receive([["mutable://keep/1", {}, "match"]]);
    await a.receive([["mutable://drop/1", {}, "skip"]]);
    await until(() => calls.length >= 1);
    // Give the drop a chance to show up if it were going to.
    await new Promise((r) => setTimeout(r, 20));
    assertEquals(calls.length, 1);
    assertEquals(calls[0][0], "mutable://keep/1");
  } finally {
    await unbind();
  }
});

// ── error isolation ──────────────────────────────────────────────────

Deno.test("work() catches target.receive errors without stalling the bridge", async () => {
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
  const unbind = work(target, net, {
    onError: (err) => errors.push(err),
  });
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

Deno.test("work() surfaces peer observe errors via onError", async () => {
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

  const unbind = work(target, net, {
    onError: (err, ctx) => errors.push(new Error(`${ctx.peerId}: ${err.message}`)),
  });
  try {
    await until(() => errors.length >= 1);
    assertEquals(errors[0].message, "X: observe broken");
  } finally {
    await unbind();
  }
});

// ── teardown ──────────────────────────────────────────────────────────

Deno.test("unbind() stops forwarding and awaits peer loops", async () => {
  const a = mem();
  const net = createNetwork([peer(a, { id: "A" })]);
  const { target, calls } = capturingTarget();

  const unbind = work(target, net);
  await a.receive([["mutable://pre/1", {}, 1]]);
  await until(() => calls.length >= 1);

  await unbind();

  // After unbind, writes to the peer must not reach target.
  await a.receive([["mutable://post/1", {}, 2]]);
  await new Promise((r) => setTimeout(r, 30));
  assertEquals(calls.length, 1);
});

Deno.test("unbind() is idempotent", async () => {
  const net = createNetwork([peer(mem(), { id: "A" })]);
  const { target } = capturingTarget();
  const unbind = work(target, net);
  await unbind();
  await unbind(); // must not throw
});

// ── network.policy exposure ──────────────────────────────────────────

Deno.test("network.policy is exposed on the returned Network", () => {
  const custom: Policy = { read: "merge-unique" };
  const net = createNetwork([peer(mem(), { id: "A" })], custom);
  assertEquals(net.policy, custom);
});
