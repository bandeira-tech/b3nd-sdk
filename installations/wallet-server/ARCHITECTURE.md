# B3nd Wallet Server - Architecture

## Design Philosophy

The wallet server solves a fundamental UX problem in crypto: **users shouldn't have to manage private keys**.

Instead of requiring users to:
1. Generate and securely store private keys locally
2. Sign every transaction with their keys
3. Deal with key backup/recovery

The wallet server provides a **familiar web experience**:
1. Log in with username/password
2. Data is automatically signed and encrypted
3. Password reset works like any web app

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Web Application                          │
│                   (browser/mobile/API)                       │
└───────────────────────────┬─────────────────────────────────┘
                            │
                    HTTP + JWT Authentication
                            │
        ┌───────────────────▼───────────────────┐
        │   B3nd Wallet Server (port 3001)      │
        │                                       │
        │  ┌─────────────────────────────────┐ │
        │  │    Hono HTTP Framework          │ │
        │  │                                 │ │
        │  ├─ /auth/signup                  │ │
        │  ├─ /auth/login                   │ │
        │  ├─ /auth/change-password         │ │
        │  ├─ /auth/request-password-reset  │ │
        │  ├─ /auth/reset-password          │ │
        │  ├─ /proxy/write                  │ │
        │  └─ /public-keys/:username        │ │
        │  └─ /health                       │ │
        │  └────────────────────────────────┘ │
        │                                       │
        │  ┌─────────────────────────────────┐ │
        │  │   JWT Token Management          │ │
        │  │   (create, verify, decode)      │ │
        │  └─────────────────────────────────┘ │
        │                                       │
        │  ┌─────────────────────────────────┐ │
        │  │   Cryptographic Operations      │ │
        │  │                                 │ │
        │  │  Server Keys:                   │ │
        │  │  ├─ Ed25519 (signing)           │ │
        │  │  └─ X25519 (encryption)         │ │
        │  │                                 │ │
        │  │  User Key Management:           │ │
        │  │  ├─ Generate Ed25519 on signup  │ │
        │  │  ├─ Generate X25519 on signup   │ │
        │  │  ├─ Store in credential backend │ │
        │  │  └─ Sign/encrypt on write       │ │
        │  │                                 │ │
        │  │  Password Hashing:              │ │
        │  │  └─ PBKDF2 (SHA-256, 100k iter)│ │
        │  └─────────────────────────────────┘ │
        │                                       │
        │  Server Keys Storage:                │
        │  └─ server-keys.json (local file)    │
        └───────┬──────────────────┬───────────┘
                │                  │
      ┌─────────▼────────┐ ┌───────▼──────────┐
      │  Credential      │ │  Proxy Backend   │
      │  Backend (b3nd)  │ │  (b3nd)          │
      │                  │ │                  │
      │  Stores:         │ │  Stores:         │
      │  - User profiles │ │  - User data     │
      │  - Passwords     │ │  - Posts, etc    │
      │  - User keys     │ │  - Encrypted     │
      │  - Reset tokens  │ │    content       │
      │  - Server keys   │ │                  │
      └──────────────────┘ └──────────────────┘
```

## Core Components

### 1. **HTTP Server (mod.ts)**
- Hono-based REST API
- Request/response handling
- CORS middleware
- Logging middleware

### 2. **Authentication (auth.ts)**
- User signup/login
- Password hashing with PBKDF2
- Password reset flow
- Credentials stored in b3nd backend

### 3. **JWT Token Management (jwt.ts)**
- Create JWT tokens (HMAC-SHA256)
- Verify and decode JWTs
- Token expiration handling
- Stateless authentication

### 4. **Key Generation (keys.ts)**
- Generate user Ed25519 keys (for signing)
- Generate user X25519 keys (for encryption)
- Store in credential backend
- Load on demand

### 5. **Server Identity (server-keys.ts)**
- Generate and load server keys
- Server Ed25519 key (for signing)
- Server X25519 key (for encryption)
- Persistent storage in `server-keys.json`

### 6. **Write Proxy (proxy.ts)**
- Accept user write requests
- Sign with server's Ed25519 key
- Optionally encrypt with server's X25519 key
- Forward to proxy backend

### 7. **B3nd Schema (schema.ts)**
- Define URI patterns for credential storage
- Validate data structure
- Enforce schema rules

### 8. **Configuration (config.ts)**
- Load from environment variables
- Two separate b3nd clients:
  - **Credential client**: For storing keys/passwords
  - **Proxy client**: For proxying writes

## Data Flow

### Signup Flow

```
User                  Wallet Server                  B3nd Backends
  │                      │                               │
  ├─ POST /auth/signup   │                               │
  │─────────────────────>│                               │
  │                      ├─ Validate username/password   │
  │                      │                               │
  │                      ├─ Hash password                │
  │                      │                               │
  │                      ├─ Generate Ed25519 key         │
  │                      ├─ Generate X25519 key          │
  │                      │                               │
  │                      ├─ Write: wallet://users/{u}    │
  │                      ├──────────────────────────────>│
  │                      │                               │
  │                      ├─ Write: wallet://users/{u}/password
  │                      ├──────────────────────────────>│
  │                      │                               │
  │                      ├─ Write: wallet://users/{u}/account-key
  │                      ├──────────────────────────────>│
  │                      │                               │
  │                      ├─ Write: wallet://users/{u}/encryption-key
  │                      ├──────────────────────────────>│
  │                      │                               │
  │                      ├─ Create JWT token             │
  │                      │                               │
  │<─ {token, expires}   │                               │
  │<─────────────────────┤                               │
```

### Write Flow

```
App                   Wallet Server          Credential Backend    Proxy Backend
 │                         │                        │                    │
 ├─ POST /proxy/write       │                        │                    │
 │ + JWT Token              │                        │                    │
 ├────────────────────────> │                        │                    │
 │                          ├─ Verify JWT           │                    │
 │                          ├─ Sign data with       │                    │
 │                          │  server Ed25519       │                    │
 │                          │                        │                    │
 │                          ├─ [Optional] Encrypt   │                    │
 │                          │  with server X25519   │                    │
 │                          │                        │                    │
 │                          ├─ Forward to proxy client                    │
 │                          ├───────────────────────────────────────────>│
 │                          │                        │                    ├─ Store
 │                          │<────────────────────────────────────────────┤
 │                          │                        │                    │
 │<─ {success, record}      │                        │                    │
 │<────────────────────────┤                        │                    │
```

### Password Reset Flow

```
User                  Wallet Server              B3nd Backend
 │                         │                         │
 ├─ POST /auth/request-     │                         │
 │   password-reset         │                         │
 │────────────────────────> │                         │
 │                          ├─ Generate token        │
 │                          │                         │
 │                          ├─ Write reset token     │
 │                          ├────────────────────────>│
 │                          │                         │
 │<─ {resetToken}           │                         │
 │<────────────────────────┤                         │
 │                          │                         │
 ├─ POST /auth/reset-       │                         │
 │   password               │                         │
 │ + resetToken             │                         │
 │────────────────────────> │                         │
 │                          ├─ Verify token          │
 │                          ├─ Check expiration      │
 │                          │                         │
 │                          ├─ Hash new password     │
 │                          │                         │
 │                          ├─ Update password       │
 │                          ├────────────────────────>│
 │                          │                         │
 │                          ├─ Delete reset token    │
 │                          ├────────────────────────>│
 │                          │                         │
 │<─ {token}                │                         │
 │<────────────────────────┤                         │
```

## Key Management

### Server Keys

Generated on first run, stored in `server-keys.json`:

```json
{
  "identityKey": {
    "privateKeyPem": "-----BEGIN PRIVATE KEY-----\n...",
    "publicKeyHex": "abc123def456...",
    "createdAt": "2024-11-07T12:00:00Z"
  },
  "encryptionKey": {
    "privateKeyPem": "-----BEGIN PRIVATE KEY-----\n...",
    "publicKeyHex": "xyz789abc123...",
    "createdAt": "2024-11-07T12:00:00Z"
  }
}
```

**Protect this file!** It contains private keys.

### User Keys

Generated on signup, stored in credential backend:

- **Account Key (Ed25519)**: For signing writes
- **Encryption Key (X25519)**: For encrypting sensitive data

Stored at:
- `wallet://users/{username}/account-key`
- `wallet://users/{username}/encryption-key`

## Deployment Scenarios

### Scenario 1: Development (Single Backend)

```
Web App → Wallet Server → B3nd Backend (both credential and proxy)
```

Configuration:
```bash
CREDENTIAL_NODE_URL=http://localhost:8080
PROXY_NODE_URL=http://localhost:8080
```

### Scenario 2: Production (Separate Backends)

```
Web App → Wallet Server → ┬─ Credential B3nd (private/secure)
                          └─ Proxy B3nd (public-facing)
```

Configuration:
```bash
CREDENTIAL_NODE_URL=https://secure-internal.example.com
PROXY_NODE_URL=https://api.example.com
```

### Scenario 3: Multi-App with Shared Wallet

```
App 1 ─┐
App 2 ─┼─ Wallet Server → Credential B3nd (shared)
App 3 ─┘       │
              └─ Multiple Proxy B3nds (per-app backends)
```

Configuration:
```bash
CREDENTIAL_NODE_URL=https://wallet-backend.example.com
PROXY_NODE_URL=https://app-api.example.com  # Can be swapped per-app
```

## Security Properties

### Authentication
- **Method**: JWT (HMAC-SHA256)
- **Storage**: Stateless (no session storage needed)
- **Expiration**: Configurable (default 24 hours)

### Passwords
- **Hashing**: PBKDF2-SHA256
- **Iterations**: 100,000
- **Salt**: Random per user
- **Never Logged**: Passwords not in logs

### Keys
- **Ed25519**: For signing (authentication/integrity)
- **X25519**: For encryption (confidentiality)
- **Storage**: Encrypted at rest (password-derived key)
- **Access**: Only via authenticated API

### Signing
- All writes signed with server Ed25519 key
- Signature verifiable with server's public key
- Format: `auth[{pubkey: "server", signature: "..."}]`

### Encryption
- Optional: `encrypt: true` in write request
- Uses server's X25519 key
- Produces: `{data, nonce, ephemeralPublicKey}`

## Scalability Considerations

### Stateless Design
- No session storage needed
- JWTs contain all auth info
- Easy to scale horizontally

### Backend Independence
- Credential and proxy backends can be separate
- Can use different scaling strategies
- Credential backend may need less throughput

### Key Caching
- Consider caching user keys in memory
- Cache invalidation on password change
- Trade-off between memory and latency

## Future Enhancements

1. **Email-based password recovery** - Send reset links via email
2. **API keys** - For server-to-server authentication
3. **Key rotation** - Rotate server keys with zero downtime
4. **Multi-factor authentication** - TOTP or WebAuthn
5. **Rate limiting** - Per-user and global limits
6. **Audit logging** - Track auth and write operations
7. **WebAuthn support** - Passwordless auth
8. **Social login** - OAuth integration (GitHub, Google)
9. **User profiles** - Display name, avatar, metadata
10. **Delegation** - Grant temporary access to other users

## Testing Strategy

### Unit Tests (Future)
- Password hashing/verification
- JWT creation/verification
- Key generation
- Signature verification

### Integration Tests (Future)
- Full signup flow
- Write proxy flow
- Password reset flow
- Error cases

### End-to-End Tests (Future)
- Browser-based tests
- Multiple backends
- Encryption/decryption round-trip

## Monitoring & Observability

Current logging:
- HTTP request logs (method, path, status, duration)
- Error logs with stack traces

Recommended additions:
- Authentication metrics (signup, login, failures)
- Write operations metrics
- Key generation events
- Error rates and types
- Backend connectivity health

## Conclusion

The B3nd Wallet Server provides a user-friendly interface to b3nd's cryptographic capabilities while maintaining security. By managing keys server-side, it reduces friction for end users while preserving the integrity and privacy guarantees that blockchain-style systems provide.
