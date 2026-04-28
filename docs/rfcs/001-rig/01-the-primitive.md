# 1. One tuple to rule them all

A single named type carries everything b3nd ever puts on the wire.

```ts
type Output<T = unknown> = [
  uri: string,
  payload: T,
];
```

Two positions. A URI that addresses the tuple and a `payload` slot the
framework treats as opaque. There is no `Message` type alongside
`Output` — `Message` is an alias of `Output`, kept around because
"message" is a useful conversational name. **`Output` is the only
shape the wire knows.**

The tuple has no third slot. There is no framework-level position for
conserved quantities (UTXO balances, gas, token counts). Protocols
that need conservation encode quantities inside `payload`, the same
place every other piece of protocol-specific state lives.

## What `payload` is for

The second slot is anything. The framework treats it as opaque.
Programs interpret it according to whatever convention the protocol
layers on top.

A protocol that uses `MessageData`-style envelopes puts
`{ inputs, outputs, auth }` here. A protocol with conserved quantities
puts something like `{ values: { coin: 100 }, owner, ... }` here — the
shape is the protocol's choice. A protocol that just stores key-value
pairs puts the value here. A protocol that wants encrypted blobs puts
`{ ciphertext, nonce, ephemeralKey }` here.

The shape is the protocol's choice, not the framework's. No slot in
the tuple privileges any one shape over any other.

## What `uri` is for

URIs name. They also route. A connection — `(client, patterns)` — is
bound into one or more route arrays (`routes.receive`, `routes.read`,
`routes.observe`); the Rig matches each tuple's URI against the
patterns on the relevant route to decide which clients participate.
Patterns are simple strings — `mutable://*`, `publish://meta/*`,
`hash://sha256/*`. That's the framework's whole routing story.

URIs also let programs key on prefixes. A program registered at
`mutable://accounts` runs against any tuple whose URI starts with that
prefix. Programs are the framework's classification primitive; URIs
are how programs find the tuples they own.

## Why two positions and not one

A natural question: if `payload` is opaque, why not collapse the
tuple into a single `payload` and let the protocol carry the URI
inside it?

Because the URI is the framework's only routing signal. The
connection pattern matcher needs the URI exposed in a known position
so it can inspect it without parsing the payload. If the URI lived
inside the payload, every routing decision would require the
framework to peek at protocol-specific data — exactly the coupling
the framework refuses.

Two positions is the minimum: one position the framework reads (the
URI), one position the framework doesn't (the payload).

## What conserved-quantity protocols look like

Protocols that need conservation encode quantities inside the
payload at a key the protocol prescribes. A UTXO ledger writes:

```ts
["utxo://abc/0", { values: { coin: 100 }, owner: alicePubkey }]
```

The protocol's program reads `payload.values.coin` and sums across
inputs and outputs to check conservation. The framework never reads
`values`; it just passes the payload through. Conservation is a
protocol property, not a framework property.

## What's coming next

Chapter 2 — what the Rig knows about a tuple's payload, and what it
deliberately doesn't.
