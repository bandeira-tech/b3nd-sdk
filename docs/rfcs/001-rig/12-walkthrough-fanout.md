# 12. Multi-channel ad fan-out, end to end

A small ad agency wants to publish a campaign for a client. Publishing
the campaign means three things happening at once:

1. Persisting the canonical creative at a content-addressed URI as the
   audit record.
2. Updating a mutable pointer at `mutable://agency/campaigns/{client}/current`
   so internal tools know what's live.
3. Pushing one "publish ticket" tuple to each ad channel the client has
   purchased — Meta Ads and Google Ads, in this prototype.

The Rig handles all three with one `send` call and zero protocol-specific
glue. The chapter walks the call through every chapter's idea — payload
shape, programs, handlers, broadcast, connection routing — without any
of them being aware of "campaigns" as a domain concept.

## Setup — the topology

Three connections, each with its own URI patterns:

```ts
const primary = new DataStoreClient(new MemoryStore());

const metaChannel = new FunctionalClient({
  receive: async (outs) => {
    for (const [uri, payload] of outs) {
      console.log("[meta] publish ticket", uri, payload);
      await postToMetaAds(payload);
    }
    return outs.map(() => ({ accepted: true }));
  },
});

const googleChannel = new FunctionalClient({
  receive: async (outs) => {
    for (const [uri, payload] of outs) {
      console.log("[google] publish ticket", uri, payload);
      await postToGoogleAds(payload);
    }
    return outs.map(() => ({ accepted: true }));
  },
});

const primaryConn = connection(primary,       ["mutable://*", "hash://*"]);
const metaConn    = connection(metaChannel,   ["publish://meta/*"]);
const googleConn  = connection(googleChannel, ["publish://google/*"]);

const rig = new Rig({
  programs: {
    "hash://sha256":               messageDataProgram,
    "mutable://agency/campaigns":  acceptObject,    // basic schema check
    "publish://meta":              acceptObject,
    "publish://google":            acceptObject,
  },
  handlers: {
    "msgdata:valid": messageDataHandler,
  },
  routes: {
    receive: [primaryConn, metaConn, googleConn],
    read:    [primaryConn],
  },
});
```

Three connections, three URI namespaces. The primary store handles
mutable state and audit envelopes. Meta and Google publishers each
accept their own URI prefix and *only* their own — they don't know about
each other, they don't know about the primary, they just receive tuples
and call out to their respective ad APIs.

## The publishing call

The agency's app constructs an envelope describing the publish:

```ts
import { Identity, message, computeSha256 } from "@bandeira-tech/b3nd-sdk";

const agencyIdentity = await Identity.fromSeed(agencySeed);

const campaignBody = {
  client:    "rosies-bakery",
  headline:  "Now at Rosie's: Crackling Gluten-Free Sourdough",
  imageUri:  "asset://bakery/hero-loaf.webp",
  body:      "Wood-fired, naturally leavened. Weekend tastings free.",
  cta:       "Pre-order for pickup",
};

const campaignHash = await computeSha256(campaignBody);
const campaignUri  = `hash://sha256/${campaignHash}`;

const ticketMeta = {
  campaignHash, channel: "meta",
  runDateUtc: "2026-05-01T07:00:00Z", dailyBudgetUsd: 25,
};
const ticketGoogle = { ...ticketMeta, channel: "google" };

const inputs: string[] = [];
const outputs: Output[] = [
  [campaignUri,                                          campaignBody],
  ["mutable://agency/campaigns/rosies-bakery/current",   campaignUri],
  [`publish://meta/rosies-bakery/${Date.now()}`,         ticketMeta],
  [`publish://google/rosies-bakery/${Date.now() + 1}`,   ticketGoogle],
];

const auth = [await agencyIdentity.sign({ inputs, outputs })];
const envelope = await message({ auth, inputs, outputs });

const op = rig.send([envelope]);
await op;             // pipeline ack
await op.settled;     // every channel reported
```

One call, four constituent outputs, three URI namespaces. The intent is
"do all four, atomically from the host's perspective."

## What the pipeline does

**Direction wrapper.** `rig.send([envelope])` enters the pipeline.
The envelope URI is `hash://sha256/{envelope-hash}`. It carries the
agency identity's signature in `payload.auth`.

**Process.** `messageDataProgram` runs against the envelope's URI.
Shape checks pass. Returns `{ code: "msgdata:valid" }`.

**Handle.** `messageDataHandler` runs. It returns the constituent
emissions — the envelope itself plus the four declared outputs (no
inputs to delete in this case):

```ts
[
  ["hash://sha256/{envelope-hash}",                       { inputs:[], outputs:[…], auth:[…] }],
  [campaignUri,                                           campaignBody],
  ["mutable://agency/campaigns/rosies-bakery/current",    campaignUri],
  [`publish://meta/rosies-bakery/${ts}`,                  ticketMeta],
  [`publish://google/rosies-bakery/${ts+1}`,              ticketGoogle],
]
```

The Rig takes that list and broadcasts each tuple through connection
routing.

**Broadcast — and this is the chapter's main point.** Each tuple is
matched against connection patterns:

- `hash://sha256/{envelope-hash}` matches the primary's
  `receive: ["hash://*"]`. Goes only to primary.
- `campaignUri` (also `hash://...`) — same, primary only.
- `mutable://agency/campaigns/...` matches primary's
  `receive: ["mutable://*"]`. Primary only.
- `publish://meta/...` matches metaChannel's `receive: ["publish://meta/*"]`.
  metaChannel only — primary refuses, googleChannel refuses.
- `publish://google/...` matches googleChannel's
  `receive: ["publish://google/*"]`. googleChannel only.

Each tuple lands at exactly the right connection. The primary store
gets three writes (envelope + canonical + pointer). Meta gets one
publish ticket. Google gets one publish ticket. The agency's identity
signed one envelope; the campaign reaches four destinations through the
URI-pattern routing engine alone.

The handler did not know about "channels". The framework did not know
about "campaigns". The connection patterns did all the routing,
declaratively, in the Rig configuration.

**React.** A reaction registered on
`mutable://agency/campaigns/:client/current` fires for the pointer
update. Suppose the dashboard tracks the agency's current campaign
roster and emits an entry for any newly-live campaign:

```ts
const addToRoster: Reaction = async (out, _read) => {
  const [, campaignHash] = out;
  if (campaignHash === null) return [];
  return [[`dashboard://roster/${Date.now()}`, { campaignHash }]];
};

rig.reaction("mutable://agency/campaigns/:client/current", addToRoster);
```

That returned `Output` flows through `rig.send` (chapter 7 — reactions
are productive observation). A connection registered for
`dashboard://*` belongs to the dashboard's WebSocket-fan-out client;
the new roster entry shows up in the agency's UI in real time. No
reactions registered on `publish://*` (those tickets are
write-and-forget into external ad systems), so nothing else chains.

**Events and per-route observability.** `send:success` fires once
for the agency's original send — the host application sees one
confirmed direction-level action, not four. Per-channel detail
(which channel accepted, which rejected, with what error) flows
through the operation handle's `route:success` / `route:error`
events (Ch 13). Any `afterSend` hook (e.g., for invoicing, telemetry)
sees the same single direction-level event with the envelope tuple.

## What the channels see

`metaChannel` received exactly one tuple, at exactly the URI it
declared interest in, with exactly the payload shape it expected
(`PublishTicket`). It made one outbound HTTP call to the Meta Ads API.
It returned `{ accepted: true }`. From its perspective, the rest of the
Rig topology might as well not exist — it just got a tuple and acted.

Same for `googleChannel`. The two channels are independent. Adding a
`tiktokChannel` is a one-line addition to the connections array and a
new entry in the `outputs` of any `send` that wants to publish to
TikTok. No code changes elsewhere.

## What this is meant to demonstrate

**Connection routing is the fan-out mechanism.** Fanning a single
envelope out to multiple channels needs no protocol-specific glue.
The connection-pattern routing already has fan-out built in: declare
which client accepts which URI prefix and the routing engine takes
care of the rest.

**The same pipeline serves storage and network use cases.** The
walkthrough in chapter 11 wrote tuples to a Store. This walkthrough
wrote some to a Store and some to outbound HTTP clients. The pipeline
is the same. The handler is the same. Only the connection wiring
differs.

**The framework is invisible to domain concepts.** The Rig has no idea
this is an ad agency, no idea what a "campaign" is, no idea what a
"publish ticket" looks like. Every concept is in the protocol's URI
naming, the protocol's payload shapes, and the operator's connection
configuration. The framework runs URIs through the pipeline. Done.

**Adding new channels is a configuration change, not a code change.**
A new ad network gets added with a new `connection(...)` entry and a
new entry in `outputs`. The handler stays the same. The programs stay
the same. The Rig stays the same. The host app stays the same.

## What didn't happen

The framework didn't:

- Have an opinion on "channels" as a concept.
- Know that some outputs go to storage and others to outbound HTTP.
- Run programs on the constituent outputs (broadcast skipped them, by
  design — the handler is the canonical interpreter).
- Fire `send:*` events for the constituent broadcasts (only the
  original send's direction-level event fired; per-emission detail is
  on the operation handle).

Every fan-out decision was made by the connection patterns, configured
once at Rig construction.

## What's coming next

Part VI — the operational chapters. Chapter 13 covers per-route
observability via `OperationHandle`: how callers see each
emission-and-connection outcome instead of one collapsed boolean.
Chapter 14 covers multi-source replicas via `flood(peers)`: how a
single connection can fan to many peers without changing the Rig.
