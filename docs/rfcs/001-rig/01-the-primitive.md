# 1. One tuple to rule them all

A single named type carries everything b3nd ever puts on the wire.

```ts
type Output<T = unknown> = [
  uri: string,
  payload: T,
];
```

That's the wire primitive. Two positions. A URI that addresses the tuple
and a `payload` slot the framework treats as opaque. There is no
`Message` type alongside `Output`. There never was, really — they were
aliases of each other in the old code — but the proposal makes the
absence official. **`Output` is the only name the wire knows.**

The previous design carried a third slot (`values`) for what protocols
treat as conserved quantities — UTXO balances, gas amounts, token
counts. The proposal retires it. The slot wasn't pulling its weight: the
framework didn't enforce conservation, the slot signposted protocol
intent the framework couldn't honor, and 99% of callers wrote `{}`
because they had nothing to put there. Protocols that need conservation
encode it inside `payload`, the same place every other piece of
protocol-specific state lives.

This is a small change in shape and a meaningful change in posture.

## What `payload` is for

The second slot is anything. The framework treats it as opaque. Programs
interpret it according to whatever convention the protocol layers on top.

A protocol that uses `MessageData`-style envelopes puts
`{ inputs, outputs, auth }` here. A protocol with conserved quantities
puts something like `{ values: { coin: 100 }, owner, ... }` here — the
shape is the protocol's choice. A protocol that just stores key-value
pairs puts the value here. A protocol that wants encrypted blobs puts
`{ ciphertext, nonce, ephemeralKey }` here.

The shape is the protocol's choice, not the framework's. No slot in the
tuple privileges any one shape over any other.

## What `uri` is for

URIs name. They also route. A connection accepts an operation on a URI
by matching the URI against a pattern (`mutable://*`, `publish://meta/*`,
`hash://sha256/*`). That's the framework's whole routing story, and it
stays exactly as-is in this proposal. Connection patterns are good. They
work. They survive untouched.

URIs also let programs key on prefixes. A program registered at
`mutable://accounts` runs against any tuple whose URI starts with that
prefix. Programs are the framework's classification primitive; URIs are
how programs find the tuples they own.

## Why two positions and not one

A natural question: if `payload` is opaque, why not collapse the tuple
into a single `payload` and let the protocol carry the URI inside it?

Because the URI is the framework's only routing signal. The connection
pattern matcher needs the URI exposed in a known position so it can
inspect it without parsing the payload. If the URI lived inside the
payload, every routing decision would require the framework to peek at
protocol-specific data — which is exactly the coupling we're working to
remove.

Two positions is the minimum: one position the framework reads (the
URI), one position the framework doesn't (the payload). Three positions
was one too many.

## What this means for protocols that had conserved quantities

Protocols that used the old `values` slot move the quantities into the
payload. A UTXO ledger that wrote
`["utxo://abc/0", { coin: 100 }, { owner, amount }]` now writes
`["utxo://abc/0", { values: { coin: 100 }, owner, amount }]`. Same
information, one position over.

The protocol's program that checked conservation reads from
`payload.values` instead of from the tuple's middle slot. One line of
program code changes. The framework doesn't change because the
framework was never reading `values` anyway — it only ever passed the
slot through.

This is the test of whether the slot was framework-level: if removing
it costs the framework nothing, it wasn't framework-level. It cost
nothing.

## What changed in this chapter

- `Output<T>` is the sole tuple type on the wire.
- The tuple is `[uri, payload]`. The middle `values` slot retires.
- `Message` as a distinct named type is retired. Where the existing code
  said `Message`, it now says `Output`.
- `payload` is opaque to the framework. Protocols choose its shape.
- Protocols that used the old `values` slot move conserved quantities
  inside `payload`. The framework loses no expressiveness; it just
  loses a position it wasn't using.

## What's coming next

The next chapter says what the Rig knows and — more usefully — what it
deliberately does not know about a tuple's payload. The list shrinks
again, now that the tuple has shrunk.
