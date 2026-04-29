# 4. Send and receive — direction is observability

`send` and `receive` are the two everyday entry points. They run the
same pipeline body — `process → handle → react`. The label picks
which hooks fire and which events emit.

| Direction | Meaning | Hooks | Events |
|---|---|---|---|
| `send` | Host originates the tuple (button click, worker emit, signed envelope) | `beforeSend` / `afterSend` | `send:success` / `send:error` |
| `receive` | Host accepts state from elsewhere (peer, webhook, sync) | `beforeReceive` / `afterReceive` | `receive:success` / `receive:error` |

Programs, handlers, and reactions run the same way for both.
Validation rules apply uniformly.

## Hooks

```ts
type Hooks = {
  beforeSend?:    (ctx: SendCtx) => Promise<void> | void;
  afterSend?:     (ctx: SendCtx, results: ReceiveResult[]) => Promise<void> | void;
  beforeReceive?: (ctx: ReceiveCtx) => Promise<void> | void;
  afterReceive?:  (ctx: ReceiveCtx, results: ReceiveResult[]) => Promise<void> | void;
};
```

Use them for operational policy at the direction boundary —
attaching origin metadata, rate-limiting peers, recording sync
cursors, telemetry. Throw from a before-hook to refuse the operation:

```ts
const rig = new Rig({
  routes: { ... },
  hooks: {
    beforeReceive: (ctx) => {
      if (perPeerRate(ctx.uri).exceeded()) {
        throw new Error("rate limited");
      }
    },
    afterSend: (ctx, results) => {
      audit.log({ uri: ctx.message[0], accepted: results[0].accepted });
    },
  },
});
```

Hooks live at the direction layer. Per-phase observability
(`process:done`, `handle:emit`, route outcomes) lives on the
operation handle (Ch 13).

## Events

```
send:success      receive:success
send:error        receive:error
```

Four direction-level events, fired per-tuple, fire-and-forget.

```ts
const rig = new Rig({
  routes: { ... },
  on: {
    "send:success": [forwardToPeers],
    "*:error": [alertOps],   // wildcard — both directions
  },
});

// Or register at runtime:
const unsub = rig.on("receive:success", (e) => log(e.uri));
```

Per-`(emission, connection)` outcomes — for callers tracking
individual replicas — surface on the operation handle as
`route:success` / `route:error` (Ch 13).

## The signing flow

The rig is identity-blind. Signing happens one layer above, in
caller code:

```ts
import { Identity, Rig, connection, message } from "@bandeira-tech/b3nd-sdk";

const id = await Identity.fromSeed("my-secret");

const outputs: Output[] = [
  ["mutable://app/users/alice", { name: "Alice" }],
];

const auth = [await id.sign({ inputs: [], outputs })];
const envelope = await message({ auth, inputs: [], outputs });

await rig.send([envelope]);
```

`Identity.sign` returns a `{ pubkey, signature }` object. `message`
builds the canonical content-addressed envelope at
`hash://sha256/{computed}`. With `messageDataProgram` and
`messageDataHandler` registered (Ch 8), `rig.send([envelope])`
classifies the envelope, decomposes it into its outputs, and
dispatches each through connection routing.

Protocols using a different auth shape (URI-pubkey, capability
tokens, transport-level trust) inline auth in the payload directly
and skip the envelope (Ch 10).

## Return shape

```ts
const op = rig.send([msg]);

const results = await op;       // ReceiveResult[] — one per input tuple
op.on("route:success", handler); // per-route detail
await op.settled;                 // wait for all routes to finish
```

Both `send` and `receive` return an `OperationHandle` — awaitable
for the pipeline result, observable for per-stage detail. Chapter 13
walks through it.

## What's coming next

Part III opens with handlers — what they're for and how they shape
the dispatch list.
