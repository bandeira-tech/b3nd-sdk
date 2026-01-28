# B3nd Transaction Server

A transaction node server for the B3nd protocol. Validates transactions and propagates them to peers.

## Overview

The transaction server is the governance layer for B3nd. All state changes must go through transaction validation before being propagated to data nodes.

```
┌─────────────────────────────────────────────────────┐
│                  TXN SERVER                         │
│                                                     │
│  POST /txn → validate → propagate to peers          │
│  GET /txn/:uri → read txn (if stored)               │
│  WS /subscribe → stream txns                        │
└─────────────────────────────────────────────────────┘
         │
         │ propagates to
         ▼
┌─────────────────────────────────────────────────────┐
│                  DATA SERVER                        │
│           (installations/http-server)               │
│                                                     │
│  GET /read/:uri → read materialized state           │
│  GET /list/:prefix → list URIs                      │
└─────────────────────────────────────────────────────┘
```

## Quick Start

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Configure your validator (see example-validator.ts)

3. Start the server:
   ```bash
   deno task dev
   ```

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | Yes | Server port |
| `CORS_ORIGIN` | Yes | CORS allowed origin (`*` for dev) |
| `VALIDATOR_MODULE` | Yes | Path to validator module |
| `READ_BACKEND_URL` | Yes | URL(s) for reading state during validation |
| `PEER_URLS` | No | Peer nodes for propagation |
| `AWAIT_PROPAGATION` | No | Wait for propagation (default: false) |

## API Endpoints

### POST /txn

Submit a transaction for validation and propagation.

**Request:**
```json
["txn://alice/transfer/42", {
  "inputs": ["utxo://alice/1"],
  "outputs": [
    ["utxo://bob/99", 50],
    ["utxo://alice/2", 30]
  ],
  "sig": "..."
}]
```

**Response (accepted):**
```json
{
  "accepted": true,
  "uri": "txn://alice/transfer/42",
  "ts": 1704067200000,
  "propagation": {
    "total": 2,
    "succeeded": 2,
    "failed": 0
  }
}
```

**Response (rejected):**
```json
{
  "accepted": false,
  "error": "insufficient_balance",
  "uri": "txn://alice/transfer/42",
  "ts": 1704067200000
}
```

### GET /txn/:uri

Read a transaction by URI (if stored locally).

**Example:**
```bash
curl http://localhost:8843/txn/alice/transfer/42
```

### WS /subscribe

WebSocket endpoint for streaming transactions.

**Query Parameters:**
- `prefix` - Filter by URI prefix (optional)

**Example (JavaScript):**
```javascript
const ws = new WebSocket('ws://localhost:8843/subscribe?prefix=txn://alice/');

ws.onmessage = (event) => {
  const tx = JSON.parse(event.data);
  console.log('Received:', tx);
};
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "read": { "status": "healthy" },
  "peers": [
    { "uri": "peer-0", "status": "connected" }
  ],
  "stats": {
    "received": 100,
    "accepted": 95,
    "rejected": 5,
    "propagated": 95
  }
}
```

## Custom Validators

Create a validator module that exports a default `TransactionValidator` function:

```typescript
// my-validator.ts
import type { TransactionValidator } from "@bandeira-tech/b3nd-sdk/txn";

const validator: TransactionValidator = async (tx, ctx) => {
  const [uri, data] = tx;

  // Verify signature
  if (!await verifySignature(data.sig)) {
    return { valid: false, error: "invalid_signature" };
  }

  // Check state
  const balance = await ctx.read("accounts://alice/balance");
  if (balance.record?.data < data.amount) {
    return { valid: false, error: "insufficient_balance" };
  }

  return { valid: true };
};

export default validator;
```

Then set `VALIDATOR_MODULE=./my-validator.ts` in your `.env`.

## Using with State Validators

For transactions with inputs/outputs, use the `createStateValidator` helper:

```typescript
// state-validator.ts
import { createStateValidator, combineValidators } from "@bandeira-tech/b3nd-sdk/txn-data";

const stateValidator = createStateValidator({
  requireInputsExist: true,
  schema: {
    "utxo://": async ({ value }) => {
      if (typeof value !== "number" || value <= 0) {
        return { valid: false, error: "invalid_amount" };
      }
      return { valid: true };
    },
    "fees://": async ({ value, outputs }) => {
      const requiredFee = outputs.length; // 1 token per output
      if (value < requiredFee) {
        return { valid: false, error: "insufficient_fee" };
      }
      return { valid: true };
    },
  },
  verifySignature: async (sig, msg, pubkey) => {
    // Your signature verification logic
    return true;
  },
});

export default stateValidator;
```

## Deployment

### Docker

```bash
docker build -t b3nd-txn-server .
docker run -p 8843:8843 --env-file .env b3nd-txn-server
```

### Docker Compose

```yaml
version: '3.8'
services:
  txn-server:
    build: .
    ports:
      - "8843:8843"
    environment:
      - PORT=8843
      - CORS_ORIGIN=*
      - VALIDATOR_MODULE=./example-validator.ts
      - READ_BACKEND_URL=http://data-server:8842
      - PEER_URLS=http://peer-node:8843
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          B3ND                                   │
│                                                                 │
│   ┌─────────┐     ┌─────────┐     ┌─────────┐                  │
│   │ TXN     │ ──► │ TXN     │ ──► │ TXN     │                  │
│   │ Server  │     │ Server  │     │ Server  │                  │
│   └────┬────┘     └────┬────┘     └────┬────┘                  │
│        │               │               │                        │
│        │ propagates    │ propagates    │ propagates            │
│        ▼               ▼               ▼                        │
│   ┌─────────┐     ┌─────────┐     ┌─────────┐                  │
│   │ Data    │     │ Data    │     │ Data    │                  │
│   │ Server  │     │ Server  │     │ Server  │                  │
│   └─────────┘     └─────────┘     └─────────┘                  │
│                                                                 │
│   [ validate, transmit, store — no opinion on meaning ]         │
└─────────────────────────────────────────────────────────────────┘
```

## See Also

- [B3nd SDK Documentation](../../sdk/README.md)
- [HTTP Server (Data Node)](../http-server/README.md)
- [Transaction Design Document](../../skills/transactions.md)
