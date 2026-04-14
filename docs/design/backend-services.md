# Backend Services on Firecat

> Handlers, composition, and the Firecat/B3nd boundary.

## Design Constraints

Firecat is a public message network. There are no specialized servers, no
proprietary APIs, no vendor lock-in. Every participant speaks the same protocol.
Backend services must work within these constraints:

1. **Public network** — All messages flow through Firecat nodes. Privacy comes
   from encryption, not network topology.
2. **No specialized servers** — A backend is just another Firecat participant.
   It reads and writes messages like any client.
3. **Minimal concepts** — The message primitive (`[uri, values, data]`) is the only
   building block. Auth, payments, moderation, indexing — all expressible as
   message exchange.
4. **Transparent behavior** — What a service does is observable by what it reads
   and writes.

## The Handler

The handler is the portable unit of backend logic. A function that takes a
request and returns a response:

```typescript
type Handler<TReq, TRes> = (request: TReq) => Promise<TRes>;
```

A handler doesn't know about transport, encryption, or deployment. It receives
structured data, does its work, returns a result.

**Example: Vault auth handler**

```typescript
const handler = createVaultHandler({
  nodeSecret: "vault-hmac-secret",
  verifiers: new Map([["google", googleVerifier]]),
});
// (request: { provider, token }) => Promise<{ secret, provider }>
```

**Example: Moderation handler**

```typescript
const handler = createModerationHandler({ rules });
// (request: { content, uri }) => Promise<{ flagged, reason }>
```

**Example: Indexing handler**

```typescript
const handler = createIndexHandler({ indexPrefix });
// (request: { uri, content }) => Promise<{ indexed: true }>
```

The same handler plugs into any deployment mode. The handler IS the service.
Everything else is wiring.

## Two Deployment Modes

Same handler, different wiring.

### Mode A: Embedded in a Custom Node

The handler runs inside a node's receive pipeline. Messages arrive via
`receive()`, get validated, then processed. The handler is a processor in the
compose chain:

```
Client ──receive([[uri, values, data]])──> Node
                                  ├── validate(schema)
                                  ├── persist(storageClient)
                                  ├── when(matchesPattern, respondTo(handler))
                                  └── { accepted: true }
```

In compose terms:

```typescript
const node = createValidatedClient({
  write: parallelBroadcast([
    storageClient,
    when(
      (msg) => msg[0].startsWith("mutable://auth/"),
      respondTo(vaultHandler, { identity }),
    ),
  ]),
  read: firstMatchSequence([storageClient]),
  validate: msgSchema(schema),
});
```

**Properties:**

- Synchronous — client gets response during receive
- Handler runs in the node process
- Composes with existing validators, processors, combinators
- The node persists data AND handles custom logic

### Mode B: Connected Remotely

The handler runs as a separate process. It connects to a Firecat node, watches
for messages matching a filter, and processes them:

```
Handler Process                    Firecat Node
  │                                    │
  ├── connect(filter) ────────────────>│
  │                                    │
  │<── matching messages ──────────────│
  ├── respondTo(handler)               │
  ├── write(response) ────────────────>│
  │                                    │
```

In compose terms:

```typescript
const connection = connect(firecatNode, {
  filter: (uri) => uri.startsWith(`mutable://data/vault/${pubkey}/inbox/`),
  handler: respondTo(vaultHandler, { identity }),
});

connection.start();
```

**Properties:**

- Asynchronous — request and response are separate messages
- Handler runs in its own process
- Connects to any Firecat node as a standard client
- Just another Firecat participant — observable, composable

### Same Handler, Different Transport

| Aspect              | Embedded (Node)      | Connected (Remote)          |
| ------------------- | -------------------- | --------------------------- |
| Message arrives via | `receive()` pipeline | `list()` + `read()` polling |
| Response delivery   | During receive       | Written to response URI     |
| Latency             | Synchronous (ms)     | Asynchronous (seconds)      |
| Deployment          | Inside the node      | Separate process            |
| Infrastructure      | Part of the node     | Just a Firecat client       |
| Offline tolerance   | None (node must run) | High (messages queue)       |
| Handler             | Same function        | Same function               |

**Rule of thumb:** Embed when the client needs immediate feedback (auth at write
time, real-time validation). Connect remotely when the operation is naturally
async (moderation, indexing, background processing).

## Firecat vs B3nd

The boundary matters. Getting it wrong means building things twice.

### Firecat defines

The network and its protocol:

- **The URI space**: `mutable://`, `hash://` — where data lives
- **The message shape**: `[uri, values, data]` — the universal primitive
- **The node protocol**: `receive()`, `read()`, `list()`, `delete()` — how
  participants interact
- **Locations**: What URIs exist and can be observed
- **Replication**: How nodes share data across the network

Firecat is the network. It doesn't know or care what your handler does.

### B3nd defines

The toolkit for building on the network:

- **Composition**: `when()`, `emit()`, `parallel()`, `pipeline()`, `seq()`,
  `any()`, `all()` — how logic composes
- **Validation**: `msgSchema()`, `uriPattern()`, `format()`, `requireFields()` —
  what messages are accepted
- **Client wiring**: `createValidatedClient()`, `parallelBroadcast()`,
  `firstMatchSequence()` — how backends combine
- **Handlers**: Business logic functions that process requests
- **Connection**: How handlers connect to nodes — filtering, watching, reacting

A "listener" is not a Firecat concept. Firecat provides the protocol (`list()`,
`read()`, `receive()`) that makes observation possible. B3nd provides the
composition that makes it useful: filtering, connecting, routing responses.

Similarly, a "custom node" is just a Firecat node with b3nd compose primitives
in its receive pipeline. The node is Firecat. The composition is b3nd.

### Why this matters

The current `b3nd-listener` library builds its own polling loop, its own inbox
parsing, its own encryption handling — a parallel world beside the compose
layer. But the compose layer already has the vocabulary:

- `when(condition, processor)` — filtering
- `emit(callback)` — side effects
- `parallel(...items)` — fanout (auto-adapts any `{ receive }` object)
- `pipeline(...processors)` — sequencing
- `createValidatedClient({ write, read, validate })` — the full node

A listener should be expressible as a composition of these primitives plus a
transport. Not a separate system.

## The Compose Layer

### What exists

The compose layer already has most of the vocabulary for backend services.

**Filtering** — conditionally process messages:

```typescript
when((msg) => msg[0].startsWith("mutable://auth/"), processor);
```

**Side effects** — react to messages:

```typescript
emit(async (msg) => {
  await notifyWebhook(msg);
});
```

**Fanout** — process with multiple backends:

```typescript
parallel(storageClient, replicaClient, customProcessor);
```

**Sequencing** — ordered processing, all must succeed:

```typescript
pipeline(decryptRequest, processAuth, encryptResponse);
```

**Validation** — composable checks before processing:

```typescript
seq(uriPattern(/^mutable:\/\//), requireFields(["token"]), msgSchema(schema));
```

Any `{ receive }` object (client, node, etc.) is automatically adapted as a
processor by `parallel()`. This means storage backends and custom handlers
compose naturally — no wrapping.

### What's missing

Two primitives complete the picture:

**1. `respondTo(handler, opts)` — Wrap a handler as a Processor**

Takes a business-logic handler and returns a `Processor` compatible with the
compose layer:

- Extracts request context from the message (decryption, envelope parsing)
- Calls the handler with the structured request
- Wraps the response (encryption, signing)
- Routes the response to the reply URI

```typescript
// In a custom node's receive pipeline:
parallel(
  storageClient,
  when(isAuthRequest, respondTo(vaultHandler, { identity })),
);

// In a remote connection:
connect(remoteNode, {
  filter: isAuthRequest,
  handler: respondTo(vaultHandler, { identity }),
});
```

The handler function stays pure. `respondTo` handles the envelope: decrypt →
call → encrypt → route. This is where encryption, signing, and reply-routing
live — not in the handler, not in the transport.

**2. `connect(remote, opts)` — Bridge a handler to a remote node**

Watches a remote Firecat node for messages matching a filter and processes them:

- Uses `list()` to discover new messages at a prefix
- Uses `read()` to fetch matching messages
- Passes them through the handler processor
- Tracks processed messages to avoid duplicates

```typescript
const connection = connect(remoteNode, {
  filter: (uri) => uri.includes("/inbox/"),
  handler: respondTo(vaultHandler, { identity }),
  pollIntervalMs: 2000,
});

const stop = connection.start();
```

`connect` is the b3nd transport abstraction. Polling is one strategy. Future
transports (WebSocket subscription, event streaming) plug into the same
interface.

## Connection Strategies

A handler needs messages. How they arrive is the connection strategy. The
handler doesn't care which one.

### Receive (Embedded)

Messages arrive via the node's `receive()` method. The handler is wired into the
receive pipeline using `when()` + `respondTo()`. No transport needed — messages
come to you.

```typescript
// Handler runs during receive — synchronous
when(matchesPattern, respondTo(handler, { identity }));
```

Best for: Auth at write time, real-time validation, anything requiring immediate
feedback.

### Poll (Remote)

Periodically `list()` + `read()` from a remote node. Filter for new messages,
process them, write responses.

```typescript
connect(remoteNode, { filter, handler, pollIntervalMs });
```

Best for: Services that don't need real-time response. Simple, resilient, works
with any Firecat node.

### Subscribe (Future)

WebSocket or event stream. The node pushes matching messages to the handler in
real-time.

```typescript
// Same handler, different transport
subscribe(remoteNode, { filter, handler });
```

Best for: Real-time services that can't tolerate polling latency but run
separately from the node.

### Replicate (Peer)

The handler runs on a node that peers with another node. Messages arrive via
replication. The handler processes them in the receive pipeline as they land.

```typescript
// Messages arrive via peer replication, handler runs on receive
parallel(storageClient, when(matchesPattern, respondTo(handler, { identity })));
```

Best for: Distributed services where the handler needs its own copy of the data.

All four strategies use the same handler and the same `respondTo` wrapper. The
handler is the invariant. The transport is the variable.

## Examples

### Vault: Same Handler, Two Modes

The vault handler verifies OAuth tokens and returns deterministic HMAC secrets:

```typescript
const vaultHandler = createVaultHandler({
  nodeSecret,
  verifiers: new Map([["google", googleVerifier]]),
});
```

**Deployed embedded in a custom node:**

```typescript
const node = createValidatedClient({
  write: parallelBroadcast([
    mongoClient,
    when(
      (msg) => msg[0].startsWith("mutable://auth/"),
      respondTo(vaultHandler, { identity }),
    ),
  ]),
  read: mongoClient,
  validate: msgSchema(schema),
});
```

**Deployed as remote connection:**

```typescript
const connection = connect(firecatNode, {
  filter: (uri) => uri.startsWith(`mutable://data/vault/${pubkey}/inbox/`),
  handler: respondTo(vaultHandler, { identity }),
});
connection.start();
```

Same handler. Same vault logic. Different transport.

### Moderation: Embedded vs Remote

```typescript
const moderateContent = async (request) => {
  const flagged = await evaluateContent(request.content);
  return { flagged, reason: flagged ? "policy violation" : null };
};
```

**Moderate at write time (embedded):**

```typescript
when(isUserContent, respondTo(moderateContent));
```

**Moderate after the fact (remote):**

```typescript
connect(publicNode, {
  filter: isUserContent,
  handler: respondTo(moderateContent),
});
```

### Indexing: Embedded

```typescript
const indexContent = async (request) => {
  await updateSearchIndex(request.uri, request.content);
  return { indexed: true };
};

// Runs during receive — index is always up-to-date
parallel(
  storageClient,
  when(isPostContent, respondTo(indexContent)),
);
```

## The Network Vision

Backend services on Firecat are not hidden behind corporate walls. They are
visible participants in a public network.

A handler is a function. A node is a composed pipeline. A listener is a handler
connected to a remote node with a filter. There are no new concepts — only
compositions of `[uri, values, data]`.

When everything is a message:

- **Transparent behavior** — A service's actions are visible as signed messages.
  Its criteria can be audited.
- **Encrypted identity** — Private data stays private through encryption, not
  access control on servers.
- **Community value** — An indexing service benefits everyone on the network,
  not just one app's users.
- **No vendor lock-in** — Switch providers by changing which handler processes
  your messages.

The message primitive makes this possible. When everything is a message,
"backend service" is just a description of a participant's behavior pattern — a
handler composed with a transport.

---

## Decision Log

| Decision                                                    | Status       | Rationale                                                                |
| ----------------------------------------------------------- | ------------ | ------------------------------------------------------------------------ |
| Handler as portable unit                                    | **accepted** | Same function works in both deployment modes; the handler IS the service |
| Two deployment modes (embedded, connected)                  | **accepted** | Covers sync and async without inventing new concepts                     |
| `respondTo()` compose primitive                             | **proposed** | Wraps handler as Processor; handles decrypt → call → encrypt → route     |
| `connect()` transport primitive                             | **proposed** | Bridges handler to remote node; polling is one strategy of many          |
| Listener is b3nd, not Firecat                               | **accepted** | Firecat provides protocol; b3nd provides composition and connection      |
| Connection strategies (receive, poll, subscribe, replicate) | **accepted** | Same handler, different transports; handler is the invariant             |
| Inbox/outbox is URI convention, not protocol                | **accepted** | Just a pattern in the URI space; not a library concern                   |
| Current b3nd-listener to be rebuilt on compose              | **proposed** | Replace parallel system with compose primitives + connect transport      |
| No WebSocket subscribe yet                                  | **deferred** | Future transport strategy; same handler interface                        |
| No payment protocol spec                                    | **deferred** | Payments are a handler use case; protocol details come later             |
