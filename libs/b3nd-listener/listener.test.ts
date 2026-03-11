import { assertEquals } from "@std/assert";
import { respondTo, connect, writeRequest, readResponse } from "./mod.ts";
import type { Handler } from "./mod.ts";
import { MemoryClient, createTestSchema } from "../b3nd-client-memory/mod.ts";
import {
  generateSigningKeyPair,
  generateEncryptionKeyPair,
  encrypt,
  createAuthenticatedMessageWithHex,
} from "../b3nd-encrypt/mod.ts";
import type { NodeProtocolInterface } from "../b3nd-core/types.ts";

Deno.test("respondTo + connect: request-response round-trip", async () => {
  const client = new MemoryClient({ schema: createTestSchema() });

  // Service identity
  const signing = await generateSigningKeyPair();
  const enc = await generateEncryptionKeyPair();
  const identity = { signingKeyPair: signing, encryptionKeyPair: enc };

  // Client identity
  const clientSigning = await generateSigningKeyPair();
  const clientEnc = await generateEncryptionKeyPair();

  const inboxPrefix = `mutable://data/service/${signing.publicKeyHex}/inbox`;
  const requestId = "req-001";
  const inboxUri = `${inboxPrefix}/${requestId}`;
  const outboxUri = `mutable://data/service/${signing.publicKeyHex}/outbox/${requestId}`;

  // Create processor from handler
  const processor = respondTo(
    async (req) => ({ echo: req.data, processed: true }),
    { identity, client },
  );

  // Create connection
  const connection = connect(client, { prefix: inboxPrefix, processor });

  // Client writes request
  await writeRequest({
    client,
    listenerEncryptionPublicKeyHex: enc.publicKeyHex,
    inboxUri,
    data: { message: "hello" },
    clientEncryptionPublicKeyHex: clientEnc.publicKeyHex,
    replyToUri: outboxUri,
    signingKeyPair: clientSigning,
  });

  // Poll
  const processed = await connection.poll();
  assertEquals(processed, 1);

  // Client reads response
  const response = await readResponse<{ echo: { message: string }; processed: boolean }>({
    client,
    responseUri: outboxUri,
    clientEncryptionPrivateKey: clientEnc.privateKey,
    listenerPublicKeyHex: signing.publicKeyHex,
  });

  assertEquals(response !== null, true);
  assertEquals(response!.data.echo, { message: "hello" });
  assertEquals(response!.data.processed, true);
  assertEquals(response!.verified, true);
});

Deno.test("connect: processes multiple requests in one poll", async () => {
  const client = new MemoryClient({ schema: createTestSchema() });

  const signing = await generateSigningKeyPair();
  const enc = await generateEncryptionKeyPair();
  const identity = { signingKeyPair: signing, encryptionKeyPair: enc };
  const clientEnc = await generateEncryptionKeyPair();

  const inboxPrefix = `mutable://data/multi/${signing.publicKeyHex}/inbox`;

  const processor = respondTo(
    async (req) => ({ received: req.requestId }),
    { identity, client },
  );
  const connection = connect(client, { prefix: inboxPrefix, processor });

  // Write 3 requests
  for (const id of ["a", "b", "c"]) {
    await writeRequest({
      client,
      listenerEncryptionPublicKeyHex: enc.publicKeyHex,
      inboxUri: `${inboxPrefix}/${id}`,
      data: { id },
      clientEncryptionPublicKeyHex: clientEnc.publicKeyHex,
      replyToUri: `mutable://data/multi/${signing.publicKeyHex}/outbox/${id}`,
    });
  }

  const processed = await connection.poll();
  assertEquals(processed, 3);

  // Second poll processes nothing (already handled)
  const reprocessed = await connection.poll();
  assertEquals(reprocessed, 0);
});

Deno.test("respondTo: handles unsigned requests", async () => {
  const client = new MemoryClient({ schema: createTestSchema() });

  const signing = await generateSigningKeyPair();
  const enc = await generateEncryptionKeyPair();
  const identity = { signingKeyPair: signing, encryptionKeyPair: enc };
  const clientEnc = await generateEncryptionKeyPair();

  const inboxPrefix = `mutable://data/unsigned/${signing.publicKeyHex}/inbox`;
  const inboxUri = `${inboxPrefix}/req-unsigned`;
  const outboxUri = `mutable://data/unsigned/${signing.publicKeyHex}/outbox/req-unsigned`;

  const processor = respondTo(
    async (req) => ({ got: req.data, hasSender: !!req.senderPublicKeyHex }),
    { identity, client },
  );
  const connection = connect(client, { prefix: inboxPrefix, processor });

  // Write WITHOUT signing
  await writeRequest({
    client,
    listenerEncryptionPublicKeyHex: enc.publicKeyHex,
    inboxUri,
    data: { anonymous: true },
    clientEncryptionPublicKeyHex: clientEnc.publicKeyHex,
    replyToUri: outboxUri,
  });

  const processed = await connection.poll();
  assertEquals(processed, 1);

  const response = await readResponse<{ got: { anonymous: boolean }; hasSender: boolean }>({
    client,
    responseUri: outboxUri,
    clientEncryptionPrivateKey: clientEnc.privateKey,
  });

  assertEquals(response!.data.got, { anonymous: true });
  assertEquals(response!.data.hasSender, false);
});

Deno.test("connect: empty inbox returns 0", async () => {
  const client = new MemoryClient({ schema: createTestSchema() });

  const signing = await generateSigningKeyPair();
  const enc = await generateEncryptionKeyPair();
  const identity = { signingKeyPair: signing, encryptionKeyPair: enc };

  const processor = respondTo(
    async () => ({}),
    { identity, client },
  );

  const connection = connect(client, {
    prefix: `mutable://data/empty/${signing.publicKeyHex}/inbox`,
    processor,
  });

  const processed = await connection.poll();
  assertEquals(processed, 0);
});

// ── Error path tests ────────────────────────────────────────────────

/** Helper: create an identity (signing + encryption keypairs) */
async function createIdentity() {
  const signing = await generateSigningKeyPair();
  const enc = await generateEncryptionKeyPair();
  return { signingKeyPair: signing, encryptionKeyPair: enc };
}

/** Helper: encrypt a payload to the listener's encryption public key */
async function encryptPayload(
  payload: unknown,
  recipientPublicKeyHex: string,
) {
  return await encrypt(
    new TextEncoder().encode(JSON.stringify(payload)),
    recipientPublicKeyHex,
  );
}

Deno.test("respondTo: handler that throws Error returns Handler error", async () => {
  const client = new MemoryClient({ schema: createTestSchema() });
  const identity = await createIdentity();
  const clientEnc = await generateEncryptionKeyPair();

  const processor = respondTo(
    async () => { throw new Error("something broke"); },
    { identity, client },
  );

  // Build a valid encrypted payload
  const requestPayload = {
    data: { test: true },
    clientPublicKeyHex: clientEnc.publicKeyHex,
    replyTo: "mutable://data/test/outbox/req-1",
  };
  const encrypted = await encryptPayload(requestPayload, identity.encryptionKeyPair.publicKeyHex);

  const result = await processor(["mutable://data/test/inbox/req-1", encrypted]);

  assertEquals(result.success, false);
  assertEquals(result.error!.startsWith("Handler error:"), true);
  assertEquals(result.error!.includes("something broke"), true);
});

Deno.test("respondTo: handler that throws non-Error value returns Handler error", async () => {
  const client = new MemoryClient({ schema: createTestSchema() });
  const identity = await createIdentity();
  const clientEnc = await generateEncryptionKeyPair();

  const processor = respondTo(
    async () => { throw "string-error"; },
    { identity, client },
  );

  const requestPayload = {
    data: { test: true },
    clientPublicKeyHex: clientEnc.publicKeyHex,
    replyTo: "mutable://data/test/outbox/req-2",
  };
  const encrypted = await encryptPayload(requestPayload, identity.encryptionKeyPair.publicKeyHex);

  const result = await processor(["mutable://data/test/inbox/req-2", encrypted]);

  assertEquals(result.success, false);
  assertEquals(result.error!.startsWith("Handler error:"), true);
  assertEquals(result.error!.includes("string-error"), true);
});

Deno.test("respondTo: corrupted encrypted payload returns Decryption failed", async () => {
  const client = new MemoryClient({ schema: createTestSchema() });
  const identity = await createIdentity();

  const processor = respondTo(
    async () => ({}),
    { identity, client },
  );

  // Fabricate a payload with valid structure but garbage data
  const corruptedPayload = {
    data: "AAAA", // base64 junk
    nonce: "BBBBBBBBBBBBBBBB", // base64 junk
    ephemeralPublicKey: "0000000000000000000000000000000000000000000000000000000000000000", // 32 bytes hex but wrong key
  };

  const result = await processor(["mutable://data/test/inbox/corrupt", corruptedPayload]);

  assertEquals(result.success, false);
  assertEquals(result.error!.startsWith("Decryption failed:"), true);
});

Deno.test("respondTo: payload missing replyTo returns specific error", async () => {
  const client = new MemoryClient({ schema: createTestSchema() });
  const identity = await createIdentity();
  const clientEnc = await generateEncryptionKeyPair();

  const processor = respondTo(
    async () => ({}),
    { identity, client },
  );

  // Valid encrypted payload but missing replyTo
  const requestPayload = {
    data: { test: true },
    clientPublicKeyHex: clientEnc.publicKeyHex,
    // replyTo intentionally omitted
  };
  const encrypted = await encryptPayload(requestPayload, identity.encryptionKeyPair.publicKeyHex);

  const result = await processor(["mutable://data/test/inbox/no-reply", encrypted]);

  assertEquals(result.success, false);
  assertEquals(result.error, "Missing replyTo in request payload");
});

Deno.test("respondTo: payload missing clientPublicKeyHex returns specific error", async () => {
  const client = new MemoryClient({ schema: createTestSchema() });
  const identity = await createIdentity();

  const processor = respondTo(
    async () => ({}),
    { identity, client },
  );

  // Valid encrypted payload but missing clientPublicKeyHex
  const requestPayload = {
    data: { test: true },
    // clientPublicKeyHex intentionally omitted
    replyTo: "mutable://data/test/outbox/req-x",
  };
  const encrypted = await encryptPayload(requestPayload, identity.encryptionKeyPair.publicKeyHex);

  const result = await processor(["mutable://data/test/inbox/no-client-key", encrypted]);

  assertEquals(result.success, false);
  assertEquals(result.error, "Missing clientPublicKeyHex in request payload");
});

Deno.test("respondTo: write-back failure returns Response delivery failed", async () => {
  const identity = await createIdentity();
  const clientEnc = await generateEncryptionKeyPair();

  // Create a client whose receive() always rejects
  const failingClient: NodeProtocolInterface = {
    receive: async () => { throw new Error("write refused"); },
    read: async () => ({ success: false, error: "not found" }),
    readMulti: async () => ({ success: false, results: [], summary: { total: 0, succeeded: 0, failed: 0 } }),
    list: async () => ({ success: false, error: "not supported" }),
    delete: async () => ({ success: false, error: "not supported" }),
    health: async () => ({ status: "healthy" }),
    getSchema: async () => [],
    cleanup: async () => {},
  };

  const processor = respondTo(
    async () => ({ ok: true }),
    { identity, client: failingClient },
  );

  const requestPayload = {
    data: { test: true },
    clientPublicKeyHex: clientEnc.publicKeyHex,
    replyTo: "mutable://data/test/outbox/req-fail",
  };
  const encrypted = await encryptPayload(requestPayload, identity.encryptionKeyPair.publicKeyHex);

  const result = await processor(["mutable://data/test/inbox/write-fail", encrypted]);

  assertEquals(result.success, false);
  assertEquals(result.error!.startsWith("Response delivery failed:"), true);
  assertEquals(result.error!.includes("write refused"), true);
});

Deno.test("respondTo: message that is neither signed nor encrypted returns error", async () => {
  const client = new MemoryClient({ schema: createTestSchema() });
  const identity = await createIdentity();

  const processor = respondTo(
    async () => ({}),
    { identity, client },
  );

  // Send a raw string, not an encrypted or signed object
  const result = await processor(["mutable://data/test/inbox/junk", "not-an-object"]);

  assertEquals(result.success, false);
  assertEquals(result.error, "Message is neither signed nor encrypted");
});
