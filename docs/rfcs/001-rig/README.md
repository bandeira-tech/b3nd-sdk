# RFC 001 — The Rig

**Status:** Proposal · pre-1.0 (RC1)
**Author:** SDK maintainers
**Format:** A short design book, in the spirit of `docs/book/`. Each chapter is
small, self-contained, and can evolve on its own.

---

This RFC proposes the shape of the Rig at 1.0. It comes out of an exploration
round that surfaced a handful of surprising behaviors in the current code —
programs not firing on `send()`, envelope decomposition leaking out of the
framework, identity handling baked into core, a `values` slot nobody could
explain. Rather than patching each in isolation, we found a single
architectural move that resolves most of them: **make the Rig payload-agnostic,
push payload conventions up to the SDK and protocols, treat deletion as data,
and let `send`/`receive` be observability flavors of the same pipeline**.

This document is that move, written out chapter by chapter so each idea has
room to breathe and so the proposal can be reviewed, amended, and ratified one
piece at a time.

There are no code changes in this RFC. Implementation lands in follow-up PRs
sequenced at the end.

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

**Part VI — Operational Loose Ends.** Three smaller items independent of the
core proposal — per-connection result granularity, list-read federation,
mixed-plaintext encrypted reads.

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
- [07. Re-entry, when a handler needs another pass](./07-re-entry.md)

### Part IV — Conventions Live in Protocols
- [08. Decomposition is the protocol's job](./08-decomposition.md)
- [09. Deletion is data](./09-deletion-as-data.md)
- [10. Auth lives where your protocol says](./10-auth.md)

### Part V — Walkthroughs
- [11. A UTXO ledger, end to end](./11-walkthrough-utxo.md)
- [12. Multi-channel ad fan-out, end to end](./12-walkthrough-fanout.md)

### Part VI — Operational Loose Ends
- [13. Per-connection result granularity](./13-per-connection-results.md)
- [14. List-read federation](./14-list-federation.md)
- [15. Encrypted batch reads with mixed plaintext](./15-encrypted-batch.md)

## Sequencing for implementation

The chapters above describe a single architectural change plus three
independent operational items. The implementation order:

1. **Part I + Part II + Part III + Part IV** — land as one cohesive
   architectural PR. Touches `Rig`, `MessageData`, `MessageDataClient`,
   `AuthenticatedRig`, the SDK exports, and most existing tests. Breaking.
2. **Per-connection result granularity** (Ch. 13) — small, independent.
3. **List-read federation** (Ch. 14) — small, independent.
4. **Encrypted batch reads** (Ch. 15) — smallest, independent. Polish PR.

## What's deliberately out of scope

- A `values` (or `quantities`) slot in the wire primitive. The framework
  primitive is `[uri, payload]` only. Protocols that need conserved
  quantities encode them inside `payload` — see Chapter 1.
- Codemods for the breaking changes in Part I–IV. Pre-1.0; sed-level
  rewrites are fine.
- A registry of canon SDK handlers beyond what we ship for `MessageData`.
  Protocols that want their own decomposition handlers ship them in their
  own packages.
- Browser/IndexedDB consequences of deletion-as-data. The wire-level
  contract is universal; per-store integration is its own follow-up.
