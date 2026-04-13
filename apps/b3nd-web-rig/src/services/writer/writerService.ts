import {
  generateSessionKeypair,
  WalletClient,
} from "@bandeira-tech/b3nd-web/wallet";
import type { SessionKeypair } from "@bandeira-tech/b3nd-web/wallet";
import { Identity } from "@bandeira-tech/b3nd-web";
import type { ExportedIdentity } from "@bandeira-tech/b3nd-web";
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";
import { computeSha256, generateHashUri } from "@bandeira-tech/b3nd-web/hash";
import type { KeyBundle } from "../../types"; // Legacy — for migration only

type ValidationFormat = "email" | "";
type WriteKind = "plain" | "encrypted";

const DEFAULT_API_BASE_PATH = "/api/v1";

/**
 * Stub type for removed AppsClient — keeps call sites compiling.
 * All methods throw at runtime.
 */
// deno-lint-ignore no-explicit-any
type AppsClient = any;

/**
 * Minimal backend client interface — satisfied by both Rig (preferred —
 * fires hooks/events/observe) and raw NodeProtocolInterface / HttpClient.
 */
export interface BackendClient {
  receive(
    msgs: [string, Record<string, number>, unknown][],
  ): Promise<{ accepted: boolean; error?: string }[]>;
  read(
    uri: string,
  ): Promise<
    { success: boolean; record?: { values: Record<string, number>; data: any }; error?: string }[]
  >;
}

const ensureValue = (value: string | null | undefined, label: string) => {
  if (!value) {
    throw new Error(`${label} is required`);
  }
};

export const createWalletClient = (_walletServerUrl: string): WalletClient => {
  throw new Error(
    "WalletClient is not implemented — custodial wallet server has been removed",
  );
};

export const createAppsClient = (_appServerUrl: string): AppsClient => {
  throw new Error(
    "AppsClient is not implemented — custodial app server has been removed",
  );
};

/**
 * Generate a new account identity (Ed25519 signing + X25519 encryption).
 *
 * Returns the Identity and its ExportedIdentity for persistence.
 */
export const generateAccountIdentity = async (): Promise<{
  identity: Identity;
  exported: ExportedIdentity;
  pubkey: string;
  encryptionPubkey: string;
}> => {
  const identity = await Identity.generate();
  const exported = await identity.export();
  return {
    identity,
    exported,
    pubkey: identity.pubkey,
    encryptionPubkey: identity.encryptionPubkey,
  };
};

/** @deprecated Use generateAccountIdentity instead. */
export const generateAppKeys = generateAccountIdentity;

// ── Legacy migration helpers ──

/** Convert PEM to PKCS8 hex. */
function pemToHex(pem: string): string {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Migrate a legacy KeyBundle to ExportedIdentity.
 *
 * Used during rehydration to upgrade old persisted accounts.
 */
export function migrateKeyBundle(kb: KeyBundle): ExportedIdentity {
  return {
    signingPublicKeyHex: kb.appKey,
    signingPrivateKeyHex: pemToHex(kb.accountPrivateKeyPem),
    encryptionPublicKeyHex: kb.encryptionPublicKeyHex,
    encryptionPrivateKeyHex: kb.encryptionPrivateKeyPem
      ? pemToHex(kb.encryptionPrivateKeyPem)
      : undefined,
  };
}

/**
 * Reconstruct a rig Identity from an ExportedIdentity or legacy KeyBundle.
 */
export const restoreIdentity = async (
  source: ExportedIdentity | KeyBundle,
): Promise<Identity> => {
  // Detect legacy KeyBundle by the presence of `appKey`
  if ("appKey" in source) {
    return Identity.fromExport(migrateKeyBundle(source as KeyBundle));
  }
  return Identity.fromExport(source as ExportedIdentity);
};

/** @deprecated Use restoreIdentity instead. */
export const createIdentityFromKeyBundle = restoreIdentity;

// ============================================================================
// AUTHENTICATED OPERATIONS — all signing goes through Identity
// ============================================================================

export const signAppPayload = async (params: {
  identity: Identity;
  payload: unknown;
}) => {
  return params.identity.signMessage(params.payload);
};

export const signEncryptedAppPayload = async (params: {
  identity: Identity;
  payload: unknown;
  encryptionPublicKeyHex: string;
}) => {
  const { identity, payload, encryptionPublicKeyHex } = params;
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await identity.encrypt(plaintext, encryptionPublicKeyHex);
  return identity.signMessage(encrypted);
};

export const updateOrigins = async (params: {
  appsClient: AppsClient;
  identity: Identity;
  allowedOrigins: string[];
  encryptionPublicKeyHex: string | null;
}) => {
  const { appsClient, identity, allowedOrigins, encryptionPublicKeyHex } =
    params;
  const payload = {
    allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : ["*"],
    encryptionPublicKeyHex: encryptionPublicKeyHex || null,
  };
  const message = await identity.signMessage(payload);
  return appsClient.updateOrigins(identity.pubkey, message as any);
};

export const saveAppProfile = async (params: {
  backendClient: BackendClient;
  identity: Identity;
  googleClientId: string | null;
  allowedOrigins: string[];
  encryptionPublicKeyHex: string | null;
}) => {
  const {
    backendClient,
    identity,
    googleClientId,
    allowedOrigins,
    encryptionPublicKeyHex,
  } = params;
  const profile = {
    googleClientId: googleClientId || null,
    allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : ["*"],
    encryptionPublicKeyHex: encryptionPublicKeyHex || null,
  };
  const signedProfile = await identity.signMessage(profile);
  const uri = `mutable://accounts/${identity.pubkey}/app-profile`;
  const [response] = await backendClient.receive([[uri, {}, signedProfile]]);
  return {
    uri,
    response: { success: response.accepted, error: response.error },
  };
};

export const fetchAppProfile = async (params: {
  backendClient: BackendClient;
  appKey: string;
}) => {
  const { backendClient, appKey } = params;
  ensureValue(appKey, "Auth key");
  const uri = `mutable://accounts/${appKey}/app-profile`;
  const results = await backendClient.read(uri);
  const res = results[0];
  if (!res?.success || !res.record) {
    return { success: false as const, uri, error: res?.error || "Not found" };
  }
  const data = res.record.data as any;
  const payload = data?.payload ?? data ?? null;
  return { success: true as const, uri, payload, raw: data };
};

export const updateSchema = async (params: {
  appsClient: AppsClient;
  identity: Identity;
  actionName: string;
  validationFormat: ValidationFormat;
  writeKind: WriteKind;
  writePlainPath: string;
  writeEncPath: string;
  encryptionPublicKeyHex: string | null;
}) => {
  const {
    appsClient,
    identity,
    actionName,
    validationFormat,
    writeKind,
    writePlainPath,
    writeEncPath,
    encryptionPublicKeyHex,
  } = params;

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
  const message = await identity.signMessage(schemaPayload);
  return appsClient.updateSchema(identity.pubkey, message as any);
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
 */
export const createSession = async (params: {
  appsClient: AppsClient;
  backendClient: BackendClient;
  identity: Identity;
  requestPayload?: Record<string, unknown>;
}) => {
  const { appsClient, backendClient, identity, requestPayload = {} } = params;

  // Generate session keypair using SDK crypto
  const sessionKeypair = await generateSessionKeypair();

  // 1. Client posts SIGNED request to inbox (proves session key ownership)
  const payload = { timestamp: Date.now(), ...requestPayload };
  const signedRequest = await encrypt.createAuthenticatedMessageWithHex(
    payload,
    sessionKeypair.publicKeyHex,
    sessionKeypair.privateKeyHex,
  );
  const inboxUri =
    `immutable://inbox/${identity.pubkey}/sessions/${sessionKeypair.publicKeyHex}`;
  await backendClient.receive([[inboxUri, {}, signedRequest]]);

  // 2. Request app server to approve
  const message = await identity.signMessage(
    { sessionPubkey: sessionKeypair.publicKeyHex },
  );
  const result = await appsClient.createSession(
    identity.pubkey,
    message as any,
  );

  return { ...result, sessionKeypair };
};

// ============================================================================
// WALLET AUTH — stays as-is (separate service, not rig scope)
// ============================================================================

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
  return walletClient.signup(appKey, sessionKeypair, {
    type: "password",
    username,
    password,
  });
};

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
  return walletClient.login(appKey, sessionKeypair, {
    type: "password",
    username,
    password,
  });
};

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
  return walletClient.signup(appKey, sessionKeypair, {
    type: "google",
    googleIdToken,
  });
};

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
  return walletClient.login(appKey, sessionKeypair, {
    type: "google",
    googleIdToken,
  });
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

// ============================================================================
// BACKEND WRITE — through Identity
// ============================================================================

export const backendWritePlain = async (params: {
  backendClient: BackendClient;
  identity: Identity;
  writeUri: string;
  writePayload: string;
}) => {
  const { backendClient, identity, writeUri, writePayload } = params;
  ensureValue(writePayload, "Write payload");
  const payload = JSON.parse(writePayload);
  const value = await identity.signMessage(payload);
  const targetUri = writeUri.includes(":key")
    ? writeUri.replace(/:key/g, identity.pubkey)
    : writeUri;
  const [response] = await backendClient.receive([[targetUri, {}, value]]);
  return {
    targetUri,
    response: { success: response.accepted, error: response.error },
  };
};

export const backendWriteEnc = async (params: {
  backendClient: BackendClient;
  identity: Identity;
  encryptionPublicKeyHex: string;
  writeUri: string;
  writePayload: string;
}) => {
  const {
    backendClient,
    identity,
    encryptionPublicKeyHex,
    writeUri,
    writePayload,
  } = params;
  ensureValue(writePayload, "Write payload");
  const payload = JSON.parse(writePayload);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await identity.encrypt(plaintext, encryptionPublicKeyHex);
  const value = await identity.signMessage(encrypted);
  const targetUri = writeUri.includes(":key")
    ? writeUri.replace(/:key/g, identity.pubkey)
    : writeUri;
  const [response] = await backendClient.receive([[targetUri, {}, value]]);
  return {
    targetUri,
    response: { success: response.accepted, error: response.error },
  };
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

// ============================================================================
// CONTENT-ADDRESSED UPLOAD SERVICES
// ============================================================================

export async function readFileAsBytes(file: File): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

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

export const uploadHash = async (params: {
  backendClient: BackendClient;
  file: File;
  encryptToPublicKey?: string;
}): Promise<HashUploadResult> => {
  const { backendClient, file, encryptToPublicKey } = params;

  let contentData: unknown;
  const isEncrypted = Boolean(encryptToPublicKey);

  if (encryptToPublicKey) {
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
    const dataUrl = await readFileAsDataUrl(file);
    contentData = {
      type: file.type,
      name: file.name,
      size: file.size,
      data: dataUrl,
    };
  }

  const hash = await computeSha256(contentData);
  const hashUri = generateHashUri(hash);
  const [response] = await backendClient.receive([[hashUri, {}, contentData]]);

  return {
    hashUri,
    hash,
    encrypted: isEncrypted,
    size: file.size,
    contentType: file.type,
    response: { success: response.accepted, error: response.error },
  };
};

export const uploadHashWithLink = async (params: {
  backendClient: BackendClient;
  identity: Identity;
  file: File;
  linkPath: string;
  encryptToPublicKey?: string;
}): Promise<
  HashUploadResult & { linkResponse: { success: boolean; error?: string } }
> => {
  const { backendClient, identity, file, linkPath, encryptToPublicKey } =
    params;

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

  const linkUri = `link://accounts/${identity.pubkey}/${linkPath}`;
  const signedLink = await identity.signMessage(hashResult.hashUri);
  const [linkResponse] = await backendClient.receive([[linkUri, {}, signedLink]]);

  return {
    ...hashResult,
    linkUri,
    linkResponse: { success: linkResponse.accepted, error: linkResponse.error },
  };
};

export const uploadMultipleHashes = async (params: {
  backendClient: BackendClient;
  files: File[];
  encryptToPublicKey?: string;
  onProgress?: (
    completed: number,
    total: number,
    current: HashUploadResult,
  ) => void;
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
