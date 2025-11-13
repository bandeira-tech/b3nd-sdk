# @b3nd/sdk/wallet

Client library for interacting with B3nd wallet servers. Provides a simple, type-safe interface for authentication, key management, and proxied writes.

## Features

- 🔐 **Authentication**: Signup, login, password management
- 🔑 **Key Management**: Retrieve user public keys
- ✍️ **Proxy Writes**: Write data through the wallet server with automatic signing
- 🌐 **Universal**: Works in both Deno and browser environments
- 📦 **Type-Safe**: Full TypeScript support

## Installation

### Deno

```typescript
import { WalletClient } from "@b3nd/sdk/wallet";
```

### npm (Browser)

```bash
npm install @bandeira-tech/b3nd-sdk
```

```typescript
import { WalletClient } from "@bandeira-tech/b3nd-sdk/wallet";
```

## Quick Start

```typescript
import { WalletClient } from "@b3nd/sdk/wallet";

// Create client instance
const wallet = new WalletClient({
  walletServerUrl: "http://localhost:3001",
  apiBasePath: "/api/v1",
});

// App-scoped signup/login (requires app token and session from App Backend)
// const session = await wallet.signupWithToken(token, { username: "alice", password: "secure-password-123" });

// Set the session to authenticate subsequent requests
wallet.setSession(session);

console.log("Signed up:", session.username);
console.log("Token expires in:", session.expiresIn, "seconds");

// Write data through the proxy
await wallet.proxyWrite({
  uri: "mutable://data/my-app/profile",
  data: { name: "Alice", bio: "B3nd user" },
  encrypt: true  // Optional: encrypt the payload
});

// Get user's public keys
const keys = await wallet.getMyPublicKeys();
console.log("Account key:", keys.accountPublicKeyHex);
console.log("Encryption key:", keys.encryptionPublicKeyHex);
```

## API Reference

### Constructor

```typescript
new WalletClient(config: WalletClientConfig)
```

**Config options:**
- `walletServerUrl` (required): URL of the wallet server
- `apiBasePath` (required): API base path, e.g. "/api/v1"
- `fetch` (optional): Custom fetch implementation

### Authentication Methods

#### `signupWithToken(token, credentials)`

Create a new user account for a given app token. Returns session data - call `setSession()` to activate it.

#### `loginWithTokenSession(token, session, credentials)`

Login with app token and session. Returns session data - call `setSession()` to activate it.

#### `logout()`

Clear the current session.

```typescript
wallet.logout();
```

#### `changePassword(oldPassword, newPassword)`

Change the password for the current user. Requires authentication.

```typescript
await wallet.changePassword("old-password", "new-password");
```

#### `requestPasswordResetWithToken(token, username)`

Request a password reset token scoped to an app.

#### `resetPasswordWithToken(token, username, resetToken, newPassword)`

Reset password using a reset token scoped to an app. Returns session data - call `setSession()` to activate it.

### Session Management

#### `getSession()`

Get the current authenticated session.

```typescript
const session = wallet.getSession();
if (session) {
  console.log("Logged in as:", session.username);
}
```

#### `setSession(session)`

Set the current session (useful for restoring from storage).

```typescript
// Restore from localStorage
const savedSession = JSON.parse(localStorage.getItem("session"));
wallet.setSession(savedSession);
```

#### `isAuthenticated()`

Check if user is currently authenticated.

```typescript
if (wallet.isAuthenticated()) {
  console.log("User is logged in");
}
```

#### `getUsername()`

Get current username (if authenticated).

```typescript
const username = wallet.getUsername();
```

#### `getToken()`

Get current JWT token (if authenticated).

```typescript
const token = wallet.getToken();
```

### Key Management

#### `getPublicKeys()`

Get public keys for the current authenticated user. Requires authentication.

```typescript
const keys = await wallet.getPublicKeys();
console.log("Account key:", keys.accountPublicKeyHex);
console.log("Encryption key:", keys.encryptionPublicKeyHex);
```

#### `getMyPublicKeys()`

Alias for `getPublicKeys()`.

### Proxy Methods

#### `proxyWrite(request)`

Proxy a write request through the wallet server. The server signs the write with its identity key. Requires authentication.

```typescript
await wallet.proxyWrite({
  uri: "mutable://data/my-app/profile",
  data: { name: "Alice" },
  encrypt: false  // Set to true to encrypt the payload
});
```

### Utility Methods

#### `health()`

Check wallet server health.

```typescript
const health = await wallet.health();
console.log("Server status:", health.status);
```

## Session Persistence Example

```typescript
import { WalletClient } from "@b3nd/sdk/wallet";

const wallet = new WalletClient({
  walletServerUrl: "http://localhost:3001",
  apiBasePath: "/api/v1",
});

// Restore session from localStorage on page load
const savedSession = localStorage.getItem("walletSession");
if (savedSession) {
  wallet.setSession(JSON.parse(savedSession));
}

// Login and save session
async function login(token: string, sessionKey: string, username: string, password: string) {
  const session = await wallet.loginWithTokenSession(token, sessionKey, { username, password });

  // Activate the session
  wallet.setSession(session);

  // Persist to storage
  localStorage.setItem("walletSession", JSON.stringify(session));

  return session;
}

// Logout and clear session
function logout() {
  wallet.logout();
  localStorage.removeItem("walletSession");
}
```

## Error Handling

All methods throw errors on failure. Use try-catch blocks:

```typescript
try {
  await wallet.login({ username: "alice", password: "wrong" });
} catch (error) {
  console.error("Login failed:", error.message);
}
```

## TypeScript Support

The wallet client is fully typed. Import types as needed:

```typescript
import type {
  WalletClientConfig,
  AuthSession,
  UserPublicKeys,
  ProxyWriteRequest
} from "@b3nd/sdk/wallet";
```

## License

MIT
