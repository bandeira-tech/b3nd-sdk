b3nd/httpapi supports the direct http interface between clients and a b3nd/persistence setup

it enables both reading and writing to a target persistence instance gated by the api server

it's a deno app using hono and supports multiple websites calling cross domain

while it allows extensibility for hardened access control via hono for example, the server does not include any access control out of the box as it is intended both as development tool and educational material

b3nd/httpapi provides an easy api to create servers

```
import { http } from 'bend-httpapi-package'

const myschema = {...} // schemas as they are right now

const postgresClient = createPostgresClient(env.DB_URL)
const mongoClient = createMongoClient(env.MONGO_URL)

http.createNode({
  backend: createMultiplexedBackend({
    consume: createRoundRobinClient([ postgresClient, mongoClient ]),
    produce: createBroadcastList([ mongoClien, postgresClient ])
  }),
  schema: myschema // but at the server level
})

createServerNode({
  frontend: httpServer(),
  backend: { 
    write: parallel([ memoryClient({ slots: 100_000 }), postgresClient(dbUrl), ...peers.map(p => httpClient(p.url))),
    read: firstMatch()
  }
})
```

## Quick Start

### Docker Installation (Recommended)

The easiest way to get started is using one of the pre-configured Docker installations:

**PostgreSQL Setup (Production-ready):**
```bash
cd installations/postgres
docker-compose up -d
```

This provides a complete setup with PostgreSQL persistence, health checks, and easy configuration through environment variables.

### Manual Setup

For custom deployments, you can run the HTTP API directly with Deno:

```bash
cd httpapi
deno run --allow-net --allow-read --allow-write --allow-env src/server.ts
```

See individual installation directories in `installations/` for specific backend configurations and deployment options.
