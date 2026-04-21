# shared-infra — a sample B3nd protocol

A worked example of building a private, multi-app DePIN network on top of
the B3nd framework. It demonstrates how a small schema plus a thin SDK lets
many unrelated app backends share one rig (and its replication fabric)
without stepping on each other.

Everything here is a *sample*. The pieces are:

```
apps/shared-infra-protocol/
├── schema/mod.ts            — the protocol (5 programs)
├── sdk/mod.ts               — app-facing SDK (AppClient, UserSession)
├── node/mod.ts              — shared-node daemon (loads the schema)
├── apps/
│   ├── list-manager/mod.ts  — per-user list CRUD + event log
│   ├── blog/mod.ts          — content-addressed posts + mutable pointers
│   └── chat/mod.ts          — rooms, append-only messages, presence
├── stress/                  — tests that exercise rig → store → replication
└── scripts/demo.ts          — drives all three apps against one in-proc rig
```

## The protocol

Five programs, organised so every app gets a sandbox under its own
`appId`:

| URI pattern                                   | Behavior |
| --------------------------------------------- | -------- |
| `hash://sha256/{hex}`                         | Immutable content, write-once, quota-enforced. |
| `mutable://registry/apps/{appId}`             | App registration record. Optionally gated by an operator allow-list. |
| `mutable://app/{appId}/config`                | Per-app public config. |
| `mutable://app/{appId}/index/{key}`           | Per-app shared mutable index (list of posts, rooms, etc). |
| `mutable://app/{appId}/shared/{path}`         | Per-app shared docs. |
| `mutable://app/{appId}/users/{pubkey}/{path}` | Pubkey-owned: writes must be signed by `{pubkey}`. |
| `link://app/{appId}/latest/{name}`            | Mutable pointer; value must be an existing (or sibling) `hash://` URI. |
| `log://app/{appId}/events/{path}`             | Append-only; each path is write-once. |

Validators are returned from `createSharedInfraSchema({…})`, so an
operator can set the max payload size, toggle registration enforcement,
and configure the operator allow-list without editing protocol source:

```ts
import { createSharedInfraSchema } from "./schema/mod.ts";

const schema = createSharedInfraSchema({
  operatorPubkeys: ["<hex pubkey>"],
  maxPayloadBytes: 256 * 1024,
  requireAppRegistration: true,
});
```

## Running the shared node

```bash
# single-backend memory node
PORT=9942 deno run -A apps/shared-infra-protocol/node/mod.ts

# multi-backend + peer replication
PORT=9942 \
BACKENDS=memory://,fs:///tmp/b3nd-shared \
PEERS=http://node-b:9942,http://node-c:9942 \
deno run -A apps/shared-infra-protocol/node/mod.ts
```

The node speaks the standard b3nd HTTP API (`/api/v1/status`,
`/api/v1/receive`, `/api/v1/read/{uri}`, `/api/v1/observe/{pattern}`), so
apps connect through the usual `HttpClient`.

Writes are broadcast across all `BACKENDS + PEERS`. Reads walk that list
in order, returning the first hit.

## Using the SDK in an app

```ts
import { AppClient, generateIdentity } from "./sdk/mod.ts";

const identity = await generateIdentity();
const app = new AppClient({
  appId: "my-app",
  nodeUrl: "http://localhost:9942",
});
await app.register({ name: "My App" });

// Public mutable doc
await app.putConfig({ theme: "dark" });

// Content-addressed + mutable pointer in one envelope
const { linkUri } = await app.publish("featured", {
  title: "Hello",
  body: "world",
});

// Append to the audit log
await app.appendLog(`events/${Date.now()}`, { type: "opened" });

// Signed user-scoped write
const me = app.withIdentity(identity);
await me.saveDoc("profile", { displayName: "alice" });
```

Then the three sample apps layer domain logic on top of that API:

- `apps/list-manager/mod.ts` — per-user lists with every mutation mirrored
  into the audit log, so you can rebuild user history from logs alone.
- `apps/blog/mod.ts` — content-addressed post bodies + mutable `latest`
  links + a shared index; `history(slug)` walks the hash chain to recover
  every previous version.
- `apps/chat/mod.ts` — shared rooms, monotonic log entries per message,
  content-addressed message bodies for dedup, signed presence.

## Stress tests

`stress/` exercises the path from the SDK's ring (write call) all the way
to the store and replication layer.

```bash
deno test -A apps/shared-infra-protocol/stress/

# or individually:
deno test -A apps/shared-infra-protocol/stress/protocol.test.ts
deno test -A apps/shared-infra-protocol/stress/apps.test.ts
deno test -A apps/shared-infra-protocol/stress/replication.test.ts
deno test -A apps/shared-infra-protocol/stress/throughput.test.ts
```

The suites:

- **protocol** — acceptance/rejection rules of the schema. Pins down the
  contract the SDK depends on (unregistered app, wrong signer, oversized
  payload, write-once semantics on `hash://` + `log://`, dangling link).
- **apps** — each sample app driven end-to-end through its SDK, plus a
  "three apps on one rig" test that proves they coexist.
- **replication** — points a rig at `N` MemoryStore backends via
  `parallelBroadcast`, runs concurrent writes from all three apps, and
  asserts every backend ends up with a byte-identical key set. Also
  covers `firstMatchSequence` read fallback when the primary backend misses.
- **throughput** — posts 500 chat messages in parallel against a
  2-backend rig and asserts zero rejections. A regression guard, not a
  benchmark (still reports msg/s).

## Demo

```bash
deno run -A apps/shared-infra-protocol/scripts/demo.ts
```

Spins up an in-process rig with two memory backends, runs every app
against it, and prints a summary plus a replication check showing both
backends hold identical state.
