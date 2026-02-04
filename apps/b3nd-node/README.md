# Multi-Backend HTTP Node

An HTTP server node that composes multiple backends (Memory, PostgreSQL,
MongoDB) based on a comma-separated `BACKEND_URL` env var loaded from a `.env`
file. Uses the SDK’s Hono-based HTTP frontend and NodeProtocol clients.

## Configuration

Copy `.env.example` to `.env` in `installations/node` and set these required
variables:

- `BACKEND_URL` (required): Comma-separated list of backend specs. Each entry
  can be:
  - `memory://` — in-memory backend using `MemoryClient`.
  - `postgres://...` — PostgreSQL connection string (e.g.
    `postgres://user:pass@host:5432/db`).
  - `mongodb://...` — MongoDB connection string with database in the path,
    optional `collection` in query:
    - Example: `mongodb://user:pass@host:27017/appdb?collection=b3nd_data`.

- `SCHEMA_MODULE` (required): Path or URL to a module exporting a default
  `Schema` object.

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

Supported backend specs:

- Memory:
  - `memory://`
- PostgreSQL:
  - `postgres://user:password@host:5432/database`
  - Uses the same Postgres executor as `installations/http-postgres`.
  - Table prefix is fixed to `b3nd` (table `b3nd_data`), like the Postgres HTTP
    node.
- MongoDB:
  - `mongodb://user:password@host:27017/database?collection=b3nd_data`
  - Database is taken from the URL path.
  - Collection defaults to `b3nd_data` if `collection` is not provided.

## Run locally

From the repo root:

```sh
cd installations/node

cp .env.example .env
# edit .env to match your backends and schema
deno task dev
```

## Docker

You can build a Docker image using a Dockerfile similar to the HTTP
Postgres/Mongo installations, pointing to `installations/node/mod.ts` and
providing `BACKEND_URL` plus any DB connection strings as environment variables.

## Routes

Same as other HTTP nodes:

- `POST   /api/v1/write/:protocol/:domain/*`
- `GET    /api/v1/read/:protocol/:domain/*`
- `GET    /api/v1/list/:protocol/:domain/*`
- `DELETE /api/v1/delete/:protocol/:domain/*`
- `GET    /api/v1/health`
- `GET    /api/v1/schema`
