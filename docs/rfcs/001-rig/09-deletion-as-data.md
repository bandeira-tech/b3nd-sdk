# 9. Deletion is data

A tuple with `null` in the payload position means "delete this URI."

```ts
[uri, null]
```

That's the whole convention. Two positions in the tuple, the second is
`null`, the meaning is "remove the data at this URI." On the wire it
looks like any other tuple. In the pipeline it flows like any other
tuple. The only difference is what each downstream client does with it.

This is the data-level representation of an action that today lives
imperatively inside `MessageDataClient.receive` as a call to
`store.delete()`. Pulling it out into the wire format makes deletion
inspectable, observable, replicable — all the things the rest of the
state already is.

## Why null instead of a flag

We considered two alternatives: a `tombstone: true` field on a wrapper
shape, and a separate dedicated tuple type distinct from `Output` for
deletions. Both add framework-level machinery that null doesn't.

A `tombstone` flag would mean expanding the wire primitive into a tagged
union. That choice forces every reader and writer in the system to know
about the new shape — programs, handlers, clients, stores, observers,
replication. The cost is everywhere; the benefit is mild semantic
clarity.

A separate dedicated type would mean the pipeline has to handle two
distinct shapes — Output for writes, Tombstone for deletes — and every
primitive that operates on Output has to be checked for whether it
should also operate on Tombstone. Same story: cost everywhere, benefit
modest.

Null is cheap because it's already in the type system. `Output<T = unknown>`
permits `null` for free. Programs that don't care about deletion ignore
the null and continue. Programs that do care check `payload === null` and
branch. Clients that care implement a one-line check. The total framework
delta is "document the convention." Done.

## What `DataStoreClient` does

`DataStoreClient` is the canonical Store adapter for the new wire
convention. It wraps any `Store` and implements the `NodeProtocolInterface`
the Rig expects from a connection's client:

```ts
class DataStoreClient implements NodeProtocolInterface {
  constructor(public store: Store) {}

  async receive(outs: Output[]): Promise<ReceiveResult[]> {
    const results: ReceiveResult[] = [];
    for (const out of outs) {
      const [uri, payload] = out;
      if (payload === null) {
        await this.store.delete([uri]);
      } else {
        await this.store.write([{ uri, data: payload }]);
      }
      results.push({ accepted: true });
    }
    return results;
  }

  read(uris: string | string[]) { return this.store.read(uris); }
  status() { return this.store.status(); }
  observe(...) { /* ... */ }
}
```

That's the whole thing. One file, one class, one branch on the payload.
Stores stay exactly as they are — the existing `Store.write` /
`Store.delete` interface is fine. The translation lives in this client,
which is the only place that needs to know about the convention.

A node that uses any of `MemoryStore`, `PostgresStore`, `MongoStore`,
`SqliteStore`, `S3Store`, `IndexedDBStore`, or any future Store
implementation just wraps it in `DataStoreClient`. No per-Store change.

## What other client types do

`DataStoreClient` is the canonical case. Other client types — clients
that don't write to a `Store` — interpret null payloads per their role.

**Audit logs / append-only stores.** A null payload is a
deletion-event record. The audit client appends an entry like
`{ uri, action: "delete", at: timestamp }` and never overwrites prior
state for that URI. The history of writes-and-deletes is preserved.

**Forwarding clients (replication).** A forwarder client passes the null
along to the peer it's forwarding to. The peer receives a tuple with a
null payload and dispatches it through *its* pipeline, where its own
`DataStoreClient` (or whatever it has) interprets the null. Deletions
replicate naturally because the wire format encodes them.

**Webhook / outbound clients.** A client that posts tuples to an
external HTTP endpoint sends the null payload as part of the JSON body.
The receiving system interprets — many will treat null-payload as a
delete event in their own data model.

**Subscribers (browsers, dashboards).** A client that streams to a
front-end pushes the null payload through. UI code sees a null payload
on a URI it's rendering and knows to remove the corresponding element.
This is a strict gain over today: front-ends currently have no way to
observe deletions because deletions never reach them as events.

**Console / debug clients.** A console-logging client prints the tuple
as-is. `[uri, null]` shows up in the log alongside writes, visibly
representing the deletion intent.

## What reactions do for null tuples

Reactions fire on writes — by which we mean "successful broadcasts of a
tuple", not "non-null payloads". A reaction registered against
`mutable://app/users/:id` fires for *both* `[uri, profile]` writes and
`[uri, null]` deletions. The reaction handler receives the payload as
the second argument and can branch on whether it's null:

```ts
rig.reaction("mutable://app/users/:id", (uri, data, params) => {
  if (data === null) {
    removeUserFromUI(params.id);
  } else {
    renderUser(params.id, data);
  }
});
```

This is the observability we don't have today. Today, deletions inside
`MessageDataClient.receive` happen as a side effect that doesn't surface
through observe / reactions / events. Front-ends rendering off a
deletion-aware reaction need a poll-and-diff to notice. After this
chapter, deletions are first-class and front-ends just react.

## How `MessageData` decomposition uses null

The `messageDataHandler` from chapter 8 emits the constituent tuples of
an envelope:

```ts
const messageDataHandler: CodeHandler = async (out) => {
  const [, payload] = out as Output<MessageData>;
  const inputDeletions: Output[] = payload.inputs.map(
    (uri) => [uri, null] as Output,
  );
  return [out, ...payload.outputs, ...inputDeletions];
};
```

The `inputs` field of a `MessageData` envelope says "these URIs are
consumed by this intent." Consumption means deletion. The handler
expresses that as `[inputUri, null]` tuples in its return list. The
Rig dispatches each through connection routing. Each client's
`DataStoreClient` (or alternative) interprets the null appropriately.

The behavior is the same as today's `MessageDataClient` does it — the
inputs get deleted, the outputs get written. The difference is that the
delete now flows through the wire as data, observable to every client
in the topology, instead of being a side effect inside a single client's
receive method.

## What `null` does *not* mean

Null is the deletion convention. It is not a way to write a literal
"the value at this URI is null" record. If a protocol genuinely needs to
store the absence of a value as a value, it uses a sentinel payload — an
empty object, a typed `{ kind: "absent" }`, a protocol-specific
representation. The wire convention reserves null for deletion.

This is a tradeoff. It costs protocols the use of literal-null as a
payload. It buys deletion-as-data with zero framework machinery. We
think the trade is right; protocols rarely want to store literal-null
and frequently want to express deletion.

## What changed in this chapter

- `[uri, null]` is the wire convention for "delete this URI."
- `DataStoreClient` is the canonical Store adapter that translates null
  payloads into `store.delete()` calls. Stores themselves are
  unchanged.
- Other client types interpret null per their role: audit logs append
  deletion records, forwarders forward, subscribers stream the null.
- Reactions fire for null-payload tuples with `data === null` so
  observers can act on deletions.
- The `MessageDataClient` decomposition behavior moves to broadcasting
  `[inputUri, null]` tuples — same outcome, visible in the data stream.
- Literal-null payloads are reserved by the convention. Protocols that
  want to store absence use a sentinel value.

## What's coming next

Auth — where authentication evidence lives in a tuple, why the
framework doesn't pick a location, and how the SDK ships canonical
recognizers programs can compose without forcing a single layout.
