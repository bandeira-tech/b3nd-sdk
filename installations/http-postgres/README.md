HTTP + Postgres Node (Example)
==============================

An example HTTP server node backed by PostgreSQL using the SDK’s Hono server and Postgres client.

Config via environment variables:
- `DATABASE_URL` (required): PostgreSQL connection string.
- `SCHEMA_MODULE` (required): Path or URL to a module exporting a default Schema object.

Run locally
- deno run -A installations/http-postgres-node/mod.ts

Env example:
- export DATABASE_URL="postgresql://user:password@localhost:5432/appdb"
- export SCHEMA_MODULE="./installations/http-postgres-node/example-schema.ts"

Docker
- Build: docker build -t b3nd-http-postgres -f installations/http-postgres-node/Dockerfile .
- Run: docker run -p 8080:8080 \
    -e DATABASE_URL=postgresql://user:password@host.docker.internal:5432/appdb \
    -e SCHEMA_MODULE=/app/installations/http-postgres-node/example-schema.ts \
    b3nd-http-postgres

Routes
- POST /api/v1/write/:protocol/:domain/*
- GET  /api/v1/read/:protocol/:domain/*
- GET  /api/v1/list/:protocol/:domain/*
- DELETE /api/v1/delete/:protocol/:domain/*
- GET  /api/v1/health
- GET  /api/v1/schema

