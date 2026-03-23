# Multi-Backend HTTP Node

An HTTP server node that composes multiple backends (Memory, PostgreSQL,
MongoDB, SQLite, Filesystem) based on a comma-separated `BACKEND_URL` env var.
Uses the SDK's Rig harness and Hono-based HTTP frontend.

## Configuration

Set these required environment variables (or use a `.env` file):

- `BACKEND_URL` (required): Comma-separated list of backend specs. Each entry
  can be:
  - `memory://` — in-memory backend using `MemoryClient`.
  - `postgres://...` — PostgreSQL connection string (e.g.
    `postgres://user:pass@host:5432/db`).
  - `mongodb://...` — MongoDB connection string with database in the path
    (e.g. `mongodb://user:pass@host:27017/appdb`).
  - `sqlite://path/to/db.sqlite` — SQLite file-based database. Use
    `sqlite://:memory:` for an in-memory SQLite instance.
  - `file:///path/to/root` — Filesystem backend storing each record as a
    JSON file under the given root directory.

- `SCHEMA_MODULE` (optional): Path or URL to a module exporting a default
  `Schema` object. Defaults to the Firecat protocol schema.

- `PORT` (required): HTTP port to listen on.
- `CORS_ORIGIN` (required): CORS origin for the HTTP API (use `*` to allow all
  origins).

## Behavior

- All configured backends share the same `Schema` (validation rules).
- Writes:
  - Broadcast to **all** backends using the `parallelBroadcast` combinator.
  - If any backend rejects the write, the error bubbles up.
- Reads / Lists / Deletes:
  - Tried in BACKEND_URL order using the `firstMatchSequence` combinator.
  - The first backend that returns a successful result wins.

## Supported backends

| Protocol | Client | Notes |
|----------|--------|-------|
| `memory://` | MemoryClient | In-memory, no persistence across restarts |
| `postgres://` | PostgresClient | JSONB storage, table prefix `b3nd` |
| `mongodb://` | MongoClient | Collection `b3nd_data`, DB from URL path |
| `sqlite://` | SqliteClient | WAL mode, file or `:memory:` |
| `file://` | FilesystemClient | One JSON file per record, recursive dirs |

## Quick start

From the repo root:

```sh
# Memory (no dependencies)
make node

# SQLite (creates .data/sqlite/b3nd.db)
make node-sqlite

# Filesystem (creates .data/fs/)
make node-fs

# PostgreSQL (requires docker-compose dev profile)
make up p=dev
make dev

# Custom backend combination
cd apps/b3nd-node
BACKEND_URL="sqlite://./data.db,memory://" PORT=9942 CORS_ORIGIN="*" \
  deno run -A mod.ts
```

## Docker

Build a Docker image:

```sh
make pkg target=b3nd-node
```

Run with environment variables for your backends:

```sh
docker run -e BACKEND_URL=memory:// -e PORT=9942 -e CORS_ORIGIN="*" \
  ghcr.io/bandeira-tech/b3nd/b3nd-node:latest
```

## Routes

- `POST   /api/v1/receive`
- `GET    /api/v1/read/:protocol/:domain/*`
- `GET    /api/v1/list/:protocol/:domain/*`
- `DELETE /api/v1/delete/:protocol/:domain/*`
- `GET    /api/v1/health`
- `GET    /api/v1/schema`
