# RFC 001 — The Rig

**Status:** RC1 · shipped
**Format:** A short design book. Each chapter is small, self-contained,
and can be reviewed independently.

---

This RFC describes the shape of the Rig at 1.0. The shape, in one
sentence: **a payload-agnostic router with a three-phase pipeline
(process → handle → react), per-op connection routes, and a small
canon library for the conventions protocols share.**

The book reads chapter by chapter so each idea has room to breathe.

## Where the code lives

| Slice | File |
|---|---|
| Wire primitive: `Output<T> = [uri, payload]` | `libs/b3nd-core/types.ts` |
| Pipeline + dispatch | `libs/b3nd-rig/rig.ts` |
| `DataStoreClient` (Store ↔ wire convention) | `libs/b3nd-core/data-store-client.ts` |
| `messageDataProgram` + `messageDataHandler` (canon) | `libs/b3nd-msg/data/canon.ts` |
| `OperationHandle` + per-route + per-phase events | `libs/b3nd-rig/operation-handle.ts` |
| `routes: { receive, read, observe }` | `libs/b3nd-rig/types.ts`, `libs/b3nd-rig/connection.ts` |
| Multi-source replicas: `flood(peers)` | `libs/b3nd-network/policies/flood.ts` |
| `ProtocolInterfaceNode` (PIN) | `libs/b3nd-core/types.ts` |
| `Identity` + `message()` (signing canon) | `libs/b3nd-rig/identity.ts`, `libs/b3nd-msg/data/message.ts` |

## How to read it

Start with [00 — Overview](./00-overview.md) for the whole shape in
one chapter. Then drill into whichever movement matters:

**Part I — The Primitive.** The wire shape and the rig's surface.
Two short chapters.

**Part II — The Pipeline.** How a tuple becomes an action: process,
handle, react, with `send` / `receive` as direction-flavored
wrappers.

**Part III — Handlers and Fan-out.** What a handler returns, what
broadcast does with it, how reactions chain.

**Part IV — Conventions Live in Protocols.** Decomposition,
deletion-as-data, and authentication — the SDK ships canon helpers
each protocol composes.

**Part V — Walkthroughs.** Two end-to-end stories: a UTXO ledger
(data) and a multi-channel ad fan-out (network). Same primitives,
different shapes.

**Part VI — Operational chapters.** Per-route observability via
`OperationHandle`, and multi-source replicas via `flood(peers)`.

## Table of contents

- [00. Overview — the Rig and its pipeline](./00-overview.md)

### Part I — The Primitive
- [01. One tuple to rule them all](./01-the-primitive.md)
- [02. The Rig doesn't read your mail](./02-payload-agnostic-rig.md)

### Part II — The Pipeline
- [03. Process, handle, react](./03-process-handle-react.md)
- [04. Send and receive — direction is observability](./04-send-and-receive.md)

### Part III — Handlers and Fan-out
- [05. A handler is an interpretation](./05-handlers.md)
- [06. Broadcast — what the rig does with a handler's return](./06-broadcast.md)
- [07. Reactions — productive observation](./07-reactions.md)

### Part IV — Conventions Live in Protocols
- [08. Decomposition is the protocol's job](./08-decomposition.md)
- [09. Deletion is data](./09-deletion-as-data.md)
- [10. Auth lives where your protocol says](./10-auth.md)

### Part V — Walkthroughs
- [11. A UTXO ledger, end to end](./11-walkthrough-utxo.md)
- [12. Multi-channel ad fan-out, end to end](./12-walkthrough-fanout.md)

### Part VI — Operational chapters
- [13. Per-route observability via OperationHandle](./13-per-connection-results.md)
- [14. Multi-source replicas — `flood(peers)`](./14-list-federation.md)

## Out of scope for this RFC

- Per-store integration of `[uri, null]` deletion semantics — the
  wire convention is universal; backend-specific work lives with
  each store.
- Encrypted-batch read ergonomics — lives with canon-enhancement
  work outside this RFC.
- A registry of canon decomposition handlers beyond `MessageData` —
  protocols that need their own decomposition ship handlers in
  their own packages.
