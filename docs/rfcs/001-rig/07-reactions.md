# 7. Reactions — productive observation

A reaction is what runs when a write lands. It observes; it can also
produce.

```ts
type Reaction = (
  out: Output,
  read: ReadFn,
) => Promise<Output[]>;
```

A reaction is registered against a URI pattern. When a tuple is
successfully dispatched and its URI matches a pattern, the
corresponding reaction runs with the tuple as input. It returns
`Output[]` — the tuples it wants the Rig to put on the wire as a
consequence of what it just observed.

What the Rig does with reaction returns is the chapter's main point,
and it's different from what it does with handler returns.

## Reaction outputs go through `rig.send`, not broadcast

Handler outputs go through broadcast — direct connection routing, no
program re-classification. Reaction outputs go through `rig.send` —
**full pipeline, programs run, handlers run, more reactions can fire**.

The asymmetry is deliberate. A handler is the canonical interpreter of
its protocol code; its outputs are protocol-valid by handler-fiat, so
re-classification would be redundant. A reaction is an
application-level observer responding to what happened, and its
emissions might target URIs governed by entirely different programs
the reaction author may not even know about. Those need full
classification.

In practice this means a reaction's emissions are first-class tuples
in the system. They go through hooks, they fire `send:*` events, they
can be classified and rejected by programs, they can match further
reactions. A reaction is a producer in its own right.

## "Isn't this just re-entry by another name?"

Mechanically, yes. A reaction can return tuples that fire reactions
that return tuples that fire reactions. That's recursion through the
pipeline — the same dynamic re-entry-from-handlers would have had.

The meaningful difference is **scope**. A handler runs inside a
`send`/`receive` call and its output is part of that call's contract:
the caller's `await rig.send([...])` resolves with everything the
handler emitted. A reaction is fire-and-forget by design: the original
`send`/`receive` returned before the reaction fired. Whatever a
reaction emits is its own subsequent act, not an extension of the
original call's scope.

That distinction matters. Callers know exactly what their explicit
`send` covers — pipeline classifies, handler interprets, broadcasts
land. Reactions chain afterward, asynchronously, on the host's reactive
clock. A reaction loop doesn't violate the original send's contract;
it's just the host's reactive system doing too much work.

## Why this is the right shape

Three reasons.

**Visibility.** A reaction body that imperatively calls `fetch` or
pushes to a queue is invisible at the data layer. A reaction that
returns `[["notify://email/alice", { template: "...", to }]]` is a
tuple on the wire — observable, testable, replicable, mockable. The
same machinery that fans out a UTXO write to two stores fans out a
"user updated" notification to an email service. One uniform model.

**Testability.** A reaction with a pure-return contract is a function
from input to output. Test by calling it; assert on the return. No
mocked Rig, no captured-effects scaffolding. Same as handlers.

**Composability.** Reactions can compose with other reactions through
URI namespace. A reaction observing `mutable://app/users/:id` can
emit to `index://users/:id`; a reaction observing `index://users/*`
can emit to `audit://daily/{date}`. Each layer is independent,
testable, and visible. None of them know about each other beyond the
URIs they emit and observe.

## Loops are usage error

A reaction can return a tuple that, after going through the pipeline,
lands at a URI that the same reaction observes. Without care, that's
infinite recursion. The framework does not detect it.

Cycle prevention is a protocol-design concern. The convention: design
reactions so they emit to URIs that descend the namespace they
observed — `mutable://app/users/:id` reactions emit to
`index://users/:id` or `notify://email/:id`, never back into
`mutable://app/users/*`. Chains terminate naturally.

If a protocol genuinely needs unbounded reaction recursion, it
encodes a depth bound or a generation marker in the tuple itself and
checks it in a program. The framework will not.

## Where this shows up in practice

A few worked patterns:

**Notifications.** A reaction observing user-profile updates emits a
notification tuple:

```ts
const notifyOnProfileUpdate: Reaction = async (out) => {
  const [uri, payload] = out;
  if (payload === null) return [];
  const userId = uri.split("/")[3];
  return [
    [`notify://email/${userId}`, { template: "profile-updated", payload }],
  ];
};
```

A connection registered for `notify://email/*` belongs to a webhook
client that posts to the email service. The notification flows through
routing the same way any other tuple does.

**Indexing.** A reaction observing UTXO writes emits an index update:

```ts
const indexLeaderboard: Reaction = async (out, read) => {
  const [, payload] = out;
  if (payload === null) return [];
  const owner = (payload as { owner: string }).owner;
  const balance = await sumBalanceFor(owner, read);
  return [[`index://leaderboard/${owner}`, { balance }]];
};
```

The index URI flows through the pipeline; an indexer's program
classifies it, an indexer's handler persists it.

**Audit logs.** A reaction observing any state change emits a log
entry:

```ts
const audit: Reaction = async (out) => {
  const [uri, payload] = out;
  return [
    [`audit://log/${Date.now()}`, { uri, payload, kind: payload === null ? "delete" : "write" }],
  ];
};
```

The log URI lands at an audit-log connection (an append-only client).
Deletions get logged the same way writes do, because everything is
data.

## What about reactions that don't want to emit anything?

A reaction can return `[]`. The Rig dispatches nothing further. This
is the pure-observation case — "I saw it, I responded by doing
nothing." Useful for reactions that update an in-memory cache the
host application owns:

```ts
const cacheUpdater: Reaction = async (out) => {
  const [uri, payload] = out;
  inMemoryCache.set(uri, payload);
  return [];
};
```

This blurs the pure-return contract — `inMemoryCache.set` is a side
effect outside the routing engine. It's allowed because the framework
can't prevent it and shouldn't try; pure-return is an architectural
direction, not a hard sandbox. But if you find yourself doing this
often, the cache should probably be its own client behind a
`cache://` URI prefix.

## What changed in this chapter

- Reactions are pure-return like handlers: take a tuple and `read`,
  return `Output[]`.
- Reaction outputs go through `rig.send` (full pipeline) — not
  broadcast (which skips programs).
- This is mechanically re-entry; it's scope-wise distinct because
  reactions are fire-and-forget post-action, not part of the original
  send/receive's contract.
- Loops are usage error. Cycle prevention is a protocol-design
  concern (descend the URI namespace).
- Reactions are how "side effects move to the boundary" gets
  practical: notifications, indexes, audit logs, replication — all
  expressed as Output emissions to URIs claimed by appropriate
  clients.

## What's coming next

Part IV — conventions live in protocols. Decomposition is first:
how `MessageData` envelopes get unpacked, why that unpacking lives in
a protocol-supplied handler instead of a framework-blessed client,
and how N-level nested envelopes flow through the same pattern.
