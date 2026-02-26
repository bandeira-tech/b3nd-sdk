# Advanced Node Queries

## Problem

The current `NodeProtocolReadInterface` supports:

- `read(uri)` — exact lookup by URI
- `readMulti(uris)` — batch exact lookup
- `list(uri, options)` — prefix scan with basic URI pattern matching and pagination

This is insufficient for app developers who sponsor nodes backed by databases like
PostgreSQL or MongoDB. These backends have rich native query capabilities (field
filtering, range comparisons, aggregations, projections) that are completely
inaccessible through the current interface. The node already holds the database
connection — it should be able to service more complex reads directly instead of
forcing the app to `list` every URI and then `readMulti` to filter client-side.

## Design

Add a `query()` method as an optional extension to the read interface. The method
accepts a portable, JSON-serializable query descriptor that each backend translates
into its native form:

- **PostgresClient** — translates to parameterized SQL over the JSONB `data` column
- **MongoClient** — translates to native Mongo query operators over the `data` field
- **MemoryClient** — evaluates in-memory with JS filter/sort/project
- **HttpClient / WebSocketClient** — forwards the descriptor to the server

### Query Descriptor

```typescript
interface QueryOptions {
  // URI prefix to scope the query (same as list)
  prefix: string;

  // Filter by data field values
  where?: WhereClause;

  // Select specific fields (projection)
  select?: string[];

  // Sort by data fields
  orderBy?: Array<{ field: string; direction: "asc" | "desc" }>;

  // Pagination
  limit?: number;
  offset?: number;
}
```

### Where Clause (recursive)

```typescript
type WhereClause =
  | { field: string; op: "eq";         value: unknown }
  | { field: string; op: "neq";        value: unknown }
  | { field: string; op: "gt";         value: unknown }
  | { field: string; op: "gte";        value: unknown }
  | { field: string; op: "lt";         value: unknown }
  | { field: string; op: "lte";        value: unknown }
  | { field: string; op: "in";         value: unknown[] }
  | { field: string; op: "contains";   value: string }
  | { field: string; op: "startsWith"; value: string }
  | { field: string; op: "endsWith";   value: string }
  | { field: string; op: "exists";     value: boolean }
  | { and: WhereClause[] }
  | { or:  WhereClause[] }
  | { not: WhereClause };
```

### Query Result

```typescript
type QueryResult<T = unknown> =
  | {
      success: true;
      records: Array<{ uri: string; data: T; ts: number }>;
      total?: number;
    }
  | {
      success: false;
      error: string;
    };
```

### Backend Translation

| Where op     | Postgres (JSONB)                            | MongoDB                               | Memory (JS)                |
|-------------|---------------------------------------------|---------------------------------------|----------------------------|
| eq          | `data->>'field' = $N`                       | `{ "data.field": value }`             | `d.field === value`        |
| neq         | `data->>'field' != $N`                      | `{ "data.field": { $ne: val } }`     | `d.field !== value`        |
| gt/gte/lt/lte | `(data->>'field')::numeric > $N`          | `{ "data.field": { $gt: val } }`     | `d.field > value`          |
| in          | `data->>'field' = ANY($N)`                  | `{ "data.field": { $in: vals } }`    | `vals.includes(d.field)`   |
| contains    | `data->>'field' LIKE '%' \|\| $N \|\| '%'`  | `{ "data.field": /val/ }`            | `d.field.includes(value)`  |
| startsWith  | `data->>'field' LIKE $N \|\| '%'`           | `{ "data.field": /^val/ }`           | `d.field.startsWith(val)`  |
| exists      | `data ? 'field'`                            | `{ "data.field": { $exists: true } }`| `'field' in d`             |
| and         | `(... AND ...)`                             | `{ $and: [...] }`                     | `a && b`                   |
| or          | `(... OR ...)`                              | `{ $or: [...] }`                      | `a \|\| b`                 |
| not         | `NOT (...)`                                 | `{ $not: {...} }`                     | `!a`                       |

Nested field paths (e.g., `"address.city"`) are supported:
- Postgres: `data->'address'->>'city'`
- Mongo: `"data.address.city"`
- Memory: `record.data.address.city`

### Interface Placement

`query()` is added as an **optional** method on `NodeProtocolReadInterface`.
Clients that don't support it return `{ success: false, error: "query not supported" }`.
This preserves backward compatibility — no existing code breaks.

### Transport

- **HTTP**: `POST /api/v1/query` with JSON body `{ prefix, where, select, orderBy, limit, offset }`
- **WebSocket**: message type `"query"` with the same payload

### Combinators

- `parallelBroadcast`: delegates query to the first client (same as read/list)
- `firstMatchSequence`: tries each client until one returns a successful result

### Safety

- No raw SQL or raw Mongo queries are accepted — only the structured descriptor
- All values are parameterized (no string interpolation in SQL)
- `prefix` is required to scope the query to a URI namespace
- The query only reads data; it cannot modify state
