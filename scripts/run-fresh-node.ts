#!/usr/bin/env -S deno run -A
/**
 * Run a B3nd node Docker image with freshly generated keys.
 *
 * Usage:
 *   deno run -A scripts/run-fresh-node.ts <image>
 *   make run-node image=ghcr.io/bandeira-tech/b3nd/b3nd-node:latest
 */

import {
  exportPrivateKeyPem,
  generateEncryptionKeyPair,
  generateSigningKeyPair,
} from "@bandeira-tech/b3nd-sdk/encrypt";
import { encodeHex } from "@std/encoding/hex";

const image = Deno.args[0];
if (!image) {
  console.error("Usage: run-fresh-node.ts <image>");
  Deno.exit(1);
}

// Generate operator and node signing keys
const operator = await generateSigningKeyPair();
const node = await generateSigningKeyPair();
const nodePem = await exportPrivateKeyPem(node.privateKey, "PRIVATE KEY");

// Generate encryption keys
const nodeEnc = await generateEncryptionKeyPair();
const opEnc = await generateEncryptionKeyPair();
const nodeEncRaw = await crypto.subtle.exportKey("pkcs8", nodeEnc.privateKey);
const nodeEncHex = encodeHex(new Uint8Array(nodeEncRaw));

console.log("--- Generated keys ---");
console.log(`Operator pubkey: ${operator.publicKeyHex}`);
console.log(`Node pubkey:     ${node.publicKeyHex}`);
console.log("----------------------\n");

const cmd = new Deno.Command("docker", {
  args: [
    "run", "--rm", "-p", "9942:9942",
    "-e", "PORT=9942",
    "-e", "CORS_ORIGIN=*",
    "-e", "BACKEND_URL=memory://",
    "-e", `OPERATOR_KEY=${operator.publicKeyHex}`,
    "-e", `NODE_PRIVATE_KEY_PEM=${nodePem}`,
    "-e", `NODE_ENCRYPTION_PRIVATE_KEY_HEX=${nodeEncHex}`,
    "-e", `OPERATOR_ENCRYPTION_PUBLIC_KEY_HEX=${opEnc.publicKeyHex}`,
    image,
  ],
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

const status = await cmd.spawn().status;
Deno.exit(status.code);
