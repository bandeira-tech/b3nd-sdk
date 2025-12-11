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
PORT=3001

# B3nd backend URLs
CREDENTIAL_NODE_URL=http://localhost:8080  # For storing user keys
PROXY_NODE_URL=http://localhost:8080       # For proxying user writes

# JWT configuration
JWT_SECRET=your-super-secret-key-at-least-32-characters-long
JWT_EXPIRATION_SECONDS=86400               # 24 hours

# Server keys storage
SERVER_KEYS_PATH=./server-keys.json

# App backend bootstrap (register wallet app on startup)
APP_BACKEND_URL=http://localhost:8844
APP_BACKEND_API_BASE_PATH=/api/v1
BOOTSTRAP_APP_STATE_PATH=./wallet-app-bootstrap.json

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
3. Register a "wallet app" on the app-backend using the server keys (writes state to `BOOTSTRAP_APP_STATE_PATH`)
4. Start listening on the configured port

### Wallet app bootstrap

- On startup the wallet server registers an app on the configured app-backend using the server identity/encryption keys.
- The resulting app token (format: `<appKey>.<tokenId>`) is stored in `BOOTSTRAP_APP_STATE_PATH` and logged at startup.
- To log into the wallet server for the first time, use that app token to create a session via the app-backend (`POST /api/v1/app/{appKey}/session`) and then call the wallet signup/login endpoints with the token + session.
- Registering any other app still requires a wallet JWT, so you must be logged into the wallet server first.

## API Endpoints

### Authentication

All authentication routes include the wallet app key as the final path segment. Set an environment variable for examples:

```bash
APP_KEY="<wallet-app-key>"
```

#### POST `/api/v1/auth/signup/:appKey`
Create a new user account and generate keys.

```bash
curl -X POST http://localhost:3001/api/v1/auth/signup/${APP_KEY} \
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

#### POST `/api/v1/auth/login/:appKey`
Authenticate with username/password and get JWT token.

```bash
curl -X POST http://localhost:3001/api/v1/auth/login/${APP_KEY} \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "password": "secure-password-123"
  }'
```

#### GET `/api/v1/auth/verify/:appKey`
Validate a JWT and retrieve the username/expiration.

```bash
curl http://localhost:3001/api/v1/auth/verify/${APP_KEY} \
  -H "Authorization: Bearer <jwt-token>"
```

#### POST `/api/v1/auth/credentials/change-password/:appKey`
Change the user's password (requires JWT).

```bash
curl -X POST http://localhost:3001/api/v1/auth/credentials/change-password/${APP_KEY} \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "oldPassword": "secure-password-123",
    "newPassword": "new-secure-password-456"
  }'
```

#### POST `/api/v1/auth/credentials/request-password-reset/:appKey`
Request a password reset token.

```bash
curl -X POST http://localhost:3001/api/v1/auth/credentials/request-password-reset/${APP_KEY} \
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

## Container image

Build an OCI image with the bundled Dockerfile:
```bash
docker build -t b3nd-wallet-server -f installations/wallet-server/Dockerfile installations/wallet-server
```

Run with your required configuration passed explicitly:
```bash
docker run --rm -p 8843:8843 \
  -e PORT=8843 \
  -e CREDENTIAL_NODE_URL=http://backend:8842 \
  -e PROXY_NODE_URL=http://backend:8842 \
  -e JWT_SECRET=replace-with-32-plus-char-secret \
  -e SERVER_KEYS_PATH=/data/server-keys.json \
  -e BOOTSTRAP_APP_STATE_PATH=/data/wallet-app-bootstrap.json \
  -v "$(pwd)/wallet-data:/data" \
  b3nd-wallet-server
```

Provide additional environment variables as needed (for example `APP_BACKEND_URL`, `APP_BACKEND_API_BASE_PATH`, or `ALLOWED_ORIGINS`). Mount a persistent volume for any files you expect to survive container restarts, such as the server key material and bootstrap state. You can also supply a prepared `.env` file via `--env-file` if you prefer to manage configuration outside the image.

When using `--env-file`, avoid quoting the hex public keys; use `SERVER_IDENTITY_PUBLIC_KEY_HEX=abc...` (64 hex chars) rather than `"abc..."`. PEM values may include escaped newlines and can be quoted if needed.

#### POST `/api/v1/auth/credentials/reset-password/:appKey`
Reset password with a reset token.

```bash
curl -X POST http://localhost:3001/api/v1/auth/credentials/reset-password/${APP_KEY} \
  -H "Content-Type: application/json" \
  -d '{
    "resetToken": "abc123...",
    "newPassword": "new-secure-password-456"
  }'
```

### Write Proxy

#### POST `/api/v1/proxy/write`
Proxy a write request with server signing.

```bash
curl -X POST http://localhost:3001/api/v1/proxy/write \
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
curl -X POST http://localhost:3001/api/v1/proxy/write \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "uri": "mutable://encrypted/secret-doc",
    "data": {"sensitive": "information"},
    "encrypt": true
  }'
```

### Public Keys

#### GET `/api/v1/auth/public-keys/:appKey`
Get the current user's public keys in the context of the wallet app (requires JWT).

```bash
curl http://localhost:3001/api/v1/auth/public-keys/${APP_KEY} \
  -H "Authorization: Bearer <jwt-token>"
```

Response:
```json
{
  "success": true,
  "accountPublicKeyHex": "abc123...",
  "encryptionPublicKeyHex": "def456..."
}
```

### Health

#### GET `/api/v1/health`
Health check endpoint.

```bash
curl http://localhost:3001/api/v1/health
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
