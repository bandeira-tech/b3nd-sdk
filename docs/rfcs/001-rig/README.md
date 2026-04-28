# RFC 001 — The Rig

**Status:** RC1 · shipped
**Author:** SDK maintainers
**Format:** A short design book, in the spirit of `docs/book/`. Each chapter
is small, self-contained, and can evolve on its own.

---

This RFC describes the shape of the Rig at 1.0. It's the architectural
posture the framework now operates under: **payload-agnostic Rig, payload
conventions in the SDK and protocols, deletion as data, `send` and
`receive` as observability flavors of one pipeline**.

The book reads chapter by chapter so each idea has room to breathe and
each piece can be reviewed independently.

## Where the code stands

| Slice | Where it lives |
|---|---|
| Wire primitive: `Output<T> = [uri, payload]` | `libs/b3nd-core/types.ts` |
| Pure pipeline (handlers/reactions return `Output[]`) | `libs/b3nd-rig/rig.ts` |
| `DataStoreClient` (Store ↔ wire convention) | `libs/b3nd-core/data-store-client.ts` |
| `messageDataProgram` + `messageDataHandler` (canon) | `libs/b3nd-msg/data/canon.ts` |
| `OperationHandle` + per-route events | `libs/b3nd-rig/operation-handle.ts` |
| Multi-source replicas: `flood(peers)` | `libs/b3nd-network/policies/flood.ts` |
| `ProtocolInterfaceNode` (PIN) | `libs/b3nd-core/types.ts` |

`AuthenticatedRig` retired; identity layering is now built directly on
top of `Rig` via `Identity` + `message()` (see Ch 10). The convenience
class is gone; the pattern is two lines of caller code.

## How to read it

Three movements, plus a finale of operational chapters.

**Part I — The Primitive.** What flows on the wire and what the Rig
knows about it. Two short chapters. Read these first; everything later
compounds on them.

**Part II — The Pipeline.** How a tuple becomes an action. Process,
handle, react, the direction-flavored wrappers `send` and `receive`,
hooks and events.

**Part III — Handlers and Fan-out.** What a handler is for, what
broadcast does, and what to do when one message turns into many.

**Part IV — Conventions Live in Protocols.** Decomposition,
deletion-as-data, and authentication — three things the framework
deliberately does not know about and the SDK ships canon helpers for.

**Part V — Walkthroughs.** Two end-to-end stories: a UTXO ledger (data)
and a multi-channel ad fan-out (network). Both use the same primitives.

**Part VI — Operational chapters.** Per-route observability via
`OperationHandle`, and multi-source replicas via `flood(peers)`.

## Table of contents

### Part I — The Primitive
- [01. One tuple to rule them all](./01-the-primitive.md)
- [02. The Rig doesn't read your mail](./02-payload-agnostic-rig.md)

### Part II — The Pipeline
- [03. Process, handle, react](./03-process-handle-react.md)
- [04. Send and receive — direction is observability](./04-send-and-receive.md)

### Part III — Handlers and Fan-out
- [05. A handler is an interpretation](./05-handlers.md)
- [06. Broadcast — the only fan-out](./06-broadcast.md)
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

## What's deliberately out of scope

- A `values` (or `quantities`) slot in the wire primitive. The
  framework primitive is `[uri, payload]` only. Protocols that need
  conserved quantities encode them inside `payload` — see Chapter 1.
- A registry of canon SDK handlers beyond what we ship for `MessageData`.
  Protocols that want their own decomposition handlers ship them in
  their own packages.
- Browser/IndexedDB consequences of deletion-as-data. The wire-level
  contract is universal; per-store integration is its own follow-up.
- Encrypted-batch read ergonomics. Lives with canon enhancement work
  outside this RFC.
