HTTP + MongoDB Node (Example)
==============================

An example HTTP server node backed by MongoDB using the SDK’s Hono server and Mongo client.

Config via environment variables:
- `MONGODB_URL` (required): MongoDB connection string.
- `MONGODB_DB` (required): MongoDB database name.
- `MONGODB_COLLECTION` (required): MongoDB collection name for b3nd data.
- `SCHEMA_MODULE` (required): Path or URL to a module exporting a default Schema object.

Run locally
- `cd installations/http-mongo`
- `MONGODB_URL="mongodb://localhost:27017/appdb" \\`
  `MONGODB_DB="appdb" \\`
  `MONGODB_COLLECTION="b3nd_data" \\`
  `SCHEMA_MODULE="../../installations/http-mongo/example-schema.ts" \\`
  `deno task dev`

Docker
- Build:
  - `docker build -t b3nd-http-mongo -f installations/http-mongo/Dockerfile .`
- Run:
  - `docker run -p 8080:8080 \\`
    `-e MONGODB_URL="mongodb://user:password@host.docker.internal:27017/appdb" \\`
    `-e MONGODB_DB="appdb" \\`
    `-e MONGODB_COLLECTION="b3nd_data" \\`
    `-e SCHEMA_MODULE="/app/installations/http-mongo/example-schema.ts" \\`
    `b3nd-http-mongo`

Routes
- `POST   /api/v1/write/:protocol/:domain/*`
- `GET    /api/v1/read/:protocol/:domain/*`
- `GET    /api/v1/list/:protocol/:domain/*`
- `DELETE /api/v1/delete/:protocol/:domain/*`
- `GET    /api/v1/health`
- `GET    /api/v1/schema`
