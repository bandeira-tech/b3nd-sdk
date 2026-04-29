# 0. Overview — the Rig and its pipeline

The Rig is a router. Tuples come in, the rig classifies them, runs
the protocol's handler, dispatches the result through configured
clients, and lets observers react. Everything else in the book is a
detail of one of these steps.

This chapter sketches the whole shape so the rest reads as
elaboration.

## The wire primitive

```ts
type Output<T = unknown> = [uri: string, payload: T];
```

Two positions. The URI addresses the tuple; the rig reads it for
routing. The payload is whatever the protocol wants to send; the rig
treats it as opaque.

A tuple with `null` in the payload position is the deletion
convention: `[uri, null]` says "remove the data at this URI."

## The configuration shape

```ts
import {
  Rig, connection, DataStoreClient, MemoryStore,
  messageDataProgram, messageDataHandler,
} from "@bandeira-tech/b3nd-sdk";

const local = connection(new DataStoreClient(new MemoryStore()), ["*"]);

const rig = new Rig({
  routes: {
    receive: [local],   // broadcast: every accepting connection
    read:    [local],   // first match wins; lists gather
    observe: [local],   // first match wins; client owns transport
  },
  programs: {
    "hash://sha256":  messageDataProgram,   // classifier
  },
  handlers: {
    "msgdata:valid":  messageDataHandler,   // interpreter
  },
  hooks: {
    beforeReceive: (ctx) => { /* throw to refuse */ },
    afterSend:     (ctx, results) => { /* observe */ },
    onError:       (ctx) => { /* throw to abort the operation */ },
  },
  on: {
    "send:success": [audit],
    "*:error":      [alertOps],
  },
  reactions: {
    "mutable://users/:id": notifyOnUserChange,   // pure-return
  },
});
```

Five fields. `routes` wires clients to the three operations
(receive, read, observe). `programs` and `handlers` are the
protocol's classifier and interpreter, keyed on URI prefix and code.
`hooks` are synchronous interception points. `on` and `reactions`
are async observers.

## The pipeline

A `rig.send(outs)` or `rig.receive(outs)` call runs each input
tuple through five phases:

```
                ┌─ beforeSend / beforeReceive ─┐  hooks may throw to refuse
                ▼                              │
        ┌──────────────┐                       │
        │  process     │ ─► ProgramResult      │  classify the tuple
        └──────────────┘                       │
                ▼                              │
        ┌──────────────┐                       │
        │  handle      │ ─► Output[]           │  interpret — return tuples to dispatch
        └──────────────┘                       │
                ▼                              │
        ┌──────────────┐                       │
        │  broadcast   │ ─► route:* events     │  fan out via routes.receive
        └──────────────┘                       │
                ▼                              │
        ┌──────────────┐                       │
        │  react       │ ─► Output[]           │  observe; emissions re-enter rig.send
        └──────────────┘                       │
                ▼                              │
                └─ afterSend / afterReceive ───┘
```

**process** runs the registered program — pure classifier that
returns a code (`"valid"`, `"insufficient-funds"`, `"replay"`,
whatever the protocol's vocabulary says). If no program is
registered for the URI, the default code is `"ok"`.

**handle** runs the handler registered for the code — pure
transform that returns the `Output[]` to dispatch. If no handler is
registered for the code, the rig dispatches the input as-is
(default-write).

**broadcast** matches each emission against `routes.receive` and
dispatches to every accepting connection. Per `(emission,
connection)` outcomes surface as `route:success` / `route:error`
events on the operation handle.

**react** fires reactions whose URI patterns match each emission's
URI. Reactions are pure-return — their emissions go through
`rig.send` (full pipeline, not bare broadcast), spawning their own
operation handle.

**hooks** wrap the whole call. `beforeSend` / `beforeReceive`
throw to refuse. `afterSend` / `afterReceive` observe. `onError`
fires synchronously in the catch path of every error phase
(`process`, `handle`, `route`, `reaction`) — throw to abort.

## The return shape

```ts
const op = rig.send([msg]);

const results = await op;          // pipeline ack — process + handle done
op.on("route:success", (e) => …);  // per (emission, connection) detail
await op.settled;                   // every route on every emission has reported
```

`OperationHandle` is awaitable (resolves to `ReceiveResult[]`) and
exposes scoped events:

| Event | Fires when |
|---|---|
| `process:done` | A program produced a classification |
| `process:error` | A program threw or returned an error code |
| `handle:emit` | A handler returned its emissions |
| `handle:error` | A handler threw |
| `route:success` | One connection accepted one emission |
| `route:error` | One connection rejected one emission |
| `reaction:error` | A reaction threw |
| `settled` | All routes for the operation reported |

Two await points, two granularities. `await op` returns once the
pipeline ack lands. `await op.settled` returns when every route
(including emissions from reactions) has reported.

## Send vs. receive

Both run the same pipeline. The label picks which hooks fire and
which events emit:

| Direction | Meaning | Hooks | Direction events |
|---|---|---|---|
| `send` | Host originates the tuple | `beforeSend` / `afterSend` / `onError` | `send:success` / `send:error` |
| `receive` | Host accepts state from elsewhere | `beforeReceive` / `afterReceive` / `onError` | `receive:success` / `receive:error` |

Programs, handlers, reactions, and broadcast run identically.

## Hello world

```ts
import {
  Rig, connection, DataStoreClient, MemoryStore,
} from "@bandeira-tech/b3nd-sdk";

const local = connection(new DataStoreClient(new MemoryStore()), ["*"]);

const rig = new Rig({
  routes: { receive: [local], read: [local], observe: [local] },
});

await rig.receive([["mutable://app/config", { theme: "dark" }]]);

const data = await rig.readData("mutable://app/config");
// → { theme: "dark" }
```

No programs, no handlers — every tuple gets the default `{ code: "ok" }`
classification and the default-write path persists it through
`routes.receive`.

## Where to go next

| If you want to understand… | Read |
|---|---|
| What's on the wire | Ch 1 — the primitive |
| What the rig knows vs. what protocols own | Ch 2 — the rig's surface |
| How the pipeline composes | Ch 3 — process / handle / react |
| Direction-flavored entry points | Ch 4 — send / receive |
| What handlers return and why | Ch 5 — handlers |
| How emissions reach clients | Ch 6 — broadcast |
| Side effects as data | Ch 7 — reactions |
| Envelope decomposition (`MessageData`) | Ch 8 — decomposition |
| Deletion semantics | Ch 9 — deletion is data |
| Signing and verification | Ch 10 — auth |
| End-to-end (UTXO) | Ch 11 — walkthrough |
| End-to-end (multi-channel fan-out) | Ch 12 — walkthrough |
| Per-route observability | Ch 13 — OperationHandle |
| Multi-source replicas | Ch 14 — flood(peers) |
