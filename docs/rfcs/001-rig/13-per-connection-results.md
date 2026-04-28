# 13. Per-route observability via OperationHandle

**Status: shipped — [PR #94](https://github.com/bandeira-tech/b3nd-sdk/pull/94).**

The original framing for this chapter was "add a `routes` field to
`ReceiveResult` plus a `broadcastPolicy` knob on `Rig`." We rejected it
during design and built something cleaner instead: `rig.send` and
`rig.receive` return an `OperationHandle` that's both **awaitable** and
a **scoped event emitter**. The `ReceiveResult` shape stays minimal;
per-route detail flows through events, not through return-shape
duplication. No policy knob — the rig stops aggregating; callers
observe events and decide what "accepted across replicas" means in
their topology.

## The original problem (still valid)

When a tuple was broadcast to N matching connections, the rig collapsed
the per-connection results into one — first-fail-wins, then accept.
Operators saw one boolean and couldn't tell whether the primary
accepted, which mirror went down, or whether the write partially
landed. Retries, reconciliation, and replica health monitoring became
guesswork.

The fix needed to surface per-route detail without:

- Doubling the paper-trail (events alongside a parallel result shape
  saying the same thing).
- Forcing a policy decision into the rig (which one is "accepted"
  semantically depends on the topology and the protocol).
- Breaking the `NodeProtocolInterface.receive` contract that other
  clients implement.

## What shipped

`Rig.send(outs)` and `Rig.receive(outs)` return an `OperationHandle`.

```ts
interface OperationHandle extends PromiseLike<ReceiveResult[]> {
  on<E extends OperationEventName>(
    event: E,
    handler: OperationEventHandler<E>,
  ): () => void;
  off<E extends OperationEventName>(
    event: E,
    handler: OperationEventHandler<E>,
  ): void;
  readonly settled: Promise<SettledEvent>;
}

type OperationEventName =
  | "process:done"     // pipeline classification
  | "handle:emit"      // handler emissions
  | "route:success"    // per (emission, connection) accept
  | "route:error"      // per (emission, connection) reject
  | "settled";         // all routes done
```

The handle is awaitable so existing `await rig.receive(outs)` callers
see no contract change, and the `NodeProtocolInterface.receive`
signature widens from `Promise<ReceiveResult[]>` to
`PromiseLike<ReceiveResult[]>` — every existing client implementation
still satisfies it (every Promise is a PromiseLike).

`ReceiveResult` stays minimal: `{ accepted, error?, errorDetail? }`.
The `accepted` flag means **the pipeline accepted the input** — process
classified, handler ran, the rig has a topology to dispatch through.
It says nothing about whether downstream connections actually wrote.
That's what events are for.

## How callers use it

The simple case is unchanged:

```ts
const [r] = await rig.receive([out]);
if (!r.accepted) throw new Error(r.error);
```

For per-route observability:

```ts
const op = rig.receive([out]);

op.on("route:success", (e) => {
  metrics.write_success.inc({ connection: e.connectionId });
});

op.on("route:error", (e) => {
  retryQueue.push({ emission: e.emission, target: e.connectionId });
});

const results = await op;       // pipeline ack
await op.settled;                 // wait for all routes (read-after-write)
```

## How the rig dispatches now

Pipeline is synchronous-ish (process + handle run inline). Broadcast
is **async by design** — the rig doesn't await connection writes
before resolving the pipeline-stage Promise. Per-route outcomes arrive
as events on the handle after `await op` returns. Callers wanting full
settlement (e.g., for read-after-write across replicas) await
`op.settled`.

```
rig.receive(outs)
  ├─ process(outs)        → ProgramResult[]   ┐
  ├─ for each output:                          │ (synchronous, inline)
  │    handle(out, result) → emissions         │
  │    schedule broadcast(emissions)           │
  └─ resolve handle pipeline promise          ─┘ ← `await op` returns here

  In the background:
  ┌─ broadcast each emission to every matching connection
  │    fire route:success / route:error per (emission, connection)
  ├─ for each emission, fire reactions if any route accepted
  └─ when all routes done, fire `settled`     ← `await op.settled`
```

## Connection IDs

`connection(client, patterns, opts?)` gained an optional third
argument `{ id?: string }`. Connections without an explicit ID get an
auto-generated `conn-{N}` based on registration order. Route events
include `connectionId` so subscribers can correlate per-replica
outcomes.

```ts
const rig = new Rig({
  connections: [
    connection(primary,  patterns, { id: "primary" }),
    connection(mirror,   patterns, { id: "mirror-east" }),
    connection(mirror2,  patterns), // gets conn-2 by default
  ],
});
```

## What we didn't ship

- **No `broadcastPolicy` knob.** The rig stops aggregating; callers
  observe events. If you want a "first-route-accepts" or
  "all-routes-must-accept" semantic, you compose it from
  `route:success`/`route:error` events on your side.
- **No `routes` field on `ReceiveResult`.** Single paper-trail.
  Per-route detail is events.
- **No per-route retry mechanism in the rig.** Retry strategy is
  endpoint-specific — the client/store knows what's safe to retry on
  its own transport. App-level retry, when needed, lives in caller
  code listening to `route:error`.

## What this enabled (consequences worth noting)

- **`receive`/`send` are interchangeable from the rig's perspective.**
  Both go through the same `_pipeline` body; only hooks and events
  differ by direction.
- **Reactions reorganized.** They now fire after each emission's
  routes settle (only if at least one route accepted), and their
  returned `Output[]` spawn a fresh `rig.send` operation with its own
  handle. Reaction loops are user error; the framework doesn't detect
  them.
- **`receiveOrThrow` / `sendOrThrow`** ship as helpers for callers
  who'd rather see exceptions than inspect `accepted`. They throw on
  pipeline-stage rejection only — route failures still arrive as
  events, never as thrown errors.

## What changed in this chapter

- The chapter retired the "routes field on ReceiveResult" framing and
  replaced it with the OperationHandle shape that actually shipped.
- The pipeline stops awaiting broadcast — dispatch is async by design.
- `ReceiveResult` stays as it was. Per-route observability lives in
  events. `OperationHandle` is the new return type for
  `rig.send`/`rig.receive`, and it's a `PromiseLike<ReceiveResult[]>`
  for backward compatibility.
- `NodeProtocolInterface.receive` widened to `PromiseLike` so the
  handle satisfies it.
- `connection()` got an optional `id` field; route events carry it.

## What's next

The remaining operational chapter — **Ch 14 — multi-source replicas**.
The original "rig adds federate flag" framing was rejected; the
`flood(peers)` strategy already shipping in
`@bandeira-tech/b3nd-sdk/network` is the canonical multi-source
pattern. See Ch 14 for the details. The original Ch 15 (encrypted
batch reads) is dissolved alongside the AuthenticatedRig retirement.
