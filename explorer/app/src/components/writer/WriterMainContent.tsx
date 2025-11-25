import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { WalletClient } from "@bandeira-tech/b3nd-web/wallet";
import { HttpClient } from "@bandeira-tech/b3nd-web";
import { AppsClient } from "@bandeira-tech/b3nd-web/apps";
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";
import { Activity, KeyRound, ShieldCheck, Server, Play, Wand2, PanelRightOpen, ChevronRight, PenSquare } from "lucide-react";
import { useAppStore, useActiveBackend } from "../../stores/appStore";
import type { AppLogEntry, KeyBundle } from "../../types";
import { HttpAdapter } from "../../adapters/HttpAdapter";

const PRIMARY_BUTTON =
  "inline-flex items-center justify-center rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const SECONDARY_BUTTON =
  "inline-flex items-center justify-center rounded border border-border bg-muted px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const DEFAULT_API_BASE_PATH = "/api/v1";

export function WriterMainContent() {
  const {
    writerSection,
    addLogEntry,
    keyBundle,
    setKeyBundle,
    googleClientId,
    setGoogleClientId,
    walletServers,
    activeWalletServerId,
    appServers,
    activeAppServerId,
    panels,
    setFormValue,
    getFormValue,
  } = useAppStore();
  const activeWallet = walletServers.find((w) => w.id === activeWalletServerId && w.isActive);
  const activeAppServer = appServers.find((w) => w.id === activeAppServerId && w.isActive);
  const activeBackend = useActiveBackend();

  const [session, setSession] = useState<{ username: string; token: string; expiresIn: number } | null>(null);
  const [appToken, setAppToken] = useState("");
  const [appSession, setAppSession] = useState("");
  const [output, setOutput] = useState<any>(null);
  const [lastResolvedUri, setLastResolvedUri] = useState<string | null>(null);
  const [lastAppUri, setLastAppUri] = useState<string | null>(null);
  const FORM_BACKEND = "writer-backend";
  const FORM_APP = "writer-app";
  const FORM_AUTH = "writer-auth";
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const [googleMode, setGoogleMode] = useState<"signup" | "login">("signup");

  const { appKey, accountPrivateKeyPem, encryptionPublicKeyHex, encryptionPrivateKeyPem } = keyBundle;
  const actionName = getFormValue(FORM_APP, "actionName", "registerForReceiveUpdates") as string;
  const validationFormat = (getFormValue(FORM_APP, "validationFormat") as "email" | "") || "";
  const writeKind = (getFormValue(FORM_APP, "writeKind", "plain") as "plain" | "encrypted") || "plain";
  const actionPayload = getFormValue(FORM_APP, "actionPayload", "");
  const writePlainPath = getFormValue(FORM_APP, "writePlainPath", "");
  const writeEncPath = getFormValue(FORM_APP, "writeEncPath", "");
  const writeUri = getFormValue(FORM_BACKEND, "writeUri", "");
  const writePayload = getFormValue(FORM_BACKEND, "writePayload", "");
  const authWriteUri = getFormValue(FORM_AUTH, "writeUri", "");
  const authWritePayload = getFormValue(FORM_AUTH, "writePayload", "");
  const setValidationFormat = (v: "email" | "") => setFormValue(FORM_APP, "validationFormat", v);
  const setWriteKind = (v: "plain" | "encrypted") => setFormValue(FORM_APP, "writeKind", v);
  const setWritePlainPath = (v: string) => setFormValue(FORM_APP, "writePlainPath", v);
  const setWriteEncPath = (v: string) => setFormValue(FORM_APP, "writeEncPath", v);

  const logLine = (source: string, message: string, level: AppLogEntry["level"] = "info") => {
    addLogEntry({ source, message, level });
  };

  const getWallet = () => {
    if (!activeWallet) {
      throw new Error("Active wallet server is required");
    }
    return new WalletClient({
      walletServerUrl: activeWallet.url.replace(/\/$/, ""),
      apiBasePath: DEFAULT_API_BASE_PATH,
    });
  };

  const getBackendClient = () => {
    if (!activeBackend?.adapter || !(activeBackend.adapter instanceof HttpAdapter)) {
      throw new Error("Active backend with HTTP adapter is required");
    }
    if (!activeBackend.adapter.baseUrl) {
      throw new Error("Active backend URL is required");
    }
    return new HttpClient({ url: activeBackend.adapter.baseUrl.replace(/\/$/, "") });
  };

  const getApps = () => {
    if (!activeAppServer) {
      throw new Error("Active app server is required");
    }
    return new AppsClient({
      appServerUrl: activeAppServer.url.replace(/\/$/, ""),
      apiBasePath: DEFAULT_API_BASE_PATH,
    });
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
    ensureValue(encryptionPublicKeyHex, "Encryption public key");
    const privateKey = await loadSigningKey();
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

  const resolveUriWithKey = (uri: string) => {
    if (uri.includes(":key")) {
      ensureValue(appKey, "App key");
      return uri.replace(/:key/g, appKey);
    }
    return uri;
  };

  const handleAction = async (label: string, action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOutput({ error: message });
      logLine("local", `${label} failed: ${message}`, "error");
    }
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

    const encKp = (await crypto.subtle.generateKey(
      { name: "X25519", namedCurve: "X25519" } as unknown as EcKeyGenParams,
      true,
      ["deriveBits"],
    )) as CryptoKeyPair;
    const encPubRaw = await crypto.subtle.exportKey("raw", encKp.publicKey);
    const encPubHex = Array.from(new Uint8Array(encPubRaw))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const encPrivPkcs8 = await crypto.subtle.exportKey("pkcs8", encKp.privateKey);
    const encPrivB64 = btoa(String.fromCharCode(...new Uint8Array(encPrivPkcs8)));
    const encPrivPem = `-----BEGIN PRIVATE KEY-----\n${(encPrivB64.match(/.{1,64}/g) || []).join("\n")}\n-----END PRIVATE KEY-----`;

    setKeyBundle({
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

  const registerApp = async () => {
    const act: any = {
      action: actionName,
      validation: validationFormat ? { stringValue: { format: validationFormat } } : undefined,
      write: writeKind === "encrypted" ? { encrypted: writeEncPath } : { plain: writePlainPath },
    };
    if (writeKind === "encrypted" && !encryptionPublicKeyHex) {
      throw new Error("Encryption public key required for encrypted actions");
    }
    const payload: any = {
      appKey,
      accountPrivateKeyPem,
      allowedOrigins: ["*"],
      actions: [act],
      encryptionPublicKeyHex,
      encryptionPrivateKeyPem,
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
    const apps = getApps();
    const s = await wallet.loginWithTokenSession(appToken, appSession, { username, password });
    setSession(s);
    apps.setAuthToken(s.token);
    logLine("wallet", "Login ok", "success");
    setOutput(s);
  };

  const googleSignup = async (googleIdToken: string) => {
    if (!activeWallet) throw new Error("Active wallet server is required");
    const response = await fetch(`${activeWallet.url.replace(/\/$/, "")}${DEFAULT_API_BASE_PATH}/auth/google/signup`, {
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
    getApps().setAuthToken(s.token);
    logLine("wallet", `Google signup ok: ${data.email}`, "success");
    setOutput({ ...s, email: data.email, name: data.name, picture: data.picture });
  };

  const googleLogin = async (googleIdToken: string) => {
    if (!activeWallet) throw new Error("Active wallet server is required");
    const response = await fetch(`${activeWallet.url.replace(/\/$/, "")}${DEFAULT_API_BASE_PATH}/auth/google/login`, {
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
    getApps().setAuthToken(s.token);
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
    const payload = JSON.parse(writePayload);
    const value = await signPayload(payload);
    const targetUri = resolveUriWithKey(writeUri);
    const r = await getBackendClient().write(targetUri, value);
    setOutput(r);
    setLastResolvedUri(targetUri);
    logLine("backend", `Backend write (plain): ${r.success ? "success" : "failed"}`, r.success ? "success" : "warning");
  };

  const backendWriteEnc = async () => {
    ensureValue(writePayload, "Write payload");
    const payload = JSON.parse(writePayload);
    const value = await signAndEncryptPayload(payload);
    const targetUri = resolveUriWithKey(writeUri);
    const r = await getBackendClient().write(targetUri, value);
    setOutput(r);
    setLastResolvedUri(targetUri);
    logLine("backend", `Backend write (encrypted path): ${r.success ? "success" : "failed"}`, r.success ? "success" : "warning");
  };

  const writePlain = async () => {
    if (!session) throw new Error("Session required");
    const wallet = getWallet();
    wallet.setSession(session);
    ensureValue(authWritePayload, "Write payload");
    const data = JSON.parse(authWritePayload);
    const targetUri = resolveUriWithKey(authWriteUri);
    const r = await wallet.proxyWrite({ uri: targetUri, data, encrypt: false });
    setOutput(r);
    if ((r as any).resolvedUri) setLastResolvedUri((r as any).resolvedUri);
    logLine("wallet", "Write plain ok", "success");
  };

  const writeEnc = async () => {
    if (!session) throw new Error("Session required");
    const wallet = getWallet();
    wallet.setSession(session);
    ensureValue(authWritePayload, "Write payload");
    const data = JSON.parse(authWritePayload);
    const targetUri = resolveUriWithKey(authWriteUri);
    const r = await wallet.proxyWrite({ uri: targetUri, data, encrypt: true });
    setOutput(r);
    if ((r as any).resolvedUri) setLastResolvedUri((r as any).resolvedUri);
    logLine("wallet", "Write enc ok", "success");
  };

  const readLast = async () => {
    const target = lastAppUri || lastResolvedUri || resolveUriWithKey(writeUri);
    const res = lastAppUri ? await getApps().read(appKey, target) : await getBackendClient().read(target);
    setOutput(res);
    logLine(lastAppUri ? "apps" : "backend", `Read ${res.success ? "ok" : "failed"}`, res.success ? "info" : "warning");
  };

  const testAction = async () => {
    const res = await getApps().invokeAction(appKey, actionName, actionPayload, window.location.origin);
    setOutput(res);
    if (res?.uri) setLastAppUri(res.uri);
    logLine("apps", `Invoked action '${actionName}'`, "info");
  };

  useEffect(() => {
    if (!googleClientId) return;
    const initializeGoogleSignIn = () => {
      const googleApi = (window as any).google?.accounts?.id;
      if (!googleApi) {
        setTimeout(initializeGoogleSignIn, 100);
        return;
      }

      googleApi.initialize({
        client_id: googleClientId,
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
  }, [googleClientId, googleMode]);

  const rightOpen = panels.right;

  return (
    <div className="h-full flex overflow-hidden bg-background text-foreground">
      <div className="flex-1 overflow-auto custom-scrollbar">
        <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-muted/30">
          <WriterBreadcrumb writerSection={writerSection} />
        </div>
        <div className="p-6 space-y-4 max-w-6xl mx-auto">
          {writerSection === "backend" && (
            <BackendSection
              formId={FORM_BACKEND}
              backendWritePlain={() => handleAction("Backend write (plain)", backendWritePlain)}
              backendWriteEnc={() => handleAction("Backend write (encrypted)", backendWriteEnc)}
              readLast={() => handleAction("Read last", readLast)}
            />
          )}

          {writerSection === "app" && (
            <div className="space-y-4">
              <AppCredentialsCard
                appKey={appKey}
                appToken={appToken}
                setKeyBundle={(patch) => setKeyBundle({ ...keyBundle, ...patch })}
                setAppToken={setAppToken}
                registerApp={() => handleAction("Register app", registerApp)}
                fetchSchema={() => handleAction("Fetch schema", fetchSchema)}
              />
              <SessionCard
                appSession={appSession}
                setAppSession={setAppSession}
                createSession={() => handleAction("Create session", createSession)}
              />
              <ActionRegistryCard
                formId={FORM_APP}
                actionName={actionName}
                validationFormat={validationFormat}
                setValidationFormat={setValidationFormat}
                writeKind={writeKind}
                setWriteKind={setWriteKind}
                writePlainPath={writePlainPath}
                setWritePlainPath={setWritePlainPath}
                writeEncPath={writeEncPath}
                setWriteEncPath={setWriteEncPath}
                updateSchema={() => handleAction("Update schema", updateSchema)}
              />
              <InvokeActionCard
                formId={FORM_APP}
                actionName={actionName}
                actionPayload={actionPayload}
                testAction={() => handleAction("Invoke action", testAction)}
              />
              <KeysCard
                encryptionPublicKeyHex={encryptionPublicKeyHex}
                encryptionPrivateKeyPem={encryptionPrivateKeyPem}
                accountPrivateKeyPem={accountPrivateKeyPem}
                setKeyBundle={(patch) => setKeyBundle({ ...keyBundle, ...patch })}
                genAppKeys={() => handleAction("Generate keys", genAppKeys)}
              />
              <MiscCard
                googleClientId={googleClientId}
                setGoogleClientId={setGoogleClientId}
              />
            </div>
          )}

          {writerSection === "auth" && (
            <AuthSection
              formId={FORM_AUTH}
              signup={(u, p) => handleAction("Signup", () => signup(u, p))}
              login={(u, p) => handleAction("Login", () => login(u, p))}
              myKeys={() => handleAction("My keys", myKeys)}
              writePlain={() => handleAction("Proxy write plain", writePlain)}
              writeEnc={() => handleAction("Proxy write encrypted", writeEnc)}
              googleClientId={googleClientId}
              googleMode={googleMode}
              setGoogleMode={setGoogleMode}
              googleButtonRef={googleButtonRef}
            />
          )}
        </div>
      </div>

      {rightOpen && (
        <aside className="w-96 border-l border-border bg-card flex flex-col">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <PanelRightOpen className="h-4 w-4" />
            <span className="text-sm font-semibold">Output & State</span>
          </div>
          <div className="flex-1 overflow-auto custom-scrollbar p-4 space-y-4">
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
        </aside>
      )}
    </div>
  );
}

function WriterBreadcrumb({ writerSection }: { writerSection: "backend" | "app" | "auth" }) {
  const labels: Record<"backend" | "app" | "auth", string> = {
    backend: "Backend",
    app: "App",
    auth: "Auth",
  };

  return (
    <nav className="flex items-center space-x-2 text-sm">
      <div className="flex items-center space-x-2">
        <PenSquare className="h-4 w-4 text-muted-foreground" />
        <span className="px-2 py-1 rounded hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-ring">
          Writer
        </span>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
      <span className="text-foreground font-medium">{labels[writerSection]}</span>
    </nav>
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

function BackendSection(props: {
  formId: string;
  backendWritePlain: () => void;
  backendWriteEnc: () => void;
  readLast: () => void;
}) {
  return (
    <SectionCard title="Backend" icon={<Server className="h-4 w-4" />}>
      <Field
        label="URI"
        formId={props.formId}
        name="writeUri"
        placeholder="mutable://accounts/:key/profile"
      />
      <TextArea
        label="Payload (JSON)"
        formId={props.formId}
        name="writePayload"
        placeholder='{"name":"Test User","timestamp":""}'
      />
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

function AppCredentialsCard(props: {
  appKey: string;
  appToken: string;
  setKeyBundle: (bundle: Partial<KeyBundle>) => void;
  setAppToken: (v: string) => void;
  registerApp: () => void;
  fetchSchema: () => void;
}) {
  return (
    <SectionCard title="App Credentials" icon={<Activity className="h-4 w-4" />}>
      <div className="grid md:grid-cols-2 gap-4">
        <Field
          label="App Public Key (hex)"
          value={props.appKey}
          onChange={(v) => props.setKeyBundle({ appKey: v })}
          placeholder="hex"
        />
        <Field label="App Token" value={props.appToken} onChange={props.setAppToken} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={props.registerApp} className={PRIMARY_BUTTON}>
          Register App
        </button>
        <button onClick={props.fetchSchema} className={SECONDARY_BUTTON}>
          Fetch Schema
        </button>
      </div>
    </SectionCard>
  );
}

function SessionCard(props: {
  appSession: string;
  setAppSession: (v: string) => void;
  createSession: () => void;
}) {
  return (
    <SectionCard title="Session" icon={<KeyRound className="h-4 w-4" />}>
      <Field label="Session Key" value={props.appSession} onChange={props.setAppSession} />
      <div className="flex flex-wrap gap-2">
        <button onClick={props.createSession} className={SECONDARY_BUTTON}>
          Create Session
        </button>
      </div>
    </SectionCard>
  );
}

function ActionRegistryCard(props: {
  formId: string;
  actionName: string;
  validationFormat: "email" | "";
  setValidationFormat: (v: "email" | "") => void;
  writeKind: "plain" | "encrypted";
  setWriteKind: (v: "plain" | "encrypted") => void;
  writePlainPath: string;
  setWritePlainPath: (v: string) => void;
  writeEncPath: string;
  setWriteEncPath: (v: string) => void;
  updateSchema: () => void;
}) {
  return (
    <SectionCard title="Actions Registry & Schema" icon={<Activity className="h-4 w-4" />}>
      <div className="grid md:grid-cols-2 gap-4">
        <Field
          label="Action Name"
          formId={props.formId}
          name="actionName"
          defaultValue="registerForReceiveUpdates"
          value={props.actionName}
        />
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
          <Field
            label="Plain Path"
            value={props.writePlainPath}
            onChange={props.setWritePlainPath}
            placeholder="mutable://accounts/:key/subscribers/updates/:signature"
          />
        ) : (
          <Field
            label="Encrypted Path"
            value={props.writeEncPath}
            onChange={props.setWriteEncPath}
            placeholder="immutable://accounts/:key/subscribers/updates/:signature"
          />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={props.updateSchema} className={SECONDARY_BUTTON}>
          Update Schema
        </button>
      </div>
    </SectionCard>
  );
}

function InvokeActionCard(props: {
  formId: string;
  actionName: string;
  actionPayload: string;
  testAction: () => void;
}) {
  return (
    <SectionCard title="Invoke Action" icon={<Activity className="h-4 w-4" />}>
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Action" formId={props.formId} name="actionName" defaultValue="registerForReceiveUpdates" value={props.actionName} />
        <Field label="Test Payload (string)" formId={props.formId} name="actionPayload" value={props.actionPayload} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={props.testAction} className={PRIMARY_BUTTON}>
          Invoke Action
        </button>
      </div>
    </SectionCard>
  );
}

function KeysCard(props: {
  encryptionPublicKeyHex: string;
  encryptionPrivateKeyPem: string;
  accountPrivateKeyPem: string;
  setKeyBundle: (bundle: Partial<KeyBundle>) => void;
  genAppKeys: () => void;
}) {
  return (
    <SectionCard title="Keys" icon={<KeyRound className="h-4 w-4" />}>
      <div className="grid md:grid-cols-2 gap-4">
        <Field
          label="Encryption Public Key (X25519, hex)"
          value={props.encryptionPublicKeyHex}
          onChange={(v) => props.setKeyBundle({ encryptionPublicKeyHex: v })}
          placeholder="hex"
        />
        <TextArea
          label="Encryption Private Key (PEM)"
          value={props.encryptionPrivateKeyPem}
          onChange={(v) => props.setKeyBundle({ encryptionPrivateKeyPem: v })}
          placeholder="-----BEGIN PRIVATE KEY-----"
        />
      </div>
      <TextArea
        label="Account Private Key (PEM)"
        value={props.accountPrivateKeyPem}
        onChange={(v) => props.setKeyBundle({ accountPrivateKeyPem: v })}
        placeholder="-----BEGIN PRIVATE KEY-----"
      />
      <div className="flex flex-wrap gap-2">
        <button onClick={props.genAppKeys} className={SECONDARY_BUTTON}>
          Generate Keys
        </button>
      </div>
    </SectionCard>
  );
}

function MiscCard(props: { googleClientId: string; setGoogleClientId: (v: string) => void }) {
  return (
    <SectionCard title="Misc" icon={<Activity className="h-4 w-4" />}>
      <Field
        label="Google Client ID"
        value={props.googleClientId}
        onChange={props.setGoogleClientId}
        placeholder="your-client-id.apps.googleusercontent.com"
      />
    </SectionCard>
  );
}

function AuthSection(props: {
  formId: string;
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
        <Field label="URI" formId={props.formId} name="writeUri" placeholder="mutable://accounts/:key/profile" />
        <TextArea label="Payload (JSON)" formId={props.formId} name="writePayload" placeholder='{"name":"Test User"}' />
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

function Field({
  label,
  value,
  onChange,
  placeholder,
  formId,
  name,
  defaultValue = "",
}: {
  label: string;
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  formId?: string;
  name?: string;
  defaultValue?: string;
}) {
  const { getFormValue, setFormValue } = useAppStore();
  const isBound = formId && name;
  const resolvedValue = isBound
    ? getFormValue(formId as string, name as string, defaultValue)
    : value ?? "";

  const handleChange = (next: string) => {
    if (isBound) setFormValue(formId as string, name as string, next);
    if (onChange) onChange(next);
  };

  return (
    <div className="space-y-2">
      <label className="text-sm text-muted-foreground">{label}</label>
      <input
        value={resolvedValue}
        onChange={(e) => handleChange(e.target.value)}
        className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
        placeholder={placeholder}
      />
    </div>
  );
}

function TextArea({
  label,
  value,
  onChange,
  formId,
  name,
  defaultValue = "",
  placeholder = "",
}: {
  label: string;
  value?: string;
  onChange?: (v: string) => void;
  formId?: string;
  name?: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  const { getFormValue, setFormValue } = useAppStore();
  const isBound = formId && name;
  const resolvedValue = isBound
    ? getFormValue(formId as string, name as string, defaultValue)
    : value ?? "";

  const handleChange = (next: string) => {
    if (isBound) setFormValue(formId as string, name as string, next);
    if (onChange) onChange(next);
  };

  return (
    <div className="space-y-2">
      <label className="text-sm text-muted-foreground">{label}</label>
      <textarea
        value={resolvedValue}
        onChange={(e) => handleChange(e.target.value)}
        className="w-full min-h-[120px] rounded border border-border bg-background px-3 py-2 text-sm"
        placeholder={placeholder}
      />
    </div>
  );
}
