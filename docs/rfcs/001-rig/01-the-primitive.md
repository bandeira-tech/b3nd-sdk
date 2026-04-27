# 1. One tuple to rule them all

A single named type carries everything b3nd ever puts on the wire.

```ts
type Output<T = unknown> = [
  uri: string,
  values: Record<string, number>,
  payload: T,
];
```

That's the wire primitive. Three positions. A URI that addresses the tuple, a
`values` map that protocols use for conserved quantities, and a `payload`
slot the framework treats as opaque. There is no `Message` type alongside
`Output`. There never was, really — they were aliases of each other in the
old code — but the proposal makes the absence official. **`Output` is the
only name the wire knows.**

This is a small change in shape and a large change in posture.

## What `values` is for

The middle slot looks empty in 99% of examples — `[uri, {}, data]` is the
shape readers will see in tutorials, in tests, in their own code. That's
fine. `values` is the slot a protocol uses when it has **conserved
quantities** to track: a UTXO ledger that needs each input's `{ usd: 100 }`
to balance the outputs' `{ usd: 50, usd: 50 }`, a gas-metered protocol that
needs each tuple to declare `{ gas: 7 }`, a points system that mints with
`{ points: 1000 }`. The framework does not interpret the slot. The protocol's
program does — by reading `values`, comparing inputs to outputs, and
returning a code that says "yes, this conserves" or "no, this mints from
nothing."

The slot exists because b3nd is a framework for protocols that need to
exchange addressed, balanced state across an untrusted network. UTXO-style
conservation is not the only reason the slot is there, but it is the
canonical reason, and it earns the position.

We considered renaming `values` to `quantities` to make the UTXO intent
visible at the type. We rejected the rename. The name is acceptable, the
docstring will spell the intent out in plain English, and a forced rename
costs every existing caller a diff for a marginal readability win. The slot
stays.

## What `payload` is for

The third slot is anything. The framework treats it as opaque. Programs
interpret it according to whatever convention the protocol layers on top.
A protocol that uses `MessageData`-style envelopes puts
`{ inputs, outputs, auth }` here. A protocol that just stores key-value
pairs puts the value here. A protocol that wants encrypted blobs puts an
`{ ciphertext, nonce, ephemeralKey }` here. The shape is the protocol's
choice, not the framework's.

This is the change in posture. Today the framework recognizes one specific
payload shape — the `{ inputs, outputs }` envelope — and behaves
differently when it sees one. That recognition leaks into `MessageDataClient`,
into `rig.send`, into the conceptual gap between `send` and `receive`. The
proposal pulls all of that out. The framework looks at the URI for routing
and hands the payload to a program for interpretation. End of framework
involvement.

## What `uri` is for

URIs name. They also route. A connection accepts an operation on a URI by
matching the URI against a pattern (`mutable://*`, `publish://meta/*`,
`hash://sha256/*`). That's the framework's whole routing story, and it
stays exactly as-is in this proposal. Connection patterns are good. They
work. They survive untouched.

URIs also let programs key on prefixes. A program registered at
`mutable://accounts` runs against any tuple whose URI starts with that
prefix. Programs are the framework's classification primitive; URIs are how
programs find the tuples they own.

## What changed in this chapter

- `Output<T>` is the sole tuple type on the wire.
- `Message` as a distinct named type is retired. Where the existing code
  said `Message`, it now says `Output`.
- `values` survives. The slot is real. The name is acceptable.
- `payload` is opaque to the framework. Protocols choose its shape.

## What's coming next

The next chapter says what the Rig knows and — more usefully — what it
deliberately does not know about a tuple's payload. From there we build the
pipeline.
