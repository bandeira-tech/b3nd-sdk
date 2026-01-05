# Event Invite System - B3nd Implementation Guide

A guide for building shareable encrypted event systems using B3nd's event-based account pattern.

## Architecture Overview

**Key Concepts:**
- **Event-Based Accounts**: Each event has its own B3nd account (keypair)
- **Deterministic Encryption**: Keys derived from eventPubkey + slug + password
- **Inbox Program**: Authenticated guest writes via `immutable://inbox/...`
- **Clean URLs**: `/events/{eventPubkey}/{slug}` - no keys in fragments
- **Encrypted Storage**: Event keys stored encrypted in owner's account

## Setup

```bash
npm install @bandeira-tech/b3nd-web
```

## Core Implementation

### Initialize Clients

```typescript
import { WalletClient } from "@bandeira-tech/b3nd-web/wallet";
import { HttpClient } from "@bandeira-tech/b3nd-web";
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";

const walletClient = new WalletClient({
  walletServerUrl: "https://testnet-wallet.fire.cat",
  apiBasePath: "/api/v1"
});

const backendClient = new HttpClient({
  url: "https://testnet.fire.cat"
});

const appKey = import.meta.env.VITE_APP_KEY;
```

### Key Derivation

```typescript
// Derive deterministic encryption key using SDK
async function deriveEncryptionKey(
  appKey: string,
  eventPubkey: string,
  slug: string,
  password: string = ''
): Promise<string> {
  const seed = `${appKey}:${eventPubkey}:${slug}:${password}`;
  const salt = appKey; // Use appKey as salt

  return encrypt.deriveKeyFromSeed(seed, salt);
}
```

## Creating Events

### Owner Creates Event

```typescript
async function createEvent(
  ownerSession: { username: string; token: string },
  eventData: {
    name: string;
    date: string;
    location: string;
    description: string;
  },
  slug: string,
  password?: string
) {
  walletClient.setSession(ownerSession);

  // 1. Generate event's own keypair
  const eventKeys = await encrypt.generateSigningKeyPair();
  const eventPubkey = eventKeys.publicKeyHex;

  // 2. Derive encryption key from eventPubkey + slug + password
  const encryptionKey = await deriveEncryptionKey(
    appKey,
    eventPubkey,
    slug,
    password || ''
  );

  // 3. Encrypt event data
  const encrypted = await encrypt.encrypt(eventData, encryptionKey);

  // 4. Sign and write to event's account (using SDK)
  const signedData = await encrypt.createAuthenticatedMessageWithHex(
    { encrypted, hasPassword: !!password },
    eventPubkey,
    eventKeys.privateKeyHex
  );

  await backendClient.write(
    `mutable://accounts/${eventPubkey}/event/data`,
    signedData
  );

  // 5. Store event private key encrypted in owner's account
  // Wallet server handles encryption automatically
  await walletClient.proxyWrite({
    uri: `mutable://accounts/:key/event-keys/${eventPubkey}`,
    data: {
      privateKeyHex: eventKeys.privateKeyHex,
      slug,
      hasPassword: !!password,
      createdAt: new Date().toISOString()
    },
    encrypt: true // Wallet server encrypts this
  });

  // 6. Return shareable URL
  return {
    eventPubkey,
    url: `/events/${eventPubkey}/${slug}`,
    encryptionKey // Owner should store this for quick access
  };
}
```

### List Owner's Events

```typescript
async function listOwnerEvents(
  ownerSession: { username: string; token: string }
) {
  walletClient.setSession(ownerSession);

  // List all event keys (wallet server auto-decrypts)
  const eventKeys = await backendClient.list(
    `mutable://accounts/${ownerSession.userPubkey}/event-keys`
  );

  // Fetch details for each event
  const events = await Promise.all(
    eventKeys.map(async (eventPubkey) => {
      const keyData = await walletClient.read(
        `mutable://accounts/:key/event-keys/${eventPubkey}`
      );
      // keyData.privateKeyHex is already decrypted by wallet server
      return {
        eventPubkey,
        slug: keyData.data.slug,
        createdAt: keyData.data.createdAt
      };
    })
  );

  return events;
}
```

## Guest Access

### View Event

```typescript
async function viewEvent(
  eventPubkey: string,
  slug: string,
  password?: string
) {
  // 1. Read encrypted event from event's account
  const result = await backendClient.read(
    `mutable://accounts/${eventPubkey}/event/data`
  );

  if (!result.success || !result.record?.data) {
    throw new Error('Event not found');
  }

  const { encrypted, hasPassword } = result.record.data.payload;

  if (hasPassword && !password) {
    throw new Error('Password required');
  }

  // 2. Derive decryption key
  const encryptionKey = await deriveEncryptionKey(
    appKey,
    eventPubkey,
    slug,
    password || ''
  );

  // 3. Decrypt
  try {
    const eventData = await encrypt.decrypt(encrypted, encryptionKey);
    return eventData;
  } catch (error) {
    throw new Error('Failed to decrypt: incorrect password');
  }
}
```

### Submit RSVP

```typescript
async function submitRSVP(
  eventPubkey: string,
  slug: string,
  password: string,
  rsvpData: {
    name: string;
    email: string;
    attending: boolean;
    plusOnes?: number;
    message?: string;
  }
) {
  // 1. Guest creates account or uses existing wallet
  // For demo, create temp account (in production, use wallet signup)
  const guestKeys = await encrypt.generateSigningKeyPair();
  const guestPubkey = guestKeys.publicKeyHex;

  // 2. Derive encryption key (same as event access)
  const encryptionKey = await deriveEncryptionKey(
    appKey,
    eventPubkey,
    slug,
    password
  );

  // 3. Encrypt RSVP data
  const encrypted = await encrypt.encrypt(rsvpData, encryptionKey);

  // 4. Create authenticated message (using SDK)
  const authenticatedRsvp = await encrypt.createAuthenticatedMessageWithHex(
    { encrypted },
    guestPubkey,
    guestKeys.privateKeyHex
  );

  // Extract signature for URI
  const signature = authenticatedRsvp.auth[0].signature;

  // 5. Write to immutable inbox (write-once, authenticated)
  await backendClient.write(
    `immutable://inbox/${eventPubkey}/rsvps/${guestPubkey}/${signature}`,
    authenticatedRsvp
  );

  return { guestPubkey, submitted: true };
}
```

## Owner Management

### Read RSVPs

```typescript
async function getEventRSVPs(
  ownerSession: { username: string; token: string },
  eventPubkey: string,
  slug: string,
  password?: string
) {
  walletClient.setSession(ownerSession);

  // 1. Fetch event key (wallet server auto-decrypts)
  const eventKeyData = await walletClient.read(
    `mutable://accounts/:key/event-keys/${eventPubkey}`
  );
  // eventKeyData.data.privateKeyHex is already decrypted

  // 2. Derive encryption key
  const encryptionKey = await deriveEncryptionKey(
    appKey,
    eventPubkey,
    slug,
    password || ''
  );

  // 3. List all RSVP paths from inbox
  const rsvpPaths = await backendClient.list(
    `immutable://inbox/${eventPubkey}/rsvps`
  );
  // Returns: ['guestPubkey1/signature1', 'guestPubkey2/signature2', ...]

  // 4. Read and decrypt each RSVP
  const rsvps = await Promise.all(
    rsvpPaths.map(async (path) => {
      const result = await backendClient.read(
        `immutable://inbox/${eventPubkey}/rsvps/${path}`
      );

      if (result.record?.data?.payload?.encrypted) {
        try {
          const rsvpData = await encrypt.decrypt(
            result.record.data.payload.encrypted,
            encryptionKey
          );

          // Extract guestPubkey from path
          const guestPubkey = path.split('/')[0];

          return {
            guestPubkey,
            ...rsvpData,
            submittedAt: result.record.timestamp
          };
        } catch (error) {
          console.error(`Failed to decrypt RSVP from ${path}`, error);
          return null;
        }
      }
      return null;
    })
  );

  return rsvps.filter(Boolean);
}
```

### Update Event

```typescript
async function updateEvent(
  ownerSession: { username: string; token: string },
  eventPubkey: string,
  slug: string,
  password: string,
  updatedData: any
) {
  walletClient.setSession(ownerSession);

  // 1. Fetch event private key (auto-decrypted)
  const eventKeyData = await walletClient.read(
    `mutable://accounts/:key/event-keys/${eventPubkey}`
  );
  const eventPrivateKey = eventKeyData.data.privateKeyHex;

  // 2. Derive encryption key
  const encryptionKey = await deriveEncryptionKey(
    appKey,
    eventPubkey,
    slug,
    password
  );

  // 3. Encrypt updated data
  const encrypted = await encrypt.encrypt(updatedData, encryptionKey);

  // 4. Sign and write (using SDK)
  const signedData = await encrypt.createAuthenticatedMessageWithHex(
    { encrypted, hasPassword: !!password },
    eventPubkey,
    eventPrivateKey
  );

  await backendClient.write(
    `mutable://accounts/${eventPubkey}/event/data`,
    signedData
  );

  return { updated: true };
}
```

## URI Patterns

```
Event data:     mutable://accounts/{eventPubkey}/event/data
Event keys:     mutable://accounts/{ownerPubkey}/event-keys/{eventPubkey}
RSVPs:          immutable://inbox/{eventPubkey}/rsvps/{guestPubkey}/{signature}
```

## Required B3nd Programs

### Inbox Program

```typescript
// Schema definition needed in B3nd backend
{
  "immutable://inbox/:recipient/.../:writer/:signature": {
    validation: async ({ uri, value }) => {
      // 1. Extract recipient, writer pubkey, signature from URI
      // 2. Verify signature from writer matches payload
      // 3. Allow authenticated append (write-once per writer)
      // 4. Rate limiting per writer

      const { auth, payload } = value;
      const writerPubkey = auth[0]?.pubkey;
      const signature = auth[0]?.signature;

      // Verify signature
      const isValid = await verifySignature(writerPubkey, signature, payload);

      return {
        valid: isValid,
        error: isValid ? undefined : "Invalid signature"
      };
    }
  }
}
```

## Data Flow

### Creating & Sharing
1. Owner creates event → generates event keypair
2. Event data encrypted with derived key (eventPubkey + slug + password)
3. Event private key stored encrypted in owner's account
4. Share URL: `/events/{eventPubkey}/{slug}` + password (out of band)

### Guest Access
1. Guest visits URL → has eventPubkey + slug
2. Enters password (if required)
3. Derives encryption key → decrypts event data
4. Submits RSVP → writes to immutable inbox (authenticated)

### Owner Management
1. Lists events from `event-keys/*` directory
2. Reads RSVPs from `inbox/{eventPubkey}/rsvps/*`
3. Decrypts with derived key
4. Updates event using stored event private key

## Security Considerations

### ✅ Encrypted at Rest
- All event data encrypted with password-derived keys
- Event private keys encrypted by wallet server
- RSVPs encrypted with event's encryption key

### ✅ No Key Leakage
- Encryption keys derived deterministically (never transmitted)
- Event private keys stored encrypted
- Slug not visible in B3nd URIs (only in app URLs)

### ✅ Authenticated Writes
- Event writes signed with event private key
- RSVP writes signed with guest private key
- Inbox program validates signatures

### ⚠️ Considerations
- Password strength matters (weak passwords = brute-forceable)
- Event URLs are semi-public (eventPubkey visible)
- Guest must create wallet account for RSVP (can be temporary)

## Complete Example

```typescript
// Owner creates password-protected event
const { eventPubkey, url } = await createEvent(
  ownerSession,
  {
    name: "Michael's Birthday Party",
    date: "2026-06-15",
    location: "123 Main St",
    description: "Come celebrate!"
  },
  "michaels-birthday-2026",
  "secretparty123" // password
);

// Share: /events/{eventPubkey}/michaels-birthday-2026
// Password: secretparty123 (share out of band)

// Guest accesses event
const event = await viewEvent(
  eventPubkey,
  "michaels-birthday-2026",
  "secretparty123"
);

// Guest submits RSVP
await submitRSVP(
  eventPubkey,
  "michaels-birthday-2026",
  "secretparty123",
  {
    name: "Alice",
    email: "alice@example.com",
    attending: true,
    plusOnes: 1,
    message: "Can't wait!"
  }
);

// Owner reads RSVPs
const rsvps = await getEventRSVPs(
  ownerSession,
  eventPubkey,
  "michaels-birthday-2026",
  "secretparty123"
);
```

## Reference

- **SDK**: `@bandeira-tech/b3nd-web`
- **Testnet**: `https://testnet.fire.cat`
- **Wallet Server**: `https://testnet-wallet.fire.cat`
