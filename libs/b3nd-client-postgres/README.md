# Postgres Store

`PostgresStore` is a `Store` implementation that persists b3nd records in
PostgreSQL. It ships with a co-located schema generator.

`PostgresStore` is pure mechanical storage with no protocol awareness. Wrap it
with `MessageDataClient` (envelope semantics — decompose inputs/outputs) or
`SimpleClient` (raw storage, no protocol logic) to get a full
`NodeProtocolInterface`.

## Initialization

1. Generate schema SQL with a custom table prefix using
   `generatePostgresSchema(tablePrefix)`.
2. Execute the returned SQL against your database before first use.
3. Provide a `SqlExecutor` that bridges your Postgres driver to the store.

## Example (Deno)

```ts
import {
  MessageDataClient,
  generatePostgresSchema,
  PostgresStore,
} from "@bandeira-tech/b3nd-sdk";
import type { SqlExecutor } from "@bandeira-tech/b3nd-sdk/libs/b3nd-client-postgres/mod.ts";

// 1) Produce SQL and apply it with your preferred DB tool
const sql = generatePostgresSchema("b3nd");
// ... run `sql` against your database using your own driver

// 2) Create a SqlExecutor that wraps your Postgres driver
const executor: SqlExecutor = {
  query: async (sql, args) => {
    // delegate to your driver (e.g. postgres.js, pg, deno-postgres)
    const rows = await myPool.query(sql, args);
    return { rows };
  },
  transaction: async (fn) => {
    // delegate to your driver's transaction support
    return await myPool.transaction((tx) => fn({ query: tx.query, transaction: tx.transaction }));
  },
};

// 3) Create the store and wrap it with a protocol client
const store = new PostgresStore("b3nd", executor);
const client = new MessageDataClient(store);

// Protocol-aware: decomposes envelopes, deletes inputs, writes outputs
await client.receive([
  ["mutable://users/alice", {}, { name: "Alice" }],
]);

const results = await client.read("mutable://users/alice");
console.log(results[0]?.record?.data); // { name: "Alice" }
```

For raw storage without Firecat envelope handling, use `SimpleClient` instead:

```ts
import { SimpleClient, PostgresStore } from "@bandeira-tech/b3nd-sdk";

const store = new PostgresStore("b3nd", executor);
const client = new SimpleClient(store);
```

## Notes

- `PostgresStore` requires an injected `SqlExecutor`, keeping the SDK decoupled
  from any specific PostgreSQL driver.
- No environment variables are read. Pass all values explicitly.
- No defaults are applied; all required fields must be provided by callers.
- Errors are not suppressed; callers must handle and decide how to respond.
