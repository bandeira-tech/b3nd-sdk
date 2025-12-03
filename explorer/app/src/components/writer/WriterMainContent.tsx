import { type RefObject, useEffect, useRef, useState } from "react";
import {
  Activity,
  ChevronRight,
  FileText,
  KeyRound,
  PanelRightOpen,
  PenSquare,
  Server,
  ShieldCheck,
} from "lucide-react";
import { useActiveBackend, useAppStore } from "../../stores/appStore";
import type { AppLogEntry, KeyBundle } from "../../types";
import { SectionCard } from "../common/SectionCard";
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
  loginWithPassword,
  proxyWrite,
  saveAppProfile as saveAppProfileService,
  signAppPayload,
  signEncryptedAppPayload,
  signupWithPassword,
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
    walletServers,
    activeWalletServerId,
    appServers,
    activeAppServerId,
    panels,
  togglePanel,
  setFormValue,
  getFormValue,
  writerAppSession,
  writerSession,
  setWriterAppSession,
  setWriterSession,
  setWriterLastResolvedUri,
  setWriterLastAppUri,
    addWriterOutput,
    accounts,
    activeAccountId,
  } = useAppStore();
  const session = writerSession;
  const appSession = writerAppSession;
  const activeAccount = accounts.find((a) => a.id === activeAccountId) || null;
  const activeWallet = walletServers.find((w) =>
    w.id === activeWalletServerId && w.isActive
  );
  const activeAppServer = appServers.find((w) =>
    w.id === activeAppServerId && w.isActive
  );
  const activeBackend = useActiveBackend();

  const FORM_BACKEND = "writer-backend";
  const FORM_APP = "writer-app";
  const FORM_AUTH = "writer-auth";
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const [googleMode, setGoogleMode] = useState<"signup" | "login">("signup");
  const [allowedOrigins, setAllowedOrigins] = useState("*");
  const [currentAppProfile, setCurrentAppProfile] = useState<unknown>(null);
  const [appProfileError, setAppProfileError] = useState<string | null>(null);
  const [backendHistory, setBackendHistory] = useState<
    Array<{ id: string; label: string; uri: string; result: any }>
  >([]);
  const {
    appKey,
    accountPrivateKeyPem,
    encryptionPublicKeyHex,
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

  const requireActiveAccount = () => {
    if (!activeAccount) {
      throw new Error("Active account is required");
    }
    return activeAccount;
  };

  const handleAction = async (label: string, action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Writer] ${label} failed`, error);
      addWriterOutput({ error: message });
      logLine("local", `${label} failed: ${message}`, "error");
    }
  };

  const requireWalletClient = () => {
    if (!activeWallet) {
      throw new Error("Active wallet server is required");
    }
    return createWalletClient(activeWallet.url);
  };

  const requireBackendClient = () => {
    if (!activeBackend) {
      throw new Error("Active backend is required");
    }
    return createBackendClient(activeBackend);
  };

  const requireAppsClient = () => {
    if (!activeAppServer) {
      throw new Error("Active app server is required");
    }
    return createAppsClient(activeAppServer.url);
  };

  const loadAppProfile = async () => {
    ensureValue(appKey, "Auth key");
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
    addWriterOutput({
      publicKeyHex: bundle.appKey,
      privateKeyPem: bundle.accountPrivateKeyPem,
      encryptionPublicKeyHex: bundle.encryptionPublicKeyHex,
      encryptionPrivateKeyPem: bundle.encryptionPrivateKeyPem,
    });
    logLine("local", "Generated app keys (identity + encryption)", "success");
  };
  const saveAppProfile = async () => {
    ensureValue(appKey, "Auth key");

    const origins = allowedOrigins
      .split(",")
      .map((o) => o.trim())
      .filter((o) => o.length > 0);

    const { uri, response } = await saveAppProfileService({
      backendClient: requireBackendClient(),
      appKey,
      accountPrivateKeyPem,
      googleClientId: null,
      allowedOrigins: origins.length > 0 ? origins : ["*"],
      encryptionPublicKeyHex: encryptionPublicKeyHex || null,
    });

    if (response.success) {
      logLine("backend", `App profile saved to ${uri}`, "success");
      addWriterOutput(response, uri);
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
    addWriterOutput(res);
    logLine("apps", "Schema updated", "success");
  };

  const fetchSchema = async () => {
    const res = await fetchSchemaService({
      appsClient: requireAppsClient(),
      appKey,
    });
    addWriterOutput(res);
    logLine("apps", "Schema fetched", "info");
  };

  const createSession = async () => {
    const res = await createSessionService({
      appsClient: requireAppsClient(),
      appKey,
      accountPrivateKeyPem,
    });
    setWriterAppSession(res.session);
    addWriterOutput(res);
    logLine("apps", "Session created", "success");
  };

  const signup = async (username: string, password: string) => {
    const s = await signupWithPassword({
      walletClient: requireWalletClient(),
      appKey,
      username,
      password,
    });
    setWriterSession(s);
    logLine("wallet", "Signup ok", "success");
    addWriterOutput(s);
  };

  const login = async (username: string, password: string) => {
    const s = await loginWithPassword({
      walletClient: requireWalletClient(),
      appKey,
      session: appSession,
      username,
      password,
    });
    setWriterSession(s);
    logLine("wallet", "Login ok", "success");
    addWriterOutput(s);
  };

  // Google auth temporarily disabled

  const myKeys = async () => {
    if (!session) throw new Error("Session required");
    const k = await fetchMyKeys({
      walletClient: requireWalletClient(),
      appKey,
      session,
    });
    addWriterOutput(k);
    logLine("wallet", "My keys ok", "info");
  };

  const backendWritePlain = async () => {
    const account = requireActiveAccount();
    const { targetUri, response } = await backendWritePlainService({
      backendClient: requireBackendClient(),
      appKey: account.keyBundle.appKey,
      accountPrivateKeyPem: account.keyBundle.accountPrivateKeyPem,
      writeUri,
      writePayload,
    });
    addWriterOutput(response, targetUri);
    setWriterLastResolvedUri(targetUri);
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
    const account = requireActiveAccount();
    ensureValue(account.keyBundle.encryptionPublicKeyHex, "Encryption public key");
    const { targetUri, response } = await backendWriteEncService({
      backendClient: requireBackendClient(),
      appKey: account.keyBundle.appKey,
      accountPrivateKeyPem: account.keyBundle.accountPrivateKeyPem,
      encryptionPublicKeyHex: account.keyBundle.encryptionPublicKeyHex,
      writeUri,
      writePayload,
    });
    addWriterOutput(response, targetUri);
    setWriterLastResolvedUri(targetUri);
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
    const resolvedUri = (r as any).resolvedUri as string | undefined;
    addWriterOutput(r, resolvedUri);
    if (resolvedUri) {
      setWriterLastResolvedUri(resolvedUri);
    }
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
    const resolvedUri = (r as any).resolvedUri as string | undefined;
    addWriterOutput(r, resolvedUri);
    if (resolvedUri) {
      setWriterLastResolvedUri(resolvedUri);
    }
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
    addWriterOutput(res, res?.uri);
    if (res?.uri) setWriterLastAppUri(res.uri);
    logLine("apps", `Invoked action '${actionName}'`, "info");
  };

  useEffect(() => {
    if (!panels.right) {
      togglePanel("right");
    }
  }, [panels.right, togglePanel]);

  // Google auth is temporarily disabled (no client ID input)

  const rightOpen = panels.right;

  return (
    <div className="h-full flex overflow-hidden bg-background text-foreground">
      <div className="flex-1 overflow-auto custom-scrollbar">
        <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-muted/30">
          <WriterBreadcrumb writerSection={writerSection} />
        </div>
        <div className="p-6 space-y-4 max-w-6xl mx-auto">
          {writerSection === "configuration" && (
            <>
              <KeyDisplayCard title="Current Auth Keys" bundle={keyBundle} />
              <CurrentProfileCard
                currentProfile={currentAppProfile}
                error={appProfileError}
              />
            </>
          )}
          {writerSection === "backend"
            ? <BackendHistory history={backendHistory} />
            : null}
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
                <GenerateKeysCard
                  onGenerate={() => handleAction("Generate keys", genAppKeys)}
                />
                <AppProfileCard
                  allowedOrigins={allowedOrigins}
                  setAllowedOrigins={setAllowedOrigins}
                  loadAppProfile={() =>
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
                  updateSchema={() =>
                    handleAction("Update schema", updateSchema)}
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
                  googleMode={googleMode}
                  setGoogleMode={setGoogleMode}
                  googleButtonRef={googleButtonRef}
                />
                <ProxyWriteSection
                  formId={FORM_AUTH}
                  writePlain={() =>
                    handleAction("Proxy write plain", writePlain)}
                  writeEnc={() =>
                    handleAction("Proxy write encrypted", writeEnc)}
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
  { history }: {
    history: Array<{ id: string; label: string; uri: string; result: any }>;
  },
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
              <span className="font-semibold text-foreground">
                {entry.label}
              </span>
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

function AppProfileCard(props: {
  allowedOrigins: string;
  setAllowedOrigins: (v: string) => void;
  loadAppProfile: () => void;
  saveAppProfile: () => void;
}) {
  return (
    <SectionCard title="App Profile" icon={<FileText className="h-4 w-4" />}>
      <div className="text-xs text-muted-foreground mb-3">
        Configure your app profile at{" "}
        <code className="text-xs">mutable://accounts/:appKey/app-profile</code>
      </div>
      <div className="space-y-4">
        <Field
          label="Allowed Origins (comma separated)"
          value={props.allowedOrigins}
          onChange={props.setAllowedOrigins}
          placeholder="*,https://example.com"
        />
      </div>

      <div className="flex flex-wrap gap-2 mt-2">
        <button
          onClick={props.loadAppProfile}
          className={SECONDARY_BUTTON}
        >
          Load App Profile
        </button>
        <button onClick={props.saveAppProfile} className={PRIMARY_BUTTON}>
          Save App Profile
        </button>
      </div>
    </SectionCard>
  );
}

function GenerateKeysCard({ onGenerate }: { onGenerate: () => void }) {
  return (
    <SectionCard title="Keys" icon={<KeyRound className="h-4 w-4" />}>
      <div className="text-xs text-muted-foreground">
        Generate a new identity and encryption key pair.
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={onGenerate} className={PRIMARY_BUTTON}>
          Generate Keys
        </button>
      </div>
    </SectionCard>
  );
}

function KeyDisplayCard(
  { title, bundle }: { title: string; bundle: KeyBundle },
) {
  return (
    <SectionCard title={title} icon={<KeyRound className="h-4 w-4" />}>
      <div className="text-xs text-muted-foreground mb-3">
        Private keys are hidden; add a copy action when you need them.
      </div>
      <KeysTable bundle={bundle} />
    </SectionCard>
  );
}

function KeysTable({ bundle }: { bundle: KeyBundle }) {
  const rows: Array<{
    label: string;
    value: string;
    isSecret?: boolean;
  }> = [
    { label: "Auth Public Key", value: bundle.appKey },
    { label: "Encryption Public Key", value: bundle.encryptionPublicKeyHex },
    {
      label: "Account Private Key",
      value: bundle.accountPrivateKeyPem,
      isSecret: true,
    },
    {
      label: "Encryption Private Key",
      value: bundle.encryptionPrivateKeyPem,
      isSecret: true,
    },
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <KeyRow
              key={row.label}
              label={row.label}
              value={row.value}
              isSecret={row.isSecret}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KeyRow(
  { label, value, isSecret }: { label: string; value: string; isSecret?: boolean },
) {
  const resolvedValue = value || "Not set";

  return (
    <tr className="align-top">
      <td className="w-1/3 bg-muted/50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </td>
      <td className="px-3 py-2">
        {isSecret
          ? (
            <span className="text-muted-foreground">
              Hidden for now; copying will be available soon.
            </span>
          )
          : <span className="font-mono break-all">{resolvedValue}</span>}
      </td>
    </tr>
  );
}

function CurrentProfileCard(
  { currentProfile, error }: { currentProfile: unknown; error: string | null },
) {
  const profileObject = isRecord(currentProfile) ? currentProfile : null;
  const hasProfileEntries = profileObject
    ? Object.keys(profileObject).length > 0
    : false;

  return (
    <SectionCard title="Current App Profile" icon={<FileText className="h-4 w-4" />}>
      {error && (
        <div className="text-sm text-destructive mb-2">
          {error}
        </div>
      )}
      {!currentProfile && !error && (
        <div className="text-sm text-muted-foreground">No profile loaded.</div>
      )}
      {profileObject && hasProfileEntries && (
        <ProfileTable profile={profileObject} />
      )}
      {profileObject && !hasProfileEntries && (
        <div className="text-sm text-muted-foreground">Profile is empty.</div>
      )}
      {Boolean(currentProfile) && !profileObject && (
        <pre className="bg-muted rounded p-3 text-xs max-h-[320px] overflow-auto custom-scrollbar">
          {JSON.stringify(currentProfile, null, 2)}
        </pre>
      )}
    </SectionCard>
  );
}

function ProfileTable({ profile }: { profile: Record<string, unknown> }) {
  const entries = Object.entries(profile);

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-border">
          {entries.map(([key, value]) => (
            <tr key={key} className="align-top">
              <td className="w-1/3 bg-muted/50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {key}
              </td>
              <td className="px-3 py-2">
                <ProfileValue value={value} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProfileValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">Not set</span>;
  }

  if (Array.isArray(value)) {
    return (
      <div className="flex flex-wrap gap-2">
        {value.map((item, index) => (
          <span
            key={`${String(item)}-${index}`}
            className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-foreground"
          >
            {typeof item === "string" || typeof item === "number"
              ? String(item)
              : JSON.stringify(item)}
          </span>
        ))}
      </div>
    );
  }

  if (typeof value === "object") {
    return (
      <pre className="text-xs bg-background border border-border rounded p-2 overflow-auto max-h-40">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  return <span className="font-mono break-all">{String(value)}</span>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function AuthSection(props: {
  signup: (u: string, p: string) => void;
  login: (u: string, p: string) => void;
  myKeys: () => void;
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
