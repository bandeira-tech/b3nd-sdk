import {
  decodeBase64,
  decodeHex,
  encodeBase64,
  encodeHex,
} from "../b3nd-core/encoding.ts";

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

export interface SignedSymmetricMessage {
  auth: Array<{
    pubkey: string;
    signature: string;
  }>;
  payload: EncryptedPayload;
}

export class IdentityKey {
  private constructor(
    private readonly privateKey: CryptoKey,
    readonly publicKeyHex: string,
  ) {}

  static async generate(): Promise<{
    key: IdentityKey;
    privateKeyPem: string;
    publicKeyHex: string;
  }> {
    const pair = await generateSigningKeyPair();
    const privateKeyPem = await exportPrivateKeyPem(
      pair.privateKey,
      "PRIVATE KEY",
    );
    return {
      key: new IdentityKey(pair.privateKey, pair.publicKeyHex),
      privateKeyPem,
      publicKeyHex: pair.publicKeyHex,
    };
  }

  static async fromPem(
    pem: string,
    publicKeyHex: string,
  ): Promise<IdentityKey> {
    const privateKey = await pemToCryptoKey(pem, "Ed25519");
    return new IdentityKey(privateKey, publicKeyHex);
  }

  static async fromHex(
    params: { privateKeyHex: string; publicKeyHex: string },
  ): Promise<IdentityKey> {
    const privateKeyBytes = decodeHex(params.privateKeyHex).buffer;
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      privateKeyBytes,
      { name: "Ed25519", namedCurve: "Ed25519" },
      false,
      ["sign"],
    );
    return new IdentityKey(privateKey, params.publicKeyHex);
  }

  async sign(payload: unknown): Promise<string> {
    return await sign(this.privateKey, payload);
  }
}

export class PublicEncryptionKey {
  constructor(
    readonly publicKeyHex: string,
    readonly publicKey: CryptoKey | null,
  ) {}

  static async fromHex(publicKeyHex: string): Promise<PublicEncryptionKey> {
    const publicKeyBytes = decodeHex(publicKeyHex).buffer;
    const publicKey = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      { name: "X25519", namedCurve: "X25519" },
      false,
      [],
    );
    return new PublicEncryptionKey(publicKeyHex, publicKey);
  }

  static async generatePair(): Promise<{
    publicKey: PublicEncryptionKey;
    privateKeyHex: string;
  }> {
    const pair = await generateEncryptionKeyPair();
    const privateKeyBytes = new Uint8Array(
      await crypto.subtle.exportKey("pkcs8", pair.privateKey),
    );
    return {
      publicKey: new PublicEncryptionKey(pair.publicKeyHex, pair.publicKey),
      privateKeyHex: encodeHex(privateKeyBytes),
    };
  }

  async encrypt(data: unknown): Promise<EncryptedPayload> {
    return await encrypt(data, this.publicKeyHex);
  }

  toHex(): string {
    return this.publicKeyHex;
  }
}

export class SecretEncryptionKey {
  private constructor(readonly keyHex: string) {}

  static async fromSecret(params: {
    secret: string;
    salt: string;
    iterations?: number;
  }): Promise<SecretEncryptionKey> {
    const keyHex = await deriveKeyFromSeed(
      params.secret,
      params.salt,
      params.iterations ?? 100000,
    );
    return new SecretEncryptionKey(keyHex);
  }

  static fromHex(keyHex: string): SecretEncryptionKey {
    return new SecretEncryptionKey(keyHex);
  }

  async encrypt(data: unknown): Promise<EncryptedPayload> {
    return await encryptSymmetric(data, this.keyHex);
  }

  async decrypt(payload: EncryptedPayload): Promise<unknown> {
    return await decryptSymmetric(payload, this.keyHex);
  }
}

export class PrivateEncryptionKey {
  constructor(
    readonly privateKey: CryptoKey,
    readonly privateKeyHex: string,
    readonly publicKeyHex: string,
  ) {}

  static async fromHex(
    params: { privateKeyHex: string; publicKeyHex: string },
  ): Promise<PrivateEncryptionKey> {
    const { privateKeyHex, publicKeyHex } = params;
    const privateKeyBytes = decodeHex(privateKeyHex).buffer;
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      privateKeyBytes,
      { name: "X25519", namedCurve: "X25519" },
      false,
      ["deriveBits"],
    );

    return new PrivateEncryptionKey(privateKey, privateKeyHex, publicKeyHex);
  }

  static async generatePair(): Promise<{
    privateKey: PrivateEncryptionKey;
    publicKey: PublicEncryptionKey;
  }> {
    const pair = await generateEncryptionKeyPair();
    const privateKeyBytes = new Uint8Array(
      await crypto.subtle.exportKey("pkcs8", pair.privateKey),
    );
    const privateKeyHex = encodeHex(privateKeyBytes);
    const publicKey = new PublicEncryptionKey(
      pair.publicKeyHex,
      pair.publicKey,
    );
    return {
      privateKey: new PrivateEncryptionKey(
        pair.privateKey,
        privateKeyHex,
        pair.publicKeyHex,
      ),
      publicKey,
    };
  }

  toPublic(): PublicEncryptionKey {
    return new PublicEncryptionKey(this.publicKeyHex, null);
  }

  async decrypt(payload: EncryptedPayload): Promise<unknown> {
    return await decrypt(payload, this.privateKey);
  }

  toHex(): string {
    return this.privateKeyHex;
  }
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

  const publicKeyBytes = await crypto.subtle.exportKey(
    "raw",
    keyPair.publicKey,
  );
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

  const publicKeyBytes = await crypto.subtle.exportKey(
    "raw",
    keyPair.publicKey,
  );

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

export async function exportPrivateKeyPem(
  privateKey: CryptoKey,
  label: string,
): Promise<string> {
  const der = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", privateKey),
  );
  return toPem(der, label);
}

function toPem(der: Uint8Array, label: string) {
  const base64 = encodeBase64(der);
  const formatted = base64.match(/.{1,64}/g)?.join("\n") ?? base64;
  return `-----BEGIN ${label}-----\n${formatted}\n-----END ${label}-----`;
}

export async function signPayload(
  params: { payload: unknown; identity: IdentityKey },
): Promise<Array<{ pubkey: string; signature: string }>> {
  const { payload, identity } = params;
  const signature = await identity.sign(payload);
  return [{ pubkey: identity.publicKeyHex, signature }];
}

export async function verifyPayload(
  params: {
    payload: unknown;
    auth: Array<{ pubkey: string; signature: string }>;
  },
): Promise<{ verified: boolean; signers: string[] }> {
  const { payload, auth } = params;
  const results = await Promise.all(auth.map(async (entry) => {
    const ok = await verify(entry.pubkey, entry.signature, payload);
    return { pubkey: entry.pubkey, ok };
  }));
  const verified = results.every((r) => r.ok);
  const signers = results.filter((r) => r.ok).map((r) => r.pubkey);
  return { verified, signers };
}

export async function createSignedEncryptedMessage(
  params: {
    data: unknown;
    identity: IdentityKey;
    encryptionKey: SecretEncryptionKey | PublicEncryptionKey;
  },
): Promise<SignedEncryptedMessage>;
export async function createSignedEncryptedMessage(
  data: unknown,
  signers: Array<{ privateKey: CryptoKey; publicKeyHex: string }>,
  recipientPublicKeyHex: string,
): Promise<SignedEncryptedMessage>;
export async function createSignedEncryptedMessage(
  paramsOrData:
    | {
      data: unknown;
      identity: IdentityKey;
      encryptionKey: SecretEncryptionKey | PublicEncryptionKey;
    }
    | unknown,
  signers?: Array<{ privateKey: CryptoKey; publicKeyHex: string }>,
  recipientPublicKeyHex?: string,
): Promise<SignedEncryptedMessage> {
  if (
    typeof paramsOrData === "object" && paramsOrData !== null &&
    "encryptionKey" in paramsOrData
  ) {
    const { data, identity, encryptionKey } = paramsOrData as {
      data: unknown;
      identity: IdentityKey;
      encryptionKey: SecretEncryptionKey | PublicEncryptionKey;
    };
    const payload = await encryptionKey.encrypt(data);
    const auth = await signPayload({ payload, identity });
    return { auth, payload };
  }

  if (!signers || !recipientPublicKeyHex) {
    throw new Error(
      "Invalid arguments for legacy createSignedEncryptedMessage",
    );
  }

  const encrypted = await encrypt(paramsOrData, recipientPublicKeyHex);
  const auth = await Promise.all(
    signers.map(async (signer) => {
      const signature = await sign(signer.privateKey, encrypted);
      return { pubkey: signer.publicKeyHex, signature };
    }),
  );
  return { auth, payload: encrypted };
}

export async function verifyAndDecryptMessage(
  params: {
    message: SignedEncryptedMessage;
    encryptionKey: SecretEncryptionKey | PrivateEncryptionKey;
  },
): Promise<{ data: unknown; verified: boolean; signers: string[] }> {
  const { message, encryptionKey } = params;
  const { verified, signers } = await verifyPayload({
    payload: message.payload,
    auth: message.auth,
  });
  const data = encryptionKey instanceof SecretEncryptionKey
    ? await encryptionKey.decrypt(message.payload)
    : await encryptionKey.decrypt(message.payload);
  return { data, verified, signers };
}

/**
 * Encrypt data using a symmetric key (AES-GCM) provided as hex
 */
export async function encryptSymmetric(
  data: unknown,
  keyHex: string,
): Promise<EncryptedPayload> {
  const keyBytes = decodeHex(keyHex).buffer;
  const aesKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  const nonce = generateNonce();
  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource },
    aesKey,
    encoder.encode(JSON.stringify(data)),
  );

  return {
    data: encodeBase64(new Uint8Array(ciphertext)),
    nonce: encodeBase64(nonce),
  };
}

/**
 * Decrypt data using a symmetric key (AES-GCM) provided as hex
 */
export async function decryptSymmetric(
  payload: EncryptedPayload,
  keyHex: string,
): Promise<unknown> {
  const keyBytes = decodeHex(keyHex).buffer;
  const aesKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const ciphertext = new Uint8Array(decodeBase64(payload.data));
  const nonce = new Uint8Array(decodeBase64(payload.nonce));

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce as BufferSource },
    aesKey,
    ciphertext,
  );

  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(plaintext));
}

/**
 * Create a signed symmetric message (signs encrypted payload)
 */
export async function createSignedSymmetricMessage(
  data: unknown,
  signers: Array<{ privateKey: CryptoKey; publicKeyHex: string }>,
  keyHex: string,
): Promise<SignedSymmetricMessage> {
  const encryptedPayload = await encryptSymmetric(data, keyHex);

  const auth = await Promise.all(
    signers.map(async (signer) => {
      const signature = await sign(signer.privateKey, encryptedPayload);
      return {
        pubkey: signer.publicKeyHex,
        signature,
      };
    }),
  );

  return {
    auth,
    payload: encryptedPayload,
  };
}
