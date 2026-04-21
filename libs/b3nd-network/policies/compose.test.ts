/**
 * @module
 * Tests for `compose(...policies)` — sequenced Policy composition.
 */

/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert";
import type { Message, ReadResult } from "../../b3nd-core/types.ts";
import type { Peer, Policy } from "../types.ts";
import { compose } from "./compose.ts";

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

function ev(uri: string): ReadResult<unknown> {
  return { success: true, uri, record: { values: {}, data: null } };
}

function msg(uri: string): Message {
  return [uri, {}, null];
}

async function drain<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

const PEER = fakePeer("P");
const CTX = { originId: "me" };
const INB = { originId: "me", source: PEER };

// ── Empty compose ────────────────────────────────────────────────────

Deno.test("compose() with no policies is pure pass-through", async () => {
  const p = compose();
  assertEquals(p.send!([msg("x")], PEER, CTX), [msg("x")]);
  const out = await drain(p.receive!(ev("x"), PEER, INB));
  assertEquals(out.length, 1);
  assertEquals(out[0].uri, "x");
  assertEquals(p.read, undefined);
});

// ── send — pipelined in order ────────────────────────────────────────

Deno.test("compose(send-hooks) pipelines outputs left-to-right", () => {
  const tagFirst: Policy = {
    send: (msgs) => msgs.map(([u, v, d]) => [`1/${u}`, v, d] as Message),
  };
  const tagSecond: Policy = {
    send: (msgs) => msgs.map(([u, v, d]) => [`2/${u}`, v, d] as Message),
  };

  const p = compose(tagFirst, tagSecond);
  const [out] = p.send!([msg("raw")], PEER, CTX);
  // First tags with 1/, then second tags with 2/ → "2/1/raw"
  assertEquals(out[0], "2/1/raw");
});

Deno.test("compose(send) where one policy drops a message stops further processing", () => {
  const dropper: Policy = {
    send: (msgs) => msgs.filter((m) => !m[0].includes("drop")),
  };
  const rewriter: Policy = {
    send: (msgs) => msgs.map(([u, v, d]) => [`tagged/${u}`, v, d] as Message),
  };

  const p = compose(dropper, rewriter);
  const out = p.send!(
    [msg("drop/me"), msg("keep/me")],
    PEER,
    CTX,
  );
  assertEquals(out.length, 1);
  assertEquals(out[0][0], "tagged/keep/me");
});

Deno.test("compose(send) skips policies that omit the send hook", () => {
  const noSend: Policy = {};
  const doubler: Policy = {
    send: (msgs) => msgs.map(([u, v, d]) => [`d/${u}`, v, d] as Message),
  };
  const p = compose(noSend, doubler, noSend);
  const [out] = p.send!([msg("x")], PEER, CTX);
  assertEquals(out[0], "d/x");
});

// ── receive — chained async iterator ─────────────────────────────────

Deno.test("compose(receive-hooks) chains each event through every policy", async () => {
  const uppercase: Policy = {
    async *receive(e) {
      if (e.uri) yield { ...e, uri: e.uri.toUpperCase() };
    },
  };
  const wrapped: Policy = {
    async *receive(e) {
      if (e.uri) yield { ...e, uri: `w(${e.uri})` };
    },
  };

  const p = compose(uppercase, wrapped);
  const out = await drain(p.receive!(ev("hello"), PEER, INB));
  assertEquals(out.length, 1);
  assertEquals(out[0].uri, "w(HELLO)");
});

Deno.test("compose(receive) stops the chain when an intermediate yields nothing", async () => {
  const filter: Policy = {
    async *receive(e) {
      if (e.uri?.startsWith("keep/")) yield e;
      // Otherwise: yield nothing → chain collapses for this event.
    },
  };
  const tag: Policy = {
    async *receive(e) {
      yield { ...e, uri: `tagged/${e.uri}` };
    },
  };
  const p = compose(filter, tag);

  const kept = await drain(p.receive!(ev("keep/x"), PEER, INB));
  const dropped = await drain(p.receive!(ev("drop/x"), PEER, INB));

  assertEquals(kept.map((e) => e.uri), ["tagged/keep/x"]);
  assertEquals(dropped, []);
});

Deno.test("compose(receive) fans out when an intermediate yields multiple", async () => {
  const doubler: Policy = {
    async *receive(e) {
      yield e;
      if (e.uri) yield { ...e, uri: `copy/${e.uri}` };
    },
  };
  const tagger: Policy = {
    async *receive(e) {
      yield { ...e, uri: `t(${e.uri})` };
    },
  };
  const p = compose(doubler, tagger);

  const out = await drain(p.receive!(ev("x"), PEER, INB));
  // Each of the 2 outputs of `doubler` passes through `tagger`.
  assertEquals(out.map((e) => e.uri), ["t(x)", "t(copy/x)"]);
});

Deno.test("compose(receive) skips policies that omit the receive hook", async () => {
  const noReceive: Policy = {};
  const tag: Policy = {
    async *receive(e) {
      yield { ...e, uri: `t/${e.uri}` };
    },
  };
  const p = compose(noReceive, tag, noReceive);
  const out = await drain(p.receive!(ev("x"), PEER, INB));
  assertEquals(out.map((e) => e.uri), ["t/x"]);
});

// ── read — first-wins precedence ─────────────────────────────────────

Deno.test("compose(read) takes the first policy that declares a read strategy", () => {
  const noRead: Policy = {};
  const merge: Policy = { read: "merge-unique" };
  const first: Policy = { read: "first-match" };

  assertEquals(compose(noRead, merge, first).read, "merge-unique");
  assertEquals(compose(noRead, first, merge).read, "first-match");
  assertEquals(compose(noRead).read, undefined);
});

// ── Integration: filter + rewrite ────────────────────────────────────

Deno.test("compose pipelines a filter and a rewrite on outbound", () => {
  const onlyMutable: Policy = {
    send: (msgs) => msgs.filter((m) => m[0].startsWith("mutable://")),
  };
  const announce: Policy = {
    send: (msgs) =>
      msgs.map(([uri]) => ["inv://" + uri, {}, { have: uri }] as Message),
  };

  const p = compose(onlyMutable, announce);
  const out = p.send!(
    [msg("mutable://x/1"), msg("hash://zzz")],
    PEER,
    CTX,
  );
  assertEquals(out.length, 1);
  assertEquals(out[0][0], "inv://mutable://x/1");
  assertEquals((out[0][2] as { have: string }).have, "mutable://x/1");
});
