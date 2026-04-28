# 13. Per-route observability via OperationHandle

`rig.send(outs)` and `rig.receive(outs)` return an `OperationHandle` —
an object that is both **awaitable** (resolves to `ReceiveResult[]`
once the pipeline classifies and the handler runs) and a **scoped
event emitter** for per-route detail as broadcasts settle.

`ReceiveResult` stays minimal — `{ accepted, error?, errorDetail? }`.
Per-route detail flows through events, not through return-shape
duplication. The rig does not aggregate per-route outcomes into a
collapsed boolean; callers observe events and decide what "accepted
across replicas" means in their topology.

## Shape

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

The handle is awaitable, so existing `await rig.receive(outs)` callers
work unchanged. `ProtocolInterfaceNode.receive` returns
`PromiseLike<ReceiveResult[]>`, which every plain Promise satisfies —
so the rig can implement the interface while returning a richer
await-target.

## What `accepted` means

`{ accepted: true }` means **the pipeline accepted the input** —
process classified, handler ran, the rig has a topology to dispatch
through. It says nothing about whether downstream connections actually
wrote. That's what events are for.

The exception: when no connection accepts the URI at all, the pipeline
returns `{ accepted: false }`. There is no topology to dispatch
through, so the call rejects at the pipeline stage rather than
silently returning success that no `route:*` event will follow.

## How callers use it

The simple case is unchanged:

```ts
const [r] = await rig.receive([msg]);
if (!r.accepted) throw new Error(r.error);
```

For per-route observability:

```ts
const op = rig.receive([msg]);

op.on("route:success", (e) => {
  metrics.write_success.inc({ connection: e.connectionId });
});

op.on("route:error", (e) => {
  retryQueue.push({ emission: e.emission, target: e.connectionId });
});

const results = await op;       // pipeline ack
await op.settled;                // wait for all routes (read-after-write)
```

Two await points, two granularities. `await op` returns once the
pipeline finishes classifying and emits handler outputs. `await op.settled`
returns when every route (every emission × every accepting connection)
has reported success or error.

## Dispatch flow

The pipeline is synchronous-ish (process and handle run inline).
Broadcast is async — the rig does not await connection writes before
resolving the pipeline-stage promise. Per-route outcomes arrive as
events on the handle after `await op` returns.

```
rig.receive(outs)
  ├─ process(outs)          → ProgramResult[]   ┐
  ├─ for each output:                            │ (synchronous, inline)
  │    handle(out, result)  → emissions          │
  │    schedule broadcast(emissions)             │
  └─ resolve handle pipeline promise            ─┘ ← `await op` returns here

  In the background:
  ┌─ broadcast each emission to every matching connection
  │    fire route:success / route:error per (emission, connection)
  ├─ for each emission, fire reactions if any route accepted
  └─ when all routes done, fire `settled`        ← `await op.settled`
```

## Connection IDs

`connection(client, patterns, opts?)` accepts an optional `{ id?: string }`
third argument. Connections without an explicit ID get an
auto-generated `conn-{N}` based on registration order. `route:*`
events include `connectionId` so subscribers can correlate per-replica
outcomes.

```ts
const primaryConn = connection(primary,  patterns, { id: "primary" });
const eastMirror  = connection(mirror,   patterns, { id: "mirror-east" });
const otherMirror = connection(mirror2,  patterns); // gets conn-2 by default

const rig = new Rig({
  routes: {
    receive: [primaryConn, eastMirror, otherMirror],
    read:    [primaryConn],
  },
});
```

When the connection is itself a multi-peer client like `flood(peers)`
(Ch 14), the `connectionId` on `route:*` events identifies the peer
that actually accepted or rejected — peer names come from
`peer(name, client)`.

## What the rig deliberately doesn't ship

- **No `broadcastPolicy` knob.** The rig stays neutral. If a topology
  wants "first-route-accepts" or "all-routes-must-accept" semantics,
  the caller composes it from `route:success`/`route:error` events.
- **No `routes` field on `ReceiveResult`.** Single paper-trail.
  Per-route detail lives in events.
- **No per-route retry mechanism in the rig.** Retry strategy is
  endpoint-specific — the client/store knows what's safe to retry on
  its own transport. App-level retry, when needed, lives in caller
  code listening to `route:error`.

## How `send` and `receive` differ

Both go through the same `_pipeline` body. The direction label
controls which hooks fire (`beforeSend` / `afterSend` versus
`beforeReceive` / `afterReceive`) and which events emit
(`send:success|error` versus `receive:success|error`). The pipeline
itself runs uniformly; programs classify, handlers interpret,
reactions fire, broadcasts dispatch — independent of direction.

## Reactions

Reactions fire after each emission's routes settle (only if at least
one route accepted), and their returned `Output[]` spawn a fresh
`rig.send` operation with its own handle. Reaction loops are a usage
error; the framework does not detect them.

## `receiveOrThrow` / `sendOrThrow`

Convenience helpers for callers who'd rather see exceptions than
inspect `accepted`. They throw on pipeline-stage rejection only —
route failures still arrive as events, never as thrown errors.
