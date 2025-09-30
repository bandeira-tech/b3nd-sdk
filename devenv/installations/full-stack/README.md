# b3nd Full Stack Installation

Complete deployment of b3nd stack with WebSocket server, HTTP API, and Explorer UI.

## Architecture

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   Explorer  │─────▶│   HTTP API  │─────▶│  WS Server  │
│  (Port 3000)│      │  (Port 8000)│      │ (Port 8001) │
│  React App  │      │  Hono REST  │      │ Persistence │
│  + Vite HMR │      │  + Watch    │      │ + Watch     │
└─────────────┘      └─────────────┘      └─────────────┘
      ▲                     ▲                     ▲
      │                     │                     │
   Live Reload          Live Reload          Live Reload
```

**🔥 Development Mode**: All source code is mounted as volumes with live reloading:
- **wsserver**: Deno `--watch` automatically restarts on file changes
- **httpapi**: Deno `--watch` automatically restarts on file changes
- **explorer**: Vite HMR (Hot Module Replacement) updates instantly

### Components

1. **wsserver** (Port 8001)
   - WebSocket server providing persistence backend
   - Direct access to b3nd/persistence layer
   - Schema-based validation support

2. **httpapi** (Port 8000)
   - HTTP REST API built with Hono
   - Connects to wsserver via WebSocket
   - Provides REST endpoints for CRUD operations

3. **explorer** (Port 3000)
   - React-based web UI
   - Built with Vite, React Router, TanStack Query
   - Served via nginx in production

## Prerequisites

- Podman (or Docker) and podman-compose (or docker-compose)
- For local development: Deno 2.x and Node.js 23+

## Quick Start

### Using Podman Compose (or Docker Compose)

1. **Clone and navigate to installation directory:**
   ```bash
   cd devenv/installations/full-stack
   ```

2. **Copy and customize environment file (optional):**
   ```bash
   cp .env.example .env
   # Edit .env to customize ports and configuration
   ```

3. **Build and start all services:**
   ```bash
   # Using podman-compose
   podman-compose up -d

   # Using docker-compose
   docker-compose up -d
   ```

4. **Access the services:**
   - Explorer UI: http://localhost:3000
   - HTTP API: http://localhost:8000
   - WebSocket Server: ws://localhost:8001

5. **View logs:**
   ```bash
   # All services
   podman-compose logs -f

   # Specific service
   podman-compose logs -f wsserver
   podman-compose logs -f httpapi
   podman-compose logs -f explorer
   ```

6. **Stop the stack:**
   ```bash
   podman-compose down

   # With volume cleanup
   podman-compose down -v
   ```

## Configuration

### Environment Variables

All services can be configured via environment variables. See `.env.example` for available options.

#### WebSocket Server

| Variable | Default | Description |
|----------|---------|-------------|
| `WS_PORT` | `8001` | WebSocket server port |
| `WS_HOSTNAME` | `0.0.0.0` | Bind hostname |
| `SCHEMA_PATH` | _(empty)_ | Path to schema module |

#### HTTP API

| Variable | Default | Description |
|----------|---------|-------------|
| `HTTP_PORT` | `8000` | HTTP server port |
| `HTTP_HOSTNAME` | `0.0.0.0` | Bind hostname |
| `WSSERVER_URL` | `ws://wsserver:8001` | WebSocket server URL |

#### Explorer

| Variable | Default | Description |
|----------|---------|-------------|
| `EXPLORER_PORT` | `3000` | Explorer UI port |
| `API_URL` | `http://localhost:8000` | HTTP API base URL |

## Custom Schema

To use a custom validation schema:

1. **Create your schema file** (e.g., `my-schema.ts`):
   ```typescript
   import { authValidation, createCombinedAccess } from "../auth/mod.ts";
   import type { Persistence } from "../persistence/mod.ts";

   export default {
     "myapp://example": authValidation(
       createCombinedAccess((uri) => {
         // Custom access control logic
         return Promise.resolve(["allowed-pubkey-hex"]);
       })
     ),
   };
   ```

2. **Mount and configure schema in compose.yaml:**
   ```yaml
   services:
     wsserver:
       volumes:
         - ./my-schema.ts:/app/schemas/custom.ts:ro
       environment:
         - SCHEMA_PATH=/app/schemas/custom.ts
   ```

## Development

### Live Reload Development

**Edit your code locally and see changes instantly!**

All source code is mounted as volumes, so you can edit files on your local machine:

```bash
# Edit any file in your editor
vim httpapi/src/routes.ts
vim wsserver/src/server.ts
vim explorer/app/src/App.tsx

# Changes are automatically detected and reloaded:
# - Deno services restart automatically with --watch
# - Vite updates instantly with HMR
# - No need to rebuild containers!
```

**Watch logs to see reload messages:**
```bash
make logs              # Watch all services
make logs-api          # Watch API reload messages
make logs-ws           # Watch WS server reload messages
```

### Running Locally Without Containers (Alternative)

If you prefer to run services directly on your machine:

1. **Start WebSocket Server:**
   ```bash
   cd wsserver
   deno task start
   # Or with schema:
   SCHEMA_PATH=../path/to/schema.ts deno task start
   ```

2. **Start HTTP API:**
   ```bash
   cd httpapi
   deno task start
   ```

3. **Start Explorer:**
   ```bash
   cd explorer/app
   npm install
   npm run dev
   ```

### Building Individual Services

```bash
# WebSocket Server
podman build -f Dockerfile.wsserver -t b3nd/wsserver:latest ../..

# HTTP API
podman build -f Dockerfile.httpapi -t b3nd/httpapi:latest ../..

# Explorer
podman build -f Dockerfile.explorer -t b3nd/explorer:latest ../..
```

## Health Checks

All services include health checks:

- **wsserver**: WebSocket connection test
- **httpapi**: `GET /api/v1/health`
- **explorer**: HTTP GET on root path

Check service health:
```bash
podman-compose ps
```

## Networking

All services run on the `b3nd-network` bridge network with service discovery:
- Services can communicate using service names (e.g., `http://httpapi:8000`)
- Ports are exposed to host for external access

## Volumes

Persistent data is stored in named volumes:

- `b3nd-httpapi-data`: HTTP API persistent data
- `b3nd-httpapi-config`: HTTP API configuration files

To backup volumes:
```bash
podman volume export b3nd-httpapi-data > backup.tar
```

## Troubleshooting

### Services won't start

1. Check port conflicts:
   ```bash
   lsof -i :8000
   lsof -i :8001
   lsof -i :3000
   ```

2. View service logs:
   ```bash
   podman-compose logs wsserver
   ```

### Explorer can't connect to API

1. Verify `API_URL` environment variable points to accessible HTTP API
2. Check CORS configuration if accessing from different origin
3. Verify httpapi is healthy: `curl http://localhost:8000/api/v1/health`

### WebSocket connection fails

1. Check wsserver is running: `podman-compose ps`
2. Verify network connectivity: `curl http://localhost:8001/health`
3. Review wsserver logs: `podman-compose logs wsserver`

## Production Considerations

1. **Use reverse proxy**: Place nginx or traefik in front for SSL termination
2. **Set resource limits**: Add memory and CPU limits to services
3. **Enable monitoring**: Add Prometheus/Grafana for metrics
4. **Backup volumes**: Regular backups of persistent data
5. **Security**: Configure authentication, use secrets for sensitive data
6. **Logging**: Configure centralized logging (e.g., ELK stack)

## API Examples

### Write data
```bash
curl -X POST http://localhost:8000/api/v1/write/myapp/example/test \
  -H "Content-Type: application/json" \
  -d '{"value": {"hello": "world"}}'
```

### Read data
```bash
curl http://localhost:8000/api/v1/read/myapp/example/test
```

### List resources
```bash
curl http://localhost:8000/api/v1/list/myapp/example/
```

### Delete data
```bash
curl -X DELETE http://localhost:8000/api/v1/delete/myapp/example/test
```

## License

See repository root LICENSE file.