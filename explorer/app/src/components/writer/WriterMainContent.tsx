import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { WalletClient } from "@bandeira-tech/b3nd-web/wallet";
import { HttpClient } from "@bandeira-tech/b3nd-web";
import { AppsClient } from "@bandeira-tech/b3nd-web/apps";
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";
import { Activity, KeyRound, Settings, ShieldCheck, Server, Play, Wand2 } from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import type { AppLogEntry } from "../../types";

type Config = {
  walletUrl: string;
  apiBasePath: string;
  backendUrl: string;
  appServerUrl: string;
  appApiBasePath: string;
  googleClientId: string;
};

type KeyBundle = {
  appKey: string;
  accountPrivateKeyPem: string;
  encryptionPublicKeyHex: string;
  encryptionPrivateKeyPem: string;
};

const KEY_STORAGE_KEY = "b3nd-writer-app-keys";
const CONFIG_STORAGE_KEY = "b3nd-writer-config";

const EMPTY_CONFIG: Config = {
  walletUrl: "",
  apiBasePath: "",
  backendUrl: "",
  appServerUrl: "",
  appApiBasePath: "",
  googleClientId: "",
};

const PRIMARY_BUTTON =
  "inline-flex items-center justify-center rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const SECONDARY_BUTTON =
  "inline-flex items-center justify-center rounded border border-border bg-muted px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function WriterMainContent() {
  const { writerSection, addLogEntry } = useAppStore();
  const [cfg, setCfg] = useState<Config>(EMPTY_CONFIG);
  const [session, setSession] = useState<{ username: string; token: string; expiresIn: number } | null>(null);
  const [appKey, setAppKey] = useState("");
  const [appToken, setAppToken] = useState("");
  const [accountPrivateKeyPem, setAccountPrivateKeyPem] = useState("");
  const [appSession, setAppSession] = useState("");
  const [writeUri, setWriteUri] = useState("");
  const [writePayload, setWritePayload] = useState("");
  const [output, setOutput] = useState<any>(null);
  const [lastResolvedUri, setLastResolvedUri] = useState<string | null>(null);
  const [lastAppUri, setLastAppUri] = useState<string | null>(null);
  const [actionName, setActionName] = useState("registerForReceiveUpdates");
  const [validationFormat, setValidationFormat] = useState<"email" | "">("");
  const [writeKind, setWriteKind] = useState<"plain" | "encrypted">("plain");
  const [writePlainPath, setWritePlainPath] = useState("");
  const [writeEncPath, setWriteEncPath] = useState("");
  const [actionPayload, setActionPayload] = useState("");
  const [encPublicKeyHex, setEncPublicKeyHex] = useState("");
  const [encPrivateKeyPem, setEncPrivateKeyPem] = useState("");
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const [googleMode, setGoogleMode] = useState<"signup" | "login">("signup");
  const hasLoadedKeys = useRef(false);
  const hasLoadedConfig = useRef(false);

  const keyBundle: KeyBundle = {
    appKey,
    accountPrivateKeyPem,
    encryptionPublicKeyHex: encPublicKeyHex,
    encryptionPrivateKeyPem: encPrivateKeyPem,
  };

  const isConfigReady =
    !!cfg.walletUrl &&
    !!cfg.apiBasePath &&
    !!cfg.backendUrl &&
    !!cfg.appServerUrl &&
    !!cfg.appApiBasePath;

  const assertConfigReady = () => {
    if (!isConfigReady) {
      throw new Error("Writer configuration incomplete: walletUrl, apiBasePath, backendUrl, appServerUrl, and appApiBasePath are required");
    }
  };

  const getWallet = () => {
    assertConfigReady();
    return new WalletClient({
      walletServerUrl: cfg.walletUrl.replace(/\/$/, ""),
      apiBasePath: cfg.apiBasePath,
    });
  };

  const getBackend = () => {
    assertConfigReady();
    return new HttpClient({ url: cfg.backendUrl.replace(/\/$/, "") });
  };

  const getApps = () => {
    assertConfigReady();
    return new AppsClient({
      appServerUrl: cfg.appServerUrl.replace(/\/$/, ""),
      apiBasePath: cfg.appApiBasePath,
    });
  };

  const logLine = (source: string, message: string, level: AppLogEntry["level"] = "info") => {
    addLogEntry({ source, message, level });
  };

  const persistKeys = (bundle: KeyBundle) => {
    localStorage.setItem(KEY_STORAGE_KEY, JSON.stringify(bundle));
  };

  const applyKeyBundle = (bundle: KeyBundle) => {
    setAppKey(bundle.appKey);
    setAccountPrivateKeyPem(bundle.accountPrivateKeyPem);
    setEncPublicKeyHex(bundle.encryptionPublicKeyHex);
    setEncPrivateKeyPem(bundle.encryptionPrivateKeyPem);
    persistKeys(bundle);
  };

  const updateKeyBundle = (patch: Partial<KeyBundle>) => {
    applyKeyBundle({ ...keyBundle, ...patch });
  };

  const persistConfig = (next: Config) => {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(next));
  };

  const ensureValue = (value: string, label: string) => {
    if (!value) {
      throw new Error(`${label} is required`);
    }
  };

  const loadSigningKey = async () => {
    ensureValue(accountPrivateKeyPem, "Account private key");
    ensureValue(appKey, "App key");
    const pemBody = accountPrivateKeyPem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    const der = Uint8Array.from(atob(pemBody), (ch) => ch.charCodeAt(0));
    return crypto.subtle.importKey("pkcs8", der, { name: "Ed25519", namedCurve: "Ed25519" } as any, false, ["sign"]);
  };

  const signPayload = async (payload: any) => {
    const privateKey = await loadSigningKey();
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

  const signAndEncryptPayload = async (payload: any) => {
    ensureValue(encPublicKeyHex, "Encryption public key");
    const privateKey = await loadSigningKey();
    const message = await encrypt.createSignedEncryptedMessage(
      payload,
      [
        {
          privateKey,
          publicKeyHex: appKey,
        },
      ],
      encPublicKeyHex,
    );
    return { auth: message.auth, payload: message.payload };
  };

  const resolveUriWithKey = (uri: string) => {
    if (uri.includes(":key")) {
      ensureValue(appKey, "App key");
      return uri.replace(/:key/g, appKey);
    }
    return uri;
  };

  const applyConfig = () => {
    persistConfig(cfg);
    logLine("local", "Config applied", "success");
  };

  const handleAction = async (label: string, action: () => Promise<void>) => {
    try {
      assertConfigReady();
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOutput({ error: message });
      logLine("local", `${label} failed: ${message}`, "error");
    }
  };

  const walletHealth = async () => {
    const wallet = getWallet();
    const h = await wallet.health();
    setOutput(h);
    logLine("wallet", `Health: ${"status" in h ? (h as any).status : "ok"}`, "info");
  };

  const backendHealth = async () => {
    const backend = getBackend();
    const h = await backend.health();
    setOutput(h);
    logLine("backend", `Health: ${"status" in h ? (h as any).status : "ok"}`, "info");
  };

  const appsHealth = async () => {
    const apps = getApps();
    const h = await apps.health();
    setOutput(h);
    logLine("apps", "Health ok", "info");
  };

  const serverKeys = async () => {
    const wallet = getWallet();
    const k = await wallet.getServerKeys();
    setOutput(k);
    logLine("wallet", "Server keys ok", "info");
  };

  const genAppKeys = async () => {
    const kp = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
    const pub = await crypto.subtle.exportKey("raw", kp.publicKey);
    const priv = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
    const pubHex = Array.from(new Uint8Array(pub))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const privB64 = btoa(String.fromCharCode(...new Uint8Array(priv)));
    const privPem = `-----BEGIN PRIVATE KEY-----\n${(privB64.match(/.{1,64}/g) || []).join("\n")}\n-----END PRIVATE KEY-----`;

    // @ts-ignore X25519 supported in runtime
    const encKp = (await crypto.subtle.generateKey({ name: "X25519", namedCurve: "X25519" } as any, true, ["deriveBits"])) as CryptoKeyPair;
    const encPubRaw = await crypto.subtle.exportKey("raw", encKp.publicKey);
    const encPubHex = Array.from(new Uint8Array(encPubRaw))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const encPrivPkcs8 = await crypto.subtle.exportKey("pkcs8", encKp.privateKey);
    const encPrivB64 = btoa(String.fromCharCode(...new Uint8Array(encPrivPkcs8)));
    const encPrivPem = `-----BEGIN PRIVATE KEY-----\n${(encPrivB64.match(/.{1,64}/g) || []).join("\n")}\n-----END PRIVATE KEY-----`;

    applyKeyBundle({
      appKey: pubHex,
      accountPrivateKeyPem: privPem,
      encryptionPublicKeyHex: encPubHex,
      encryptionPrivateKeyPem: encPrivPem,
    });
    setOutput({
      publicKeyHex: pubHex,
      privateKeyPem: privPem,
      encryptionPublicKeyHex: encPubHex,
      encryptionPrivateKeyPem: encPrivPem,
    });
    logLine("local", "Generated app keys (identity + encryption)", "success");
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (hasLoadedKeys.current) return;
    const stored = localStorage.getItem(KEY_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<KeyBundle>;
      if (
        parsed.appKey &&
        parsed.accountPrivateKeyPem &&
        parsed.encryptionPublicKeyHex &&
        parsed.encryptionPrivateKeyPem
      ) {
        applyKeyBundle({
          appKey: parsed.appKey,
          accountPrivateKeyPem: parsed.accountPrivateKeyPem,
          encryptionPublicKeyHex: parsed.encryptionPublicKeyHex,
          encryptionPrivateKeyPem: parsed.encryptionPrivateKeyPem,
        });
        logLine("local", "Keys loaded from local storage", "info");
      }
    }
    hasLoadedKeys.current = true;
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (hasLoadedConfig.current) return;
    const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<Config>;
      if (
        parsed.walletUrl &&
        parsed.apiBasePath &&
        parsed.backendUrl &&
        parsed.appServerUrl &&
        parsed.appApiBasePath
      ) {
        setCfg({
          walletUrl: parsed.walletUrl,
          apiBasePath: parsed.apiBasePath,
          backendUrl: parsed.backendUrl,
          appServerUrl: parsed.appServerUrl,
          appApiBasePath: parsed.appApiBasePath,
          googleClientId: parsed.googleClientId || "",
        });
        logLine("local", "Config loaded from local storage", "info");
      }
    }
    hasLoadedConfig.current = true;
  }, []);

  const registerApp = async () => {
    const act: any = {
      action: actionName,
      validation: validationFormat ? { stringValue: { format: validationFormat } } : undefined,
      write: writeKind === "encrypted" ? { encrypted: writeEncPath } : { plain: writePlainPath },
    };
    if (writeKind === "encrypted" && !encPublicKeyHex) {
      throw new Error("Encryption public key required for encrypted actions");
    }
    const payload: any = {
      appKey,
      accountPrivateKeyPem,
      allowedOrigins: ["*"],
      actions: [act],
      encryptionPublicKeyHex: encPublicKeyHex,
      encryptionPrivateKeyPem: encPrivateKeyPem,
    };
    const res = await getApps().registerApp(payload);
    setOutput(res);
    if ((res as any).token) setAppToken((res as any).token);
    logLine("apps", "App registered", "success");
  };

  const updateSchema = async () => {
    const act: any = {
      action: actionName,
      validation: validationFormat ? { stringValue: { format: validationFormat } } : undefined,
      write: writeKind === "encrypted" ? { encrypted: writeEncPath } : { plain: writePlainPath },
    };
    const res = await getApps().updateSchema(appKey, [act]);
    setOutput(res);
    logLine("apps", "Schema updated", "success");
  };

  const fetchSchema = async () => {
    const res = await getApps().getSchema(appKey);
    setOutput(res);
    logLine("apps", "Schema fetched", "info");
  };

  const createSession = async () => {
    const res = await getApps().createSession(appKey, appToken);
    setAppSession(res.session);
    setOutput(res);
    logLine("apps", "Session created", "success");
  };

  const signup = async (username: string, password: string) => {
    const wallet = getWallet();
    const apps = getApps();
    const s = await wallet.signupWithToken(appToken, { username, password });
    setSession(s);
    apps.setAuthToken(s.token);
    logLine("wallet", "Signup ok", "success");
    setOutput(s);
  };

  const login = async (username: string, password: string) => {
    const wallet = getWallet();
    const appsClient = getApps();
    const s = await wallet.loginWithTokenSession(appToken, appSession, { username, password });
    setSession(s);
    appsClient.setAuthToken(s.token);
    logLine("wallet", "Login ok", "success");
    setOutput(s);
  };

  const googleSignup = async (googleIdToken: string) => {
    const response = await fetch(`${cfg.walletUrl}${cfg.apiBasePath}/auth/google/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: appToken, googleIdToken }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || `Google signup failed: ${response.statusText}`);
    }
    const s = {
      username: data.username,
      token: data.token,
      expiresIn: data.expiresIn,
    };
    setSession(s);
    const appsClient = getApps();
    appsClient.setAuthToken(s.token);
    logLine("wallet", `Google signup ok: ${data.email}`, "success");
    setOutput({ ...s, email: data.email, name: data.name, picture: data.picture });
  };

  const googleLogin = async (googleIdToken: string) => {
    const response = await fetch(`${cfg.walletUrl}${cfg.apiBasePath}/auth/google/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: appToken, session: appSession, googleIdToken }),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || `Google login failed: ${response.statusText}`);
    }
    const s = {
      username: data.username,
      token: data.token,
      expiresIn: data.expiresIn,
    };
    setSession(s);
    const appsClient = getApps();
    appsClient.setAuthToken(s.token);
    logLine("wallet", `Google login ok: ${data.email}`, "success");
    setOutput({ ...s, email: data.email, name: data.name, picture: data.picture });
  };

  const myKeys = async () => {
    if (!session) throw new Error("Session required");
    const wallet = getWallet();
    wallet.setSession(session);
    const k = await wallet.getPublicKeys();
    setOutput(k);
    logLine("wallet", "My keys ok", "info");
  };

  const backendWritePlain = async () => {
    ensureValue(writePayload, "Write payload");
    const backend = getBackend();
    const payload = JSON.parse(writePayload);
    const value = await signPayload(payload);
    const targetUri = resolveUriWithKey(writeUri);
    const r = await backend.write(targetUri, value);
    setOutput(r);
    setLastResolvedUri(targetUri);
    logLine("backend", `Backend write (plain): ${r.success ? "success" : "failed"}`, r.success ? "success" : "warning");
  };

  const backendWriteEnc = async () => {
    ensureValue(writePayload, "Write payload");
    const backend = getBackend();
    const payload = JSON.parse(writePayload);
    const value = await signAndEncryptPayload(payload);
    const targetUri = resolveUriWithKey(writeUri);
    const r = await backend.write(targetUri, value);
    setOutput(r);
    setLastResolvedUri(targetUri);
    logLine("backend", `Backend write (encrypted path): ${r.success ? "success" : "failed"}`, r.success ? "success" : "warning");
  };

  const writePlain = async () => {
    if (!session) throw new Error("Session required");
    const wallet = getWallet();
    wallet.setSession(session);
    ensureValue(writePayload, "Write payload");
    const data = JSON.parse(writePayload);
    const targetUri = resolveUriWithKey(writeUri);
    const r = await wallet.proxyWrite({ uri: targetUri, data, encrypt: false });
    setOutput(r);
    if ((r as any).resolvedUri) setLastResolvedUri((r as any).resolvedUri);
    logLine("wallet", "Write plain ok", "success");
  };

  const writeEnc = async () => {
    if (!session) throw new Error("Session required");
    const wallet = getWallet();
    wallet.setSession(session);
    ensureValue(writePayload, "Write payload");
    const data = JSON.parse(writePayload);
    const targetUri = resolveUriWithKey(writeUri);
    const r = await wallet.proxyWrite({ uri: targetUri, data, encrypt: true });
    setOutput(r);
    if ((r as any).resolvedUri) setLastResolvedUri((r as any).resolvedUri);
    logLine("wallet", "Write enc ok", "success");
  };

  const readLast = async () => {
    const target = lastAppUri || lastResolvedUri || resolveUriWithKey(writeUri);
    const res = lastAppUri ? await getApps().read(appKey, target) : await getBackend().read(target);
    setOutput(res);
    logLine(lastAppUri ? "apps" : "backend", `Read ${res.success ? "ok" : "failed"}`, res.success ? "info" : "warning");
  };

  const testAction = async () => {
    const res = await getApps().invokeAction(appKey, actionName, actionPayload, window.location.origin);
    setOutput(res);
    if (res?.uri) setLastAppUri(res.uri);
    logLine("apps", `Invoked action '${actionName}'`, "info");
  };

  // Google Identity render button
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!cfg.googleClientId) return;
    const initializeGoogleSignIn = () => {
      const googleApi = (window as any).google?.accounts?.id;
      if (!googleApi) {
        setTimeout(initializeGoogleSignIn, 100);
        return;
      }

      googleApi.initialize({
        client_id: cfg.googleClientId,
        callback: (response: { credential: string }) => {
          if (googleMode === "signup") {
            void handleAction("Google signup", () => googleSignup(response.credential));
          } else {
            void handleAction("Google login", () => googleLogin(response.credential));
          }
        },
      });

      if (googleButtonRef.current) {
        googleButtonRef.current.innerHTML = "";
        googleApi.renderButton(googleButtonRef.current, {
          theme: "filled_blue",
          size: "large",
          text: googleMode === "signup" ? "signup_with" : "signin_with",
          width: 280,
        });
      }
    };

    const existingScript = document.getElementById("google-gsi-script");
    if (!existingScript) {
      const script = document.createElement("script");
      script.id = "google-gsi-script";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => initializeGoogleSignIn();
      document.head.appendChild(script);
    } else {
      initializeGoogleSignIn();
    }
  }, [cfg.googleClientId, googleMode]);

  return (
    <div className="h-full overflow-auto custom-scrollbar">
      <div className="p-6 space-y-4">
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            {writerSection === "config" && (
              <ConfigurationSection
                cfg={cfg}
                appKey={appKey}
                encPublicKeyHex={encPublicKeyHex}
                accountPrivateKeyPem={accountPrivateKeyPem}
                encPrivateKeyPem={encPrivateKeyPem}
                setCfg={setCfg}
                updateKeyBundle={updateKeyBundle}
                genAppKeys={() => handleAction("Generate keys", genAppKeys)}
                applyConfig={applyConfig}
                walletHealth={() => handleAction("Wallet health", walletHealth)}
                backendHealth={() => handleAction("Backend health", backendHealth)}
                serverKeys={() => handleAction("Server keys", serverKeys)}
                appsHealth={() => handleAction("Apps health", appsHealth)}
              />
            )}

            {writerSection === "backend" && (
              <BackendSection
                writeUri={writeUri}
                writePayload={writePayload}
                setWriteUri={setWriteUri}
                setWritePayload={setWritePayload}
                backendWritePlain={() => handleAction("Backend write (plain)", backendWritePlain)}
                backendWriteEnc={() => handleAction("Backend write (encrypted)", backendWriteEnc)}
                readLast={() => handleAction("Read last", readLast)}
              />
            )}

            {writerSection === "app" && (
              <AppSection
                appKey={appKey}
                appToken={appToken}
                appSession={appSession}
                actionName={actionName}
                validationFormat={validationFormat}
                writeKind={writeKind}
                writePlainPath={writePlainPath}
                writeEncPath={writeEncPath}
                actionPayload={actionPayload}
                setAppKey={setAppKey}
                setAppToken={setAppToken}
                setAppSession={setAppSession}
                setActionName={setActionName}
                setValidationFormat={setValidationFormat}
                setWriteKind={setWriteKind}
                setWritePlainPath={setWritePlainPath}
                setWriteEncPath={setWriteEncPath}
                setActionPayload={setActionPayload}
                registerApp={() => handleAction("Register app", registerApp)}
                createSession={() => handleAction("Create session", createSession)}
                fetchSchema={() => handleAction("Fetch schema", fetchSchema)}
                updateSchema={() => handleAction("Update schema", updateSchema)}
                testAction={() => handleAction("Invoke action", testAction)}
              />
            )}

            {writerSection === "auth" && (
              <AuthSection
                writeUri={writeUri}
                setWriteUri={setWriteUri}
                writePayload={writePayload}
                setWritePayload={setWritePayload}
                signup={(u, p) => handleAction("Signup", () => signup(u, p))}
                login={(u, p) => handleAction("Login", () => login(u, p))}
                myKeys={() => handleAction("My keys", myKeys)}
                writePlain={() => handleAction("Proxy write plain", writePlain)}
                writeEnc={() => handleAction("Proxy write encrypted", writeEnc)}
                googleClientId={cfg.googleClientId}
                googleMode={googleMode}
                setGoogleMode={setGoogleMode}
                googleButtonRef={googleButtonRef}
              />
            )}
          </div>

          <div className="space-y-4">
            <OutputPanel output={output} />
            <StatePanel
              appKey={appKey}
              appToken={appToken}
              appSession={appSession}
              session={session}
              lastResolvedUri={lastResolvedUri}
              lastAppUri={lastAppUri}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionCard({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="border border-border rounded-xl bg-card shadow-sm">
      <div className="px-4 py-3 border-b border-border flex items-center space-x-2">
        {icon}
        <h3 className="font-semibold">{title}</h3>
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </section>
  );
}

function ConfigurationSection(props: {
  cfg: Config;
  setCfg: (cfg: Config) => void;
  appKey: string;
  encPublicKeyHex: string;
  accountPrivateKeyPem: string;
  encPrivateKeyPem: string;
  updateKeyBundle: (patch: Partial<KeyBundle>) => void;
  genAppKeys: () => void;
  applyConfig: () => void;
  walletHealth: () => void;
  backendHealth: () => void;
  serverKeys: () => void;
  appsHealth: () => void;
}) {
  const { cfg, setCfg, appKey, encPublicKeyHex, accountPrivateKeyPem, encPrivateKeyPem } = props;
  return (
    <SectionCard title="Configuration" icon={<Settings className="h-4 w-4" />}>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">App Public Key (hex)</label>
          <input
            value={appKey}
            onChange={(e) => props.updateKeyBundle({ appKey: e.target.value })}
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            placeholder="hex"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Encryption Public Key (X25519, hex)</label>
          <input
            value={encPublicKeyHex}
            onChange={(e) => props.updateKeyBundle({ encryptionPublicKeyHex: e.target.value })}
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            placeholder="hex"
          />
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Account Private Key (PEM)</label>
          <textarea
            value={accountPrivateKeyPem}
            onChange={(e) => props.updateKeyBundle({ accountPrivateKeyPem: e.target.value })}
            className="w-full min-h-[120px] rounded border border-border bg-background px-3 py-2 text-sm"
            placeholder="-----BEGIN PRIVATE KEY-----"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Encryption Private Key (PEM)</label>
          <textarea
            value={encPrivateKeyPem}
            onChange={(e) => props.updateKeyBundle({ encryptionPrivateKeyPem: e.target.value })}
            className="w-full min-h-[120px] rounded border border-border bg-background px-3 py-2 text-sm"
            placeholder="-----BEGIN PRIVATE KEY-----"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={props.genAppKeys} className={PRIMARY_BUTTON}>
          Generate Keys
        </button>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Backend URL</label>
          <input
            value={cfg.backendUrl}
            onChange={(e) => setCfg({ ...cfg, backendUrl: e.target.value })}
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            placeholder="http://localhost:8080"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Wallet URL</label>
          <input
            value={cfg.walletUrl}
            onChange={(e) => setCfg({ ...cfg, walletUrl: e.target.value })}
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            placeholder="http://localhost:3001"
          />
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">API Base Path</label>
          <input
            value={cfg.apiBasePath}
            onChange={(e) => setCfg({ ...cfg, apiBasePath: e.target.value })}
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            placeholder="/api/v1"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">App Server URL</label>
          <input
            value={cfg.appServerUrl}
            onChange={(e) => setCfg({ ...cfg, appServerUrl: e.target.value })}
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            placeholder="http://localhost:3003"
          />
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">App API Base Path</label>
          <input
            value={cfg.appApiBasePath}
            onChange={(e) => setCfg({ ...cfg, appApiBasePath: e.target.value })}
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            placeholder="/api/v1"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Google Client ID</label>
          <input
            value={cfg.googleClientId}
            onChange={(e) => setCfg({ ...cfg, googleClientId: e.target.value })}
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            placeholder="your-client-id.apps.googleusercontent.com"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={props.applyConfig} className={PRIMARY_BUTTON}>
          Apply Config
        </button>
        <button onClick={props.walletHealth} className={SECONDARY_BUTTON}>
          Wallet Health
        </button>
        <button onClick={props.backendHealth} className={SECONDARY_BUTTON}>
          Backend Health
        </button>
        <button onClick={props.appsHealth} className={SECONDARY_BUTTON}>
          App Server Health
        </button>
        <button onClick={props.serverKeys} className={SECONDARY_BUTTON}>
          Server Keys
        </button>
      </div>
    </SectionCard>
  );
}

function BackendSection(props: {
  writeUri: string;
  setWriteUri: (v: string) => void;
  writePayload: string;
  setWritePayload: (v: string) => void;
  backendWritePlain: () => void;
  backendWriteEnc: () => void;
  readLast: () => void;
}) {
  return (
    <SectionCard title="Backend" icon={<Server className="h-4 w-4" />}>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">URI</label>
          <input
            value={props.writeUri}
            onChange={(e) => props.setWriteUri(e.target.value)}
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            placeholder="mutable://accounts/:key/profile"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Payload (JSON)</label>
          <textarea
            value={props.writePayload}
            onChange={(e) => props.setWritePayload(e.target.value)}
            className="w-full min-h-[120px] rounded border border-border bg-background px-3 py-2 text-sm"
            placeholder='{"name":"Test User","timestamp":""}'
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={props.backendWritePlain} className={PRIMARY_BUTTON}>
          Write Plain
        </button>
        <button onClick={props.backendWriteEnc} className={SECONDARY_BUTTON}>
          Write Encrypted
        </button>
        <button onClick={props.readLast} className={SECONDARY_BUTTON}>
          Read Last
        </button>
      </div>
    </SectionCard>
  );
}

function AppSection(props: {
  appKey: string;
  setAppKey: (v: string) => void;
  appToken: string;
  setAppToken: (v: string) => void;
  appSession: string;
  setAppSession: (v: string) => void;
  actionName: string;
  setActionName: (v: string) => void;
  validationFormat: "email" | "";
  setValidationFormat: (v: "email" | "") => void;
  writeKind: "plain" | "encrypted";
  setWriteKind: (v: "plain" | "encrypted") => void;
  writePlainPath: string;
  setWritePlainPath: (v: string) => void;
  writeEncPath: string;
  setWriteEncPath: (v: string) => void;
  actionPayload: string;
  setActionPayload: (v: string) => void;
  registerApp: () => void;
  createSession: () => void;
  fetchSchema: () => void;
  updateSchema: () => void;
  testAction: () => void;
}) {
  return (
    <SectionCard title="App" icon={<Activity className="h-4 w-4" />}>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">App Public Key (hex)</label>
          <input
            value={props.appKey}
            onChange={(e) => props.setAppKey(e.target.value)}
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            placeholder="hex"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">App Token</label>
          <input
            value={props.appToken}
            onChange={(e) => props.setAppToken(e.target.value)}
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={props.registerApp} className={PRIMARY_BUTTON}>
          Register App
        </button>
        <button onClick={props.createSession} className={SECONDARY_BUTTON}>
          Create Session
        </button>
        <button onClick={props.fetchSchema} className={SECONDARY_BUTTON}>
          Fetch Schema
        </button>
      </div>
      <div className="space-y-2">
        <label className="text-sm text-muted-foreground">Session Key</label>
        <input
          value={props.appSession}
          onChange={(e) => props.setAppSession(e.target.value)}
          className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
        />
      </div>
      <hr className="border-border" />
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Action Name</label>
          <input
            value={props.actionName}
            onChange={(e) => props.setActionName(e.target.value)}
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Validation Format</label>
          <select
            value={props.validationFormat}
            onChange={(e) => props.setValidationFormat(e.target.value as "email" | "")}
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">None</option>
            <option value="email">email</option>
          </select>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Write Type</label>
          <select
            value={props.writeKind}
            onChange={(e) => props.setWriteKind(e.target.value as "plain" | "encrypted")}
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="plain">plain</option>
            <option value="encrypted">encrypted</option>
          </select>
        </div>
        {props.writeKind === "plain" ? (
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Plain Path</label>
            <input
              value={props.writePlainPath}
              onChange={(e) => props.setWritePlainPath(e.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              placeholder="mutable://accounts/:key/subscribers/updates/:signature"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Encrypted Path</label>
            <input
              value={props.writeEncPath}
              onChange={(e) => props.setWriteEncPath(e.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              placeholder="immutable://accounts/:key/subscribers/updates/:signature"
            />
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={props.updateSchema} className={SECONDARY_BUTTON}>
          Update Schema
        </button>
      </div>
      <hr className="border-border" />
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Action</label>
          <input
            value={props.actionName}
            onChange={(e) => props.setActionName(e.target.value)}
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Test Payload (string)</label>
          <input
            value={props.actionPayload}
            onChange={(e) => props.setActionPayload(e.target.value)}
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={props.testAction} className={PRIMARY_BUTTON}>
          Invoke Action
        </button>
      </div>
    </SectionCard>
  );
}

function AuthSection(props: {
  writeUri: string;
  setWriteUri: (v: string) => void;
  writePayload: string;
  setWritePayload: (v: string) => void;
  signup: (u: string, p: string) => void;
  login: (u: string, p: string) => void;
  myKeys: () => void;
  writePlain: () => void;
  writeEnc: () => void;
  googleClientId: string;
  googleMode: "signup" | "login";
  setGoogleMode: (mode: "signup" | "login") => void;
  googleButtonRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <SectionCard title="Auth" icon={<ShieldCheck className="h-4 w-4" />}>
      <AuthForm
        onSignup={props.signup}
        onLogin={props.login}
        googleClientId={props.googleClientId}
        googleMode={props.googleMode}
        setGoogleMode={props.setGoogleMode}
        googleButtonRef={props.googleButtonRef}
      />
      <div className="flex flex-wrap gap-2">
        <button onClick={props.myKeys} className={SECONDARY_BUTTON}>
          My Keys
        </button>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">URI</label>
          <input
            value={props.writeUri}
            onChange={(e) => props.setWriteUri(e.target.value)}
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Payload (JSON)</label>
          <textarea
            value={props.writePayload}
            onChange={(e) => props.setWritePayload(e.target.value)}
            className="w-full min-h-[120px] rounded border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={props.writePlain} className={PRIMARY_BUTTON}>
          Proxy Write Plain
        </button>
        <button onClick={props.writeEnc} className={SECONDARY_BUTTON}>
          Proxy Write Encrypted
        </button>
      </div>
    </SectionCard>
  );
}

function OutputPanel({ output }: { output: any }) {
  return (
    <section className="border border-border rounded-xl bg-card shadow-sm">
      <div className="px-4 py-3 border-b border-border flex items-center space-x-2">
        <Play className="h-4 w-4" />
        <h3 className="font-semibold">Output</h3>
      </div>
      <div className="p-4">
        <pre className="bg-muted rounded p-3 text-xs font-mono max-h-[420px] overflow-auto custom-scrollbar">
          {output ? JSON.stringify(output, null, 2) : "No output yet"}
        </pre>
      </div>
    </section>
  );
}

function StatePanel({
  appKey,
  appToken,
  appSession,
  session,
  lastResolvedUri,
  lastAppUri,
}: {
  appKey: string;
  appToken: string;
  appSession: string;
  session: { username: string; token: string; expiresIn: number } | null;
  lastResolvedUri: string | null;
  lastAppUri: string | null;
}) {
  return (
    <section className="border border-border rounded-xl bg-card shadow-sm">
      <div className="px-4 py-3 border-b border-border flex items-center space-x-2">
        <KeyRound className="h-4 w-4" />
        <h3 className="font-semibold">State</h3>
      </div>
      <div className="p-4 space-y-2 text-sm">
        <StateRow label="App Key" value={appKey} />
        <StateRow label="App Token" value={appToken} />
        <StateRow label="App Session" value={appSession} />
        <StateRow label="User" value={session?.username || "-"} />
        <StateRow label="Authenticated" value={session ? "yes" : "no"} />
        <StateRow label="Login Session (JWT)" value={session?.token || "-"} />
        <StateRow label="Expires In" value={session?.expiresIn?.toString() || "-"} />
        <StateRow label="Last URI" value={lastResolvedUri || "-"} />
        <StateRow label="Last App URI" value={lastAppUri || "-"} />
      </div>
    </section>
  );
}

function StateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-mono text-xs text-right truncate max-w-[180px]">{value || "-"}</span>
    </div>
  );
}

function AuthForm({
  onSignup,
  onLogin,
  googleClientId,
  googleMode,
  setGoogleMode,
  googleButtonRef,
}: {
  onSignup: (u: string, p: string) => void;
  onLogin: (u: string, p: string) => void;
  googleClientId: string;
  googleMode: "signup" | "login";
  setGoogleMode: (mode: "signup" | "login") => void;
  googleButtonRef: RefObject<HTMLDivElement | null>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-3">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
        />
        <input
          value={password}
          type="password"
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => onSignup(username, password)} className={PRIMARY_BUTTON}>
          Signup
        </button>
        <button onClick={() => onLogin(username, password)} className={SECONDARY_BUTTON}>
          Login
        </button>
      </div>

      {googleClientId && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Wand2 className="h-4 w-4" />
            <span>Google Sign-In</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">Google mode:</label>
            <select
              value={googleMode}
              onChange={(e) => setGoogleMode(e.target.value as "signup" | "login")}
              className="rounded border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="signup">Sign Up</option>
              <option value="login">Login</option>
            </select>
          </div>
          <div ref={googleButtonRef} />
        </div>
      )}
    </div>
  );
}
