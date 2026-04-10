# Design: Message Primitive & Rig Architecture

Target architecture for the b3nd message primitive, program model, and rig
composition. This document captures the design direction — not the current
implementation.

---

## The Message Primitive

The universal primitive is a 3-tuple:

```typescript
type Output = [uri: string, values: Record<string, number>, data: unknown];
type Message = Output;  // A message is an output
```

- **uri** — identity/address
- **values** — conserved quantities (`{}` for none, always present, never optional)
- **data** — always `{ inputs: string[], outputs: Output[] }`

There is no `[uri, data]` 2-tuple. There is no optional values field. Every
output in the system carries all three positions.

### Data is Always `{ inputs, outputs }`

The `MessageData` convention becomes enshrined — all message data follows this
shape:

```typescript
// data is always:
{
  inputs: string[];     // URIs this message references
  outputs: Output[];    // [uri, values, data] tuples this message produces
}
```

There are no plain writes. Every state change is a message with inputs and
outputs. A simple write has `inputs: []` and one output. A transfer has
inputs (what's consumed) and outputs (what's created). The framework doesn't
interpret inputs — programs and operators do.

### Values and Conservation

Values are `Record<string, number>` — multi-asset by default. A balance output
might carry `{ fire: 100 }`. A multi-asset output might carry
`{ fire: 50, usd: 200 }`. A pure data output carries `{}`.

Conservation (sum of input values >= sum of output values per key) is a
**program-level** concern, not a framework guarantee. The framework stores
values faithfully. Programs check conservation during classification.

---

## Programs

A **program** is a function that classifies a message. Programs replace
validators — instead of returning `{ valid, error }`, they return a
**code** that describes what the message is.

```typescript
type ProgramResult = {
  code: string;       // protocol-defined classification
  error?: string;     // human-readable reason (for rejections)
};

type Program = (
  output:   Output,                  // [uri, values, data] being classified
  upstream: Output | undefined,      // parent message context (if nested)
  read:     ReadFn,                  // storage lookup (confirmed state only)
  receive:  ReceiveFn,               // process sub-messages through the rig
) => Promise<ProgramResult>;
```

Programs get four arguments:
1. **output** — the message being classified
2. **upstream** — the parent message, if this is a nested output
3. **read** — reads from storage (only confirmed state visible)
4. **receive** — the rig's own receive, for processing sub-messages

The `receive` parameter is key. When a program needs to recursively process
a nested message (matryoshka pattern), it calls `receive`. The nested message
goes through the full rig pipeline — program lookup, classification, code
handling. The program doesn't need to know about clients or storage.

### Codes are Protocol-Defined

Programs return codes like `"firecat:valid"`, `"firecat:confirmed"`,
`"firecat:invalid"`. The framework doesn't know what these mean. The protocol
defines them. The operator decides what to do with each one.

This is different from the current `{ valid: boolean }` model. A binary
accept/reject is too coarse — protocols need to express states like
"valid but not yet confirmed", "confirmed and ready for state application",
"valid but requires additional attestation", etc.

---

## The Rig

The rig is defined by three things:

| Component | Who provides it | What it does |
|-----------|----------------|--------------|
| **connections** | Operator | Where data lives (which clients, which URIs) |
| **programs** | Protocol | What the rules are (classification logic) |
| **on** | Operator (with protocol defaults) | What each code means operationally |

```typescript
interface RigConfig {
  connections: Connection[];
  programs:    Record<string, Program>;
  on:          Record<string, CodeHandler>;
  hooks?:      HooksConfig;
  reactions?:  Record<string, ReactionHandler>;
}

type CodeHandler = (
  message: Message,
  receive: ReceiveFn,
) => Promise<void>;
```

### The Receive Loop

```
receive(messages: Message[])
  for each message:
    1. Run the program for this URI → get a code
    2. If the code is a rejection → return error, don't store
    3. Otherwise → store the message at its URI
    4. Look up on[code] → run the handler
    5. Return { accepted: true, code }
```

Rejection is the only code that prevents forwarding to clients. Every other
code forwards the message (clients mechanically delete inputs and write
outputs) AND runs the handler. The handler decides additional side
effects — state application, replication, further messages.

### Code Handlers

The handler receives the message and a `receive` function — the rig's own
receive, bound to its connections. The handler decides what messages to forward
to clients. It doesn't get `write`/`delete` primitives — everything is a
message.

```typescript
// Handler signature
type CodeHandler = (
  message: Message,
  receive: ReceiveFn,   // rig's receive, routes to connected clients
) => Promise<void>;
```

---

## Protocol Packages

A protocol ships **programs** (the classification logic) and **default handlers**
(the operational meaning of each code). This IS the protocol spec in code.

```typescript
// firecat/mod.ts

// Programs — the classification logic
export const programs: Record<string, Program> = {
  "store://balance":      balanceProgram,
  "store://genesis":      genesisProgram,
  "store://data":         dataProgram,
  "consensus://record":   consensusProgram,
  "firecat://msg":        firecatMsgProgram,
};

// Default handlers — what each code means
export const handlers: Record<string, CodeHandler> = {
  "firecat:valid": async (msg, receive) => {
    // Message stored by the rig. Handler can do additional work —
    // e.g., forward to specific clients, trigger indexing, etc.
    // By default: nothing extra. The message is in storage.
  },

  "firecat:confirmed": async (msg, receive) => {
    // State application: write the original message's outputs
    // to their domain URIs so they become readable state.
    const [, , data] = msg;
    // The confirmation message references the original
    // Load it, then forward its outputs as individual writes
    // so clients store them at their domain URIs.
    // (exact mechanism depends on protocol's confirmation shape)
  },

  "firecat:invalid": async () => {
    // Rejection — the rig doesn't store.
    // Nothing to do here.
  },
};
```

### Operator Usage

Operators use protocol defaults or override specific handlers:

```typescript
// ── Full node: protocol defaults ──
const fullNode = new Rig({
  connections: [
    connection(pgClient, { receive: ["*"], read: ["*"] }),
  ],
  programs: firecat.programs,
  on: firecat.handlers,
});

// ── Light node: only store confirmed state ──
const lightNode = new Rig({
  connections: [
    connection(sqliteClient, { receive: ["consensus://*"], read: ["*"] }),
  ],
  programs: firecat.programs,
  on: {
    ...firecat.handlers,
    "firecat:valid": async () => {
      // Don't even store unconfirmed messages
    },
    "firecat:confirmed": async (msg, receive) => {
      // Only store the consensus record itself
      await receive([msg]);
    },
  },
});

// ── Indexer: store everything, ignore consensus ──
const indexer = new Rig({
  connections: [
    connection(elasticClient, { receive: ["store://*"], read: ["store://*"] }),
  ],
  programs: firecat.programs,
  on: {
    ...firecat.handlers,
    "firecat:confirmed": async () => {
      // Don't care about consensus — just indexing content
    },
  },
});

// ── Mirror: replicate to peer ──
const mirror = new Rig({
  connections: [
    connection(localClient, { receive: ["*"], read: ["*"] }),
  ],
  programs: firecat.programs,
  on: {
    ...firecat.handlers,
    "firecat:valid": async (msg, receive) => {
      await receive([msg]);
      await peerRig.receive([msg]);  // replicate
    },
  },
});
```

Same programs, same codes — completely different operational behavior.

---

## State and Storage

### Always Store, Confirm Drives State

Messages are always stored (unless rejected). But storing a message doesn't
mean its payload affects readable state. There are two layers:

- **Message storage**: the message itself, at its URI (e.g., `hash://sha256/abc`)
- **State**: the outputs from confirmed messages, at their domain URIs

When a program returns `firecat:valid`, the message is stored but its outputs
are not written to their domain URIs. A read of `store://balance/alice/utxo-1`
won't find it — because it hasn't been confirmed yet.

When a confirmation message arrives and gets `firecat:confirmed`, the handler
applies the original message's outputs to state. Now
`store://balance/alice/utxo-1` is readable.

```
Message arrives: [hash://sha256/abc, {}, {
  inputs: [...],
  outputs: [
    ["store://balance/alice/utxo-1", { fire: 100 }, null],
    ...
  ]
}]

Program returns: "firecat:valid"
Rig stores: hash://sha256/abc → the message

read("hash://sha256/abc")           → found (message in storage)
read("store://balance/alice/utxo-1") → not found (not confirmed)

---

Confirmation arrives: [hash://sha256/def, {}, {
  inputs: [...],
  outputs: [["consensus://record/abc", {}, "hash://sha256/abc"]]
}]

Program returns: "firecat:confirmed"
Handler applies state: writes outputs from the original message

read("store://balance/alice/utxo-1") → found (confirmed state)
```

### Why This Matters for Validation

When programs call `read()` during classification, they only see confirmed
state. Unconfirmed messages exist in storage but their outputs haven't been
written to domain URIs. This means:

- Conservation checks are against confirmed state, not pending proposals
- Double-spend detection is against confirmed state
- A valid-but-unconfirmed message doesn't affect subsequent validations

This is the natural behavior — no special filtering needed. The URI namespace
does the work.

### Clients: Delete Inputs, Write Outputs

Clients are mechanical. When a client receives a message with
`{ inputs, outputs }`, it:

1. **Deletes** every URI in `inputs`
2. **Writes** every `[uri, values, data]` in `outputs`

That's all a client does. No validation, no conservation checks, no
classification. The rig coordinates what messages reach which clients.
The handler controls what's in those messages.

### Consumption via Handler Shaping

Consumption isn't a framework concept or a client protocol — it's a
consequence of what the handler puts in the message it forwards to clients.

```typescript
// Accept: strip inputs, client only writes outputs
"firecat:valid": async (msg, receive) => {
  const [uri, values, data] = msg;
  await receive([[uri, values, { inputs: [], outputs: data.outputs }]]);
},

// Confirm: forward as-is, client deletes inputs AND writes outputs
"firecat:confirmed": async (msg, receive) => {
  await receive([msg]);
},

// Or: confirm but don't consume (light node doesn't track state)
"firecat:confirmed": async (msg, receive) => {
  const [uri, values, data] = msg;
  await receive([[uri, values, { inputs: [], outputs: data.outputs }]]);
},
```

The handler shapes the message. The client executes it mechanically.

---

## Example: UGC Through Firecat

Walkthrough of a user-generated content post flowing through the system.

### 1. User Creates Content

```typescript
// UGC output
const ugc = [
  "store://accounts/loremipsum/posts/hello",
  {},
  { title: "Hello World", body: "My first post" },
];

// Wrapped in a firecat message
const message = [
  "firecat://msg", {},
  {
    inputs: [],
    outputs: [ugc],
    auth: [{ pubkey: userPubkey, signature: sig }],
  },
];

await rig.receive([message]);
```

### 2. Rig Processes

The rig finds the `firecat://msg` program, which:
- Validates the message format
- Verifies the auth signature
- Runs firecat sub-programs on each output (via `receive`)
- Checks conservation (zero values in, zero values out — OK)
- Returns `"firecat:valid"`

The message is stored. The UGC output is NOT yet at
`store://accounts/loremipsum/posts/hello` — not confirmed.

### 3. Confirmation

A consensus message arrives (from a validator/confirmer):

```typescript
const confirmation = [
  "consensus://record/abc", {},
  {
    inputs: [...],
    outputs: [
      ["consensus://confirmed/abc", {}, "hash://sha256/abc"],
    ],
  },
];
```

The `consensus://record` program verifies the proof and returns
`"firecat:confirmed"`.

The handler applies state: the UGC output is written to
`store://accounts/loremipsum/posts/hello`. It's now readable as confirmed
state. Subsequent validations see it.

### 4. Reading

```typescript
// Before confirmation:
await rig.read("store://accounts/loremipsum/posts/hello");
// → not found

// After confirmation:
await rig.read("store://accounts/loremipsum/posts/hello");
// → { values: {}, data: { title: "Hello World", body: "..." } }
```

---

## Layers Summary

```
┌─────────────────────────────────────────────────┐
│  Framework                                       │
│  - Message primitive: [uri, values, data]        │
│  - Rig loop: program → code → handler → clients  │
│  - Connection routing                            │
│  - Always-store semantics                        │
│  - read/receive/observe/status interface         │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────┐
│  Protocol (e.g., Firecat)                        │
│  - Programs: classification logic                │
│  - Codes: firecat:valid, firecat:confirmed, ...  │
│  - Default handlers: what each code means        │
│  - Ships as a package with programs + handlers   │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────┐
│  Operator                                        │
│  - Connections: which clients, which URIs        │
│  - Handler overrides: customize per deployment   │
│  - Node type: full, light, indexer, mirror       │
│  - Can ship pre-configured rigs as node packages │
└─────────────────────────────────────────────────┘
```

Protocols can publish their own rig constructors with defaults and config
sugar. An operator can use `firecat.fullNode(pgClient)` or
`firecat.lightNode(sqliteClient)` without writing handler code. But the
verbose rig config is always available for custom deployments.

```typescript
// Protocol convenience — sugar over the verbose config
export function fullNode(client: NodeProtocolInterface): Rig {
  return new Rig({
    connections: [connection(client, { receive: ["*"], read: ["*"] })],
    programs,
    on: handlers,
  });
}

export function lightNode(client: NodeProtocolInterface): Rig {
  return new Rig({
    connections: [connection(client, { receive: ["consensus://*"], read: ["*"] })],
    programs,
    on: {
      ...handlers,
      "firecat:valid": async () => {},
    },
  });
}
```

---

## Relationship to Current Architecture

| Current | Target |
|---------|--------|
| `Output = [uri, data]` | `Output = [uri, values, data]` |
| `Message = Output` | Same — `Message = Output` |
| `data` is any shape | `data` is always `{ inputs, outputs }` |
| `receive(msg: Message)` singular | `receive(msgs: Message[])` batch |
| `PersistenceRecord = { ts, data }` | `record = { values, data }` |
| `Validator → { valid, error }` | `Program → { code, error }` |
| Schema maps programs to validators | Programs map to classifiers |
| Rig has `schema` | Rig has `programs` + `on` |
| Binary accept/reject | Open-ended codes |
| Client processes MessageData | Client is mechanical storage |
| Conservation in firecat validators | Conservation in programs, values on primitive |
| `consumed://` marker URIs | Consumption via code handlers |
| `isMessageData()` branching | No branching — always `{ inputs, outputs }` |
