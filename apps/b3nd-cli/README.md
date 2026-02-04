# b3nd CLI

A command-line interface for b3nd nodes, built with Deno and the b3nd-sdk. Its primary function is to help develop and debug nodes from your terminal.

## Installation

Requirements:
- Deno 1.40+

Clone and run directly:
```bash
deno run --allow-read --allow-write --allow-env --allow-net src/main.ts <command> [options]
```

Or create an alias:
```bash
alias bnd='deno run --allow-read --allow-write --allow-env --allow-net /path/to/cli/src/main.ts'
```

## Quick Start

Configure your node and account:
```bash
bnd conf node https://testnet-evergreen.fire.cat
bnd conf account path/to/my/key
```

View your configuration:
```bash
bnd config
cat ~/.bnd/config.toml
```

## Usage

### Configuration Commands

Set the node URL (required for all operations):
```bash
bnd conf node <url>
```

Set the account key path:
```bash
bnd conf account <path>
```

### Data Operations

Write data to a URI:
```bash
bnd write tmp://some/path "this is a nice little payload"
bnd write store://account/:key/data {"name": "Alice", "age": 30}
```

Write data from a JSON file:
```bash
# Note: The filename (without extension) becomes the URI
# For test_payload.json, the URI will be 'test_payload'
# This only works if 'test_payload' is a valid program key on your node

# Better: Provide an explicit URI with the file
bnd write test://my-data -f mypayload.json
```

Read data from a URI:
```bash
bnd read tmp://some/path
bnd read store://account/:key/profile
```

List items at a URI:
```bash
bnd list store://account/:key/books
```

### Utility Commands

Show current configuration:
```bash
bnd config
```

Show help:
```bash
bnd help
bnd -h
bnd --help
```

## Examples

```bash
# Configure
bnd conf node https://testnet-evergreen.fire.cat
bnd conf account path/to/my/key

# Write operations
bnd write tmp://some/path "this is a nice little payload"
bnd write tmp://users/alice '{"name": "Alice", "age": 30}'
bnd write -f mypayload.json

# Read operations
bnd read tmp://some/path
bnd read store://account/:key/profile

# List operations
bnd list store://account/:key/books

# View config
bnd config
cat ~/.bnd/config.toml
```

## Configuration File

Configuration is stored in `~/.bnd/config.toml` in TOML format:

```toml
node = "https://testnet-evergreen.fire.cat"
account = "path/to/my/key"
```

## Architecture

- **src/main.ts** - CLI entry point with command routing
- **src/config.ts** - Configuration management (TOML parsing/serialization)
- **src/client.ts** - B3nd HTTP client initialization and caching
- **src/commands.ts** - Command handlers (conf, write, read, list, config)

## Debugging with Verbose Mode

Use the `--verbose` or `-v` flag to see detailed operation logs:

```bash
# Show what the CLI is doing
bnd -v write tmp://test "data"
bnd --verbose read tmp://test
bnd -v list store://account/:key/items

# Combine with any command
bnd write -v tmp://test "data"
```

**Verbose output shows:**
- Configuration loading
- HTTP client initialization
- Node health check
- Exact request parameters
- Server responses (including error details)
- Timestamps and record data

This is invaluable for debugging connection issues, protocol problems, and understanding what the node is returning.

See [VERBOSE_MODE.md](./VERBOSE_MODE.md) for detailed debugging guide.

## Development

Check TypeScript:
```bash
deno check src/main.ts
```

Format code:
```bash
deno fmt src/
```

Lint code:
```bash
deno lint src/
```

## Dependencies

- **@bandeira-tech/b3nd-sdk** - Universal persistence interface
- **@std/fs** - Deno standard library filesystem utilities
- **@std/path** - Deno standard library path utilities

## License

MIT
