# 14. List-read federation

## The problem

A trailing-slash URI is a list query. `read("mutable://app/items/")`
means "give me everything under this prefix." The current Rig
implementation iterates connections in declaration order and stops at
the first one that accepts the prefix — even if that connection returns
an empty array, even if other connections hold items at the same
prefix.

```ts
// libs/b3nd-rig/rig.ts (current)
for (const s of connections) {
  if (!s.accepts("read", matchUri)) continue;
  const results = await s.client.read<T>(uri);
  if (isList) {
    allResults.push(...results);
    found = true;
    break;             // ← stops at first connection
  }
  // ...
}
```

This is correct for point reads — one URI, one answer; the first
connection that has it wins, the rest are fallbacks. It is wrong for
list reads. A list query is implicitly "everything I can find at this
prefix." Stopping at the first connection means a list query against a
topology with both a primary store and a mirror returns only the
primary's items, hiding everything the mirror has that the primary
doesn't.

This bites in three real situations:

- A cache → primary topology where the cache is partial. List from the
  cache returns the partial set; the user assumes that's the full set.
- A federation across regional shards. Each shard has different items.
  List against the Rig returns one shard's items; the user has no way
  to ask "across all shards."
- Hybrid local/remote where local is offline-first storage and remote
  is the source of truth. List during offline returns the local subset;
  reconnecting doesn't change what subsequent list calls return until
  the local cache is re-synced.

## The proposal

Federate list reads by default, with an explicit opt-out per call.

For trailing-slash URIs, the Rig iterates *every* matching connection,
gathers each connection's results, and returns the merged set. For
non-trailing URIs (point reads), the current first-match behavior is
correct and stays.

```ts
// proposed rig.ts
async read(uris, opts: { federate?: boolean } = {}) {
  const federate = opts.federate ?? true;     // default: true
  // ... per-uri loop
  const isList = uri.endsWith("/");
  const matchUri = isList ? uri.slice(0, -1) : uri;
  if (isList && federate) {
    const merged: ReadResult<T>[] = [];
    for (const s of connections) {
      if (!s.accepts("read", matchUri)) continue;
      merged.push(...(await s.client.read<T>(uri)));
    }
    allResults.push(...merged);
    continue;
  }
  // existing first-match behavior for point reads (and federate:false)
}
```

Callers who want the old first-match behavior on a list (because they
*want* layered overlay semantics, not federation) pass
`{ federate: false }` explicitly:

```ts
const offlineFirst = await rig.read("mutable://app/items/", {
  federate: false,
});
```

## What about duplicates?

A federated list across multiple connections can return the same URI
twice — once from the primary, once from the mirror. The Rig does not
de-duplicate. De-duplication is a caller concern because the right
de-duplication strategy depends on the protocol:

- For mutable URIs where the latest write wins, the caller might dedupe
  by URI and pick the result with the highest timestamp.
- For content-addressed URIs (`hash://...`), duplicates are
  bit-identical so any dedupe-by-URI is safe.
- For protocols that maintain version vectors or vector clocks, the
  caller does CRDT-style merging instead of dedupe.

Folding any of these into the Rig would force one strategy on all
protocols. We propose leaving it to callers and shipping a small
canonical helper in the SDK for the common dedupe-by-URI case.

## What about ordering?

Federated results are returned in the order they were collected:
connection-order outer, per-connection-result-order inner. Callers that
need a specific ordering sort. The Rig does not sort because it doesn't
know the right key (timestamp? URI? user-defined?).

A canonical SDK helper for "sort by URI ascending" is cheap and obvious;
we'd ship it alongside the dedupe helper.

## What about the per-connection breakdown?

The Rig already has the per-connection result breakdown internally
(it's the same iteration). For consistency with chapter 13, we propose
attaching it to the list response as a new optional field on `ReadResult`,
populated only when the read was federated:

```ts
type ReadResult<T> = {
  // existing fields...
  perConnection?: Array<{
    connectionId: string;
    items: ReadResult<T>[];   // raw per-connection items
  }>;
};
```

When the federation surfaces conflicts (same URI in multiple
connections with different data), the caller can drop down to
`perConnection` to see exactly who returned what. For non-conflicting
results, the caller ignores the field and uses the merged set
directly.

## API impact

Breaking in the observable sense. List reads now return more results
than they used to, for any topology with multiple matching read
connections. Callers that relied on the implicit first-match behavior —
typically a cache → primary overlay — pass `{ federate: false }` to
get back the old semantics.

`Rig.read` signature gains an options bag:

```ts
read<T>(uris: string | string[], opts?: { federate?: boolean }): Promise<ReadResult<T>[]>;
```

Existing callers that pass only a URI continue to work; they just see
federated list results when they have multi-connection topologies.

## Why not the other defaults

We considered three alternative defaults and rejected each:

- **Default `federate: false` (today's behavior), require explicit
  opt-in.** Cements the surprise. New users pay the cost of having to
  know the option exists. Rejected.
- **Federate everything including point reads.** Point reads have a
  natural "first match wins" semantic — one URI, one answer — and
  changing them disrupts the cache → primary overlay pattern that's
  in wide use. Rejected.
- **A new method `listAll()` distinct from `read("prefix/")`.** Adds
  surface area and forces callers to know about the difference.
  Trailing-slash already signals list intent; let the existing
  signal carry the new meaning. Rejected.

The proposal — default federate for list reads, explicit opt-out —
matches what the trailing slash already promises ("everything under
this prefix") without requiring callers to learn a new API.

## What changed in this chapter

- List reads (trailing-slash URIs) federate across all matching
  connections by default.
- Callers can opt back into first-match-only with `{ federate: false }`.
- Point reads keep their current first-match behavior — one URI, one
  answer.
- De-duplication and sorting are caller concerns, with canonical SDK
  helpers for the common cases.
- `ReadResult` gains an optional `perConnection` field surfacing the
  raw per-connection results for federated reads.

## What's coming next

Chapter 15 — the smallest of the operational items. `readEncryptedMany`
currently throws if any URI in the batch holds non-encrypted data,
making it useless for the common "fetch a mixed bag" case. We propose a
tagged-result variant.
