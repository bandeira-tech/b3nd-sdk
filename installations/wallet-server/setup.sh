#!/bin/bash

# B3nd Wallet Server Setup Script
# This script helps set up and configure the wallet server

set -e

echo "🚀 B3nd Wallet Server Setup"
echo ""

# Check if .env file exists
if [ ! -f ".env" ]; then
  echo "📝 Creating .env file from template..."
  cp .env.example .env
  echo "✓ Created .env file"
  echo ""
  echo "⚠️  Please update the following in .env:"
  echo "  - JWT_SECRET (required, minimum 32 characters)"
  echo "  - CREDENTIAL_NODE_URL (b3nd backend for credentials)"
  echo "  - PROXY_NODE_URL (b3nd backend for proxying)"
  echo ""
  echo "After updating .env, run:"
  echo "  deno task dev"
  exit 0
fi

echo "✓ .env file already exists"
echo ""

# Check if deno is installed
if ! command -v deno &> /dev/null; then
  echo "❌ Deno is not installed"
  echo "Install from: https://deno.land"
  exit 1
fi

DENO_VERSION=$(deno --version | head -1)
echo "✓ $DENO_VERSION"
echo ""

# Check JWT_SECRET
if grep -q "^JWT_SECRET=your-super-secret" .env; then
  echo "⚠️  JWT_SECRET is not set!"
  echo "Generate a strong secret with:"
  echo "  deno run --allow-env -e 'console.log(crypto.getRandomValues(new Uint8Array(32)).reduce((a,b) => a+b.toString(16).padStart(2,\"0\"),\"\"))'"
  exit 1
fi

echo "✓ JWT_SECRET is configured"

# Check CREDENTIAL_NODE_URL
CRED_URL=$(grep "^CREDENTIAL_NODE_URL=" .env | cut -d= -f2)
if [ -z "$CRED_URL" ] || [ "$CRED_URL" = "http://localhost:8080" ]; then
  echo "⚠️  Using default CREDENTIAL_NODE_URL: $CRED_URL"
  echo "   Make sure a b3nd backend is running on this URL"
fi

# Check PROXY_NODE_URL
PROXY_URL=$(grep "^PROXY_NODE_URL=" .env | cut -d= -f2)
if [ -z "$PROXY_URL" ] || [ "$PROXY_URL" = "http://localhost:8080" ]; then
  echo "⚠️  Using default PROXY_NODE_URL: $PROXY_URL"
  echo "   Make sure a b3nd backend is running on this URL"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start the wallet server, run:"
echo "  deno task dev"
echo ""
echo "The server will be available at:"
echo "  http://localhost:3001"
echo ""
