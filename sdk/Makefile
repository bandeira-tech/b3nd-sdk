# @b3nd/sdk Makefile
# Provides convenient commands for testing, development, and publishing

.PHONY: test test-memory test-http publish publish-jsr publish-npm version help

# Default target
.DEFAULT_GOAL := help

# Run all tests
test:
ifdef t
	@echo "Running tests for: $(t)"
	@deno test --allow-all $(t)
else
	@echo "Running all tests..."
	@deno test --allow-all tests/
endif

# Run only MemoryClient tests
test-memory:
	@echo "Running MemoryClient tests..."
	@deno test --allow-all tests/memory-client.test.ts

# Run only HttpClient tests
test-http:
	@echo "Running HttpClient tests..."
	@deno test --allow-all tests/http-client.test.ts

# Publish to both JSR and npm
publish: test
	@echo "Publishing to JSR and npm..."
	@$(MAKE) publish-jsr
	@$(MAKE) publish-npm
	@echo "Done! Don't forget to push the tag: git push origin v$$(jq -r .version deno.json)"

# Publish to JSR only
publish-jsr: test
	@echo "Publishing to JSR..."
	@deno publish

# Publish to npm only
publish-npm: test
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

# Show help
help:
	@echo "Available commands:"
	@echo ""
	@echo "  make test              - Run all tests"
	@echo "  make test t=<path>     - Run specific test file"
	@echo "  make test-memory       - Run MemoryClient tests only"
	@echo "  make test-http         - Run HttpClient tests only"
	@echo ""
	@echo "  make version v=X.Y.Z   - Bump version and create git tag"
	@echo "  make publish           - Publish to JSR and npm (runs tests first)"
	@echo "  make publish-jsr       - Publish to JSR only"
	@echo "  make publish-npm       - Publish to npm only"
	@echo ""
	@echo "Examples:"
	@echo "  make test"
	@echo "  make test t=tests/memory-client.test.ts"
	@echo "  make version v=0.3.0"
	@echo "  make publish"
