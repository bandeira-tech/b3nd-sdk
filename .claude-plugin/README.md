# B3nd Claude Code Plugin

Development tools for building applications with the B3nd universal persistence protocol.

## Quick Install

```bash
# Add the B3nd marketplace from GitHub
claude plugin marketplace add https://github.com/bandeira-tech/b3nd

# Install the plugin
claude plugin install b3nd --scope user
```

Or interactively from within Claude Code:
```
> /plugin marketplace add https://github.com/bandeira-tech/b3nd
> /plugin install b3nd
```

## What's Included

### Skills (Auto-activated by Claude)

| Skill | Description |
|-------|-------------|
| **b3nd-general** | Core B3nd architecture, URI schemes, interfaces |
| **b3nd-sdk** | Deno/JSR package `@bandeira-tech/b3nd-sdk` |
| **b3nd-web** | NPM package `@bandeira-tech/b3nd-web` |
| **b3nd-webapp** | React/Vite web app patterns |
| **b3nd-denocli** | Deno CLI and server patterns |

### MCP Server (B3nd Data Tools)

Tools for interacting with B3nd backends directly from Claude:

| Tool | Description |
|------|-------------|
| `b3nd_receive` | Submit transaction `[uri, data]` (primary write interface) |
| `b3nd_read` | Read data from URI |
| `b3nd_list` | List items matching URI prefix (flat, full URIs) |
| `b3nd_delete` | Delete data |
| `b3nd_health` | Health check |
| `b3nd_schema` | Get available protocols |
| `b3nd_backends_list` | List configured backends |
| `b3nd_backends_switch` | Switch active backend |
| `b3nd_backends_add` | Add new backend |

## Configuration

Set your backends via environment variable before starting Claude:

```bash
# Single backend
export B3ND_BACKENDS="local=http://localhost:8842"

# Multiple backends
export B3ND_BACKENDS="local=http://localhost:8842,testnet=https://testnet.b3nd.io"
```

## Usage Examples

Once installed, just ask Claude naturally:

```
> How do I create a B3nd HTTP client?
> Read mutable://users/alice/profile
> Switch to testnet backend
> List all items under mutable://accounts/
```

## Requirements

- [Deno](https://deno.land) runtime (for MCP server)
- Claude Code CLI

## Links

- [B3nd SDK Documentation](https://github.com/bandeira-tech/b3nd)
- [NPM Package](https://www.npmjs.com/package/@bandeira-tech/b3nd-web)
- [JSR Package](https://jsr.io/@bandeira-tech/b3nd-sdk)
