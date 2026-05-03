# 12. Multi-channel ad fan-out, end to end

A small ad agency publishes a campaign. Publishing means three
things at once:

1. Persist the canonical creative at a content-addressed URI (audit
   trail).
2. Update a mutable pointer at
   `mutable://agency/campaigns/{client}/current` so internal tools
   know what's live.
3. Push one "publish ticket" tuple to each ad channel — Meta Ads
   and Google Ads.

One `rig.send([envelope])` does all three. Connection routing
handles the fan-out.

## Setup

```ts
import {
  Rig, connection, FunctionalClient, DataStoreClient, MemoryStore,
  messageDataProgram, messageDataHandler,
} from "@bandeira-tech/b3nd-sdk";

const primary = new DataStoreClient(new MemoryStore());

const metaChannel = new FunctionalClient({
  receive: async (outs) => {
    for (const [, payload] of outs) await postToMetaAds(payload);
    return outs.map(() => ({ accepted: true }));
  },
});

const googleChannel = new FunctionalClient({
  receive: async (outs) => {
    for (const [, payload] of outs) await postToGoogleAds(payload);
    return outs.map(() => ({ accepted: true }));
  },
});

const primaryConn = connection(primary,       ["mutable://*", "hash://*"]);
const metaConn    = connection(metaChannel,   ["publish://meta/*"]);
const googleConn  = connection(googleChannel, ["publish://google/*"]);

const rig = new Rig({
  routes: {
    receive: [primaryConn, metaConn, googleConn],
    read:    [primaryConn],
  },
  programs: {
    "hash://sha256":               messageDataProgram,
    "mutable://agency/campaigns":  acceptObject, // schema check
    "publish://meta":              acceptObject,
    "publish://google":            acceptObject,
  },
  handlers: { "msgdata:valid": messageDataHandler },
});
```

Each channel client owns its URI prefix. Meta only accepts
`publish://meta/*`; Google only accepts `publish://google/*`. The
primary store handles `mutable://*` and `hash://*`. URI prefix is
the routing decision.

## The publishing call

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
await op;
await op.settled;
```

One call, four constituents, three URI namespaces.

## Pipeline trace

**process** — `messageDataProgram` runs on the envelope's
`hash://sha256/...` URI. Returns `{ code: "msgdata:valid" }`.

**handle** — `messageDataHandler` returns the envelope plus the
four declared outputs.

**broadcast** — each emission is matched against `routes.receive`:

| Emission URI | Matches | Lands at |
|---|---|---|
| `hash://sha256/{envelope}` | `primaryConn` (`hash://*`) | primary |
| `hash://sha256/{campaign}` | `primaryConn` (`hash://*`) | primary |
| `mutable://agency/campaigns/...` | `primaryConn` (`mutable://*`) | primary |
| `publish://meta/...` | `metaConn` (`publish://meta/*`) | meta only |
| `publish://google/...` | `googleConn` (`publish://google/*`) | google only |

Each tuple lands at exactly the right client. The handler doesn't
know about "channels"; the rig doesn't know about "campaigns". The
URI prefixes carry the routing.

**react** — a reaction maintains a roster of live campaigns:

```ts
const addToRoster: Reaction = async ([_uri, campaignHash]) => {
  if (campaignHash === null) return [];
  return [[`dashboard://roster/${Date.now()}`, { campaignHash }]];
};

rig.reaction("mutable://agency/campaigns/:client/current", addToRoster);
```

The `dashboard://...` URI flows back through `rig.send` (Ch 7); a
WebSocket-fan-out client routed for `dashboard://*` pushes the
roster entry to UI subscribers in real time.

## Per-channel observability

```ts
const op = rig.send([envelope]);

op.on("route:success", (e) => {
  metrics.publish_success.inc({ channel: e.connectionId });
});
op.on("route:error", (e) => {
  retryQueue.push({ uri: e.emission[0], channel: e.connectionId, error: e.error });
});

await op;
await op.settled;
```

`route:*` events fire per `(emission, connection)` pair. Even
though there's one direction-level `send:success` for the original
envelope, the operation handle exposes the granular outcome of each
channel write (Ch 13).

## Adding a channel

Adding TikTok is a config change:

```ts
const tiktokConn = connection(tiktokChannel, ["publish://tiktok/*"]);

const rig = new Rig({
  routes: {
    receive: [primaryConn, metaConn, googleConn, tiktokConn],
    read:    [primaryConn],
  },
  programs: { /* ... */ "publish://tiktok": acceptObject },
  handlers: { /* ... */ },
});

// And the publish call gets one more output:
outputs.push([
  `publish://tiktok/rosies-bakery/${Date.now() + 2}`,
  { ...ticketMeta, channel: "tiktok" },
]);
```

The handler is unchanged. The pipeline is unchanged. Each new ad
network is one connection plus one output entry.

## What's coming next

Part VI — operational chapters. Chapter 13 covers per-route
observability via `OperationHandle`. Chapter 14 covers multi-source
replicas via `flood(peers)`.
