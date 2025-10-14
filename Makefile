## Root Makefile

.PHONY: test-e2e-http
test-e2e-http:
	@echo "Running E2E write-list-read against URL=$(URL)"
	@if [ -z "$(URL)" ]; then echo "ERROR: URL is required. Usage: make test-e2e-http URL=http://host:port"; exit 1; fi
	@cd integ/e2e && E2E_BASE_URL=$(URL) deno task test:e2e:write-list-read

# Support colon-style target name for convenience: make test:e2e:http URL=...
# GNU make does not allow ':' in target declarations, so we use a catch-all rule.
%:
	@if [ "$@" = "test:e2e:http" ]; then \
		echo "Running E2E write-list-read against URL=$(URL)"; \
		if [ -z "$(URL)" ]; then echo "ERROR: URL is required. Usage: make test:e2e:http URL=http://host:port"; exit 1; fi; \
		cd integ/e2e && E2E_BASE_URL=$(URL) deno task test:e2e:write-list-read; \
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
