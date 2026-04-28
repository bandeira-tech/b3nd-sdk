# RFC 001 — The Rig

**Status:** RC1 · partially shipped, partially proposed
**Author:** SDK maintainers
**Format:** A short design book, in the spirit of `docs/book/`. Each chapter is
small, self-contained, and can evolve on its own.

---

This RFC describes the shape of the Rig at 1.0. It comes out of an exploration
round that surfaced a handful of surprising behaviors in the original code —
programs not firing on `send()`, envelope decomposition leaking out of the
framework, identity handling baked into core, a `values` slot nobody could
explain. Rather than patching each in isolation, we found a single
architectural move that resolves most of them: **make the Rig payload-agnostic,
push payload conventions up to the SDK and protocols, treat deletion as data,
and let `send`/`receive` be observability flavors of the same pipeline**.

The book is written chapter by chapter so each idea has room to breathe and
each piece can be reviewed, amended, and ratified one piece at a time.

## What's shipped, what's still in flight

| Slice | Status | PR |
|---|---|---|
| Part I — Primitive (`[uri, payload]`) | **shipped** | [#89](https://github.com/bandeira-tech/b3nd-sdk/pull/89) |
| Parts II + III + IV — pure pipeline (handlers/reactions return `Output[]`; `MessageDataClient` split into `DataStoreClient` + canon program/handler; deletion-as-data) | **shipped** | [#91](https://github.com/bandeira-tech/b3nd-sdk/pull/91) |
| Part VI ch. 13 — per-route observability via `OperationHandle` | **shipped** | [#94](https://github.com/bandeira-tech/b3nd-sdk/pull/94) |
| Part VI ch. 14 — multi-source replicas | **already shipping** as `flood(peers)` in `@bandeira-tech/b3nd-sdk/network` (predates this RFC) |
| Part VI ch. 15 — `readEncryptedMany` mixed-plaintext | **superseded** — `AuthenticatedRig` is being retired in favor of canon enhancements; encrypted-batch ergonomics live with that work |
| `AuthenticatedRig` itself | **scheduled for retirement** — replaced by canon enhancements outside this repo. The convenience class stays usable through the transition; identity-as-primitive is the post-retirement story |

If you came here for the design rationale, every chapter still applies — the
framework's posture didn't change between proposal and shipped code. If you
came for what's left to do, the answer is small (Ch 14/15 are dissolved; the
AuthenticatedRig retirement is the only architectural item still moving, and
it's happening externally).

## How to read it

Three movements, plus a finale of operational loose ends:

**Part I — The Primitive.** What flows on the wire and what the Rig knows
about it. Two short chapters. Read these first; everything later compounds on
them.

**Part II — The Pipeline.** How a tuple becomes an action. Process, handle,
react, the direction-flavored wrappers `send` and `receive`, hooks and events.

**Part III — Handlers and Fan-out.** What a handler is for, what `broadcast`
does, and what to do when one message turns into many.

**Part IV — Conventions Live in Protocols.** Decomposition, deletion-as-data,
and authentication — three things the framework deliberately does not know
about and the SDK ships canon helpers for.

**Part V — Walkthroughs.** Two end-to-end stories: a UTXO ledger (data) and a
multi-channel ad fan-out (network). Both use the same primitives.

**Part VI — Operational Loose Ends.** Two operational chapters — per-route
observability (shipped) and multi-source replicas (already shipping pre-RFC).

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

### Part VI — Operational Loose Ends
- [13. Per-route observability via OperationHandle](./13-per-connection-results.md)
- [14. Multi-source replicas — `flood(peers)`](./14-list-federation.md)

## What's deliberately out of scope

- A `values` (or `quantities`) slot in the wire primitive. The framework
  primitive is `[uri, payload]` only. Protocols that need conserved
  quantities encode them inside `payload` — see Chapter 1.
- Codemods for the breaking changes that landed in Parts I–IV. Pre-1.0;
  sed-level rewrites were fine.
- A registry of canon SDK handlers beyond what we ship for `MessageData`.
  Protocols that want their own decomposition handlers ship them in their
  own packages.
- Browser/IndexedDB consequences of deletion-as-data. The wire-level
  contract is universal; per-store integration is its own follow-up.
- `AuthenticatedRig` retirement and what replaces it. Tracked outside this
  RFC via canon-enhancement work; this book stays focused on the framework
  shape, not the canon library.
- Encrypted-batch read ergonomics (the original Ch 15). Goes away with
  AuthenticatedRig.
