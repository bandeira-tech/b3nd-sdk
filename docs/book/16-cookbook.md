# 16. Cookbook

Each recipe follows the three-layer scaffold one final time: first the speech
version, then the paper version, then the b3nd code. By now, the pattern is
familiar — and the code should feel like the natural last step.

---

## 1. The Public Bulletin Board

**In speech:** Stand in the town square and say something for everyone to hear.

**In paper:** Pin a note to the community board.

**In b3nd:**

```typescript
import { HttpClient } from "@bandeira-tech/b3nd-sdk";

const client = new HttpClient({ url: "http://localhost:9942" });

// Post a public note
await client.receive([
  "mutable://open/my-app/announcements/hello",
  { text: "Hello everyone!", postedAt: Date.now() },
]);

// Anyone can read it
const results = await client.read("mutable://open/my-app/announcements/hello");
console.log(results[0]?.record?.data);
// → { text: "Hello everyone!", postedAt: 1708700000000 }

// Anyone can browse all announcements (trailing slash = list)
const all = await client.read("mutable://open/my-app/announcements/");
```

No signature needed. No identity required. Open address, open content. Like a
public chalkboard.

---

## 2. The Private Journal

**In speech:** Think to yourself. The conversation is internal — no medium
carries it anywhere.

**In paper:** Write in a locked diary. Only you have the key.

**In b3nd:**

```typescript
import * as encrypt from "@bandeira-tech/b3nd-sdk/encrypt";

const me = await encrypt.generateSigningKeyPair();

// Encrypt the content so only I can read it
const encrypted = await encrypt.encryptData(
  { thoughts: "Today was a good day.", date: "2025-03-01" },
  myEncryptionKey,
);

// Sign it (proves I wrote it) and store at my address
const signed = await encrypt.createAuthenticatedMessageWithHex(
  encrypted,
  me.publicKeyHex,
  me.privateKeyHex,
);

await client.receive([
  `mutable://accounts/${me.publicKeyHex}/journal/2025-03-01`,
  signed,
]);
```

Signed (proves authorship) and encrypted (only you can read it). The node stores
an opaque blob. Even if someone reads the address, the content is gibberish
without your key.

---

## 3. The Signed Announcement

**In speech:** Stand at the podium, with cameras rolling, and make a statement.
Your face is your credential. The recording is the proof.

**In paper:** Publish a sealed proclamation bearing your official seal.

**In b3nd:**

```typescript
const announcement = {
  title: "New Policy",
  body: "Starting today, all submissions require two endorsements.",
  effectiveDate: "2025-04-01",
};

const signed = await encrypt.createAuthenticatedMessageWithHex(
  announcement,
  me.publicKeyHex,
  me.privateKeyHex,
);

await client.receive([
  `mutable://accounts/${me.publicKeyHex}/announcements/new-policy`,
  signed,
]);
```

Anyone can read the announcement. Anyone can verify the signature — confirming
that the holder of the private key matching `me.publicKeyHex` wrote it.
Non-repudiation: the author can't deny they published it.

---

## 4. The Two-Party Handshake

**In speech:** Alice asks a question. Bob answers. A complete exchange.

**In paper:** Alice writes a letter to Bob. Bob writes a reply.

**In b3nd:**

```typescript
// Alice sends a request to Bob's inbox
const request = await encrypt.createAuthenticatedMessageWithHex(
  { question: "Can you process order #42?" },
  alice.publicKeyHex,
  alice.privateKeyHex,
);

await client.receive([
  `immutable://inbox/${bob.publicKeyHex}/orders/${Date.now()}`,
  request,
]);

// Bob checks his inbox (trailing slash = list)
const items = await client.read(
  `immutable://inbox/${bob.publicKeyHex}/orders/`,
);

// Bob reads the request
const msg = (await client.read(items[0].uri!))[0];

// Bob sends a reply to Alice's inbox
const response = await encrypt.createAuthenticatedMessageWithHex(
  { answer: "Order #42 confirmed.", orderId: 42 },
  bob.publicKeyHex,
  bob.privateKeyHex,
);

await client.receive([
  `immutable://inbox/${alice.publicKeyHex}/confirmations/${Date.now()}`,
  response,
]);

// Message processed — move on to the next
```

Two messages. Two inboxes. A complete request-response dialogue.

---

## 5. The Inbox Service

**In speech:** Hire a receptionist who sits at a desk, takes requests, and gives
answers.

**In paper:** Open a correspondence office with a mailing address and staff who
read and reply to letters.

**In b3nd:**

```typescript
import { connect, respondTo } from "@bandeira-tech/b3nd-sdk/listener";

const serviceIdentity = await encrypt.generateSigningKeyPair();

// The handler: a function that takes a request and returns a response
const processor = respondTo(
  async (request: { action: string; data: unknown }) => {
    switch (request.action) {
      case "lookup":
        return { found: true, record: "some-data" };
      case "status":
        return { status: "operational", uptime: process.uptime() };
      default:
        return { error: "Unknown action" };
    }
  },
  { identity: serviceIdentity, client },
);

// Start checking the inbox every 5 seconds
const connection = connect(client, {
  prefix: `immutable://inbox/${serviceIdentity.publicKeyHex}/`,
  processor,
  pollIntervalMs: 5000,
});

connection.start();
console.log(`Service listening at: ${serviceIdentity.publicKeyHex}`);
```

The service is a clerk. `connect()` means "start checking the mailbox."
`respondTo()` means "when you get a letter, open it, do the work, seal the
reply, and mail it back." The handler function is what the clerk actually does.

---

## 6. The Notarized Agreement

**In speech:** Alice and Bob make a deal. Carol witnesses it.

**In paper:** Alice and Bob sign a contract. A notary stamps it.

**In b3nd:**

```typescript
// Alice signs a proposal
const proposal = await encrypt.createAuthenticatedMessageWithHex(
  { type: "trade", offer: "50 tokens", wants: "document-xyz" },
  alice.publicKeyHex,
  alice.privateKeyHex,
);

// Bob counter-signs (accepting the proposal)
const acceptance = await encrypt.createAuthenticatedMessageWithHex(
  { type: "acceptance", proposal: proposal, accepted: true },
  bob.publicKeyHex,
  bob.privateKeyHex,
);

// A validator (Carol) endorses the agreement
const endorsement = await encrypt.createAuthenticatedMessageWithHex(
  { type: "endorsement", agreement: acceptance, valid: true },
  carol.publicKeyHex,
  carol.privateKeyHex,
);

// File the endorsed agreement permanently
const hash = await computeSha256(JSON.stringify(endorsement));
await client.receive([`hash://sha256/${hash}`, endorsement]);
```

Three layers: proposal, acceptance, endorsement. Each wraps the previous. The
hash address makes the final record permanent and self-verifying.

---

## 7. The Consensus Chain

**In speech:** Town hall vote — propose, debate, vote, declare.

**In paper:** Bill passes through committee, floor vote, executive signature.

**In b3nd:**

```typescript
// Step 1: User submits a transaction
const submission = await encrypt.createAuthenticatedMessageWithHex(
  {
    action: "transfer",
    from: alice.publicKeyHex,
    to: bob.publicKeyHex,
    amount: 100,
  },
  alice.publicKeyHex,
  alice.privateKeyHex,
);

await client.receive([
  `immutable://inbox/${validatorKey}/submissions/${Date.now()}`,
  submission,
]);

// Step 2: Validator endorses (wraps the submission)
const endorsement = await encrypt.createAuthenticatedMessageWithHex(
  { type: "validation", submission: submission, checks: "passed" },
  validatorKey,
  validatorPrivateKey,
);

await client.receive([
  `immutable://inbox/${confirmerKey}/endorsements/${Date.now()}`,
  endorsement,
]);

// Step 3: Confirmer finalizes (wraps the endorsement)
const confirmation = await encrypt.createAuthenticatedMessageWithHex(
  { type: "confirmation", endorsement: endorsement, finalized: true },
  confirmerKey,
  confirmerPrivateKey,
);

// File permanently with hash chain reference
const hash = await computeSha256(JSON.stringify(confirmation));
await client.receive([`hash://sha256/${hash}`, confirmation]);

// Update the chain head pointer
await client.receive([
  `link://accounts/${confirmerKey}/chain/latest`,
  { ref: `hash://sha256/${hash}` },
]);
```

User → validator → confirmer. Nested envelopes. Hash-addressed permanent record.
Link pointer to the latest entry. A full consensus chain in a few message
exchanges.

---

## 8. The Atomic Trade

**In speech:** Simultaneous handshake exchange.

**In paper:** Escrow contract.

**In b3nd:**

```typescript
import { send } from "@bandeira-tech/b3nd-sdk";

await send({
  payload: {
    inputs: [
      `mutable://accounts/${alice.publicKeyHex}/tokens/50`,
      `mutable://accounts/${bob.publicKeyHex}/documents/xyz`,
    ],
    outputs: [
      [
        `mutable://accounts/${bob.publicKeyHex}/tokens/50`,
        await encrypt.createAuthenticatedMessageWithHex(
          { amount: 50 },
          alice.publicKeyHex,
          alice.privateKeyHex,
        ),
      ],
      [
        `mutable://accounts/${alice.publicKeyHex}/documents/xyz`,
        await encrypt.createAuthenticatedMessageWithHex(
          { document: "xyz-content" },
          bob.publicKeyHex,
          bob.privateKeyHex,
        ),
      ],
    ],
  },
}, client);
```

One envelope. Both sides. Either both succeed or neither does. The node is the
escrow — it validates the signatures, checks conservation, and executes
atomically.

---

## 9. The Audit Trail

**In speech:** "Everyone heard the vote — we all remember."

**In paper:** Paper trail in the archive.

**In b3nd:**

```typescript
// Each event references the previous one
let previousHash = null;

async function recordEvent(event: Record<string, unknown>) {
  const entry = {
    ...event,
    previous: previousHash,
    timestamp: Date.now(),
  };

  const hash = await computeSha256(JSON.stringify(entry));
  await client.receive([`hash://sha256/${hash}`, entry]);

  // Update the pointer
  previousHash = hash;
  await client.receive([
    `link://accounts/${auditorKey}/trail/latest`,
    { ref: `hash://sha256/${hash}` },
  ]);

  return hash;
}

// Usage
await recordEvent({ action: "account-created", user: "alice" });
await recordEvent({ action: "deposit", user: "alice", amount: 100 });
await recordEvent({ action: "transfer", from: "alice", to: "bob", amount: 50 });
```

Each event stores the hash of the previous event. Walk backward from "latest" to
verify the entire chain. Alter any event and the hashes break.

---

## 10. Start a New Post Office

**In speech:** Open a new office and hire a clerk.

**In paper:** Commission a postal branch with sorting rooms and delivery routes.

**In b3nd:**

```typescript
import {
  createServerNode,
  MessageDataClient,
  MemoryStore,
  servers,
} from "@bandeira-tech/b3nd-sdk";
import { Hono } from "hono";

const programs = [
  "mutable://open",
  "mutable://accounts",
  "immutable://inbox",
  "hash://sha256",
];

const client = new MessageDataClient(new MemoryStore());
const app = new Hono();
const frontend = servers.httpServer(app);
const node = createServerNode({ frontend, client });

node.listen(43100);
console.log("Post office open on port 43100");
```

A node is a post office. The programs are the house rules. `listen()` means
"open the doors." Thirteen lines of code.

---

## 11. Go Back in Time

**In speech:** "Let's start over from what we agreed on Tuesday."

**In paper:** Re-read the minutes from a specific meeting and restart from
there.

**In b3nd:**

```typescript
// Find the last known good state
const trail =
  (await client.read(`link://accounts/${auditorKey}/trail/latest`))[0];
let cursor = trail?.record?.data.ref;

// Walk backward to find the checkpoint
while (cursor) {
  const entry = (await client.read(cursor))[0];
  if (entry?.record?.data.type === "checkpoint") {
    console.log("Found checkpoint:", entry.record.data);
    break;
  }
  cursor = entry?.record?.data.previous
    ? `hash://sha256/${entry.record.data.previous}`
    : null;
}

// Replay messages from the checkpoint forward
// (Application-specific: re-process each event after the checkpoint)
```

The message history IS the state. To rollback, walk the chain to the desired
point and reprocess.

---

## 12. Ask Two Clerks the Same Question

**In speech:** Ask two people the same question and compare answers.

**In paper:** Send the same letter to two offices and compare replies.

**In b3nd:**

```typescript
const nodeA = new HttpClient({ url: "https://node-a.example.com" });
const nodeB = new HttpClient({ url: "https://node-b.example.com" });

// Send the same message to both
const message = ["mutable://open/test/consistency-check", { value: 42 }];
const [resultA, resultB] = await Promise.all([
  nodeA.receive(message),
  nodeB.receive(message),
]);

// Read from both and compare
const [readA, readB] = await Promise.all([
  nodeA.read("mutable://open/test/consistency-check"),
  nodeB.read("mutable://open/test/consistency-check"),
]);

console.log(
  "Consistent:",
  JSON.stringify(readA[0]?.record?.data) ===
    JSON.stringify(readB[0]?.record?.data),
);
```

Same input, two nodes. Compare outputs. If they disagree, investigate.

---

## 13. Forward All Mail

**In speech:** "Repeat everything I say to the person in the next room."

**In paper:** CC every letter to a second address.

**In b3nd:**

```typescript
import { createValidatedClient } from "@bandeira-tech/b3nd-sdk";
import { flood, peer } from "@bandeira-tech/b3nd-sdk/network";

const peers = [
  peer(new HttpClient({ url: "https://primary.example.com" }), { id: "primary" }),
  peer(new HttpClient({ url: "https://replica.example.com" }), { id: "replica" }),
];
const composed = flood(peers); // broadcast writes, first-match reads

const client = createValidatedClient({
  write: composed,
  read: composed,
});

// Use normally — replication is automatic
await client.receive([["mutable://open/data/item1", {}, { value: "hello" }]]);
// Both nodes now have the message
```

Every message is forwarded. If the primary goes down, the replica has the full
conversation.

---

## 14. The Authentication Conversation

**In speech:** "Show your face." Guard recognizes you. Door opens.

**In paper:** "Show your letter of introduction." Guard inspects the seal. Door
opens.

**In b3nd:**

```typescript
// Step 1: Derive identity from credentials (client-side, no server)
const salt = `my-app-${username}`;
const seed = await encrypt.deriveKeyFromSeed(password, salt, 100000);
const signingKeys = await encrypt.deriveSigningKeyPairFromSeed(seed);
const encryptionKeys = await encrypt.deriveEncryptionKeyPairFromSeed(seed);

// The public key IS the identity — same credentials always produce the same keys
console.log("My identity:", signingKeys.publicKeyHex);

// Step 2: Write to your address (signed — proves you hold the key)
const profile = await encrypt.createAuthenticatedMessageWithHex(
  { name: "Alice", bio: "Hello!" },
  signingKeys.publicKeyHex,
  signingKeys.privateKeyHex,
);

await client.receive([
  `mutable://accounts/${signingKeys.publicKeyHex}/profile`,
  profile,
]);

// The node verifies: the signature matches the public key in the address.
// Identity proven. No server, no database, no session. Just a key and a signature.
```

Same credentials → same key → same identity. Every time. No server stores your
password. No database stores your keys. The key IS you. The signature IS your
face in the digital room.

---

## The Pattern, One Last Time

Every recipe followed the same scaffold:

1. Here's the conversation in speech — face to face, intuitive
2. Here's the conversation in paper — traveling through carriers, sealed and
   signed
3. Here's the conversation in b3nd — typed into code, but recognizable as the
   same dialogue

The code is not the point. The conversation is the point. The code is just how
you type the conversation into a machine.

If you can read these recipes and follow the three-layer progression, you can
build anything on b3nd. Because anything you build is just a conversation — and
you've been having conversations your entire life.
