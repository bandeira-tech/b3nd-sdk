# B3nd Wallet Server

A key custodian and middleware service that enables users to authenticate with familiar username/password flows while the server manages their cryptographic keys for signing and encryption.

## Overview

Instead of users managing private keys directly (which creates UX friction), the wallet server:

1. **Authenticates users** with username + password (supports password reset flows)
2. **Manages user keys** - Ed25519 (for signing) and X25519 (for encryption)
3. **Proxies writes** - Signs and encrypts user data with server-managed keys
4. **Issues JWTs** - For stateless, authenticated session management

## Architecture

```
Web App
  ↓
Wallet Server (HTTP API with JWT)
  ├─→ Credential Client (stores users/keys/passwords)
  └─→ Proxy Client (target b3nd backend for writes)
```

The wallet server:
- Has its own Ed25519 identity key (for signing server operations)
- Has its own X25519 encryption key (for encrypting/decrypting data)
- Uses b3nd itself for persistent key storage
- Follows the same validation and schema patterns as other b3nd installations

## Setup

### Prerequisites

- Deno 1.40+
- Two b3nd backend instances (or one shared instance):
  - **Credential backend**: Stores user keys and passwords
  - **Proxy backend**: Where user writes are proxied to

### Configuration

Create a `.env` file (or set environment variables):

```bash
# Server port
WALLET_PORT=3001

# B3nd backend URLs
CREDENTIAL_NODE_URL=http://localhost:8080  # For storing user keys
PROXY_NODE_URL=http://localhost:8080       # For proxying user writes

# JWT configuration
JWT_SECRET=your-super-secret-key-at-least-32-characters-long
JWT_EXPIRATION_SECONDS=86400               # 24 hours

# Server keys storage
SERVER_KEYS_PATH=./server-keys.json

# CORS configuration
ALLOWED_ORIGINS=http://localhost:3000,https://app.example.com

# Password reset token TTL
PASSWORD_RESET_TOKEN_TTL_SECONDS=3600      # 1 hour
```

### Running the Server

```bash
# Development mode
deno task dev

# Production mode
deno run --allow-net --allow-read --allow-write --allow-env src/mod.ts
```

The server will:
1. Initialize server keys (creates `server-keys.json` if it doesn't exist)
2. Connect to credential and proxy b3nd backends
3. Start listening on the configured port

## API Endpoints

### Authentication

#### POST `/auth/signup`
Create a new user account and generate keys.

```bash
curl -X POST http://localhost:3001/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "password": "secure-password-123"
  }'
```

Response:
```json
{
  "success": true,
  "username": "alice",
  "token": "eyJhbGc...",
  "expiresIn": 86400
}
```

#### POST `/auth/login`
Authenticate with username/password and get JWT token.

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "password": "secure-password-123"
  }'
```

#### POST `/auth/change-password`
Change the user's password (requires JWT).

```bash
curl -X POST http://localhost:3001/auth/change-password \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "oldPassword": "secure-password-123",
    "newPassword": "new-secure-password-456"
  }'
```

#### POST `/auth/request-password-reset`
Request a password reset token.

```bash
curl -X POST http://localhost:3001/auth/request-password-reset \
  -H "Content-Type: application/json" \
  -d '{"username": "alice"}'
```

Response:
```json
{
  "success": true,
  "resetToken": "abc123...",
  "expiresIn": 3600
}
```

#### POST `/auth/reset-password`
Reset password with a reset token.

```bash
curl -X POST http://localhost:3001/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "resetToken": "abc123...",
    "newPassword": "new-secure-password-456"
  }'
```

### Write Proxy

#### POST `/proxy/write`
Proxy a write request with server signing.

```bash
curl -X POST http://localhost:3001/proxy/write \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "uri": "mutable://posts/post-123",
    "data": {"title": "My Post", "content": "..."},
    "encrypt": false
  }'
```

For encrypted writes (using server's encryption key):
```bash
curl -X POST http://localhost:3001/proxy/write \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "uri": "mutable://encrypted/secret-doc",
    "data": {"sensitive": "information"},
    "encrypt": true
  }'
```

### Public Keys

#### GET `/public-keys/:username`
Get user's public keys (no authentication required).

```bash
curl http://localhost:3001/public-keys/alice
```

Response:
```json
{
  "success": true,
  "username": "alice",
  "accountPublicKeyHex": "abc123...",
  "encryptionPublicKeyHex": "def456..."
}
```

### Health

#### GET `/health`
Health check endpoint.

```bash
curl http://localhost:3001/health
```

## Data Storage Schema

The wallet server uses b3nd's schema system to validate writes. Data is stored at:

- `wallet://users/{username}` - User profile
- `wallet://users/{username}/password` - Password hash + salt
- `wallet://users/{username}/account-key` - Ed25519 private key
- `wallet://users/{username}/encryption-key` - X25519 private key
- `wallet://reset-tokens/{token}` - Password reset tokens
- `wallet://server/identity-key` - Server's Ed25519 key
- `wallet://server/encryption-key` - Server's X25519 key

## Deployment Scenarios

### Single Backend (Development)
Both credential and proxy clients point to the same b3nd instance:

```bash
CREDENTIAL_NODE_URL=http://localhost:8080
PROXY_NODE_URL=http://localhost:8080
```

### Separate Backends (Production)
- Credential backend: Secure, access-controlled b3nd instance
- Proxy backend: Public-facing b3nd instance for user data

```bash
CREDENTIAL_NODE_URL=https://credentials.internal.example.com
PROXY_NODE_URL=https://api.example.com
```

## Security Considerations

1. **Server Keys**: Generated on first run, stored in `server-keys.json`. Protect this file!
2. **JWT Secret**: Use a strong, random value (minimum 32 characters)
3. **HTTPS**: Always use HTTPS in production
4. **CORS**: Restrict to trusted origins
5. **Password Hashing**: Uses PBKDF2 with SHA-256 (100,000 iterations)
6. **Reset Tokens**: Single-use, expiring tokens

## Development

### Type Checking
```bash
deno task check
```

### Directory Structure
```
wallet-server/
├── src/
│   ├── mod.ts            # Main server entry point
│   ├── config.ts         # Configuration loading
│   ├── schema.ts         # B3nd schema definition
│   ├── auth.ts           # Authentication logic
│   ├── jwt.ts            # JWT token management
│   ├── keys.ts           # User key generation
│   ├── server-keys.ts    # Server identity keys
│   └── proxy.ts          # Write proxy logic
├── deno.json             # Deno configuration
└── README.md             # This file
```

## Future Enhancements

- [ ] Email-based password reset (send tokens via email)
- [ ] User profile management (display name, avatar, etc.)
- [ ] API key authentication (for server-to-server)
- [ ] Rate limiting
- [ ] Audit logging
- [ ] Key rotation support
- [ ] Multi-factor authentication
- [ ] WebAuthn/passkey support

## License

Apache-2.0
