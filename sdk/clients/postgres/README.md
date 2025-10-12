Postgres Client
===============

This client persists b3nd records in PostgreSQL and ships with a co-located schema generator.

Initialization
- Generate schema SQL with a custom table prefix using `generatePostgresSchema(tablePrefix)` from `sdk/clients/postgres/schema.ts`.
- Execute the returned SQL against your database before first use.

Example (Deno)
```
import { PostgresClient } from "@b3nd/sdk";
import { generatePostgresSchema } from "@b3nd/sdk/clients/postgres/schema.ts";

// 1) Produce SQL and apply it with your preferred DB tool
const sql = generatePostgresSchema("b3nd");
// ... run `sql` using your own connection/client

// 2) Create client with explicit, validated configuration
const client = new PostgresClient({
  connection: "postgresql://user:password@localhost:5432/mydb",
  tablePrefix: "b3nd",
  schema: {
    "users://": async ({ value }) => ({ valid: typeof value === "object" }),
  },
  poolSize: 5,
  connectionTimeout: 10_000,
});

await client.initializeSchema(); // optional helper that executes the generated SQL using your wiring
```

Notes
- No environment variables are read by this client. Pass all values explicitly.
- No defaults are applied; all required fields must be provided by callers.
- Errors are not suppressed; callers must handle and decide how to respond.

