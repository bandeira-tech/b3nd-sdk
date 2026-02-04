# B3nd Monorepo — Agent Reference

## Repository Structure

```
b3nd/
├── libs/                       # SDK packages (modular)
│   ├── b3nd-core/              # Foundation: types, encoding, binary
│   ├── b3nd-compose/           # Node composition: createNode, validators, processors
│   ├── b3nd-blob/              # Content-addressed storage utilities
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
│   ├── b3nd-testing/           # Shared test suites (shared-suite, node-suite, mock-http-server)
│   ├── b3nd-sdk/               # Publishing facade (re-exports from sibling libs)
│   │   ├── src/mod.ts          # JSR entry — re-exports everything
│   │   ├── src/mod.web.ts      # NPM entry — browser-safe subset
│   │   ├── deno.json           # JSR: @bandeira-tech/b3nd-sdk v0.6.0
│   │   └── package.json        # NPM: @bandeira-tech/b3nd-web v0.5.2
│   ├── b3nd-auth/              # Pubkey-based access control
│   ├── b3nd-encrypt/           # Client-side encryption (X25519/Ed25519/AES-GCM)
│   ├── b3nd-wallet/            # Wallet client (auth, proxy read/write)
│   ├── b3nd-wallet-server/     # Wallet server implementation
│   └── b3nd-apps/              # Apps client
├── apps/                       # All applications
│   ├── b3nd-node/              # Multi-backend HTTP node (Hono) — generic schema-based API
│   ├── apps-node/              # Application backend scaffold
│   ├── wallet-node/            # Wallet/auth server
│   ├── b3nd-web-rig/           # React/Vite data explorer UI (port 5555)
│   ├── sdk-inspector/          # Test runner + monitoring backend (port 5556, WebSocket)
│   ├── b3nd-cli/               # bnd CLI tool (Deno, compiled binary)
│   └── website/                # Static site
├── tests/                      # E2E tests
├── skills/                     # Claude Code plugin skills
│   ├── b3nd-general/           # URI schemes, protocols, encryption, wallet
│   ├── b3nd-sdk/               # Deno/JSR SDK — clients, node system, messages
│   ├── b3nd-web/               # NPM browser package
│   ├── b3nd-webapp/            # React apps with B3nd
│   └── b3nd-denocli/           # Deno CLI tools with B3nd
├── .claude-plugin/             # Plugin manifest + MCP server
│   └── mcp-server/             # Deno MCP server — multi-backend CRUD tools
├── deno.json                   # Root workspace config
└── AGENTS.md                   # This file
```

## Core Architecture

### Message Primitives

Everything in B3nd flows through `receive([uri, data])`:

```typescript
type Message<D = unknown> = [uri: string, data: D];

// The unified interface:
await client.receive(["mutable://users/alice", { name: "Alice" }]);
await client.read("mutable://users/alice");
await client.list("mutable://users/");
await client.delete("mutable://users/alice");
```

### MessageData Envelopes

Multiple writes batch into a single message. Each client detects `MessageData`
and stores outputs individually:

```typescript
await node.receive(["msg://open/batch-1", {
  inputs: [],
  outputs: [
    ["mutable://open/users/alice", { name: "Alice" }],
    ["mutable://open/users/bob", { name: "Bob" }],
  ],
}]);
// Each output stored at its own URI — reads/lists work unchanged
```

### Client Composition

Compose validated clients from simple primitives using `createValidatedClient`:

```typescript
import {
  createValidatedClient,
  firstMatchSequence,
  msgSchema,
  parallelBroadcast,
} from "@bandeira-tech/b3nd-sdk";

const client = createValidatedClient({
  write: parallelBroadcast(clients), // Broadcast writes to all clients
  read: firstMatchSequence(clients), // Try readers until one succeeds
  validate: msgSchema(schema), // Validate URI + MessageData outputs
});
```

For custom behavior without class inheritance, use `FunctionalClient`:

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
  "msg://open": async () => ({ valid: true }),
};
```

## Verification Commands

These commands are the canonical way to verify the SDK. Always run them after
making changes.

### Quick Verification (no Docker required)

```bash
# Type check the SDK facade
cd libs/b3nd-sdk && deno check src/mod.ts

# Type check individual libs
cd libs/b3nd-core && deno check mod.ts
cd libs/b3nd-compose && deno check mod.ts
cd libs/b3nd-client-memory && deno check mod.ts

# Unit tests (no external dependencies) — run from individual libs
cd libs/b3nd-client-memory && deno test -A
cd libs/b3nd-client-http && deno test -A
cd libs/b3nd-msg && deno test -A
cd libs/b3nd-combinators && deno test -A
cd libs/b3nd-core && deno test -A
```

### Full Verification (requires Docker containers)

```bash
# Integration tests — reuse running containers or start new ones
cd libs/b3nd-client-postgres && deno test -A
cd libs/b3nd-client-mongo && deno test -A
```

### Message-Specific Tests

```bash
cd libs/b3nd-msg
deno test -A msg-unpack.test.ts msg-clients.test.ts
```

### HTTP Server Type Check

```bash
cd apps/b3nd-node && deno check mod.ts
```

### Dashboard Artifacts

```bash
cd apps/sdk-inspector
deno task dashboard:build    # Regenerate test-results.json + test-logs.txt
```

Dashboard artifacts are gitignored — they must be rebuilt locally after test
changes.

## Docker Container Convention

Test files detect and reuse running Docker containers. If a container named
`b3nd-mongo` or `b3nd-postgres` is already running and healthy, tests use it
directly. No force-kill, no port conflicts with dev.

Start dev containers:

```bash
docker run --rm -d --name b3nd-postgres -e POSTGRES_DB=b3nd_test -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17-alpine
docker run --rm -d --name b3nd-mongo -e MONGO_INITDB_DATABASE=b3nd_test -p 57017:27017 mongo:8
```

## Applications

### In-Repo Applications

These are applications and services inside this monorepo:

| App           | Path                         | Stack                 | Description                                                                                                                            |
| ------------- | ---------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP Server   | `apps/b3nd-node/`            | Deno, Hono            | Generic multi-backend API server. Loads schema modules dynamically. Supports Postgres, Mongo, Memory, HTTP backends via `BACKEND_URL`. |
| App Backend   | `apps/apps-node/`            | Deno, Hono            | Application backend scaffold with Docker deployment.                                                                                   |
| Wallet Server | `apps/wallet-node/`          | Deno                  | Wallet/auth server for pubkey-based authentication.                                                                                    |
| Explorer App  | `apps/b3nd-web-rig/`         | React, Vite, Tailwind | Data explorer UI for browsing B3nd nodes. Port 5555. Uses `@bandeira-tech/b3nd-web`.                                                   |
| Dashboard     | `apps/sdk-inspector/`        | Deno, Hono, WebSocket | Live test runner and monitoring backend. Port 5556. Generates test artifacts.                                                          |
| bnd CLI       | `apps/b3nd-cli/`             | Deno                  | Command-line interface for B3nd nodes. `./apps/b3nd-cli/bnd read <uri>`, `./apps/b3nd-cli/bnd list <uri>`.                             |
| MCP Server    | `.claude-plugin/mcp-server/` | Deno                  | Multi-backend CRUD tools for Claude Code. Reads `B3ND_BACKENDS` env.                                                                   |

### External Applications

Standalone repos that consume the B3nd SDK. When the SDK API changes, these apps
may need updates. The plugin skills guide agents through SDK adoption.

| App             | Path                 | Stack       | Description                                                                 |
| --------------- | -------------------- | ----------- | --------------------------------------------------------------------------- |
| listorama       | `../listorama`       | React, Vite | List management app — reference consumer of `@bandeira-tech/b3nd-web`       |
| b3ndwebappshell | `../b3ndwebappshell` | Monorepo    | Reusable application shell packages for B3nd web apps                       |
| notebook        | `../notebook`        | React 19    | Decentralized notebook/microblogging app on Firecat network (firecat-notes) |

Note: Some sibling directories (e.g. `b3nd-cleanup-docs`, `b3nd-wt1`) are **git
worktrees** of this repo, not separate applications.

## Skills System

The b3nd plugin provides 5 skills that Claude agents use automatically based on
context:

| Skill          | Triggers on                                                    |
| -------------- | -------------------------------------------------------------- |
| `b3nd-general` | URI schemes, protocols, encryption, wallet auth                |
| `b3nd-sdk`     | Deno/JSR imports, server setup, clients, node system, messages |
| `b3nd-web`     | NPM browser imports, HttpClient, WalletClient                  |
| `b3nd-webapp`  | React apps, Zustand, React Query, visibility controls          |
| `b3nd-denocli` | Deno CLI tools, scripts, server-side integrations              |

Skills are the primary way agents learn the current SDK API. When the SDK
changes:

1. Update the relevant skill in `skills/`
2. The skill guides agents to use the correct imports, patterns, and composition

### Skill Update Protocol

After any SDK API change:

1. Run verification: `cd libs/b3nd-sdk && deno check src/mod.ts`
2. Update affected skills in `skills/` to reflect new exports, patterns,
   examples
3. Update `AGENTS.md` if the change affects repo structure or verification
   commands
4. Rebuild dashboard artifacts if tests changed:
   `cd apps/sdk-inspector && deno task dashboard:build`

## Agent Workflow

### Completion Protocol

**Every session that changes code MUST end with verification and a commit.** Do
not leave uncommitted work.

1. **Format** — Run `deno fmt` to auto-format all files.
2. **Verify** — Type check the SDK facade and run unit tests:
   ```bash
   cd libs/b3nd-sdk && deno check src/mod.ts
   cd libs/b3nd-client-memory && deno test -A
   ```
   If Docker containers are available, also run postgres/mongo client tests.
3. **Commit** — Stage and commit all changes with a clear message describing
   what was done.
4. **Push** — Push to the remote branch so work is never lost.

If verification fails, fix the issue and re-verify. Never commit failing code.
Never leave a session with uncommitted changes.

### Making SDK Changes

1. **Read first** — Never modify code you haven't read. Understand the existing
   pattern before changing it.
2. **Implement** — Make the changes, keeping them focused and minimal.
3. **Update skills** — If you changed exports, composition patterns, or client
   behavior, update the relevant skill files in `skills/`.
4. **Rebuild artifacts** — If you added/removed/renamed tests, rebuild dashboard
   artifacts.
5. **Verify and commit** — Follow the completion protocol above. Every commit
   should pass the full verification chain.

### Adding a New Client

1. Create `libs/b3nd-client-{name}/` with `mod.ts` and `deno.json`
2. Implement `NodeProtocolInterface` (see `libs/b3nd-client-memory/mod.ts` as
   reference)
3. Add `isMessageData` unpacking in `receive()` (see pattern in
   memory/postgres/mongo clients)
4. Run shared test suites: `runSharedSuite` and `runNodeSuite` from
   `libs/b3nd-testing/`
5. Re-export from `libs/b3nd-sdk/src/mod.ts`
6. Update `b3nd-sdk` skill

### Adding a New Validator or Processor

1. Add to `libs/b3nd-compose/validators.ts` or `libs/b3nd-compose/processors.ts`
2. Re-export from `libs/b3nd-compose/mod.ts`
3. Re-export from `libs/b3nd-sdk/src/mod.ts`
4. Add tests
5. Update `b3nd-sdk` skill composition examples

### Propagating SDK Changes to Apps

When the SDK API changes and apps need updating:

1. Identify affected apps (listorama, b3ndwebappshell, notebook)
2. The skill system guides agents — when an agent works in an app repo with the
   b3nd plugin installed, it reads the skills automatically
3. Skills should contain the current import paths, function names, and
   composition patterns so agents don't use stale APIs

## Code Design Principles

1. **Latest stable dependencies** — Stay fresh, easy to evolve.
2. **Errors bubble up** — Never suppress errors. Let callers handle them.
3. **No ENV references in components** — Components take explicit parameters. No
   defaults from environment.
4. **No default values** — Require all values explicitly. Rely on the type
   system.
5. **Minimize abstractions** — Use JS knowledge where possible. Fewer concepts
   to learn.
6. **Client-level responsibility** — Clients handle their own storage strategy
   (including MessageData unpacking). Validation is composed via
   `createValidatedClient`.
7. **Composition over inheritance** —
   `createValidatedClient({ write, read, validate })` composes behavior from
   functions, not class hierarchies.

## Testing Conventions

- Use `MemoryClient` for unit tests (no external dependencies)
- Use shared test suites (`runSharedSuite`, `runNodeSuite`) for client
  conformance
- Tests are colocated with source: each client lib has its test file in its own
  directory
- Shared test utilities live in `libs/b3nd-testing/`
- Unique URI prefixes per test for isolation in persistent backends
- Tests assert exact values — verify actual data matches what was stored
- Docker tests reuse running containers — never kill dev instances
- Dashboard artifacts are gitignored — rebuild after test changes

## Packages

| Package | Registry | Name                      | Version |
| ------- | -------- | ------------------------- | ------- |
| SDK     | JSR      | `@bandeira-tech/b3nd-sdk` | 0.9.0   |
| Web     | NPM      | `@bandeira-tech/b3nd-web` | 0.8.0   |
