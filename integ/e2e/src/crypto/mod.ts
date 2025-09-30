/**
 * Crypto Module for E2E Testing
 * Provides encryption, decryption, and authentication utilities
 */

import { encodeHex, decodeHex } from "@std/encoding/hex";
import { encodeBase64, decodeBase64 } from "@std/encoding/base64";

// Types
export interface KeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyHex: string;
  privateKeyHex: string;
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
  encrypted: EncryptedPayload;
  auth: Array<{
    pubkey: string;
    signature: string;
  }>;
}

// Key Generation
export class CryptoManager {
  private keyPairs: Map<string, KeyPair> = new Map();

  /**
   * Generate an Ed25519 keypair for signing
   */
  async generateSigningKeyPair(userId: string): Promise<KeyPair> {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "Ed25519",
        namedCurve: "Ed25519",
      },
      true,
      ["sign", "verify"]
    );

    const publicKeyBytes = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    const privateKeyBytes = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

    const result: KeyPair = {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      publicKeyHex: encodeHex(new Uint8Array(publicKeyBytes)),
      privateKeyHex: encodeHex(new Uint8Array(privateKeyBytes)),
    };

    this.keyPairs.set(userId, result);
    return result;
  }

  /**
   * Generate an X25519 keypair for encryption
   */
  async generateEncryptionKeyPair(): Promise<{
    publicKey: CryptoKey;
    privateKey: CryptoKey;
    publicKeyHex: string;
  }> {
    // For encryption, we'll use X25519 for key exchange
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "X25519",
        namedCurve: "X25519",
      },
      true,
      ["deriveBits"]
    );

    const publicKeyBytes = await crypto.subtle.exportKey("raw", keyPair.publicKey);

    return {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      publicKeyHex: encodeHex(new Uint8Array(publicKeyBytes)),
    };
  }

  /**
   * Get stored keypair for a user
   */
  getKeyPair(userId: string): KeyPair | undefined {
    return this.keyPairs.get(userId);
  }

  /**
   * Sign a payload with a user's private key
   */
  async sign<T>(userId: string, payload: T): Promise<string> {
    const keyPair = this.keyPairs.get(userId);
    if (!keyPair) {
      throw new Error(`No keypair found for user: ${userId}`);
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(payload));

    const signature = await crypto.subtle.sign(
      "Ed25519",
      keyPair.privateKey,
      data
    );

    return encodeHex(new Uint8Array(signature));
  }

  /**
   * Verify a signature
   */
  async verify<T>(
    publicKeyHex: string,
    signatureHex: string,
    payload: T
  ): Promise<boolean> {
    try {
      const publicKeyBytes = decodeHex(publicKeyHex);
      const publicKey = await crypto.subtle.importKey(
        "raw",
        publicKeyBytes,
        {
          name: "Ed25519",
          namedCurve: "Ed25519",
        },
        false,
        ["verify"]
      );

      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify(payload));
      const signatureBytes = decodeHex(signatureHex);

      return await crypto.subtle.verify(
        "Ed25519",
        publicKey,
        signatureBytes,
        data
      );
    } catch {
      return false;
    }
  }

  /**
   * Create an authenticated message
   */
  async createAuthenticatedMessage<T>(
    userIds: string[],
    payload: T
  ): Promise<AuthenticatedMessage<T>> {
    const auth = await Promise.all(
      userIds.map(async (userId) => {
        const keyPair = this.keyPairs.get(userId);
        if (!keyPair) {
          throw new Error(`No keypair found for user: ${userId}`);
        }

        const signature = await this.sign(userId, payload);

        return {
          pubkey: keyPair.publicKeyHex,
          signature,
        };
      })
    );

    return {
      auth,
      payload,
    };
  }

  /**
   * Encrypt data using AES-GCM with a derived key
   */
  async encrypt(
    data: unknown,
    recipientPublicKeyHex: string
  ): Promise<EncryptedPayload> {
    // Generate ephemeral keypair for ECDH
    const ephemeralKeyPair = await this.generateEncryptionKeyPair();

    // Import recipient's public key
    const recipientPublicKeyBytes = decodeHex(recipientPublicKeyHex);
    const recipientPublicKey = await crypto.subtle.importKey(
      "raw",
      recipientPublicKeyBytes,
      {
        name: "X25519",
        namedCurve: "X25519",
      },
      false,
      []
    );

    // Derive shared secret
    const sharedSecret = await crypto.subtle.deriveBits(
      {
        name: "X25519",
        public: recipientPublicKey,
      },
      ephemeralKeyPair.privateKey,
      256
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
      ["encrypt"]
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
      plaintext
    );

    return {
      data: encodeBase64(new Uint8Array(ciphertext)),
      nonce: encodeBase64(nonce),
      ephemeralPublicKey: ephemeralKeyPair.publicKeyHex,
    };
  }

  /**
   * Decrypt data using AES-GCM with a derived key
   */
  async decrypt(
    encryptedPayload: EncryptedPayload,
    recipientPrivateKey: CryptoKey
  ): Promise<unknown> {
    if (!encryptedPayload.ephemeralPublicKey) {
      throw new Error("Missing ephemeral public key");
    }

    // Import ephemeral public key
    const ephemeralPublicKeyBytes = decodeHex(encryptedPayload.ephemeralPublicKey);
    const ephemeralPublicKey = await crypto.subtle.importKey(
      "raw",
      ephemeralPublicKeyBytes,
      {
        name: "X25519",
        namedCurve: "X25519",
      },
      false,
      []
    );

    // Derive shared secret
    const sharedSecret = await crypto.subtle.deriveBits(
      {
        name: "X25519",
        public: ephemeralPublicKey,
      },
      recipientPrivateKey,
      256
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
      ["decrypt"]
    );

    // Decrypt data
    const ciphertext = decodeBase64(encryptedPayload.data);
    const nonce = decodeBase64(encryptedPayload.nonce);

    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonce,
      },
      aesKey,
      ciphertext
    );

    const decoder = new TextDecoder();
    const json = decoder.decode(plaintext);
    return JSON.parse(json);
  }

  /**
   * Create a signed and encrypted message
   */
  async createSignedEncryptedMessage(
    data: unknown,
    signerUserIds: string[],
    recipientPublicKeyHex: string
  ): Promise<SignedEncryptedMessage> {
    // First encrypt the data
    const encrypted = await this.encrypt(data, recipientPublicKeyHex);

    // Then sign the encrypted payload
    const auth = await Promise.all(
      signerUserIds.map(async (userId) => {
        const signature = await this.sign(userId, encrypted);
        const keyPair = this.keyPairs.get(userId);
        if (!keyPair) {
          throw new Error(`No keypair found for user: ${userId}`);
        }

        return {
          pubkey: keyPair.publicKeyHex,
          signature,
        };
      })
    );

    return {
      encrypted,
      auth,
    };
  }

  /**
   * Verify and decrypt a signed encrypted message
   */
  async verifyAndDecrypt(
    message: SignedEncryptedMessage,
    recipientPrivateKey: CryptoKey
  ): Promise<{
    data: unknown;
    verified: boolean;
    signers: string[];
  }> {
    // Verify all signatures
    const verificationResults = await Promise.all(
      message.auth.map(async (authEntry) => {
        const verified = await this.verify(
          authEntry.pubkey,
          authEntry.signature,
          message.encrypted
        );
        return { pubkey: authEntry.pubkey, verified };
      })
    );

    const verified = verificationResults.every(r => r.verified);
    const signers = verificationResults
      .filter(r => r.verified)
      .map(r => r.pubkey);

    // Decrypt the data
    const data = await this.decrypt(message.encrypted, recipientPrivateKey);

    return {
      data,
      verified,
      signers,
    };
  }
}

// Helper functions for simulating multiple users
export class UserSimulator {
  private cryptoManager: CryptoManager;
  private users: Map<string, {
    signingKeys: KeyPair;
    encryptionKeys?: {
      publicKey: CryptoKey;
      privateKey: CryptoKey;
      publicKeyHex: string;
    };
  }> = new Map();

  constructor() {
    this.cryptoManager = new CryptoManager();
  }

  async createUser(userId: string, withEncryption = false): Promise<void> {
    const signingKeys = await this.cryptoManager.generateSigningKeyPair(userId);

    const user: any = { signingKeys };

    if (withEncryption) {
      user.encryptionKeys = await this.cryptoManager.generateEncryptionKeyPair();
    }

    this.users.set(userId, user);
  }

  getUser(userId: string) {
    return this.users.get(userId);
  }

  getCryptoManager(): CryptoManager {
    return this.cryptoManager;
  }

  async createTestPayload<T>(
    data: T,
    options: {
      encrypt?: boolean;
      sign?: boolean;
      signerIds?: string[];
      recipientId?: string;
    } = {}
  ): Promise<unknown> {
    if (options.encrypt && options.sign) {
      if (!options.recipientId || !options.signerIds) {
        throw new Error("Encryption and signing require recipient and signers");
      }

      const recipient = this.users.get(options.recipientId);
      if (!recipient?.encryptionKeys) {
        throw new Error(`Recipient ${options.recipientId} not found or lacks encryption keys`);
      }

      return await this.cryptoManager.createSignedEncryptedMessage(
        data,
        options.signerIds,
        recipient.encryptionKeys.publicKeyHex
      );
    } else if (options.sign) {
      if (!options.signerIds) {
        throw new Error("Signing requires signer IDs");
      }

      return await this.cryptoManager.createAuthenticatedMessage(
        options.signerIds,
        data
      );
    } else if (options.encrypt) {
      if (!options.recipientId) {
        throw new Error("Encryption requires recipient ID");
      }

      const recipient = this.users.get(options.recipientId);
      if (!recipient?.encryptionKeys) {
        throw new Error(`Recipient ${options.recipientId} not found or lacks encryption keys`);
      }

      return await this.cryptoManager.encrypt(
        data,
        recipient.encryptionKeys.publicKeyHex
      );
    }

    return data;
  }
}

// Export utility functions
export function generateNonce(length = 12): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function generateRandomData(size: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(size));
}
