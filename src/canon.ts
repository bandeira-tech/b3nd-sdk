/**
 * @module
 * B3nd Canon — protocol-building toolkit.
 *
 * Everything you need to build well and responsibly for a b3nd
 * network: message layer, content addressing, authentication,
 * encryption, and wallet.
 */

// ── Message layer (b3nd-msg) ──

export {
  isMessageData,
  message,
  messageDataHandler,
  messageDataProgram,
} from "../libs/b3nd-msg/data/mod.ts";
export type {
  MessageData,
  StateMessage,
} from "../libs/b3nd-msg/data/mod.ts";

// ── Content addressing (b3nd-hash) ──

export {
  computeSha256,
  generateHashUri,
  generateLinkUri,
  hashValidator,
  isValidSha256Hash,
  parseHashUri,
  validateLinkValue,
  verifyHashContent,
} from "../libs/b3nd-hash/mod.ts";

// ── Auth (access control & signature validation) ──

export {
  authValidation,
  createCombinedAccess,
  createPubkeyBasedAccess,
  createRelativePathAccess,
} from "../libs/b3nd-auth/mod.ts";

// ── Encryption ──

export {
  createAuthenticatedMessage,
  createAuthenticatedMessageWithHex,
  createSignedEncryptedMessage,
  decrypt,
  decryptSymmetric,
  deriveEncryptionKeyPairFromSeed,
  deriveSigningKeyPairFromSeed,
  encrypt,
  encryptSymmetric,
  generateEncryptionKeyPair,
  generateSigningKeyPair,
  IdentityKey,
  pemToCryptoKey,
  PublicEncryptionKey,
  SecretEncryptionKey,
  sign,
  signPayload,
  verify,
  verifyAndDecryptMessage,
  verifyPayload,
} from "../libs/b3nd-encrypt/mod.ts";
export type {
  AuthenticatedMessage,
  EncryptedPayload,
  SignedEncryptedMessage,
} from "../libs/b3nd-encrypt/mod.ts";
export { deriveObfuscatedPath } from "../libs/b3nd-encrypt/utils.ts";

// ── Wallet ──

export { generateSessionKeypair, WalletClient } from "../libs/b3nd-wallet/mod.ts";
export type {
  ApiResponse,
  AuthSession,
  ChangePasswordResponse,
  GoogleLoginResponse,
  GoogleSignupResponse,
  HealthResponse,
  LoginResponse,
  PasswordResetToken,
  ProxyReadMultiRequest,
  ProxyReadMultiResponse,
  ProxyReadMultiResultItem,
  ProxyReadRequest,
  ProxyReadResponse,
  ProxyWriteRequest,
  ProxyWriteResponse,
  PublicKeysResponse,
  RequestPasswordResetResponse,
  ResetPasswordResponse,
  SessionKeypair,
  SignupResponse,
  UserCredentials,
  UserPublicKeys,
  WalletClientConfig,
  WalletClientInterface,
} from "../libs/b3nd-wallet/mod.ts";
