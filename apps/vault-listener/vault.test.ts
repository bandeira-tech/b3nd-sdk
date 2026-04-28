import { assertEquals, assertNotEquals } from "@std/assert";
import { connect, readResponse, respondTo, writeRequest } from "@b3nd/listener";
import {
  deriveEncryptionKeyPairFromSeed,
  deriveSigningKeyPairFromSeed,
  generateEncryptionKeyPair,
  generateSigningKeyPair,
  hmac,
} from "@b3nd/encrypt";
import { MemoryStore } from "../../libs/b3nd-client-memory/store.ts";
import { DataStoreClient } from "../../libs/b3nd-core/data-store-client.ts";

import {
  createVaultHandler,
  mockVerifier,
  type VaultAuthRequest,
  type VaultAuthResponse,
} from "./vault.ts";

Deno.test("vault: end-to-end auth flow with mock verifier", async () => {
  const client = new DataStoreClient(new MemoryStore());

  // Vault identity
  const vaultSigning = await generateSigningKeyPair();
  const vaultEnc = await generateEncryptionKeyPair();
  const identity = {
    signingKeyPair: vaultSigning,
    encryptionKeyPair: vaultEnc,
  };
  const nodeSecret = "test-vault-secret";

  // Client identity (ephemeral encryption keys for this session)
  const clientEnc = await generateEncryptionKeyPair();

  // Create vault handler with mock Google verifier
  const handler = createVaultHandler({
    nodeSecret,
    verifiers: new Map([["google", mockVerifier("google")]]),
  });

  const inboxPrefix = `mutable://data/vault/${vaultSigning.publicKeyHex}/inbox`;

  // Compose: respondTo wraps the handler, connect provides transport
  const processor = respondTo<VaultAuthRequest, VaultAuthResponse>(handler, {
    identity,
    client,
  });
  const connection = connect(client, { prefix: inboxPrefix, processor });

  // Client sends auth request
  const requestId = "auth-001";
  const inboxUri = `${inboxPrefix}/${requestId}`;
  const outboxUri =
    `mutable://data/vault/${vaultSigning.publicKeyHex}/outbox/${requestId}`;

  await writeRequest<VaultAuthRequest>({
    client,
    listenerEncryptionPublicKeyHex: vaultEnc.publicKeyHex,
    inboxUri,
    data: { provider: "google", token: "google-user-sub-12345" },
    clientEncryptionPublicKeyHex: clientEnc.publicKeyHex,
    replyToUri: outboxUri,
  });

  // Vault processes
  const processed = await connection.poll();
  assertEquals(processed, 1);

  // Client reads response
  const response = await readResponse<VaultAuthResponse>({
    client,
    responseUri: outboxUri,
    clientEncryptionPrivateKey: clientEnc.privateKey,
    listenerPublicKeyHex: vaultSigning.publicKeyHex,
  });

  assertEquals(response !== null, true);
  assertEquals(response!.verified, true);
  assertEquals(response!.data.provider, "google");
  assertEquals(typeof response!.data.secret, "string");
  assertEquals(response!.data.secret.length, 64);

  // Client derives identity from the secret
  const signingKP = await deriveSigningKeyPairFromSeed(response!.data.secret);
  const encryptionKP = await deriveEncryptionKeyPairFromSeed(
    response!.data.secret,
  );

  assertEquals(signingKP.publicKeyHex.length, 64);
  assertEquals(encryptionKP.publicKeyHex.length, 64);
});

Deno.test("vault: same provider account always yields same identity", async () => {
  const client = new DataStoreClient(new MemoryStore());

  const vaultSigning = await generateSigningKeyPair();
  const vaultEnc = await generateEncryptionKeyPair();
  const identity = {
    signingKeyPair: vaultSigning,
    encryptionKeyPair: vaultEnc,
  };
  const nodeSecret = "stable-vault-secret";

  const handler = createVaultHandler({
    nodeSecret,
    verifiers: new Map([["google", mockVerifier("google")]]),
  });

  const inboxPrefix = `mutable://data/vault/${vaultSigning.publicKeyHex}/inbox`;
  const processor = respondTo<VaultAuthRequest, VaultAuthResponse>(handler, {
    identity,
    client,
  });
  const connection = connect(client, { prefix: inboxPrefix, processor });

  // Two separate "sessions" for the same Google user
  const secrets: string[] = [];

  for (const sessionId of ["session-1", "session-2"]) {
    const clientEnc = await generateEncryptionKeyPair();
    const inboxUri = `${inboxPrefix}/${sessionId}`;
    const outboxUri =
      `mutable://data/vault/${vaultSigning.publicKeyHex}/outbox/${sessionId}`;

    await writeRequest<VaultAuthRequest>({
      client,
      listenerEncryptionPublicKeyHex: vaultEnc.publicKeyHex,
      inboxUri,
      data: { provider: "google", token: "same-google-sub" },
      clientEncryptionPublicKeyHex: clientEnc.publicKeyHex,
      replyToUri: outboxUri,
    });

    await connection.poll();

    const response = await readResponse<VaultAuthResponse>({
      client,
      responseUri: outboxUri,
      clientEncryptionPrivateKey: clientEnc.privateKey,
    });

    secrets.push(response!.data.secret);
  }

  // Same Google sub → same secret → same identity
  assertEquals(secrets[0], secrets[1]);

  const kp1 = await deriveSigningKeyPairFromSeed(secrets[0]);
  const kp2 = await deriveSigningKeyPairFromSeed(secrets[1]);
  assertEquals(kp1.publicKeyHex, kp2.publicKeyHex);
});

Deno.test("vault: different users get different identities", async () => {
  const nodeSecret = "vault-secret";

  // Directly test the HMAC derivation (no listener needed)
  const secret1 = await hmac(nodeSecret, "google:user-aaa");
  const secret2 = await hmac(nodeSecret, "google:user-bbb");

  assertNotEquals(secret1, secret2);

  const kp1 = await deriveSigningKeyPairFromSeed(secret1);
  const kp2 = await deriveSigningKeyPairFromSeed(secret2);
  assertNotEquals(kp1.publicKeyHex, kp2.publicKeyHex);
});

Deno.test("vault: different vaults produce different identities", async () => {
  const sub = "google:same-user";

  const secret1 = await hmac("vault-A-secret", sub);
  const secret2 = await hmac("vault-B-secret", sub);

  assertNotEquals(secret1, secret2);

  const kp1 = await deriveSigningKeyPairFromSeed(secret1);
  const kp2 = await deriveSigningKeyPairFromSeed(secret2);
  assertNotEquals(kp1.publicKeyHex, kp2.publicKeyHex);
});

Deno.test("vault: unsupported provider throws", async () => {
  const handler = createVaultHandler({
    nodeSecret: "secret",
    verifiers: new Map([["google", mockVerifier("google")]]),
  });

  let error: Error | null = null;
  try {
    await handler({
      uri: "test",
      requestId: "test",
      data: { provider: "github", token: "some-token" },
    });
  } catch (e) {
    error = e as Error;
  }

  assertEquals(error !== null, true);
  assertEquals(error!.message, "Unsupported auth provider: github");
});
