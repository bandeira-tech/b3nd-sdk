# B3nd HTTP Evergreen - End User Manual

## Quick Start

B3nd HTTP Evergreen is a universal data storage API supporting multiple protocols and domains with built-in authentication and encryption.

### Start the Server
```bash
deno run --allow-env --allow-net mod.ts
# Server runs on http://localhost:8080 (default)
```

### Install CLI Tool
```bash
cd cli
./bnd conf node http://localhost:8080
./bnd account create
./bnd encrypt create
./bnd conf encrypt ~/.bnd/encryption/default.key
```

---

## Protocols & Domains

### Protocol: `mutable://` vs `immutable://`

| Feature | Mutable | Immutable |
|---------|---------|-----------|
| **Overwrites** | Yes - can update existing data | No - blocks overwrites |
| **Use Case** | User profiles, settings, state | Audit logs, immutable records, certificates |
| **Validation** | Custom validators can read & write | Can read but cannot change after first write |

### Domain: `open` vs `accounts`

| Feature | Open | Accounts |
|---------|------|----------|
| **Auth Required** | No | Yes (Ed25519 signature) |
| **Signature Validation** | N/A | Pubkey extracted from URI path |
| **Encryption Support** | Yes | Yes (ECDH + AES-GCM) |
| **Use Case** | Public data, shared resources | Private user data, secure storage |

---

## API Endpoints

### Read Data
```bash
GET /api/v1/read/:protocol/:domain/*
```
**Example:**
```bash
curl http://localhost:8080/api/v1/read/mutable/open/users/alice
# Returns: { success: true, record: { ts: 1234567890, data: {...} } }
```

### Write Data
```bash
POST /api/v1/write/:protocol/:domain/*
```
**Payload (unsigned):**
```json
{
  "value": "your data here or JSON object"
}
```

**Payload (signed - for `accounts` domain):**
```json
{
  "value": {
    "auth": [
      {
        "pubkey": "your_public_key_hex",
        "signature": "ed25519_signature_hex"
      }
    ],
    "payload": "your actual data"
  }
}
```

**Example:**
```bash
curl -X POST http://localhost:8080/api/v1/write/mutable/accounts/pubkey123/profile \
  -H "Content-Type: application/json" \
  -d '{"value": {"auth": [...], "payload": {...}}}'
```

### List Items
```bash
GET /api/v1/list/:protocol/:domain/*?page=1&limit=50
```

### Delete Data
```bash
DELETE /api/v1/delete/:protocol/:domain/*
```

### Health Check
```bash
GET /api/v1/health
```

### Get Schema
```bash
GET /api/v1/schema
```

---

## Authentication (Accounts Domain)

The `accounts` domain uses URL-based public key extraction for automatic access control.

### How It Works

1. **URI Format:** `protocol://accounts/<pubkey>/path/to/data`
2. **Validation:** Server extracts `<pubkey>` from URI
3. **Signature Check:** Verifies Ed25519 signature was created by that pubkey
4. **Automatic:** No token management needed - pubkey is in the URL

### Using the CLI (Automatic Signing)

```bash
# Create account
bnd account create

# Write to your account (pubkey auto-replaced with :key)
bnd write mutable://accounts/:key/profile '{"name":"Alice","email":"alice@example.com"}'

# Read from your account
bnd read mutable://accounts/:key/profile

# List your data
bnd list mutable://accounts/:key/
```

The CLI automatically:
- Replaces `:key` with your public key
- Signs the payload with your private key
- Sends proper auth structure to the server

### Manual Signing (No CLI)

```bash
# 1. Generate Ed25519 keypair (OpenSSL or SDK)
openssl genpkey -algorithm Ed25519 -out private.pem
openssl pkey -in private.pem -pubout -outform der | xxd -p -c256

# 2. Sign your payload
# Use Web Crypto API or your SDK to:
# - JSON.stringify(payload)
# - Sign with Ed25519 private key
# - Get signature as hex

# 3. POST to server
curl -X POST http://localhost:8080/api/v1/write/mutable/accounts/YOURPUBKEY/profile \
  -H "Content-Type: application/json" \
  -d '{
    "value": {
      "auth": [{
        "pubkey": "your_public_key_hex",
        "signature": "your_signature_hex"
      }],
      "payload": {"name": "Alice"}
    }
  }'
```

---

## Encryption

Encryption is **optional** but recommended for sensitive data in the `accounts` domain.

### Enable in CLI

```bash
# Create encryption key (X25519)
bnd encrypt create

# Enable encryption
bnd conf encrypt ~/.bnd/encryption/default.key

# Now all writes to accounts domain are encrypted!
bnd write mutable://accounts/:key/secrets "confidential data"

# CLI automatically decrypts on read
bnd read mutable://accounts/:key/secrets
# Output shows: Decrypted Payload: "confidential data"
```

### How It Works

1. **On Write:**
   - Plaintext payload encrypted with your X25519 public key
   - Encrypted data signed with Ed25519 private key
   - Ephemeral key included for ECDH

2. **On Read:**
   - Server returns encrypted blob
   - CLI decrypts using X25519 private key
   - You see plaintext

3. **On Server:**
   - Only encrypted data stored (Base64 + nonce + ephemeral key)
   - Server cannot decrypt - only client can

---

## Use Cases

### Public Open Data (No Auth)
```bash
# Blog posts, articles, public configs
bnd write mutable://open/blog/posts/hello-world '{"title":"Hello","content":"..."}'
bnd read mutable://open/blog/posts/hello-world
```

### User Profiles (Auth)
```bash
# Private user data
bnd write mutable://accounts/:key/profile '{"name":"Alice","bio":"..."}'
bnd read mutable://accounts/:key/profile
```

### Audit Logs (Immutable, Auth)
```bash
# Write-once audit trail - cannot be modified
bnd write immutable://accounts/:key/audit/2025-11-04 '{"action":"login","timestamp":"..."}'

# Attempts to overwrite fail with "immutable object exists"
```

### Encrypted Secrets (Auth + Encryption)
```bash
# Enable encryption first
bnd conf encrypt ~/.bnd/encryption/default.key

# Write encrypted
bnd write mutable://accounts/:key/secrets '{"api_key":"sk_...","password":"..."}'

# Server stores: encrypted blob only
# Client reads: automatic decryption, sees plaintext
```

### Multi-User Collaboration (Open Domain)
```bash
# Shared documents - no auth needed, everyone can write
bnd write mutable://open/docs/project-plan '{"owner":"alice","status":"draft"}'

# Add validation rules in schema to control updates
```

---

## Building Applications

### Example: Secure Notes App

```typescript
import { HttpClient } from "@b3nd/sdk";

// Initialize client
const client = new HttpClient({ url: "http://localhost:8080" });

// User signs up - creates their account (nothing to store yet)
async function signup(pubkey: string) {
  // Just document they exist
  await client.write(`mutable://accounts/${pubkey}/profile`, {
    createdAt: new Date().toISOString()
  });
}

// User writes encrypted note
async function saveNote(pubkey: string, noteId: string, content: string) {
  // Note: with CLI encryption enabled, content is auto-encrypted
  // Without CLI, you need to manually encrypt using sdk/encrypt module
  await client.write(`mutable://accounts/${pubkey}/notes/${noteId}`, {
    content,
    editedAt: new Date().toISOString()
  });
}

// User reads encrypted note
async function getNote(pubkey: string, noteId: string) {
  const result = await client.read(`mutable://accounts/${pubkey}/notes/${noteId}`);
  // Note: Returned data is encrypted on server, client would decrypt
  return result.record?.data;
}

// List all user notes
async function listNotes(pubkey: string) {
  const result = await client.list(`mutable://accounts/${pubkey}/notes/`);
  return result.data; // Returns array of note paths
}
```

### Example: Public Voting System

```typescript
// Public proposal - anyone can read
async function createProposal(id: string, text: string) {
  await client.write(`mutable://open/proposals/${id}`, {
    text,
    votes: { yes: 0, no: 0 },
    createdAt: new Date().toISOString()
  });
}

// User votes - immutable record (one vote per user per proposal)
async function vote(userId: string, proposalId: string, choice: "yes" | "no") {
  const voteId = `${userId}-${proposalId}`;
  await client.write(
    `immutable://open/votes/${voteId}`,
    { userId, proposalId, choice, timestamp: new Date().toISOString() }
  );
}

// Count votes
async function tallyVotes(proposalId: string) {
  const votes = await client.list(`immutable://open/votes/`);
  // Filter by proposalId and count yes/no
}
```

---

## Schema Customization

The server uses a validation schema from `example-schema.ts`. Customize validation:

```typescript
// example-schema.ts
import { authValidation, createPubkeyBasedAccess } from "../../sdk/auth/mod.ts";

export const schema = {
  "mutable://open": ({ uri, value, read }) => {
    // Validate public writes
    if (typeof value !== "string" && typeof value !== "object") {
      return { valid: false, error: "Must be string or object" };
    }
    return { valid: true };
  },

  "immutable://open": async ({ uri, value, read }) => {
    // Immutable writes can read existing data to prevent overwrites
    const existing = await read(uri);
    if (existing.success) {
      return { valid: false, error: "immutable object exists" };
    }
    return { valid: true };
  },

  "mutable://accounts": async ({ uri, value, read }) => {
    // Auth validation
    const getAccess = createPubkeyBasedAccess();
    const validator = authValidation(getAccess);
    return validator({ uri, value });
  },

  "immutable://accounts": async ({ uri, value, read }) => {
    // Check auth first
    const getAccess = createPubkeyBasedAccess();
    const validator = authValidation(getAccess);
    const isValid = await validator({ uri, value });
    if (!isValid) return { valid: false, error: "Invalid signature" };

    // Check immutability
    const existing = await read(uri);
    if (existing.success) {
      return { valid: false, error: "immutable object exists" };
    }
    return { valid: true };
  },
};
```

Run with custom schema:
```bash
SCHEMA_MODULE=./my-schema.ts deno run --allow-env --allow-net mod.ts
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Signature verification failed" | Ensure pubkey in URI matches signed value's pubkey |
| "immutable object exists" | You're trying to overwrite immutable data - use mutable:// or new URI |
| "No account configured" | Run `bnd account create` |
| "Cannot read encryption key" | Run `bnd conf encrypt /path/to/key` with correct file path |
| CORS errors | Set `CORS_ORIGIN` env var: `CORS_ORIGIN=https://myapp.com` |

---

## Performance Tips

- **Batch operations** using bulk endpoints (plan for future SDK update)
- **Cache reads** - data doesn't change unless you write
- **Use immutable://** for audit logs - server optimizes write-once data
- **Filter early** - use `list()` with pattern matching instead of reading all items
- **Encryption cost** - encryption adds ~5-10ms per operation; disable if not needed

---

## Security

✅ **What's Secure:**
- Signatures prevent impersonation (accounts domain)
- Encryption prevents server from reading your data
- Private keys stored locally, never sent to server

⚠️ **What's Not:**
- Public domain is readable by anyone
- Encryption only in transit and at rest - client must handle it
- No rate limiting (add in deployment)
- Server stores everything in memory (add persistence layer for production)

---

## Next Steps

- Read SDK docs: `../../sdk/README.md`
- Deploy to production with persistent storage
- Add custom validation rules to schema
- Integrate into your app using SDK
- Monitor with health endpoint
