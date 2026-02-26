# CLAUDE.md — B3nd SDK

## What Is This?

B3nd is a universal persistence SDK using URI-based addressing where users own their data, privacy is encryption, and any app can read the same addresses. Four operations do everything: `receive`, `read`, `list`, `delete`.

**Packages:**
- `@bandeira-tech/b3nd-sdk` on JSR — Deno/servers (entry: `src/mod.ts`)
- `@bandeira-tech/b3nd-web` on NPM — Browser/React (entry: `src/mod.web.ts`)

**Version:** 0.7.2 | **License:** MIT

## Quick Reference

```bash
# Type-check (required before every commit)
deno check src/mod.ts libs/*/mod.ts

# Run unit tests (no database needed)
make test-unit

# Run all tests (requires Postgres/Mongo containers)
make test

# Run specific test
make test t=libs/b3nd-client-memory/

# Build NPM web package
npm run build

# Lint and format
deno lint src/
deno fmt src/
```

## Completion Protocol

Every session that changes code must follow this sequence:
1. `deno check src/mod.ts libs/*/mod.ts` — type-check all entry points
2. Commit changes
3. Push to remote

Pre-push hook blocks on type-check failure. Never leave uncommitted work.

## Repository Structure

```
src/                    SDK entry points
  mod.ts                JSR export (all clients including Postgres, Mongo)
  mod.web.ts            NPM export (browser-safe: HTTP, WS, localStorage, Wallet, Apps)

libs/                   Core libraries (Deno workspace members)
  b3nd-core/            Types, encoding, binary ops, FunctionalClient
  b3nd-client-memory/   In-memory Map-based storage
  b3nd-client-http/     HTTP/REST client
  b3nd-client-ws/       WebSocket client with reconnection
  b3nd-client-postgres/ PostgreSQL client with schema generation
  b3nd-client-mongo/    MongoDB client
  b3nd-client-indexeddb/ Browser IndexedDB client
  b3nd-client-localstorage/ Browser localStorage client
  b3nd-compose/         Node composition: validators, processors, createValidatedClient
  b3nd-msg/             Message layer, envelopes, content-addressing
  b3nd-msg/data/        MessageData convention (inputs/outputs, Level 2)
  b3nd-combinators/     parallelBroadcast, firstMatchSequence
  b3nd-servers/         HTTP and WebSocket server primitives (Hono-based)
  b3nd-encrypt/         Ed25519 signing, X25519 ECDH + AES-GCM encryption
  b3nd-auth/            Authentication and access control
  b3nd-hash/            Content-addressable hashing
  b3nd-wallet/          Wallet client (session auth, encrypt/decrypt proxy)
  b3nd-wallet-server/   Wallet server implementation
  b3nd-apps/            Apps client
  b3nd-listener/        Event listening
  b3nd-managed-node/    Managed node implementation
  b3nd-testing/         Shared test suite and mock HTTP servers

apps/                   Deployable applications
  b3nd-node/            Main B3nd node server (HTTP/WS API on :9942)
  b3nd-web-rig/         React web development rig (:5555)
  sdk-inspector/        SDK debugging tool (:5556)
  b3nd-cli/             CLI tool
  wallet-node/          Wallet server
  apps-node/            Apps server
  vault-listener/       Vault event listener
  website/              Documentation site

tests/                  E2E tests (self-contained test server on :8000)
skills/b3nd/            Claude Code plugin knowledge files
.claude-plugin/         Claude Code plugin config + MCP server
```

## Runtime & Tooling

| Tool | Details |
|------|---------|
| **Runtime** | Deno 2.x (primary), Node.js >=24.11.1 (NPM package) |
| **Package managers** | Deno (JSR imports), NPM (browser bundle) |
| **Build** | tsup (esbuild) for NPM bundle; `deno check` for type-checking |
| **Test framework** | `Deno.test` (built-in) |
| **Linter** | `deno lint` (no ESLint) |
| **Formatter** | `deno fmt` (no Prettier) |
| **CI** | GitHub Actions (`.github/workflows/ci.yml`) |
| **Databases** | PostgreSQL 17, MongoDB 8 (via Docker Compose) |

## Architecture & Core Concepts

### The Universal Interface

All clients implement `NodeProtocolInterface`:

```typescript
interface NodeProtocolInterface {
  receive<D>(msg: [uri: string, data: D]): Promise<ReceiveResult>;
  read<T>(uri: string): Promise<ReadResult<T>>;
  readMulti<T>(uris: string[]): Promise<ReadMultiResult<T>>;
  list(uri: string, options?: ListOptions): Promise<ListResult>;
  delete(uri: string): Promise<DeleteResult>;
  health(): Promise<HealthStatus>;
  getSchema(): Promise<string[]>;
  cleanup(): Promise<void>;
}
```

### URI Addressing

URIs define behavior, not meaning: `protocol://hostname/path`
- `mutable://` — overwritable data
- `immutable://` — content-addressed, write-once
- `encrypted://` — encrypted data

### Message Type

The fundamental primitive is `Message<D> = [uri: string, data: D]` — a tuple of URI and data.

### Result-Based Error Handling

Operations return result objects, not exceptions:
```typescript
const result = await client.read("mutable://users/alice");
if (result.success) {
  console.log(result.record?.data);
} else {
  console.log(result.error);
}
```

`ClientError(message, code, details)` is used for unexpected failures.

### Composition Patterns

- `parallelBroadcast(clients)` — writes to all clients, reads from first
- `firstMatchSequence(clients)` — tries each client in order until success
- `createValidatedClient({ write, read, validate })` — wraps clients with schema validation

### Schema Validation

Validators keyed by `protocol://hostname`:
```typescript
const schema: Schema = {
  "mutable://users": async ({ uri, value, read }) => {
    if (!value?.name) return { valid: false, error: "name required" };
    return { valid: true };
  }
};
```

## Code Principles

1. **Composition over inheritance** — use `createValidatedClient`, combinators, `FunctionalClient`
2. **No ENV in components** — pass explicit parameters, no hidden defaults
3. **Errors bubble up** — never suppress; let callers handle
4. **Client-level responsibility** — clients handle MessageData unpacking
5. **Minimize abstractions** — vanilla JS/TS, avoid unnecessary wrappers
6. **Named exports only** — no default exports; use barrel re-exports
7. **Result objects over exceptions** — `{ success, record?, error? }` pattern

## Testing

### Test Commands

```bash
make test-unit                              # Memory, Wallet, Combinators, ManagedNode
make test                                   # All libs/ (needs DB containers)
make test t=libs/b3nd-client-memory/        # Specific lib
make test-e2e-http                          # E2E with auto-started test server
deno task test:integration:postgres         # PostgreSQL integration
deno task test:integration:mongo            # MongoDB integration
```

### Database Containers

```bash
make up p=test    # Ephemeral: Postgres :55432, Mongo :57017
make up p=dev     # Persistent: Postgres :5432, Mongo :27017
make down p=test  # Stop containers
```

### Test Conventions

- Test files: `*.test.ts` alongside source in each lib
- Shared client test suite: `libs/b3nd-testing/shared-suite.ts`
- Mock HTTP servers: `libs/b3nd-testing/mock-http-server.ts`
- E2E tests in `tests/` use a self-contained test server
- Use `Deno.test` with `@std/assert` for assertions

## Development Workflow

### Full Dev Environment

```bash
make dev    # Starts: Postgres + B3nd node (:9942) + Web rig (:5555) + Inspector (:5556)
make node   # Standalone node with memory backend on :9942
make rig    # Web rig + inspector (expects node already running)
make check  # Health check all services
```

### Building & Publishing

```bash
npm run build                   # Build web/NPM bundle via tsup
deno task check                 # Type-check JSR entry point
make build-sdk                  # Build + type-check combined
make version v=X.Y.Z            # Bump version in deno.json + package.json, create git tag
make publish                    # Publish to both JSR and NPM (runs unit tests first)
```

### NPM Package Entry Points

The `package.json` exports map for fine-grained imports:
- `.` — main web bundle
- `./clients/http`, `./clients/websocket`, `./clients/memory`, `./clients/local-storage`
- `./wallet`, `./apps`, `./encrypt`, `./hash`
- `./wallet-server`, `./wallet-server/adapters/browser`

## CI Pipeline

GitHub Actions runs on push/PR to `main` with 7 parallel jobs:
1. **SDK Unit Tests** — `deno task test`
2. **Auth Tests** — `libs/b3nd-auth`
3. **Encrypt Tests** — `libs/b3nd-encrypt` (allowed to fail)
4. **E2E Tests** — starts test server, runs write-list-read suite
5. **Lint & Format Check** — `deno lint src/` + `deno fmt --check src/`
6. **Type Check** — `deno check src/mod.ts`
7. **Integration Tests** — PostgreSQL + MongoDB with service containers

## Workspace Layout

The Deno workspace (`deno.json`) contains 24+ members. Each lib has its own `deno.json` with version, exports, and imports. All share the same version number.

Key workspace members: all `libs/b3nd-*`, `apps/*`, `tests/`, `.claude-plugin/mcp-server`.

## Deprecated Names

Several types were renamed from "Transaction" to "Message". Legacy aliases exist:
- `Transaction` -> `Message`
- `TransactionData` -> `MessageData`
- `txnSchema` -> `msgSchema`
- `createTransactionNode` -> `createMessageNode`

Use the new names in all new code.

## Skills & Agent Knowledge

Read `skills/b3nd/` for SDK API details, Firecat patterns, protocol design, node operations, and cookbooks. After any SDK change, update the relevant skill file so agents use correct imports.
