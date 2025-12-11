import {
  decodeBase64,
  decodeHex,
  encodeBase64,
  encodeHex,
} from "../shared/encoding.ts";

// Types
export interface KeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyHex: string;
  privateKeyHex: string;
}

export interface EncryptionKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyHex: string;
}

export interface EncryptedPayload {
  data: string; // Base64 encoded encrypted data
  nonce: string; // Base64 encoded nonce
  ephemeralPublicKey?: string; // Hex encoded ephemeral public key for ECDH
}

export interface AuthenticatedMessage<T = unknown> {
  auth: Array<{
    pubkey: string; // Hex encoded public key
    signature: string; // Hex encoded signature
  }>;
  payload: T;
}

export interface SignedEncryptedMessage {
  auth: Array<{
    pubkey: string;
    signature: string;
  }>;
  payload: EncryptedPayload;
}

/**
 * Convert a PEM-encoded private key to a CryptoKey
 */
export async function pemToCryptoKey(
  pem: string,
  algorithm: "Ed25519" | "X25519",
): Promise<CryptoKey> {
  const lines = pem
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("---"));

  if (lines.length === 0) {
    throw new Error("Invalid PEM: no key data");
  }

  const base64 = lines.join("");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );

  if (algorithm === "Ed25519") {
    return await crypto.subtle.importKey(
      "pkcs8",
      buffer,
      { name: "Ed25519", namedCurve: "Ed25519" },
      false,
      ["sign"],
    );
  }

  return await crypto.subtle.importKey(
    "pkcs8",
    buffer,
    { name: "X25519", namedCurve: "X25519" },
    false,
    ["deriveBits"],
  );
}

/**
 * Generate an Ed25519 keypair for signing
 */
export async function generateSigningKeyPair(): Promise<KeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "Ed25519",
      namedCurve: "Ed25519",
    },
    true,
    ["sign", "verify"],
  );

  const publicKeyBytes = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const privateKeyBytes = await crypto.subtle.exportKey(
    "pkcs8",
    keyPair.privateKey,
  );

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyHex: encodeHex(new Uint8Array(publicKeyBytes)),
    privateKeyHex: encodeHex(new Uint8Array(privateKeyBytes)),
  };
}

/**
 * Generate an X25519 keypair for encryption (ECDH)
 */
export async function generateEncryptionKeyPair(): Promise<EncryptionKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "X25519",
      namedCurve: "X25519",
    },
    true,
    ["deriveBits"],
  );

  const publicKeyBytes = await crypto.subtle.exportKey("raw", keyPair.publicKey);

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyHex: encodeHex(new Uint8Array(publicKeyBytes)),
  };
}

/**
 * Sign a payload with an Ed25519 private key
 */
export async function sign<T>(
  privateKey: CryptoKey,
  payload: T,
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(payload));

  const signature = await crypto.subtle.sign("Ed25519", privateKey, data);

  return encodeHex(new Uint8Array(signature));
}

/**
 * Sign a payload with an Ed25519 private key from hex
 */
export async function signWithHex<T>(
  privateKeyHex: string,
  payload: T,
): Promise<string> {
  const privateKeyBytes = decodeHex(privateKeyHex).buffer;

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes,
    {
      name: "Ed25519",
      namedCurve: "Ed25519",
    },
    false,
    ["sign"],
  );

  return await sign(privateKey, payload);
}

/**
 * Verify a signature using Ed25519 public key
 */
export async function verify<T>(
  publicKeyHex: string,
  signatureHex: string,
  payload: T,
): Promise<boolean> {
  try {
    const publicKeyBytes = decodeHex(publicKeyHex).buffer;
    const publicKey = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      {
        name: "Ed25519",
        namedCurve: "Ed25519",
      },
      false,
      ["verify"],
    );

    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(payload));
    const signatureBytes = decodeHex(signatureHex).buffer;

    return await crypto.subtle.verify(
      "Ed25519",
      publicKey,
      signatureBytes,
      data,
    );
  } catch (error) {
    console.error("Verification error:", error);
    return false;
  }
}

/**
 * Encrypt data using X25519 ECDH + AES-GCM
 * Uses ephemeral keypair for forward secrecy
 */
export async function encrypt(
  data: unknown,
  recipientPublicKeyHex: string,
): Promise<EncryptedPayload> {
  // Generate ephemeral keypair for ECDH
  const ephemeralKeyPair = await generateEncryptionKeyPair();

  // Import recipient's public key
  const recipientPublicKeyBytes = decodeHex(recipientPublicKeyHex).buffer;
  const recipientPublicKey = await crypto.subtle.importKey(
    "raw",
    recipientPublicKeyBytes,
    {
      name: "X25519",
      namedCurve: "X25519",
    },
    false,
    [],
  );

  // Derive shared secret using ECDH
  const sharedSecret = await crypto.subtle.deriveBits(
    {
      name: "X25519",
      public: recipientPublicKey,
    },
    ephemeralKeyPair.privateKey,
    256,
  );

  // Import shared secret as AES-GCM key
  const aesKey = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt"],
  );

  // Generate nonce
  const nonce = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt data
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(data));

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
    },
    aesKey,
    plaintext,
  );

  return {
    data: encodeBase64(new Uint8Array(ciphertext)),
    nonce: encodeBase64(nonce),
    ephemeralPublicKey: ephemeralKeyPair.publicKeyHex,
  };
}

/**
 * Decrypt data using X25519 ECDH + AES-GCM
 */
export async function decrypt(
  encryptedPayload: EncryptedPayload,
  recipientPrivateKey: CryptoKey,
): Promise<unknown> {
  if (!encryptedPayload.ephemeralPublicKey) {
    throw new Error("Missing ephemeral public key");
  }

  // Import ephemeral public key
  const ephemeralPublicKeyBytes = decodeHex(
    encryptedPayload.ephemeralPublicKey,
  ).buffer;
  const ephemeralPublicKey = await crypto.subtle.importKey(
    "raw",
    ephemeralPublicKeyBytes,
    {
      name: "X25519",
      namedCurve: "X25519",
    },
    false,
    [],
  );

  // Derive shared secret using ECDH
  const sharedSecret = await crypto.subtle.deriveBits(
    {
      name: "X25519",
      public: ephemeralPublicKey,
    },
    recipientPrivateKey,
    256,
  );

  // Import shared secret as AES-GCM key
  const aesKey = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["decrypt"],
  );

  // Decrypt data
  const ciphertext = new Uint8Array(decodeBase64(encryptedPayload.data));
  const nonce = new Uint8Array(decodeBase64(encryptedPayload.nonce));

  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: nonce,
    },
    aesKey,
    ciphertext,
  );

  const decoder = new TextDecoder();
  const json = decoder.decode(plaintext);
  return JSON.parse(json);
}

/**
 * Decrypt data using private key from hex
 */
export async function decryptWithHex(
  encryptedPayload: EncryptedPayload,
  recipientPrivateKeyHex: string,
): Promise<unknown> {
  const privateKeyBytes = decodeHex(recipientPrivateKeyHex).buffer;
  const privateKey = await crypto.subtle.importKey(
    "raw",
    privateKeyBytes,
    {
      name: "X25519",
      namedCurve: "X25519",
    },
    false,
    ["deriveBits"],
  );

  return await decrypt(encryptedPayload, privateKey);
}

/**
 * Create an authenticated message (signed but not encrypted)
 */
export async function createAuthenticatedMessage<T>(
  payload: T,
  signers: Array<{ privateKey: CryptoKey; publicKeyHex: string }>,
): Promise<AuthenticatedMessage<T>> {
  const auth = await Promise.all(
    signers.map(async (signer) => {
      const signature = await sign(signer.privateKey, payload);
      return {
        pubkey: signer.publicKeyHex,
        signature,
      };
    }),
  );

  return {
    auth,
    payload,
  };
}

/**
 * Create a signed and encrypted message
 */
export async function createSignedEncryptedMessage(
  data: unknown,
  signers: Array<{ privateKey: CryptoKey; publicKeyHex: string }>,
  recipientPublicKeyHex: string,
): Promise<SignedEncryptedMessage> {
  // First encrypt the data
  const encrypted = await encrypt(data, recipientPublicKeyHex);

  // Then sign the encrypted payload
  const auth = await Promise.all(
    signers.map(async (signer) => {
      const signature = await sign(signer.privateKey, encrypted);
      return {
        pubkey: signer.publicKeyHex,
        signature,
      };
    }),
  );

  return {
    auth,
    payload: encrypted,
  };
}

/**
 * Verify and decrypt a signed encrypted message
 */
export async function verifyAndDecrypt(
  message: SignedEncryptedMessage,
  recipientPrivateKey: CryptoKey,
): Promise<{
  data: unknown;
  verified: boolean;
  signers: string[];
}> {
  // Verify all signatures
  const verificationResults = await Promise.all(
    message.auth.map(async (authEntry) => {
      const verified = await verify(
        authEntry.pubkey,
        authEntry.signature,
        message.payload,
      );
      return { pubkey: authEntry.pubkey, verified };
    }),
  );

  const verified = verificationResults.every((r) => r.verified);
  const signers = verificationResults
    .filter((r) => r.verified)
    .map((r) => r.pubkey);

  // Decrypt the data
  const data = await decrypt(message.payload, recipientPrivateKey);

  return {
    data,
    verified,
    signers,
  };
}

/**
 * Create an authenticated message with hex-encoded keys (convenience wrapper)
 */
export async function createAuthenticatedMessageWithHex<T>(
  payload: T,
  pubkeyHex: string,
  privateKeyHex: string,
): Promise<AuthenticatedMessage<T>> {
  const signature = await signWithHex(privateKeyHex, payload);
  return {
    auth: [{ pubkey: pubkeyHex, signature }],
    payload,
  };
}

/**
 * Derive an encryption key from seed and salt using PBKDF2
 * Returns hex-encoded key suitable for encrypt/decrypt functions
 */
export async function deriveKeyFromSeed(
  seed: string,
  salt: string,
  iterations: number = 100000,
): Promise<string> {
  const encoder = new TextEncoder();

  // Import seed as key material
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(seed),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  // Derive 256-bit key
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );

  return encodeHex(new Uint8Array(derivedBits));
}

// Utility functions
export function generateNonce(length = 12): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function generateRandomData(size: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(size));
}
