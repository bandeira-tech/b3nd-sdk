# Native Query Passthrough & Stored Queries

## Motivation

The portable DSL approach (WhereClause, orderBy, etc.) adds a translation layer
between the developer and the database. When someone runs a MongoDB node, they
already know MongoDB. When they run Postgres, they know SQL. The DSL:

- Caps what they can express (no aggregation pipelines, no CTEs, no $lookup)
- Adds cognitive overhead (learn a new query syntax)
- Can never keep up with backend-specific features

Instead: **be a thin channel**. The node has the connection; let the developer
talk to their database in its own language.

## Design: Two New Modes

The `query()` method gains two additional modes alongside the existing portable DSL.
The three modes are disambiguated by which fields are present:

```
┌─────────────────────────────────────────────────────────────┐
│ Mode 1: Portable DSL          { prefix, where, ... }        │
│ Mode 2: Native passthrough    { prefix, native }            │
│ Mode 3: Stored query          { ref, args? }                │
└─────────────────────────────────────────────────────────────┘
```

### Mode 2: Native Passthrough

Pass the backend's own query language through unchanged:

```typescript
// MongoDB — this IS a MongoDB query, zero translation
await client.query({
  prefix: "store://users",
  native: {
    filter: { age: { $gte: 18 }, "address.city": "NYC" },
    sort: { age: -1 },
    projection: { name: 1, email: 1 },
    limit: 10,
  },
});

// PostgreSQL — parameterized SQL, the node adds prefix scoping
await client.query({
  prefix: "store://users",
  native: {
    sql: "data->>'role' = $1 AND (data->>'age')::int > $2",
    params: ["admin", 25],
    orderBy: "data->>'name' ASC",
    limit: 10,
  },
});
```

**What the node does:**
1. Receives the native blob
2. Enforces `prefix` scoping (always ANDs a URI prefix filter — cannot escape scope)
3. Passes the rest straight to the backend's executor
4. Returns records in the standard QueryResult shape

**Security model:**
- `prefix` is required — you can't query outside your namespace
- Postgres queries are WHERE-clause fragments, not full SQL — the node builds
  the full query, preventing DROP TABLE etc.
- The node operator chose this backend; they accept what it can do
- For shared/multi-tenant nodes, stored queries (Mode 3) provide governance

### Mode 3: Stored Queries

A stored query is just a b3nd record. The node operator stores query templates
at well-known URIs. App developers execute them by reference:

```typescript
// Step 1: Node operator defines a stored query (this is just a receive)
await node.receive(["mutable://queries/users-by-city", {
  description: "Find active users in a given city",
  prefix: "store://users",
  native: {
    filter: { "address.city": "$city", active: true },
    sort: { name: 1 },
  },
  params: {
    city: { type: "string", required: true },
  },
}]);

// Step 2: App developer executes it — no need to know the backend
const result = await client.query({
  ref: "mutable://queries/users-by-city",
  args: { city: "NYC" },
});
```

**What the node does:**
1. Reads the stored query from its own storage (it's just a `read()`)
2. Validates that all required params are provided
3. Substitutes `$paramName` placeholders in the native query with actual values
4. Executes the resolved native query
5. Returns records in the standard QueryResult shape

**Why this is powerful:**
- The query definition IS a b3nd record — versioned, replicated, validated
- The node operator controls what queries exist (governance)
- Parameters are bounded and explicit (no injection)
- App developers don't need to know backend specifics — just the query name
- Queries can be updated live without redeploying the app
- Query definitions are composable with the existing b3nd ecosystem

### Parameter Substitution

Simple recursive string replacement in the native query object:

```
$city in { "address.city": "$city" }
         becomes
         { "address.city": "NYC" }
```

Values that are strings get substituted literally. Values that are numbers/booleans
get substituted as their native types. This happens on the final resolved object
before it's passed to the executor.

## Why Not Just Raw SQL?

For Postgres, we don't allow full SQL statements. The developer provides a
WHERE-clause fragment and the node wraps it:

```sql
-- Node builds this from the native passthrough:
SELECT uri, data, timestamp as ts
FROM {table}
WHERE uri LIKE '{prefix}%'
  AND ({native.sql})           -- developer's WHERE fragment
ORDER BY {native.orderBy}
LIMIT {native.limit} OFFSET {native.offset}
```

This means:
- No `DROP TABLE`, `DELETE`, `UPDATE` — only SELECT
- No subqueries against other tables (unless the prefix filter is bypassed, which it can't be)
- Parameters are still parameterized (`$1`, `$2`)

## Transport

Same as before — HTTP and WebSocket just pass the JSON through:
- `POST /api/v1/query` with `{ prefix, native }` or `{ ref, args }`
- WS message type `"query"` with same payload

No transport changes needed — the body is already forwarded as-is.
