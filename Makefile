## Root Makefile

.PHONY: test-e2e-http
test-e2e-http:
	@if [ -z "$(URL)" ]; then \
		echo "Starting test HTTP server..."; \
		cd integ/e2e && deno run --allow-net --allow-env test-server.ts &\
		SERVER_PID=$$!; \
		echo "Test server started with PID $$SERVER_PID"; \
		sleep 3; \
		echo "Running E2E write-list-read tests against http://localhost:8000"; \
		cd integ/e2e && E2E_BASE_URL=http://localhost:8000 deno task test:e2e:write-list-read; \
		TEST_RESULT=$$?; \
		echo "Stopping test server (PID $$SERVER_PID)..."; \
		kill $$SERVER_PID 2>/dev/null || true; \
		exit $$TEST_RESULT; \
	else \
		echo "Running E2E write-list-read against URL=$(URL)"; \
		cd integ/e2e && E2E_BASE_URL=$(URL) deno task test:e2e:write-list-read; \
	fi

# Support colon-style target name for convenience: make test:e2e:http URL=...
# GNU make does not allow ':' in target declarations, so we use a catch-all rule.
%:
	@if [ "$@" = "test:e2e:http" ]; then \
		if [ -z "$(URL)" ]; then \
			echo "Starting test HTTP server..."; \
			cd integ/e2e && deno run --allow-net --allow-env test-server.ts &\
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
			cd integ/e2e && E2E_BASE_URL=$(URL) deno task test:e2e:write-list-read; \
		fi; \
	else \
		echo "Unknown target '$@'"; exit 2; \
	fi

.PHONY: build-sdk
build-sdk:
	@echo "Building SDK for npm..."
	@cd sdk && npm run build

.PHONY: publish-sdk
publish-sdk:
	@echo "Publishing SDK to npm..."
	@cd sdk && npm run publish:package

.PHONY: pkg
pkg:
	@if [ -z "$(target)" ]; then \
		echo "Error: 'target' variable is required"; \
		echo "Usage: make pkg target=<target-name>"; \
		exit 1; \
	fi
	@if [ ! -f "installations/$(target)/Dockerfile" ]; then \
		echo "Error: Dockerfile not found at installations/$(target)/Dockerfile"; \
		exit 1; \
	fi
	@echo "Building Docker image for $(target)..."
	@docker build --load -t ghcr.io/bandeira-tech/b3nd/$(target):latest -f ./installations/$(target)/Dockerfile .
	@echo "Pushing image to ghcr.io/bandeira-tech/b3nd/$(target):latest..."
	@docker push ghcr.io/bandeira-tech/b3nd/$(target):latest
	@echo "Done!"
