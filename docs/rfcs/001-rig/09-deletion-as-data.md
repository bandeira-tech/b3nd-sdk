# 9. Deletion is data

A tuple with `null` in the payload position means "delete this URI."

```ts
[uri, null]
```

The convention rides on the existing `Output` type. On the wire it
looks like any other tuple. In the pipeline it flows like any other
tuple. The interpretation happens in each downstream client.

Pulling deletion into the wire format makes it inspectable,
observable, replicable — same as every other state change.

## `DataStoreClient`

The canonical Store adapter for the wire convention. It wraps any
`Store` and implements `ProtocolInterfaceNode`:

```ts
class DataStoreClient implements ProtocolInterfaceNode {
  constructor(public store: Store) {}

  async receive(outs: Output[]): Promise<ReceiveResult[]> {
    const results: ReceiveResult[] = [];
    for (const [uri, payload] of outs) {
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

One file, one class, one branch on the payload. Stores keep their
existing `write` / `delete` interface. Wrapping any
`Store` — `MemoryStore`, `PostgresStore`, `S3Store`, `IndexedDBStore`,
any future implementation — gives you a client the rig can route
through.

## How other client types interpret null

Each client type interprets a null payload per its role.

| Client type | What null means |
|---|---|
| `DataStoreClient` (Store adapter) | `store.delete([uri])` |
| Audit log / append-only client | Append a delete-event record; never overwrite prior state |
| Forwarding client (replication) | Forward `[uri, null]` to the peer; the peer's own client interprets it |
| Webhook / outbound client | POST the null payload; receiving system interprets |
| Subscriber client (browser, dashboard) | Stream the null through; UI removes the rendered element |
| Console / debug client | Print `[uri, null]` alongside writes |

Deletions replicate naturally because the wire format encodes them.

## Reactions on deletions

Reactions fire on every successful broadcast — including null
payloads. A reaction can branch on the payload:

```ts
const userReaction: Reaction = async ([uri, data]) => {
  if (data === null) {
    return [[`index://users/deleted/${Date.now()}`, { uri }]];
  }
  return [[`index://users/active/${parseId(uri)}`, data]];
};
```

Front-ends and indexes get deletion as a first-class event.

## How `MessageData` uses null

`messageDataHandler` (Ch 8) translates the envelope's `inputs` —
URIs the intent consumes — into null-payload tuples:

```ts
const messageDataHandler: CodeHandler = async (out) => {
  const [, payload] = out as Output<MessageData>;
  const deletions = payload.inputs.map((uri) => [uri, null] as Output);
  return [out, ...payload.outputs, ...deletions];
};
```

The rig dispatches each through `routes.receive`. Each client's
`DataStoreClient` (or alternative) does the right thing for its
role.

## A note on literal nulls

Null is reserved for deletion. To store "the value here is
explicitly absent" as a value, use a sentinel payload —
`{ kind: "absent" }` or whatever your protocol needs. The wire
convention takes the null slot for deletion semantics.

## What's coming next

Auth — where authentication evidence lives in a tuple and the canon
recognizers protocols compose to verify it.
