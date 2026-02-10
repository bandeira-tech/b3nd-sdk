## Root Makefile

.PHONY: test test-unit test-e2e-http publish publish-jsr publish-npm version build-sdk publish-sdk pkg up down rig help

# Default target
.DEFAULT_GOAL := help

# Run all tests (excludes browser-only tests)
test:
ifdef t
	@echo "Running tests for: $(t)"
	@deno test --allow-all $(t)
else
	@echo "Running all tests..."
	@deno test --allow-all libs/
endif

# Run unit tests only (no external dependencies like Postgres/Mongo)
test-unit:
	@echo "Running unit tests..."
	@deno test --allow-all libs/b3nd-client-memory/ libs/b3nd-wallet/ libs/b3nd-combinators/ libs/b3nd-managed-node/

test-e2e-http:
	@if [ -z "$(URL)" ]; then \
		echo "Starting test HTTP server..."; \
		cd tests && deno run --allow-net --allow-env test-server.ts &\
		SERVER_PID=$$!; \
		echo "Test server started with PID $$SERVER_PID"; \
		sleep 3; \
		echo "Running E2E write-list-read tests against http://localhost:8000"; \
		cd tests && E2E_BASE_URL=http://localhost:8000 deno task test:e2e:write-list-read; \
		TEST_RESULT=$$?; \
		echo "Stopping test server (PID $$SERVER_PID)..."; \
		kill $$SERVER_PID 2>/dev/null || true; \
		exit $$TEST_RESULT; \
	else \
		echo "Running E2E write-list-read against URL=$(URL)"; \
		cd tests && E2E_BASE_URL=$(URL) deno task test:e2e:write-list-read; \
	fi

# Support colon-style target name for convenience: make test:e2e:http URL=...
# GNU make does not allow ':' in target declarations, so we use a catch-all rule.
%:
	@if [ "$@" = "test:e2e:http" ]; then \
		if [ -z "$(URL)" ]; then \
			echo "Starting test HTTP server..."; \
			cd tests && deno run --allow-net --allow-env test-server.ts &\
			SERVER_PID=$$!; \
			echo "Test server started with PID $$SERVER_PID"; \
			sleep 2; \
			echo "Running E2E write-list-read tests against http://localhost:8000"; \
			E2E_BASE_URL=http://localhost:8000 deno task test:e2e:write-list-read; \
			TEST_RESULT=$$?; \
			echo "Stopping test server (PID $$SERVER_PID)..."; \
			kill $$SERVER_PID 2>/dev/null || true; \
			exit $$TEST_RESULT; \
		else \
			echo "Running E2E write-list-read against URL=$(URL)"; \
			cd tests && E2E_BASE_URL=$(URL) deno task test:e2e:write-list-read; \
		fi; \
	else \
		echo "Unknown target '$@'"; exit 2; \
	fi

build-sdk:
	@echo "Building web package and validating JSR exports..."
	@npm run build && deno task check

publish-sdk:
	@echo "Publishing SDK to npm..."
	@npm run publish:package

# Publish to both JSR and npm
publish: test-unit
	@echo "Publishing to JSR and npm..."
	@$(MAKE) publish-jsr
	@$(MAKE) publish-npm
	@echo "Done! Don't forget to push the tag: git push origin v$$(jq -r .version deno.json)"

# Publish to JSR only
publish-jsr: test-unit
	@echo "Publishing to JSR..."
	@deno task publish:jsr

# Publish to npm only
publish-npm: test-unit
	@echo "Building for npm..."
	@npm run build
	@echo "Publishing to npm..."
	@npm publish --access public

# Bump version, update both deno.json and package.json, create git tag
# Usage: make version v=0.3.0
version:
ifndef v
	$(error Usage: make version v=X.Y.Z)
endif
	@echo "Bumping version to $(v)..."
	@jq '.version = "$(v)"' deno.json > deno.json.tmp && mv deno.json.tmp deno.json
	@npm version $(v) --no-git-tag-version
	@git add deno.json package.json package-lock.json
	@git commit -m "chore(sdk): bump version to $(v)"
	@git tag -a "v$(v)" -m "Release v$(v)"
	@echo "Version $(v) tagged. Run 'make publish' to publish, then 'git push origin v$(v)'"

pkg:
	@if [ -z "$(target)" ]; then \
		echo "Error: 'target' variable is required"; \
		echo "Usage: make pkg target=<target-name>"; \
		exit 1; \
	fi
	@if [ ! -f "apps/$(target)/Dockerfile" ]; then \
		echo "Error: Dockerfile not found at apps/$(target)/Dockerfile"; \
		exit 1; \
	fi
	@echo "Building Docker image for $(target)..."
	@docker build --load -t ghcr.io/bandeira-tech/b3nd/$(target):latest -f ./apps/$(target)/Dockerfile .
	@echo "Pushing image to ghcr.io/bandeira-tech/b3nd/$(target):latest..."
	@docker push ghcr.io/bandeira-tech/b3nd/$(target):latest
	@echo "Done!"

# Docker Compose — usage: make up p=dev, make down p=test
up:
ifndef p
	$(error Usage: make up p=<profile>  (profiles: dev, test))
endif
	@docker compose --profile $(p) up -d --wait

down:
ifndef p
	$(error Usage: make down p=<profile>  (profiles: dev, test))
endif
	@docker compose --profile $(p) down

# Web rig + inspector (runs natively, expects node on :9942)
rig:
	@cd apps/b3nd-web-rig && npm run dev &
	@cd apps/sdk-inspector && deno task dev &
	@echo "Rig :5555  Inspector :5556  (node expected on :9942)"
	@wait

# Show help
help:
	@echo "Available commands:"
	@echo ""
	@echo "  make test              - Run all tests (auto-discovers *.test.ts in libs/)"
	@echo "  make test t=<path>     - Run specific test file or directory"
	@echo "  make test-unit         - Run unit tests only (no Postgres/Mongo)"
	@echo "  make test-e2e-http     - Run E2E HTTP tests"
	@echo ""
	@echo "  make build-sdk         - Build web package and validate JSR exports"
	@echo "  make publish-sdk       - Publish SDK to npm"
	@echo "  make version v=X.Y.Z   - Bump version and create git tag"
	@echo "  make publish           - Publish to JSR and npm (runs unit tests)"
	@echo "  make publish-jsr       - Publish to JSR only"
	@echo "  make publish-npm       - Publish to npm only"
	@echo ""
	@echo "  make pkg target=<name> - Build and push Docker image"
	@echo ""
	@echo "  make up p=<profile>    - Start a compose profile (dev, test)"
	@echo "  make down p=<profile>  - Stop a compose profile"
	@echo "  make rig               - Start web rig (:5555) + inspector (:5556)"
	@echo ""
	@echo "Examples:"
	@echo "  make test-unit"
	@echo "  make version v=0.3.0"
	@echo "  make publish"
