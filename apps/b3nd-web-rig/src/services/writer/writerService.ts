import { WalletClient, generateSessionKeypair } from "@bandeira-tech/b3nd-web/wallet";
import type { SessionKeypair } from "@bandeira-tech/b3nd-web/wallet";
import { HttpClient, Identity } from "@bandeira-tech/b3nd-web";
import type { ExportedIdentity } from "@bandeira-tech/b3nd-web";
import { AppsClient } from "@bandeira-tech/b3nd-web/apps";
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";
import { computeSha256, generateHashUri } from "@bandeira-tech/b3nd-web/hash";
import type { KeyBundle } from "../../types";

type ValidationFormat = "email" | "";
type WriteKind = "plain" | "encrypted";

const DEFAULT_API_BASE_PATH = "/api/v1";

const ensureValue = (value: string | null | undefined, label: string) => {
  if (!value) {
    throw new Error(`${label} is required`);
  }
};

const loadSigningKey = async (accountPrivateKeyPem: string) => {
  ensureValue(accountPrivateKeyPem, "Account private key");
  const pemBody = accountPrivateKeyPem.replace(/-----[^-]+-----/g, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pemBody), (ch) => ch.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "Ed25519", namedCurve: "Ed25519" } as any,
    false,
    ["sign"],
  );
};

const signPayload = async (
  payload: unknown,
  appKey: string,
  accountPrivateKeyPem: string,
) => {
  ensureValue(appKey, "Auth key");
  const privateKey = await loadSigningKey(accountPrivateKeyPem);
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("Ed25519", privateKey, data);
  const sigHex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return {
    auth: [{ pubkey: appKey, signature: sigHex }],
    payload,
  };
};

const signAndEncryptPayload = async (
  payload: unknown,
  appKey: string,
  accountPrivateKeyPem: string,
  encryptionPublicKeyHex: string,
) => {
  ensureValue(encryptionPublicKeyHex, "Encryption public key");
  const privateKey = await loadSigningKey(accountPrivateKeyPem);
  const message = await encrypt.createSignedEncryptedMessage(
    new TextEncoder().encode(JSON.stringify(payload)),
    [
      {
        privateKey,
        publicKeyHex: appKey,
      },
    ],
    encryptionPublicKeyHex,
  );
  return { auth: message.auth, payload: message.payload };
};

export const createWalletClient = (walletServerUrl: string) => {
  ensureValue(walletServerUrl, "Wallet server URL");
  return new WalletClient({
    walletServerUrl: walletServerUrl.replace(/\/$/, ""),
    apiBasePath: DEFAULT_API_BASE_PATH,
  });
};


export const createAppsClient = (appServerUrl: string) => {
  ensureValue(appServerUrl, "App server URL");
  return new AppsClient({
    appServerUrl: appServerUrl.replace(/\/$/, ""),
    apiBasePath: DEFAULT_API_BASE_PATH,
  });
};

/**
 * Generate a new account identity (Ed25519 signing + X25519 encryption).
 *
 * Uses the rig's Identity.generate() under the hood — the same codepath
 * used by CLI and server apps. Returns KeyBundle format for persistence
 * compatibility; callers that need an Identity should use
 * `createIdentityFromKeyBundle()` to reconstruct one.
 */
export const generateAppKeys = async (): Promise<KeyBundle> => {
  const identity = await Identity.generate();
  const exported = await identity.export();

  // Convert PKCS8 hex → PEM for backward compat with KeyBundle format
  const sigPem = hexToPem(exported.signingPrivateKeyHex!);
  const encPem = hexToPem(exported.encryptionPrivateKeyHex!);

  return {
    appKey: exported.signingPublicKeyHex,
    accountPrivateKeyPem: sigPem,
    encryptionPublicKeyHex: exported.encryptionPublicKeyHex,
    encryptionPrivateKeyPem: encPem,
  };
};

/** Convert PKCS8 hex to PEM format. */
function hexToPem(hex: string): string {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
  const b64 = btoa(String.fromCharCode(...bytes));
  return `-----BEGIN PRIVATE KEY-----\n${(b64.match(/.{1,64}/g) || []).join("\n")}\n-----END PRIVATE KEY-----`;
}

/** Convert PEM to PKCS8 hex. */
function pemToHex(pem: string): string {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Reconstruct a rig Identity from a legacy KeyBundle.
 *
 * This bridges the old persistence format to the canonical Identity type.
 * Use this when you need Identity methods (signMessage, encrypt, etc.)
 * from stored account data.
 */
export const createIdentityFromKeyBundle = async (kb: KeyBundle): Promise<Identity> => {
  const exported: ExportedIdentity = {
    signingPublicKeyHex: kb.appKey,
    signingPrivateKeyHex: pemToHex(kb.accountPrivateKeyPem),
    encryptionPublicKeyHex: kb.encryptionPublicKeyHex,
    encryptionPrivateKeyHex: kb.encryptionPrivateKeyPem ? pemToHex(kb.encryptionPrivateKeyPem) : undefined,
  };
  return Identity.fromExport(exported);
};

export const updateOrigins = async (params: {
  appsClient: AppsClient;
  appKey: string;
  accountPrivateKeyPem: string;
  allowedOrigins: string[];
  encryptionPublicKeyHex: string | null;
}) => {
  const {
    appsClient,
    appKey,
    accountPrivateKeyPem,
    allowedOrigins,
    encryptionPublicKeyHex,
  } = params;
  ensureValue(appKey, "Auth key");
  const payload = {
    allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : ["*"],
    encryptionPublicKeyHex: encryptionPublicKeyHex || null,
  };
  const message = await signPayload(payload, appKey, accountPrivateKeyPem);
  return appsClient.updateOrigins(appKey, message as any);
};

export const saveAppProfile = async (params: {
  backendClient: HttpClient;
  appKey: string;
  accountPrivateKeyPem: string;
  googleClientId: string | null;
  allowedOrigins: string[];
  encryptionPublicKeyHex: string | null;
}) => {
  const {
    backendClient,
    appKey,
    accountPrivateKeyPem,
    googleClientId,
    allowedOrigins,
    encryptionPublicKeyHex,
  } = params;
  ensureValue(appKey, "Auth key");
  const profile = {
    googleClientId: googleClientId || null,
    allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : ["*"],
    encryptionPublicKeyHex: encryptionPublicKeyHex || null,
  };

  const signedProfile = await signPayload(profile, appKey, accountPrivateKeyPem);
  const uri = `mutable://accounts/${appKey}/app-profile`;
  const response = await backendClient.receive([uri, signedProfile]);
  return { uri, response: { success: response.accepted, error: response.error } };
};

export const fetchAppProfile = async (params: {
  backendClient: HttpClient;
  appKey: string;
}) => {
  const { backendClient, appKey } = params;
  ensureValue(appKey, "Auth key");
  const uri = `mutable://accounts/${appKey}/app-profile`;
  const res = await backendClient.read(uri);
  if (!res.success || !res.record) {
    return { success: false as const, uri, error: res.error || "Not found" };
  }
  const data = res.record.data as any;
  const payload = data?.payload ?? data ?? null;
  return { success: true as const, uri, payload, raw: data };
};

export const updateSchema = async (params: {
  appsClient: AppsClient;
  appKey: string;
  actionName: string;
  validationFormat: ValidationFormat;
  writeKind: WriteKind;
  writePlainPath: string;
  writeEncPath: string;
  accountPrivateKeyPem: string;
  encryptionPublicKeyHex: string | null;
}) => {
  const {
    appsClient,
    appKey,
    actionName,
    validationFormat,
    writeKind,
    writePlainPath,
    writeEncPath,
    accountPrivateKeyPem,
    encryptionPublicKeyHex,
  } = params;
  ensureValue(appKey, "Auth key");

  const act: any = {
    action: actionName,
    validation: validationFormat
      ? { stringValue: { format: validationFormat } }
      : undefined,
    write: writeKind === "encrypted"
      ? { encrypted: writeEncPath }
      : { plain: writePlainPath },
  };
  if (writeKind === "encrypted" && !encryptionPublicKeyHex) {
    throw new Error("Encryption public key required for encrypted actions");
  }
  const schemaPayload = {
    actions: [act],
    encryptionPublicKeyHex: encryptionPublicKeyHex || null,
  };
  const message = await signPayload(schemaPayload, appKey, accountPrivateKeyPem);
  return appsClient.updateSchema(appKey, message as any);
};

export const fetchSchema = async (params: {
  appsClient: AppsClient;
  appKey: string;
}) => {
  ensureValue(params.appKey, "Auth key");
  return params.appsClient.getSchema(params.appKey);
};

/**
 * Create a new session keypair and request approval from the app.
 *
 * Flow:
 * 1. Generate session keypair (Ed25519)
 * 2. Client posts SIGNED request to immutable inbox (proves key ownership)
 * 3. App approves via mutable accounts (controlled)
 *
 * Returns the session keypair for use in login.
 */
export const createSession = async (params: {
  appsClient: AppsClient;
  backendClient: HttpClient;
  appKey: string;
  accountPrivateKeyPem: string;
  requestPayload?: Record<string, unknown>;
}) => {
  const { appsClient, backendClient, appKey, accountPrivateKeyPem, requestPayload = {} } = params;
  ensureValue(appKey, "Auth key");

  // Generate session keypair using SDK crypto
  const sessionKeypair = await generateSessionKeypair();

  // 1. Client posts SIGNED request to inbox (proves session key ownership)
  // Payload is arbitrary - app developers decide what info to require
  const payload = { timestamp: Date.now(), ...requestPayload };
  const signedRequest = await encrypt.createAuthenticatedMessageWithHex(
    payload,
    sessionKeypair.publicKeyHex,
    sessionKeypair.privateKeyHex
  );
  const inboxUri = `immutable://inbox/${appKey}/sessions/${sessionKeypair.publicKeyHex}`;
  await backendClient.receive([inboxUri, signedRequest]);

  // 2. Request app server to approve (writes to mutable://accounts/{appKey}/sessions/{sessionPubkey} = 1)
  const message = await signPayload(
    { sessionPubkey: sessionKeypair.publicKeyHex },
    appKey,
    accountPrivateKeyPem
  );
  const result = await appsClient.createSession(appKey, message as any);

  // Return both the result and the keypair for use in login
  return {
    ...result,
    sessionKeypair,
  };
};

/**
 * Signup with password using session keypair.
 * The session must be approved before calling this.
 */
export const signupWithPassword = async (params: {
  walletClient: WalletClient;
  appKey: string;
  sessionKeypair: SessionKeypair;
  username: string;
  password: string;
}) => {
  const { walletClient, appKey, sessionKeypair, username, password } = params;
  ensureValue(appKey, "Auth key");
  if (!sessionKeypair?.publicKeyHex || !sessionKeypair?.privateKeyHex) {
    throw new Error("Session keypair is required");
  }
  return walletClient.signup(appKey, sessionKeypair, { type: 'password', username, password });
};

/**
 * Login with password using session keypair.
 * The session must be approved before calling this.
 */
export const loginWithPassword = async (params: {
  walletClient: WalletClient;
  appKey: string;
  sessionKeypair: SessionKeypair;
  username: string;
  password: string;
}) => {
  const { walletClient, appKey, sessionKeypair, username, password } = params;
  ensureValue(appKey, "Auth key");
  if (!sessionKeypair?.publicKeyHex || !sessionKeypair?.privateKeyHex) {
    throw new Error("Session keypair is required");
  }
  return walletClient.login(appKey, sessionKeypair, { type: 'password', username, password });
};

/**
 * Signup with Google OAuth using session keypair.
 * The session must be approved before calling this.
 */
export const googleSignup = async (params: {
  walletClient: WalletClient;
  appKey: string;
  sessionKeypair: SessionKeypair;
  googleIdToken: string;
}) => {
  const { walletClient, appKey, sessionKeypair, googleIdToken } = params;
  ensureValue(appKey, "Auth key");
  if (!sessionKeypair?.publicKeyHex || !sessionKeypair?.privateKeyHex) {
    throw new Error("Session keypair is required");
  }
  return walletClient.signup(appKey, sessionKeypair, { type: 'google', googleIdToken });
};

/**
 * Login with Google OAuth using session keypair.
 * The session must be approved before calling this.
 */
export const googleLogin = async (params: {
  walletClient: WalletClient;
  appKey: string;
  sessionKeypair: SessionKeypair;
  googleIdToken: string;
}) => {
  const { walletClient, appKey, sessionKeypair, googleIdToken } = params;
  ensureValue(appKey, "Auth key");
  if (!sessionKeypair?.publicKeyHex || !sessionKeypair?.privateKeyHex) {
    throw new Error("Session keypair is required");
  }
  return walletClient.login(appKey, sessionKeypair, { type: 'google', googleIdToken });
};

export const fetchMyKeys = async (params: {
  walletClient: WalletClient;
  appKey: string;
  session: { username: string; token: string; expiresIn: number };
}) => {
  const { walletClient, appKey, session } = params;
  ensureValue(appKey, "Auth key");
  walletClient.setSession(session);
  return walletClient.getPublicKeys(appKey);
};

export const backendWritePlain = async (params: {
  backendClient: HttpClient;
  appKey: string;
  accountPrivateKeyPem: string;
  writeUri: string;
  writePayload: string;
}) => {
  const { backendClient, appKey, accountPrivateKeyPem, writeUri, writePayload } =
    params;
  ensureValue(writePayload, "Write payload");
  const payload = JSON.parse(writePayload);
  const value = await signPayload(payload, appKey, accountPrivateKeyPem);
  const targetUri = writeUri.includes(":key") ? writeUri.replace(/:key/g, appKey) : writeUri;
  const response = await backendClient.receive([targetUri, value]);
  return { targetUri, response: { success: response.accepted, error: response.error } };
};

export const backendWriteEnc = async (params: {
  backendClient: HttpClient;
  appKey: string;
  accountPrivateKeyPem: string;
  encryptionPublicKeyHex: string;
  writeUri: string;
  writePayload: string;
}) => {
  const {
    backendClient,
    appKey,
    accountPrivateKeyPem,
    encryptionPublicKeyHex,
    writeUri,
    writePayload,
  } = params;
  ensureValue(writePayload, "Write payload");
  const payload = JSON.parse(writePayload);
  const value = await signAndEncryptPayload(
    payload,
    appKey,
    accountPrivateKeyPem,
    encryptionPublicKeyHex,
  );
  const targetUri = writeUri.includes(":key") ? writeUri.replace(/:key/g, appKey) : writeUri;
  const response = await backendClient.receive([targetUri, value]);
  return { targetUri, response: { success: response.accepted, error: response.error } };
};

export const proxyWrite = async (params: {
  walletClient: WalletClient;
  session: { username: string; token: string; expiresIn: number };
  uri: string;
  data: unknown;
  encrypt: boolean;
}) => {
  const { walletClient, session, uri, data, encrypt } = params;
  ensureValue(uri, "Write URI");
  walletClient.setSession(session);
  return walletClient.proxyWrite({ uri, data, encrypt });
};

export const signAppPayload = async (params: {
  payload: unknown;
  appKey: string;
  accountPrivateKeyPem: string;
  identity?: Identity;
}) => {
  const { payload, identity, appKey, accountPrivateKeyPem } = params;
  if (identity) return identity.signMessage(payload);
  return signPayload(payload, appKey, accountPrivateKeyPem);
};

export const signEncryptedAppPayload = async (params: {
  payload: unknown;
  appKey: string;
  accountPrivateKeyPem: string;
  encryptionPublicKeyHex: string;
  identity?: Identity;
}) => {
  const {
    payload,
    identity,
    appKey,
    accountPrivateKeyPem,
    encryptionPublicKeyHex,
  } = params;
  if (identity) {
    // Use Identity's encrypt + sign
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const encrypted = await identity.encrypt(plaintext, encryptionPublicKeyHex);
    return identity.signMessage(encrypted);
  }
  return signAndEncryptPayload(
    payload,
    appKey,
    accountPrivateKeyPem,
    encryptionPublicKeyHex,
  );
};

// ============================================================================
// CONTENT-ADDRESSED UPLOAD SERVICES
// ============================================================================

// computeSha256 and generateHashUri are imported from @bandeira-tech/b3nd-web/hash

/**
 * Read file as Uint8Array
 */
export async function readFileAsBytes(file: File): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/**
 * Read file as base64 data URL
 */
export async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export interface HashUploadResult {
  hashUri: string;
  hash: string;
  linkUri?: string;
  encrypted: boolean;
  size: number;
  contentType: string;
  response: { success: boolean; error?: string };
}

/**
 * Upload a file as content-addressed hash (optionally encrypted)
 */
export const uploadHash = async (params: {
  backendClient: HttpClient;
  file: File;
  encryptToPublicKey?: string;
}): Promise<HashUploadResult> => {
  const { backendClient, file, encryptToPublicKey } = params;

  // Create content data structure with metadata
  let contentData: unknown;
  const isEncrypted = Boolean(encryptToPublicKey);

  if (encryptToPublicKey) {
    // Encrypt the file data
    const dataUrl = await readFileAsDataUrl(file);
    const payload = {
      type: file.type,
      name: file.name,
      size: file.size,
      data: dataUrl,
    };
    const encrypted = await encrypt.encrypt(
      new TextEncoder().encode(JSON.stringify(payload)),
      encryptToPublicKey,
    );
    contentData = encrypted;
  } else {
    // Store as plain data with base64 encoding
    const dataUrl = await readFileAsDataUrl(file);
    contentData = {
      type: file.type,
      name: file.name,
      size: file.size,
      data: dataUrl,
    };
  }

  // Compute hash of final payload
  const hash = await computeSha256(contentData);
  const hashUri = generateHashUri(hash);

  // Write to backend via receive
  const response = await backendClient.receive([hashUri, contentData]);

  return {
    hashUri,
    hash,
    encrypted: isEncrypted,
    size: file.size,
    contentType: file.type,
    response: { success: response.accepted, error: response.error },
  };
};

/**
 * Upload content-addressed hash and create authenticated link
 */
export const uploadHashWithLink = async (params: {
  backendClient: HttpClient;
  file: File;
  linkPath: string;
  appKey: string;
  accountPrivateKeyPem: string;
  encryptToPublicKey?: string;
}): Promise<HashUploadResult & { linkResponse: { success: boolean; error?: string } }> => {
  const {
    backendClient,
    file,
    linkPath,
    appKey,
    accountPrivateKeyPem,
    encryptToPublicKey,
  } = params;

  // First upload the content-addressed hash
  const hashResult = await uploadHash({
    backendClient,
    file,
    encryptToPublicKey,
  });

  if (!hashResult.response.success) {
    return {
      ...hashResult,
      linkResponse: { success: false, error: "Upload failed" },
    };
  }

  // Create authenticated link pointing to the hash
  const linkUri = `link://accounts/${appKey}/${linkPath}`;
  const signedLink = await signPayload(hashResult.hashUri, appKey, accountPrivateKeyPem);
  const linkResponse = await backendClient.receive([linkUri, signedLink]);

  return {
    ...hashResult,
    linkUri,
    linkResponse: { success: linkResponse.accepted, error: linkResponse.error },
  };
};

/**
 * Upload multiple files as content-addressed hashes
 */
export const uploadMultipleHashes = async (params: {
  backendClient: HttpClient;
  files: File[];
  encryptToPublicKey?: string;
  onProgress?: (completed: number, total: number, current: HashUploadResult) => void;
}): Promise<HashUploadResult[]> => {
  const { backendClient, files, encryptToPublicKey, onProgress } = params;
  const results: HashUploadResult[] = [];

  for (let i = 0; i < files.length; i++) {
    const result = await uploadHash({
      backendClient,
      file: files[i],
      encryptToPublicKey,
    });
    results.push(result);
    onProgress?.(i + 1, files.length, result);
  }

  return results;
};
