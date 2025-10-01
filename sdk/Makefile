# @b3nd/sdk Makefile
# Provides convenient commands for testing and development

.PHONY: test test-memory test-http help

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

# Show help
help:
	@echo "Available commands:"
	@echo ""
	@echo "  make test              - Run all tests"
	@echo "  make test t=<path>     - Run specific test file"
	@echo "  make test-memory       - Run MemoryClient tests only"
	@echo "  make test-http         - Run HttpClient tests only"
	@echo ""
	@echo "Examples:"
	@echo "  make test"
	@echo "  make test t=tests/memory-client.test.ts"
	@echo "  make test t=tests/shared-suite.ts"
