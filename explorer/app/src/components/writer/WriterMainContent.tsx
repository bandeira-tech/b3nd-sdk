import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import {
  IdentityKey,
  SecretEncryptionKey,
  createSignedEncryptedMessage,
} from "@bandeira-tech/b3nd-web/encrypt";
import {
  Activity,
  ChevronRight,
  FileText,
  KeyRound,
  Lock,
  PanelRightOpen,
  PenSquare,
  Server,
  ShieldCheck,
  Share2,
  Upload,
  Image,
  File,
  CheckCircle2,
  XCircle,
  Link as LinkIcon,
} from "lucide-react";
import { useActiveBackend, useAppStore } from "../../stores/appStore";
import type {
  AppLogEntry,
  ManagedAccount,
  ManagedKeyAccount,
  WriterSection,
  WriterUserSession,
  WriterAppSession,
} from "../../types";
import { SectionCard } from "../common/SectionCard";
import { AuthSection } from "../auth/AuthSection";
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
  googleLogin,
  googleSignup,
  loginWithPassword,
  proxyWrite,
  saveAppProfile as saveAppProfileService,
  signAppPayload,
  signEncryptedAppPayload,
  signupWithPassword,
  updateSchema as updateSchemaService,
  uploadBlob,
  uploadBlobWithLink,
  type BlobUploadResult,
} from "../../services/writer/writerService";
import { routeForExplorerPath, sanitizePath } from "../../utils";

type AuthKeys = {
  accountPublicKeyHex: string;
  encryptionPublicKeyHex: string;
};
const PRIMARY_BUTTON =
  "inline-flex items-center justify-center rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const SECONDARY_BUTTON =
  "inline-flex items-center justify-center rounded border border-border bg-muted px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const DISABLED_BUTTON =
  "disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-muted/70 disabled:text-muted-foreground disabled:border-muted";
export function WriterMainContent() {
  const {
    writerSection,
    addLogEntry,
    walletServers,
    activeWalletServerId,
    appServers,
    activeAppServerId,
    googleClientId,
    setGoogleClientId,
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
  const [allowedOrigins, setAllowedOrigins] = useState("*");
  const [currentAppProfile, setCurrentAppProfile] = useState<unknown>(null);
  const [appProfileError, setAppProfileError] = useState<string | null>(null);
  const [backendHistory, setBackendHistory] = useState<
    Array<{ id: string; label: string; uri: string; result: unknown }>
  >([]);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [authKeys, setAuthKeys] = useState<AuthKeys | null>(null);
  const [shareIdentityKey, setShareIdentityKey] = useState<{
    identity: IdentityKey;
    publicKeyHex: string;
    privateKeyPem: string;
  } | null>(null);
  const [lastShareUri, setLastShareUri] = useState<string | null>(null);
  const [lastShareLink, setLastShareLink] = useState<string | null>(null);
  const [lastExplorerRoute, setLastExplorerRoute] = useState<string | null>(null);
  // Blob upload state
  const [blobHistory, setBlobHistory] = useState<BlobUploadResult[]>([]);
  const [blobEncryptEnabled, setBlobEncryptEnabled] = useState(true);
  const [blobLinkEnabled, setBlobLinkEnabled] = useState(false);
  const [blobLinkPath, setBlobLinkPath] = useState("");
  const [blobUploading, setBlobUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const extractResolvedUri = (value: unknown) => {
    if (value && typeof value === "object" && "resolvedUri" in value) {
      const uri = (value as { resolvedUri?: unknown }).resolvedUri;
      return typeof uri === "string" ? uri : undefined;
    }
    return undefined;
  };

  const generateShareIdentity = async () => {
    const { key, privateKeyPem, publicKeyHex } = await IdentityKey.generate();
    setShareIdentityKey({ identity: key, publicKeyHex, privateKeyPem });
    return { publicKeyHex, privateKeyPem };
  };

  const getActiveAccount = (): ManagedAccount => {
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

  const requireApplicationAccount = (): ManagedKeyAccount => {
    if (!activeAccount || activeAccount.type !== "application") {
      throw new Error("Select an application account to continue");
    }
    return activeAccount;
  };

  const loadAppProfile = async () => {
    const appAccount = requireApplicationAccount();
    const appKey = appAccount.keyBundle.appKey;
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
    if (res.payload && typeof res.payload === "object") {
      const profile = res.payload as Record<string, unknown>;
      if (Array.isArray(profile.allowedOrigins)) {
        setAllowedOrigins(profile.allowedOrigins.join(","));
      }
      if (typeof profile.googleClientId === "string") {
        setGoogleClientId(profile.googleClientId);
      }
    }
    logLine("backend", `Loaded app profile from ${res.uri}`, "info");
  };

  const saveAppProfile = async () => {
    const appAccount = requireApplicationAccount();
    const appKey = appAccount.keyBundle.appKey;
    const accountPrivateKeyPem = appAccount.keyBundle.accountPrivateKeyPem;
    const encryptionPublicKeyHex = appAccount.keyBundle.encryptionPublicKeyHex;
    ensureValue(appKey, "Auth key");

    const origins = allowedOrigins
      .split(",")
      .map((o) => o.trim())
      .filter((o) => o.length > 0);

    const { uri, response } = await saveAppProfileService({
      backendClient: requireBackendClient(),
      appKey,
      accountPrivateKeyPem,
      googleClientId: googleClientId ? googleClientId.trim() : null,
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
    const appAccount = requireApplicationAccount();
    const appKey = appAccount.keyBundle.appKey;
    const accountPrivateKeyPem = appAccount.keyBundle.accountPrivateKeyPem;
    const encryptionPublicKeyHex = appAccount.keyBundle.encryptionPublicKeyHex;
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
    const appAccount = requireApplicationAccount();
    const appKey = appAccount.keyBundle.appKey;
    const res = await fetchSchemaService({
      appsClient: requireAppsClient(),
      appKey,
    });
    addWriterOutput(res);
    logLine("apps", "Schema fetched", "info");
  };

  const createSession = async () => {
    const appAccount = requireApplicationAccount();
    const appKey = appAccount.keyBundle.appKey;
    const accountPrivateKeyPem = appAccount.keyBundle.accountPrivateKeyPem;
    const res = await createSessionService({
      appsClient: requireAppsClient(),
      backendClient: requireBackendClient(),
      appKey,
      accountPrivateKeyPem,
    });
    setWriterAppSession({
      sessionId: res.session,
      sessionKeypair: res.sessionKeypair,
    });
    setSessionStartedAt(Date.now());
    addWriterOutput(res);
    logLine("apps", "Session created", "success");
  };

  const finishSession = () => {
    setWriterAppSession(null);
    setWriterSession(null);
    setAuthKeys(null);
    setSessionStartedAt(null);
    logLine("apps", "Session cleared", "info");
  };

  const signup = async (username: string, password: string) => {
    const appAccount = requireApplicationAccount();
    const appKey = appAccount.keyBundle.appKey;
    if (!appSession?.sessionKeypair) {
      throw new Error("Session keypair is required - start a session first");
    }
    const s = await signupWithPassword({
      walletClient: requireWalletClient(),
      appKey,
      sessionKeypair: appSession.sessionKeypair,
      username,
      password,
    });
    setWriterSession(s);
    await fetchKeysForSession(s);
    logLine("wallet", "Signup ok", "success");
    addWriterOutput(s);
  };

  const login = async (username: string, password: string) => {
    const appAccount = requireApplicationAccount();
    const appKey = appAccount.keyBundle.appKey;
    if (!appSession?.sessionKeypair) {
      throw new Error("Session keypair is required - start a session first");
    }
    const s = await loginWithPassword({
      walletClient: requireWalletClient(),
      appKey,
      sessionKeypair: appSession.sessionKeypair,
      username,
      password,
    });
    setWriterSession(s);
    await fetchKeysForSession(s);
    logLine("wallet", "Login ok", "success");
    addWriterOutput(s);
  };

  const handleGoogleSignup = async (idToken: string) => {
    const appAccount = requireApplicationAccount();
    const appKey = appAccount.keyBundle.appKey;
    ensureValue(idToken, "Google ID token");
    if (!appSession?.sessionKeypair) {
      throw new Error("Session keypair is required - start a session first");
    }
    const s = await googleSignup({
      walletClient: requireWalletClient(),
      appKey,
      sessionKeypair: appSession.sessionKeypair,
      googleIdToken: idToken,
    });
    setWriterSession(s);
    await fetchKeysForSession(s);
    logLine("wallet", "Google signup ok", "success");
    addWriterOutput(s);
  };

  const handleGoogleLogin = async (idToken: string) => {
    const appAccount = requireApplicationAccount();
    const appKey = appAccount.keyBundle.appKey;
    ensureValue(idToken, "Google ID token");
    if (!appSession?.sessionKeypair) {
      throw new Error("Session keypair is required - start a session first");
    }
    const s = await googleLogin({
      walletClient: requireWalletClient(),
      appKey,
      sessionKeypair: appSession.sessionKeypair,
      googleIdToken: idToken,
    });
    setWriterSession(s);
    await fetchKeysForSession(s);
    logLine("wallet", "Google login ok", "success");
    addWriterOutput(s);
  };

  const fetchKeysForSession = async (currentSession: WriterUserSession) => {
    const appAccount = requireApplicationAccount();
    const appKey = appAccount.keyBundle.appKey;
    const keys = await fetchMyKeys({
      walletClient: requireWalletClient(),
      appKey,
      session: currentSession,
    });
    setAuthKeys(keys);
    addWriterOutput(keys);
    logLine("wallet", "My keys ok", "info");
  };

  useEffect(() => {
    if (!session) {
      setAuthKeys(null);
      return;
    }
    if (writerSection === "auth") {
      void fetchKeysForSession(session);
    }
  }, [session, writerSection]);

  useEffect(() => {
    if (appSession && !sessionStartedAt) {
      setSessionStartedAt(Date.now());
    }
  }, [appSession, sessionStartedAt]);

  const backendWritePlain = async () => {
    const account = getActiveAccount();
    if (account.type === "application-user") {
      if (!account.userSession) {
        throw new Error("User session is required");
      }
      ensureValue(writePayload, "Write payload");
      const data = JSON.parse(writePayload);
      const result = await proxyWrite({
        walletClient: requireWalletClient(),
        session: account.userSession,
        uri: writeUri,
        data,
        encrypt: false,
      });
      const resolvedUri = extractResolvedUri(result);
      addWriterOutput(result, resolvedUri);
      if (resolvedUri) {
        setWriterLastResolvedUri(resolvedUri);
      }
      logLine("wallet", "Proxy write (plain) ok", "success");
      setBackendHistory((prev) => [
        {
          id: crypto.randomUUID(),
          label: "Proxy write (plain)",
          uri: resolvedUri || writeUri,
          result,
        },
        ...prev,
      ]);
      return;
    }

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
    const account = getActiveAccount();
    if (account.type === "application-user") {
      if (!account.userSession) {
        throw new Error("User session is required");
      }
      ensureValue(writePayload, "Write payload");
      const data = JSON.parse(writePayload);
      const result = await proxyWrite({
        walletClient: requireWalletClient(),
        session: account.userSession,
        uri: writeUri,
        data,
        encrypt: true,
      });
      const resolvedUri = extractResolvedUri(result);
      addWriterOutput(result, resolvedUri);
      if (resolvedUri) {
        setWriterLastResolvedUri(resolvedUri);
      }
      logLine("wallet", "Proxy write (encrypted) ok", "success");
      setBackendHistory((prev) => [
        {
          id: crypto.randomUUID(),
          label: "Proxy write (encrypted)",
          uri: resolvedUri || writeUri,
          result,
        },
        ...prev,
      ]);
      return;
    }

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
    const resolvedUri = extractResolvedUri(r);
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
    const resolvedUri = extractResolvedUri(r);
    addWriterOutput(r, resolvedUri);
    if (resolvedUri) {
      setWriterLastResolvedUri(resolvedUri);
    }
    logLine("wallet", "Write enc ok", "success");
  };

  const testAction = async () => {
    const appAccount = requireApplicationAccount();
    const appKey = appAccount.keyBundle.appKey;
    const accountPrivateKeyPem = appAccount.keyBundle.accountPrivateKeyPem;
    const encryptionPublicKeyHex = appAccount.keyBundle.encryptionPublicKeyHex;
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

  const saveShareableContent = async () => {
    const shareLocation = getFormValue("shareable-content", "share-location", "") as string;
    const shareMatter = getFormValue("shareable-content", "share-matter", "") as string;
    const shareContent = getFormValue("shareable-content", "share-content", "") as string;
    if (!shareIdentityKey) {
      throw new Error("Generate an identity key first");
    }
    const rawLocation = shareLocation.trim();
    ensureValue(rawLocation, "Location");
    ensureValue(shareMatter, "Encryption matter");
    ensureValue(shareContent, "Content");
    const resolvedLocation = rawLocation.replace(/:key/g, shareIdentityKey.publicKeyHex);
    if (!resolvedLocation) {
      throw new Error("Location must not be empty");
    }
    const secretKey = await SecretEncryptionKey.fromSecret({
      secret: shareMatter,
      salt: shareIdentityKey.publicKeyHex,
    });
    const explorerRoute = explorerRouteFromUri(resolvedLocation);
    const linkLocation = (() => {
      const match = resolvedLocation.match(/^([a-z]+):\/\/accounts\/([^/]+)\/(.+)$/);
      if (match && match[2] === shareIdentityKey.publicKeyHex) {
        return match[3];
      }
      return resolvedLocation;
    })();
    const targetUri = resolvedLocation;
    const signed = await createSignedEncryptedMessage({
      data: shareContent,
      identity: shareIdentityKey.identity,
      encryptionKey: secretKey,
    });
    const backendClient = requireBackendClient();
    const response = await backendClient.write(targetUri, signed);
    const shareLink = `${shareMatter}#l=${shareIdentityKey.publicKeyHex}/${linkLocation}`;
    setLastShareUri(targetUri);
    setLastShareLink(shareLink);
    setLastExplorerRoute(explorerRoute);
    addWriterOutput({ uri: targetUri, response, shareLink });
    logLine("backend", `Encrypted content saved to ${targetUri}`, "success");
  };

  // Blob upload handler
  const handleBlobUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setBlobUploading(true);
    const backendClient = requireBackendClient();
    const account = activeAccount;

    try {
      for (const file of Array.from(files)) {
        let result: BlobUploadResult & { linkResponse?: { success: boolean; error?: string } };

        // Get encryption key if enabled
        const encryptionKey = blobEncryptEnabled && account?.type === "application"
          ? account.keyBundle.encryptionPublicKeyHex
          : undefined;

        if (blobLinkEnabled && account?.type === "application" && blobLinkPath) {
          // Upload with authenticated link
          result = await uploadBlobWithLink({
            backendClient,
            file,
            linkPath: blobLinkPath.replace(/:filename/g, file.name),
            appKey: account.keyBundle.appKey,
            accountPrivateKeyPem: account.keyBundle.accountPrivateKeyPem,
            encryptToPublicKey: encryptionKey,
          });
          logLine(
            "backend",
            `Blob uploaded: ${file.name} -> ${result.blobUri}${result.linkUri ? ` (link: ${result.linkUri})` : ""}`,
            result.response.success ? "success" : "error",
          );
        } else {
          // Upload blob only
          result = await uploadBlob({
            backendClient,
            file,
            encryptToPublicKey: encryptionKey,
          });
          logLine(
            "backend",
            `Blob uploaded: ${file.name} -> ${result.blobUri}`,
            result.response.success ? "success" : "error",
          );
        }

        setBlobHistory((prev) => [result, ...prev]);
        addWriterOutput(result);
      }
    } finally {
      setBlobUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

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
              <ApplicationAccountContext activeAccount={activeAccount} />
              <CurrentProfileCard
                currentProfile={currentAppProfile}
                error={appProfileError}
              />
            </>
          )}
          {writerSection === "auth" && (
            <div className="space-y-4">
              <SessionStateCard session={appSession} startedAt={sessionStartedAt} />
              <AuthenticationStateCard session={session} keys={authKeys} />
            </div>
          )}
          {writerSection === "backend"
            ? <BackendHistory history={backendHistory} />
            : null}
          {writerSection === "blob" && (
            <BlobUploadHistory history={blobHistory} />
          )}
          {writerSection === "shareable" && (
            <SectionCard title="Shareable Content" icon={<Share2 className="h-4 w-4" />}>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Generate a one-off identity key, derive an encryption key from a shared phrase,
                  and store encrypted content at a specific account path. Share the generated link
                  to let apps derive the key and locate the payload.
                </p>
                {lastShareLink && (
                  <div className="rounded border border-border bg-muted/30 p-3 space-y-1">
                    <div className="text-xs font-semibold text-muted-foreground">
                      Shareable link fragment
                    </div>
                    <code className="block text-xs break-all text-foreground">
                      {lastShareLink}
                    </code>
                    {lastShareUri && (
                      <div className="text-xs text-muted-foreground">
                        Written to <span className="font-mono text-foreground">{lastShareUri}</span>
                      </div>
                    )}
                    {lastExplorerRoute && (
                      <div>
                        <Link
                          to={lastExplorerRoute}
                          className="text-xs text-primary hover:underline"
                        >
                          Open in Explorer
                        </Link>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      {rightOpen && (
        <aside className="w-[420px] border-l border-border bg-card flex flex-col">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <PanelRightOpen className="h-4 w-4" />
              <span className="text-sm font-semibold">Controls</span>
            </div>
            <button
              onClick={() => togglePanel("right")}
              className="p-1 rounded hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="Close panel"
            >
              <span className="sr-only">Close</span>
              &times;
            </button>
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

            {writerSection === "blob" && (
              <div className="space-y-4">
                <SectionCard title="Upload Files" icon={<Upload className="h-4 w-4" />}>
                  <div className="space-y-4">
                    <div className="text-sm text-muted-foreground">
                      Upload files as content-addressed blobs. Files are encrypted by default
                      when an application account is selected.
                    </div>

                    {/* File input */}
                    <div className="space-y-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept="image/*,application/pdf,.txt,.json,.md"
                        onChange={(e) =>
                          handleAction("Upload blob", () => handleBlobUpload(e.target.files))}
                        className="hidden"
                        id="blob-file-input"
                      />
                      <label
                        htmlFor="blob-file-input"
                        className={`${PRIMARY_BUTTON} w-full cursor-pointer flex items-center justify-center gap-2 ${blobUploading ? "opacity-50 pointer-events-none" : ""}`}
                      >
                        <Upload className="h-4 w-4" />
                        {blobUploading ? "Uploading..." : "Select Files"}
                      </label>
                    </div>

                    {/* Encryption toggle */}
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Encrypt blob</label>
                      <button
                        type="button"
                        onClick={() => setBlobEncryptEnabled(!blobEncryptEnabled)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${blobEncryptEnabled ? "bg-primary" : "bg-muted"}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${blobEncryptEnabled ? "translate-x-6" : "translate-x-1"}`}
                        />
                      </button>
                    </div>
                    {blobEncryptEnabled && (
                      <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                        Files will be encrypted using your application's encryption key before
                        being hashed and stored. Only you can decrypt them.
                      </div>
                    )}

                    {/* Link creation toggle */}
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Create authenticated link</label>
                      <button
                        type="button"
                        onClick={() => setBlobLinkEnabled(!blobLinkEnabled)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${blobLinkEnabled ? "bg-primary" : "bg-muted"}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${blobLinkEnabled ? "translate-x-6" : "translate-x-1"}`}
                        />
                      </button>
                    </div>
                    {blobLinkEnabled && (
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">
                          Link path (use :filename for file name)
                        </label>
                        <input
                          type="text"
                          value={blobLinkPath}
                          onChange={(e) => setBlobLinkPath(e.target.value)}
                          placeholder="files/:filename"
                          className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
                        />
                        <div className="text-xs text-muted-foreground">
                          Creates link at: link://accounts/:key/{blobLinkPath || "files/:filename"}
                        </div>
                      </div>
                    )}
                  </div>
                </SectionCard>

                {activeAccount?.type !== "application" && (
                  <div className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-3 rounded border border-amber-200 dark:border-amber-800">
                    Select an application account to enable encryption and authenticated links.
                  </div>
                )}
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
                <AppProfileCard
                  allowedOrigins={allowedOrigins}
                  setAllowedOrigins={setAllowedOrigins}
                  googleClientId={googleClientId}
                  setGoogleClientId={setGoogleClientId}
                  loadAppProfile={() =>
                    handleAction("Load app profile", loadAppProfile)}
                  saveAppProfile={() =>
                    handleAction("Save app profile", saveAppProfile)}
                  disabled={!activeAccount || activeAccount.type !== "application"}
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
                  onStart={() =>
                    handleAction("Start session", createSession)}
                  onFinish={finishSession}
                  hasSession={Boolean(appSession)}
                />
                <SectionCard title="Authentication" icon={<ShieldCheck className="h-4 w-4" />}>
                  <AuthSection
                    disabled={!appSession}
                    googleEnabled={Boolean(googleClientId)}
                    googleClientId={googleClientId}
                    signup={(u, p) =>
                      handleAction("Signup", () => signup(u, p))}
                    login={(u, p) => handleAction("Login", () => login(u, p))}
                    onGoogleCredential={(mode, token) =>
                      handleAction(
                        `Google ${mode}`,
                        () =>
                          mode === "signup"
                            ? handleGoogleSignup(token)
                            : handleGoogleLogin(token),
                      )}
                    primaryButtonClass={PRIMARY_BUTTON}
                    secondaryButtonClass={SECONDARY_BUTTON}
                    disabledClass={DISABLED_BUTTON}
                  />
                </SectionCard>
                <ProxyWriteSection
                  formId={FORM_AUTH}
                  writePlain={() =>
                    handleAction("Proxy write plain", writePlain)}
                  writeEnc={() =>
                    handleAction("Proxy write encrypted", writeEnc)}
                />
              </div>
            )}

            {writerSection === "shareable" && (
              <div className="space-y-4">
                <SectionCard title="Shareable Secret" icon={<Lock className="h-4 w-4" />}>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void generateShareIdentity();
                        }}
                        className={SECONDARY_BUTTON}
                      >
                        Generate identity key
                      </button>
                      {shareIdentityKey && (
                        <span className="text-xs text-muted-foreground truncate">
                          {shareIdentityKey.publicKeyHex}
                        </span>
                      )}
                    </div>
                    <Field
                      label="Location"
                      formId="shareable-content"
                      name="share-location"
                      placeholder="path/to/content"
                    />
                    <Field
                      label="Encryption matter"
                      formId="shareable-content"
                      name="share-matter"
                      placeholder="phrase used to derive key"
                    />
                    <TextArea
                      label="Content"
                      formId="shareable-content"
                      name="share-content"
                      placeholder="Secret content to encrypt"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleAction("Create shareable content", saveShareableContent)}
                        className={PRIMARY_BUTTON}
                      >
                        Encrypt & Save
                      </button>
                    </div>
                  </div>
                </SectionCard>
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
    writerSection: WriterSection;
  },
) {
  const labels: Record<
    WriterSection,
    string
  > = {
    backend: "Backend",
    blob: "Blob Upload",
    auth: "Auth",
    actions: "Actions",
    configuration: "Application",
    schema: "Schema",
    shareable: "Shareable",
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
    history: Array<{ id: string; label: string; uri: string; result: unknown }>;
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

function BlobUploadHistory({ history }: { history: BlobUploadResult[] }) {
  if (!history.length) {
    return (
      <SectionCard title="Uploaded Blobs" icon={<Upload className="h-4 w-4" />}>
        <div className="text-sm text-muted-foreground">
          No blobs uploaded yet. Use the controls on the right to upload files.
        </div>
      </SectionCard>
    );
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <SectionCard title="Uploaded Blobs" icon={<Upload className="h-4 w-4" />}>
      <div className="space-y-3">
        {history.map((entry, idx) => (
          <div
            key={`${entry.hash}-${idx}`}
            className="rounded-lg border border-border p-3 bg-muted/40 space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {entry.contentType.startsWith("image/") ? (
                  <Image className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <File className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-sm font-medium truncate max-w-[200px]">
                  {entry.contentType}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatSize(entry.size)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {entry.encrypted && (
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                    Encrypted
                  </span>
                )}
                {entry.response.success ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
              </div>
            </div>
            <div className="text-xs space-y-1">
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Blob:</span>
                <code className="text-foreground break-all">{entry.blobUri}</code>
              </div>
              {entry.linkUri && (
                <div className="flex items-center gap-1">
                  <LinkIcon className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground">Link:</span>
                  <code className="text-foreground break-all">{entry.linkUri}</code>
                </div>
              )}
            </div>
            {entry.response.error && (
              <div className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                {entry.response.error}
              </div>
            )}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function SessionCard(
  { onStart, onFinish, hasSession }: {
    onStart: () => void;
    onFinish: () => void;
    hasSession: boolean;
  },
) {
  return (
    <SectionCard title="Session" icon={<KeyRound className="h-4 w-4" />}>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onStart}
          type="button"
          className={`${SECONDARY_BUTTON} ${DISABLED_BUTTON}`}
          disabled={hasSession}
        >
          Start
        </button>
        {hasSession && (
          <button
            type="button"
            onClick={onFinish}
            className={PRIMARY_BUTTON}
          >
            Finish
          </button>
        )}
      </div>
    </SectionCard>
  );
}

function SessionStateCard(
  { session, startedAt }: { session: WriterAppSession | null; startedAt: number | null },
) {
  const hasSession = Boolean(session);
  const startedLabel = startedAt
    ? new Date(startedAt).toLocaleString()
    : hasSession
    ? "Unknown"
    : "Not started";

  return (
    <SectionCard
      title="Session"
      icon={<KeyRound className="h-4 w-4" />}
    >
      <InfoTable
        rows={[
          {
            label: "Session Id",
            value: session?.sessionId || "Not created",
          },
          {
            label: "Start Time",
            value: startedLabel,
          },
        ]}
      />
    </SectionCard>
  );
}

function AuthenticationStateCard(
  { session, keys }: { session: WriterUserSession | null; keys: AuthKeys | null },
) {
  const rows = [
    { label: "Status", value: session ? "Authenticated" : "Not authenticated" },
    ...(session
      ? [
        { label: "User", value: session.username },
        { label: "Expires In", value: String(session.expiresIn) },
        { label: "Token", value: session.token },
      ]
      : []),
    ...(keys
      ? [
        { label: "Account Public Key", value: keys.accountPublicKeyHex },
        { label: "Encryption Public Key", value: keys.encryptionPublicKeyHex },
      ]
      : []),
  ];

  return (
    <SectionCard
      title="Authentication"
      icon={<ShieldCheck className="h-4 w-4" />}
    >
      <InfoTable rows={rows} />
    </SectionCard>
  );
}

function InfoTable({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.label} className="align-top">
              <td className="w-1/3 bg-muted/50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {row.label}
              </td>
              <td className="px-3 py-2">
                <span className="font-mono break-all text-xs">
                  {row.value || "—"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
  googleClientId: string;
  setGoogleClientId: (v: string) => void;
  loadAppProfile: () => void;
  saveAppProfile: () => void;
  disabled?: boolean;
}) {
  const disabled = props.disabled || false;

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
          disabled={disabled}
          onChange={props.setAllowedOrigins}
          placeholder="*,https://example.com"
        />
        <Field
          label="Google Client ID"
          value={props.googleClientId}
          disabled={disabled}
          onChange={props.setGoogleClientId}
          placeholder="your-google-client-id.apps.googleusercontent.com"
        />
      </div>

      <div className="flex flex-wrap gap-2 mt-2">
        <button
          onClick={props.loadAppProfile}
          className={`${SECONDARY_BUTTON} ${disabled ? DISABLED_BUTTON : ""}`}
          disabled={disabled}
        >
          Load App Profile
        </button>
        <button
          onClick={props.saveAppProfile}
          className={`${PRIMARY_BUTTON} ${disabled ? DISABLED_BUTTON : ""}`}
          disabled={disabled}
        >
          Save App Profile
        </button>
      </div>
      {disabled && (
        <div className="text-xs text-muted-foreground mt-2">
          Select an application account to manage its profile.
        </div>
      )}
    </SectionCard>
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

function ApplicationAccountContext(
  { activeAccount }: { activeAccount: ManagedAccount | null },
) {
  const isApplication = activeAccount?.type === "application";

  return (
    <SectionCard title="Application Context" icon={<KeyRound className="h-4 w-4" />}>
      {isApplication
        ? (
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
            <div className="flex items-center gap-3">
              <span className="text-lg leading-none">{activeAccount.emoji}</span>
              <div>
                <div className="font-semibold">{activeAccount.name}</div>
                <div className="text-[11px] uppercase text-muted-foreground tracking-wide">
                  Application Account
                </div>
                <div className="text-xs text-muted-foreground font-mono">
                  {activeAccount.keyBundle.appKey}
                </div>
              </div>
            </div>
          </div>
        )
        : (
          <div className="text-sm text-muted-foreground">
            Select an application account in Accounts to manage its profile.
          </div>
        )}
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
  disabled = false,
}: {
  label: string;
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  formId?: string;
  name?: string;
  defaultValue?: string;
  disabled?: boolean;
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
        disabled={disabled}
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

function explorerRouteFromUri(uri: string): string {
  const match = uri.match(/^([a-z0-9+.-]+):\/\/(.+)$/i);
  const protocol = match ? match[1] : null;
  const rest = match ? match[2] : uri;
  const path = protocol ? `/${protocol}/${rest}` : rest;
  return routeForExplorerPath(sanitizePath(path));
}
