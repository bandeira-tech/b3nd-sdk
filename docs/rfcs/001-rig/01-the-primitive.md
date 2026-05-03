# 1. One tuple to rule them all

A single named type carries everything b3nd puts on the wire.

```ts
type Output<T = unknown> = [
  uri: string,
  payload: T,
];
```

Two positions. The URI addresses the tuple. The `payload` is whatever
the protocol wants to send. The framework reads the URI to route; it
treats `payload` as opaque.

`Message` is an alias of `Output` — same shape, conversational name.

## The payload

Anything goes. The framework hands the payload to whichever program
or client the URI routes to; those layers know what shape they
expect.

```ts
// Plain key-value
["mutable://app/config", { theme: "dark" }]

// Envelope (for protocols using MessageData)
["hash://sha256/abc", { inputs: [...], outputs: [...], auth: [...] }]

// Encrypted blob
["mutable://secrets/x", { ciphertext, nonce, ephemeralKey }]

// Domain object with a conserved quantity
["utxo://abc/0", { values: { coin: 100 }, owner: alicePubkey }]
```

A protocol that needs conserved quantities (UTXO balances, gas, token
counts) encodes them at a key inside the payload — the program reads
`payload.values.coin` to check conservation. The framework passes
those bytes through; the protocol does the math.

## The URI

URIs name and route. A connection — `(client, patterns)` — is bound
into one of the rig's route arrays (`routes.receive`, `routes.read`,
`routes.observe`). For each tuple, the rig matches the URI against
the patterns on the relevant route to decide which clients
participate.

```ts
import { connection, Rig } from "@bandeira-tech/b3nd-sdk";

const local = connection(client, ["mutable://*", "hash://*"]);

const rig = new Rig({
  routes: {
    receive: [local],
    read: [local],
    observe: [local],
  },
});
```

Pattern syntax is Express-style: `:param` captures one segment, `*`
matches the rest, literals match exactly.

URIs also key programs. A program registered against
`mutable://accounts` runs on every tuple whose URI starts with that
prefix.

## What's coming next

Chapter 2 — what the Rig knows about a tuple's payload, and what it
leaves to protocols.
