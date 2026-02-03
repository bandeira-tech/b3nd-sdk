# B3nd Explorer Development
# Usage: make dev

.PHONY: dev dev-full dev-postgres install clean help

# Default target
help:
	@echo "B3nd Explorer Development Commands"
	@echo ""
	@echo "  make dev          - Start minimal: HTTP API + Dashboard + Frontend"
	@echo "  make dev-full     - Start all services (requires wallet-server .env)"
	@echo "  make dev-postgres - Start with PostgreSQL backend"
	@echo "  make install      - Install all dependencies"
	@echo "  make clean        - Clean up Docker volumes and temp files"
	@echo ""

# Minimal dev environment (default)
dev:
	./dev.sh

# Full dev environment with all services
dev-full:
	./dev.sh --full

# Full dev environment with PostgreSQL
dev-postgres:
	./dev.sh --with-postgres --full

# Install dependencies
install:
	@echo "Installing frontend dependencies..."
	cd app && npm install
	@echo "Caching Deno dependencies..."
	cd dashboard && deno cache mod.ts
	cd ../installations/http-server && deno cache mod.ts
	@echo "Done!"

# Clean up
clean:
	@echo "Stopping Docker containers..."
	docker compose down -v 2>/dev/null || true
	@echo "Removing node_modules..."
	rm -rf app/node_modules
	@echo "Done!"
