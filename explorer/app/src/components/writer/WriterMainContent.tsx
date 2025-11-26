import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Activity,
  ChevronRight,
  FileText,
  KeyRound,
  PanelRightOpen,
  PenSquare,
  Play,
  Server,
  ShieldCheck,
  Wand2,
} from "lucide-react";
import { useActiveBackend, useAppStore } from "../../stores/appStore";
import type { AppLogEntry, KeyBundle } from "../../types";
import {
  backendWriteEnc as backendWriteEncService,
  backendWritePlain as backendWritePlainService,
  createAppsClient,
  createBackendClient,
  createSession as createSessionService,
  createWalletClient,
  fetchAppProfile as fetchAppProfileService,
  fetchMyKeys,
  fetchSchema as fetchSchemaService,
  generateAppKeys,
  googleLogin as googleLoginService,
  googleSignup as googleSignupService,
  loginWithPassword,
  proxyWrite,
  saveAppProfile as saveAppProfileService,
  signAppPayload,
  signEncryptedAppPayload,
  signupWithPassword,
  updateOrigins as updateOriginsService,
  updateSchema as updateSchemaService,
} from "../../services/writer/writerService";

const PRIMARY_BUTTON =
  "inline-flex items-center justify-center rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const SECONDARY_BUTTON =
  "inline-flex items-center justify-center rounded border border-border bg-muted px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
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
  const activeWallet = walletServers.find((w) =>
    w.id === activeWalletServerId && w.isActive
  );
  const activeAppServer = appServers.find((w) =>
    w.id === activeAppServerId && w.isActive
  );
  const activeBackend = useActiveBackend();

  const [session, setSession] = useState<
    { username: string; token: string; expiresIn: number } | null
  >(null);
  const [appSession, setAppSession] = useState("");
  const [output, setOutput] = useState<any>(null);
  const [lastResolvedUri, setLastResolvedUri] = useState<string | null>(null);
  const [lastAppUri, setLastAppUri] = useState<string | null>(null);
  const FORM_BACKEND = "writer-backend";
  const FORM_APP = "writer-app";
  const FORM_AUTH = "writer-auth";
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const [googleMode, setGoogleMode] = useState<"signup" | "login">("signup");
  const [allowedOrigins, setAllowedOrigins] = useState("*");
  const [currentAppProfile, setCurrentAppProfile] = useState<any | null>(null);
  const [appProfileError, setAppProfileError] = useState<string | null>(null);
  const [backendHistory, setBackendHistory] = useState<
    Array<{ id: string; label: string; uri: string; result: any }>
  >([]);
  const [backendKeys, setBackendKeys] = useState<KeyBundle>({
    appKey: "",
    accountPrivateKeyPem: "",
    encryptionPublicKeyHex: "",
    encryptionPrivateKeyPem: "",
  });

  const {
    appKey,
    accountPrivateKeyPem,
    encryptionPublicKeyHex,
    encryptionPrivateKeyPem,
  } = keyBundle;
  const actionName = getFormValue(
    FORM_APP,
    "actionName",
    "registerForReceiveUpdates",
  ) as string;
  const validationFormat =
    (getFormValue(FORM_APP, "validationFormat") as "email" | "") || "";
  const writeKind =
    (getFormValue(FORM_APP, "writeKind", "plain") as "plain" | "encrypted") ||
    "plain";
  const actionPayload = getFormValue(FORM_APP, "actionPayload", "");
  const writePlainPath = getFormValue(FORM_APP, "writePlainPath", "");
  const writeEncPath = getFormValue(FORM_APP, "writeEncPath", "");
  const writeUri = getFormValue(FORM_BACKEND, "writeUri", "");
  const writePayload = getFormValue(FORM_BACKEND, "writePayload", "");
  const authWriteUri = getFormValue(FORM_AUTH, "writeUri", "");
  const authWritePayload = getFormValue(FORM_AUTH, "writePayload", "");
  const setValidationFormat = (v: "email" | "") =>
    setFormValue(FORM_APP, "validationFormat", v);
  const setWriteKind = (v: "plain" | "encrypted") =>
    setFormValue(FORM_APP, "writeKind", v);
  const setWritePlainPath = (v: string) =>
    setFormValue(FORM_APP, "writePlainPath", v);
  const setWriteEncPath = (v: string) =>
    setFormValue(FORM_APP, "writeEncPath", v);

  const logLine = (
    source: string,
    message: string,
    level: AppLogEntry["level"] = "info",
  ) => {
    addLogEntry({ source, message, level });
  };

  const ensureValue = (value: string, label: string) => {
    if (!value) {
      throw new Error(`${label} is required`);
    }
  };

  const handleAction = async (label: string, action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Writer] ${label} failed`, error);
      setOutput({ error: message });
      logLine("local", `${label} failed: ${message}`, "error");
    }
  };

  const requireWalletClient = () => {
    if (!activeWallet) {
      throw new Error("Active wallet server is required");
    }
    return createWalletClient(activeWallet.url);
  };

  const requireBackendClient = () => createBackendClient(activeBackend);

  const requireAppsClient = () => {
    if (!activeAppServer) {
      throw new Error("Active app server is required");
    }
    return createAppsClient(activeAppServer.url);
  };

  const resolveWithAppKey = (uri: string) =>
    uri.includes(":key") ? uri.replace(/:key/g, appKey) : uri;

  const loadAppProfile = async () => {
    ensureValue(appKey, "App key");
    const res = await fetchAppProfileService({
      backendClient: requireBackendClient(),
      appKey,
    });
    if (!res.success) {
      setCurrentAppProfile(null);
      setAppProfileError(res.error || "Failed to load app profile");
      throw new Error(res.error || "Failed to load app profile");
    }
    setCurrentAppProfile(res.payload);
    setAppProfileError(null);
    logLine("backend", `Loaded app profile from ${res.uri}`, "info");
  };

  const genAppKeys = async () => {
    const bundle = await generateAppKeys();
    setKeyBundle(bundle);
    setOutput({
      publicKeyHex: bundle.appKey,
      privateKeyPem: bundle.accountPrivateKeyPem,
      encryptionPublicKeyHex: bundle.encryptionPublicKeyHex,
      encryptionPrivateKeyPem: bundle.encryptionPrivateKeyPem,
    });
    logLine("local", "Generated app keys (identity + encryption)", "success");
  };
  const genBackendKeys = async () => {
    const bundle = await generateAppKeys();
    setBackendKeys(bundle);
    setOutput({
      context: "backend",
      publicKeyHex: bundle.appKey,
      privateKeyPem: bundle.accountPrivateKeyPem,
      encryptionPublicKeyHex: bundle.encryptionPublicKeyHex,
      encryptionPrivateKeyPem: bundle.encryptionPrivateKeyPem,
    });
    logLine("local", "Generated backend keys (identity + encryption)", "success");
  };

  const updateOrigins = async () => {
    ensureValue(appKey, "App key");
    const origins = allowedOrigins
      .split(",")
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
    const res = await updateOriginsService({
      appsClient: requireAppsClient(),
      appKey,
      accountPrivateKeyPem,
      allowedOrigins: origins.length > 0 ? origins : ["*"],
      encryptionPublicKeyHex: encryptionPublicKeyHex || null,
    });
    setOutput(res);
    logLine("apps", "Origins updated", "success");
  };

  const saveAppProfile = async () => {
    ensureValue(appKey, "App key");

    const origins = allowedOrigins
      .split(",")
      .map((o) => o.trim())
      .filter((o) => o.length > 0);

    const { uri, response } = await saveAppProfileService({
      backendClient: requireBackendClient(),
      appKey,
      accountPrivateKeyPem,
      googleClientId: googleClientId || null,
      allowedOrigins: origins.length > 0 ? origins : ["*"],
      encryptionPublicKeyHex: encryptionPublicKeyHex || null,
    });

    if (response.success) {
      logLine("backend", `App profile saved to ${uri}`, "success");
      setOutput(response);
      await loadAppProfile();
    } else {
      throw new Error(response.error || "Failed to save app profile");
    }
  };

  const updateSchema = async () => {
    const res = await updateSchemaService({
      appsClient: requireAppsClient(),
      appKey,
      actionName,
      validationFormat,
      writeKind,
      writePlainPath,
      writeEncPath,
      accountPrivateKeyPem,
      encryptionPublicKeyHex: encryptionPublicKeyHex || null,
    });
    setOutput(res);
    logLine("apps", "Schema updated", "success");
  };

  const fetchSchema = async () => {
    const res = await fetchSchemaService({
      appsClient: requireAppsClient(),
      appKey,
    });
    setOutput(res);
    logLine("apps", "Schema fetched", "info");
  };

  const createSession = async () => {
    const res = await createSessionService({
      appsClient: requireAppsClient(),
      appKey,
      accountPrivateKeyPem,
    });
    setAppSession(res.session);
    setOutput(res);
    logLine("apps", "Session created", "success");
  };

  const signup = async (username: string, password: string) => {
    const s = await signupWithPassword({
      walletClient: requireWalletClient(),
      appKey,
      username,
      password,
    });
    setSession(s);
    logLine("wallet", "Signup ok", "success");
    setOutput(s);
  };

  const login = async (username: string, password: string) => {
    const s = await loginWithPassword({
      walletClient: requireWalletClient(),
      appKey,
      session: appSession,
      username,
      password,
    });
    setSession(s);
    logLine("wallet", "Login ok", "success");
    setOutput(s);
  };

  const googleSignup = async (googleIdToken: string) => {
    if (!activeWallet) throw new Error("Active wallet server is required");
    const data = await googleSignupService({
      walletServerUrl: activeWallet.url,
      appKey,
      googleIdToken,
    });
    const s = {
      username: data.username,
      token: data.token,
      expiresIn: data.expiresIn,
    };
    setSession(s);
    logLine("wallet", `Google signup ok: ${data.email}`, "success");
    setOutput({
      ...s,
      email: data.email,
      name: data.name,
      picture: data.picture,
    });
  };

  const googleLogin = async (googleIdToken: string) => {
    if (!activeWallet) throw new Error("Active wallet server is required");
    const data = await googleLoginService({
      walletServerUrl: activeWallet.url,
      appKey,
      appSession,
      googleIdToken,
    });
    const s = {
      username: data.username,
      token: data.token,
      expiresIn: data.expiresIn,
    };
    setSession(s);
    logLine("wallet", `Google login ok: ${data.email}`, "success");
    setOutput({
      ...s,
      email: data.email,
      name: data.name,
      picture: data.picture,
    });
  };

  const myKeys = async () => {
    if (!session) throw new Error("Session required");
    const k = await fetchMyKeys({
      walletClient: requireWalletClient(),
      appKey,
      session,
    });
    setOutput(k);
    logLine("wallet", "My keys ok", "info");
  };

  const backendWritePlain = async () => {
    const { targetUri, response } = await backendWritePlainService({
      backendClient: requireBackendClient(),
      appKey: backendKeys.appKey,
      accountPrivateKeyPem: backendKeys.accountPrivateKeyPem,
      writeUri,
      writePayload,
    });
    setOutput(response);
    setLastResolvedUri(targetUri);
    setBackendHistory((prev) => [
      {
        id: crypto.randomUUID(),
        label: "Plain write",
        uri: targetUri,
        result: response,
      },
      ...prev,
    ]);
    logLine(
      "backend",
      `Backend write (plain): ${response.success ? "success" : "failed"}`,
      response.success ? "success" : "warning",
    );
  };

  const backendWriteEnc = async () => {
    ensureValue(backendKeys.encryptionPublicKeyHex, "Encryption public key");
    const { targetUri, response } = await backendWriteEncService({
      backendClient: requireBackendClient(),
      appKey: backendKeys.appKey,
      accountPrivateKeyPem: backendKeys.accountPrivateKeyPem,
      encryptionPublicKeyHex: backendKeys.encryptionPublicKeyHex,
      writeUri,
      writePayload,
    });
    setOutput(response);
    setLastResolvedUri(targetUri);
    setBackendHistory((prev) => [
      {
        id: crypto.randomUUID(),
        label: "Encrypted write",
        uri: targetUri,
        result: response,
      },
      ...prev,
    ]);
    logLine(
      "backend",
      `Backend write (encrypted path): ${
        response.success ? "success" : "failed"
      }`,
      response.success ? "success" : "warning",
    );
  };

  const writePlain = async () => {
    if (!session) throw new Error("Session required");
    ensureValue(authWriteUri, "Write URI");
    ensureValue(authWritePayload, "Write payload");
    const data = JSON.parse(authWritePayload);
    const r = await proxyWrite({
      walletClient: requireWalletClient(),
      session,
      uri: authWriteUri,
      data,
      encrypt: false,
    });
    setOutput(r);
    if ((r as any).resolvedUri) setLastResolvedUri((r as any).resolvedUri);
    logLine("wallet", "Write plain ok", "success");
  };

  const writeEnc = async () => {
    if (!session) throw new Error("Session required");
    ensureValue(authWriteUri, "Write URI");
    ensureValue(authWritePayload, "Write payload");
    const data = JSON.parse(authWritePayload);
    const r = await proxyWrite({
      walletClient: requireWalletClient(),
      session,
      uri: authWriteUri,
      data,
      encrypt: true,
    });
    setOutput(r);
    if ((r as any).resolvedUri) setLastResolvedUri((r as any).resolvedUri);
    logLine("wallet", "Write enc ok", "success");
  };

  const testAction = async () => {
    ensureValue(actionPayload, "Action payload");
    if (writeKind === "encrypted") {
      ensureValue(encryptionPublicKeyHex, "Encryption public key");
    }
    const signedMessage = writeKind === "encrypted"
      ? await signEncryptedAppPayload({
        payload: actionPayload,
        appKey,
        accountPrivateKeyPem,
        encryptionPublicKeyHex: encryptionPublicKeyHex || "",
      })
      : await signAppPayload({
        payload: actionPayload,
        appKey,
        accountPrivateKeyPem,
      });
    const res = await requireAppsClient().invokeAction(
      appKey,
      actionName,
      signedMessage,
      window.location.origin,
    );
    setOutput(res);
    if (res?.uri) setLastAppUri(res.uri);
    logLine("apps", `Invoked action '${actionName}'`, "info");
  };

  useEffect(() => {
    if (!appKey) {
      setCurrentAppProfile(null);
      setAppProfileError(null);
      return;
    }
    void handleAction("Load app profile", loadAppProfile);
  }, [appKey, activeBackend]);

  useEffect(() => {
    if (!googleClientId || !googleButtonRef.current) return;
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
            void handleAction(
              "Google signup",
              () => googleSignup(response.credential),
            );
          } else {
            void handleAction(
              "Google login",
              () => googleLogin(response.credential),
            );
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
  }, [googleClientId, googleMode, writerSection]);

  const rightOpen = panels.right;

  return (
    <div className="h-full flex overflow-hidden bg-background text-foreground">
      <div className="flex-1 overflow-auto custom-scrollbar">
        <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-muted/30">
          <WriterBreadcrumb writerSection={writerSection} />
        </div>
        <div className="p-6 space-y-4 max-w-6xl mx-auto">
          <OutputPanel output={output} />
          {writerSection === "backend" ? (
            <BackendHistory history={backendHistory} />
          ) : (
            <StatePanel
              appKey={appKey}
              appSession={appSession}
              session={session}
              lastResolvedUri={lastResolvedUri}
              lastAppUri={lastAppUri}
            />
          )}
        </div>
      </div>

      {rightOpen && (
        <aside className="w-[420px] border-l border-border bg-card flex flex-col">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <PanelRightOpen className="h-4 w-4" />
            <span className="text-sm font-semibold">Controls</span>
          </div>
          <div className="flex-1 overflow-auto custom-scrollbar p-4 space-y-4">
            {writerSection === "backend" && (
              <div className="space-y-4">
                <BackendSection
                  formId={FORM_BACKEND}
                  backendWritePlain={() =>
                    handleAction("Backend write (plain)", backendWritePlain)}
                  backendWriteEnc={() =>
                    handleAction("Backend write (encrypted)", backendWriteEnc)}
                />
                <KeysCard
                  appKey={backendKeys.appKey}
                  encryptionPublicKeyHex={backendKeys.encryptionPublicKeyHex}
                  encryptionPrivateKeyPem={backendKeys.encryptionPrivateKeyPem}
                  accountPrivateKeyPem={backendKeys.accountPrivateKeyPem}
                  setKeyBundle={(patch) =>
                    setBackendKeys({ ...backendKeys, ...patch })}
                  genAppKeys={() => handleAction("Generate backend keys", genBackendKeys)}
                />
              </div>
            )}

            {writerSection === "actions" && (
              <div className="space-y-4">
                <InvokeActionCard
                  formId={FORM_APP}
                  actionName={actionName}
                  actionPayload={actionPayload}
                  testAction={() => handleAction("Invoke action", testAction)}
                />
              </div>
            )}

            {writerSection === "configuration" && (
              <div className="space-y-4">
                <KeysCard
                  appKey={appKey}
                  encryptionPublicKeyHex={encryptionPublicKeyHex}
                  encryptionPrivateKeyPem={encryptionPrivateKeyPem}
                  accountPrivateKeyPem={accountPrivateKeyPem}
                  setKeyBundle={(patch) =>
                    setKeyBundle({ ...keyBundle, ...patch })}
                  genAppKeys={() => handleAction("Generate keys", genAppKeys)}
                />
                <AppProfileCard
                  googleClientId={googleClientId}
                  setGoogleClientId={setGoogleClientId}
                  allowedOrigins={allowedOrigins}
                  setAllowedOrigins={setAllowedOrigins}
                  currentProfile={currentAppProfile}
                  appProfileError={appProfileError}
                  reloadAppProfile={() =>
                    handleAction("Load app profile", loadAppProfile)}
                  saveAppProfile={() =>
                    handleAction("Save app profile", saveAppProfile)}
                />
              </div>
            )}

            {writerSection === "schema" && (
              <div className="space-y-4">
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
                  fetchSchema={() => handleAction("Fetch schema", fetchSchema)}
                />
              </div>
            )}

            {writerSection === "auth" && (
              <div className="space-y-4">
                <SessionCard
                  createSession={() =>
                    handleAction("Create session", createSession)}
                />
                <AuthSection
                  signup={(u, p) => handleAction("Signup", () => signup(u, p))}
                  login={(u, p) => handleAction("Login", () => login(u, p))}
                  myKeys={() => handleAction("My keys", myKeys)}
                  googleClientId={googleClientId}
                  googleMode={googleMode}
                  setGoogleMode={setGoogleMode}
                  googleButtonRef={googleButtonRef}
                />
                <ProxyWriteSection
                  formId={FORM_AUTH}
                  writePlain={() => handleAction("Proxy write plain", writePlain)}
                  writeEnc={() => handleAction("Proxy write encrypted", writeEnc)}
                />
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

function WriterBreadcrumb(
  { writerSection }: {
    writerSection: "backend" | "auth" | "actions" | "configuration" | "schema";
  },
) {
  const labels: Record<
    "backend" | "auth" | "actions" | "configuration" | "schema",
    string
  > = {
    backend: "Backend",
    auth: "Auth",
    actions: "Actions",
    configuration: "Configuration",
    schema: "Schema",
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
      <span className="text-foreground font-medium">
        {labels[writerSection]}
      </span>
    </nav>
  );
}

function SectionCard(
  { title, icon, children }: {
    title: string;
    icon: ReactNode;
    children: ReactNode;
  },
) {
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
      </div>
    </SectionCard>
  );
}

function BackendHistory(
  { history }: { history: Array<{ id: string; label: string; uri: string; result: any }> },
) {
  if (!history.length) {
    return (
      <SectionCard
        title="Recent Writes"
        icon={<Activity className="h-4 w-4" />}
      >
        <div className="text-sm text-muted-foreground">No writes yet.</div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Recent Writes" icon={<Activity className="h-4 w-4" />}>
      <div className="space-y-3">
        {history.map((entry) => (
          <div
            key={entry.id}
            className="rounded-lg border border-border p-3 bg-muted/40 space-y-2"
          >
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{entry.label}</span>
              <span className="truncate max-w-[60%]">{entry.uri}</span>
            </div>
            <pre className="text-xs bg-background border border-border rounded p-2 overflow-auto">
              {JSON.stringify(entry.result, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function OriginsCard(props: {
  allowedOrigins: string;
  setAllowedOrigins: (v: string) => void;
  updateOrigins: () => void;
}) {
  return (
    <SectionCard title="Origins" icon={<Activity className="h-4 w-4" />}>
      <Field
        label="Allowed Origins (comma separated)"
        value={props.allowedOrigins}
        onChange={props.setAllowedOrigins}
        placeholder="*,https://example.com"
      />
      <div className="flex flex-wrap gap-2">
        <button onClick={props.updateOrigins} className={PRIMARY_BUTTON}>
          Save Origins
        </button>
      </div>
    </SectionCard>
  );
}

function SessionCard(props: {
  createSession: () => void;
}) {
  return (
    <SectionCard title="Session" icon={<KeyRound className="h-4 w-4" />}>
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
  fetchSchema: () => void;
}) {
  return (
    <SectionCard
      title="Actions Registry & Schema"
      icon={<Activity className="h-4 w-4" />}
    >
      <div className="grid md:grid-cols-2 gap-4">
        <Field
          label="Action Name"
          formId={props.formId}
          name="actionName"
          defaultValue="registerForReceiveUpdates"
          value={props.actionName}
        />
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">
            Validation Format
          </label>
          <select
            value={props.validationFormat}
            onChange={(e) =>
              props.setValidationFormat(e.target.value as "email" | "")}
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
            onChange={(e) =>
              props.setWriteKind(e.target.value as "plain" | "encrypted")}
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="plain">plain</option>
            <option value="encrypted">encrypted</option>
          </select>
        </div>
        {props.writeKind === "plain"
          ? (
            <Field
              label="Plain Path"
              value={props.writePlainPath}
              onChange={props.setWritePlainPath}
              placeholder="mutable://accounts/:key/subscribers/updates/:signature"
            />
          )
          : (
            <Field
              label="Encrypted Path"
              value={props.writeEncPath}
              onChange={props.setWriteEncPath}
              placeholder="immutable://accounts/:key/subscribers/updates/:signature"
            />
          )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={props.updateSchema} className={PRIMARY_BUTTON}>
          Update Schema
        </button>
        <button onClick={props.fetchSchema} className={SECONDARY_BUTTON}>
          Fetch Schema
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
        <Field
          label="Action"
          formId={props.formId}
          name="actionName"
          defaultValue="registerForReceiveUpdates"
          value={props.actionName}
        />
        <Field
          label="Test Payload (string)"
          formId={props.formId}
          name="actionPayload"
          value={props.actionPayload}
        />
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
  appKey: string;
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
          label="App Public Key (Ed25519, hex)"
          value={props.appKey}
          onChange={(v) => props.setKeyBundle({ appKey: v })}
          placeholder="hex"
        />
        <TextArea
          label="Account Private Key (Ed25519, PEM)"
          value={props.accountPrivateKeyPem}
          onChange={(v) => props.setKeyBundle({ accountPrivateKeyPem: v })}
          placeholder="-----BEGIN PRIVATE KEY-----"
        />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Field
          label="Encryption Public Key (X25519, hex)"
          value={props.encryptionPublicKeyHex}
          onChange={(v) => props.setKeyBundle({ encryptionPublicKeyHex: v })}
          placeholder="hex"
        />
        <TextArea
          label="Encryption Private Key (X25519, PEM)"
          value={props.encryptionPrivateKeyPem}
          onChange={(v) => props.setKeyBundle({ encryptionPrivateKeyPem: v })}
          placeholder="-----BEGIN PRIVATE KEY-----"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={props.genAppKeys} className={SECONDARY_BUTTON}>
          Generate Keys
        </button>
      </div>
    </SectionCard>
  );
}

function AppProfileCard(props: {
  googleClientId: string;
  setGoogleClientId: (v: string) => void;
  allowedOrigins: string;
  setAllowedOrigins: (v: string) => void;
  currentProfile: any | null;
  appProfileError: string | null;
  reloadAppProfile: () => void;
  saveAppProfile: () => void;
}) {
  const formatCurrent = (
    value: string | string[] | null | undefined,
  ): string => {
    if (props.appProfileError) return `Error: ${props.appProfileError}`;
    if (!props.currentProfile) return "—";
    if (Array.isArray(value)) return value.join(", ");
    if (value === null || value === undefined || value === "") return "—";
    return String(value);
  };

  const ProfileRow = (
    { label, current, children }: {
      label: string;
      current: string;
      children: ReactNode;
    },
  ) => (
    <div className="grid md:grid-cols-3 gap-2 items-center">
      <div className="text-sm font-semibold">{label}</div>
      <div className="text-xs text-muted-foreground break-all">
        {current}
      </div>
      <div>{children}</div>
    </div>
  );

  return (
    <SectionCard title="App Profile" icon={<FileText className="h-4 w-4" />}>
      <div className="text-xs text-muted-foreground mb-3">
        Configure your app profile at{" "}
        <code className="text-xs">mutable://accounts/:appKey/app-profile</code>
      </div>
      <div className="grid gap-3">
        <div className="hidden md:grid md:grid-cols-3 text-xs text-muted-foreground">
          <span />
          <span>Current</span>
          <span>New</span>
        </div>

        <ProfileRow
          label="Google Client ID"
          current={formatCurrent(props.currentProfile?.googleClientId)}
        >
          <Field
            label="New Google Client ID"
            value={props.googleClientId}
            onChange={props.setGoogleClientId}
            placeholder="your-client-id.apps.googleusercontent.com"
          />
        </ProfileRow>

        <ProfileRow
          label="Allowed Origins"
          current={formatCurrent(props.currentProfile?.allowedOrigins)}
        >
          <Field
            label="New Allowed Origins (comma separated)"
            value={props.allowedOrigins}
            onChange={props.setAllowedOrigins}
            placeholder="*,https://example.com"
          />
        </ProfileRow>
      </div>

      <div className="flex flex-wrap gap-2 mt-2">
        <button onClick={props.reloadAppProfile} className={SECONDARY_BUTTON}>
          Reload App Profile
        </button>
        <button onClick={props.saveAppProfile} className={PRIMARY_BUTTON}>
          Save App Profile
        </button>
      </div>
    </SectionCard>
  );
}

function AuthSection(props: {
  signup: (u: string, p: string) => void;
  login: (u: string, p: string) => void;
  myKeys: () => void;
  googleClientId: string;
  googleMode: "signup" | "login";
  setGoogleMode: (mode: "signup" | "login") => void;
  googleButtonRef: RefObject<HTMLDivElement | null>;
}) {
  const [authMode, setAuthMode] = useState<"signup" | "login">("signup");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleAuth = () => {
    if (authMode === "signup") {
      props.signup(username, password);
    } else {
      props.login(username, password);
    }
  };

  // Sync authMode with googleMode
  const handleModeChange = (mode: "signup" | "login") => {
    setAuthMode(mode);
    props.setGoogleMode(mode);
  };

  return (
    <SectionCard
      title="Authentication"
      icon={<ShieldCheck className="h-4 w-4" />}
    >
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => handleModeChange("signup")}
          className={authMode === "signup" ? PRIMARY_BUTTON : SECONDARY_BUTTON}
        >
          Signup
        </button>
        <button
          onClick={() => handleModeChange("login")}
          className={authMode === "login" ? PRIMARY_BUTTON : SECONDARY_BUTTON}
        >
          Login
        </button>
        <button onClick={props.myKeys} className={SECONDARY_BUTTON}>
          My Keys
        </button>
      </div>

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
        <button onClick={handleAuth} className={PRIMARY_BUTTON}>
          Continue with Username & Password
        </button>

        {props.googleClientId && (
          <>
            <hr className="border-border" />
            <div ref={props.googleButtonRef} />
          </>
        )}
      </div>
    </SectionCard>
  );
}

function ProxyWriteSection(props: {
  formId: string;
  writePlain: () => void;
  writeEnc: () => void;
}) {
  return (
    <SectionCard title="Proxy Write" icon={<Server className="h-4 w-4" />}>
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
        placeholder='{"name":"Test User"}'
      />
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
  appSession,
  session,
  lastResolvedUri,
  lastAppUri,
}: {
  appKey: string;
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
        <StateRow label="App Session" value={appSession} />
        <StateRow label="User" value={session?.username || "-"} />
        <StateRow label="Authenticated" value={session ? "yes" : "no"} />
        <StateRow label="Login Session (JWT)" value={session?.token || "-"} />
        <StateRow
          label="Expires In"
          value={session?.expiresIn?.toString() || "-"}
        />
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
      <span className="font-mono text-xs text-right truncate max-w-[180px]">
        {value || "-"}
      </span>
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
