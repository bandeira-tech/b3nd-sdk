# Selo Demo: Firecat Protocol Walkthrough

Every step of the 2-minute demo mapped to actual B3nd/Firecat protocol messages, with questions and trouble spots flagged.

---

## Step 0:00 — Create an identity in Selo (one click, no email)

### What happens

The app generates three keypairs client-side and registers a session with the wallet server.

### Protocol messages

```
┌─────────────────────────────────────────────────────────────┐
│ CLIENT-SIDE KEY GENERATION (no protocol messages)           │
│                                                             │
│ 1. Ed25519 signing keypair (identity)                       │
│    generateSigningKeyPair() → {                             │
│      publicKeyHex: "a1b2c3...",  // This IS the user's ID   │
│      privateKeyHex: "d4e5f6..."  // Stored in browser       │
│    }                                                        │
│                                                             │
│ 2. X25519 encryption keypair (for ECDH)                     │
│    generateEncryptionKeyPair() → {                          │
│      publicKeyHex: "f7e8d9...",                              │
│      privateKey: CryptoKey  // Never leaves the device      │
│    }                                                        │
│                                                             │
│ 3. Ed25519 session keypair (ephemeral, for wallet auth)     │
│    generateSessionKeypair() → {                             │
│      publicKeyHex: "b3c4d5...",  // Session ID               │
│      privateKeyHex: "e6f7a8..."  // Signs login requests    │
│    }                                                        │
└─────────────────────────────────────────────────────────────┘
```

**Path A: Wallet-managed identity (current WalletClient flow)**

```
// 1. Request session approval from app
POST /api/v1/app/{appKey}/session
Body: {
  auth: [{ pubkey: "a1b2c3...", signature: "..." }],
  payload: { session: "b3c4d5..." }
}

// App approves by writing to B3nd:
receive(["mutable://accounts/{appKey}/sessions/{b3c4d5...}", 1])

// 2. Signup with credentials
POST /api/v1/auth/signup/{appKey}
Body: {
  auth: [{ pubkey: "b3c4d5...", signature: "..." }],
  payload: { type: "password", username: "alice", password: "..." }
}
Response: { success: true, username: "alice", token: "jwt...", expiresIn: 86400 }

// Wallet server internally generates and stores user keys
// (identity + encryption keypairs, encrypted at rest)
```

**Path B: Self-sovereign identity (no wallet server)**

```
// No server calls. Keys live in browser localStorage/IndexedDB.
// User IS their public key: a1b2c3...
// Problem: lose the device, lose the identity.
```

### Questions & Troubles

> **TROUBLE: "One click, no email" vs. the wallet flow.**
> The WalletClient requires `signup(appKey, session, credentials)` — which means the user must provide a username + password OR a Google OAuth token. This is NOT "one click, no email." To achieve the demo as described, we need one of:
>
> 1. **A passwordless signup flow** — e.g., generate a random username + passphrase, show it once ("save this recovery phrase"), done. The SDK doesn't have this today.
> 2. **Self-sovereign mode** — no wallet server at all, keys in browser. But then sharing and cross-device sync become unsolved problems.
> 3. **Google OAuth** — "one click" via Google sign-in button. The SDK supports this (`type: "google"`, `googleIdToken`), but it requires a Google Client ID configured on the app, and it's not "no email."
>
> **Recommendation:** Build a **passphrase-based signup**. Generate 12-word BIP39-style mnemonic → derive keys deterministically via `deriveSigningKeyPairFromSeed()` and `deriveEncryptionKeyPairFromSeed()`. Show the user: "Save this phrase. It IS your identity." One click to generate, one screen to save. This uses existing SDK primitives.

> **TROUBLE: Where do keys live?**
> In the wallet flow, keys are **server-managed** — the wallet server holds the user's Ed25519 and X25519 private keys (encrypted with the server's encryption key). The server acts as "key custodian." This is convenient but not self-sovereign.
>
> In a self-sovereign flow, keys are **client-managed** — stored in IndexedDB or localStorage. This is truly user-owned but creates the key loss problem.
>
> The demo should probably use wallet-managed keys for simplicity, but the narrative says "user-owned." This tension needs resolution.

---

## Step 0:15 — Upload a document, watch it get encrypted and signed

### What happens

The user drops a file. The app encrypts it with the user's X25519 public key, signs it with the user's Ed25519 private key, and writes to a mutable URI under the user's account.

### Protocol messages

**Via WalletClient (server-managed keys):**

```
// Client sends proxy write request
POST /api/v1/proxy/write
Headers: { Authorization: "Bearer jwt..." }
Body: {
  uri: "mutable://accounts/:key/selo/docs/invoice-2026.pdf",
  data: <base64-encoded PDF bytes>,
  encrypt: true
}
```

**What the wallet server does internally:**

```
// 1. Load user's keys from credential store
loadUserAccountKey(credClient, serverPubKey, "alice", serverEncPrivKeyPem)
→ { publicKeyHex: "a1b2c3...", privateKeyPem: "-----BEGIN PRIVATE KEY-----..." }

loadUserEncryptionKey(credClient, serverPubKey, "alice", serverEncPrivKeyPem)
→ { publicKeyHex: "f7e8d9...", privateKeyPem: "..." }

// 2. Resolve :key → user's public key
resolvedUri = "mutable://accounts/a1b2c3.../selo/docs/invoice-2026.pdf"

// 3. Create signed + encrypted message
createSignedEncryptedMessage(
  <pdf-bytes>,                          // plaintext data
  [{ privateKey, publicKeyHex }],       // signer (user's Ed25519)
  "f7e8d9..."                           // recipient (user's X25519 public key)
)
→ {
    auth: [{
      pubkey: "a1b2c3...",              // who signed it
      signature: "8a9b0c..."            // Ed25519 signature over the encrypted payload
    }],
    payload: {
      data: "SGVsbG8gV29ybGQ=...",      // AES-256-GCM ciphertext (base64)
      nonce: "dW5pcXVl...",             // 12-byte nonce (base64)
      ephemeralPublicKey: "1a2b3c..."   // X25519 ephemeral pubkey for ECDH
    }
  }

// 4. Write to backend via receive()
proxyClient.receive([
  "mutable://accounts/a1b2c3.../selo/docs/invoice-2026.pdf",
  { auth: [...], payload: { data: "...", nonce: "...", ephemeralPublicKey: "..." } }
])
```

**The HTTP request that hits the B3nd node:**

```
POST /api/v1/receive
Body: {
  tx: [
    "mutable://accounts/a1b2c3.../selo/docs/invoice-2026.pdf",
    {
      auth: [{ pubkey: "a1b2c3...", signature: "8a9b0c..." }],
      payload: {
        data: "SGVsbG8gV29ybGQ=...",
        nonce: "dW5pcXVl...",
        ephemeralPublicKey: "1a2b3c..."
      }
    }
  ]
}

Response: { accepted: true }
```

**Schema validation on the node:**

```
// The URI prefix "mutable://accounts" triggers authValidation():
// 1. Extract pubkey from URI: "a1b2c3..." (from accounts/{pubkey}/...)
// 2. Verify signature: verify("a1b2c3...", "8a9b0c...", payload) → true
// 3. Accept write — the signer owns this namespace
```

### Questions & Troubles

> **TROUBLE: Binary data handling.**
> The SDK serializes message data as JSON (`JSON.stringify(data)`). PDFs and images are binary. The HTTP server has a `deserializeMsgData()` function that unwraps `{ __b3nd_binary__: true, encoding: "base64", data: "..." }` markers. But the encryption flow (`encrypt()`) also does `JSON.stringify(data)` before encrypting.
>
> For large files (PDFs, images), the current flow is:
> 1. Read file as `Uint8Array`
> 2. Base64-encode → string
> 3. JSON.stringify → `"\"SGVsbG8...\""`
> 4. Encrypt → AES-GCM ciphertext
> 5. Base64-encode ciphertext → store
>
> This means **double base64 encoding** for binary data, inflating size by ~77%. For a 10MB PDF, that's ~17.7MB stored.
>
> **Recommendation:** Either accept the overhead for the demo (it's a demo, not production) or add a binary-aware encrypt path that skips the JSON.stringify for Uint8Array inputs.

> **TROUBLE: File metadata.**
> Where does the filename, MIME type, upload date, file size go? The current data model stores the encrypted blob but no metadata alongside it. Options:
>
> 1. Store metadata in the URI path: `mutable://accounts/:key/selo/docs/invoice-2026.pdf` — filename is in the URI, but MIME type and size are not.
> 2. Store metadata as a separate record: `mutable://accounts/:key/selo/meta/invoice-2026.pdf` → `{ filename, mimeType, size, uploadedAt }` (encrypted or plain).
> 3. Wrap the data: encrypt `{ filename, mimeType, data: base64bytes }` as a single blob.
>
> Option 3 is simplest for the demo. Option 2 is cleaner for the cross-app portability story (App B can read metadata without decrypting the full file).

> **QUESTION: Max file size?**
> The HTTP receive endpoint parses the full body as JSON. For a 10MB file (base64 + encryption overhead ≈ 18MB JSON body), this should work. For 100MB files, this will OOM or timeout. What's the target file size for the demo? If "documents," 10MB is likely fine. If "photos," could be 50-100MB.

---

## Step 0:30 — Share it with someone via a password link

### What happens

Alice wants to share a document with Bob without Bob having a B3nd identity. She creates a password-protected shareable link.

### Protocol messages

```
// 1. Derive a symmetric key from the password
SecretEncryptionKey.fromSecret({
  secret: "correct-horse-battery-staple",   // user-chosen password
  salt: "mutable://accounts/a1b2c3.../selo/docs/invoice-2026.pdf",  // URI as salt
  iterations: 100000                        // PBKDF2 iterations
})
→ SecretEncryptionKey { keyHex: "d8e9f0..." }

// 2. Read the original encrypted document
wallet.proxyRead({ uri: "mutable://accounts/:key/selo/docs/invoice-2026.pdf" })
→ { decrypted: <original PDF data> }

// 3. Re-encrypt with the password-derived symmetric key
encryptSymmetric(<original PDF data>, "d8e9f0...")
→ {
    data: "Y2lwaGVydGV4dA==...",    // AES-256-GCM ciphertext
    nonce: "bm9uY2U=..."            // 12-byte nonce
    // Note: NO ephemeralPublicKey — this is symmetric, not ECDH
  }

// 4. Write the password-encrypted version to a shareable URI
// Option A: Public URI (anyone with the link can see the ciphertext)
receive([
  "mutable://open/selo/shared/{shareId}",
  {
    data: "Y2lwaGVydGV4dA==...",
    nonce: "bm9uY2U=..."
  }
])

// Option B: Content-addressed (immutable, deduplicated)
// Would use hash://sha256 but that requires the hash validator
```

**The shareable link:**

```
https://selo.app/share/{shareId}#password=correct-horse-battery-staple
// OR
https://selo.app/share/{shareId}  (password entered in UI)
```

**When Bob opens the link:**

```
// 1. Read the shared record (no auth needed — it's under mutable://open/...)
GET /api/v1/read/mutable/open/selo/shared/{shareId}
→ { data: { data: "Y2lwaGVydGV4dA==...", nonce: "bm9uY2U=..." }, ts: 1709510400 }

// 2. Derive the same symmetric key from the password
SecretEncryptionKey.fromSecret({
  secret: "correct-horse-battery-staple",
  salt: "mutable://accounts/a1b2c3.../selo/docs/invoice-2026.pdf",
  iterations: 100000
})

// 3. Decrypt
decryptSymmetric(payload, "d8e9f0...")
→ <original PDF data>
```

### Questions & Troubles

> **TROUBLE: The salt problem.**
> In the flow above, the salt for PBKDF2 is the original URI. But Bob doesn't know the original URI — he only has the share link. So either:
>
> 1. The salt is stored alongside the ciphertext (not secret, that's fine — salts don't need to be secret).
> 2. The salt is the shareId itself (simpler).
> 3. The salt is embedded in the share link.
>
> **Recommendation:** Use the shareId as the salt. Simple, no information leak.

> **TROUBLE: The "re-encrypt" step requires reading and decrypting the original.**
> If keys are wallet-managed, the wallet server decrypts → client gets plaintext → client re-encrypts with password key → client writes to open URI. This means **plaintext transits through the client**. Fine for a browser app (the user is the client), but the wallet server also sees the plaintext during `proxyRead`. If the goal is "the server never sees your data," this is a problem.
>
> **For the demo:** This is acceptable. The wallet server is the key custodian anyway. True end-to-end encryption (where the server never sees plaintext) requires client-side key management.

> **TROUBLE: `mutable://open/...` is world-writable.**
> The example schema shows `"mutable://open": () => Promise.resolve({ valid: true })`. Anyone can write to any `mutable://open/` URI, including overwriting someone else's shared document.
>
> **Options:**
> 1. Use `immutable://open/selo/shared/{shareId}` — write-once, can't be overwritten. But the schema requires checking it doesn't exist already (`"immutable://open": async ({ uri, read }) => !result.success`).
> 2. Use a random UUID as shareId so collisions are practically impossible.
> 3. Use signed writes to `mutable://accounts/:key/selo/shared/{shareId}` — only the owner can write, but then only the owner's authenticated reads can access it (unless the node allows unauthenticated reads of `mutable://accounts/` paths).
>
> **Recommendation:** Use `immutable://open/selo/shared/{uuid}`. Write-once, collision-resistant with UUID, no auth needed to read.

> **QUESTION: Does the node allow unauthenticated reads?**
> The HTTP server's read endpoint (`GET /api/v1/read/:protocol/:domain/*`) has no auth check. It reads directly from the backend. So YES — anyone can read any URI if they know it. This is by design: URIs are capability tokens. Knowing the URI = having read access. The password on the share link provides the *decryption* capability, not the *read* capability. This is an important design choice to explain in the demo.

---

## Step 0:45 — Open App B — a completely different application

### What happens

App B is a separate web application with its own codebase. It connects to the same B3nd node and reads the same URIs.

### Protocol messages

```
// App B creates its own client pointing to the same B3nd node
const clientB = new HttpClient({ url: "https://node.example.com" });
// OR
const clientB = new WebSocketClient({ url: "wss://node.example.com" });

// No special registration, no OAuth handshake.
// Just point at the same node URL and read.
```

### Questions & Troubles

> **TROUBLE: How does App B know Alice's URIs?**
> App B needs to know what URIs to read. Options:
>
> 1. **Alice gives App B her public key.** App B lists: `client.list("mutable://accounts/a1b2c3.../selo/docs")` → gets all document URIs. But this requires Alice to manually copy-paste her pubkey into App B.
> 2. **Alice logs into App B with the same wallet.** Both apps use the same WalletClient with the same wallet server. The wallet resolves `:key` to the same pubkey. But this means both apps are coupled to the same wallet.
> 3. **Alice pastes a "vault URI" into App B.** Something like `mutable://accounts/a1b2c3.../selo/docs` — App B knows to list this prefix.
> 4. **App B scans a QR code** from App A showing the vault prefix URI.
>
> **Recommendation for demo:** Option 2 (same wallet). Both Selo and Selo Verify use the same WalletClient pointed at the same wallet server. Alice logs into both apps with the same credentials. The `:key` resolves to the same pubkey. This is the least friction for a demo. Option 3 (paste URI) is simpler technically but less impressive visually.

> **QUESTION: Does App B need encryption keys to read?**
> Yes — if the documents are encrypted with Alice's X25519 public key, App B needs Alice's private key to decrypt. This means:
>
> - If wallet-managed: App B must go through the same wallet's `proxyRead()`. This works if both apps share the same wallet server.
> - If self-sovereign: App B needs the private key somehow. Alice would need to export/import keys between apps.
>
> **This is actually the core design question for the cross-app story.** The demo says "same URI, same data, different app" — but if the data is encrypted, the decryption key must be shared between apps. The wallet server is the natural answer: it's the shared key custodian.

---

## Step 0:55 — The same document appears. Same URI, same data, different app.

### Protocol messages

```
// App B reads the same URI
// Via wallet proxy (same wallet server, same user):
walletB.proxyRead({
  uri: "mutable://accounts/:key/selo/docs/invoice-2026.pdf"
})

// Wallet server:
// 1. Resolves :key → "a1b2c3..." (same user, same key)
// 2. Reads: backend.read("mutable://accounts/a1b2c3.../selo/docs/invoice-2026.pdf")
// 3. Detects encrypted payload → decrypts with user's X25519 private key
// 4. Returns: { success: true, decrypted: <PDF data> }

// OR via direct HttpClient (unencrypted data):
clientB.read("mutable://accounts/a1b2c3.../selo/docs/invoice-2026.pdf")
→ {
    success: true,
    record: {
      ts: 1709510400,
      data: { auth: [...], payload: { data: "...", nonce: "...", ... } }
    }
  }
// App B would need to decrypt client-side
```

### Questions & Troubles

> **TROUBLE: The "different app" claim is only impressive if App B is truly independent.**
> If both apps use WalletClient pointed at the same wallet server, a skeptic could say "that's just two frontends for the same backend." The demo needs to make clear that:
>
> 1. The wallet server is optional — any app can read the raw data directly via `HttpClient.read()` if it has the decryption key.
> 2. The B3nd node is the data layer, not the wallet server. The wallet is just a convenience layer for key management.
>
> **Demonstration idea:** Show App B reading via `HttpClient` (no wallet), getting the encrypted blob, then decrypting client-side with a key the user provides. This proves the data is truly on the B3nd node, not locked inside the wallet.

---

## Step 1:10 — "Alice's data belongs to Alice, not to any app."

### Narrative moment (no new protocol messages)

This is the thesis statement. What makes it true technically:

1. **The URI namespace is owned by Alice's public key.** `mutable://accounts/a1b2c3.../` — only signatures from `a1b2c3...` can write here. No app, no server, no admin can write to this namespace without Alice's private key.

2. **The encryption key is Alice's.** Even the B3nd node operator cannot read the encrypted data. They store opaque ciphertext.

3. **The data is addressable by URI.** Any app that speaks the Firecat protocol can read from `mutable://accounts/a1b2c3.../...`. There's no app-specific API, no app-specific token format, no vendor lock-in at the data layer.

---

## Step 1:20 — Export everything with one click (list URIs + download)

### Protocol messages

```
// 1. List all documents
GET /api/v1/list/mutable/accounts/a1b2c3.../selo/docs
→ {
    success: true,
    data: [
      { uri: "mutable://accounts/a1b2c3.../selo/docs/invoice-2026.pdf" },
      { uri: "mutable://accounts/a1b2c3.../selo/docs/contract-draft.docx" },
      { uri: "mutable://accounts/a1b2c3.../selo/docs/photo-receipt.jpg" },
      ...
    ],
    pagination: { page: 1, limit: 50, total: 12 }
  }

// 2. Read each document (with decryption via wallet proxy)
// For each URI in the list:
walletB.proxyRead({ uri })
→ { decrypted: <file data> }

// 3. Or batch read (up to 50 at a time)
walletB.proxyReadMulti({
  uris: [
    "mutable://accounts/:key/selo/docs/invoice-2026.pdf",
    "mutable://accounts/:key/selo/docs/contract-draft.docx",
    ...
  ]
})
→ {
    success: true,
    results: [
      { uri: "...", success: true, decrypted: <data> },
      { uri: "...", success: true, decrypted: <data> },
    ],
    summary: { total: 12, succeeded: 12, failed: 0 }
  }
```

### Questions & Troubles

> **TROUBLE: List doesn't return metadata.**
> `ListItem` is just `{ uri: string }`. No filename, no size, no timestamp in the list response. To show a file browser UI, the app would need to:
>
> 1. Parse filenames from URIs (fragile, assumes naming convention).
> 2. Read each document's metadata separately (N+1 queries).
> 3. Store a separate metadata index at `mutable://accounts/:key/selo/index` with all file metadata.
>
> **Recommendation:** Build a metadata index. When uploading a file, also update:
> ```
> receive([
>   "mutable://accounts/:key/selo/index",
>   {
>     auth: [...],
>     payload: {
>       "invoice-2026.pdf": { mimeType: "application/pdf", size: 1048576, uploadedAt: 1709510400 },
>       "contract-draft.docx": { mimeType: "application/...", size: 524288, uploadedAt: 1709510500 },
>       ...
>     }
>   }
> ])
> ```
> This is a single read to get the full file listing with metadata.

> **TROUBLE: Pagination for large vaults.**
> `ListOptions` supports `page` and `limit`, but the list endpoint returns `total?` (optional). For export, we need to paginate through all items. The app must loop:
> ```
> let page = 1;
> while (true) {
>   const result = await client.list(prefix, { page, limit: 50 });
>   // process results
>   if (result.data.length < 50) break;
>   page++;
> }
> ```

---

## Step 1:35 — Point the vault at a different B3nd node — same data, new provider

### What happens

Alice changes the backend URL from `https://node-a.example.com` to `https://node-b.example.com`. Her data should appear on the new node.

### Protocol messages

**There is no built-in migration/replication protocol.** This must be done manually:

```
// 1. List everything from old node
const oldClient = new HttpClient({ url: "https://node-a.example.com" });
const items = await listAll(oldClient, "mutable://accounts/a1b2c3.../selo");

// 2. Read everything from old node
for (const item of items) {
  const data = await oldClient.read(item.uri);

  // 3. Write everything to new node
  const newClient = new HttpClient({ url: "https://node-b.example.com" });
  await newClient.receive([item.uri, data.record.data]);
}
```

### Questions & Troubles

> **TROUBLE: This is the biggest gap in the protocol.**
>
> The demo claims "point the vault at a different node — same data, new provider." But:
>
> 1. **There is no replication primitive.** You must read everything from node A and write everything to node B. For large vaults, this is slow and error-prone.
> 2. **The `mutable://accounts/` schema requires signature verification.** When copying data from node A to node B, the data is already signed by Alice. Node B's schema validator must accept existing signatures — it doesn't re-sign. This SHOULD work because the signed message is the value being stored, and the signature is verified against the pubkey in the URI path. But it needs testing.
> 3. **`immutable://` writes are write-once.** If Alice has shared documents at `immutable://open/...`, those can be copied. But if node B already has something at that URI (from someone else), the write will be rejected.
> 4. **No partial sync.** If Alice has 1000 documents and adds one more, she'd need to re-sync everything — there's no "sync only what changed since timestamp X."
>
> **For the demo:** This step is aspirational. The code to do it exists (list + read + receive), but it's not a first-class protocol operation. Consider showing this as a CLI command rather than an in-app feature:
> ```
> bnd export --from https://node-a.example.com --prefix mutable://accounts/:key/selo
> bnd import --to https://node-b.example.com
> ```
>
> **For the grant application:** Flag this as a deliverable — "build a data portability/migration tool as part of the SDK."

> **QUESTION: What about the wallet server?**
> If Alice uses wallet-managed keys and switches to a new node, the wallet server still holds her keys. The wallet server's proxy would need to be reconfigured to point at the new B3nd node. Or Alice would need to export her keys from the wallet and import them into a new wallet. This is the key portability problem.

---

## Step 1:45 — "This is what the EU Data Act mandates. B3nd makes it trivial."

### Narrative moment (no protocol messages)

The EU Data Act requires:
- Data in structured, machine-readable, interoperable formats → JSON at URIs ✓
- Right to port data between providers → list + read + receive ✓
- No switching charges → open protocol, no vendor lock-in ✓

---

## Summary: The Full Message Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│ IDENTITY CREATION                                                     │
│                                                                       │
│ Client → generateSigningKeyPair()          → Ed25519 { pub, priv }   │
│ Client → generateEncryptionKeyPair()       → X25519 { pub, priv }    │
│ Client → generateSessionKeypair()          → Ed25519 { pub, priv }   │
│                                                                       │
│ Client → POST wallet/auth/signup/{appKey}                             │
│   { auth: [{ pubkey, signature }], payload: credentials }            │
│ Wallet → { token: "jwt...", username: "alice" }                      │
├──────────────────────────────────────────────────────────────────────┤
│ UPLOAD (ENCRYPTED + SIGNED)                                           │
│                                                                       │
│ Client → POST wallet/proxy/write                                      │
│   { uri: "mutable://accounts/:key/selo/docs/file.pdf",              │
│     data: <bytes>, encrypt: true }                                    │
│                                                                       │
│ Wallet → createSignedEncryptedMessage(data, [signer], encPubKey)     │
│ Wallet → proxyClient.receive([resolvedUri, signedEncryptedMsg])      │
│                                                                       │
│ Node receives:                                                        │
│   POST /api/v1/receive                                                │
│   { tx: ["mutable://accounts/a1b2c3.../selo/docs/file.pdf",         │
│          { auth: [{pubkey, sig}], payload: {data, nonce, ephPub} }]} │
│                                                                       │
│ Node validates: pubkey in URI path matches auth.pubkey → accept      │
├──────────────────────────────────────────────────────────────────────┤
│ SHARE (PASSWORD-ENCRYPTED)                                            │
│                                                                       │
│ Client → wallet.proxyRead(originalUri) → plaintext                   │
│ Client → SecretEncryptionKey.fromSecret({ secret, salt })            │
│ Client → encryptSymmetric(plaintext, keyHex) → { data, nonce }      │
│ Client → receive(["immutable://open/selo/shared/{uuid}",             │
│                   { data, nonce, meta: { salt, ... } }])             │
│                                                                       │
│ Recipient:                                                            │
│   GET /api/v1/read/immutable/open/selo/shared/{uuid}                 │
│   → { data: { data, nonce }, ts }                                    │
│   SecretEncryptionKey.fromSecret({ secret, salt })                   │
│   decryptSymmetric(payload, keyHex) → plaintext                      │
├──────────────────────────────────────────────────────────────────────┤
│ CROSS-APP READ (App B)                                                │
│                                                                       │
│ Via wallet (same credentials):                                        │
│   walletB.proxyRead({ uri: "mutable://accounts/:key/selo/docs/..." })│
│   → { decrypted: <plaintext> }                                       │
│                                                                       │
│ Via direct client (needs decryption key):                             │
│   httpClient.read("mutable://accounts/a1b2c3.../selo/docs/...")      │
│   → { record: { data: { auth, payload: encrypted } } }              │
│   Client-side: decrypt(payload, userPrivateKey)                      │
├──────────────────────────────────────────────────────────────────────┤
│ EXPORT                                                                │
│                                                                       │
│ GET /api/v1/list/mutable/accounts/a1b2c3.../selo/docs               │
│   → { data: [{ uri }, { uri }, ...], pagination: {...} }             │
│                                                                       │
│ For each URI:                                                         │
│   wallet.proxyRead({ uri }) → { decrypted }                         │
│   OR wallet.proxyReadMulti({ uris: [...] }) for batch                │
├──────────────────────────────────────────────────────────────────────┤
│ MIGRATE                                                               │
│                                                                       │
│ (No built-in primitive — manual list+read+receive loop)              │
│ Old node: list → read → New node: receive                            │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Critical Protocol Gaps for the Demo

### Must-solve before demo

| Gap | Impact | Effort |
|---|---|---|
| **Passwordless signup** | Demo says "one click, no email" — current SDK requires username+password | Medium — derive keys from mnemonic using existing `deriveSigningKeyPairFromSeed()` |
| **File metadata** | No way to display file names/types without reading every file | Low — build a metadata index at a known URI |
| **Binary data overhead** | Double base64 encoding inflates storage ~77% | Low for demo (accept overhead), Medium for production |

### Should-solve for a strong demo

| Gap | Impact | Effort |
|---|---|---|
| **Cross-app key sharing** | App B can't decrypt without the same key access | Low if both apps use same wallet server |
| **Share link salt** | Minor UX issue — password derivation needs a salt | Low — use shareId as salt |
| **List metadata** | List returns only URIs, not file info | Low — use metadata index pattern |

### Nice-to-have (flag for grant deliverables)

| Gap | Impact | Effort |
|---|---|---|
| **Migration primitive** | No first-class sync/replicate operation | High — needs protocol-level design |
| **Partial sync** | No "changes since timestamp" query | Medium — needs ListOptions extension |
| **Client-side key management** | True self-sovereign mode without wallet | High — secure key storage, recovery |
| **WebSocket subscriptions** | Real-time updates when data changes | Medium — WebSocket client exists but no pub/sub |

---

## WebSocket Protocol (for real-time features)

The WebSocket protocol mirrors the HTTP API:

```typescript
// Request format
interface WebSocketRequest {
  id: string;                    // Client-generated request ID
  type: "receive" | "read" | "readMulti" | "list" | "delete" | "health" | "getSchema";
  payload: unknown;              // Type-specific payload
}

// Response format
interface WebSocketResponse {
  id: string;                    // Matches request ID
  success: boolean;
  data?: unknown;
  error?: string;
}
```

Example receive over WebSocket:
```json
→ { "id": "req-1", "type": "receive", "payload": { "tx": ["mutable://accounts/a1b2c3.../selo/docs/file.pdf", { "auth": [...], "payload": {...} }] } }
← { "id": "req-1", "success": true, "data": { "accepted": true } }
```

The WebSocket client supports reconnection with configurable backoff, which is useful for the real-time "watch your document get encrypted" UX in the demo.

---

## URI Scheme Reference

| Scheme | Behavior | Auth | Mutability | Use in demo |
|---|---|---|---|---|
| `mutable://accounts/{pubkey}/...` | Signature-verified writes | Ed25519 sig must match `{pubkey}` | Overwritable | User's documents, metadata index |
| `mutable://open/...` | Anyone can write | None | Overwritable | ⚠️ Unsafe for shares (can be overwritten) |
| `immutable://open/...` | Write-once, anyone can write | None | Write-once | Shared documents (safe) |
| `immutable://accounts/{pubkey}/...` | Write-once, signature-verified | Ed25519 | Write-once | Permanent records |
| `hash://sha256/{hex}` | Content-addressed | Hash must match content | Write-once (by hash) | Deduplication, proofs |
| `link://accounts/{pubkey}/...` | Authenticated pointer to another URI | Ed25519 | Overwritable | Version pointers, aliases |
| `mutable://data/...` | Server-managed namespace | Varies | Overwritable | Wallet internal state |
