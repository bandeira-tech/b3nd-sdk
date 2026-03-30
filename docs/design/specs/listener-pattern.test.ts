/**
 * Listener Pattern — Failing Spec
 *
 * Tests the request-response pattern over MemoryClient:
 * client writes encrypted request, listener processes it,
 * writes encrypted response, client reads and decrypts.
 *
 * Run: deno test docs/design/specs/listener-pattern.test.ts
 * Expected: All tests fail (functions not implemented)
 */

import { assertEquals } from "@std/assert";

// Proposed API — these don't exist yet
import {
  deriveSigningKeyPairFromSeed,
  deriveEncryptionKeyPairFromSeed,
  hmac,
} from "../../../libs/b3nd-encrypt/mod.ts";

// Existing API
import {
  deriveKeyFromSeed,
  encrypt,
  decrypt,
  sign,
  verify,
  generateEncryptionKeyPair,
  generateSigningKeyPair,
  createAuthenticatedMessageWithHex,
} from "../../../libs/b3nd-encrypt/mod.ts";

import { MemoryClient } from "../../../libs/b3nd-client-memory/mod.ts";

// --- Request-Response over MemoryClient ---

Deno.test("listener: encrypted request-response round-trip", async () => {
  const client = new MemoryClient();

  // Listener setup: has signing and encryption keypairs
  const listenerSigningKP = await generateSigningKeyPair();
  const listenerEncKP = await generateEncryptionKeyPair();

  // Client setup: has signing and encryption keypairs
  const clientSigningKP = await generateSigningKeyPair();
  const clientEncKP = await generateEncryptionKeyPair();

  const requestId = "req-001";
  const inboxUri = `mutable://data/listener/${listenerSigningKP.publicKeyHex}/inbox/${requestId}`;
  const outboxUri = `mutable://data/listener/${listenerSigningKP.publicKeyHex}/outbox/${requestId}`;

  // Step 1: Client writes encrypted request to listener's inbox
  const request = {
    type: "echo",
    data: { message: "Hello listener!" },
    replyTo: outboxUri,
    clientPublicKeyHex: clientEncKP.publicKeyHex,
  };

  const encryptedRequest = await encrypt(
    new TextEncoder().encode(JSON.stringify(request)),
    listenerEncKP.publicKeyHex,
  );
  const signedRequest = await createAuthenticatedMessageWithHex(
    encryptedRequest,
    clientSigningKP.publicKeyHex,
    clientSigningKP.privateKeyHex,
  );

  const writeResult = await client.receive([inboxUri, signedRequest]);
  assertEquals(writeResult.accepted, true);

  // Step 2: Listener reads and decrypts the request
  const inboxRead = await client.read(inboxUri);
  assertEquals(inboxRead.success, true);

  if (inboxRead.success) {
    const storedMessage = inboxRead.record!.data as typeof signedRequest;

    // Verify client's signature
    const sigValid = await verify(
      storedMessage.auth[0].pubkey,
      storedMessage.auth[0].signature,
      storedMessage.payload,
    );
    assertEquals(sigValid, true);

    // Decrypt the request
    const decryptedRequest = JSON.parse(
      new TextDecoder().decode(
        await decrypt(storedMessage.payload, listenerEncKP.privateKey),
      ),
    ) as typeof request;
    assertEquals(decryptedRequest.type, "echo");
    assertEquals(decryptedRequest.data.message, "Hello listener!");

    // Step 3: Listener processes and writes encrypted response
    const response = {
      type: "echo-response",
      data: { echo: decryptedRequest.data.message, processed: true },
    };

    const encryptedResponse = await encrypt(
      new TextEncoder().encode(JSON.stringify(response)),
      decryptedRequest.clientPublicKeyHex,
    );
    const signedResponse = await createAuthenticatedMessageWithHex(
      encryptedResponse,
      listenerSigningKP.publicKeyHex,
      listenerSigningKP.privateKeyHex,
    );

    const responseWrite = await client.receive([
      decryptedRequest.replyTo,
      signedResponse,
    ]);
    assertEquals(responseWrite.accepted, true);
  }

  // Step 4: Client reads and decrypts the response
  const outboxRead = await client.read(outboxUri);
  assertEquals(outboxRead.success, true);

  if (outboxRead.success) {
    const storedResponse = outboxRead.record!.data as {
      auth: Array<{ pubkey: string; signature: string }>;
      payload: { data: string; nonce: string; ephemeralPublicKey: string };
    };

    // Verify listener's signature
    const sigValid = await verify(
      storedResponse.auth[0].pubkey,
      storedResponse.auth[0].signature,
      storedResponse.payload,
    );
    assertEquals(sigValid, true);

    // Decrypt the response
    const decryptedResponse = JSON.parse(
      new TextDecoder().decode(
        await decrypt(storedResponse.payload, clientEncKP.privateKey),
      ),
    ) as { type: string; data: { echo: string; processed: boolean } };
    assertEquals(decryptedResponse.type, "echo-response");
    assertEquals(decryptedResponse.data.echo, "Hello listener!");
    assertEquals(decryptedResponse.data.processed, true);
  }
});

// --- Listener as moderation service ---

Deno.test("listener: moderation service writes signed flags", async () => {
  const client = new MemoryClient();

  // Moderation listener setup
  const modSigningKP = await generateSigningKeyPair();

  // User writes public content
  const userSigningKP = await generateSigningKeyPair();
  const postUri = `mutable://open/posts/${userSigningKP.publicKeyHex}/post-001`;
  const postContent = { title: "My Post", body: "Some content to moderate" };
  const signedPost = await createAuthenticatedMessageWithHex(
    postContent,
    userSigningKP.publicKeyHex,
    userSigningKP.privateKeyHex,
  );

  await client.receive([postUri, signedPost]);

  // Moderator reads the post
  const postRead = await client.read(postUri);
  assertEquals(postRead.success, true);

  // Moderator evaluates and writes a moderation flag
  const moderationUri = `mutable://open/moderation/${userSigningKP.publicKeyHex}/post-001`;
  const moderationFlag = {
    status: "approved",
    postUri: postUri,
    evaluatedAt: Date.now(),
  };
  const signedFlag = await createAuthenticatedMessageWithHex(
    moderationFlag,
    modSigningKP.publicKeyHex,
    modSigningKP.privateKeyHex,
  );

  const flagResult = await client.receive([moderationUri, signedFlag]);
  assertEquals(flagResult.accepted, true);

  // Anyone can read and verify the moderation flag
  const flagRead = await client.read(moderationUri);
  assertEquals(flagRead.success, true);

  if (flagRead.success) {
    const stored = flagRead.record!.data as typeof signedFlag;
    const valid = await verify(
      stored.auth[0].pubkey,
      stored.auth[0].signature,
      stored.payload,
    );
    assertEquals(valid, true);
    assertEquals(stored.auth[0].pubkey, modSigningKP.publicKeyHex);
    assertEquals((stored.payload as typeof moderationFlag).status, "approved");
  }
});

// --- Listener as indexing service ---

Deno.test("listener: indexing service maintains queryable index", async () => {
  const client = new MemoryClient();

  // Indexer listener setup
  const indexerSigningKP = await generateSigningKeyPair();

  // Users write posts
  const alice = await generateSigningKeyPair();
  const bob = await generateSigningKeyPair();

  const alicePost = { title: "Alice's Recipe", tags: ["food", "pasta"] };
  const bobPost = { title: "Bob's Travel Log", tags: ["travel", "europe"] };

  await client.receive([
    `mutable://open/posts/${alice.publicKeyHex}/post-001`,
    await createAuthenticatedMessageWithHex(alicePost, alice.publicKeyHex, alice.privateKeyHex),
  ]);
  await client.receive([
    `mutable://open/posts/${bob.publicKeyHex}/post-001`,
    await createAuthenticatedMessageWithHex(bobPost, bob.publicKeyHex, bob.privateKeyHex),
  ]);

  // Indexer builds an index
  const index = {
    entries: [
      {
        uri: `mutable://open/posts/${alice.publicKeyHex}/post-001`,
        title: "Alice's Recipe",
        tags: ["food", "pasta"],
        author: alice.publicKeyHex,
      },
      {
        uri: `mutable://open/posts/${bob.publicKeyHex}/post-001`,
        title: "Bob's Travel Log",
        tags: ["travel", "europe"],
        author: bob.publicKeyHex,
      },
    ],
    updatedAt: Date.now(),
  };

  const signedIndex = await createAuthenticatedMessageWithHex(
    index,
    indexerSigningKP.publicKeyHex,
    indexerSigningKP.privateKeyHex,
  );

  const indexUri = `mutable://open/indexes/${indexerSigningKP.publicKeyHex}/posts`;
  await client.receive([indexUri, signedIndex]);

  // Any client can read the index
  const indexRead = await client.read(indexUri);
  assertEquals(indexRead.success, true);

  if (indexRead.success) {
    const stored = indexRead.record!.data as typeof signedIndex;
    const valid = await verify(
      stored.auth[0].pubkey,
      stored.auth[0].signature,
      stored.payload,
    );
    assertEquals(valid, true);
    assertEquals((stored.payload as typeof index).entries.length, 2);
  }
});

// --- End-to-end: OAuth auth request via listener ---

Deno.test("end-to-end: oauth auth request → HMAC response → identity derivation", async () => {
  const client = new MemoryClient();

  // Listener setup
  const listenerSigningKP = await generateSigningKeyPair();
  const listenerEncKP = await generateEncryptionKeyPair();
  const nodeSecret = "listener-oauth-hmac-secret";

  // Client setup
  const clientEncKP = await generateEncryptionKeyPair();
  const requestId = "auth-req-001";
  const inboxUri = `mutable://data/auth/${listenerSigningKP.publicKeyHex}/inbox/${requestId}`;
  const outboxUri = `mutable://data/auth/${listenerSigningKP.publicKeyHex}/outbox/${requestId}`;

  // Step 1: Client writes auth request
  const mockGoogleSub = "google-user-sub-xyz789";
  const authRequest = {
    type: "oauth-auth",
    provider: "google",
    // In reality this would be the ID token; listener verifies it
    // For this test we simulate with the sub directly
    sub: mockGoogleSub,
    clientPublicKeyHex: clientEncKP.publicKeyHex,
    replyTo: outboxUri,
  };

  const encryptedRequest = await encrypt(
    new TextEncoder().encode(JSON.stringify(authRequest)),
    listenerEncKP.publicKeyHex,
  );
  await client.receive([inboxUri, encryptedRequest]);

  // Step 2: Listener reads, decrypts, processes
  const reqRead = await client.read(inboxUri);
  assertEquals(reqRead.success, true);

  if (reqRead.success) {
    const storedReq = reqRead.record!.data as typeof encryptedRequest;
    const decryptedReq = JSON.parse(
      new TextDecoder().decode(
        await decrypt(storedReq, listenerEncKP.privateKey),
      ),
    ) as typeof authRequest;

    // Listener derives deterministic secret
    const derivedSecret = await hmac(nodeSecret, decryptedReq.sub);

    // Listener encrypts secret to client
    const response = { type: "oauth-auth-response", secret: derivedSecret };
    const encryptedResponse = await encrypt(
      new TextEncoder().encode(JSON.stringify(response)),
      decryptedReq.clientPublicKeyHex,
    );
    const signedResponse = await createAuthenticatedMessageWithHex(
      encryptedResponse,
      listenerSigningKP.publicKeyHex,
      listenerSigningKP.privateKeyHex,
    );

    await client.receive([decryptedReq.replyTo, signedResponse]);
  }

  // Step 3: Client reads response, decrypts, derives identity
  const respRead = await client.read(outboxUri);
  assertEquals(respRead.success, true);

  if (respRead.success) {
    const storedResp = respRead.record!.data as {
      auth: Array<{ pubkey: string; signature: string }>;
      payload: { data: string; nonce: string; ephemeralPublicKey: string };
    };

    // Verify listener's signature
    const sigValid = await verify(
      storedResp.auth[0].pubkey,
      storedResp.auth[0].signature,
      storedResp.payload,
    );
    assertEquals(sigValid, true);
    assertEquals(storedResp.auth[0].pubkey, listenerSigningKP.publicKeyHex);

    // Decrypt response
    const decryptedResp = JSON.parse(
      new TextDecoder().decode(
        await decrypt(storedResp.payload, clientEncKP.privateKey),
      ),
    ) as { type: string; secret: string };

    assertEquals(decryptedResp.type, "oauth-auth-response");

    // Derive identity from the secret
    const signingKeypair = await deriveSigningKeyPairFromSeed(decryptedResp.secret);
    const encryptionKeypair = await deriveEncryptionKeyPairFromSeed(decryptedResp.secret);

    assertEquals(typeof signingKeypair.publicKeyHex, "string");
    assertEquals(signingKeypair.publicKeyHex.length, 64);
    assertEquals(typeof encryptionKeypair.publicKeyHex, "string");
    assertEquals(encryptionKeypair.publicKeyHex.length, 64);

    // Same flow produces same identity
    const derivedSecret2 = await hmac(nodeSecret, mockGoogleSub);
    const signingKeypair2 = await deriveSigningKeyPairFromSeed(derivedSecret2);
    assertEquals(signingKeypair.publicKeyHex, signingKeypair2.publicKeyHex);
  }
});
