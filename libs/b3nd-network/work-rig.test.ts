/**
 * @module
 * Integration tests: `work(rig, network)` against a real Rig.
 *
 * The single-layer tests in `work.test.ts` use a capturing target stub to
 * isolate the bridge. These tests pin the full path — peer observe flows
 * all the way into the Rig's hooks/reactions — because that's the shape
 * real deployments use.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import { MemoryStore } from "../b3nd-client-memory/store.ts";
import { SimpleClient } from "../b3nd-core/simple-client.ts";
import { Rig } from "../b3nd-rig/rig.ts";
import { connection } from "../b3nd-rig/connection.ts";
import { createNetwork, peer, work } from "./mod.ts";

function mem(): SimpleClient {
  return new SimpleClient(new MemoryStore());
}

async function until(
  cond: () => boolean | Promise<boolean>,
  budgetMs = 500,
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (!(await cond())) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

// ── rig reactions fire on bridged writes ──────────────────────────────

Deno.test("work(rig, net) fires rig reactions on peer-originated writes", async () => {
  const a = mem();
  const local = mem();
  const reactionCalls: { uri: string; id: string }[] = [];

  const rig = new Rig({
    connections: [
      connection(local, { receive: ["*"], read: ["*"] }),
    ],
    reactions: {
      "mutable://chat/:id": (uri, _data, params) => {
        reactionCalls.push({ uri, id: params.id });
      },
    },
  });

  const net = createNetwork([peer(a, { id: "A" })]);
  const unbind = work(rig, net);
  try {
    await a.receive([["mutable://chat/42", {}, "hello"]]);
    await until(() => reactionCalls.length >= 1);
    assertEquals(reactionCalls[0], {
      uri: "mutable://chat/42",
      id: "42",
    });
  } finally {
    await unbind();
  }
});

// ── bridged events land in the rig's local store ──────────────────────

Deno.test("work(rig, net) persists bridged writes through the rig pipeline", async () => {
  const a = mem();
  const local = mem();
  const rig = new Rig({
    connections: [connection(local, { receive: ["*"], read: ["*"] })],
  });

  const net = createNetwork([peer(a, { id: "A" })]);
  const unbind = work(rig, net);
  try {
    await a.receive([["mutable://k/1", {}, { v: 1 }]]);
    // Poll until the rig's local store has the bridged write.
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
