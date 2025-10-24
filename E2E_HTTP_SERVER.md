# E2E HTTP Test Server

This document describes the SDK-based HTTP test server for end-to-end testing.

## Overview

The test server is a simple in-memory HTTP server built using:
- **Frontend**: SDK's `httpServer` (Hono-based)
- **Backend**: SDK's `MemoryClient` (in-memory storage)
- **Schema**: Simple validation allowing `test://` and `example://` URIs

## Files

### New Files
- `integ/e2e/test-server.ts` - The test server implementation
  - Uses `MemoryClient` for in-memory storage
  - Configures schema to allow `test://` and `example://` URIs
  - Starts HTTP server on port 8000 (configurable via `E2E_SERVER_PORT` env var)
  - Responds to `/api/v1/` endpoints

### Modified Files
- `Makefile` - Updated `test-e2e-http` target to automatically start the server
- `sdk/deno.json` - Added `deno.ns` to compiler options (needed for `Deno.serve()`)
- `sdk/servers/http.ts` - Added Hono imports and proper type annotations
- `integ/e2e/deno.json` - Added `hono` to imports
- `devenv/installations/full-stack/README.md` - Updated example import paths
- `integ/e2e/deno.json` - Updated `@auth` path and added `@encrypt` alias

### Moved Files
- `/auth` → `/sdk/auth`
- `/encrypt` → `/sdk/encrypt`

## Usage

### Automatic (Recommended)

Run the E2E tests with the server automatically started:

```bash
# Simple - starts server, runs tests, cleans up
make test-e2e-http

# Alternative syntax
make test:e2e:http
```

### Manual

If you want to run the server and tests separately:

```bash
# Terminal 1: Start the server
cd integ/e2e
deno run --allow-net --allow-env test-server.ts

# Terminal 2: Run tests against it
cd integ/e2e
E2E_BASE_URL=http://localhost:8000 deno task test:e2e:write-list-read
```

### With External Server

If you have a server running elsewhere:

```bash
make test-e2e-http URL=http://other-host:8000
```

## Configuration

### Server Port

By default, the server runs on port 8000. To use a different port:

```bash
E2E_SERVER_PORT=8080 deno run --allow-net --allow-env integ/e2e/test-server.ts
```

### Test Configuration

The e2e tests support several environment variables:

```bash
# API base URL (default: http://localhost:8000)
E2E_BASE_URL=http://localhost:8000

# Request timeout in milliseconds (default: 30000)
E2E_TIMEOUT=30000

# Enable verbose output (default: false)
E2E_VERBOSE=true

# Test encryption features (default: true)
E2E_TEST_ENCRYPTION=true

# Test authentication features (default: true)
E2E_TEST_AUTH=true

# Clean up test data after tests (default: true)
E2E_CLEANUP=true
```

## API Endpoints

The test server implements the standard SDK HTTP API:

- `GET /api/v1/health` - Health check
- `GET /api/v1/schema` - List supported schema keys
- `POST /api/v1/write/:protocol/:domain/*` - Write data
- `GET /api/v1/read/:protocol/:domain/*` - Read data
- `GET /api/v1/list/:protocol/:domain/*` - List items
- `DELETE /api/v1/delete/:protocol/:domain/*` - Delete data

## Permissions Required

The test server requires these Deno permissions:

```
--allow-net    # For HTTP server
--allow-env    # For port configuration
```

## Schema

The server allows all writes to:
- `test://` - For general testing
- `example://` - For example data

To extend the schema, modify the `testSchema` object in `test-server.ts`.

## How It Works

1. **Server Startup**:
   - Creates a Hono app
   - Creates an in-memory `MemoryClient` backend
   - Configures HTTP server frontend
   - Starts listening on configured port

2. **Request Flow**:
   - HTTP request arrives → Hono routes to handler
   - Handler validates URI against schema
   - Backend processes (read/write/list/delete)
   - Response sent back

3. **Storage**:
   - All data stored in memory (not persisted)
   - Data is lost when server stops
   - Suitable for testing, not production

## Testing Workflow

```bash
# Run tests with automatic server
make test-e2e-http

# Server starts → Tests run → Server stops
# ✅ Automatic cleanup
```

The Makefile handles:
1. Starting the server in the background
2. Waiting 2 seconds for startup
3. Running the tests with `E2E_BASE_URL=http://localhost:8000`
4. Capturing the test result
5. Killing the server process
6. Exiting with the test result code

## Debugging

If tests fail, you can run the server manually to debug:

```bash
# Start server in one terminal (see logs)
deno run --allow-net --allow-env integ/e2e/test-server.ts

# Run tests in another terminal
E2E_BASE_URL=http://localhost:8000 E2E_VERBOSE=true deno task test:e2e:write-list-read
```

Monitor server logs to see:
- Health checks
- Write operations
- Read operations
- List operations
- Delete operations

## Architecture

```
┌─────────────────────────────────────────────────────┐
│         E2E Test Client (ApiClient)                 │
│  - Makes HTTP requests to API endpoints              │
│  - Validates responses                               │
└──────────────────┬──────────────────────────────────┘
                   │ HTTP Requests
                   │
┌──────────────────▼──────────────────────────────────┐
│         HTTP Server (Hono + httpServer)              │
│  - Routes: /api/v1/write, read, list, delete        │
│  - CORS enabled                                      │
│  - Schema validation                                 │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│         MemoryClient Backend                         │
│  - In-memory storage (Map<uri, PersistenceRecord>) │
│  - Supports read, write, list, delete operations    │
│  - Data lost on restart                             │
└─────────────────────────────────────────────────────┘
```

## Composition with SDK Clients

The server uses the same SDK interfaces as client implementations:

```typescript
// Server-side (this test server)
import { MemoryClient } from "../../sdk/clients/memory/mod.ts";
import { httpServer } from "../../sdk/servers/http.ts";

// Client-side (tests)
import { HttpClient } from "../../sdk/clients/http/mod.ts";
import { MemoryClient } from "../../sdk/clients/memory/mod.ts";

// Both implement NodeProtocolInterface
```

This means clients can seamlessly work with different backends:
- Memory (for testing)
- HTTP (for networked APIs)
- WebSocket (for real-time)
- Databases (Postgres, etc.)
- Local/Indexed storage (browser)

## Integration with Auth & Encryption

The test server currently allows all `test://` and `example://` writes without validation.

To integrate with the auth module:

```typescript
import { createCombinedAccess, authValidation } from "../../sdk/auth/mod.ts";

const schema: Schema = {
  "myapp://": authValidation(
    createCombinedAccess((uri) => {
      // Validate using auth module
      return Promise.resolve(["allowed-pubkey"]);
    })
  ),
};
```

Similarly for encryption, the test server can store encrypted payloads transparently:

```typescript
import { encrypt, decrypt } from "../../sdk/encrypt/mod.ts";

// Client encrypts before sending
const encrypted = await encrypt(data, recipientPublicKey);
await client.write(uri, encrypted);

// Server stores as-is, client decrypts
const stored = await client.read(uri);
const decrypted = await decrypt(stored.data, privateKey);
```

## Future Enhancements

- [ ] Add WebSocket server variant
- [ ] Add PostgreSQL backend variant
- [ ] Add persistence (file-based storage)
- [ ] Add logging/telemetry
- [ ] Add metrics collection
- [ ] Add authentication module integration by default
