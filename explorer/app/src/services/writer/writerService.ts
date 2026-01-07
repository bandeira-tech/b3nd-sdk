import { WalletClient, generateSessionKeypair } from "@bandeira-tech/b3nd-web/wallet";
import type { SessionKeypair } from "@bandeira-tech/b3nd-web/wallet";
import { HttpClient } from "@bandeira-tech/b3nd-web";
import { AppsClient } from "@bandeira-tech/b3nd-web/apps";
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";
import type { KeyBundle } from "../../types";
import { HttpAdapter } from "../../adapters/HttpAdapter";

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
    payload,
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

export const createBackendClient = (activeBackend: { adapter?: unknown } | null) => {
  if (!activeBackend?.adapter || !(activeBackend.adapter instanceof HttpAdapter)) {
    throw new Error("Active backend with HTTP adapter is required");
  }
  if (!activeBackend.adapter.baseUrl) {
    throw new Error("Active backend URL is required");
  }
  return new HttpClient({
    url: activeBackend.adapter.baseUrl.replace(/\/$/, ""),
  });
};

export const createAppsClient = (appServerUrl: string) => {
  ensureValue(appServerUrl, "App server URL");
  return new AppsClient({
    appServerUrl: appServerUrl.replace(/\/$/, ""),
    apiBasePath: DEFAULT_API_BASE_PATH,
  });
};

export const generateAppKeys = async () => {
  const kp =
    (await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
  const pub = await crypto.subtle.exportKey("raw", kp.publicKey);
  const priv = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
  const pubHex = Array.from(new Uint8Array(pub))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const privB64 = btoa(String.fromCharCode(...new Uint8Array(priv)));
  const privPem = `-----BEGIN PRIVATE KEY-----\n${
    (privB64.match(/.{1,64}/g) || []).join("\n")
  }\n-----END PRIVATE KEY-----`;

  const encKp = (await crypto.subtle.generateKey(
    { name: "X25519", namedCurve: "X25519" } as unknown as EcKeyGenParams,
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const encPubRaw = await crypto.subtle.exportKey("raw", encKp.publicKey);
  const encPubHex = Array.from(new Uint8Array(encPubRaw))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const encPrivPkcs8 = await crypto.subtle.exportKey(
    "pkcs8",
    encKp.privateKey,
  );
  const encPrivB64 = btoa(
    String.fromCharCode(...new Uint8Array(encPrivPkcs8)),
  );
  const encPrivPem = `-----BEGIN PRIVATE KEY-----\n${
    (encPrivB64.match(/.{1,64}/g) || []).join("\n")
  }\n-----END PRIVATE KEY-----`;

  return {
    appKey: pubHex,
    accountPrivateKeyPem: privPem,
    encryptionPublicKeyHex: encPubHex,
    encryptionPrivateKeyPem: encPrivPem,
  } as KeyBundle;
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
  return { uri, response: await backendClient.write(uri, signedProfile) };
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
 * New flow:
 * 1. Generate session keypair (Ed25519)
 * 2. Request approval via immutable inbox (permissionless)
 * 3. App approves via mutable accounts (controlled)
 *
 * Returns the session keypair for use in login.
 */
export const createSession = async (params: {
  appsClient: AppsClient;
  appKey: string;
  accountPrivateKeyPem: string;
}) => {
  const { appsClient, appKey, accountPrivateKeyPem } = params;
  ensureValue(appKey, "Auth key");

  // Generate session keypair using SDK crypto
  const sessionKeypair = await generateSessionKeypair();

  // Request session approval via app server (writes to inbox and approves)
  const message = await signPayload(
    { sessionPubkey: sessionKeypair.publicKeyHex },
    appKey,
    accountPrivateKeyPem
  );

  // Note: The app server should:
  // 1. Write request to immutable://inbox/{appKey}/sessions/{sessionPubkey} = 1
  // 2. Write approval to mutable://accounts/{appKey}/sessions/{sessionPubkey} = 1
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
  return walletClient.signupWithToken(appKey, sessionKeypair, { username, password });
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
  return walletClient.loginWithTokenSession(appKey, sessionKeypair, { username, password });
};

/**
 * Signup with Google OAuth using session keypair.
 * The session must be approved before calling this.
 */
export const googleSignup = async (params: {
  walletServerUrl: string;
  appKey: string;
  sessionKeypair: SessionKeypair;
  googleIdToken: string;
}) => {
  const { walletServerUrl, appKey, sessionKeypair, googleIdToken } = params;
  ensureValue(walletServerUrl, "Wallet server URL");
  ensureValue(appKey, "Auth key");
  if (!sessionKeypair?.publicKeyHex || !sessionKeypair?.privateKeyHex) {
    throw new Error("Session keypair is required");
  }

  // Build the payload to sign
  const payloadToSign = {
    sessionPubkey: sessionKeypair.publicKeyHex,
    type: "google",
    googleIdToken,
  };

  // Sign the payload with session private key using SDK crypto
  const sessionSignature = await encrypt.signWithHex(sessionKeypair.privateKeyHex, payloadToSign);

  const response = await fetch(
    `${walletServerUrl.replace(/\/$/, "")}${DEFAULT_API_BASE_PATH}/auth/signup/${appKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payloadToSign,
        sessionSignature,
      }),
    },
  );
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || `Google signup failed: ${response.statusText}`);
  }
  return data as {
    username: string;
    token: string;
    expiresIn: number;
    email: string;
    name: string;
    picture?: string;
  };
};

/**
 * Login with Google OAuth using session keypair.
 * The session must be approved before calling this.
 */
export const googleLogin = async (params: {
  walletServerUrl: string;
  appKey: string;
  sessionKeypair: SessionKeypair;
  googleIdToken: string;
}) => {
  const { walletServerUrl, appKey, sessionKeypair, googleIdToken } = params;
  ensureValue(walletServerUrl, "Wallet server URL");
  ensureValue(appKey, "Auth key");
  if (!sessionKeypair?.publicKeyHex || !sessionKeypair?.privateKeyHex) {
    throw new Error("Session keypair is required");
  }

  // Build the payload to sign
  const payloadToSign = {
    sessionPubkey: sessionKeypair.publicKeyHex,
    type: "google",
    googleIdToken,
  };

  // Sign the payload with session private key using SDK crypto
  const sessionSignature = await encrypt.signWithHex(sessionKeypair.privateKeyHex, payloadToSign);

  const response = await fetch(
    `${walletServerUrl.replace(/\/$/, "")}${DEFAULT_API_BASE_PATH}/auth/login/${appKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payloadToSign,
        sessionSignature,
      }),
    },
  );
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || `Google login failed: ${response.statusText}`);
  }
  return data as {
    username: string;
    token: string;
    expiresIn: number;
    email: string;
    name: string;
    picture?: string;
  };
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
  return { targetUri, response: await backendClient.write(targetUri, value) };
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
  return { targetUri, response: await backendClient.write(targetUri, value) };
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
}) => {
  const { payload, appKey, accountPrivateKeyPem } = params;
  return signPayload(payload, appKey, accountPrivateKeyPem);
};

export const signEncryptedAppPayload = async (params: {
  payload: unknown;
  appKey: string;
  accountPrivateKeyPem: string;
  encryptionPublicKeyHex: string;
}) => {
  const {
    payload,
    appKey,
    accountPrivateKeyPem,
    encryptionPublicKeyHex,
  } = params;
  return signAndEncryptPayload(
    payload,
    appKey,
    accountPrivateKeyPem,
    encryptionPublicKeyHex,
  );
};
