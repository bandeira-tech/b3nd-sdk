# Auth Protocol for Firecat

> Serverless authentication through deterministic key derivation.

## Core Insight

On Firecat, **identity IS a keypair**. There is no user database, no session
store, no auth server. A user's Ed25519 signing keypair and X25519 encryption
keypair are derived deterministically from credentials. The same credentials
always produce the same identity. Recovery is re-derivation.

## Password Authentication

### Flow

```
Credentials                    Derivation                     Identity
  │                               │                              │
  ├─ username ─────────────────>  │                              │
  ├─ password ─────────────────>  │                              │
  ├─ app salt ─────────────────>  │                              │
  │                               ├─ PBKDF2(password, salt) ──> seed
  │                               ├─ Ed25519(seed) ──────────> signing keypair
  │                               ├─ X25519(seed) ───────────> encryption keypair
  │                               │                              │
  │                               │                              ├─ publicKeyHex = identity
  │                               │                              ├─ can sign messages
  │                               │                              ├─ can decrypt messages
  │                               │                              │
```

### Details

1. **Salt construction**: `${appIdentifier}-${username}` — ties identity to both
   the app and the user
2. **Key derivation**: PBKDF2 with SHA-256, 100,000 iterations minimum,
   producing a 256-bit seed
3. **Signing keypair**: `deriveSigningKeyPairFromSeed(seed)` — Ed25519 keypair
   from the derived seed
4. **Encryption keypair**: `deriveEncryptionKeyPairFromSeed(seed)` — X25519
   keypair from the derived seed
5. **No storage**: Nothing is stored. The keypair is re-derived every session
   from the same credentials.

### Properties

- **Deterministic**: Same credentials → same keypair → same identity, always
- **Stateless**: No server, no database, no session tokens
- **Recoverable**: Lost device? Re-derive from credentials on a new device.
- **App-scoped**: Different apps produce different identities for the same user
  (different salt)

### Security Considerations

- Password strength is the sole protection. Weak passwords mean guessable
  identities.
- No rate limiting on derivation (it's client-side). PBKDF2 iterations provide
  computational cost.
- Username is public (part of the salt). Password is the only secret.
- Changing passwords means changing identity. There is no "password reset" —
  it's a new keypair.

## OAuth Authentication

### The Problem

OAuth tokens (Google, GitHub, etc.) require server-side verification. The ID
token must be checked against the provider's public keys. A pure client can't do
this securely — it needs a trusted party to verify the token and provide a
stable secret for key derivation.

Most Firecat apps are SPAs or frontend-only. They have no backend server to hold
a client secret or handle token exchange. **PKCE (Proof Key for Code Exchange)**
solves this: the SPA handles the full OAuth authorization code flow itself, then
passes the resulting ID token to a Firecat trusted party for deterministic key
derivation.

### PKCE: Why and How

**The problem PKCE solves:** In the OAuth authorization code flow, a public
client (SPA) can't securely store a `client_secret`. Without PKCE, an attacker
who intercepts the authorization code could exchange it for tokens. PKCE binds
the code to the client that requested it.

**The mechanism:**

```
SPA                          Provider (Google)              Trusted Party
 │                                │                              │
 ├─ verifier = randomBytes(32)    │                              │
 ├─ challenge = SHA256(verifier)  │                              │
 ├─ /authorize?                   │                              │
 │   code_challenge=challenge     │                              │
 │   code_challenge_method=S256 ─>│                              │
 │                                ├── user authenticates         │
 │<─ redirect with ?code=xxx ─────│                              │
 ├─ POST /token                   │                              │
 │   code=xxx                     │                              │
 │   code_verifier=verifier ─────>│                              │
 │                                ├── SHA256(verifier)==challenge?│
 │<─ { id_token, access_token } ──│                              │
 │                                │                              │
 ├─ send id_token to trusted party ────────────────────────────>│
 │                                │                    ├── verify(token, JWKS)
 │                                │                    ├── HMAC(secret, sub)
 │<─ encrypted deterministic secret ───────────────────────────│
 ├─ deriveIdentity(secret)        │                              │
 │                                │                              │
```

**Key point:** PKCE is the standard first half of the flow. The Firecat-specific
second half (trusted party + HMAC + key derivation) is the same regardless of
how the token was obtained. PKCE just makes it safe to do the first half from a
public client.

### API Surface

```typescript
// Proposed: libs/b3nd-encrypt/mod.ts
generateCodeVerifier(): string
  // 32 random bytes, base64url-encoded (43 chars)

generateCodeChallenge(verifier: string): Promise<string>
  // SHA-256 hash of verifier, base64url-encoded
```

These are thin wrappers over Web Crypto API — no external dependencies, works in
browser and Deno.

### Flow: SPA with PKCE + Custom Node

```
SPA                     Provider         App Node (trusted party)
 │                         │                    │
 ├─ generateCodeVerifier() │                    │
 ├─ generateCodeChallenge()│                    │
 ├─ redirect to /authorize ─>                   │
 │   code_challenge=...    │                    │
 │   code_challenge_method=S256                 │
 │<─ redirect ?code=xxx ───│                    │
 ├─ POST /token            │                    │
 │   code_verifier=... ───>│                    │
 │<─ { id_token } ─────────│                    │
 │                                              │
 ├─ send [auth-uri, {id_token, clientPubKey}] ─>│
 │                                   ├── verify(id_token, JWKS)
 │                                   ├── extract sub
 │                                   ├── secret = HMAC(nodeSecret, sub)
 │                                   ├── encrypt(secret, clientPubKey)
 │<─ { accepted, encryptedSecret } ─────────────│
 ├─ decrypt(encryptedSecret)                    │
 ├─ deriveIdentity(secret)                      │
```

### Flow: SPA with PKCE + Listener

```
SPA                     Provider         Listener (trusted party)
 │                         │                    │
 ├─ generateCodeVerifier() │                    │
 ├─ generateCodeChallenge()│                    │
 ├─ redirect to /authorize ─>                   │
 │<─ redirect ?code=xxx ───│                    │
 ├─ POST /token ──────────>│                    │
 │<─ { id_token } ─────────│                    │
 │                                              │
 ├─ write(inbox, encrypted{id_token, clientPubKey}) ─>│
 │                                   ├── decrypt(request)
 │                                   ├── verify(id_token, JWKS)
 │                                   ├── secret = HMAC(listenerSecret, sub)
 │                                   ├── encrypt(secret, clientPubKey)
 │                                   ├── write(outbox, encryptedSecret)
 │<─ read(outbox) ──────────────────────────────│
 ├─ decrypt(encryptedSecret)                    │
 ├─ deriveIdentity(secret)                      │
```

### Details

1. **PKCE generation**: Client generates a random code verifier and its SHA-256
   challenge before starting the OAuth flow
2. **Authorization**: Client redirects to the provider with `code_challenge` and
   `code_challenge_method=S256`
3. **Token exchange**: Client exchanges the authorization code + `code_verifier`
   directly with the provider's token endpoint — no backend needed
4. **Token verification**: The trusted party (node or listener) verifies the ID
   token against the provider's JWKS
5. **Deterministic secret**: `HMAC-SHA256(nodeSecret, sub)` where `sub` is the
   provider's stable user identifier
6. **Encrypted response**: The secret is encrypted to the client's public key —
   only the client can read it
7. **Key derivation**: Client uses the secret as input to the same
   `deriveSigningKeyPairFromSeed` / `deriveEncryptionKeyPairFromSeed` functions
   as password auth
8. **Same identity**: The same provider account always produces the same `sub`,
   the same HMAC, the same keypair

### Properties

- **No backend for token exchange**: PKCE lets the SPA handle the OAuth flow
  entirely client-side
- **Provider-stable**: Google's `sub` claim is stable per user per app
- **Node-scoped**: Different nodes (different `nodeSecret`) produce different
  identities
- **Encrypted transit**: The derived secret never travels in plaintext
- **No password needed**: Users authenticate with their existing provider
  credentials
- **Standard**: PKCE is RFC 7636, supported by all major OAuth providers

## Security Model (Honest)

### Who knows what

| Secret              | Who has it                      | Risk if compromised                                                 |
| ------------------- | ------------------------------- | ------------------------------------------------------------------- |
| Password            | User only                       | Identity stolen — attacker becomes the user                         |
| PBKDF2 seed         | Derived in memory, never stored | Same as password compromise                                         |
| Ed25519 private key | Derived in memory, never stored | Can sign as the user                                                |
| X25519 private key  | Derived in memory, never stored | Can decrypt user's messages                                         |
| PKCE code verifier  | Client (briefly, in memory)     | Authorization code interception — attacker completes the OAuth flow |
| Node HMAC secret    | Node operator                   | Can derive any OAuth user's secret                                  |
| OAuth ID token      | Client (briefly), provider      | Short-lived; alone insufficient without HMAC secret                 |
| Derived HMAC secret | Client (briefly, encrypted)     | Identity stolen for that provider+node combo                        |

### Trust boundaries

1. **Password auth**: Trust nothing. All derivation is client-side. Security =
   password strength.
2. **OAuth/PKCE auth**: Trust the node/listener operator. They hold the HMAC
   secret. A compromised operator can derive any user's identity for that node.
   PKCE protects the authorization code exchange but the trusted party is still
   trusted.
3. **Provider trust**: OAuth requires trusting the identity provider (Google,
   GitHub) to correctly identify users.
4. **PKCE scope**: PKCE protects against authorization code interception only.
   It does not protect the ID token after issuance — that's why the token is
   sent encrypted to the trusted party.

### What's NOT protected

- **Metadata**: Who writes where, when. Message patterns are visible even when
  content is encrypted.
- **Public keys**: Your identity (public key) is public by design. Anyone can
  verify your signatures.
- **Password strength**: We don't enforce password policies. Weak passwords =
  weak identity.
- **Key rotation**: Changing credentials = new identity. There's no mechanism to
  migrate data between identities.

## Custodial vs Non-Custodial: The Honest Comparison

Social login requires a trusted third party. This is unavoidable — the OAuth
token must be verified against the provider's keys, and a deterministic secret
must be derived. The question isn't whether to trust someone, but **how much**
to trust them.

### Model A: Custodial (Wallet Server) — removed

> **Note:** The custodial wallet server has been removed from the codebase. This
> section is kept for architectural reference only.

Previously implemented in `libs/b3nd-wallet-server/`.

```
User ──credentials──> Wallet Server ──signs on behalf──> Firecat
                           │
                           ├── verifies OAuth token
                           ├── generates RANDOM keypairs
                           ├── stores private keys (encrypted to itself)
                           └── signs/encrypts for user on every write
```

**What the server holds:** User's private keys (encrypted), password hashes,
OAuth profile mappings.

**Properties:**

- Server can impersonate any user (it holds the keys)
- Server compromise = all identities compromised
- Supports key backup (server stores keys)
- Supports account recovery (server has the mapping)
- Different logins can map to the same identity (server controls the mapping)
- More infrastructure: database, session management, JWT, proxy writes

**When it makes sense:** Apps that need a traditional user account model, key
backup, or multi-provider identity linking. Apps where the operator is trusted
and the convenience trade-off is acceptable.

### Model B: Non-Custodial (Vault Listener)

The proposed HMAC derivation model. The trusted party is minimal.

```
User ──token──> Vault ──HMAC(secret, sub)──> User (derives own keys)
                  │
                  ├── verifies OAuth token
                  ├── derives deterministic secret via HMAC
                  ├── encrypts secret to client's public key
                  └── NEVER sees or stores the user's keypairs
```

**What the server holds:** One HMAC secret (`nodeSecret`). No user database, no
private keys, no sessions.

**Properties:**

- Server can _derive_ any user's secret (it holds `nodeSecret`) — but never
  handles key material
- Server compromise = attacker can derive secrets, but must also know which
  `sub` values to target
- No key storage — re-derivation IS recovery
- Identity is deterministic: same credential always = same keypair
- Different vaults produce different identities (scoped to `nodeSecret`)
- Minimal infrastructure: just a Firecat listener with one secret

**When it makes sense:** SPAs and frontend-only apps. Apps that want minimal
trust. Apps where users should own their keys. The default for Firecat.

### The Honest Truth

Both models require trusting the third party. The difference is **attack
surface**:

| Dimension                | Custodial (Wallet)             | Non-Custodial (Vault)                        |
| ------------------------ | ------------------------------ | -------------------------------------------- |
| What server stores       | Private keys + user DB         | One HMAC secret                              |
| Server compromise impact | All keys exposed directly      | Attacker can derive secrets (must know subs) |
| Key material in transit  | Server handles keys constantly | Secret passes encrypted once per login       |
| Infrastructure needed    | Database, sessions, proxy      | Firecat listener + one env var               |
| User owns keys?          | No — server holds them         | Yes — client derives them                    |
| Key backup               | Server provides it             | No backup — re-derive from credential        |
| Multi-provider linking   | Yes (server maps identities)   | No (each provider = independent identity)    |

### Recommendation for SPAs

**Use the non-custodial vault.** Most Firecat apps are SPAs. The vault listener
is:

- Simpler to operate (no database, no key storage)
- Safer to compromise (one secret vs. entire key database)
- Aligned with Firecat's principle (users own their data with their keys)
- Composable (just a Firecat message listener, not a specialized server)

The vault listener is the **default auth service for Firecat apps**. The
custodial wallet server exists for apps that explicitly need traditional account
management.

### The Vault Handler

The vault is a handler — a portable function that verifies tokens and returns
secrets:

```typescript
const vaultHandler = createVaultHandler({
  nodeSecret: "hmac-secret",
  verifiers: new Map([["google", googleVerifier]]),
});
// (request: { provider, token }) => Promise<{ secret, provider }>
```

The handler:

1. Receives a decrypted request (OAuth ID token + provider name)
2. Verifies the token against the provider's JWKS
3. Derives `HMAC(nodeSecret, provider:sub)` — a deterministic secret
4. Returns the secret

That's it. No database. No sessions. No key storage. One HMAC secret.

The handler doesn't know about transport, encryption, or deployment. It plugs
into either deployment mode (see `docs/design/backend-services.md`):

**Embedded in a custom node** — auth at write time:

```typescript
when(isAuthRequest, respondTo(vaultHandler, { identity }));
```

**Connected remotely** — async auth service:

```typescript
connect(firecatNode, {
  filter: isAuthRequest,
  handler: respondTo(vaultHandler, { identity }),
});
```

Encryption/decryption, signing, and response routing are handled by
`respondTo()` — a b3nd compose primitive that wraps any handler for use in the
compose pipeline. The handler stays pure.

## Multi-Provider Support

**Status: Deferred**

### The Question

Should a user be able to link multiple auth methods (password + Google + GitHub)
to the same Firecat identity?

### The Trade-offs

**For:**

- Users expect "log in with Google OR password"
- Account recovery options
- Gradual migration between providers

**Against:**

- Requires a mapping layer (identity → multiple credentials), which means
  storage
- Breaks the "no server" property of password auth
- Introduces complexity in the trust model (who manages the mapping?)
- The mapping itself becomes a high-value target

### Current Position

Each auth method produces an independent identity. Multi-provider linking is a
future protocol extension that requires careful design. We document the desire
but don't commit to an approach.

---

## Decision Log

| Decision                                         | Status       | Rationale                                                              |
| ------------------------------------------------ | ------------ | ---------------------------------------------------------------------- |
| PKCE for all SPA/frontend OAuth flows            | **accepted** | RFC 7636; required for public clients; no client_secret needed         |
| PKCE as primary OAuth pattern                    | **accepted** | Most Firecat apps are SPAs; PKCE is the default, not an alternative    |
| PBKDF2 for password-based key derivation         | **accepted** | Web Crypto API native, well-understood, tunable iterations             |
| HMAC-SHA256 for OAuth secret derivation          | **accepted** | Deterministic, fast, standard; `sub` is stable per provider            |
| 100,000 PBKDF2 iterations minimum                | **accepted** | Balance of security and UX; configurable upward                        |
| Salt = appId + username                          | **accepted** | Prevents cross-app identity collision                                  |
| No key storage                                   | **accepted** | Core design principle: derive, don't store                             |
| Code verifier = 32 random bytes, base64url       | **accepted** | RFC 7636 minimum is 43 chars; 32 bytes base64url = 43 chars exactly    |
| Challenge method = S256 only                     | **accepted** | `plain` method is insecure; all modern providers support S256          |
| Non-custodial vault as default for SPAs          | **accepted** | Minimal trust surface, user owns keys, aligned with Firecat principles |
| Custodial wallet for explicit account management | **accepted** | Exists for apps that need key backup, multi-provider linking           |
| Vault listener as Firecat message participant    | **accepted** | Not a specialized server — just a listener, composable with network    |
| Multi-provider linking                           | **deferred** | Requires storage/mapping, breaks serverless property                   |
| Key rotation / migration                         | **deferred** | Significant protocol extension; needs identity-linking first           |
