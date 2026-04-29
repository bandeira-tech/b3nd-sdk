# 2. The Rig doesn't read your mail

The Rig is a postal system. Letters go in, letters come out, the post
office routes them. The post office routes by address; the contents
of the letter are the recipient's business.

That mental model is the whole chapter. A protocol can run on the
Rig without trusting the framework to interpret its payloads —
because the framework doesn't.

## What the Rig works with

The framework reads three things:

**URIs** — for routing. Each connection in a route declares URI
patterns; the rig matches a tuple's URI against those patterns to
pick which clients receive it.

**The 2-tuple shape** — `[uri, payload]`. The rig pulls the URI to
route and forwards the payload as-is.

**The pipeline** — `process` classifies, `handle` interprets,
`react` observes. The direction-flavored entry points (`send`,
`receive`) run the same pipeline body and differ only in which
hooks fire and which events emit. Chapter 3 covers it.

## What lives in protocols

Everything else. The framework keeps a tight surface; protocols
own their own conventions through programs, handlers, and clients
they install.

| Convention | Where it lives |
|---|---|
| Envelopes (`MessageData`) | `messageDataProgram` + `messageDataHandler` — installed by the protocol (Ch 8) |
| Content addressing (`hash://`) | Programs verifying hash; SDK helpers (`computeSha256`, `generateHashUri`) |
| Authentication | Programs reading auth from the tuple at a protocol-defined key (Ch 10) |
| Conserved quantities (UTXO, gas) | A key inside the payload; protocol's program reads it |
| Deletion (`[uri, null]`) | `DataStoreClient` translates to `store.delete()` (Ch 9) |
| Identity / signing | `Identity` in the SDK produces signed tuples; protocols verify them in programs |
| Decomposition (one envelope → many tuples) | A handler the protocol installs |

This is what gives protocols composability. Two protocols that both
use envelope-shaped payloads but disagree on fan-out semantics live
on one rig because each installs its own program/handler pair keyed
on its own code. Neither leaks into the other's URI namespace.

## What's coming next

The pipeline. Three phases (`process`, `handle`, `react`) and two
direction-flavored wrappers (`send`, `receive`) that share the same
body.
