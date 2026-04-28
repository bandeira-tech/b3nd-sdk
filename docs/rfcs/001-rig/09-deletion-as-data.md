# 9. Deletion is data

A tuple with `null` in the payload position means "delete this URI."

```ts
[uri, null]
```

That's the whole convention. Two positions in the tuple, the second
is `null`, the meaning is "remove the data at this URI." On the wire
it looks like any other tuple. In the pipeline it flows like any
other tuple. The only difference is what each downstream client does
with it.

This is the data-level representation of an action that would
otherwise live as an imperative side effect inside a storage
adapter. Pulling it into the wire format makes deletion inspectable,
observable, replicable — all the things the rest of the state already
is.

## Why null instead of a flag

Null is cheap because it's already in the type system.
`Output<T = unknown>` permits `null` for free. Programs that don't
care about deletion ignore the null and continue. Programs that do
care check `payload === null` and branch. Clients that care
implement a one-line check.

Two alternatives — a `tombstone: true` field on a wrapper shape, or
a separate dedicated tuple type distinct from `Output` for deletions
— add framework-level machinery that null doesn't. A `tombstone`
flag would force every reader and writer in the system to know about
a tagged-union shape: programs, handlers, clients, stores, observers,
replication. A separate type would force the pipeline to handle two
distinct shapes. Either way the cost is everywhere; the benefit is
mild semantic clarity.

The total framework delta for `[uri, null]` is "document the
convention." Done.

## What `DataStoreClient` does

`DataStoreClient` (`libs/b3nd-core/data-store-client.ts`) is the
canonical Store adapter for the wire convention. It wraps any
`Store` and implements the `ProtocolInterfaceNode` the Rig expects
from a connection's client:

```ts
class DataStoreClient implements ProtocolInterfaceNode {
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
  observe(...) { /* ... */ }
  status() { return this.store.status(); }
}
```

One file, one class, one branch on the payload. Stores stay exactly
as they are — the existing `Store.write` / `Store.delete` interface
is fine. The translation lives in this client, which is the only
place that needs to know about the convention.

A node that uses any of `MemoryStore`, `PostgresStore`, `MongoStore`,
`SqliteStore`, `S3Store`, `IndexedDBStore`, or any future Store
implementation just wraps it in `DataStoreClient`. No per-Store
change.

## What other client types do

`DataStoreClient` is the canonical case. Other client types — clients
that don't write to a `Store` — interpret null payloads per their
role.

**Audit logs / append-only stores.** A null payload is a
deletion-event record. The audit client appends an entry like
`{ uri, action: "delete", at: timestamp }` and never overwrites prior
state for that URI. The history of writes-and-deletes is preserved.

**Forwarding clients (replication).** A forwarder client passes the
null along to the peer it's forwarding to. The peer receives a tuple
with a null payload and dispatches it through *its* pipeline, where
its own `DataStoreClient` (or whatever it has) interprets the null.
Deletions replicate naturally because the wire format encodes them.

**Webhook / outbound clients.** A client that posts tuples to an
external HTTP endpoint sends the null payload as part of the JSON
body. The receiving system interprets — many will treat null-payload
as a delete event in their own data model.

**Subscribers (browsers, dashboards).** A client that streams to a
front-end pushes the null payload through. UI code sees a null
payload on a URI it's rendering and knows to remove the corresponding
element. Front-ends that subscribe to deletion-aware reactions react
without polling.

**Console / debug clients.** A console-logging client prints the
tuple as-is. `[uri, null]` shows up in the log alongside writes,
visibly representing the deletion intent.

## What reactions do for null tuples

Reactions fire on writes — by which we mean "successful broadcasts
of a tuple", not "non-null payloads". A reaction registered against
`mutable://app/users/:id` fires for *both* `[uri, profile]` writes
and `[uri, null]` deletions. The reaction handler receives the
payload as the second argument and can branch:

```ts
const userReaction: Reaction = async (out) => {
  const [uri, data] = out;
  if (data === null) {
    return [[`index://users/deleted/${Date.now()}`, { uri }]];
  }
  return [[`index://users/active/${parseId(uri)}`, data]];
};
```

Front-ends and indexes get deletion as a first-class event because
deletion is on the wire as data.

## How `MessageData` decomposition uses null

The `messageDataHandler` from Ch 8 emits the constituent tuples of
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
The delete flows through the wire as data, observable to every
client in the topology.

## What `null` does *not* mean

Null is the deletion convention. It is not a way to write a literal
"the value at this URI is null" record. If a protocol genuinely
needs to store the absence of a value as a value, it uses a sentinel
payload — an empty object, a typed `{ kind: "absent" }`, a
protocol-specific representation. The wire convention reserves null
for deletion.

This is a tradeoff. It costs protocols the use of literal-null as a
payload. It buys deletion-as-data with zero framework machinery.

## What's coming next

Auth — where authentication evidence lives in a tuple, why the
framework doesn't pick a location, and how the SDK ships canonical
recognizers programs can compose without forcing a single layout.
