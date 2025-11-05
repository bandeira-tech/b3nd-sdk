# Building Web Apps with B3nd - Quick Guide

## What is B3nd?

B3nd is a universal data layer for your web app. Think of it as a flexible database API where:
- **User data** is private and authenticated (signed, encrypted, only you can read)
- **App data** is public and shared (everyone can read)
- **Everything is signed** so you know it's real and hasn't been tampered with

You focus on building the UI. B3nd handles the data securely.

---

## Setup (10 minutes)

### 1. Start the Server

```bash
# Someone (you or a team member) runs this once
cd installations/http-evergreen
deno run --allow-env --allow-net mod.ts
# Server is now at http://localhost:8080
```

### 2. Install SDK in Your App

```bash
npm install @bandeira-tech/b3nd-sdk
# or
yarn add @bandeira-tech/b3nd-sdk
```

### 3. Create API Client & Auth Manager

```typescript
// src/api/client.ts
import { HttpClient } from "@bandeira-tech/b3nd-sdk";
import * as auth from "@bandeira-tech/b3nd-sdk/auth";
import * as encrypt from "@bandeira-tech/b3nd-sdk/encrypt";

export const b3nd = new HttpClient({
  url: "http://localhost:8080", // or your server URL
});

// Store user's keys (you get these from signup/login)
let userKeys: {
  userId: string;
  privateKey: CryptoKey;
  publicKeyHex: string;
  encryptionPrivateKey?: CryptoKey;
  encryptionPublicKeyHex?: string;
} | null = null;

export function setUserKeys(keys: typeof userKeys) {
  userKeys = keys;
}

export function getUserKeys() {
  if (!userKeys) throw new Error("User not authenticated");
  return userKeys;
}
```

Done! Now you can use B3nd securely.

---

## Three Simple Patterns

### Pattern 1: User Data (Private, Authenticated & Encrypted)

User's personal data - only they can read it because it's signed and encrypted.

```typescript
// src/api/user.ts
import { b3nd, getUserKeys } from "./client";
import * as auth from "@bandeira-tech/b3nd-sdk/auth";
import * as encrypt from "@bandeira-tech/b3nd-sdk/encrypt";

// User signs up - generate their keypair
export async function generateUserKeys() {
  const signingKeyPair = await auth.generateSigningKeyPair();
  const encryptionKeyPair = await encrypt.generateEncryptionKeyPair();

  return {
    userId: signingKeyPair.publicKeyHex,
    privateKey: signingKeyPair.privateKey,
    publicKeyHex: signingKeyPair.publicKeyHex,
    encryptionPrivateKey: encryptionKeyPair.privateKey,
    encryptionPublicKeyHex: encryptionKeyPair.publicKeyHex,
  };
}

// User reads their data (automatically decrypted if encrypted)
export async function getUserData(userId: string) {
  const result = await b3nd.read(
    `mutable://accounts/${userId}/profile`
  );
  return result.record?.data;
}

// User updates their data (signed & encrypted)
export async function updateUserData(updates: any) {
  const keys = getUserKeys();
  const payload = updates;

  // Sign the payload
  const signature = await auth.signWithHex(keys.privateKeyHex, payload);

  // Encrypt the payload
  const encrypted = await encrypt.encrypt(payload, keys.encryptionPublicKeyHex);

  // Send signed + encrypted
  await b3nd.write(
    `mutable://accounts/${keys.userId}/profile`,
    {
      auth: [
        {
          pubkey: keys.publicKeyHex,
          signature: signature,
        },
      ],
      payload: encrypted,
    }
  );
}

// User saves nested data (e.g., settings, notes)
export async function saveUserData(path: string, data: any) {
  const keys = getUserKeys();

  const signature = await auth.signWithHex(keys.privateKeyHex, data);
  const encrypted = await encrypt.encrypt(data, keys.encryptionPublicKeyHex);

  await b3nd.write(
    `mutable://accounts/${keys.userId}/${path}`,
    {
      auth: [
        {
          pubkey: keys.publicKeyHex,
          signature: signature,
        },
      ],
      payload: encrypted,
    }
  );
}

// User logs in - restore their keys from storage
export async function restoreUserSession() {
  const stored = localStorage.getItem("userKeys");
  if (!stored) throw new Error("No session found");

  const parsed = JSON.parse(stored);

  // Restore keys from PEM (you saved them during signup)
  const privateKey = await auth.pemToCryptoKey(parsed.privateKeyPem);
  const encPrivateKey = await encrypt.pemToCryptoKey(
    parsed.encryptionPrivateKeyPem,
    "X25519"
  );

  return {
    userId: parsed.publicKeyHex,
    privateKey,
    publicKeyHex: parsed.publicKeyHex,
    encryptionPrivateKey: encPrivateKey,
    encryptionPublicKeyHex: parsed.encryptionPublicKeyHex,
  };
}
```

**Use this for:**
- User profiles
- Preferences & settings
- Private notes
- Saved items
- Any data "belongs" to one user

**Key:** Data is signed with their private key and encrypted with their public key. Server can't read it, and no one can impersonate them.

---

### Pattern 2: App Data (Public & Shared)

Data everyone sees - read-only mostly.

```typescript
// src/api/content.ts
import { b3nd } from "./client";

// Admin publishes content (your app controls who can do this)
export async function publishPost(postId: string, post: any) {
  await b3nd.write(
    `mutable://open/posts/${postId}`,
    post
  );
}

// Anyone reads content
export async function getPost(postId: string) {
  const result = await b3nd.read(
    `mutable://open/posts/${postId}`
  );
  return result.record?.data;
}

// List all posts
export async function listPosts() {
  const result = await b3nd.list(
    `mutable://open/posts/`
  );
  return result.data; // Returns array of post items
}

// Get shared app config
export async function getAppConfig() {
  const result = await b3nd.read(
    `mutable://open/config/settings`
  );
  return result.record?.data;
}
```

**Use this for:**
- Blog posts
- Product catalog
- App configuration
- Shared documents
- Public announcements

**Key:** Everyone can read it. Only your app logic controls who can write.

---

### Pattern 3: User Contributions (Signed & Immutable)

User signs a permanent record - can't be edited, but publicly visible.

```typescript
// src/api/contributions.ts
import { b3nd, getUserKeys } from "./client";
import * as auth from "@bandeira-tech/b3nd-sdk/auth";

// User submits an immutable review (can't change mind later)
export async function submitReview(
  reviewId: string,
  review: any
) {
  const keys = getUserKeys();

  // Sign the review
  const signature = await auth.signWithHex(keys.privateKeyHex, review);

  // Send signed (not encrypted - everyone should see reviews)
  await b3nd.write(
    `immutable://accounts/${keys.userId}/reviews/${reviewId}`,
    {
      auth: [
        {
          pubkey: keys.publicKeyHex,
          signature: signature,
        },
      ],
      payload: review,
    }
  );
}

// Everyone reads reviews
export async function getReview(userId: string, reviewId: string) {
  const result = await b3nd.read(
    `immutable://accounts/${userId}/reviews/${reviewId}`
  );
  return result.record?.data;
}

// List all reviews by a user
export async function getUserReviews(userId: string) {
  const result = await b3nd.list(
    `immutable://accounts/${userId}/reviews/`
  );
  return result.data;
}
```

**Use this for:**
- Reviews & ratings
- Comments
- Votes & reactions
- Certificates
- Audit trail

**Key:** Signed so we know who wrote it. Immutable so it can't be changed. Public so everyone sees it.

---

## Real App Example: Simple Notes App

```typescript
// src/api/notes.ts
import { b3nd, getUserKeys } from "./client";
import * as auth from "@bandeira-tech/b3nd-sdk/auth";
import * as encrypt from "@bandeira-tech/b3nd-sdk/encrypt";

// List user's notes (just the paths)
export async function listNotes() {
  const keys = getUserKeys();
  const result = await b3nd.list(
    `mutable://accounts/${keys.userId}/notes/`
  );
  return result.data.map(item => ({
    id: item.uri.split("/").pop(),
    uri: item.uri
  }));
}

// Get a note (decrypted)
export async function getNote(noteId: string) {
  const result = await b3nd.read(
    `mutable://accounts/${getUserKeys().userId}/notes/${noteId}`
  );
  return result.record?.data;
}

// Create or update a note (signed & encrypted)
export async function saveNote(noteId: string, content: string) {
  const keys = getUserKeys();
  const data = {
    content,
    editedAt: new Date().toISOString()
  };

  // Sign it
  const signature = await auth.signWithHex(keys.privateKeyHex, data);

  // Encrypt it
  const encrypted = await encrypt.encrypt(data, keys.encryptionPublicKeyHex);

  // Save
  await b3nd.write(
    `mutable://accounts/${keys.userId}/notes/${noteId}`,
    {
      auth: [{ pubkey: keys.publicKeyHex, signature }],
      payload: encrypted,
    }
  );
}

// Delete a note
export async function deleteNote(noteId: string) {
  const keys = getUserKeys();
  await b3nd.delete(
    `mutable://accounts/${keys.userId}/notes/${noteId}`
  );
}
```

**Use in React:**
```tsx
import { useState, useEffect } from "react";
import { listNotes, getNote, saveNote } from "./api/notes";

export function NotesApp() {
  const [notes, setNotes] = useState([]);
  const [currentNote, setCurrentNote] = useState(null);

  useEffect(() => {
    listNotes().then(setNotes).catch(console.error);
  }, []);

  async function handleSave(noteId: string, content: string) {
    try {
      await saveNote(noteId, content);
      listNotes().then(setNotes);
    } catch (error) {
      console.error("Save failed:", error);
    }
  }

  return (
    <div>
      <h1>My Notes</h1>
      <ul>
        {notes.map(note => (
          <li key={note.id}>
            <button
              onClick={() => getNote(note.id).then(setCurrentNote)}
            >
              {note.id}
            </button>
          </li>
        ))}
      </ul>

      {currentNote && (
        <textarea
          defaultValue={currentNote.content}
          onBlur={(e) => handleSave(currentNote.id, e.target.value)}
          placeholder="Type your note here..."
        />
      )}
    </div>
  );
}
```

---

## Complete Auth Flow

### Sign Up (Generate Keys)

```typescript
// src/pages/SignUp.tsx
import { useState } from "react";
import { generateUserKeys } from "../api/user";
import { setUserKeys } from "../api/client";

export function SignUp() {
  const [loading, setLoading] = useState(false);

  async function handleSignUp() {
    setLoading(true);
    try {
      // Generate keys
      const keys = await generateUserKeys();

      // Save keys locally (IMPORTANT: in real app, use secure storage)
      localStorage.setItem("userKeys", JSON.stringify({
        publicKeyHex: keys.publicKeyHex,
        encryptionPublicKeyHex: keys.encryptionPublicKeyHex,
        // DO NOT SEND PRIVATE KEYS TO SERVER
        // Store them securely in browser (IndexedDB, etc)
      }));

      // Set keys in app
      setUserKeys(keys);

      // Redirect to app
      window.location.href = "/app";
    } catch (error) {
      console.error("Signup failed:", error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button onClick={handleSignUp} disabled={loading}>
      {loading ? "Creating account..." : "Sign Up"}
    </button>
  );
}
```

### Log In (Restore Session)

```typescript
// src/pages/Login.tsx
import { useState } from "react";
import { restoreUserSession } from "../api/user";
import { setUserKeys } from "../api/client";

export function Login() {
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setLoading(true);
    try {
      // Restore keys from storage
      const keys = await restoreUserSession();
      setUserKeys(keys);
      window.location.href = "/app";
    } catch (error) {
      console.error("Login failed:", error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button onClick={handleLogin} disabled={loading}>
      {loading ? "Logging in..." : "Log In"}
    </button>
  );
}
```

---

## Data Organization Tips

### Structure Your Paths Like a Filesystem

```
mutable://open/             → public app data (everyone reads)
  posts/
    post-1
    post-2
  config/
    settings

mutable://accounts/         → private user data (only they read, encrypted & signed)
  <user-public-key>/
    profile
    settings
    notes/
      note-1
      note-2

immutable://accounts/       → permanent user records (public, signed, can't change)
  <user-public-key>/
    reviews/
      review-1
    votes/
      vote-1
```

### Keep It Simple

- **No deep nesting** - easier to manage
- **Use readable IDs** - `post-hello-world` not `p123`
- **One path per piece of data** - not nested objects
- **Use timestamps** - for sorting and filtering in the app

---

## Common Patterns

### Protect Sensitive Operations

```typescript
// Only authenticated users can write
async function protectedSave(data: any) {
  try {
    const keys = getUserKeys();
    // ... proceed with save
  } catch {
    // User not logged in
    window.location.href = "/login";
  }
}
```

### Cache User Data in React

```tsx
import { useEffect, useState } from "react";

export function useUserProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    getUserData()
      .then(setProfile)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  return { profile, loading, error };
}
```

### Handle Errors Gracefully

```typescript
async function safeWrite(path: string, data: any) {
  try {
    await saveUserData(path, data);
    return { success: true };
  } catch (error) {
    console.error("Save failed:", error);
    return {
      success: false,
      error: "Could not save. Check your connection and try again."
    };
  }
}
```

---

## Testing Your App

Use the **CLI** to test public data:

```bash
# Create public test data
bnd write mutable://open/posts/test '{"title":"Test Post"}'

# Read it back
bnd read mutable://open/posts/test

# List all public posts
bnd list mutable://open/posts/

# Delete test data
bnd delete mutable://open/posts/test
```

For user data, test through your app UI (since it requires signing).

---

## Security Checklist

**Before Going Live:**

- [ ] **Never log private keys** - they can be copied
- [ ] **Use HTTPS** - don't send keys over HTTP
- [ ] **Store keys securely** - IndexedDB + encryption (not localStorage for production)
- [ ] **Validate all inputs** - in your app before sending to B3nd
- [ ] **Set CORS properly** - `CORS_ORIGIN=https://yourdomain.com`
- [ ] **Use authentication** - require login before accessing user data
- [ ] **Add rate limiting** - prevent abuse on public endpoints
- [ ] **Back up user data** - have a recovery process

---

## Before Going Live

**Server Setup:**
- [ ] Deploy B3nd server with persistent storage (Postgres)
- [ ] Set `CORS_ORIGIN` to your domain
- [ ] Enable HTTPS
- [ ] Set up monitoring
- [ ] Back up data regularly

**App Setup:**
- [ ] Implement real user authentication
- [ ] Add proper error handling & loading states
- [ ] Test with real user workflows
- [ ] Secure key storage (not localStorage)
- [ ] Add logout functionality
- [ ] Test in different browsers

---

## What You Got

✅ **Free security benefits:**
- User data automatically private & encrypted
- Signatures prove authenticity
- Public data safe & shared
- Server can't impersonate users
- Scales from hobby to production

---

## Next Steps

1. **Follow the Auth Flow** - Implement Sign Up & Login
2. **Build your first feature** - Start with user profile (Pattern 1)
3. **Add data persistence** - Save user notes or settings
4. **Test with real users** - Find bugs early
5. **Deploy** - When you're ready

---

**Made with B3nd - Secure, Universal Data Layer**
