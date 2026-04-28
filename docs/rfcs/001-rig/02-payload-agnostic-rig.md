# 2. The Rig doesn't read your mail

The Rig is a postal system. Letters go in, letters come out, the post
office routes them. The post office doesn't open the letter and doesn't
act on what's inside. That property — the post office *cannot* act on
what's inside, because it doesn't know how to read — is what makes the
system trustworthy across protocol boundaries. A protocol can use the
postal service without trusting the postmaster to interpret its messages.

## What the Rig knows

Three things.

**URIs**, because the Rig has to route. A connection declares it accepts
`receive` on `mutable://*` and the Rig dispatches matching tuples to that
connection. URIs are how the framework decides where a tuple goes. The Rig
matches on string prefixes; it doesn't care what URI scheme means in your
protocol.

**The 2-tuple shape**, because that's the wire primitive. The Rig knows
that each tuple has a URI and a `payload`. It pulls the URI for routing
and passes `payload` along without inspecting it.

**The pipeline**, because tuples don't go straight to clients. They flow
through `process` (classify) and `handle` (dispatch the result), with
direction-flavored entry points (`send`, `receive`) that wrap the
pipeline in hook and event surfaces. Chapter 3 covers the pipeline.

That's the framework's surface. URIs, the tuple shape, the pipeline.
Three items.

## What the Rig deliberately doesn't know

A longer list, written down so future contributors don't quietly add to
it.

**It doesn't know about envelopes.** The `{ inputs, outputs, auth }`
shape `MessageData` carries is one specific protocol convention. The
Rig has no concept of inputs or outputs as part of the wire format.
There is no envelope branch in the dispatch loop. There is no field the
Rig peeks at to decide whether to fan-out. Protocols that want envelope
semantics install the canonical `messageDataProgram` and
`messageDataHandler` (Ch 8).

**It doesn't know about content addressing.** The `hash://sha256/<hex>`
URI scheme is just a URI — connection patterns route it. The Rig does
not compute hashes, does not enforce that a payload at a hash URI
matches the URI's hash, and does not produce hash URIs from payloads.
Protocols that want content addressing run programs that verify the
hash, and the SDK ships helpers (`computeSha256`, `generateHashUri`).

**It doesn't know about authentication.** There is no `auth` field at
the framework level. A signature, when present, lives somewhere the
protocol chose — typically inside `payload` at a key the protocol
prescribes, or encoded in the URI itself. Programs registered for URI
prefixes that need auth check it. The Rig itself never verifies
anything (Ch 10).

**It doesn't know about conserved quantities.** Conservation lives
inside `payload`. The Rig has no slot reserved for quantities. The
framework was never going to enforce conservation; carving out a
position in the tuple would just signpost intent the framework can't
honor.

**It doesn't know about deletion.** When a tuple's `payload` is
`null`, that's a wire-level convention `DataStoreClient` and other
canon clients recognise (Ch 9). The Rig treats `[uri, null]` like any
other tuple — routes it, classifies it, hands it to a handler.
Whether `null` means "delete this" or "store a literal null value" is
downstream's choice.

**It doesn't know about identity.** `Identity` lives in the SDK; it
signs and bundles keys. It produces tuples and the application calls
the Rig with them. The Rig itself takes pre-prepared tuples and
dispatches. It has no signer, no key, no concept of "trusted caller."
Programs that want identity constraints read them from the tuple they
receive.

**It doesn't know about decomposition.** When one tuple semantically
expands into many — an envelope into outputs, a transaction into
balance updates and fee payments — the expansion is a protocol act,
performed by a handler the protocol installs. The Rig does not split
anything. It hands a tuple to a handler, and the handler returns the
tuples to broadcast next.

## Why this matters

Removing knowledge from the framework is what makes protocols
composable. Two protocols that both want envelope-shaped payloads but
disagree on fan-out semantics coexist on one Rig because each
installs its own handler keyed on its own program code. Neither
protocol contaminates the other.

Removing knowledge also makes the Rig honestly verifiable. A reader
of `rig.ts` can see, in one short file, what the framework does. The
framework's behavior is in the framework; protocol behavior is in
protocol packages.

## What's coming next

The pipeline. Three internal phases (`process`, `handle`, `react`) and
two direction-flavored wrappers (`send`, `receive`) that share the same
body. Direction is an observability flag, not a behavior fork.
