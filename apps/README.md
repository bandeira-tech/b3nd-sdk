# B3nd Explorer & Dashboard

Developer tools for the B3nd monorepo:

- **Explorer App** - React UI for browsing B3nd data (port 5555)
- **Dashboard** - Real-time test runner and monitoring (port 5556)

## Quick Start

```bash
# One command to start everything
cd explorer
./dev.sh
```

This starts:

- HTTP API Server (port 9942) - Memory backend
- Dashboard Server (port 5556) - WebSocket + test runner
- Frontend (port 5555) - React app with Vite

Open http://localhost:5555/dashboard to see the developer dashboard.

## Commands

```bash
# Minimal setup (default) - HTTP API + Dashboard + Frontend
make dev

# Full setup with Wallet + App servers (requires .env setup)
make dev-full

# With PostgreSQL instead of memory backend
make dev-postgres
```

## Architecture

```
┌─────────────────┐    HTTP     ┌──────────────────┐
│  React Frontend │◄───────────►│  HTTP API Server │
│  (Vite:5555)    │             │  (:9942)         │
└────────┬────────┘             └──────────────────┘
         │
         │ WebSocket
         ▼
┌──────────────────┐
│  Dashboard Server│──► Spawns deno test
│  (:5556)         │──► Watches file changes
└──────────────────┘──► Monitors service health
```

## Dashboard Features

- **Test Runner**: Run SDK tests with streaming results
- **Theme Classification**: Tests grouped by category (SDK Core, Network,
  Database, etc.)
- **File Watcher**: Auto-detects changes in sdk/src and sdk/tests
- **Health Monitor**: Shows status of all B3nd services
- **Educational Content**: Per-theme documentation and code examples

## File Structure

```
explorer/
├── app/                    # React frontend (Vite)
│   └── src/
│       ├── components/
│       │   └── dashboard/  # Dashboard UI components
│       └── ...
├── dashboard/              # Deno backend for dashboard
│   ├── mod.ts              # Hono server entry
│   ├── services/           # Test runner, file watcher, health monitor
│   ├── routes/             # HTTP + WebSocket routes
│   └── utils/              # Test parser, theme classifier
├── dev.sh                  # One-line dev environment launcher
├── docker-compose.yml      # PostgreSQL (optional)
└── Makefile                # Convenience commands
```

## Development

### Frontend only

```bash
cd app && npm run dev
```

### Dashboard backend only

```bash
cd dashboard && deno task dev
```

### With PostgreSQL

```bash
docker compose up -d postgres
./dev.sh --with-postgres
```

## WebSocket Protocol

The dashboard uses WebSocket for real-time updates:

```typescript
// Server → Client
{ type: "test:start", runId, filter }
{ type: "test:result", test: { name, file, status, duration, error? } }
{ type: "test:complete", summary: { passed, failed, skipped, duration } }
{ type: "health:update", services: [...] }
{ type: "file:change", files: [...] }
```
