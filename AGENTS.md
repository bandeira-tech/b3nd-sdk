# B3nd Monorepo — Agent Reference

## Repository Structure

```
b3nd/
├── sdk/                    # Core SDK (Deno/JSR + NPM)
│   ├── src/                # Core types, mod.ts, mod.web.ts
│   ├── clients/            # Client implementations
│   │   ├── memory/         # In-memory (testing)
│   │   ├── http/           # HTTP client
│   │   ├── websocket/      # WebSocket client
│   │   ├── postgres/       # PostgreSQL client
│   │   ├── mongo/          # MongoDB client
│   │   ├── local-storage/  # Browser localStorage
│   │   └── indexed-db/     # Browser IndexedDB
│   ├── blob/               # Content-addressed storage utilities
│   ├── encrypt/            # Client-side encryption (X25519/Ed25519/AES-GCM)
│   ├── wallet/             # Wallet client (auth, proxy read/write)
│   ├── wallet-server/      # Wallet server implementation
│   ├── auth/               # Pubkey-based access control
│   ├── txn/                # Transaction node creation + composition
│   ├── servers/            # HTTP + WebSocket server primitives
│   ├── apps/               # Apps client
│   ├── tests/              # Shared test suites + client tests
│   ├── deno.json           # JSR: @bandeira-tech/b3nd-sdk v0.5.1
│   └── package.json        # NPM: @bandeira-tech/b3nd-web v0.5.1
├── cli/                    # bnd CLI tool
│   ├── bnd                 # Bash wrapper: ./bnd <command>
│   └── src/main.ts         # CLI entry point
├── explorer/               # Web UI tools
│   ├── app/                # React/Vite frontend (port 5555)
│   │   └── src/
│   │       └── components/
│   │           └── dashboard/  # Developer dashboard UI
│   └── dashboard/          # Dashboard backend (Deno, port 5556)
│       ├── mod.ts          # Hono server
│       ├── tasks/          # Build artifacts (test results, source extraction)
│       └── services/       # Test runner, file watcher, health monitor
├── installations/          # Reference server deployments
├── skills/                 # Claude Code plugin skills (5 skills)
├── .claude-plugin/         # Claude Code plugin config + MCP server
│   ├── plugin.json         # Plugin manifest
│   └── mcp-server/mod.ts   # MCP server with b3nd_* tools
└── AGENTS.md               # This file
```

## Core Concept: Transactions

**All state changes in B3nd flow through transactions.** A transaction is a tuple `[uri, data]`:

```typescript
type Transaction<D = unknown> = [uri: string, data: D];

// The unified interface for all state changes:
interface Node {
  receive<D>(tx: Transaction<D>): Promise<ReceiveResult>;
  cleanup(): Promise<void>;
}

interface ReceiveResult {
  accepted: boolean;
  error?: string;
}
```

Usage — `receive()` is the **preferred** interface for all clients:

```typescript
// Preferred: transaction tuple
await client.receive(["mutable://users/alice/profile", { name: "Alice" }]);

// All clients also support read, list, delete, readMulti:
const result = await client.read("mutable://users/alice/profile");
const list = await client.list("mutable://users/");  // flat prefix match, returns full URIs
await client.delete("mutable://users/alice/profile");
```

### List Interface

`list()` returns all stored records whose URIs match a given prefix. Results are flat — no directory/file distinction:

```typescript
interface ListItem {
  uri: string;  // Full stored URI
}
```

## Available Clients

| Client | Package | Runtime | Use Case |
|--------|---------|---------|----------|
| `MemoryClient` | b3nd-sdk | Deno | Testing, prototyping |
| `HttpClient` | Both | Any | Connect to HTTP nodes |
| `WebSocketClient` | Both | Any | Real-time connections |
| `PostgresClient` | b3nd-sdk | Deno | Persistent storage |
| `MongoClient` | b3nd-sdk | Deno | Persistent storage |
| `LocalStorageClient` | b3nd-web | Browser | Offline cache |

All clients implement `NodeProtocolInterface` (receive, read, readMulti, list, delete, health, getSchema, cleanup).

## Packages

| Package | Registry | Name | Version |
|---------|----------|------|---------|
| SDK | JSR | `@bandeira-tech/b3nd-sdk` | 0.5.1 |
| Web | NPM | `@bandeira-tech/b3nd-web` | 0.5.1 |

## Tools Available

### MCP Tools (via Claude plugin)

When the B3nd plugin is installed, these MCP tools are available directly:

| Tool | Description |
|------|-------------|
| `b3nd_receive` | Submit a transaction `[uri, data]` to the active backend |
| `b3nd_read` | Read data from a URI |
| `b3nd_list` | List items at a URI prefix |
| `b3nd_delete` | Delete data at a URI |
| `b3nd_health` | Health check on backend |
| `b3nd_schema` | Get available protocols |
| `b3nd_backends_list` | List configured backends |
| `b3nd_backends_switch` | Switch active backend |
| `b3nd_backends_add` | Add new backend |

Configure backends: `export B3ND_BACKENDS="local=http://localhost:9942"`

### bnd CLI Tool

Located at `cli/bnd`. Run with: `./cli/bnd <command>`

Commands: `read <uri>`, `list <uri>`, `write`, `upload`, `deploy`, `config`, `account create`, `encrypt create`

### Test Infrastructure

Tests use Deno's built-in test runner:

```bash
cd sdk
deno task test                    # Run all tests
make test                         # Same via Makefile
make test t=tests/memory-client.test.ts  # Specific test file
```

**Shared test suites** (`sdk/tests/shared-suite.ts`, `sdk/tests/node-suite.ts`) ensure all client implementations behave identically. New clients should run both suites.

**125 tests** across: auth (10), mongo (15), read-multi (8), memory (20), postgres (15), http (20), binary (13), wallet (12), txn (12).

### Developer Dashboard

The explorer dashboard provides a UI for browsing test results and source code:

```bash
cd explorer/dashboard
deno task dashboard:build   # Build static test artifacts
deno task dev               # Start dashboard backend (port 5556)

cd explorer/app
npm run dev                 # Start React frontend (port 5555)
# Browse: http://localhost:5555/dashboard
```

Features: test result browsing by theme (SDK Core, Network, Database, Auth, Binary, E2E), source code extraction with line numbers, search across tests.

### Explorer & Writer

The React app at `explorer/app/` provides:
- **Explorer** (`/explorer/*`) — Browse B3nd data by URI
- **Writer** (`/writer/*`) — Write data to B3nd nodes
- **Dashboard** (`/dashboard/*`) — Test results and code exploration
- **Accounts** (`/accounts`) — Account management
- **Settings** (`/settings`) — Backend configuration

## Code Design Principles

1. **Latest stable dependencies** — Stay fresh, easy to evolve.

2. **Errors bubble up** — Never suppress errors. Let callers handle them.

3. **No ENV references in components** — Components MUST NOT reference environment variables or external input. Require the user to pass all values explicitly:

   ```typescript
   // BAD - references ENV:
   tablePrefix: Deno.env.get("POSTGRES_TABLE_PREFIX") || "b3nd",

   // GOOD - explicit parameter:
   tablePrefix: string  // required, no default
   ```

4. **No default values** — Require all values explicitly. Fail if a required value is not set. Rely on the type system to enforce this.

5. **Component structure** — `./project/componenttype/componentname/<files>`

## Testing Conventions

- Use `MemoryClient` for unit tests (no external dependencies)
- Use shared test suites (`runSharedSuite`, `runNodeSuite`) for client conformance
- Unique URI prefixes per test (e.g., `store://users/test-${Date.now()}/...`) for isolation in persistent backends
- Tests assert exact values, not just metadata — verify actual data returned matches what was stored
- Binary data tests verify byte-level integrity
