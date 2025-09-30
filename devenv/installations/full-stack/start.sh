#!/usr/bin/env bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  b3nd Full Stack Deployment${NC}"
echo -e "${BLUE}================================${NC}"
echo ""

# Check for container engine
if command -v podman &> /dev/null; then
    CONTAINER_ENGINE="podman"
    COMPOSE_CMD="podman compose"
elif command -v docker &> /dev/null; then
    CONTAINER_ENGINE="docker"
    COMPOSE_CMD="docker-compose"
else
    echo -e "${RED}Error: Neither podman nor docker is installed${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Using $CONTAINER_ENGINE"

# Check for compose command
if ! command -v $COMPOSE_CMD &> /dev/null; then
    echo -e "${RED}Error: $COMPOSE_CMD is not installed${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Using $COMPOSE_CMD"
echo ""

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    echo -e "${YELLOW}No .env file found, creating from .env.example...${NC}"
    cp .env.example .env
    echo -e "${GREEN}✓${NC} Created .env file"
    echo ""
fi

# Load environment variables
set -a
source .env
set +a

echo -e "${BLUE}Configuration:${NC}"
echo -e "  WebSocket Server: ws://localhost:${WS_PORT:-8001}"
echo -e "  HTTP API:         http://localhost:${HTTP_PORT:-8000}"
echo -e "  Explorer UI:      http://localhost:${EXPLORER_PORT:-3000}"
echo ""

# Build and start services
echo -e "${BLUE}Building and starting services...${NC}"
$COMPOSE_CMD up -d --build

echo ""
echo -e "${GREEN}✓${NC} Services started!"
echo ""

# Wait for services to be healthy
echo -e "${BLUE}Waiting for services to be ready...${NC}"
sleep 5

# Check health
echo ""
check_health() {
    local service=$1
    local url=$2
    local max_attempts=30
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        if curl -s -f "$url" > /dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} $service is ready"
            return 0
        fi
        attempt=$((attempt + 1))
        sleep 1
        echo -ne "  Waiting for $service... ($attempt/$max_attempts)\r"
    done

    echo -e "${RED}✗${NC} $service failed to become ready"
    return 1
}

check_health "HTTP API" "http://localhost:${HTTP_PORT:-8000}/api/v1/health"
check_health "Explorer UI" "http://localhost:${EXPLORER_PORT:-3000}"

echo ""
echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}  All services are ready!${NC}"
echo -e "${GREEN}================================${NC}"
echo ""
echo -e "Access the services:"
echo -e "  ${BLUE}Explorer UI:${NC}      http://localhost:${EXPLORER_PORT:-3000}"
echo -e "  ${BLUE}HTTP API:${NC}         http://localhost:${HTTP_PORT:-8000}"
echo -e "  ${BLUE}API Health:${NC}       http://localhost:${HTTP_PORT:-8000}/api/v1/health"
echo -e "  ${BLUE}WebSocket Server:${NC} ws://localhost:${WS_PORT:-8001}"
echo ""
echo -e "View logs:"
echo -e "  ${YELLOW}$COMPOSE_CMD logs -f${NC}"
echo ""
echo -e "Stop services:"
echo -e "  ${YELLOW}$COMPOSE_CMD down${NC}"
echo ""
