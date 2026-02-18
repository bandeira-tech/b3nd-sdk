# B3nd Monorepo — Agent Reference

## Agent Workflow

### Completion Protocol

**Every session that changes code MUST end with verification and a commit.** Do
not leave uncommitted work.

1. **Verify** — Type check entry points:
   ```bash
   deno check src/mod.ts libs/*/mod.ts
   ```
2. **Commit** — Stage and commit with a clear message.
3. **Push** — A git pre-push hook runs `deno check` on all entry points and
   blocks the push if type checking fails.

If verification fails, fix the issue and re-verify. Never commit failing code.
Never leave a session with uncommitted changes.

### Making SDK Changes

1. **Read first** — Never modify code you haven't read.
2. **Implement** — Keep changes focused and minimal.
3. **Update skills** — If you changed exports or client behavior, update the
   relevant skill in `skills/`.
4. **Verify and commit** — Follow the completion protocol above.

### Adding a New Client

1. Create `libs/b3nd-client-{name}/` with `mod.ts` and `deno.json`
2. Implement `NodeProtocolInterface` (see `libs/b3nd-client-memory/mod.ts`)
3. Add `isMessageData` unpacking in `receive()` (see memory/postgres/mongo)
4. Run shared test suites: `runSharedSuite` and `runNodeSuite` from
   `libs/b3nd-testing/`
5. Re-export from `src/mod.ts`
6. Add workspace member to root `deno.json`

### Adding a New Validator or Processor

1. Add to `libs/b3nd-compose/validators.ts` or `libs/b3nd-compose/processors.ts`
2. Re-export from `libs/b3nd-compose/mod.ts` and `src/mod.ts`
3. Add tests
4. Update `b3nd-sdk` skill

---

## Repository Structure

```
b3nd/
├── src/mod.ts                  # SDK entry point (JSR + NPM re-exports from libs/)
├── deno.json                   # Workspace config, tasks, JSR publish settings
├── package.json                # NPM: @bandeira-tech/b3nd-web
├── libs/                       # SDK packages (modular)
│   ├── b3nd-core/              # Foundation: types, encoding, binary
│   ├── b3nd-compose/           # Node composition: createNode, validators, processors
│   ├── b3nd-hash/              # Content-addressed storage utilities
│   ├── b3nd-msg/               # Message system (node + data convention)
│   ├── b3nd-servers/           # HTTP + WebSocket server primitives
│   ├── b3nd-client-memory/     # In-memory client
│   ├── b3nd-client-http/       # HTTP client
│   ├── b3nd-client-ws/         # WebSocket client
│   ├── b3nd-client-postgres/   # PostgreSQL client
│   ├── b3nd-client-mongo/      # MongoDB client
│   ├── b3nd-client-indexeddb/  # IndexedDB client (browser)
│   ├── b3nd-client-localstorage/ # LocalStorage client (browser)
│   ├── b3nd-combinators/       # Client composition: parallelBroadcast, firstMatchSequence
│   ├── b3nd-testing/           # Shared test suites (shared-suite, node-suite)
│   ├── b3nd-auth/              # Pubkey-based access control
│   ├── b3nd-encrypt/           # Client-side encryption (X25519/Ed25519/AES-GCM)
│   ├── b3nd-wallet/            # Wallet client (auth, proxy read/write)
│   ├── b3nd-wallet-server/     # Wallet server implementation
│   ├── b3nd-apps/              # Apps client
│   └── b3nd-managed-node/      # Managed node workflows (canonical mutable://accounts URIs)
├── apps/
│   ├── b3nd-node/              # Multi-backend HTTP node (Hono)
│   ├── apps-node/              # Application backend scaffold
│   ├── wallet-node/            # Wallet/auth server
│   ├── b3nd-web-rig/           # React/Vite data explorer + dashboard UI (port 5555)
│   ├── sdk-inspector/          # Test runner backend (port 5556, writes results to B3nd)
│   ├── b3nd-cli/               # bnd CLI tool (Deno, compiled binary)
│   └── b3nd-managed-node/      # Managed node entry point + Dockerfile
├── tests/                      # E2E tests
├── skills/                     # Claude Code plugin skills
└── .claude-plugin/             # Plugin manifest + MCP server
```

---

## Core Architecture

### Message Primitives

Everything in B3nd flows through `receive([uri, data])`:

```typescript
type Message<D = unknown> = [uri: string, data: D];

await client.receive(["mutable://users/alice", { name: "Alice" }]);
await client.read("mutable://users/alice");
await client.list("mutable://users/");
await client.delete("mutable://users/alice");
```

### MessageData Envelopes

Multiple writes batch into a single message. Each client detects `MessageData`
and stores outputs individually:

```typescript
import { send } from "@bandeira-tech/b3nd-sdk";

await send({
  outputs: [
    ["mutable://open/users/alice", { name: "Alice" }],
    ["mutable://open/users/bob", { name: "Bob" }],
  ],
}, node);
// Envelope at hash://sha256/{hex} — each output stored at its own URI
```

### Client Composition

Compose validated clients from simple primitives:

```typescript
import {
  createValidatedClient,
  firstMatchSequence,
  msgSchema,
  parallelBroadcast,
} from "@bandeira-tech/b3nd-sdk";

const client = createValidatedClient({
  write: parallelBroadcast(clients),
  read: firstMatchSequence(clients),
  validate: msgSchema(schema),
});
```

For custom behavior without class inheritance:

```typescript
import { FunctionalClient } from "@bandeira-tech/b3nd-sdk";

const client = new FunctionalClient({
  receive: async (msg) => backend.receive(msg),
  read: async (uri) => backend.read(uri),
});
```

Key composition utilities:

- **Validators**: `seq()`, `any()`, `all()`, `msgSchema()`, `schemaValidator()`
- **Combinators**: `parallelBroadcast()`, `firstMatchSequence()`

### Schema

Schema maps `protocol://hostname` to validation functions:

```typescript
const schema: Schema = {
  "mutable://open": async ({ uri, value, read }) => ({ valid: true }),
  "immutable://open": async ({ uri, value, read }) => {
    const existing = await read(uri);
    return { valid: !existing.success };
  },
  "hash://sha256": hashValidator(),
};
```

---

## Protocol Philosophy: URIs Express Behavior, Not Meaning

**This is a foundational architectural constraint.** B3nd URIs define *how data
behaves* (mutability, authentication, content-addressing), never *what data
means* (this is a user profile, a node config, an invoice).

### Why Meaning Cannot Be Encoded in URIs

Meaning lives in interpretation. A managed node config stored at
`mutable://accounts/{key}/nodes/n1/config` is identical in protocol behavior to
one stored at `mutable://accounts/{key}/my-stuff/v2`. The B3nd network cannot
and should not enforce that "all node configs live at `/nodes/*/config`" because:

1. **No enforcement is possible** — Anyone can organize their account data
   however they want.
2. **Meaning is contextual** — The same data structure means different things to
   different readers.
3. **Custom namespaces fragment the protocol** — Inventing
   `mutable://nodes/...` or `mutable://invoices/...` creates new "programs"
   that require custom schema validators and infrastructure. This fights the
   protocol instead of composing with it.

### Canonical Firecat Programs

| Program                  | Behavior                                     |
| ------------------------ | -------------------------------------------- |
| `mutable://accounts`     | Authenticated mutable data (pubkey-signed)   |
| `mutable://open`         | Public mutable data (no auth)                |
| `immutable://inbox`      | Write-once message delivery                  |
| `immutable://accounts`   | Authenticated permanent records              |
| `hash://sha256`          | Content-addressed immutable storage          |
| `link://open/accounts`   | Mutable URI references                       |

A library for a higher-level protocol provides:

1. **Data structure types** — TypeScript interfaces for the domain
2. **URI conventions** — Helpers that construct paths within canonical programs
   (these are *conventions*, not protocol rules)
3. **Workflow orchestration** — Functions that coordinate read/write/poll/sign
4. **Interpretation logic** — Functions that parse data into domain objects

### What This Means for Agents

- **DO** use `mutable://accounts`, `immutable://inbox`, `hash://sha256`, etc.
- **DO** create helper functions for URI construction and data interpretation
- **DO** define TypeScript types for domain data structures
- **DON'T** invent new `protocol://hostname` programs
- **DON'T** create custom schema validators for domain-specific rules
- **DON'T** assume URIs can enforce meaning — meaning comes from interpretation

---

## Applications

| App           | Path                   | Stack                 | Description                                            |
| ------------- | ---------------------- | --------------------- | ------------------------------------------------------ |
| HTTP Server   | `apps/b3nd-node/`      | Deno, Hono            | Multi-backend API server. Dynamic schema loading.      |
| App Backend   | `apps/apps-node/`      | Deno, Hono            | Application backend scaffold.                          |
| Wallet Server | `apps/wallet-node/`    | Deno                  | Wallet/auth server (pubkey-based).                     |
| Web Rig       | `apps/b3nd-web-rig/`   | React, Vite, Tailwind | Data explorer + developer dashboard. Port 5555.        |
| Inspector     | `apps/sdk-inspector/`  | Deno, Hono            | Test runner. Writes results to B3nd. Port 5556.        |
| CLI           | `apps/b3nd-cli/`       | Deno                  | `bnd read <uri>`, `bnd list <uri>`, `bnd node`, etc.  |
| Managed Node  | `apps/b3nd-node/` (Phase 2) | Deno, Docker     | Managed mode activated by CONFIG_URL env var.           |

### Inspector + Dashboard

The inspector runs tests and writes results to B3nd at
`mutable://open/local/inspector`. The web rig dashboard reads from B3nd via the
active backend configured in Settings. No WebSocket — polling only. The B3nd
node URL comes from `appStore.activeBackendId`, not from the dashboard itself.

### External Applications

Standalone repos that consume the B3nd SDK:

| App             | Path                 | Stack       | Description                                           |
| --------------- | -------------------- | ----------- | ----------------------------------------------------- |
| listorama       | `../listorama`       | React, Vite | List management app (`@bandeira-tech/b3nd-web`)       |
| b3ndwebappshell | `../b3ndwebappshell` | Monorepo    | Reusable app shell packages for B3nd web apps         |
| notebook        | `../notebook`        | React 19    | Decentralized notebook on Firecat (firecat-notes)     |

Note: Some sibling directories (e.g. `b3nd-cleanup-docs`, `b3nd-wt1`) are git
worktrees of this repo, not separate applications.

---

## Verification & CI

### Type Checking

```bash
# All entry points (same as pre-push hook)
deno check src/mod.ts libs/*/mod.ts

# Individual lib
deno check libs/b3nd-core/mod.ts

# App entry point
deno check apps/b3nd-node/mod.ts
```

### Running Tests

```bash
# All SDK tests
deno test --allow-all libs/

# Specific lib
deno test --allow-all libs/b3nd-client-memory/

# Integration (requires Docker containers)
deno test --allow-all libs/b3nd-client-postgres/
deno test --allow-all libs/b3nd-client-mongo/
```

### Makefile Targets

```bash
make test                  # All tests
make test t=libs/b3nd-msg/ # Specific path
make test-unit             # Unit tests only (no Postgres/Mongo)
make test-e2e-http         # E2E HTTP tests (starts test server)
make build-sdk             # Build web package + validate JSR exports
```

### Docker Containers

Tests detect and reuse running containers. Never force-kill dev instances.

```bash
docker run --rm -d --name b3nd-postgres -e POSTGRES_DB=b3nd_test -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17-alpine
docker run --rm -d --name b3nd-mongo -e MONGO_INITDB_DATABASE=b3nd_test -p 57017:27017 mongo:8
```

---

## Testing Conventions

- Use `MemoryClient` for unit tests (no external dependencies)
- Use shared test suites (`runSharedSuite`, `runNodeSuite`) for client
  conformance
- Tests are colocated with source: each lib has its test file in its own
  directory
- Shared test utilities live in `libs/b3nd-testing/`
- Unique URI prefixes per test for isolation in persistent backends
- Tests assert exact values — verify actual data matches what was stored
- Docker tests reuse running containers — never kill dev instances

---

## Code Design Principles

1. **Latest stable dependencies** — Stay fresh, easy to evolve.
2. **Errors bubble up** — Never suppress errors. Let callers handle them.
3. **No ENV references in components** — Components take explicit parameters.
4. **No default values** — Require all values explicitly. Rely on the type
   system.
5. **Minimize abstractions** — Use JS knowledge where possible.
6. **Client-level responsibility** — Clients handle their own storage strategy
   (including MessageData unpacking). Validation is composed via
   `createValidatedClient`.
7. **Composition over inheritance** —
   `createValidatedClient({ write, read, validate })` composes behavior from
   functions, not class hierarchies.

---

## Skills System

The b3nd plugin provides a single unified skill that Claude agents use
automatically:

| Skill  | Triggers on                                                                    |
| ------ | ------------------------------------------------------------------------------ |
| `b3nd` | B3nd URIs, Firecat, protocols, encryption, wallet auth, clients, React, Deno   |

The skill is organized into navigable "Guide" sections: Protocol & URIs, Getting
Started, Blob/Link/Encryption, Wallet & Auth, Resource Visibility, Server-Side,
Browser Apps, React Applications, Deno CLI, and E2E Testing.

Skills are the primary way agents learn the current SDK API. After any SDK API
change, update `skills/b3nd/SKILL.md` so agents use correct imports and
patterns.

---

## Packages

| Package | Registry | Name                      | Version |
| ------- | -------- | ------------------------- | ------- |
| SDK     | JSR      | `@bandeira-tech/b3nd-sdk` | 0.7.1   |
| Web     | NPM      | `@bandeira-tech/b3nd-web` | 0.7.1   |

SDK entry point: `src/mod.ts` (re-exports from `libs/`).
NPM build: `tsup` bundles `src/mod.web.ts` (browser-safe subset).
