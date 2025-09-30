# b3nd Full Stack - Quick Start

## 🚀 One-Command Start

```bash
./start.sh
```

## 📦 What Gets Started

- **Explorer UI**: http://localhost:3000 (Web interface with HMR)
- **HTTP API**: http://localhost:8000 (REST API with auto-reload)
- **WS Server**: ws://localhost:8001 (Persistence with auto-reload)

## 🔥 Live Development

**Edit code locally → Changes reload automatically!**

```bash
# Edit any file in your favorite editor
vim ../../../httpapi/src/routes.ts
vim ../../../wsserver/src/server.ts
vim ../../../explorer/app/src/App.tsx

# Watch logs to see auto-reload in action
make logs
```

No need to rebuild! All code is mounted as volumes with:
- ✅ Deno `--watch` for backend services
- ✅ Vite HMR for frontend
- ✅ Instant feedback on changes

## 🛠️ Common Commands

```bash
# Using convenience script
./start.sh                    # Start everything

# Using Makefile
make up                       # Start all services
make down                     # Stop all services
make logs                     # View all logs
make health                   # Check service health
make restart                  # Restart all services
make clean                    # Stop and remove volumes

# Using compose directly
podman-compose up -d          # Start in background
podman-compose down           # Stop services
podman-compose logs -f        # Follow logs
podman-compose ps             # List services
```

## 📝 Try It Out

### Write Data
```bash
curl -X POST http://localhost:8000/api/v1/write/myapp/users/alice \
  -H "Content-Type: application/json" \
  -d '{"value": {"name": "Alice", "email": "alice@example.com"}}'
```

### Read Data
```bash
curl http://localhost:8000/api/v1/read/myapp/users/alice
```

### List Resources
```bash
curl http://localhost:8000/api/v1/list/myapp/users/
```

### Delete Data
```bash
curl -X DELETE http://localhost:8000/api/v1/delete/myapp/users/alice
```

## 🔧 Configuration

Copy and edit `.env` file:
```bash
cp .env.example .env
nano .env
```

Then restart:
```bash
make restart
```

## 🐛 Troubleshooting

### Ports Already in Use?
```bash
# Edit .env and change ports
echo "HTTP_PORT=9000" >> .env
echo "WS_PORT=9001" >> .env
echo "EXPLORER_PORT=3001" >> .env
make rebuild
```

### Services Not Starting?
```bash
make logs                     # Check all logs
make logs-api                 # Check API logs only
make logs-ws                  # Check WS server logs
```

### Container Issues?
```bash
make clean                    # Remove everything
make up                       # Start fresh
```

## 📚 More Info

- Full documentation: `README.md`
- Configuration options: `.env.example`
- Available commands: `make help`

## 🛑 Stop Everything

```bash
make down                     # Stop services
make clean                    # Stop and remove data
```