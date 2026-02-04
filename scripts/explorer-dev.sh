#!/bin/bash
# B3nd Development Environment Launcher
# Usage: ./dev.sh [--with-postgres] [--full]
#
# By default, starts a minimal setup:
# - HTTP API Server (port 9942) - B3nd data backend (memory)
# - Dashboard Server (port 5556) - Dev dashboard backend
# - Frontend (port 5555) - React app
#
# Options:
#   --with-postgres  Use PostgreSQL instead of memory backend
#   --full           Also start Wallet Server + App Server (requires .env setup)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
WITH_POSTGRES=false
FULL=false
for arg in "$@"; do
  case $arg in
    --with-postgres) WITH_POSTGRES=true ;;
    --full) FULL=true ;;
    --minimal) ;; # Backwards compat, now default
  esac
done

# Cleanup function
cleanup() {
  echo -e "\n${YELLOW}Shutting down services...${NC}"
  kill $(jobs -p) 2>/dev/null || true
  if $WITH_POSTGRES; then
    echo -e "${YELLOW}Stopping Docker containers...${NC}"
    docker compose -f "$ROOT_DIR/apps/docker-compose.dev.yml" down 2>/dev/null || true
  fi
  exit 0
}
trap cleanup SIGINT SIGTERM

# Print header
echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     B3nd Development Environment           ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# Start PostgreSQL if requested
if $WITH_POSTGRES; then
  echo -e "${GREEN}▶ Starting PostgreSQL...${NC}"
  docker compose -f "$ROOT_DIR/apps/docker-compose.dev.yml" up -d postgres
  echo -e "  Waiting for PostgreSQL to be ready..."
  sleep 3
  BACKEND_URL="postgresql://b3nd:b3nd@localhost:5432/b3nd"
else
  BACKEND_URL="memory://"
fi

# Create temp env files for services
HTTP_ENV=$(mktemp)
cat > "$HTTP_ENV" << EOF
BACKEND_URL=$BACKEND_URL
SCHEMA_MODULE=./example-schema.ts
PORT=9942
CORS_ORIGIN=*
EOF

WALLET_ENV=$(mktemp)
cat > "$WALLET_ENV" << EOF
PORT=9943
CREDENTIAL_NODE_URL=http://localhost:9942
PROXY_NODE_URL=http://localhost:9942
JWT_SECRET=dev-secret-key-for-local-testing-only-32chars
JWT_EXPIRATION_SECONDS=86400
ALLOWED_ORIGINS=http://localhost:5555,http://localhost:3000
EOF

APP_ENV=$(mktemp)
cat > "$APP_ENV" << EOF
PORT=9944
DATA_NODE_URL=http://localhost:9942
EOF

echo -e "${GREEN}▶ Starting HTTP API Server (port 9942)...${NC}"
echo -e "  Backend: $BACKEND_URL"
(cd "$ROOT_DIR/apps/b3nd-node" && \
  BACKEND_URL="$BACKEND_URL" \
  SCHEMA_MODULE=./example-schema.ts \
  PORT=9942 \
  CORS_ORIGIN="*" \
  deno run --watch -A mod.ts 2>&1 | sed 's/^/  [http] /') &
sleep 2

if $FULL; then
  # Check if wallet-server has .env with keys
  if [ ! -f "$ROOT_DIR/apps/wallet-node/.env" ]; then
    echo -e "${YELLOW}⚠ Wallet server .env not found. Skipping wallet & app servers.${NC}"
    echo -e "  Run: cd apps/wallet-node && deno run -A scripts/generate-keys.ts"
    FULL=false
  else
    echo -e "${GREEN}▶ Starting Wallet Server (port 9943)...${NC}"
    (cd "$ROOT_DIR/apps/wallet-node" && \
      PORT=9943 \
      CREDENTIAL_NODE_URL=http://localhost:9942 \
      PROXY_NODE_URL=http://localhost:9942 \
      deno run --watch -A --env-file src/mod.ts 2>&1 | sed 's/^/  [wallet] /') &
    sleep 1

    echo -e "${GREEN}▶ Starting App Server (port 9944)...${NC}"
    (cd "$ROOT_DIR/apps/apps-node" && \
      PORT=9944 \
      DATA_NODE_URL=http://localhost:9942 \
      deno run --watch -A --env-file src/mod.ts 2>&1 | sed 's/^/  [app] /') &
    sleep 1
  fi
fi

echo -e "${GREEN}▶ Starting Dashboard Server (port 5556)...${NC}"
(cd "$ROOT_DIR/apps/sdk-inspector" && \
  DASHBOARD_PORT=5556 \
  CORS_ORIGIN="http://localhost:5555" \
  deno run --watch -A mod.ts 2>&1 | sed 's/^/  [dashboard] /') &
sleep 1

echo -e "${GREEN}▶ Starting Frontend (port 5555)...${NC}"
(cd "$ROOT_DIR/apps/b3nd-web-rig" && npm run dev 2>&1 | sed 's/^/  [frontend] /') &

echo ""
echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  All services started!                     ║${NC}"
echo -e "${BLUE}╠════════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║  ${NC}Frontend:   ${GREEN}http://localhost:5555${NC}         ${BLUE}║${NC}"
echo -e "${BLUE}║  ${NC}Dashboard:  ${GREEN}http://localhost:5555/dashboard${NC}${BLUE}║${NC}"
echo -e "${BLUE}║  ${NC}HTTP API:   ${GREEN}http://localhost:9942${NC}         ${BLUE}║${NC}"
if $FULL; then
echo -e "${BLUE}║  ${NC}Wallet:     ${GREEN}http://localhost:9943${NC}         ${BLUE}║${NC}"
echo -e "${BLUE}║  ${NC}App Server: ${GREEN}http://localhost:9944${NC}         ${BLUE}║${NC}"
fi
echo -e "${BLUE}╠════════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║  ${NC}Press ${YELLOW}Ctrl+C${NC} to stop all services       ${BLUE}║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo ""

# Wait for all background jobs
wait
