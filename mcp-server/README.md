# B3nd MCP Server

Model Context Protocol (MCP) server for B3nd SDK. Provides Claude Code with tools to read, write, list, and manage data across multiple B3nd backends with dynamic switching.

## Features

- **Multi-backend support**: Configure and switch between local, testnet, mainnet, etc.
- **Dynamic backend management**: Add/remove backends at runtime
- **Per-operation backend selection**: Override the active backend for specific operations
- **Full CRUD operations**: Read, write, list, delete data via B3nd URIs

## Quick Install

### Option 1: Project Scope (Recommended)

The `.mcp.json` in the repo root auto-configures the server. Just restart Claude Code in this project.

### Option 2: CLI Install with Multiple Backends

```bash
claude mcp add --transport stdio b3nd \
  --env "B3ND_BACKENDS=local=http://localhost:8842,testnet=https://testnet.b3nd.io,mainnet=https://api.b3nd.io" \
  -- deno run -A /path/to/b3nd/mcp-server/mod.ts
```

### Option 3: Single Backend (Backwards Compatible)

```bash
claude mcp add --transport stdio b3nd \
  --env B3ND_BACKEND_URL=http://localhost:8842 \
  -- deno run -A /path/to/b3nd/mcp-server/mod.ts
```

## Environment Variables

| Variable | Format | Description |
|----------|--------|-------------|
| `B3ND_BACKENDS` | `name1=url1,name2=url2` | Multiple backends (comma-separated) |
| `B3ND_BACKEND_URL` | `http://...` | Single default backend (fallback) |

### Example Configurations

```bash
# Development setup
B3ND_BACKENDS="local=http://localhost:8842"

# Full environment setup
B3ND_BACKENDS="local=http://localhost:8842,testnet=https://testnet.b3nd.io,mainnet=https://api.b3nd.io"
```

## Available Tools

### Backend Management

| Tool | Description |
|------|-------------|
| `b3nd_backends_list` | List all backends and show which is active |
| `b3nd_backends_switch` | Switch active backend (e.g., to 'testnet') |
| `b3nd_backends_add` | Add a new backend at runtime |
| `b3nd_backends_remove` | Remove a backend configuration |

### Data Operations

| Tool | Description |
|------|-------------|
| `b3nd_read` | Read data from a B3nd URI |
| `b3nd_write` | Write JSON data to a B3nd URI |
| `b3nd_list` | List items at a path |
| `b3nd_delete` | Delete data at a URI |
| `b3nd_health` | Check backend health |
| `b3nd_schema` | Get available protocols |

All data operations accept an optional `backend` parameter to target a specific backend without switching.

## Usage Examples

### Backend Switching

```
> List available backends
> Switch to testnet
> Check health of the testnet backend
```

### Dynamic Backend Management

```
> Add a new backend called "staging" at https://staging.b3nd.io
> Switch to staging and list users
> Remove the staging backend
```

### Data Operations with Backend Selection

```
> Read mutable://users/alice/profile from local backend
> Write the same data to testnet backend
> Compare data between local and testnet
```

### Typical Workflow

```
> List backends
{
  "activeBackend": "local",
  "backends": [
    { "name": "local", "url": "http://localhost:8842", "isActive": true },
    { "name": "testnet", "url": "https://testnet.b3nd.io", "isActive": false }
  ]
}

> Switch to testnet
Switched to backend 'testnet'

> Read mutable://users/alice/profile
{
  "success": true,
  "backend": "testnet",
  "uri": "mutable://users/alice/profile",
  "data": { "name": "Alice" }
}

> Write the same data to local backend
(Uses backend: "local" parameter)
```

## Development

```bash
# Run server directly
deno run -A mod.ts

# Run with multiple backends
B3ND_BACKENDS="local=http://localhost:8842,testnet=https://testnet.b3nd.io" deno run -A mod.ts

# Watch mode
deno task dev
```

## Verify Installation

```bash
# List configured MCP servers
claude mcp list

# Get server details
claude mcp get b3nd

# In Claude Code, check MCP status
/mcp
```

## Project Configuration

Update `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "b3nd": {
      "command": "deno",
      "args": ["run", "-A", "./mcp-server/mod.ts"],
      "env": {
        "B3ND_BACKENDS": "local=http://localhost:8842,testnet=https://testnet.b3nd.io"
      }
    }
  }
}
```
