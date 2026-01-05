# B3nd SDK

Universal persistence protocol for building applications with URI-based data addressing.

## Build with Claude Code

Install the B3nd plugin to get AI-assisted development with full SDK knowledge:

```bash
claude plugin marketplace add https://github.com/bandeira-tech/b3nd
claude plugin install b3nd
```

Then just ask Claude naturally:
- "Create a B3nd HTTP client for my React app"
- "Set up a multi-backend server with Postgres"
- "Add wallet authentication to my app"

### What's Included

| Skill | What Claude Learns |
|-------|-------------------|
| **b3nd-general** | Core architecture, URI schemes, interfaces |
| **b3nd-sdk** | Deno/JSR package for servers |
| **b3nd-web** | NPM package for browsers |
| **b3nd-webapp** | React/Vite patterns |
| **b3nd-denocli** | Deno CLI and server patterns |

Plus MCP tools for direct data operations: `b3nd_read`, `b3nd_write`, `b3nd_list`, `b3nd_backends_switch`

---

## Packages

| Package | Registry | Use Case |
|---------|----------|----------|
| [@bandeira-tech/b3nd-sdk](https://jsr.io/@bandeira-tech/b3nd-sdk) | JSR | Deno, servers |
| [@bandeira-tech/b3nd-web](https://www.npmjs.com/package/@bandeira-tech/b3nd-web) | NPM | Browser, React |

```typescript
// Deno/Server
import { HttpClient, MemoryClient } from "@bandeira-tech/b3nd-sdk";

// Browser/React
import { HttpClient, WalletClient } from "@bandeira-tech/b3nd-web";
```

## Quick Example

```typescript
const client = new HttpClient({ url: "http://localhost:8842" });

// Write
await client.write("mutable://users/alice/profile", { name: "Alice" });

// Read
const result = await client.read("mutable://users/alice/profile");

// List
const items = await client.list("mutable://users/");
```

---

## Server Deployment

### Docker with PostgreSQL

```bash
cd installations/http-server
docker-compose up -d
```

### Deno

```bash
cd installations/http-server
deno task start
```

See [installations/](./installations/) for more deployment options.
