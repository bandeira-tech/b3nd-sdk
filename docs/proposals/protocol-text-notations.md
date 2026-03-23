# Proposal: Text Notations for B3nd Protocols

## Why Notations (Not Just a DSL)

The [URL validation DSL proposal](./url-validation-dsl.md) covers how to *define* schemas.
This document covers how to *talk about*, *draw*, and *reason about* b3nd protocols
using text — in documentation, in chat, in agent conversations, in design reviews.

Different audiences need different framings:

| Audience               | Needs to see                                  |
|------------------------|-----------------------------------------------|
| Protocol designer      | Data flow, state transitions, invariants       |
| Operator / DevOps      | Topology, replication, node wiring             |
| Auditor / Security     | Access control, who can write what where        |
| Developer              | API surface, message structure, composition     |
| AI Agent               | Compact, parseable, unambiguous representation  |

One notation can't serve all these. This proposal explores **5 notations**, each optimized
for a different framing.

---

## Notation 1: Message Trace (Optimized for: Data Flow)

Shows what happens to a single message as it moves through the system.
Reads top-to-bottom like a timeline. Great for debugging, explaining flows in chat.

### Syntax

```
msg = ["mutable://accounts/ab12/profile", { name: "Alice" }]

    msg
     |
     v
  validate
     |--- check: uri matches mutable://accounts/{pubkey}/**  ✓
     |--- check: signed-by ab12                               ✓
     |
     v
  receive
     |--- write → postgres     ✓  (12ms)
     |--- write → replica-1    ✓  (45ms)
     |--- write → replica-2    ✗  (timeout)
     |
     v
  result: accepted
```

### A state-transition message (inputs/outputs):

```
msg = [hash://sha256/cf83e..., {
  auth: [{ pubkey: "ab12", signature: "..." }],
  payload: {
    inputs:  [ "utxo://ab12/1", "utxo://ab12/2" ],
    outputs: [ ["utxo://cd34/99", 50],
               ["utxo://ab12/3", 30],
               ["fees://pool", 1] ]
  }
}]

    msg
     |
     v
  validate envelope
     |--- hash(payload) == cf83e...   ✓
     |--- signed-by ab12             ✓
     |
     v
  validate each output
     |
     |--- utxo://cd34/99 = 50
     |     '--- program: utxo://*
     |     '--- check: inputs exist and unspent   ✓
     |     '--- check: sum(inputs) >= sum(outputs) ✓
     |
     |--- utxo://ab12/3 = 30
     |     '--- program: utxo://*
     |     '--- check: change back to sender       ✓
     |
     |--- fees://pool = 1
     |     '--- program: fees://*
     |     '--- check: fee >= min_fee              ✓
     |
     v
  receive all outputs
     |--- write utxo://cd34/99   → store  ✓
     |--- write utxo://ab12/3   → store  ✓
     |--- write fees://pool     → store  ✓
     |--- mark utxo://ab12/1   → spent  ✓
     |--- mark utxo://ab12/2   → spent  ✓
     |
     v
  result: accepted
```

### Why this works

- Linear, top-down — matches how time flows
- Expandable — you can collapse or expand validation detail
- Copy-pasteable into chat, GitHub issues, agent transcripts
- The `✓` / `✗` markers make pass/fail instantly visible

---

## Notation 2: Wiring Diagram (Optimized for: Topology & Composition)

Shows how nodes, clients, validators, and backends are composed together.
Uses ASCII box-and-arrow art. Great for architecture docs and operator guides.

### Single-node wiring

```
                         ┌─────────────────────────────┐
   receive(msg) ───────► │       validated-client       │
                         │                              │
                         │  ┌────────────────────────┐  │
                         │  │  validate               │  │
                         │  │   seq(                   │  │
                         │  │     uriPattern(...)      │  │
                         │  │     msgSchema(schema)    │  │
                         │  │   )                      │  │
                         │  └──────────┬─────────────┘  │
                         │             │ valid?          │
                         │             ▼                 │
                         │  ┌────────────────────────┐  │
                         │  │  write: parallel(...)   │  │
                         │  │   ├── postgres-client   │  │
                         │  │   └── memory-cache      │  │
                         │  └────────────────────────┘  │
                         └─────────────────────────────┘

   read(uri) ──────────► firstMatch(
                            memory-cache,
                            postgres-client
                          )
```

### Multi-node network

```
  ┌──────────────┐     push      ┌──────────────┐
  │   node-A     │──────────────►│   node-B     │
  │  (primary)   │               │  (replica)   │
  │              │◄──────────────│              │
  │  pg-backend  │     pull      │  pg-backend  │
  └──────┬───────┘               └──────────────┘
         │
         │ push
         ▼
  ┌──────────────┐
  │   node-C     │
  │  (read-only) │
  │  mem-backend │
  └──────────────┘
```

### Peer replication detail

```
  peers:
    node-B (http://b:3000)  ── direction: push  ── bestEffort(httpClient)
    node-C (http://c:3000)  ── direction: push  ── bestEffort(httpClient)
    node-D (http://d:3000)  ── direction: pull  ── read fallback
```

---

## Notation 3: URI Map (Optimized for: Access Control & Audit)

A compact notation that shows what exists at each URI path, who can write there,
and what rules apply. Reads like a filesystem listing with annotations.

### Syntax

```
/
├── mutable://
│   ├── open/**                    [anyone]        write freely
│   ├── inbox/**                   [anyone]        write freely
│   └── accounts/
│       └── {pubkey}/**            [signer=pubkey] signature required
│
├── immutable://
│   ├── open/**                    [anyone]        write-once (must not exist)
│   └── accounts/
│       └── {pubkey}/**            [signer=pubkey] write-once + signature
│
├── hash://
│   └── sha256/
│       └── {digest}               [anyone]        write-once, content must hash to digest
│
└── link://
    ├── open/**                    [anyone]        value must be valid URI
    └── accounts/
        └── {pubkey}/**            [signer=pubkey] value must be valid URI
```

### Managed node configuration URIs

```
mutable://accounts/{operator}/
├── nodes/
│   ├── {nodeId}/config            [signer=operator]  encrypted node config
│   └── {nodeId}/update            [signer=operator]  update manifest
└── networks/
    └── {networkId}                [signer=operator]  network manifest

mutable://accounts/{nodeKey}/
├── status                         [signer=nodeKey]   encrypted heartbeat
└── metrics                        [signer=nodeKey]   encrypted metrics
```

### Why this works

- Familiar — looks like `tree` or `ls -R`
- Shows the *namespace* structure, not just flat rules
- `[brackets]` make access control immediately scannable
- Good for security reviews: "who can touch what?"

---

## Notation 4: Tuple Shorthand (Optimized for: Agent Communication & Compactness)

A minimal, parseable notation for describing messages, reads, and results
in contexts where space is limited — agent-to-agent chat, logs, compact docs.

### Core primitives

```
W  ["mutable://open/config", { theme: "dark" }]           -- write (receive)
R  "mutable://open/config"                                  -- read
D  "mutable://open/config"                                  -- delete
L  "mutable://open/*"                                       -- list
```

### Results

```
W  ["mutable://open/config", { theme: "dark" }]  => accepted
R  "mutable://open/config"                        => { theme: "dark" } @ts=1709913600
R  "mutable://open/missing"                       => not-found
W  ["mutable://accounts/ab12/x", {}]              => rejected: unsigned
```

### State message shorthand

```
W  [hash://cf83e..., {
     in:  [utxo://ab12/1, utxo://ab12/2]
     out: [utxo://cd34/99 = 50, utxo://ab12/3 = 30, fees://pool = 1]
     sig: ab12
   }]
   => accepted
```

### Composition shorthand

```
validate = seq(uri-match, msg-schema)
write    = parallel(pg, replica)
read     = first-match(cache, pg)
node     = validated-client(validate, write, read)
```

### Multi-step interaction

```
1. W  ["mutable://accounts/ab12/profile", { name: "Alice" }]  => accepted
2. R  "mutable://accounts/ab12/profile"                        => { name: "Alice" }
3. W  ["link://accounts/ab12/avatar", "hash://sha256/ff01..."] => accepted
4. R  "link://accounts/ab12/avatar"                            => "hash://sha256/ff01..."
5. R  "hash://sha256/ff01..."                                  => { type: "image/png", data: ... }
```

### Why this works

- Minimal syntax — `W`, `R`, `D`, `L` + `=>` is the entire vocabulary
- Every line is a self-contained operation + result
- Agents can parse it and reconstruct the interaction
- Good for logs, test cases, REPL-style documentation

---

## Notation 5: Data Lifecycle (Optimized for: Protocol Reasoning)

Focuses on the *lifecycle of a piece of data* — from creation through references
and eventual consumption. Shows how URIs relate to each other over time.
Best for protocol design discussions and reasoning about invariants.

### Mutable data lifecycle

```
mutable://accounts/ab12/profile

  create ─────► v1 { name: "Alice" }        signed by ab12
                 │
  update ─────► v2 { name: "Alice B." }     signed by ab12  (overwrites v1)
                 │
  update ─────► v3 { name: "Alice Brown" }  signed by ab12  (overwrites v2)
                 │
  delete ─────► ∅                            signed by ab12
```

### Immutable data lifecycle

```
immutable://open/doc-1

  create ─────► { title: "RFC" }     (write-once)
                 │
  update ─────► ✗ REJECTED           (already exists)
  delete ─────► ✗ REJECTED           (immutable)
```

### Content-addressed lifecycle

```
hash://sha256/cf83e...

  value ──────► sha256(value) must equal cf83e...
                 │
  create ─────► { ... }              (write-once, hash-verified)
                 │
  update ─────► ✗ REJECTED           (different content = different hash = different URI)
```

### Link lifecycle (pointers)

```
link://accounts/ab12/avatar ──────► "hash://sha256/ff01..."
                                         │
                                         └──► read(hash://sha256/ff01...)
                                              => { type: "image/png", ... }

link://accounts/ab12/avatar ──────► "hash://sha256/aa02..."   (re-pointed by ab12)
                                         │
                                         └──► read(hash://sha256/aa02...)
                                              => { type: "image/png", ... }  (new avatar)
```

### UTXO state transition (inputs → outputs)

```
         BEFORE                              AFTER
  ┌─────────────────┐                ┌─────────────────┐
  │ utxo://ab12/1   │ ──── input ───►│     (spent)      │
  │   value: 50     │                └─────────────────┘
  └─────────────────┘
  ┌─────────────────┐                ┌─────────────────┐
  │ utxo://ab12/2   │ ──── input ───►│     (spent)      │
  │   value: 31     │                └─────────────────┘
  └─────────────────┘
                                     ┌─────────────────┐
                          output ───►│ utxo://cd34/99   │
                                     │   value: 50      │
                                     └─────────────────┘
                                     ┌─────────────────┐
                          output ───►│ utxo://ab12/3    │
                                     │   value: 30      │
                                     └─────────────────┘
                                     ┌─────────────────┐
                          output ───►│ fees://pool      │
                                     │   value: 1       │
                                     └─────────────────┘

  invariant: sum(inputs) >= sum(outputs)
  invariant: all inputs signed by their owner
  invariant: all input URIs exist and unspent
```

### Why this works

- Shows *time* — how data evolves
- Shows *relationships* — how URIs reference each other
- Shows *invariants* — what must hold across transitions
- Great for whiteboard-style protocol reasoning in text form

---

## Summary: Which Notation, When

| Notation              | Best For                          | Audience           | Complexity |
|-----------------------|-----------------------------------|--------------------|------------|
| **Message Trace**     | "What happened to this message?"  | Debugging, chat    | Low        |
| **Wiring Diagram**    | "How are things connected?"       | Ops, architecture  | Medium     |
| **URI Map**           | "Who can write what where?"       | Security, audit    | Low        |
| **Tuple Shorthand**   | "Show me the operations"          | Agents, logs, REPL | Low        |
| **Data Lifecycle**    | "How does this data evolve?"      | Protocol design    | Medium     |

These are complementary, not competing. A protocol doc might use:
- **URI Map** to define the namespace
- **Data Lifecycle** to explain the state model
- **Wiring Diagram** to show the node topology
- **Message Trace** to walk through a specific interaction
- **Tuple Shorthand** in inline examples and agent prompts

---

## Potential Extensions

### Composability: Notations referencing each other

A wiring diagram could embed trace notation:

```
  ┌────────────────────────────────────────┐
  │  node-A                                │
  │                                        │
  │  W ["mutable://open/x", 1]            │
  │    |> validate: uri-match ✓            │
  │    |> write: pg ✓, replica ✓           │──push──► node-B
  │    => accepted                         │
  └────────────────────────────────────────┘
```

### Machine-parseable mode

Any notation could have a strict JSON equivalent for tooling:

```json
{
  "notation": "trace",
  "msg": ["mutable://accounts/ab12/profile", { "name": "Alice" }],
  "steps": [
    { "phase": "validate", "checks": [
      { "name": "uri-match", "pass": true },
      { "name": "signed-by", "args": "ab12", "pass": true }
    ]},
    { "phase": "write", "targets": [
      { "name": "postgres", "pass": true, "latency_ms": 12 },
      { "name": "replica", "pass": false, "error": "timeout" }
    ]},
    { "result": "accepted" }
  ]
}
```

---

## Open Questions

1. Should we formalize any of these into a parseable spec, or keep them as visual conventions?
2. Should the tuple shorthand become the "wire format" for agent communication about b3nd operations?
3. Could the URI Map notation be auto-generated from a schema definition (connecting to the DSL proposal)?
4. Should the message trace be a runtime output (like a `--trace` flag on nodes)?
