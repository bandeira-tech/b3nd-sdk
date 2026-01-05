---
name: b3nd-denocli
description: Building Deno CLI tools, scripts, and servers with B3nd SDK. Use when writing Deno applications, CLI utilities, or server-side B3nd integrations.
---

# B3nd Deno CLI & Server Development

Patterns for building Deno CLI tools, scripts, and servers with B3nd.

## Project Setup

### deno.json

```json
{
  "name": "@myorg/my-cli",
  "version": "0.1.0",
  "exports": {
    ".": "./mod.ts"
  },
  "imports": {
    "@bandeira-tech/b3nd-sdk": "jsr:@bandeira-tech/b3nd-sdk",
    "@std/assert": "jsr:@std/assert@^1.0.15"
  },
  "tasks": {
    "start": "deno run -A mod.ts",
    "test": "deno test -A tests/",
    "lint": "deno lint",
    "fmt": "deno fmt"
  },
  "compilerOptions": {
    "strict": true,
    "lib": ["ES2020", "deno.ns"]
  }
}
```

## CLI Script Pattern

### Basic CLI with MemoryClient

```typescript
#!/usr/bin/env -S deno run -A
/// <reference lib="deno.ns" />

import { MemoryClient } from "@bandeira-tech/b3nd-sdk";

const schema = {
  "data://": async () => ({ valid: true }),
};

const client = new MemoryClient({ schema });

async function main() {
  const args = Deno.args;
  const command = args[0];

  switch (command) {
    case "write": {
      const uri = args[1];
      const data = JSON.parse(args[2]);
      const result = await client.write(uri, data);
      console.log(result.success ? "Written" : `Error: ${result.error}`);
      break;
    }
    case "read": {
      const uri = args[1];
      const result = await client.read(uri);
      if (result.success) {
        console.log(JSON.stringify(result.record?.data, null, 2));
      } else {
        console.error(result.error);
      }
      break;
    }
    default:
      console.log("Usage: cli.ts <write|read> <uri> [data]");
  }
}

main();
```

### CLI with HTTP Backend

```typescript
#!/usr/bin/env -S deno run -A
import { HttpClient } from "@bandeira-tech/b3nd-sdk";

const BACKEND_URL = Deno.env.get("BACKEND_URL") || "http://localhost:9942";
const client = new HttpClient({ url: BACKEND_URL });

async function main() {
  // Check health
  const health = await client.health();
  console.log(`Backend status: ${health.status}`);

  // Get schema
  const schema = await client.getSchema();
  console.log("Available protocols:", schema);

  // List items
  const list = await client.list("mutable://", { limit: 10 });
  if (list.success) {
    console.log("Items:", list.data);
  }
}

main();
```

## HTTP Server Pattern

```typescript
/// <reference lib="deno.ns" />
import {
  createServerNode,
  MemoryClient,
  servers,
  parallelBroadcast,
  firstMatchSequence,
  PostgresClient,
} from "@bandeira-tech/b3nd-sdk";
import { Hono } from "hono";
import { cors } from "hono/cors";

const PORT = Number(Deno.env.get("PORT") || "43100");
const CORS_ORIGIN = Deno.env.get("CORS_ORIGIN") || "*";

const schema = {
  "mutable://users": async ({ value }) => {
    if (!value || typeof value !== "object") {
      return { valid: false, error: "Invalid user data" };
    }
    return { valid: true };
  },
  "mutable://data": async () => ({ valid: true }),
};

// Single backend
const backend = new MemoryClient({ schema });

// Or multi-backend composition
// const clients = [new MemoryClient({ schema }), postgresClient];
// const writeBackend = parallelBroadcast(clients);
// const readBackend = firstMatchSequence(clients);
// const backend = { write: writeBackend, read: readBackend };

const app = new Hono();
app.use("/*", cors({ origin: CORS_ORIGIN }));

const frontend = servers.httpServer(app);
const node = createServerNode({ frontend, backend, schema });
node.listen(PORT);

console.log(`Server running on port ${PORT}`);
```

## Testing Pattern

```typescript
// tests/my-feature.test.ts
import { assertEquals } from "@std/assert";
import { MemoryClient } from "@bandeira-tech/b3nd-sdk";

Deno.test("write and read data", async () => {
  const client = new MemoryClient({
    schema: {
      "test://data": async () => ({ valid: true }),
    },
  });

  const writeResult = await client.write("test://data/item1", { name: "Test" });
  assertEquals(writeResult.success, true);

  const readResult = await client.read("test://data/item1");
  assertEquals(readResult.success, true);
  assertEquals(readResult.record?.data, { name: "Test" });

  await client.cleanup();
});

Deno.test("validation error", async () => {
  const client = new MemoryClient({
    schema: {
      "test://strict": async ({ value }) => {
        const v = value as any;
        if (!v.required) return { valid: false, error: "Missing required field" };
        return { valid: true };
      },
    },
  });

  const result = await client.write("test://strict/item", { other: "value" });
  assertEquals(result.success, false);
  assertEquals(result.error, "Missing required field");
});
```

## Environment Variables

```bash
# .env
PORT=43100
CORS_ORIGIN=*
BACKEND_URL=postgres://user:pass@localhost:5432/db
SCHEMA_MODULE=./schema.ts
```

Load with:

```typescript
import "https://deno.land/std/dotenv/load.ts";
// or
const port = Deno.env.get("PORT");
```

## Schema Module Pattern

```typescript
// schema.ts
import type { Schema } from "@bandeira-tech/b3nd-sdk";

const schema: Schema = {
  "mutable://users": async ({ uri, value, read }) => {
    const v = value as any;
    if (!v.email) return { valid: false, error: "Email required" };
    return { valid: true };
  },

  "mutable://posts": async ({ uri, value, read }) => {
    const v = value as any;
    if (!v.authorId) return { valid: false, error: "Author required" };

    // Cross-reference validation
    const author = await read(`mutable://users/${v.authorId}`);
    if (!author.success) return { valid: false, error: "Author not found" };

    return { valid: true };
  },
};

export default schema;
```

## Makefile Commands

```makefile
.PHONY: test start

test:
ifdef t
	@deno test --allow-all $(t)
else
	@deno test --allow-all tests/
endif

start:
	@deno run -A mod.ts

dev:
	@deno run --watch -A mod.ts
```

## Running

```bash
# Run script
deno run -A cli.ts write "data://items/1" '{"name":"test"}'

# Run server
deno task start

# Run tests
deno task test
# or
make test
make test t=tests/specific.test.ts
```

## Key Files Reference

- `sdk/tests/memory-client.test.ts` - Test patterns
- `sdk/tests/shared-suite.ts` - Shared test suite
- `installations/http-server/mod.ts` - Full HTTP server example
- `installations/wallet-server/src/mod.ts` - Wallet server example
- `sdk/Makefile` - Common development commands
