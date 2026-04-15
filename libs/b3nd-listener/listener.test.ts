import { assertEquals } from "@std/assert";
import { connect, readResponse, respondTo, writeRequest } from "./mod.ts";
import { MemoryStore } from "../b3nd-client-memory/store.ts";
import { DataClient } from "../b3nd-core/data-client.ts";
import {
  generateEncryptionKeyPair,
  generateSigningKeyPair,
} from "../b3nd-encrypt/mod.ts";

Deno.test("respondTo + connect: request-response round-trip", async () => {
  const client = new DataClient(new MemoryStore());

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
  const outboxUri =
    `mutable://data/service/${signing.publicKeyHex}/outbox/${requestId}`;

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
  const response = await readResponse<
    { echo: { message: string }; processed: boolean }
  >({
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
  const client = new DataClient(new MemoryStore());

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
  const client = new DataClient(new MemoryStore());

  const signing = await generateSigningKeyPair();
  const enc = await generateEncryptionKeyPair();
  const identity = { signingKeyPair: signing, encryptionKeyPair: enc };
  const clientEnc = await generateEncryptionKeyPair();

  const inboxPrefix = `mutable://data/unsigned/${signing.publicKeyHex}/inbox`;
  const inboxUri = `${inboxPrefix}/req-unsigned`;
  const outboxUri =
    `mutable://data/unsigned/${signing.publicKeyHex}/outbox/req-unsigned`;

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

  const response = await readResponse<
    { got: { anonymous: boolean }; hasSender: boolean }
  >({
    client,
    responseUri: outboxUri,
    clientEncryptionPrivateKey: clientEnc.privateKey,
  });

  assertEquals(response!.data.got, { anonymous: true });
  assertEquals(response!.data.hasSender, false);
});

Deno.test("connect: empty inbox returns 0", async () => {
  const client = new DataClient(new MemoryStore());

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
