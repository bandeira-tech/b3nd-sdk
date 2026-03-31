# Transport & Web Standards

A B3nd handler doesn't care how messages arrive. It composes with
`receive()`, `read()`, `list()`, `delete()` — the `NodeProtocolInterface`.
The transport is what moves bytes between clients, nodes, and handlers.

This document explores how web standard technologies map to the
handler/connect architecture and where each fits.

---

## Current: HTTP Polling

Today, `connect()` uses HTTP polling. The handler's loop is:

```
┌────────────┐                         ┌──────────┐
│  Handler   │                         │   Node   │
│            │   GET /api/v1/list/...  │  (HTTP)  │
│  every 5s: │────────────────────────>│          │
│            │<──[uri1, uri2, ...]─────│          │
│            │                         │          │
│  for each: │   GET /api/v1/read/...  │          │
│            │────────────────────────>│          │
│            │<──{ data }──────────────│          │
│            │                         │          │
│  process   │   POST /api/v1/receive  │          │
│            │────────────────────────>│          │
│            │                         │          │
│  cleanup   │   DELETE /api/v1/...    │          │
│            │────────────────────────>│          │
└────────────┘                         └──────────┘
```

**How `HttpClient` maps it:**

| B3nd Operation   | HTTP Method | Endpoint                        |
| ---------------- | ----------- | ------------------------------- |
| `receive(msg)`   | POST        | `/api/v1/receive`               |
| `read(uri)`      | GET         | `/api/v1/read/{scheme}/{path}`  |
| `list(uri, opts)`| GET         | `/api/v1/list/{scheme}/{path}`  |
| `delete(uri)`    | DELETE      | `/api/v1/delete/{scheme}/{path}`|
| `status()`       | GET         | `/api/v1/status`                |

**Strengths:**
- Works everywhere — browsers, servers, CLI, edge functions
- Stateless — no persistent connections to manage
- Resilient — each request is independent, retry is trivial
- Cacheable — CDN-friendly for reads
- Debuggable — standard HTTP tools (curl, browser devtools)

**Weaknesses:**
- High latency — poll interval is the floor (default 5 seconds)
- Wasted bandwidth — empty polls when inbox is quiet
- Not real-time — client must wait for next poll cycle

HTTP polling is the right default. It's simple, reliable, and good
enough for most handler use cases.

---

## WebSocket

B3nd already has `WebSocketClient` — a full `NodeProtocolInterface`
implementation over WebSocket.

```
┌────────────┐                         ┌──────────┐
│   Client   │     WebSocket           │   Node   │
│            │═════════════════════════>│  (WS)    │
│            │                         │          │
│  receive() │──{ op: "receive" }─────>│          │
│            │<──{ accepted: true }────│          │
│            │                         │          │
│  read()    │──{ op: "read" }────────>│          │
│            │<──{ record: {...} }─────│          │
│            │                         │          │
│  list()    │──{ op: "list" }────────>│          │
│            │<──{ data: [...] }───────│          │
└────────────┘                         └──────────┘
```

**What exists today:**

The `WebSocketClient` wraps the full protocol in JSON messages over a
single WebSocket connection:

```typescript
const ws = new WebSocketClient({
  url: "wss://node.example.com",
  reconnect: {
    enabled: true,
    maxAttempts: 10,
    interval: 1000,
    backoff: "exponential",
  },
  timeout: 30000,
});

// Same API as HttpClient
await ws.receive(["mutable://open/test", { hello: "world" }]);
const result = await ws.read("mutable://open/test");
```

**What this enables for handlers:**

A handler using `connect()` could use `WebSocketClient` instead of
`HttpClient` for lower-latency polling:

```typescript
// HTTP polling — 5s latency floor
const http = new HttpClient({ url: "https://node.example.com" });
connect(http, { prefix, processor, pollIntervalMs: 5000 });

// WS polling — sub-second latency possible
const ws = new WebSocketClient({ url: "wss://node.example.com" });
connect(ws, { prefix, processor, pollIntervalMs: 500 });
```

**Server-push subscription (future):**

The WebSocket connection is bidirectional. The node could push
notifications when new inbox items arrive, eliminating polling entirely:

```
┌────────────┐                         ┌──────────┐
│  Handler   │  subscribe(prefix)      │   Node   │
│            │════════════════════════>│          │
│            │                         │          │
│            │  ◁── new item: uri1     │          │
│            │  ◁── new item: uri2     │ pushes   │
│            │  ◁── new item: uri3     │ events   │
│            │                         │          │
│  for each: │  read(uri)              │          │
│            │────────────────────────>│          │
│            │<──{ data }──────────────│          │
└────────────┘                         └──────────┘
```

The handler still calls `read()` to get the actual data — the push
notification only signals that something new exists.

**Strengths:**
- Full bidirectional protocol — every `NodeProtocolInterface` operation
- Persistent connection — lower per-message overhead than HTTP
- Real-time capable — server can push notifications
- Built-in reconnection with exponential backoff

**Weaknesses:**
- Connection state to manage (reconnect, timeout, heartbeat)
- Not cache-friendly
- Load balancers need sticky sessions or WS-aware routing
- Higher complexity than HTTP

---

## Server-Sent Events (SSE)

SSE is a lightweight server→client push channel over HTTP. The server
sends a stream of events; the client receives them with `EventSource`.

```
┌────────────┐                         ┌──────────┐
│   Client   │  GET /events?prefix=... │   Node   │
│            │════════════════════════>│          │
│            │                         │          │
│            │  ◁── event: inbox-item  │          │
│            │      data: { uri }      │  emits   │
│            │                         │  when    │
│            │  ◁── event: inbox-item  │  receive │
│            │      data: { uri }      │  writes  │
│            │                         │  to      │
│            │                         │  prefix  │
│            │                         │          │
│  on event: │  GET /api/v1/read/...   │          │
│            │────────────────────────>│          │
│            │<──{ data }──────────────│          │
└────────────┘                         └──────────┘
```

**How it would work:**

1. Client opens an `EventSource` to a node's SSE endpoint, filtered by
   URI prefix
2. When the node receives a new message matching the prefix, it emits
   an event with the URI
3. Client calls `read()` via HTTP to fetch the actual data
4. The SSE channel is one-way (server→client) — writes still go through
   HTTP `receive()`

**Browser implementation sketch:**

```typescript
const events = new EventSource(
  `https://node.example.com/api/v1/events?prefix=${encodeURIComponent(prefix)}`
);

events.addEventListener("inbox-item", async (e) => {
  const { uri } = JSON.parse(e.data);
  const msg = await httpClient.read(uri);
  await processor([uri, msg.record?.data]);
});
```

**Strengths:**
- Simple — built into every browser, no libraries needed
- HTTP-native — works through proxies, CDNs, load balancers
- Auto-reconnect built into `EventSource` API
- Lightweight — one-way stream, low overhead

**Weaknesses:**
- Server→client only — writes still need HTTP
- Limited to text data (no binary)
- Max ~6 connections per domain in some browsers
- No request multiplexing

**Best fit:** Browser-based clients that need near-real-time inbox
notifications without the complexity of WebSocket.

---

## WebRTC

WebRTC provides peer-to-peer data channels — direct connections between
browsers without routing through a server.

```
┌─────────┐                              ┌─────────┐
│ Alice    │    ① signaling via node      │  Bob    │
│ (Client) │═══════════════════════════>│ (Client) │
│          │                              │         │
│          │    ② ICE candidates          │         │
│          │<═══════════════════════════>│         │
│          │                              │         │
│          │    ③ DataChannel             │         │
│          │<────encrypted data──────────>│         │
│          │     (peer-to-peer)           │         │
└─────────┘                              └─────────┘
         │                                    │
         │   ① signaling messages via         │
         └──── immutable://inbox/ ────────────┘
```

**How it maps to B3nd:**

1. **Signaling through Firecat URIs.** Alice writes her SDP offer to
   Bob's inbox. Bob reads it, generates an answer, writes it to Alice's
   inbox. ICE candidates flow the same way.

2. **DataChannel as encrypted pipe.** Once the peer connection is
   established, data flows directly between browsers — no node involved.
   The DataChannel is already encrypted (DTLS).

3. **B3nd as fallback.** If the peer connection fails (NAT, firewall),
   the clients fall back to routing through the node.

**Signaling flow through B3nd:**

```
Alice                          Node                          Bob
  │                              │                              │
  │  receive([inbox/bob/signal,  │                              │
  │           { offer: sdp }])   │                              │
  │─────────────────────────────>│                              │
  │                              │   list() → read() → process │
  │                              │─────────────────────────────>│
  │                              │                              │
  │                              │  receive([inbox/alice/signal,│
  │                              │           { answer: sdp }])  │
  │                              │<─────────────────────────────│
  │   list() → read() → process │                              │
  │<─────────────────────────────│                              │
  │                              │                              │
  │◄═══════ DataChannel (P2P) ═══════════════════════════════►│
```

**Strengths:**
- True peer-to-peer — no server in the data path
- Low latency — direct connection
- DTLS encryption — built into the protocol
- Works for streaming (audio, video, screen share)

**Weaknesses:**
- Signaling complexity — needs a rendezvous mechanism (B3nd provides this)
- NAT traversal is unreliable — STUN/TURN servers often needed
- No offline messaging — both peers must be online
- Not suitable for handler patterns (handlers are servers, not peers)

**Best fit:** Real-time client↔client communication — chat, collaboration,
file transfer — where the node is used for signaling but not for data
transit.

---

## WebTransport

WebTransport is an HTTP/3-based protocol for bidirectional streaming
between client and server. It offers multiple stream types over a single
connection.

```
┌────────────┐                         ┌──────────┐
│   Client   │    HTTP/3 (QUIC)        │   Node   │
│            │═════════════════════════>│          │
│            │                         │          │
│            │  bidirectional stream 1  │          │
│            │<═══════════════════════>│          │
│            │                         │          │
│            │  bidirectional stream 2  │          │
│            │<═══════════════════════>│          │
│            │                         │          │
│            │  unidirectional (push)   │          │
│            │◁═══════════════════════│          │
└────────────┘                         └──────────┘
```

**What it offers over WebSocket:**
- Multiple independent streams over one connection
- Unreliable datagram support (for real-time where ordering doesn't matter)
- Built on QUIC — faster connection setup, better mobile handoff
- Head-of-line blocking only affects individual streams, not the whole connection

**Potential B3nd use cases:**
- Stream 1: inbox notifications (push)
- Stream 2: bulk data reads (bidirectional)
- Stream 3: status updates (unidirectional)
- Datagrams: presence signals, typing indicators

**Current status:** Browser support is growing (Chrome, Edge) but not
universal. Server-side support in Deno is experimental. This is a future
option, not a current priority.

---

## Transport Matrix

| Transport    | Latency     | Complexity | Browser | Server  | Use Case                         |
| ------------ | ----------- | ---------- | ------- | ------- | -------------------------------- |
| HTTP polling | High (5s+)  | Low        | All     | All     | Handlers, CRUD apps, default     |
| WebSocket    | Low (ms)    | Medium     | All     | Most    | Real-time apps, fast handlers    |
| SSE          | Low (ms)    | Low        | All     | Most    | Notifications, inbox monitoring  |
| WebRTC       | Lowest (ms) | High       | Most    | N/A     | P2P chat, file transfer          |
| WebTransport | Low (ms)    | High       | Some    | Few     | Future high-throughput scenarios  |

### Decision Guide

```
Is this a handler/listener?
├── Yes → HTTP polling (default)
│         └── Need sub-second? → WebSocket polling
│
Is this a browser client?
├── Need real-time inbox? → SSE (simple) or WebSocket (full)
├── Need peer-to-peer? → WebRTC (signaling via B3nd)
├── Need offline + sync? → HTTP polling + local cache
│
Is this high-throughput?
├── Many concurrent streams? → WebTransport (future)
└── Single request/response? → HTTP
```

---

## The `subscribe()` Primitive

Today, `connect()` is the only way to bridge a handler to an inbox. It
polls. A future `subscribe()` primitive would provide push-based
delivery with the same handler interface.

### Design Sketch

```typescript
// Poll transport (today)
const connection = connect(client, {
  prefix: "immutable://inbox/handler/",
  processor,
  pollIntervalMs: 5000,
});
connection.start();

// Push transport (future)
const subscription = subscribe(client, {
  prefix: "immutable://inbox/handler/",
  processor,
  transport: "ws",  // or "sse"
});
subscription.start();
```

**Key insight:** The processor is identical. The handler function doesn't
change. Only the delivery mechanism changes.

### How It Would Work

```
subscribe() with WebSocket:

┌────────────┐                         ┌──────────┐
│  Handler   │  open WS + subscribe    │   Node   │
│            │════════════════════════>│          │
│            │                         │          │
│            │  ◁── { uri, data }      │  on new  │
│            │                         │  receive │
│  processor │  ◁── { uri, data }      │  push to │
│  (msg)     │                         │  subs    │
│            │  ◁── { uri, data }      │          │
│            │                         │          │
└────────────┘                         └──────────┘

subscribe() with SSE:

┌────────────┐                         ┌──────────┐
│  Handler   │  GET /events?sub=...    │   Node   │
│            │════════════════════════>│          │
│            │                         │          │
│            │  ◁── event: message     │  on new  │
│            │      data: { uri }      │  receive │
│            │                         │  emit    │
│  read(uri) │────────────────────────>│  event   │
│  processor │<──{ data }──────────────│          │
│  (msg)     │                         │          │
└────────────┘                         └──────────┘
```

The WebSocket variant pushes full messages. The SSE variant pushes URIs
and the handler reads the data separately. Both patterns deliver to the
same processor function.

### Subscribe vs Connect

| Aspect        | `connect()` (poll)        | `subscribe()` (push)       |
| ------------- | ------------------------- | -------------------------- |
| Transport     | HTTP or WS request loop   | WS stream or SSE stream    |
| Latency       | Poll interval (seconds)   | Near-instant (milliseconds)|
| Resilience    | Stateless, auto-recovers  | Needs reconnect logic      |
| Resource use  | Spikes on each poll       | Constant connection        |
| Complexity    | Low                       | Medium                     |
| Handler API   | Same processor function   | Same processor function    |

### Migration Path

An app can switch from polling to push without changing its handler:

```typescript
// Before
const conn = connect(client, { prefix, processor });

// After
const sub = subscribe(client, { prefix, processor, transport: "ws" });
```

The handler, the trust model, the crypto boundary — all unchanged. Only
the transport layer moves.

---

## All Roads Lead to `NodeProtocolInterface`

Every transport in this document — HTTP, WebSocket, SSE, WebRTC,
WebTransport — ultimately speaks `receive()`, `read()`, `list()`. The
handler composes with these operations. It doesn't know or care which
transport delivered the message.

```
                          NodeProtocolInterface
                          ┌──────────────────┐
                          │  receive()       │
                          │  read()          │
                          │  list()          │
                          │  delete()        │
                          │  status()        │
                          └────────┬─────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
     ┌────────▼───────┐  ┌────────▼───────┐  ┌────────▼───────┐
     │   HttpClient   │  │ WebSocketClient│  │  MemoryClient  │
     │                │  │                │  │                │
     │  HTTP/REST     │  │  WS frames     │  │  In-process    │
     │  fetch()       │  │  reconnect     │  │  Map storage   │
     └────────────────┘  └────────────────┘  └────────────────┘
              │                    │                    │
              │                    │                    │
     ┌────────▼────────────────────▼────────────────────▼──────┐
     │                                                          │
     │              connect() / subscribe()                      │
     │                      │                                    │
     │              ┌───────▼────────┐                           │
     │              │   processor    │                           │
     │              │   (handler)    │                           │
     │              └────────────────┘                           │
     │                                                          │
     │  The handler is the same regardless of transport.         │
     │  Only the client implementation changes.                  │
     │                                                          │
     └──────────────────────────────────────────────────────────┘
```

This is the core architectural insight: the protocol interface is the
abstraction boundary. Transport is an implementation detail. You can:

- **Develop** with `MemoryClient` (zero network, instant)
- **Test** with `HttpClient` against a local node
- **Deploy** with `WebSocketClient` for low latency
- **Future-proof** with `subscribe()` when it ships

The handler code stays the same through all of these.

```typescript
// This function works with ANY transport
function createMyService(client: NodeProtocolInterface, identity: Identity) {
  return connect(client, {
    prefix: `immutable://inbox/${identity.publicKeyHex}/`,
    processor: respondTo(myHandler, { identity, client }),
  });
}

// Development
createMyService(new MemoryClient(), devIdentity);

// Production — HTTP polling
createMyService(new HttpClient({ url: PROD_URL }), prodIdentity);

// Production — WebSocket
createMyService(new WebSocketClient({ url: PROD_WS_URL }), prodIdentity);
```

The transport is a deployment decision, not an architectural one.
