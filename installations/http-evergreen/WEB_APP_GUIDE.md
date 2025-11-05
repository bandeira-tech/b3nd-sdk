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

### 3. Create API Client

```typescript
// src/api/client.ts
import { HttpClient } from "@bandeira-tech/b3nd-sdk";

export const b3nd = new HttpClient({
  url: "http://localhost:8080", // or your server URL
});
```

Done! Now you can use B3nd securely.

---

## Three Simple Patterns

### Pattern 1: User Data (Private, Authenticated & Encrypted)

User's personal data - only they can read it because it's signed and encrypted.

```typescript
// src/api/user.ts
import { b3nd } from "./client";
import * as auth from "@bandeira-tech/b3nd-sdk/auth";
import * as encrypt from "@bandeira-tech/b3nd-sdk/encrypt";

// Generate keypair for new user
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

// Read user data (must decrypt explicitly if encrypted)
export async function getUserData(
  userId: string,
  encryptionPrivateKey: CryptoKey
) {
  const result = await b3nd.read(
    `mutable://accounts/${userId}/profile`
  );

  if (!result.record?.data) return null;

  const data = result.record.data;

  // If data is encrypted (has ephemeralPublicKey), decrypt it
  if (data.ephemeralPublicKey) {
    return await encrypt.decrypt(data, encryptionPrivateKey);
  }

  // Otherwise return as-is
  return data;
}

// Update user data (signed & encrypted)
export async function updateUserData(
  userId: string,
  privateKey: CryptoKey,
  publicKeyHex: string,
  encryptionPublicKeyHex: string,
  updates: any
) {
  // Sign the payload
  const signature = await auth.sign(privateKey, updates);

  // Encrypt the payload
  const encrypted = await encrypt.encrypt(updates, encryptionPublicKeyHex);

  // Send signed + encrypted
  await b3nd.write(
    `mutable://accounts/${userId}/profile`,
    {
      auth: [
        {
          pubkey: publicKeyHex,
          signature: signature,
        },
      ],
      payload: encrypted,
    }
  );
}

// Save user data at a path (signed & encrypted)
export async function saveUserData(
  userId: string,
  path: string,
  privateKey: CryptoKey,
  publicKeyHex: string,
  encryptionPublicKeyHex: string,
  data: any
) {
  const signature = await auth.sign(privateKey, data);
  const encrypted = await encrypt.encrypt(data, encryptionPublicKeyHex);

  await b3nd.write(
    `mutable://accounts/${userId}/${path}`,
    {
      auth: [
        {
          pubkey: publicKeyHex,
          signature: signature,
        },
      ],
      payload: encrypted,
    }
  );
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
import { b3nd } from "./client";
import * as auth from "@bandeira-tech/b3nd-sdk/auth";

// User submits an immutable review (can't change mind later)
export async function submitReview(
  userId: string,
  reviewId: string,
  review: any,
  privateKey: CryptoKey,
  publicKeyHex: string
) {
  // Sign the review
  const signature = await auth.sign(privateKey, review);

  // Send signed (not encrypted - everyone should see reviews)
  await b3nd.write(
    `immutable://accounts/${userId}/reviews/${reviewId}`,
    {
      auth: [
        {
          pubkey: publicKeyHex,
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
import { b3nd } from "./client";
import * as auth from "@bandeira-tech/b3nd-sdk/auth";
import * as encrypt from "@bandeira-tech/b3nd-sdk/encrypt";

// List user's notes (just the paths)
export async function listNotes(userId: string) {
  const result = await b3nd.list(
    `mutable://accounts/${userId}/notes/`
  );
  return result.data.map(item => ({
    id: item.uri.split("/").pop(),
    uri: item.uri
  }));
}

// Get a note (must decrypt explicitly if encrypted)
export async function getNote(
  userId: string,
  noteId: string,
  encryptionPrivateKey: CryptoKey
) {
  const result = await b3nd.read(
    `mutable://accounts/${userId}/notes/${noteId}`
  );

  if (!result.record?.data) return null;

  const data = result.record.data;

  // If data is encrypted (has ephemeralPublicKey), decrypt it
  if (data.ephemeralPublicKey) {
    return await encrypt.decrypt(data, encryptionPrivateKey);
  }

  // Otherwise return as-is
  return data;
}

// Create or update a note (signed & encrypted)
export async function saveNote(
  userId: string,
  noteId: string,
  content: string,
  privateKey: CryptoKey,
  publicKeyHex: string,
  encryptionPublicKeyHex: string
) {
  const data = {
    content,
    editedAt: new Date().toISOString()
  };

  // Sign it
  const signature = await auth.sign(privateKey, data);

  // Encrypt it
  const encrypted = await encrypt.encrypt(data, encryptionPublicKeyHex);

  // Save
  await b3nd.write(
    `mutable://accounts/${userId}/notes/${noteId}`,
    {
      auth: [{ pubkey: publicKeyHex, signature }],
      payload: encrypted,
    }
  );
}

// Delete a note
export async function deleteNote(userId: string, noteId: string) {
  await b3nd.delete(
    `mutable://accounts/${userId}/notes/${noteId}`
  );
}
```

**Use in React:**
```tsx
import { useState, useEffect } from "react";
import { listNotes, getNote, saveNote } from "./api/notes";

export function NotesApp({
  userId,
  privateKey,
  publicKeyHex,
  encryptionPrivateKey,
  encryptionPublicKeyHex
}) {
  const [notes, setNotes] = useState([]);
  const [currentNote, setCurrentNote] = useState(null);

  useEffect(() => {
    listNotes(userId).then(setNotes).catch(console.error);
  }, [userId]);

  async function handleSave(noteId: string, content: string) {
    try {
      await saveNote(
        userId,
        noteId,
        content,
        privateKey,
        publicKeyHex,
        encryptionPublicKeyHex
      );
      listNotes(userId).then(setNotes);
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
              onClick={() =>
                getNote(userId, note.id, encryptionPrivateKey).then(
                  setCurrentNote
                )
              }
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

### Handle Errors Gracefully

```typescript
async function safeRead(userId: string, path: string, encryptionPrivateKey: CryptoKey) {
  try {
    const result = await b3nd.read(`mutable://accounts/${userId}/${path}`);
    if (!result.record?.data) return null;

    const data = result.record.data;
    if (data.ephemeralPublicKey) {
      return await encrypt.decrypt(data, encryptionPrivateKey);
    }
    return data;
  } catch (error) {
    console.error("Read failed:", error);
    return null;
  }
}

async function safeWrite(userId: string, path: string, data: any, privateKey: CryptoKey, publicKeyHex: string, encryptionPublicKeyHex: string) {
  try {
    await saveUserData(userId, path, privateKey, publicKeyHex, encryptionPublicKeyHex, data);
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

## What You Got

✅ **Free security benefits:**
- User data automatically private & encrypted
- Signatures prove authenticity
- Public data safe & shared
- Server can't impersonate users
- Scales from hobby to production

---

## Next Steps

1. **Generate user keys** - Use `auth.generateSigningKeyPair()` and `encrypt.generateEncryptionKeyPair()`
2. **Manage keys in your app** - Store and restore them using your own persistence layer
3. **Build your first feature** - Start with user profile (Pattern 1) or public data (Pattern 2)
4. **Use the three patterns** - Choose the right pattern for each feature
5. **Test with real users** - Find bugs early

---

**Made with B3nd - Secure, Universal Data Layer**
