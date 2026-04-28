# 4. Send and receive — direction is observability

`send` and `receive` are the two methods most callers touch. They
mean exactly one thing each, and the difference between them is
purely observational.

## The shape

`send` and `receive` are direction labels. They both run the same
pipeline — the `process → handle → react` triple from Ch 3. The only
difference is which hooks fire and which events emit.

```ts
class Rig {
  send(outs: Output[]): OperationHandle {
    return this._pipeline(outs, "send");
  }

  receive(outs: Output[]): OperationHandle {
    return this._pipeline(outs, "receive");
  }

  // _pipeline runs `process`, dispatches each output through `handle`,
  // schedules broadcast in the background, and returns an
  // OperationHandle that is awaitable (PromiseLike<ReceiveResult[]>)
  // and exposes per-route events. See Ch 13.
}
```

The body is the same. The hooks and events differ.

## What direction means

`send` is the host application acting as the origin: "I produced this
tuple and I'm putting it on the wire." It corresponds to a button
click, a job running, a worker emitting state, the application's
identity signing something. Subscribers to `send:success` know the
host application is responsible for what arrived.

`receive` is the host application accepting state from elsewhere: "I
got this tuple from a peer, an inbound HTTP request, an upstream
sync, an imported file." Subscribers to `receive:success` know the
host did not originate this content.

The pipeline body doesn't care. Programs run regardless. Handlers run
regardless. Reactions fire regardless. The protocol's validation
rules apply uniformly.

The hooks let host code participate in the difference. A
`beforeSend` hook might attach an `Origin` header, encrypt with the
host's identity, or record the user gesture that triggered the
action. A `beforeReceive` hook might apply rate limiting per peer,
record a sync cursor, or strip peer-specific metadata. These are
operational concerns, not validation concerns. Validation lives in
programs.

## Signing — the canonical caller pattern

The Rig is identity-blind. Signing is one layer above:

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

`Identity.sign` produces a `{ pubkey, signature }` object. `message`
builds the canonical content-addressed envelope tuple at
`hash://sha256/{computed}`. `rig.send([envelope])` runs the pipeline:
`messageDataProgram` classifies the envelope as `msgdata:valid`,
`messageDataHandler` decomposes it into the constituent outputs,
broadcast dispatches each through connection routing.

Signing canon lives in the SDK (`message`, `Identity`). The Rig
itself takes pre-prepared tuples and dispatches them. Programs that
want to verify signatures verify them; programs that don't, don't.

A protocol that uses a different auth shape (URI-pubkey, capability
tokens, transport-level trust) skips the envelope step and either
inlines auth into the payload directly or relies on connection-level
trust (Ch 10).

## The hook surface

```ts
type Hooks = {
  beforeSend?:    (ctx: SendCtx) => Promise<void> | void;
  afterSend?:     (ctx: SendCtx, results: ReceiveResult[]) => Promise<void> | void;
  beforeReceive?: (ctx: ReceiveCtx) => Promise<void> | void;
  afterReceive?:  (ctx: ReceiveCtx, results: ReceiveResult[]) => Promise<void> | void;
};
```

Two pairs. No `beforeProcess`/`afterProcess` or
`beforeHandle`/`afterHandle` — observation at the pipeline-phase
level is what events and reactions are for. The hook layer is the
direction-level boundary, period.

Hooks throw to abort. A `beforeSend` hook that throws stops the
pipeline for that batch and surfaces the error. This is intentional —
hooks are operational policy (rate limit, auth check, telemetry), and
operational policy needs to be able to refuse.

## The event surface

```
send:success      receive:success
send:error        receive:error
```

Four direction-level events, fired per-tuple. Subscribers attach to
one or both directions according to what they care about. A
WebSocket replication system subscribes to `send:success` to forward
outbound tuples to peers. A metrics dashboard subscribes to
`*:error` to count failures.

Direction-level events fire once per top-level call. Per-route
detail (per `(emission, connection)` pair, including handler
emissions and reactions' downstream sends) flows through the
operation handle's scoped events: `process:done`, `handle:emit`,
`route:success`, `route:error`, `settled` (Ch 13).

Each role has one mechanism: hooks for direction-level interception,
direction events for direction-level notification, scoped operation
events for per-route detail, reactions for URI-pattern observation.

## What `send` and `receive` return

Both return `OperationHandle`. It is awaitable as
`PromiseLike<ReceiveResult[]>` so existing `await rig.send(outs)` and
`await rig.receive(outs)` calls work without change. It also exposes
`.on(...)` for per-route events and `.settled` for "all routes
finished." Chapter 13 walks through the handle in full.

## What's coming next

Part III opens with handlers — what they're for, why they own the
"interpretation" role, and why they return data instead of calling
broadcast.
