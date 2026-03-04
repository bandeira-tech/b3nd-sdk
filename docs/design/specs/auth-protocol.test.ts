/**
 * Auth Protocol — Failing Spec
 *
 * Tests the proposed auth flows: PKCE utilities, password-based identity
 * derivation, OAuth mock via listener, and HMAC-based secret derivation.
 *
 * Run: deno test docs/design/specs/auth-protocol.test.ts
 * Expected: All tests fail (functions not implemented)
 */

import { assertEquals, assertNotEquals, assertMatch } from "@std/assert";

// Proposed API — these don't exist yet
import {
  deriveSigningKeyPairFromSeed,
  deriveEncryptionKeyPairFromSeed,
  hmac,
  generateCodeVerifier,
  generateCodeChallenge,
} from "../../../libs/b3nd-encrypt/mod.ts";

// Existing API
import {
  deriveKeyFromSeed,
  sign,
  verify,
  encrypt,
  decrypt,
  generateEncryptionKeyPair,
  createAuthenticatedMessageWithHex,
} from "../../../libs/b3nd-encrypt/mod.ts";

import {
  MemoryClient,
  createTestSchema,
} from "../../../libs/b3nd-client-memory/mod.ts";

// --- PKCE ---

Deno.test("pkce: generateCodeVerifier returns 43-char base64url string", () => {
  const verifier = generateCodeVerifier();

  assertEquals(typeof verifier, "string");
  assertEquals(verifier.length, 43);
  // RFC 7636: unreserved characters only (A-Z, a-z, 0-9, -, ., _, ~)
  assertMatch(verifier, /^[A-Za-z0-9\-._~]+$/);
});

Deno.test("pkce: generateCodeVerifier produces unique values", () => {
  const v1 = generateCodeVerifier();
  const v2 = generateCodeVerifier();
  const v3 = generateCodeVerifier();

  assertNotEquals(v1, v2);
  assertNotEquals(v2, v3);
  assertNotEquals(v1, v3);
});

Deno.test("pkce: generateCodeChallenge is deterministic", async () => {
  const verifier = generateCodeVerifier();

  const challenge1 = await generateCodeChallenge(verifier);
  const challenge2 = await generateCodeChallenge(verifier);

  assertEquals(challenge1, challenge2);
});

Deno.test("pkce: generateCodeChallenge returns base64url string", async () => {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);

  assertEquals(typeof challenge, "string");
  // SHA-256 = 32 bytes = 43 base64url chars (no padding)
  assertEquals(challenge.length, 43);
  // base64url: A-Z, a-z, 0-9, -, _ (no + / =)
  assertMatch(challenge, /^[A-Za-z0-9\-_]+$/);
});

Deno.test("pkce: different verifiers produce different challenges", async () => {
  const v1 = generateCodeVerifier();
  const v2 = generateCodeVerifier();

  const c1 = await generateCodeChallenge(v1);
  const c2 = await generateCodeChallenge(v2);

  assertNotEquals(c1, c2);
});

Deno.test("pkce: challenge is SHA-256 of verifier in base64url", async () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

  const challenge = await generateCodeChallenge(verifier);

  // Verify against known SHA-256 hash by computing it independently
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hash);

  // base64url encode (no padding)
  const base64 = btoa(String.fromCharCode(...hashArray));
  const expected = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  assertEquals(challenge, expected);
});

// --- PKCE + OAuth full flow ---

Deno.test("pkce + oauth: SPA flow with custom node — end to end", async () => {
  const client = new MemoryClient({ schema: createTestSchema() });

  // Node setup
  const nodeSecret = "node-hmac-secret-for-oauth";
  const nodeEncKP = await generateEncryptionKeyPair();

  // SPA setup
  const clientEncKP = await generateEncryptionKeyPair();

  // Step 1: SPA generates PKCE params (would use in redirect)
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  assertEquals(typeof challenge, "string");
  // The SPA would redirect to:
  // provider.com/authorize?code_challenge={challenge}&code_challenge_method=S256&...
  // After user auth, provider redirects back with ?code=xxx
  // SPA exchanges code + verifier at provider's /token endpoint
  // SPA receives { id_token: "..." }

  // Step 2: Simulate — SPA has obtained id_token via PKCE
  // (We mock the token verification; in reality the node checks JWKS)
  const mockSub = "google-114523789012345678901";

  // Step 3: SPA sends token to node
  const authUri = `mutable://data/auth/pkce-request-001`;
  const authPayload = {
    type: "pkce-oauth-auth",
    provider: "google",
    sub: mockSub, // In reality, node extracts this after verifying id_token
    clientPublicKeyHex: clientEncKP.publicKeyHex,
  };

  const encryptedAuth = await encrypt(
    new TextEncoder().encode(JSON.stringify(authPayload)),
    nodeEncKP.publicKeyHex,
  );
  await client.receive([authUri, encryptedAuth]);

  // Step 4: Node processes (simulate)
  const reqRead = await client.read(authUri);
  assertEquals(reqRead.success, true);

  const decryptedAuth = JSON.parse(
    new TextDecoder().decode(
      await decrypt(reqRead.record!.data as any, nodeEncKP.privateKey),
    ),
  ) as typeof authPayload;

  const derivedSecret = await hmac(nodeSecret, decryptedAuth.sub);
  const encryptedResponse = await encrypt(
    new TextEncoder().encode(JSON.stringify({ secret: derivedSecret })),
    decryptedAuth.clientPublicKeyHex,
  );

  const responseUri = `mutable://data/auth/pkce-response-001`;
  await client.receive([responseUri, encryptedResponse]);

  // Step 5: SPA reads response and derives identity
  const respRead = await client.read(responseUri);
  assertEquals(respRead.success, true);

  const decryptedResp = JSON.parse(
    new TextDecoder().decode(
      await decrypt(respRead.record!.data as any, clientEncKP.privateKey),
    ),
  ) as { secret: string };

  const signingKP = await deriveSigningKeyPairFromSeed(decryptedResp.secret);
  const encryptionKP = await deriveEncryptionKeyPairFromSeed(decryptedResp.secret);

  assertEquals(signingKP.publicKeyHex.length, 64);
  assertEquals(encryptionKP.publicKeyHex.length, 64);

  // Step 6: Same provider account → same identity (deterministic)
  const secret2 = await hmac(nodeSecret, mockSub);
  const signingKP2 = await deriveSigningKeyPairFromSeed(secret2);
  assertEquals(signingKP.publicKeyHex, signingKP2.publicKeyHex);
});

// --- Password Auth ---

Deno.test("password auth: derive keypair, write signed message, re-derive, read", async () => {
  const username = "alice";
  const password = "my-secure-password";
  const appSalt = "test-app-abc123";

  // Derive identity
  const salt = `${appSalt}-${username}`;
  const seed = await deriveKeyFromSeed(password, salt);
  const signingKeypair = await deriveSigningKeyPairFromSeed(seed);

  // Write signed message to a node
  const client = new MemoryClient({ schema: createTestSchema() });
  const payload = { name: "Alice", bio: "Loves cooking" };
  const authedMessage = await createAuthenticatedMessageWithHex(
    payload,
    signingKeypair.publicKeyHex,
    signingKeypair.privateKeyHex,
  );

  const uri = `mutable://accounts/${signingKeypair.publicKeyHex}/profile`;
  const result = await client.receive([uri, authedMessage]);
  assertEquals(result.accepted, true);

  // Re-derive on "new device"
  const seed2 = await deriveKeyFromSeed(password, salt);
  const signingKeypair2 = await deriveSigningKeyPairFromSeed(seed2);

  // Same identity
  assertEquals(signingKeypair.publicKeyHex, signingKeypair2.publicKeyHex);

  // Read back the data
  const readResult = await client.read(uri);
  assertEquals(readResult.success, true);
  if (readResult.success) {
    const stored = readResult.record!.data as typeof authedMessage;
    // Verify signature with re-derived key
    const valid = await verify(
      signingKeypair2.publicKeyHex,
      stored.auth[0].signature,
      stored.payload,
    );
    assertEquals(valid, true);
  }
});

Deno.test("password auth: different passwords produce different identities", async () => {
  const salt = "app-salt-fixed";

  const seed1 = await deriveKeyFromSeed("password-one", salt);
  const seed2 = await deriveKeyFromSeed("password-two", salt);

  const keypair1 = await deriveSigningKeyPairFromSeed(seed1);
  const keypair2 = await deriveSigningKeyPairFromSeed(seed2);

  assertNotEquals(keypair1.publicKeyHex, keypair2.publicKeyHex);
});

Deno.test("password auth: different apps produce different identities", async () => {
  const password = "same-password";
  const username = "alice";

  const seed1 = await deriveKeyFromSeed(password, `app-one-${username}`);
  const seed2 = await deriveKeyFromSeed(password, `app-two-${username}`);

  const keypair1 = await deriveSigningKeyPairFromSeed(seed1);
  const keypair2 = await deriveSigningKeyPairFromSeed(seed2);

  assertNotEquals(keypair1.publicKeyHex, keypair2.publicKeyHex);
});

// --- OAuth Auth (Mocked) ---

Deno.test("oauth: HMAC-based secret derivation is stable", async () => {
  const nodeSecret = "node-secret-key-do-not-share";
  const googleSub = "google-user-12345";

  // Same inputs → same secret
  const secret1 = await hmac(nodeSecret, googleSub);
  const secret2 = await hmac(nodeSecret, googleSub);
  assertEquals(secret1, secret2);

  // Derive identity from HMAC secret
  const keypair1 = await deriveSigningKeyPairFromSeed(secret1);
  const keypair2 = await deriveSigningKeyPairFromSeed(secret2);
  assertEquals(keypair1.publicKeyHex, keypair2.publicKeyHex);
});

Deno.test("oauth: different Google accounts produce different identities", async () => {
  const nodeSecret = "node-secret-key";

  const secret1 = await hmac(nodeSecret, "google-user-111");
  const secret2 = await hmac(nodeSecret, "google-user-222");

  const keypair1 = await deriveSigningKeyPairFromSeed(secret1);
  const keypair2 = await deriveSigningKeyPairFromSeed(secret2);

  assertNotEquals(keypair1.publicKeyHex, keypair2.publicKeyHex);
});

Deno.test("oauth: different nodes produce different identities for same user", async () => {
  const googleSub = "google-user-12345";

  const secret1 = await hmac("node-secret-A", googleSub);
  const secret2 = await hmac("node-secret-B", googleSub);

  const keypair1 = await deriveSigningKeyPairFromSeed(secret1);
  const keypair2 = await deriveSigningKeyPairFromSeed(secret2);

  assertNotEquals(keypair1.publicKeyHex, keypair2.publicKeyHex);
});

Deno.test("oauth: simulated listener flow — encrypted secret exchange", async () => {
  // Setup: Listener has a keypair and a node secret
  const listenerEncKeypair = await generateEncryptionKeyPair();
  const nodeSecret = "listener-hmac-secret";

  // Setup: Client has a keypair for receiving the encrypted secret
  const clientEncKeypair = await generateEncryptionKeyPair();

  // Step 1: Client sends encrypted auth request to listener
  // (In real flow, this would include the Google ID token)
  const mockGoogleSub = "google-sub-abc123";
  const authRequest = {
    type: "oauth-auth-request",
    provider: "google",
    sub: mockGoogleSub, // In reality, listener extracts this after token verification
    clientPublicKeyHex: clientEncKeypair.publicKeyHex,
  };

  // Step 2: Listener processes the request
  // (In reality, listener would verify the Google ID token first)
  const derivedSecret = await hmac(nodeSecret, mockGoogleSub);

  // Step 3: Listener encrypts the secret to the client's public key
  const encryptedSecret = await encrypt(
    new TextEncoder().encode(JSON.stringify({ secret: derivedSecret })),
    clientEncKeypair.publicKeyHex,
  );

  // Step 4: Client decrypts the secret
  const decryptedResponse = JSON.parse(
    new TextDecoder().decode(
      await decrypt(encryptedSecret, clientEncKeypair.privateKey),
    ),
  ) as { secret: string };

  assertEquals(decryptedResponse.secret, derivedSecret);

  // Step 5: Client derives identity from the secret
  const keypair = await deriveSigningKeyPairFromSeed(decryptedResponse.secret);
  assertEquals(typeof keypair.publicKeyHex, "string");
  assertEquals(keypair.publicKeyHex.length, 64);

  // Step 6: Same flow again produces same identity
  const derivedSecret2 = await hmac(nodeSecret, mockGoogleSub);
  const keypair2 = await deriveSigningKeyPairFromSeed(derivedSecret2);
  assertEquals(keypair.publicKeyHex, keypair2.publicKeyHex);
});

// --- Combined: password + oauth produce independent identities ---

Deno.test("password and oauth produce independent identities by design", async () => {
  const username = "alice";
  const password = "alice-password";
  const appSalt = "my-app";

  // Password identity
  const passwordSeed = await deriveKeyFromSeed(password, `${appSalt}-${username}`);
  const passwordKeypair = await deriveSigningKeyPairFromSeed(passwordSeed);

  // OAuth identity (same user, same app, but via Google)
  const nodeSecret = "my-app-oauth-secret";
  const googleSub = "google-alice-sub-123";
  const oauthSecret = await hmac(nodeSecret, googleSub);
  const oauthKeypair = await deriveSigningKeyPairFromSeed(oauthSecret);

  // Different identities — this is by design, not a bug
  assertNotEquals(passwordKeypair.publicKeyHex, oauthKeypair.publicKeyHex);
});
