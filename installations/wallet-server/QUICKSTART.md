# B3nd Wallet Server - Quick Start

Get up and running with the wallet server in 5 minutes.

## Prerequisites

- Deno 1.40+ ([install](https://deno.land))
- A running b3nd backend (or use the same instance for both credential and proxy storage)

## Setup (1 minute)

### 1. Create Configuration

```bash
cp .env.example .env
```

Edit `.env` and set a strong `JWT_SECRET`:

```bash
# Generate a random secret
openssl rand -hex 32 > /tmp/secret.txt
cat /tmp/secret.txt

# Update in .env
JWT_SECRET=<paste-your-secret-here>
```

### 2. Start b3nd Backend (if not already running)

```bash
# In another terminal, from b3nd root
cd installations/http-evergreen
SCHEMA_MODULE=./example-schema.ts PORT=8080 deno task dev
```

### 3. Start Wallet Server

```bash
deno task dev
```

Server running at `http://localhost:3001`
Set `APP_KEY` from the bootstrap state written on startup (default `wallet-app-bootstrap.json`):
```bash
APP_KEY=$(jq -r '.appKey' wallet-app-bootstrap.json)
```

## Basic Usage (2 minutes)

### Sign Up

```bash
curl -X POST http://localhost:3001/api/v1/auth/signup/${APP_KEY} \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"password123"}'
```

Save the returned `token`.

### Write Data

```bash
TOKEN="paste-token-here"

curl -X POST http://localhost:3001/api/v1/proxy/write \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "uri": "mutable://hello/world",
    "data": {"message":"Hello!"}
  }'
```

### Get Public Keys

```bash
curl http://localhost:3001/api/v1/auth/public-keys/${APP_KEY} \
  -H "Authorization: Bearer $TOKEN"
```

## What's Happening

1. **Sign Up**: Creates a user account, generates Ed25519 + X25519 keys, returns JWT
2. **Write**: Proxies your data to b3nd backend, signs with server's Ed25519 key
3. **Keys**: Returns public keys (safe to share, used for verification)

## Database

All user data stored in b3nd at:

- `wallet://users/{username}` - User profile
- `wallet://users/{username}/password` - Hashed password
- `wallet://users/{username}/account-key` - Ed25519 key
- `wallet://users/{username}/encryption-key` - X25519 key

## Next Steps

- See [USAGE_GUIDE.md](./USAGE_GUIDE.md) for complete API documentation
- Check [README.md](./README.md) for architecture and deployment

## Troubleshooting

**Port 3001 already in use:**
```bash
WALLET_PORT=3002 deno task dev
```

**SDK module not found:**
```bash
cd ../.. && deno cache installations/wallet-server/src/mod.ts
```

**Can't connect to b3nd backend:**
```bash
# Check your CREDENTIAL_NODE_URL in .env
# Make sure b3nd is running on that URL
curl http://localhost:8080/health
```

---

For help, see the full [README.md](./README.md) or the [USAGE_GUIDE.md](./USAGE_GUIDE.md).
