# Message Primitive & Rig Architecture

The b3nd message primitive, program model, and rig composition.

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
) => Promise<ProgramResult>;
```

Programs get three arguments:
1. **output** — the message being classified
2. **upstream** — the parent message, if this is a nested output
3. **read** — reads from storage (only confirmed state visible)

Programs are **pure classifiers** — no side effects, no rig callbacks.

### Scoped Sub-Program Routing

When a program needs to classify sub-outputs (matryoshka pattern), it calls
its own protocol's programs directly. The protocol ships as a closed package
that knows its own routing:

```typescript
// protocol/programs/msg.ts
import { balanceProgram } from "./balance.ts";
import { dataProgram } from "./data.ts";

const subPrograms: Record<string, Program> = {
  "store://balance": balanceProgram,
  "store://data":    dataProgram,
};

function routeSubOutput(output: Output): Program | undefined {
  const [uri] = output;
  for (const [prefix, program] of Object.entries(subPrograms)) {
    if (uri.startsWith(prefix)) return program;
  }
  return undefined;
}

const msgProgram: Program = async (output, _upstream, read) => {
  const [, , data] = output;
  for (const subOutput of data.outputs) {
    const sub = routeSubOutput(subOutput);
    if (!sub) return { code: "proto:invalid", error: "unknown output URI" };
    const result = await sub(subOutput, output, read);
    if (result.error) return result;
  }
  return { code: "proto:valid" };
};
```

The protocol doesn't need the rig to classify its own outputs — it already
knows what programs exist. The rig just maps URIs to top-level programs and
codes to handlers. Programs never cause side effects.

### Codes are Protocol-Defined

Programs return codes like `"proto:valid"`, `"proto:confirmed"`,
`"proto:invalid"`. The framework doesn't know what these mean. The protocol
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
  message:   Message,
  broadcast: ReceiveFn,   // direct to clients — bypasses programs
  read:      ReadFn,      // storage lookup (confirmed state)
) => Promise<void>;
```

### The Receive Loop

```
public receive(messages: Message[])
  for each message:
    1. Run the program for this URI → get a code
    2. If the code is a rejection → return error, don't forward
    3. Look up on[code] → run the handler (gets broadcast, not receive)
    4. Return { accepted: true, code }
```

Rejection is the only code that prevents forwarding. For every other code,
the handler runs and decides what to broadcast to clients.

The rig does NOT automatically forward the message to clients — the handler
decides. This is what gives operators full control. A `valid` handler wraps
the message for opaque storage. A `confirmed` handler broadcasts the original
message's outputs for decomposition.

### Code Handlers

The handler receives the message and a `broadcast` function — direct dispatch
to connected clients, bypassing programs. The handler is trusted internal
code. When it calls broadcast, it's saying "store this" — no re-validation.

```typescript
// Handler signature
type CodeHandler = (
  message:   Message,
  broadcast: ReceiveFn,   // direct to clients, no programs
  read:      ReadFn,      // storage lookup (confirmed state)
) => Promise<void>;
```

Handlers get three things:
- **message** — the classified message
- **broadcast** — direct dispatch to clients, bypassing programs (trusted)
- **read** — storage lookup for confirmed state (e.g. load original message on confirmation)

Note: `broadcast` is different from the `receive` that programs get.
Programs get the rig's full receive (for recursive sub-message classification).
Handlers get broadcast (for trusted storage dispatch).

---

## Protocol Packages

A protocol ships **programs** (the classification logic) and **default handlers**
(the operational meaning of each code). This IS the protocol spec in code.

```typescript
// protocol/mod.ts

// Programs — the classification logic
export const programs: Record<string, Program> = {
  "store://balance":      balanceProgram,
  "store://genesis":      genesisProgram,
  "store://data":         dataProgram,
  "consensus://record":   consensusProgram,
  "proto://msg":        protoMsgProgram,
};

// Default handlers — what each code means
// broadcast goes direct to clients (bypasses programs)
export const handlers: Record<string, CodeHandler> = {
  "proto:valid": async (msg, broadcast, _read) => {
    // Store the message opaquely — wrap it so the client stores
    // the whole message as data, without decomposing its outputs.
    const hash = await computeHash(msg);
    await broadcast([[
      `envelope://valid/${hash}`, {},
      {
        inputs: [],
        outputs: [[`hash://sha256/${hash}`, {}, msg]],
      },
    ]]);
    // Client decomposes the wrapper: stores msg at hash://sha256/{hash}
    // The inner outputs are NOT written to domain URIs — just data.
  },

  "proto:confirmed": async (msg, broadcast, read) => {
    // Store the confirmation record (wrapped, same pattern)
    const confirmHash = await computeHash(msg);
    await broadcast([[
      `envelope://confirm/${confirmHash}`, {},
      {
        inputs: [],
        outputs: [[`consensus://record/${confirmHash}`, {}, msg]],
      },
    ]]);

    // Load the original valid message and apply its outputs as state
    const ref = extractRef(msg);  // protocol-specific ref extraction
    const [result] = await read(`hash://sha256/${ref}`);
    const originalMsg = result.record.data;

    // Broadcast the original — NOW it gets decomposed:
    // clients delete its inputs, write its outputs to domain URIs
    await broadcast([originalMsg]);
  },

  "proto:invalid": async () => {
    // Rejection — handler not called (rig returns error)
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
  programs: protocol.programs,
  on: protocol.handlers,
});

// ── Light node: only store confirmed state ──
const lightNode = new Rig({
  connections: [
    connection(sqliteClient, { receive: ["consensus://*"], read: ["*"] }),
  ],
  programs: protocol.programs,
  on: {
    ...protocol.handlers,
    "proto:valid": async () => {
      // Don't store unconfirmed messages at all
    },
    "proto:confirmed": async (msg, broadcast, _read) => {
      // Only store the consensus record, skip state application
      const hash = await computeHash(msg);
      await broadcast([[
        `envelope://confirm/${hash}`, {},
        { inputs: [], outputs: [[`consensus://record/${hash}`, {}, msg]] },
      ]]);
    },
  },
});

// ── Indexer: store everything, ignore consensus ──
const indexer = new Rig({
  connections: [
    connection(elasticClient, { receive: ["store://*"], read: ["store://*"] }),
  ],
  programs: protocol.programs,
  on: {
    ...protocol.handlers,
    "proto:confirmed": async () => {
      // Don't care about consensus — just indexing content
    },
  },
});

// ── Mirror: replicate to peer on valid ──
const mirror = new Rig({
  connections: [
    connection(localClient, { receive: ["*"], read: ["*"] }),
  ],
  programs: protocol.programs,
  on: {
    ...protocol.handlers,
    "proto:valid": async (msg, broadcast, _read) => {
      // Store locally (wrapped) AND replicate to peer
      const hash = await computeHash(msg);
      await broadcast([[
        `envelope://valid/${hash}`, {},
        { inputs: [], outputs: [[`hash://sha256/${hash}`, {}, msg]] },
      ]]);
      await peerRig.receive([msg]);  // peer runs its own programs
    },
  },
});
```

Same programs, same codes — completely different operational behavior.

---

## State and Storage

### Wrapping Controls Decomposition

The client always decomposes one level: delete inputs, write outputs. The
handler controls what reaches the client.

To **store a message opaquely** (no state change): wrap it. The message
becomes data inside a wrapper output. The client stores it at its hash URI
without decomposing its inner outputs.

To **apply state** (write outputs, delete inputs): broadcast the message
unwrapped. The client decomposes it — outputs become readable state, inputs
are deleted.

One sentence: **receive always decomposes one level; to store without
decomposing, make the message an output of another message.**

### Valid vs Confirmed

```
Message arrives: [hash://sha256/abc, {}, {
  inputs: [...],
  outputs: [
    ["store://balance/alice/utxo-1", { fire: 100 }, null],
    ...
  ]
}]

Program returns: "proto:valid"
Handler wraps and broadcasts:
  → client stores the whole message as data at hash://sha256/abc
  → inner outputs NOT decomposed — just data

read("hash://sha256/abc")           → found (the message blob)
read("store://balance/alice/utxo-1") → not found (not confirmed)

---

Confirmation arrives, program returns: "proto:confirmed"
Handler broadcasts the original message UNWRAPPED:
  → client decomposes: deletes inputs, writes outputs to domain URIs

read("store://balance/alice/utxo-1") → found (confirmed state)
```

### Why This Matters for Validation

When programs call `read()` during classification, they only see confirmed
state. Valid-but-unconfirmed messages are stored opaquely at hash URIs — their
outputs haven't been written to domain URIs. This means:

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

### Consumption

Consumption happens when the handler broadcasts a message with inputs. The
client deletes those inputs. This only happens on confirmation — the
`proto:valid` handler wraps messages (no inputs reach the client), while
the `proto:confirmed` handler broadcasts the original unwrapped (inputs
get deleted, outputs get written).

The handler shapes what reaches the client. The client executes mechanically.

---

## Example: UGC Through a Protocol

Walkthrough of a user-generated content post flowing through the system.

### 1. User Creates Content

```typescript
// UGC output
const ugc = [
  "store://accounts/loremipsum/posts/hello",
  {},
  { title: "Hello World", body: "My first post" },
];

// Wrapped in a protocol message
const message = [
  "proto://msg", {},
  {
    inputs: [],
    outputs: [ugc],
    auth: [{ pubkey: userPubkey, signature: sig }],
  },
];

await rig.receive([message]);
```

### 2. Rig Processes

The rig finds the `proto://msg` program, which:
- Validates the message format
- Verifies the auth signature
- Runs its own sub-programs on each output (scoped protocol routing)
- Checks conservation (zero values in, zero values out — OK)
- Returns `"proto:valid"`

The `valid` handler wraps the message and broadcasts it. Client stores the
whole message as data at `hash://sha256/{hash}`. The UGC output is NOT at
`store://accounts/loremipsum/posts/hello` — not decomposed, not confirmed.

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
`"proto:confirmed"`.

The `confirmed` handler loads the original message from `hash://sha256/abc`
and broadcasts it unwrapped. The client decomposes it — the UGC output is
written to `store://accounts/loremipsum/posts/hello`. Inputs (if any) are
deleted. State is applied.

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
│  Protocol Layer                                  │
│  - Programs: classification logic                │
│  - Codes: proto:valid, proto:confirmed, ...      │
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
sugar. An operator can use `protocol.fullNode(pgClient)` or
`protocol.lightNode(sqliteClient)` without writing handler code. But the
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
      "proto:valid": async () => {},
    },
  });
}
```

