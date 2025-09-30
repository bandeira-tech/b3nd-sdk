.PHONY: help up down build logs restart clean ps health test

# Detect if we're using podman or docker
CONTAINER_ENGINE := $(shell command -v podman 2> /dev/null || command -v docker 2> /dev/null)
COMPOSE_CMD := $(shell command -v podman-compose 2> /dev/null || command -v docker-compose 2> /dev/null)

help: ## Show this help message
	@echo "b3nd Full Stack - Available commands:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Using: $(COMPOSE_CMD)"

up: ## Start all services
	$(COMPOSE_CMD) up -d

down: ## Stop all services
	$(COMPOSE_CMD) down

build: ## Build all images
	$(COMPOSE_CMD) build

rebuild: ## Rebuild and restart all services
	$(COMPOSE_CMD) up -d --build

logs: ## Show logs from all services
	$(COMPOSE_CMD) logs -f

logs-ws: ## Show WebSocket server logs
	$(COMPOSE_CMD) logs -f wsserver

logs-api: ## Show HTTP API logs
	$(COMPOSE_CMD) logs -f httpapi

logs-ui: ## Show Explorer UI logs
	$(COMPOSE_CMD) logs -f explorer

restart: ## Restart all services
	$(COMPOSE_CMD) restart

restart-ws: ## Restart WebSocket server
	$(COMPOSE_CMD) restart wsserver

restart-api: ## Restart HTTP API
	$(COMPOSE_CMD) restart httpapi

restart-ui: ## Restart Explorer UI
	$(COMPOSE_CMD) restart explorer

clean: ## Stop services and remove volumes
	$(COMPOSE_CMD) down -v

ps: ## Show running services
	$(COMPOSE_CMD) ps

health: ## Check health of all services
	@echo "Checking service health..."
	@echo ""
	@echo "WebSocket Server (ws://localhost:8001):"
	@curl -s ws://localhost:8001/health > /dev/null 2>&1 && echo "  ✓ Healthy" || echo "  ✗ Unhealthy"
	@echo ""
	@echo "HTTP API (http://localhost:8000):"
	@curl -s http://localhost:8000/api/v1/health > /dev/null 2>&1 && echo "  ✓ Healthy" || echo "  ✗ Unhealthy"
	@echo ""
	@echo "Explorer UI (http://localhost:3000):"
	@curl -s http://localhost:3000 > /dev/null 2>&1 && echo "  ✓ Healthy" || echo "  ✗ Unhealthy"

test-write: ## Test write operation
	@echo "Writing test data..."
	@curl -X POST http://localhost:8000/api/v1/write/test/demo/hello \
		-H "Content-Type: application/json" \
		-d '{"value": {"message": "Hello from b3nd!", "timestamp": "$(shell date +%s)"}}' \
		| jq .

test-read: ## Test read operation
	@echo "Reading test data..."
	@curl -s http://localhost:8000/api/v1/read/test/demo/hello | jq .

test-list: ## Test list operation
	@echo "Listing resources..."
	@curl -s http://localhost:8000/api/v1/list/test/demo/ | jq .

test-delete: ## Test delete operation
	@echo "Deleting test data..."
	@curl -X DELETE http://localhost:8000/api/v1/delete/test/demo/hello | jq .

env: ## Create .env file from example
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "Created .env file from .env.example"; \
		echo "Please edit .env to customize your configuration"; \
	else \
		echo ".env file already exists"; \
	fi

shell-ws: ## Open shell in wsserver container
	$(CONTAINER_ENGINE) exec -it b3nd-wsserver sh

shell-api: ## Open shell in httpapi container
	$(CONTAINER_ENGINE) exec -it b3nd-httpapi sh

shell-ui: ## Open shell in explorer container
	$(CONTAINER_ENGINE) exec -it b3nd-explorer sh