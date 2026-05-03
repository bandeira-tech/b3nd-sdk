# 13. Per-route observability via OperationHandle

`rig.send(outs)` and `rig.receive(outs)` return an `OperationHandle`.
It's both **awaitable** (resolves to `ReceiveResult[]` once the
pipeline classifies and the handler runs) and a **scoped event
emitter** (per-stage and per-route detail as the operation
progresses).

## The shape

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
  | "process:error"    // program threw or returned an error code
  | "handle:emit"      // handler emissions
  | "handle:error"     // handler threw
  | "route:success"    // per (emission, connection) accept
  | "route:error"      // per (emission, connection) reject
  | "reaction:error"   // reaction threw
  | "settled";         // all routes done
```

`ReceiveResult` stays minimal — `{ accepted, error?, errorDetail? }`.
Per-route and per-phase detail lives in events.

## Two await points

```ts
const op = rig.receive([msg]);

op.on("route:success", (e) => {
  metrics.write_success.inc({ connection: e.connectionId });
});
op.on("route:error", (e) => {
  retryQueue.push({ emission: e.emission, target: e.connectionId });
});

const results = await op;     // pipeline ack — process + handle done
await op.settled;              // every route on every emission has reported
```

`await op` returns once `process` and `handle` have run for every
input tuple. Broadcast continues in the background; `route:*`
events fire as connections respond. `await op.settled` returns when
every route — every `(emission, connection)` pair, including
emissions from reactions — has reported success or error.

For read-after-write semantics across replicas, await `settled`
before the next read.

## What `accepted` means

`{ accepted: true }` means the pipeline accepted the input —
`process` classified, `handle` ran, the rig has a topology to
dispatch through. Whether downstream connections actually wrote is
the route events' job.

`{ accepted: false }` means the pipeline rejected at one of:
- A program threw or returned an error code.
- No connection in `routes.receive` accepts the URI.
- The handler threw.

## Dispatch flow

```
rig.receive(outs)
  ├─ for each output (in batch):
  │    process(out)         → ProgramResult        ┐
  │    emit "process:done" or "process:error"      │ inline
  │    handle(out, result)  → emissions            │
  │    emit "handle:emit" or "handle:error"        │
  │    schedule broadcast(emissions)               │
  └─ resolve pipeline promise                     ─┘ ← `await op` returns here

  In the background:
  ┌─ broadcast each emission to every matching connection
  │    emit "route:success" / "route:error" per (emission, connection)
  ├─ for each emission, fire reactions if any route accepted
  │    emit "reaction:error" if a reaction throws
  └─ emit "settled" when every route reports     ← `await op.settled`
```

## Connection IDs

`connection(client, patterns, { id? })` takes an optional stable ID.
Without one, connections get `conn-{N}` based on registration order.
`route:*` events carry `connectionId` so subscribers can correlate
per-replica outcomes.

```ts
const primaryConn = connection(primary,  patterns, { id: "primary" });
const eastMirror  = connection(mirror,   patterns, { id: "mirror-east" });
const otherMirror = connection(mirror2,  patterns); // gets conn-2

const rig = new Rig({
  routes: { receive: [primaryConn, eastMirror, otherMirror], read: [primaryConn] },
});
```

When the underlying client fans across peers — `flood(peers)`
(Ch 14) — the peer name comes through as the `connectionId` for
that route.

## Aggregation policy lives in callers

The rig doesn't aggregate per-route outcomes into a collapsed
boolean. Callers compose the policy they want — strict (all must
accept), best-effort (any one is fine), quorum (majority) — by
listening to `route:*` events.

```ts
// Quorum-of-three example:
let accepted = 0;
op.on("route:success", () => accepted++);
await op.settled;
if (accepted < 2) throw new Error("quorum failed");
```

## Error events + onError hook

The error events surface every failure phase on the handle:
`process:error`, `handle:error`, `route:error`, `reaction:error`.

For a unified observation point — and the ability to abort the
operation synchronously — register `onError` in the rig's hooks:

```ts
const rig = new Rig({
  routes: { ... },
  hooks: {
    onError: (ctx) => {
      // ctx.phase is "process" | "handle" | "route" | "reaction"
      logger.warn(`[${ctx.phase}]`, ctx.input[0], ctx.error);
      if (ctx.phase === "handle") throw ctx.cause; // fail-fast on handler crashes
    },
  },
});
```

`onError` runs synchronously in the catch path. **Throw** to abort
the whole operation (the throw propagates through `await op` and
`await op.settled`). **Return** to let the rig keep going with
normal error handling.

## `receiveOrThrow` / `sendOrThrow`

Convenience helpers for callers who'd rather see exceptions than
inspect `accepted`:

```ts
const results = await rig.receiveOrThrow([msg]);
// throws on any pipeline-stage rejection; route failures still
// arrive as events, never as thrown errors
```

## How `send` and `receive` differ

Same pipeline body, different observability surfaces. The direction
label picks which hooks fire and which events emit:

| | `send` | `receive` |
|---|---|---|
| Hooks | `beforeSend` / `afterSend` | `beforeReceive` / `afterReceive` |
| Direction events | `send:success` / `send:error` | `receive:success` / `receive:error` |

Programs, handlers, reactions, and broadcast all run identically.
