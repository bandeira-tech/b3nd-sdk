# B3nd Monorepo — Agent Reference

## Repository Structure

```
b3nd/
├── sdk/                    # Core SDK (Deno/JSR + NPM)
│   ├── src/                # Core types, node system, mod.ts
│   │   └── node/           # Unified node: createNode, validators, processors, composition
│   ├── clients/            # Client implementations (memory, http, websocket, postgres, mongo, etc.)
│   ├── txn-data/           # TransactionData convention (detect, types, validators)
│   ├── txn/                # Legacy transaction node (deprecated)
│   ├── blob/               # Content-addressed storage utilities
│   ├── encrypt/            # Client-side encryption (X25519/Ed25519/AES-GCM)
│   ├── wallet/             # Wallet client (auth, proxy read/write)
│   ├── wallet-server/      # Wallet server implementation
│   ├── auth/               # Pubkey-based access control
│   ├── servers/            # HTTP + WebSocket server primitives
│   ├── apps/               # Apps client
│   ├── tests/              # All test suites
│   ├── deno.json           # JSR: @bandeira-tech/b3nd-sdk v0.6.0
│   └── package.json        # NPM: @bandeira-tech/b3nd-web v0.5.2
├── installations/          # Reference server deployments
│   └── http-server/        # Multi-backend HTTP node (Hono)
├── explorer/               # Developer tools
│   ├── app/                # React/Vite frontend (port 5555)
│   └── dashboard/          # Dashboard backend + test artifact builder
├── skills/                 # Claude Code plugin skills
│   ├── b3nd-general/       # URI schemes, protocols, encryption, wallet
│   ├── b3nd-sdk/           # Deno/JSR SDK — clients, node system, transactions
│   ├── b3nd-web/           # NPM browser package
│   ├── b3nd-webapp/        # React apps with B3nd
│   └── b3nd-denocli/       # Deno CLI tools with B3nd
├── cli/                    # bnd CLI tool
├── .claude-plugin/         # Plugin manifest + MCP server
└── AGENTS.md               # This file
```

## Core Architecture

### Transaction Primitives

Everything in B3nd flows through `receive([uri, data])`:

```typescript
type Transaction<D = unknown> = [uri: string, data: D];

// The unified interface:
await client.receive(["mutable://users/alice", { name: "Alice" }]);
await client.read("mutable://users/alice");
await client.list("mutable://users/");
await client.delete("mutable://users/alice");
```

### TransactionData Envelopes

Multiple writes batch into a single transaction. Each client detects `TransactionData` and stores outputs individually:

```typescript
await node.receive(["txn://open/batch-1", {
  inputs: [],
  outputs: [
    ["mutable://open/users/alice", { name: "Alice" }],
    ["mutable://open/users/bob", { name: "Bob" }],
  ],
}]);
// Each output stored at its own URI — reads/lists work unchanged
```

### Unified Node System

Nodes compose validation and processing from simple primitives:

```typescript
import { createNode, txnSchema, parallel, firstMatch } from "@bandeira-tech/b3nd-sdk";

const node = createNode({
  read: firstMatch(...clients),        // Try readers until one succeeds
  validate: txnSchema(schema),          // Validate URI + TransactionData outputs
  process: parallel(...clients),        // Forward to all clients in parallel
});
```

Key composition utilities:
- **Validators**: `seq()`, `any()`, `all()`, `txnSchema()`, `schemaValidator()`
- **Processors**: `parallel()`, `pipeline()`, `when()`, `emit()`, `log()`, `noop()`
- **Readers**: `firstMatch()`
- `parallel()` accepts clients directly — no wrappers needed

### Schema

Schema maps `protocol://hostname` to validation functions:

```typescript
const schema: Schema = {
  "mutable://open": async ({ uri, value, read }) => ({ valid: true }),
  "immutable://open": async ({ uri, value, read }) => {
    const existing = await read(uri);
    return { valid: !existing.success };
  },
  "txn://open": async () => ({ valid: true }),
};
```

## Verification Commands

These commands are the canonical way to verify the SDK. Always run them after making changes.

### Quick Verification (no Docker required)

```bash
cd sdk

# Format check (CI runs this — must pass)
deno fmt --check src/

# Type check
deno check src/mod.ts

# Unit tests (no external dependencies)
deno task test

# All three in sequence:
deno fmt --check src/ && deno check src/mod.ts && deno task test
```

### Full Verification (requires Docker containers)

```bash
cd sdk

# Integration tests — reuse running containers or start new ones
deno task test:integration

# Individual database tests
deno task test:integration:postgres
deno task test:integration:mongo

# Everything
deno fmt --check src/ && deno check src/mod.ts && deno task test && deno task test:integration
```

### Transaction-Specific Tests

```bash
cd sdk
deno test -A tests/txn-unpack.test.ts tests/txn-clients.test.ts
```

### HTTP Server Type Check

```bash
cd installations/http-server && deno check mod.ts
```

### Dashboard Artifacts

```bash
cd explorer/dashboard
deno task dashboard:build    # Regenerate test-results.json + test-logs.txt
```

Dashboard artifacts are gitignored — they must be rebuilt locally after test changes.

## Docker Container Convention

Test files detect and reuse running Docker containers. If a container named `b3nd-mongo` or `b3nd-postgres` is already running and healthy, tests use it directly. No force-kill, no port conflicts with dev.

Start dev containers:
```bash
docker run --rm -d --name b3nd-postgres -e POSTGRES_DB=b3nd_test -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17-alpine
docker run --rm -d --name b3nd-mongo -e MONGO_INITDB_DATABASE=b3nd_test -p 57017:27017 mongo:8
```

## Adjacent Applications

Apps built on b3nd that agents should be aware of:

| App | Path | Description |
|-----|------|-------------|
| listorama | `../listorama` | List management app (reference consumer of b3nd SDK) |
| listorama-b3nd | `../listorama-b3nd` | B3nd integration layer for listorama |
| listorama-frontend | `../listorama-frontend` | Frontend for listorama |
| appsfirecat | `../appsfirecat` | Firecat network apps portal |
| b3nd.fire.cat | `../b3nd.fire.cat` | Firecat network website |

When the SDK changes (new features, API changes), these apps may need updates. The plugin skills guide agents through SDK adoption.

## Skills System

The b3nd plugin provides 5 skills that Claude agents use automatically based on context:

| Skill | Triggers on |
|-------|-------------|
| `b3nd-general` | URI schemes, protocols, encryption, wallet auth |
| `b3nd-sdk` | Deno/JSR imports, server setup, clients, node system, transactions |
| `b3nd-web` | NPM browser imports, HttpClient, WalletClient |
| `b3nd-webapp` | React apps, Zustand, React Query, visibility controls |
| `b3nd-denocli` | Deno CLI tools, scripts, server-side integrations |

Skills are the primary way agents learn the current SDK API. When the SDK changes:
1. Update the relevant skill in `skills/`
2. The skill guides agents to use the correct imports, patterns, and composition

### Skill Update Protocol

After any SDK API change:
1. Run verification: `cd sdk && deno fmt --check src/ && deno check src/mod.ts && deno task test`
2. Update affected skills in `skills/` to reflect new exports, patterns, examples
3. Update `AGENTS.md` if the change affects repo structure or verification commands
4. Rebuild dashboard artifacts if tests changed: `cd explorer/dashboard && deno task dashboard:build`

## Agent Workflow

### Completion Protocol

**Every session that changes code MUST end with verification and a commit.** Do not leave uncommitted work.

1. **Format** — Run `cd sdk && deno fmt` to auto-format all files.
2. **Verify** — Run the full verification chain:
   ```bash
   cd sdk && deno fmt --check src/ && deno check src/mod.ts && deno task test
   ```
   If Docker containers are available, also run `deno task test:integration`.
3. **Commit** — Stage and commit all changes with a clear message describing what was done.
4. **Push** — Push to the remote branch so work is never lost.

If verification fails, fix the issue and re-verify. Never commit failing code. Never leave a session with uncommitted changes.

### Making SDK Changes

1. **Read first** — Never modify code you haven't read. Understand the existing pattern before changing it.
2. **Implement** — Make the changes, keeping them focused and minimal.
3. **Update skills** — If you changed exports, composition patterns, or client behavior, update the relevant skill files in `skills/`.
4. **Rebuild artifacts** — If you added/removed/renamed tests, rebuild dashboard artifacts.
5. **Verify and commit** — Follow the completion protocol above. Every commit should pass the full verification chain.

### Adding a New Client

1. Implement `NodeProtocolInterface` + `Node` (see `clients/memory/mod.ts` as reference)
2. Add `isTransactionData` unpacking in `receive()` (see pattern in memory/postgres/mongo clients)
3. Run shared test suites: `runSharedSuite` and `runNodeSuite`
4. Export from `src/mod.ts`
5. Update `b3nd-sdk` skill

### Adding a New Validator or Processor

1. Add to `src/node/validators.ts` or `src/node/processors.ts`
2. Re-export from `src/node/mod.ts`
3. Re-export from `src/mod.ts`
4. Add tests
5. Update `b3nd-sdk` skill composition examples

### Propagating SDK Changes to Apps

When the SDK API changes and apps need updating:
1. Identify affected apps (listorama, appsfirecat, etc.)
2. The skill system guides agents — when an agent works in an app repo with the b3nd plugin installed, it reads the skills automatically
3. Skills should contain the current import paths, function names, and composition patterns so agents don't use stale APIs

## Code Design Principles

1. **Latest stable dependencies** — Stay fresh, easy to evolve.
2. **Errors bubble up** — Never suppress errors. Let callers handle them.
3. **No ENV references in components** — Components take explicit parameters. No defaults from environment.
4. **No default values** — Require all values explicitly. Rely on the type system.
5. **Minimize abstractions** — Use JS knowledge where possible. `parallel()` not `broadcast(store())`. Fewer concepts to learn.
6. **Client-level responsibility** — Clients handle their own storage strategy (including TransactionData unpacking). The node is just the highway.
7. **Composition over inheritance** — `createNode({ read, validate, process })` composes behavior from functions, not class hierarchies.

## Testing Conventions

- Use `MemoryClient` for unit tests (no external dependencies)
- Use shared test suites (`runSharedSuite`, `runNodeSuite`) for client conformance
- Unique URI prefixes per test for isolation in persistent backends
- Tests assert exact values — verify actual data matches what was stored
- Docker tests reuse running containers — never kill dev instances
- Dashboard artifacts are gitignored — rebuild after test changes

## Packages

| Package | Registry | Name | Version |
|---------|----------|------|---------|
| SDK | JSR | `@bandeira-tech/b3nd-sdk` | 0.6.0 |
| Web | NPM | `@bandeira-tech/b3nd-web` | 0.5.2 |
