/**
 * Vault Listener — Non-custodial OAuth identity service.
 *
 * Run:
 *   VAULT_SECRET=your-hmac-secret GOOGLE_CLIENT_ID=... deno run -A mod.ts
 *
 * Or with .env:
 *   deno task dev
 *
 * The vault:
 * 1. Connects to a node and watches its inbox for encrypted auth requests
 * 2. respondTo() decrypts each request and calls the vault handler
 * 3. The handler verifies OAuth tokens and returns HMAC(nodeSecret, provider:sub)
 * 4. respondTo() encrypts the response and writes it to the client's outbox
 * 5. The client derives their own keypair from the secret
 *
 * No database. No sessions. No key storage. One HMAC secret.
 */

import { connect, respondTo } from "@b3nd/listener";
import {
  deriveEncryptionKeyPairFromSeed,
  deriveSigningKeyPairFromSeed,
  generateEncryptionKeyPair,
  generateSigningKeyPair,
} from "@b3nd/encrypt";
import { verifyGoogleIdToken } from "@b3nd/google-oauth";
import {
  connection as rigConnection,
  createClientFromUrl,
  Rig,
} from "@b3nd/rig";
import { createVaultHandler, type TokenVerifier } from "./vault.ts";

// --- Configuration ---

const VAULT_SECRET = Deno.env.get("VAULT_SECRET");
if (!VAULT_SECRET) {
  console.error("VAULT_SECRET environment variable is required");
  Deno.exit(1);
}

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
const BACKEND_URL = Deno.env.get("BACKEND_URL") || "http://localhost:8080";
const VAULT_SEED = Deno.env.get("VAULT_SEED");
const POLL_INTERVAL_MS = parseInt(Deno.env.get("POLL_INTERVAL_MS") || "2000");

// --- Identity ---
// If VAULT_SEED is set, derive deterministic identity (stable across restarts).
// Otherwise, generate random keys (identity changes each run).

let signingKeyPair;
let encryptionKeyPair;

if (VAULT_SEED) {
  console.log("Deriving vault identity from VAULT_SEED...");
  signingKeyPair = await deriveSigningKeyPairFromSeed(VAULT_SEED);
  encryptionKeyPair = await deriveEncryptionKeyPairFromSeed(VAULT_SEED);
} else {
  console.log(
    "Generating random vault identity (set VAULT_SEED for stable identity)...",
  );
  signingKeyPair = await generateSigningKeyPair();
  encryptionKeyPair = await generateEncryptionKeyPair();
}

console.log(`Vault signing pubkey:    ${signingKeyPair.publicKeyHex}`);
console.log(`Vault encryption pubkey: ${encryptionKeyPair.publicKeyHex}`);

// --- Token Verifiers ---

const verifiers = new Map<string, TokenVerifier>();

if (GOOGLE_CLIENT_ID) {
  verifiers.set("google", {
    async verify(token: string) {
      const payload = await verifyGoogleIdToken(token, GOOGLE_CLIENT_ID!);
      return { sub: payload.sub, provider: "google", email: payload.email };
    },
  });
  console.log("Google OAuth enabled");
} else {
  console.log("Google OAuth disabled (set GOOGLE_CLIENT_ID to enable)");
}

if (verifiers.size === 0) {
  console.error("No OAuth providers configured. Set GOOGLE_CLIENT_ID.");
  Deno.exit(1);
}

// --- Client ---

const backendClient = await createClientFromUrl(BACKEND_URL);
const backend = rigConnection(backendClient, ["*"]);
const rig = new Rig({
  routes: {
    receive: [backend],
    read: [backend],
    observe: [backend],
  },
});
rig.on("receive:error", (e) => {
  console.error(`[rig] receive failed: ${e.uri ?? "unknown"} — ${e.error}`);
});
rig.on("read:error", (e) => {
  console.error(`[rig] read failed: ${e.uri ?? "unknown"} — ${e.error}`);
});
const health = await rig.status();
console.log(`Backend node: ${BACKEND_URL} (${health.status})`);

// --- Compose: handler + respondTo + connect ---
// Pass the rig directly — it satisfies ProtocolInterfaceNode and
// ensures hooks/events/observe fire for all operations.

const identity = { signingKeyPair, encryptionKeyPair };
const inboxPrefix = `mutable://data/vault/${signingKeyPair.publicKeyHex}/inbox`;

const handler = createVaultHandler({
  nodeSecret: VAULT_SECRET,
  verifiers,
});

const processor = respondTo(handler, { identity, client: rig });

const connection = connect(rig, {
  prefix: inboxPrefix,
  processor,
  pollIntervalMs: POLL_INTERVAL_MS,
  onError: (err, uri) => {
    console.error(`Error processing ${uri}:`, err.message);
  },
});

console.log(`\nVault listening at: ${inboxPrefix}/`);
console.log(`Poll interval: ${POLL_INTERVAL_MS}ms`);
console.log("---");

// Start polling
const stop = connection.start();

// Graceful shutdown
Deno.addSignalListener("SIGINT", () => {
  console.log("\nShutting down...");
  stop();
  Deno.exit(0);
});
