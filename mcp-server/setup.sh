#!/bin/bash
# B3nd MCP Server Setup Script
# Installs the B3nd MCP server for Claude Code with multi-backend support

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCOPE="${1:-user}"

# Default backends configuration
DEFAULT_BACKENDS="local=http://localhost:8842"
BACKENDS="${B3ND_BACKENDS:-$DEFAULT_BACKENDS}"

echo "B3nd MCP Server Setup"
echo "====================="
echo "Server path: $SCRIPT_DIR/mod.ts"
echo "Backends: $BACKENDS"
echo "Scope: $SCOPE"
echo ""

# Check if deno is installed
if ! command -v deno &> /dev/null; then
    echo "Error: Deno is not installed. Please install Deno first:"
    echo "  curl -fsSL https://deno.land/install.sh | sh"
    exit 1
fi

# Check if claude CLI is available
if ! command -v claude &> /dev/null; then
    echo "Error: Claude CLI is not installed or not in PATH."
    exit 1
fi

echo "Installing B3nd MCP server..."

# Remove existing server if present
claude mcp remove b3nd 2>/dev/null || true

# Install the MCP server
claude mcp add --transport stdio b3nd \
    --scope "$SCOPE" \
    --env "B3ND_BACKENDS=$BACKENDS" \
    -- deno run -A "$SCRIPT_DIR/mod.ts"

echo ""
echo "Installation complete!"
echo ""
echo "Verify with:"
echo "  claude mcp list"
echo "  claude mcp get b3nd"
echo ""
echo "Usage in Claude Code:"
echo "  > List available backends"
echo "  > Switch to testnet"
echo "  > Read mutable://users/alice/profile"
echo ""
echo "To add more backends, set B3ND_BACKENDS before running:"
echo "  B3ND_BACKENDS='local=http://localhost:8842,testnet=https://testnet.b3nd.io' ./setup.sh"
