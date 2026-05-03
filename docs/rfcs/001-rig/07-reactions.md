# 7. Reactions — productive observation

A reaction is what runs when a write lands. It observes; it can also
produce.

```ts
type Reaction = (
  out: Output,
  read: ReadFn,
) => Promise<Output[]>;
```

Reactions are registered against URI patterns. When a tuple is
successfully dispatched, every reaction whose pattern matches the
URI runs with the tuple as input. The reaction returns the tuples
it wants the rig to put on the wire.

## Reaction emissions go through `rig.send`

Handler emissions broadcast directly. Reaction emissions go through
the **full pipeline** — `rig.send` runs programs and handlers on
them, more reactions can fire on their results, the chain unfolds.

This makes reaction emissions first-class tuples in the system. They
go through hooks, fire `send:*` events, get their own operation
handle (Ch 13), and can be classified or rejected by programs.

## Three worked patterns

**Notifications.** A reaction on user-profile updates emits a
notification tuple:

```ts
const notifyOnProfileUpdate: Reaction = async ([uri, payload]) => {
  if (payload === null) return [];
  const userId = uri.split("/")[3];
  return [
    [`notify://email/${userId}`, { template: "profile-updated", payload }],
  ];
};

const rig = new Rig({
  routes: { ... },
  reactions: {
    "mutable://app/users/:id": notifyOnProfileUpdate,
  },
});
```

A connection registered for `notify://email/*` belongs to a webhook
client. The notification flows through routing like any other
tuple.

**Indexing.** A reaction on UTXO writes emits a balance index update:

```ts
const indexLeaderboard: Reaction = async ([_uri, payload], read) => {
  if (payload === null) return [];
  const owner = (payload as { owner: string }).owner;
  const balance = await sumBalanceFor(owner, read);
  return [[`index://leaderboard/${owner}`, { balance }]];
};
```

The index URI flows through the pipeline — an indexer's program
classifies it, an indexer's handler persists it.

**Audit logs.** A reaction on any state change emits a log entry:

```ts
const audit: Reaction = async ([uri, payload]) => [[
  `audit://log/${Date.now()}`,
  { uri, payload, kind: payload === null ? "delete" : "write" },
]];
```

Deletions log the same way writes do — everything is data.

## Scope vs. handlers

Both handlers and reactions are pure-return — same shape, same
testability. The difference is when they run:

- A **handler** runs *inside* the operation. Its emissions are part
  of `await op`'s contract — the caller sees them resolve as part
  of the original call.
- A **reaction** runs *after* the operation. The original `send`
  returned before the reaction fired. Its emissions are a fresh
  pipeline pass with their own `OperationHandle`.

Callers who need reactions to settle before considering the
operation complete use `await op.settled` instead of just
`await op` — `settled` resolves once every route on every emission
(handler outputs and reactions' downstream dispatches) has reported
(Ch 13).

## Why pure-return matters

A reaction that imperatively calls `fetch` is invisible at the data
layer. A reaction that returns `[["notify://email/alice", {...}]]`
is a tuple on the wire — observable, testable, replicable. The same
routing engine that persists a UTXO update fans out a notification.

Empty return is fine — pure observation:

```ts
const audit: Reaction = async ([uri, payload]) => {
  log.write({ uri, payload });
  return [];
};
```

Side effects in the reaction body work, but if you find yourself
doing it often, the side effect probably wants its own client
behind its own URI prefix.

## Loops

A reaction can return a tuple that, after going through the
pipeline, lands at a URI the same reaction observes. The framework
runs the loop.

Cycle prevention is a protocol-design concern. The convention:
descend the URI namespace. `mutable://app/users/:id` reactions emit
to `index://users/:id` or `notify://email/:id`, never back into
`mutable://app/users/*`. Chains terminate naturally.

For unbounded recursion, encode a depth bound or generation marker
in the tuple itself and check it in a program.

## What's coming next

Part IV — conventions live in protocols. Decomposition is first:
`MessageData` envelopes, the canon program/handler pair that
unpacks them, and how nested envelopes flow through the same shape.
