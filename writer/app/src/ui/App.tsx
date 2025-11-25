import React, { useEffect, useMemo, useState } from "react";
import { WalletClient } from "@bandeira-tech/b3nd-web/wallet";
import { HttpClient } from "@bandeira-tech/b3nd-web";
import { AppsClient } from "@bandeira-tech/b3nd-web/apps";
import * as encrypt from "@bandeira-tech/b3nd-web/encrypt";

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

export function App() {
  const [cfg, setCfg] = useState<Config>({
    walletUrl: "http://localhost:3001",
    apiBasePath: "/api/v1",
    backendUrl: "http://localhost:8080",
    appServerUrl: "http://localhost:3003",
    appApiBasePath: "/api/v1",
    googleClientId: "", // Set your Google OAuth Client ID here
  });
  const [session, setSession] = useState<
    { username: string; token: string; expiresIn: number } | null
  >(null);
  const [appKey, setAppKey] = useState("");
  const [appToken, setAppToken] = useState("");
  const [accountPrivateKeyPem, setAccountPrivateKeyPem] = useState("");
  const [appSession, setAppSession] = useState("");
  const [writeUri, setWriteUri] = useState("mutable://accounts/:key/profile");
  const [writePayload, setWritePayload] = useState(
    '{"name":"Test User","timestamp":""}',
  );
  const [output, setOutput] = useState<any>(null);
  const [log, setLog] = useState<string[]>([]);
  const [section, setSection] = useState<"config" | "backend" | "app" | "auth">(
    "config",
  );
  const [lastResolvedUri, setLastResolvedUri] = useState<string | null>(null);
  const [lastAppUri, setLastAppUri] = useState<string | null>(null);
  // App action configuration
  const [actionName, setActionName] = useState("registerForReceiveUpdates");
  const [validationFormat, setValidationFormat] = useState<"email" | "">(
    "email",
  );
  const [writeKind, setWriteKind] = useState<"plain" | "encrypted">("plain");
  const [writePlainPath, setWritePlainPath] = useState(
    "mutable://accounts/:key/subscribers/updates/:signature",
  );
  const [writeEncPath, setWriteEncPath] = useState(
    "immutable://accounts/:key/subscribers/updates/:signature",
  );
  const [actionPayload, setActionPayload] = useState("user@example.com");
  const [encPublicKeyHex, setEncPublicKeyHex] = useState("");
  const [encPrivateKeyPem, setEncPrivateKeyPem] = useState("");

  const keyBundle: KeyBundle = {
    appKey,
    accountPrivateKeyPem,
    encryptionPublicKeyHex: encPublicKeyHex,
    encryptionPrivateKeyPem: encPrivateKeyPem,
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

  const loadSigningKey = async () => {
    if (!accountPrivateKeyPem || !appKey) {
      throw new Error("App key and private key required to sign payload");
    }
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

  const signPayload = async (payload: any) => {
    const privateKey = await loadSigningKey();
    const data = new TextEncoder().encode(JSON.stringify(payload));
    const sig = await crypto.subtle.sign("Ed25519", privateKey, data);
    const sigHex = Array.from(new Uint8Array(sig)).map((b) =>
      b.toString(16).padStart(2, "0")
    ).join("");
    return {
      auth: [{ pubkey: appKey, signature: sigHex }],
      payload,
    };
  };

  const signAndEncryptPayload = async (payload: any) => {
    if (!encPublicKeyHex) {
      throw new Error("Encryption public key required for encrypted write");
    }
    const privateKey = await loadSigningKey();
    const message = await encrypt.createSignedEncryptedMessage(payload, [{
      privateKey,
      publicKeyHex: appKey,
    }], encPublicKeyHex);
    return { auth: message.auth, payload: message.payload };
  };

  const resolveUriWithKey = (uri: string) => {
    if (uri.includes(":key")) {
      if (!appKey) {
        throw new Error("App key required to resolve :key placeholder");
      }
      return uri.replace(/:key/g, appKey);
    }
    return uri;
  };

  const wallet = useMemo(
    () =>
      new WalletClient({
        walletServerUrl: cfg.walletUrl.replace(/\/$/, ""),
        apiBasePath: cfg.apiBasePath,
      }),
    [cfg.walletUrl, cfg.apiBasePath],
  );
  const backend = useMemo(
    () => new HttpClient({ url: cfg.backendUrl.replace(/\/$/, "") }),
    [cfg.backendUrl],
  );
  const apps = useMemo(
    () =>
      new AppsClient({
        appServerUrl: cfg.appServerUrl.replace(/\/$/, ""),
        apiBasePath: cfg.appApiBasePath,
      }),
    [cfg.appServerUrl, cfg.appApiBasePath],
  );

  const logLine = (src: "local" | "apps" | "wallet" | "backend", m: string) => {
    const time = new Date().toLocaleTimeString();
    const tag = (src || "local").padEnd(6, " ").slice(0, 6);
    setLog((l) => [...l, `${time} ${tag} ${m}`]);
  };

  const applyConfig = () => {
    persistConfig(cfg);
    logLine("local", `Config applied`);
  };
  const persistConfig = (next: Config) => {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(next));
  };

  const walletHealth = async () => {
    const h = await wallet.health();
    setOutput(h);
    logLine("wallet", `Health: ${h.status}`);
  };

  const backendHealth = async () => {
    const h = await backend.health();
    setOutput(h);
    logLine("backend", `Health: ${"status" in h ? (h as any).status : "ok"}`);
  };

  const appsHealth = async () => {
    const h = await apps.health();
    setOutput(h);
    logLine("apps", "Health ok");
  };

  const serverKeys = async () => {
    const k = await wallet.getServerKeys();
    setOutput(k);
    logLine("wallet", `Server keys ok`);
  };

  const genAppKeys = async () => {
    const kp = await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ]) as CryptoKeyPair;
    const pub = await crypto.subtle.exportKey("raw", kp.publicKey);
    const priv = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
    const pubHex = Array.from(new Uint8Array(pub)).map((b) =>
      b.toString(16).padStart(2, "0")
    ).join("");
    const privB64 = btoa(String.fromCharCode(...new Uint8Array(priv)));
    const privPem = `-----BEGIN PRIVATE KEY-----\n${
      (privB64.match(/.{1,64}/g) || []).join("\n")
    }\n-----END PRIVATE KEY-----`;
    // Generate encryption (X25519) public key so encrypted actions can be used later
    // @ts-ignore X25519 supported in runtime
    const encKp = await crypto.subtle.generateKey(
      { name: "X25519", namedCurve: "X25519" } as any,
      true,
      ["deriveBits"],
    ) as CryptoKeyPair;
    const encPubRaw = await crypto.subtle.exportKey("raw", encKp.publicKey);
    const encPubHex = Array.from(new Uint8Array(encPubRaw)).map((b) =>
      b.toString(16).padStart(2, "0")
    ).join("");
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
    logLine("local", "Generated app keys (identity + encryption)");
  };

  useEffect(() => {
    const stored = localStorage.getItem(KEY_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<KeyBundle>;
      if (
        parsed.appKey && parsed.accountPrivateKeyPem &&
        parsed.encryptionPublicKeyHex && parsed.encryptionPrivateKeyPem
      ) {
        applyKeyBundle({
          appKey: parsed.appKey,
          accountPrivateKeyPem: parsed.accountPrivateKeyPem,
          encryptionPublicKeyHex: parsed.encryptionPublicKeyHex,
          encryptionPrivateKeyPem: parsed.encryptionPrivateKeyPem,
        });
        logLine("local", "Keys loaded from local storage");
        return;
      }
    }
    void genAppKeys();
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<Config>;
      if (
        parsed.walletUrl && parsed.apiBasePath && parsed.backendUrl &&
        parsed.appServerUrl && parsed.appApiBasePath
      ) {
        setCfg({
          walletUrl: parsed.walletUrl,
          apiBasePath: parsed.apiBasePath,
          backendUrl: parsed.backendUrl,
          appServerUrl: parsed.appServerUrl,
          appApiBasePath: parsed.appApiBasePath,
          googleClientId: parsed.googleClientId || "",
        });
        logLine("local", "Config loaded from local storage");
      }
    }
  }, []);

  const registerApp = async () => {
    const act = {
      action: actionName,
      validation: validationFormat
        ? { stringValue: { format: validationFormat } }
        : undefined,
      write: writeKind === "encrypted"
        ? { encrypted: writeEncPath }
        : { plain: writePlainPath },
    } as any;
    if (writeKind === "encrypted" && !encPublicKeyHex) {
      logLine("local", "Missing encryption public key for encrypted action");
      setOutput({
        error: "encryptionPublicKeyHex required for encrypted actions",
      });
      return;
    }
    const payload: any = {
      appKey,
      accountPrivateKeyPem,
      allowedOrigins: ["*"],
      actions: [act],
      encryptionPublicKeyHex: encPublicKeyHex,
      encryptionPrivateKeyPem: encPrivateKeyPem,
    };
    const res = await apps.registerApp(payload);
    setOutput(res);
    if ((res as any).token) setAppToken((res as any).token);
    logLine("apps", "App registered");
  };

  const updateSchema = async () => {
    const act = {
      action: actionName,
      validation: validationFormat
        ? { stringValue: { format: validationFormat } }
        : undefined,
      write: writeKind === "encrypted"
        ? { encrypted: writeEncPath }
        : { plain: writePlainPath },
    } as any;
    const res = await apps.updateSchema(appKey, [act]);
    setOutput(res);
    logLine("apps", "Schema updated");
  };

  const fetchSchema = async () => {
    const res = await apps.getSchema(appKey);
    setOutput(res);
    logLine("apps", "Schema fetched");
  };

  const createSession = async () => {
    const res = await apps.createSession(appKey, appToken);
    setAppSession(res.session);
    setOutput(res);
    logLine("apps", "Session created");
  };

  const signup = async (username: string, password: string) => {
    if (!appKey) {
      throw new Error("App key is required to sign up");
    }
    const s = await wallet.signupWithToken(appKey, appToken, { username, password });
    setSession(s);
    apps.setAuthToken(s.token);
    logLine("wallet", "Signup ok");
    setOutput(s);
  };

  const login = async (username: string, password: string) => {
    if (!appKey) {
      throw new Error("App key is required to log in");
    }
    const s = await wallet.loginWithTokenSession(appKey, appToken, appSession, {
      username,
      password,
    });
    setSession(s);
    apps.setAuthToken(s.token);
    logLine("wallet", "Login ok");
    setOutput(s);
  };

  const googleSignup = async (googleIdToken: string) => {
    try {
      if (!appKey) {
        throw new Error("App key is required to sign up with Google");
      }
      // Direct HTTP call for Google signup (SDK method not yet published)
      const response = await fetch(`${cfg.walletUrl}${cfg.apiBasePath}/auth/signup/${appKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: appToken, type: "google", googleIdToken }),
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
      apps.setAuthToken(s.token);
      logLine("wallet", `Google signup ok: ${data.email}`);
      setOutput({ ...s, email: data.email, name: data.name, picture: data.picture });
    } catch (error: any) {
      logLine("wallet", `Google signup failed: ${error?.message || String(error)}`);
      setOutput({ error: error?.message || String(error) });
    }
  };

  const googleLogin = async (googleIdToken: string) => {
    try {
      if (!appKey) {
        throw new Error("App key is required to log in with Google");
      }
      // Direct HTTP call for Google login (SDK method not yet published)
      const response = await fetch(`${cfg.walletUrl}${cfg.apiBasePath}/auth/login/${appKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: appToken,
          session: appSession,
          type: "google",
          googleIdToken,
        }),
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
      apps.setAuthToken(s.token);
      logLine("wallet", `Google login ok: ${data.email}`);
      setOutput({ ...s, email: data.email, name: data.name, picture: data.picture });
    } catch (error: any) {
      logLine("wallet", `Google login failed: ${error?.message || String(error)}`);
      setOutput({ error: error?.message || String(error) });
    }
  };

  const myKeys = async () => {
    if (!session) throw new Error("no session");
    wallet.setSession(session);
    const k = await wallet.getPublicKeys();
    setOutput(k);
    logLine("wallet", "My keys ok");
  };

  const backendWritePlain = async () => {
    const payload = JSON.parse(
      writePayload.replace(
        /"timestamp"\s*:\s*""/,
        `"timestamp":"${new Date().toISOString()}"`,
      ),
    );
    const value = await signPayload(payload);
    const targetUri = resolveUriWithKey(writeUri);
    const r = await backend.write(targetUri, value);
    setOutput(r);
    setLastResolvedUri(targetUri);
    logLine(
      "backend",
      `Backend write (plain): ${r.success ? "success" : "failed"}`,
    );
  };

  const backendWriteEnc = async () => {
    const payload = JSON.parse(
      writePayload.replace(
        /"timestamp"\s*:\s*""/,
        `"timestamp":"${new Date().toISOString()}"`,
      ),
    );
    const value = await signAndEncryptPayload(payload);
    const targetUri = resolveUriWithKey(writeUri);
    const r = await backend.write(targetUri, value);
    setOutput(r);
    setLastResolvedUri(targetUri);
    logLine(
      "backend",
      `Backend write (encrypted path): ${r.success ? "success" : "failed"}`,
    );
  };

  const writePlain = async () => {
    if (!session) throw new Error("no session");
    wallet.setSession(session);
    const pp = writePayload.replace(
      /"timestamp"\s*:\s*""/,
      `"timestamp":"${new Date().toISOString()}"`,
    );
    const data = JSON.parse(pp);
    const targetUri = resolveUriWithKey(writeUri);
    const r = await wallet.proxyWrite({ uri: targetUri, data, encrypt: false });
    setOutput(r);
    if ((r as any).resolvedUri) setLastResolvedUri((r as any).resolvedUri);
    logLine("wallet", "Write plain ok");
  };

  const writeEnc = async () => {
    if (!session) throw new Error("no session");
    wallet.setSession(session);
    const ep = writePayload.replace(
      /"timestamp"\s*:\s*""/,
      `"timestamp":"${new Date().toISOString()}"`,
    );
    const data = JSON.parse(ep);
    const targetUri = resolveUriWithKey(writeUri);
    const r = await wallet.proxyWrite({ uri: targetUri, data, encrypt: true });
    setOutput(r);
    if ((r as any).resolvedUri) setLastResolvedUri((r as any).resolvedUri);
    logLine("wallet", "Write enc ok");
  };

  const readLast = async () => {
    if (lastAppUri) {
      const res = await apps.read(appKey, lastAppUri);
      setOutput(res);
      logLine("apps", "Read via app backend ok");
      return;
    }
    const target = lastResolvedUri || resolveUriWithKey(writeUri);
    const res = await backend.read(target);
    setOutput(res);
    logLine("backend", `Read ${res.success ? "ok" : "failed"}`);
  };

  const testAction = async () => {
    try {
      const res = await apps.invokeAction(
        appKey,
        actionName,
        actionPayload,
        window.location.origin,
      );
      setOutput(res);
      if (res?.uri) setLastAppUri(res.uri);
      logLine("apps", `Invoked action '${actionName}'`);
    } catch (e: any) {
      logLine("apps", `Invoke failed: ${e?.message || String(e)}`);
      setOutput({ error: e?.message || String(e) });
    }
  };

  return (
    <div className="wrap">
      <div className="layout">
        <aside className="sidebar">
          <div className="card">
            <h3>Navigation</h3>
            <div className="nav" style={{ marginTop: 8 }}>
              <button onClick={() => setSection("config")}>
                Configuration
              </button>
              <button onClick={() => setSection("backend")}>Backend</button>
              <button onClick={() => setSection("app")}>App</button>
              <button onClick={() => setSection("auth")}>Auth</button>
            </div>
          </div>
        </aside>
        <main>
          {section === "config" && (
            <section className="card">
              <h3>Configuration</h3>
              <div className="row" style={{ marginTop: 8 }}>
                <div>
                  <label>App Public Key (hex)</label>
                  <input
                    value={appKey}
                    onChange={(e) =>
                      updateKeyBundle({ appKey: e.target.value })}
                  />
                </div>
                <div>
                  <label>Encryption Public Key (X25519, hex)</label>
                  <input
                    value={encPublicKeyHex}
                    onChange={(e) =>
                      updateKeyBundle({
                        encryptionPublicKeyHex: e.target.value,
                      })}
                    placeholder="hex"
                  />
                </div>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <div>
                  <label>Account Private Key (PEM)</label>
                  <textarea
                    value={accountPrivateKeyPem}
                    onChange={(e) =>
                      updateKeyBundle({ accountPrivateKeyPem: e.target.value })}
                  />
                </div>
                <div>
                  <label>Encryption Private Key (PEM)</label>
                  <textarea
                    value={encPrivateKeyPem}
                    onChange={(e) =>
                      updateKeyBundle({
                        encryptionPrivateKeyPem: e.target.value,
                      })}
                  />
                </div>
              </div>
              <div className="actions" style={{ marginTop: 8 }}>
                <button onClick={genAppKeys}>Generate Keys</button>
              </div>
              <hr
                style={{
                  border: "none",
                  borderTop: "1px solid #2a366f",
                  margin: "16px 0",
                }}
              />
              <h3>Backend</h3>
              <div className="row" style={{ marginTop: 8 }}>
                <div>
                  <label>Backend URL</label>
                  <input
                    value={cfg.backendUrl}
                    onChange={(e) =>
                      setCfg({ ...cfg, backendUrl: e.target.value })}
                    placeholder="http://localhost:8080"
                  />
                </div>
              </div>
              <div className="actions" style={{ marginTop: 8 }}>
                <button onClick={backendHealth}>Backend Health</button>
              </div>
              <hr
                style={{
                  border: "none",
                  borderTop: "1px solid #2a366f",
                  margin: "16px 0",
                }}
              />
              <h3>Wallet</h3>
              <div className="row" style={{ marginTop: 8 }}>
                <div>
                  <label>Wallet URL</label>
                  <input
                    value={cfg.walletUrl}
                    onChange={(e) =>
                      setCfg({ ...cfg, walletUrl: e.target.value })}
                    placeholder="http://localhost:3001"
                  />
                </div>
                <div>
                  <label>API Base Path</label>
                  <input
                    value={cfg.apiBasePath}
                    onChange={(e) =>
                      setCfg({ ...cfg, apiBasePath: e.target.value })}
                    placeholder="/api/v1"
                  />
                </div>
              </div>
              <div className="actions" style={{ marginTop: 8 }}>
                <button onClick={walletHealth}>Wallet Health</button>
                <button onClick={serverKeys}>Server Keys</button>
              </div>
              <hr
                style={{
                  border: "none",
                  borderTop: "1px solid #2a366f",
                  margin: "16px 0",
                }}
              />
              <h3>App Server</h3>
              <div className="row" style={{ marginTop: 8 }}>
                <div>
                  <label>App Server URL</label>
                  <input
                    value={cfg.appServerUrl}
                    onChange={(e) =>
                      setCfg({ ...cfg, appServerUrl: e.target.value })}
                    placeholder="http://localhost:3003"
                  />
                </div>
                <div>
                  <label>App API Base Path</label>
                  <input
                    value={cfg.appApiBasePath}
                    onChange={(e) =>
                      setCfg({ ...cfg, appApiBasePath: e.target.value })}
                    placeholder="/api/v1"
                  />
                </div>
              </div>
              <div className="actions" style={{ marginTop: 8 }}>
                <button onClick={appsHealth}>App Server Health</button>
              </div>
              <hr
                style={{
                  border: "none",
                  borderTop: "1px solid #2a366f",
                  margin: "16px 0",
                }}
              />
              <h3>Google OAuth</h3>
              <div className="row" style={{ marginTop: 8 }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label>Google Client ID</label>
                  <input
                    value={cfg.googleClientId}
                    onChange={(e) =>
                      setCfg({ ...cfg, googleClientId: e.target.value })}
                    placeholder="your-client-id.apps.googleusercontent.com"
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
              <div className="actions" style={{ marginTop: 12 }}>
                <button className="primary" onClick={applyConfig}>
                  Apply Config
                </button>
              </div>
            </section>
          )}

          {section === "backend" && (
            <section className="card">
              <h3>Backend</h3>
              <div className="row" style={{ marginTop: 8 }}>
                <div>
                  <label>URI</label>
                  <input
                    value={writeUri}
                    onChange={(e) => setWriteUri(e.target.value)}
                  />
                </div>
                <div>
                  <label>Payload (JSON)</label>
                  <textarea
                    value={writePayload}
                    onChange={(e) => setWritePayload(e.target.value)}
                  />
                </div>
              </div>
              <div className="actions" style={{ marginTop: 8 }}>
                <button onClick={backendWritePlain}>Write Plain</button>
                <button onClick={backendWriteEnc}>Write Encrypted</button>
                <button onClick={readLast}>Read Last</button>
              </div>
            </section>
          )}

          {section === "app" && (
            <section className="card">
              <h3>App</h3>
              <div className="row" style={{ marginTop: 8 }}>
                <div>
                  <label>App Public Key (hex)</label>
                  <input
                    value={appKey}
                    onChange={(e) =>
                      updateKeyBundle({ appKey: e.target.value })}
                  />
                </div>
                <div>
                  <label>App Token</label>
                  <input
                    value={appToken}
                    onChange={(e) => setAppToken(e.target.value)}
                  />
                </div>
              </div>
              <div className="actions" style={{ marginTop: 8 }}>
                <button onClick={registerApp}>Register App</button>
                <button onClick={createSession}>Create Session</button>
                <button onClick={fetchSchema}>Fetch Schema</button>
              </div>
              <div style={{ marginTop: 8 }}>
                <label>Session Key</label>
                <input
                  value={appSession}
                  onChange={(e) => setAppSession(e.target.value)}
                />
              </div>
              <hr
                style={{
                  border: "none",
                  borderTop: "1px solid #2a366f",
                  margin: "16px 0",
                }}
              />
              <h3>Action Configuration</h3>
              <div className="row" style={{ marginTop: 8 }}>
                <div>
                  <label>Action Name</label>
                  <input
                    value={actionName}
                    onChange={(e) => setActionName(e.target.value)}
                    placeholder="registerForReceiveUpdates"
                  />
                </div>
                <div>
                  <label>Validation Format</label>
                  <select
                    value={validationFormat}
                    onChange={(e) => setValidationFormat(e.target.value as any)}
                  >
                    <option value="">None</option>
                    <option value="email">email</option>
                  </select>
                </div>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <div>
                  <label>Write Type</label>
                  <select
                    value={writeKind}
                    onChange={(e) => setWriteKind(e.target.value as any)}
                  >
                    <option value="plain">plain</option>
                    <option value="encrypted">encrypted</option>
                  </select>
                </div>
                {writeKind === "plain"
                  ? (
                    <div>
                      <label>Plain Path</label>
                      <input
                        value={writePlainPath}
                        onChange={(e) => setWritePlainPath(e.target.value)}
                      />
                    </div>
                  )
                  : (
                    <div>
                      <label>Encrypted Path</label>
                      <input
                        value={writeEncPath}
                        onChange={(e) => setWriteEncPath(e.target.value)}
                      />
                    </div>
                  )}
              </div>

              <div className="actions" style={{ marginTop: 8 }}>
                <button onClick={updateSchema}>Update Schema</button>
              </div>
              <hr
                style={{
                  border: "none",
                  borderTop: "1px solid #2a366f",
                  margin: "16px 0",
                }}
              />
              <h3>Invoke Action</h3>
              <div className="row" style={{ marginTop: 8 }}>
                <div>
                  <label>Action</label>
                  <input
                    value={actionName}
                    onChange={(e) => setActionName(e.target.value)}
                  />
                </div>
                <div>
                  <label>Test Payload (string)</label>
                  <input
                    value={actionPayload}
                    onChange={(e) => setActionPayload(e.target.value)}
                  />
                </div>
              </div>
              <div className="actions" style={{ marginTop: 8 }}>
                <button onClick={testAction}>Invoke Action</button>
              </div>
            </section>
          )}

          {section === "auth" && (
            <section className="card">
              <h3>Auth</h3>
              <AuthForm
                onSignup={signup}
                onLogin={login}
                onGoogleSignup={googleSignup}
                onGoogleLogin={googleLogin}
                googleClientId={cfg.googleClientId}
              />
              <div className="actions" style={{ marginTop: 8 }}>
                <button onClick={myKeys}>My Keys</button>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <div>
                  <label>URI</label>
                  <input
                    value={writeUri}
                    onChange={(e) => setWriteUri(e.target.value)}
                  />
                </div>
                <div>
                  <label>Payload (JSON)</label>
                  <textarea
                    value={writePayload}
                    onChange={(e) => setWritePayload(e.target.value)}
                  />
                </div>
              </div>
              <div className="actions" style={{ marginTop: 8 }}>
                <button onClick={writePlain}>Proxy Write Plain</button>
                <button onClick={writeEnc}>Proxy Write Encrypted</button>
              </div>
            </section>
          )}
        </main>
        <aside>
          <div className="card">
            <h3>Output</h3>
            <pre className="output">{JSON.stringify(output, null, 2)}</pre>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <h3>State</h3>
            <div style={{ fontSize: 14, lineHeight: 1.6, marginTop: 8 }}>
              <div>
                <strong>App Key:</strong>{" "}
                {appKey ? appKey.substring(0, 16) + "…" : "-"}
              </div>
              <div>
                <strong>App Token:</strong>{" "}
                {appToken ? appToken.substring(0, 20) + "…" : "-"}
              </div>
              <div>
                <strong>App Session:</strong> {appSession || "-"}
              </div>
              <div>
                <strong>User:</strong> {session?.username || "-"}
              </div>
              <div>
                <strong>Authenticated:</strong> {session ? "yes" : "no"}
              </div>
              <div>
                <strong>Login Session (JWT):</strong>{" "}
                {session?.token ? session.token.substring(0, 20) + "…" : "-"}
              </div>
              <div>
                <strong>Expires In:</strong> {session?.expiresIn ?? "-"}
              </div>
            </div>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <h3>Log</h3>
            <div className="log">
              {log.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function AuthForm(
  { onSignup, onLogin, onGoogleSignup, onGoogleLogin, googleClientId }: {
    onSignup: (u: string, p: string) => void;
    onLogin: (u: string, p: string) => void;
    onGoogleSignup: (googleIdToken: string) => void;
    onGoogleLogin: (googleIdToken: string) => void;
    googleClientId: string;
  },
) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [googleMode, setGoogleMode] = useState<"signup" | "login">("signup");
  const googleButtonRef = React.useRef<HTMLDivElement>(null);

  // Initialize Google Identity Services
  useEffect(() => {
    if (!googleClientId) return;

    // Load the Google Identity Services script
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

    function initializeGoogleSignIn() {
      if (!(window as any).google?.accounts?.id) {
        // Retry after a short delay if google is not ready yet
        setTimeout(initializeGoogleSignIn, 100);
        return;
      }

      (window as any).google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (response: { credential: string }) => {
          if (googleMode === "signup") {
            onGoogleSignup(response.credential);
          } else {
            onGoogleLogin(response.credential);
          }
        },
      });

      if (googleButtonRef.current) {
        // Clear any existing button
        googleButtonRef.current.innerHTML = "";
        (window as any).google.accounts.id.renderButton(googleButtonRef.current, {
          theme: "filled_blue",
          size: "large",
          text: googleMode === "signup" ? "signup_with" : "signin_with",
          width: 280,
        });
      }
    }
  }, [googleClientId, googleMode, onGoogleSignup, onGoogleLogin]);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
        />
        <input
          value={password}
          type="password"
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
        />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={() => onSignup(username, password)}>Signup</button>
        <button onClick={() => onLogin(username, password)}>Login</button>
      </div>

      {googleClientId && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              margin: "16px 0",
              color: "#8899bb",
            }}
          >
            <hr style={{ flex: 1, border: "none", borderTop: "1px solid #2a366f" }} />
            <span>or</span>
            <hr style={{ flex: 1, border: "none", borderTop: "1px solid #2a366f" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <label style={{ marginRight: 8 }}>Google mode:</label>
            <select
              value={googleMode}
              onChange={(e) => setGoogleMode(e.target.value as "signup" | "login")}
              style={{ padding: "4px 8px" }}
            >
              <option value="signup">Sign Up</option>
              <option value="login">Login</option>
            </select>
          </div>
          <div ref={googleButtonRef} style={{ marginTop: 8 }} />
          {!googleClientId && (
            <p style={{ color: "#ff6b6b", fontSize: 12, marginTop: 8 }}>
              Set Google Client ID in Configuration to enable Google Sign-In
            </p>
          )}
        </>
      )}
    </div>
  );
}
