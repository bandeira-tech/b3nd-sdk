# 2. The Rig doesn't read your mail

The skill docs already promise this. The code didn't deliver it.

The Rig is, in our framing, a postal system. Letters go in, letters come out,
the post office routes them. The post office doesn't open the letter and
doesn't act on what's inside. That property — the post office *cannot* act on
what's inside, because it doesn't know how to read — is what makes the system
trustworthy across protocol boundaries. A protocol can use the postal service
without trusting the postmaster to interpret its messages.

In the proposed Rig, this is true.

## What the Rig knows

Three things.

**URIs**, because the Rig has to route. A connection declares it accepts
`receive` on `mutable://*` and the Rig dispatches matching tuples to that
connection. URIs are how the framework decides where a tuple goes. The Rig
matches on string prefixes; it doesn't care what URI scheme means in your
protocol.

**The 2-tuple shape**, because that's the wire primitive. The Rig knows that
each tuple has a URI and a `payload`. It pulls the URI for routing and
passes `payload` along without inspecting it.

**The pipeline**, because tuples don't go straight to clients. They flow
through `process` (classify) and `handle` (dispatch the result), with
direction-flavored entry points (`send`, `receive`) that wrap the pipeline in
hook and event surfaces. We get to the pipeline in the next chapter.

That's the framework's surface. URIs, the tuple shape, the pipeline. Three
items.

## What the Rig deliberately doesn't know

A longer list, written down deliberately so future contributors don't quietly
add to it.

**It doesn't know about envelopes.** The `{ inputs, outputs, auth }` shape that
`MessageData` carries — the shape that today's `MessageDataClient` recognises
and decomposes — is one specific protocol convention. The Rig has no concept
of inputs or outputs as part of the wire format. There is no "envelope branch"
in the dispatch loop. There is no field the Rig peeks at to decide whether to
fan-out.

**It doesn't know about content addressing.** The `hash://sha256/<hex>` URI
scheme is fine — it's a URI like any other and connection patterns route it.
But the Rig does not compute hashes, does not enforce that a payload at a
hash URI matches the URI's hash, and does not produce hash URIs from
payloads. Protocols that want content addressing run programs that verify
the hash, and the SDK ships helpers (`computeSha256`, `generateHashUri`) for
the work.

**It doesn't know about authentication.** There is no `auth` field at the
framework level. A signature, when present, lives somewhere the protocol
chose — typically inside `payload` at a key the protocol prescribes, or
encoded in the URI itself. Programs registered for URI prefixes that need
auth check it. The Rig itself never verifies anything.

**It doesn't know about conserved quantities.** A protocol that needs UTXO
balances or gas amounts encodes them inside `payload`. The Rig has no slot
reserved for them. The framework was never going to enforce conservation
anyway; carving out a position in the tuple just signposted intent the
framework couldn't honor.

**It doesn't know about deletion.** When a tuple's `payload` is `null`,
that's a wire-level convention the SDK's storage adapters recognise (more on
this in Chapter 9). The Rig treats `[uri, null]` like any other tuple —
routes it, classifies it, hands it to a handler. Whether `null` means
"delete this" or "store a literal null value" is downstream's choice.

**It doesn't know about identity.** `Identity` and `AuthenticatedRig` exist
in the SDK; they sign and encrypt; they produce tuples and call the Rig. But
the Rig itself takes pre-prepared tuples and dispatches. It has no signer,
no key, no concept of "trusted caller". A program that wants identity
constraints reads them from the tuple it receives.

**It doesn't know about decomposition.** When one tuple semantically expands
into many — an envelope into outputs, a transaction into balance updates and
fee payments — the expansion is a protocol act, performed by a handler the
protocol installs. The Rig does not split anything. It hands a tuple to a
handler, and the handler decides what tuples to broadcast next.

## Why this matters

Removing knowledge from the framework is what makes protocols composable.
Today, two protocols that both want envelope-shaped payloads but disagree on
fan-out semantics can't coexist on one Rig — `MessageDataClient` does the
decomposition one specific way and the second protocol has to fight it. In
the proposal, both protocols install their own handlers, the framework runs
each protocol's handler when its programs classify a tuple, and neither
protocol contaminates the other.

Removing knowledge also makes the Rig honestly verifiable. A reader of
`rig.ts` can see, in one short file, what the framework does. Today the
framework's behavior is partly in `rig.ts` and partly hidden inside
`MessageDataClient.receive`, where the envelope decomposition runs as a side
effect of writing to a `Store`. After the proposal, the framework's behavior
is in the framework, and protocol behavior is in protocol packages.

## What changed in this chapter

- The Rig knows URIs, the 3-tuple shape, and the pipeline. That's it.
- Envelopes, content addressing, authentication, deletion, identity, and
  decomposition all become protocol or SDK concerns, not framework concerns.
- This is a removal of knowledge from the framework, not an addition. The
  surface gets smaller.

## What's coming next

The pipeline. Three internal phases (`process`, `handle`, `react`) and two
direction-flavored wrappers (`send`, `receive`) that share the same body.
Direction is an observability flag, not a behavior fork.
