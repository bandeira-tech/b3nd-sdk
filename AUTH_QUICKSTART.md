# B3nd Authentication Quickstart

A brief guide for implementing authentication in your app using `@bandeira-tech/b3nd-web`.

## Setup

### Install the SDK

```bash
npm install @bandeira-tech/b3nd-web
```

## Implementation

**Note:** These examples use the testnet at `https://testnet-wallet.fire.cat`

**⚠️ Important:** All data written to the B3nd network is **public and readable by anyone**. Sensitive or private data must be encrypted using the SDK's encryption utilities before writing.

### Available URI Schemes

The testnet backend enforces a schema that defines which URI patterns are allowed. **All write URIs must match one of these patterns:**

**Mutable (can be updated):**
- `mutable://open/*` - No authentication required, anyone can write
- `mutable://accounts/:pubkey/*` - Requires signature from the pubkey in the path
  - Example: `mutable://accounts/abc123.../profile`
  - Only the owner of `abc123...` can write to this path

**Immutable (write-once only):**
- `immutable://open/*` - Write once, no authentication required
- `immutable://accounts/:pubkey/*` - Write once with authentication
  - Example: `immutable://accounts/abc123.../certificate/2024`
  - Can only be written once, requires signature from `abc123...`

The `:pubkey` placeholder must be replaced with your app's public key (the `appKey` from `generateAppKeys()`).

### Initialize Clients

```typescript
import { WalletClient } from "@bandeira-tech/b3nd-web/wallet";
import { AppsClient } from "@bandeira-tech/b3nd-web/apps";
import { HttpClient } from "@bandeira-tech/b3nd-web";
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";

const walletClient = new WalletClient({
  walletServerUrl: "https://testnet-wallet.fire.cat",
  apiBasePath: "/api/v1"
});

const appsClient = new AppsClient({
  appServerUrl: "https://testnet-app.fire.cat",
  apiBasePath: "/api/v1"
});

const backendClient = new HttpClient({
  url: "https://testnet.fire.cat"
});
```

### Generate App Keys

```typescript
async function generateAppKeys() {
  const keyPair = await encrypt.generateSigningKeyPair();

  return {
    appKey: keyPair.publicKeyHex,
    accountPrivateKey: keyPair.privateKeyHex
  };
}
```

### Session Keypair Authentication

**IMPORTANT:** Both signup AND login require an approved session keypair. This is a security feature that ensures apps control which authentication attempts are allowed.

The protocol supports both local approval (same process) and remote approval (async workflows):

#### 1. Generate Session Keypair

```typescript
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";

async function generateSessionKeypair() {
  const keypair = await encrypt.generateSigningKeyPair();
  return {
    publicKeyHex: keypair.publicKeyHex,
    privateKeyHex: keypair.privateKeyHex,
  };
}
```

#### 2. Post Session Request (Client)

The client posts a **signed** session request to the app's inbox. The signature proves ownership of the session private key. The payload is arbitrary - app developers decide what info to require:

```typescript
async function requestSession(
  appKey: string,
  sessionKeypair: { publicKeyHex: string; privateKeyHex: string },
  requestPayload: Record<string, unknown> = {}
) {
  // Payload can include anything the app needs to make approval decisions
  // e.g., device info, timestamp, reason, user agent, etc.
  const payload = {
    timestamp: Date.now(),
    ...requestPayload,
  };

  // Create signed message using SDK method (standard { auth, payload } format)
  const signedRequest = await encrypt.createAuthenticatedMessageWithHex(
    payload,
    sessionKeypair.publicKeyHex,
    sessionKeypair.privateKeyHex
  );

  // Write signed request to inbox
  const requestUri = `immutable://inbox/${appKey}/sessions/${sessionKeypair.publicKeyHex}`;
  await backendClient.write(requestUri, signedRequest);
}

// Usage:
const sessionKeypair = await generateSessionKeypair();
await requestSession(appKey, sessionKeypair, {
  deviceId: "browser-abc123",
  userAgent: navigator.userAgent,
});
// Now wait for app to approve...
```

#### 3. Approve Session (App)

The app approves by writing `1` (signed by app's key) to the accounts namespace:

```typescript
async function approveSession(
  appKey: string,           // App's public key (hex)
  appPrivateKeyHex: string, // App's private key (hex)
  sessionPubkey: string     // Session public key to approve
) {
  // Sign approval with app's key
  const signedApproval = await encrypt.createAuthenticatedMessageWithHex(
    1,  // approval value
    appKey,
    appPrivateKeyHex
  );
  await backendClient.write(
    `mutable://accounts/${appKey}/sessions/${sessionPubkey}`,
    signedApproval
  );
}
```

**For local approval** (app and client same process), combine steps 2 and 3:

```typescript
async function createAndApproveSession(
  appKey: string,
  appPrivateKeyHex: string
) {
  const sessionKeypair = await generateSessionKeypair();

  // 1. Post signed request to inbox
  const signedRequest = await encrypt.createAuthenticatedMessageWithHex(
    { timestamp: Date.now() },
    sessionKeypair.publicKeyHex,
    sessionKeypair.privateKeyHex
  );
  await backendClient.write(
    `immutable://inbox/${appKey}/sessions/${sessionKeypair.publicKeyHex}`,
    signedRequest
  );

  // 2. Approve (value = 1, signed by app)
  const signedApproval = await encrypt.createAuthenticatedMessageWithHex(
    1,
    appKey,
    appPrivateKeyHex
  );
  await backendClient.write(
    `mutable://accounts/${appKey}/sessions/${sessionKeypair.publicKeyHex}`,
    signedApproval
  );

  return sessionKeypair;
}
```

**That's the complete protocol!** Just two writes to the data node using HttpClient.

#### 4. Signup with Password (Requires Approved Session)

```typescript
async function signup(
  username: string,
  password: string,
  appKey: string,
  sessionKeypair: { publicKeyHex: string; privateKeyHex: string }
) {
  const result = await walletClient.signup(
    appKey,
    sessionKeypair,
    { type: 'password', username, password }
  );

  // Returns: { success, username, token, expiresIn }
  return result;
}

// Usage:
const sessionKeypair = await generateSessionKeypair();
await approveSession(appKey, sessionKeypair.publicKeyHex, accountPrivateKey);
const result = await signup("alice", "password123", appKey, sessionKeypair);
```

#### 5. Login with Password (Requires Approved Session)

```typescript
async function login(
  username: string,
  password: string,
  appKey: string,
  sessionKeypair: { publicKeyHex: string; privateKeyHex: string }
) {
  const result = await walletClient.login(
    appKey,
    sessionKeypair,
    { type: 'password', username, password }
  );

  // Returns: { success, username, token, expiresIn }
  return result;
}

// Usage:
const sessionKeypair = await generateSessionKeypair();
await approveSession(appKey, sessionKeypair.publicKeyHex, accountPrivateKey);
const result = await login("alice", "password123", appKey, sessionKeypair);
```

### Google OAuth Setup

#### 1. Save Google Client ID in App Profile

```typescript
async function saveAppProfile(appKey: string, accountPrivateKey: string, googleClientId: string) {
  const profile = {
    googleClientId,
    allowedOrigins: ["*"],
    encryptionPublicKeyHex: null
  };

  const signedProfile = await signPayload(profile, appKey, accountPrivateKey);
  const uri = `mutable://accounts/${appKey}/app-profile`;

  return backendClient.write(uri, signedProfile);
}
```

#### 2. Add Google Sign-In to Your HTML

```html
<script src="https://accounts.google.com/gsi/client" async defer></script>
<div id="google-signin-button"></div>
```

#### 3. Initialize Google Sign-In

```typescript
function initGoogleSignIn(clientId: string, onSignIn: (credential: string) => void) {
  (window as any).google.accounts.id.initialize({
    client_id: clientId,
    callback: (response: { credential: string }) => onSignIn(response.credential)
  });

  (window as any).google.accounts.id.renderButton(
    document.getElementById("google-signin-button"),
    { theme: "filled_blue", size: "large", text: "signup_with" }
  );
}
```

#### 4. Signup with Google (Requires Approved Session)

```typescript
async function googleSignup(
  googleIdToken: string,
  appKey: string,
  sessionKeypair: { publicKeyHex: string; privateKeyHex: string }
) {
  // Sign the payload with the session's private key
  const payload = {
    type: "google",
    googleIdToken,
    sessionPubkey: sessionKeypair.publicKeyHex,
  };
  const sessionSignature = await encrypt.signWithHex(sessionKeypair.privateKeyHex, payload);

  const response = await fetch(
    `https://testnet-wallet.fire.cat/api/v1/auth/signup/${appKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        sessionSignature,
      })
    }
  );

  const data = await response.json();
  // Returns: { username, token, expiresIn, email, name, picture }
  return data;
}

// Usage:
const sessionKeypair = await generateSessionKeypair();
await approveSession(appKey, sessionKeypair.publicKeyHex, accountPrivateKey);
const result = await googleSignup(googleCredential, appKey, sessionKeypair);
```

#### 5. Login with Google (Requires Approved Session)

```typescript
async function googleLogin(
  googleIdToken: string,
  appKey: string,
  sessionKeypair: { publicKeyHex: string; privateKeyHex: string }
) {
  // Sign the payload with the session's private key
  const payload = {
    type: "google",
    googleIdToken,
    sessionPubkey: sessionKeypair.publicKeyHex,
  };
  const sessionSignature = await encrypt.signWithHex(sessionKeypair.privateKeyHex, payload);

  const response = await fetch(
    `https://testnet-wallet.fire.cat/api/v1/auth/login/${appKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        sessionSignature,
      })
    }
  );

  const data = await response.json();
  return data;
}

// Usage:
const sessionKeypair = await generateSessionKeypair();
await approveSession(appKey, sessionKeypair.publicKeyHex, accountPrivateKey);
const result = await googleLogin(googleCredential, appKey, sessionKeypair);
```

## Example: Event Invite System with Slug-Based Encryption

### Complete Flow

```typescript
// 1. Create encrypted event with clean slug
async function createEventInvite(
  session: { username: string; token: string },
  eventName: string,
  eventDate: string,
  password?: string
) {
  walletClient.setSession(session);
  const appKey = getAppKey();

  // Generate slug from event name
  const slug = eventName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  // Derive encryption key from slug + password
  const encryptionKey = await deriveKeyFromSlug(appKey, slug, password || '');

  // Prepare event data
  const eventData = {
    name: eventName,
    date: eventDate,
    createdBy: session.username,
    attendees: []
  };

  // Encrypt
  const encrypted = await encrypt.encrypt(eventData, encryptionKey);

  // Write to B3nd
  await walletClient.proxyWrite({
    uri: `mutable://accounts/:key/celebrations/${slug}`,
    data: {
      encrypted,
      hasPassword: !!password,
      createdAt: new Date().toISOString()
    },
    encrypt: false
  });

  // Return clean shareable URL
  return {
    slug,
    url: `https://app.com/events/${slug}`,
    password: password || null
  };
}

// 2. Guest accesses event
async function viewEvent(slug: string, password?: string) {
  const appKey = getAppKey();

  // Extract username from slug or use lookup
  // For simplicity, assuming username is embedded or known
  const username = await extractUsernameFromSlug(slug);
  const userPubkey = await getUserPubkey(username);

  // Read encrypted event
  const result = await backendClient.read(
    `mutable://accounts/${userPubkey}/celebrations/${slug}`
  );

  if (!result.success) {
    throw new Error('Event not found');
  }

  // Derive key and decrypt
  const decryptionKey = await deriveKeyFromSlug(appKey, slug, password || '');
  const eventData = await encrypt.decrypt(
    result.record.data.encrypted,
    decryptionKey
  );

  return eventData;
}

// 3. Guest submits RSVP
async function submitRSVP(
  slug: string,
  password: string,
  rsvpData: { name: string; email: string; attending: boolean }
) {
  const appKey = getAppKey();
  const rsvpId = crypto.randomUUID();

  // Derive same key
  const encryptionKey = await deriveKeyFromSlug(appKey, slug, password);

  // Encrypt RSVP
  const encrypted = await encrypt.encrypt(rsvpData, encryptionKey);

  // Write to open path (no auth required!)
  await backendClient.write(
    `mutable://open/celebrations/${slug}/rsvps/${rsvpId}`,
    { encrypted, submittedAt: new Date().toISOString() }
  );

  // Update index
  const indexUri = `mutable://open/celebrations/${slug}/rsvp-index`;
  const index = await backendClient.read(indexUri);
  const rsvpIds = index.record?.data?.rsvpIds || [];
  rsvpIds.push(rsvpId);
  await backendClient.write(indexUri, { rsvpIds });

  return rsvpId;
}

// Helper: Extract username from slug or context
async function extractUsernameFromSlug(slug: string): Promise<string> {
  // Option 1: Slug includes username prefix
  // e.g., "alice-michaels-tea-party" → username: "alice"

  // Option 2: Store slug → username mapping
  const result = await backendClient.read(
    `mutable://open/celebrations/slug-lookup/${slug}`
  );
  return result.record?.data?.username;

  // Option 3: URL includes username
  // e.g., /events/alice/michaels-tea-party
}
```

### Write Encrypted Data

```typescript
async function writePrivateNote(
  session: { username: string; token: string },
  note: string
) {
  walletClient.setSession(session);

  // IMPORTANT: The :key placeholder is automatically replaced with
  // the authenticated user's public key by walletClient.proxyWrite()
  const result = await walletClient.proxyWrite({
    uri: `mutable://accounts/:key/private/notes/${Date.now()}`,
    data: { note, timestamp: new Date().toISOString() },
    encrypt: true
  });

  return result;
}
```

**Key Points:**
- `walletClient.proxyWrite()` auto-replaces `:key` with authenticated user's pubkey
- `encrypt: true` uses server-side encryption (wallet server's key)
- For client-side encryption, use `encrypt.encrypt()` and `encrypt.decrypt()`

## Common Patterns

### Username → Pubkey Mapping

For guest access (users without wallet auth), you need to map usernames to public keys:

```typescript
// During signup: Store username → pubkey mapping
async function registerUsername(username: string, userPubkey: string) {
  await backendClient.write(
    `mutable://open/usernames/${username}`,
    {
      pubkey: userPubkey,
      registeredAt: new Date().toISOString()
    }
  );
}

// Guest lookup: Get pubkey from username
async function getUserPubkey(username: string): Promise<string> {
  const result = await backendClient.read(
    `mutable://open/usernames/${username}`
  );
  return result.record?.data?.pubkey;
}
```

### Maintaining Indexes for Queries

B3nd doesn't have built-in querying, so maintain indexes for lists:

```typescript
// Write: Add to index when creating items
async function createEvent(session, eventData) {
  walletClient.setSession(session);

  const eventId = crypto.randomUUID();

  // Write event
  await walletClient.proxyWrite({
    uri: `mutable://accounts/:key/events/${eventId}`,
    data: eventData,
    encrypt: false
  });

  // Update index
  const index = await getEventIndex();
  index.push(eventId);
  await walletClient.proxyWrite({
    uri: `mutable://accounts/:key/event-index`,
    data: { eventIds: index },
    encrypt: false
  });

  return eventId;
}

// Read: Use index to list items
async function listEvents(userPubkey: string) {
  const indexResult = await backendClient.read(
    `mutable://accounts/${userPubkey}/event-index`
  );
  const eventIds = indexResult.record?.data?.eventIds || [];

  // Fetch each event
  const events = await Promise.all(
    eventIds.map(id =>
      backendClient.read(`mutable://accounts/${userPubkey}/events/${id}`)
    )
  );

  return events.map(r => r.record?.data).filter(Boolean);
}
```

### User Encryption Keys vs App Keys

- **App Keys**: For app-level operations (app profile, sessions)
- **User Encryption Keys**: For user-owned encrypted data

```typescript
// Generate user encryption keys on signup
async function setupUserEncryption() {
  const keyPair = await encrypt.generateSigningKeyPair();

  // Store securely (e.g., encrypted with user's password)
  return {
    publicKey: keyPair.publicKeyHex,
    privateKey: keyPair.privateKeyHex // KEEP SECRET!
  };
}

// Encrypt user data with user's public key
async function writeEncryptedUserData(data, userPublicKey) {
  const encrypted = await encrypt.encrypt(data, userPublicKey);

  await walletClient.proxyWrite({
    uri: `mutable://accounts/:key/private/data`,
    data: { encrypted },
    encrypt: false // Already encrypted client-side
  });
}
```

### Encrypted Shareable Content (Deterministic Keys from Slug)

**Scenario:** Create shareable resources where:
- Encryption key is **derived from slug + password** (no random keys to store!)
- Clean URLs: `/events/michaels_tea_party_2026` (no key in hash)
- Guest can decrypt by knowing: slug (from URL) + password (if required)
- Same key is re-derived on any client

**Implementation:**

```typescript
// 1. Derive deterministic encryption key from slug + password
async function deriveKeyFromSlug(
  appKey: string,
  slug: string,
  password: string = ''
): Promise<string> {
  const encoder = new TextEncoder();

  // Combine inputs into deterministic seed
  const seed = `${appKey}:${slug}:${password}`;

  // Use app key as salt for additional entropy
  const salt = encoder.encode(appKey);

  // Import seed as key material
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(seed),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  // Derive 256-bit key
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );

  return Array.from(new Uint8Array(derivedBits))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// 2. Publisher: Create event with slug-based encryption
async function createEvent(
  session: { username: string; token: string },
  eventData: any,
  slug: string, // e.g., "michaels_tea_party_2026"
  password?: string
) {
  walletClient.setSession(session);

  const appKey = getAppKey();

  // Derive key from app + slug + password
  const encryptionKey = await deriveKeyFromSlug(appKey, slug, password || '');

  // Encrypt event data
  const encrypted = await encrypt.encrypt(eventData, encryptionKey);

  // Hash slug to create non-discoverable URI
  const eventHash = await hashString(`${appKey}:${slug}`);
  const eventUri = `mutable://accounts/:key/celebrations/${eventHash}`;

  // Write encrypted event
  await walletClient.proxyWrite({
    uri: eventUri,
    data: {
      encrypted,
      hasPassword: !!password,
      // DON'T store slug here - it's derivable from URL
      createdAt: new Date().toISOString()
    },
    encrypt: false
  });

  // Generate clean shareable URL (slug visible, but URI hash is not!)
  const shareUrl = `https://app.com/events/${slug}`;

  return { slug, shareUrl, eventHash };
}

// Helper: Hash string for URI generation
async function hashString(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// 3. Guest: Access event from URL + password
async function accessEventBySlug(
  username: string,
  slug: string,
  password: string = ''
): Promise<any> {
  const appKey = getAppKey();
  const userPubkey = await getUserPubkey(username);

  // Hash slug to find event URI (same as publisher)
  const eventHash = await hashString(`${appKey}:${slug}`);
  const uri = `mutable://accounts/${userPubkey}/celebrations/${eventHash}`;

  // Read encrypted event
  const result = await backendClient.read(uri);

  if (!result.success || !result.record?.data) {
    throw new Error('Event not found');
  }

  const { encrypted, hasPassword } = result.record.data;

  if (hasPassword && !password) {
    throw new Error('Password required');
  }

  // Derive same key from slug + password
  const decryptionKey = await deriveKeyFromSlug(appKey, slug, password);

  // Decrypt
  try {
    const decrypted = await encrypt.decrypt(encrypted, decryptionKey);
    return decrypted;
  } catch (error) {
    throw new Error('Failed to decrypt: incorrect password');
  }
}

// 4. Guest: Submit RSVP (REQUIRES GUEST WALLET ACCOUNT)
async function submitRSVPToEvent(
  guestSession: { username: string; token: string },
  ownerUsername: string,
  slug: string,
  password: string,
  rsvpData: any
) {
  const appKey = getAppKey();
  walletClient.setSession(guestSession);

  // Derive event key
  const encryptionKey = await deriveKeyFromSlug(appKey, slug, password);

  // Encrypt RSVP
  const encrypted = await encrypt.encrypt(rsvpData, encryptionKey);

  // Hash slug to hide it in URI
  const eventHash = await hashString(`${appKey}:${slug}`);

  // Write to GUEST's own account space
  const rsvpId = crypto.randomUUID();
  await walletClient.proxyWrite({
    uri: `mutable://accounts/:key/rsvps/${eventHash}/${rsvpId}`,
    data: {
      encrypted,
      eventOwner: ownerUsername,
      submittedAt: new Date().toISOString()
    },
    encrypt: false
  });

  return { rsvpId, guestPubkey: guestSession.username };
  // Owner needs to be notified of guest's pubkey to fetch RSVP
}

// 5. Owner: Read RSVPs using slug
async function getEventRSVPs(
  slug: string,
  password: string = ''
) {
  const appKey = getAppKey();

  // Derive key (owner knows slug + password)
  const decryptionKey = await deriveKeyFromSlug(appKey, slug, password);

  // Read RSVP index
  const indexUri = `mutable://open/celebrations/${slug}/rsvp-index`;
  const indexResult = await backendClient.read(indexUri);
  const rsvpIds = indexResult.record?.data?.rsvpIds || [];

  // Read and decrypt each RSVP
  const rsvps = await Promise.all(
    rsvpIds.map(async (rsvpId) => {
      const result = await backendClient.read(
        `mutable://open/celebrations/${slug}/rsvps/${rsvpId}`
      );

      if (result.record?.data?.encrypted) {
        try {
          const decrypted = await encrypt.decrypt(
            result.record.data.encrypted,
            decryptionKey
          );
          return { id: rsvpId, ...decrypted };
        } catch (error) {
          return null;
        }
      }
      return null;
    })
  );

  return rsvps.filter(Boolean);
}
```

**Key Benefits:**
- ✅ **No key storage** - Keys derived on-demand from slug + password
- ✅ **Clean URLs** - `/events/michaels_tea_party_2026` (no hash fragments)
- ✅ **Deterministic** - Same inputs always produce same key
- ✅ **Simple guest flow** - Enter password → derive key → decrypt
- ✅ **No key transmission** - Never send keys over network

**URI Pattern:**
```
Event data:  mutable://accounts/{ownerPubkey}/celebrations/{hash}
  where {hash} = SHA256(appKey + slug)
  → Slug never appears in B3nd URIs (not discoverable!)

Guest RSVP:  mutable://accounts/{guestPubkey}/rsvps/{hash}/{rsvpId}
  → Each guest writes to their own authenticated space
  → Owner needs notification of guest pubkey to fetch RSVP
```

**Critical Issues with Current B3nd:**

❌ **No guest writes to owner's space** - Guests can't append RSVPs to owner's account
❌ **No atomic index updates** - Race conditions on concurrent writes
❌ **`mutable://open/*` is unsafe** - Last-write-wins, anyone can overwrite

**Required Workarounds:**

1. **Guests MUST create wallet accounts** to write RSVPs (write to their own space)
2. **Out-of-band notification** - Guest must notify owner of their pubkey (email, webhook, etc.)
3. **Owner polls** - Owner checks known guest pubkeys for RSVPs

**Access Flow:**
1. Guest visits: `https://app.com/events/michaels_tea_party_2026`
2. Frontend extracts slug: `michaels_tea_party_2026`
3. Guest enters password (if protected): `secret123`
4. Frontend derives key: `deriveKeyFromSlug(appKey, slug, password)`
5. Read encrypted data from B3nd using slug-based URI
6. Decrypt with derived key

**No random keys, no URL hashes, no key management!**

---

### Alternative: Password-Protected with Random Keys

If you need to change passwords without re-encrypting all data:

```typescript
// 1. Derive encryption key from password
async function deriveKeyFromPassword(
  password: string,
  salt: string
): Promise<string> {
  const encoder = new TextEncoder();

  // Import password as key material
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  // Derive 256-bit key using PBKDF2
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );

  // Convert to hex string for use with encrypt.encrypt()
  return Array.from(new Uint8Array(derivedBits))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// 2. Publisher: Create password-protected event
async function publishPasswordProtectedEvent(
  session: { username: string; token: string },
  eventData: any,
  password?: string
) {
  walletClient.setSession(session);

  const eventId = crypto.randomUUID();
  const salt = crypto.randomUUID(); // Unique salt per event

  let encryptionKey: string;
  let passwordHash: string | null = null;

  if (password) {
    // Derive key from password
    encryptionKey = await deriveKeyFromPassword(password, salt);

    // Store password hash for verification (optional)
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(password)
    );
    passwordHash = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } else {
    // Generate random key (URL-only access)
    encryptionKey = (await encrypt.generateSigningKeyPair()).privateKeyHex;
  }

  // Encrypt event data
  const encryptedEvent = await encrypt.encrypt(eventData, encryptionKey);

  // Write encrypted event with metadata
  await walletClient.proxyWrite({
    uri: `mutable://accounts/:key/events/${eventId}`,
    data: {
      encrypted: encryptedEvent,
      salt, // Needed for password derivation
      passwordHash, // Optional: for client-side verification
      hasPassword: !!password,
      createdAt: new Date().toISOString()
    },
    encrypt: false // Already encrypted client-side
  });

  // Generate shareable URL
  let shareUrl = `https://app.com/events/${session.username}/${eventId}`;

  if (!password) {
    // No password: embed key in URL hash
    shareUrl += `#key=${encryptionKey}`;
  }
  // If password: key derived from password on access

  return { eventId, shareUrl, encryptionKey };
}

// 3. Guest: Access and decrypt event
async function accessProtectedEvent(
  username: string,
  eventId: string,
  password?: string,
  urlKey?: string
): Promise<any> {
  // Get user's pubkey for URI construction
  const userPubkey = await getUserPubkey(username);

  // Read encrypted event
  const result = await backendClient.read(
    `mutable://accounts/${userPubkey}/events/${eventId}`
  );

  if (!result.success || !result.record?.data) {
    throw new Error('Event not found');
  }

  const { encrypted, salt, passwordHash, hasPassword } = result.record.data;

  let decryptionKey: string;

  if (hasPassword) {
    // Password-protected: derive key from password
    if (!password) {
      throw new Error('Password required');
    }

    decryptionKey = await deriveKeyFromPassword(password, salt);

    // Optional: verify password before attempting decrypt
    if (passwordHash) {
      const inputHashBuffer = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(password)
      );
      const inputHash = Array.from(new Uint8Array(inputHashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      if (inputHash !== passwordHash) {
        throw new Error('Incorrect password');
      }
    }
  } else {
    // URL-only access: use key from URL hash
    if (!urlKey) {
      throw new Error('Access key required');
    }
    decryptionKey = urlKey;
  }

  // Decrypt event data
  try {
    const decrypted = await encrypt.decrypt(encrypted, decryptionKey);
    return decrypted;
  } catch (error) {
    throw new Error('Failed to decrypt: incorrect password or key');
  }
}

// 4. Guest: Submit RSVP to encrypted event
async function submitGuestRSVP(
  username: string,
  eventId: string,
  rsvpData: any,
  eventDecryptionKey: string // Guest already has this from accessing event
) {
  const rsvpId = crypto.randomUUID();
  const userPubkey = await getUserPubkey(username);

  // Encrypt RSVP with same key as event (so owner can decrypt)
  const encryptedRSVP = await encrypt.encrypt(rsvpData, eventDecryptionKey);

  // Write to open path (no auth required for guest)
  await backendClient.write(
    `mutable://open/events/${username}/${eventId}/rsvps/${rsvpId}`,
    {
      encrypted: encryptedRSVP,
      submittedAt: new Date().toISOString()
    }
  );

  // Update RSVP index
  const indexUri = `mutable://open/events/${username}/${eventId}/rsvp-index`;
  const indexResult = await backendClient.read(indexUri);
  const rsvpIds = indexResult.record?.data?.rsvpIds || [];
  rsvpIds.push(rsvpId);

  await backendClient.write(indexUri, { rsvpIds });

  return rsvpId;
}

// 5. Owner: Read RSVPs with decryption
async function getEventRSVPs(
  session: { username: string; token: string },
  eventId: string,
  decryptionKey: string
) {
  // Read RSVP index
  const indexUri = `mutable://open/events/${session.username}/${eventId}/rsvp-index`;
  const indexResult = await backendClient.read(indexUri);
  const rsvpIds = indexResult.record?.data?.rsvpIds || [];

  // Read and decrypt each RSVP
  const rsvps = await Promise.all(
    rsvpIds.map(async (rsvpId) => {
      const result = await backendClient.read(
        `mutable://open/events/${session.username}/${eventId}/rsvps/${rsvpId}`
      );

      if (result.record?.data?.encrypted) {
        try {
          const decrypted = await encrypt.decrypt(
            result.record.data.encrypted,
            decryptionKey
          );
          return { id: rsvpId, ...decrypted };
        } catch (error) {
          console.error(`Failed to decrypt RSVP ${rsvpId}`, error);
          return null;
        }
      }
      return null;
    })
  );

  return rsvps.filter(Boolean);
}
```

**Key Points:**
- **Password → Encryption Key**: Use PBKDF2 with unique salt per event
- **Salt Storage**: Store salt with encrypted data (not secret, needed for derivation)
- **Password Hash**: Optional client-side verification before decrypt attempt
- **URL-Only Mode**: No password = key in URL hash fragment
- **Guest Writes**: Use `mutable://open/*` paths for guest submissions
- **Same Key for Related Data**: Event, RSVPs, gifts all use same derived key

## Helper: Sign Payload

```typescript
async function signPayload(payload: unknown, appKey: string, privateKeyHex: string) {
  const signature = await encrypt.signWithHex(privateKeyHex, payload);

  return {
    auth: [{ pubkey: appKey, signature }],
    payload
  };
}
```

## Potential Server-Side Enhancements

These patterns work with current B3nd capabilities, but would benefit from additional server-side features:

### 1. **Guest Writes to Owner's Space** ⚠️ CRITICAL

**Current:**
- `mutable://open/*` - Unsafe, last-write-wins (anyone can overwrite)
- `mutable://accounts/:pubkey/*` - Only owner can write

**THIS IS THE BIGGEST BLOCKER** for guest submission use cases.

**What's Needed:**
```typescript
// Allow append-only guest writes to specific owner paths
// Schema configuration:
{
  "mutable://accounts/:owner/events/:hash/rsvps/*": {
    allowGuestWrites: true,
    mode: "append-only" // or "write-once"
  }
}
```

**Use Case:**
- Guest visits `/events/birthday-party`, enters password
- Guest submits RSVP without creating wallet account
- RSVP written to `mutable://accounts/{owner}/events/{hash}/rsvps/{guestId}`
- Owner can read all RSVPs from their account space
- No overwrites, no race conditions

**Without This:**
- Guests MUST create wallet accounts
- Guests write to their own space
- Owner needs out-of-band notification of guest pubkeys
- Terrible UX

### 2. **Atomic Index Updates**

**Current:** Race conditions possible when updating indexes:
```typescript
// Two guests submit RSVP simultaneously
const index = await read(indexUri);  // Both read same index
index.push(newId);                   // Both add their ID
await write(indexUri, index);        // Last write wins, one RSVP lost
```

**Would Help:**
- Atomic append operation: `appendToArray(uri, value)`
- Or optimistic locking with version numbers

**Use Case:** Concurrent guest submissions (RSVPs, gift reservations)

### 3. **Query/Filter Support**

**Current:** Must maintain custom indexes and fetch all data:
```typescript
// Fetch all RSVPs to count "attending"
const allRSVPs = await fetchAllRSVPs(); // Expensive
const attendingCount = allRSVPs.filter(r => r.attending).length;
```

**Would Help:**
- Basic filtering: `read(uri + "?filter=attending:true")`
- Aggregations: `count(uri + "/rsvps/*")`
- Pagination: `read(uri + "?limit=50&offset=100")`

**Use Case:** Large events with hundreds of RSVPs

### 4. **Rate Limiting for Open Paths**

**Current:** No protection against spam on `mutable://open/*` paths

**Would Help:**
- Per-IP rate limits on open path writes
- CAPTCHA verification for suspicious patterns
- Owner-configurable rate limits per resource

**Use Case:** Prevent RSVP spam, gift reservation flooding

### 5. **Temporary/Expiring Data**

**Current:** All data persists indefinitely

**Would Help:**
```typescript
await write(uri, data, { expiresAt: new Date('2024-12-31') });
// Or TTL: { ttl: 86400 } // 24 hours
```

**Use Case:** Time-limited event access, temporary shares

### 6. **Bulk Operations**

**Current:** Must read/write each item individually:
```typescript
for (const rsvpId of rsvpIds) {
  const rsvp = await read(`.../${rsvpId}`); // N+1 queries
}
```

**Would Help:**
```typescript
const rsvps = await bulkRead([
  `mutable://open/events/${eventId}/rsvps/id1`,
  `mutable://open/events/${eventId}/rsvps/id2`,
  // ...
]);
```

**Use Case:** Loading event with many RSVPs

### 7. **Access Logs/Analytics**

**Would Help:**
- View counts for public resources
- Access timestamps (who/when viewed)
- Read-only audit trail

**Use Case:** Event analytics, tracking invite engagement

## Current Workarounds

Until these features exist, use these patterns:

**For concurrent writes:**
- Accept potential data loss and design for it
- Use timestamps to detect conflicts
- Implement client-side retry logic

**For queries:**
- Maintain client-side indexes
- Cache frequently accessed data
- Fetch all data and filter client-side

**For spam protection:**
- Implement client-side CAPTCHA
- Use session tokens for guest submissions
- Monitor and manually clean up spam

## Important Considerations

### Guest Write Permissions

**Question:** Can unauthenticated guests write data (e.g., RSVP submissions)?

**Current Understanding:**
- `mutable://open/*` - Anyone can write without auth
- `mutable://accounts/:pubkey/*` - Requires signature from `:pubkey`

**For guest submissions:** Either:
1. Use `mutable://open/rsvps/{eventId}/{guestId}` (public, no auth)
2. Require guests to create wallet accounts (authenticated writes)

### Concurrency and Conflicts

B3nd uses last-write-wins for conflicts. For concurrent operations (e.g., gift reservations):

```typescript
// Check before write (race condition possible)
const existing = await backendClient.read(uri);
if (existing.success) {
  throw new Error("Already reserved");
}
await backendClient.write(uri, data);
```

**Note:** There's no optimistic locking. Design your app to handle potential conflicts gracefully.

### Data Discovery and Querying

- **No built-in search/filtering** - maintain your own indexes
- **No pagination** - fetch full indexes and filter client-side
- **No aggregations** - calculate stats client-side

Plan your data structure carefully for efficient access patterns.

### Storage and Performance

Testnet limits and production considerations:
- **Request timeouts:** Design for network latency
- **Data size limits:** Keep individual writes reasonable
- **Read/write costs:** Consider caching frequently accessed data client-side

### Key Management Best Practices

```typescript
// ✅ GOOD: Store user keys encrypted
const encryptedPrivateKey = await encryptWithPassword(
  userPrivateKey,
  userPassword
);
localStorage.setItem('encryptedKey', encryptedPrivateKey);

// ❌ BAD: Store private keys in plain text
localStorage.setItem('privateKey', userPrivateKey);

// ✅ GOOD: Use environment variables for app keys
const appKey = import.meta.env.VITE_APP_KEY;

// ❌ BAD: Hardcode app keys in source code
const appKey = "abc123..."; // Never commit to git!
```

## Reference

- **SDK Exports**: `@bandeira-tech/b3nd-web`, `/wallet`, `/apps`, `/encrypt`
- **Testnet Services**:
  - Wallet Server: `https://testnet-wallet.fire.cat`
  - App Server: `https://testnet-app.fire.cat`
  - Backend: `https://testnet.fire.cat`
- **SDK Encryption Module**: Full docs at `@bandeira-tech/b3nd-web/encrypt`
  - `generateSigningKeyPair()`, `generateEncryptionKeyPair()`
  - `encrypt()`, `decrypt()`, `signWithHex()`, `verify()`
