import { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyRound,
  Plus,
  ShieldCheck,
  Trash2,
  UserCircle,
  UserPlus,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useActiveBackend, useAppStore } from "../../stores/appStore";
import {
  createAppsClient,
  createBackendClient,
  createSession,
  createWalletClient,
  fetchAppProfile,
  fetchMyKeys,
  generateAppKeys,
  googleLogin,
  googleSignup,
  loginWithPassword,
  signupWithPassword,
} from "../../services/writer/writerService";
import type {
  AccountAuthKeys,
  ManagedAccount,
  ManagedAccountType,
  ManagedApplicationUserAccount,
  ManagedKeyAccount,
  WriterUserSession,
} from "../../types";
import { cn, routeForExplorerPath } from "../../utils";
import { SectionCard } from "../common/SectionCard";

const PRIMARY_BUTTON =
  "inline-flex items-center justify-center rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const SECONDARY_BUTTON =
  "inline-flex items-center justify-center rounded border border-border bg-muted px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const DISABLED_BUTTON =
  "disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-muted/70 disabled:text-muted-foreground disabled:border-muted";

const ACCOUNT_TYPE_LABEL: Record<ManagedAccountType, string> = {
  account: "Account",
  application: "Application Account",
  "application-user": "Application User Account",
};

type IdentityDefaults = { name: string; emoji: string };

export function AccountsView() {
  const { accounts, activeAccountId } = useAppStore();
  const [listFilter, setListFilter] = useState<ManagedAccountType | "all">("all");
  const activeAccount = useMemo(
    () => accounts.find((a) => a.id === activeAccountId) || null,
    [accounts, activeAccountId],
  );

  return (
    <div className="space-y-4">
      <SectionCard title="Active account" icon={<UserCircle className="h-4 w-4" />}>
        <ActiveAccountSummary activeAccount={activeAccount} />
      </SectionCard>
      <SectionCard title="Accounts list" icon={<UserCircle className="h-4 w-4" />}>
        <div className="flex flex-wrap gap-2 mb-3">
          {(["all", "account", "application", "application-user"] as const).map((type) => (
            <button
              key={type}
              onClick={() => setListFilter(type)}
              className={cn(
                "inline-flex items-center gap-2 rounded px-3 py-1.5 text-xs font-semibold transition-colors border",
                listFilter === type
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/60",
              )}
            >
              <span>{type === "all" ? "All" : ACCOUNT_TYPE_LABEL[type]}</span>
            </button>
          ))}
        </div>
        {accounts.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No accounts yet. Use the right panel to create one.
          </div>
        ) : (
          <AccountsList filter={listFilter} />
        )}
      </SectionCard>
    </div>
  );
}

export function AccountsSidePanel(
  { creationType, setCreationType }: {
    creationType: ManagedAccountType;
    setCreationType: (type: ManagedAccountType) => void;
  },
) {
  const {
    accounts,
    addAccount,
    walletServers,
    activeWalletServerId,
    appServers,
    activeAppServerId,
  } = useAppStore();
  const activeBackend = useActiveBackend();
  const nameOptions = ["Pipi", "Bibi", "Tutu", "Gogo"] as const;
  const emojiMap: Record<typeof nameOptions[number], string> = {
    Pipi: "🕊️",
    Bibi: "🐇",
    Tutu: "🐢",
    Gogo: "🐉",
  };
  const [identityCursor, setIdentityCursor] = useState(accounts.length);
  useEffect(() => {
    setIdentityCursor(accounts.length);
  }, [accounts.length]);

  const identityForIndex = (index: number): IdentityDefaults => {
    const name = nameOptions[index % nameOptions.length];
    return { name, emoji: emojiMap[name] };
  };

  const defaultIdentity = identityForIndex(identityCursor);
  const consumeNextIdentity = () => {
    const nextIndex = identityCursor + 1;
    setIdentityCursor(nextIndex);
    return identityForIndex(nextIndex);
  };
  const applicationAccounts = useMemo(
    () => accounts.filter((a): a is ManagedKeyAccount => a.type === "application"),
    [accounts],
  );

  const requireAppsClient = () => {
    const activeApp = appServers.find((w) => w.id === activeAppServerId && w.isActive) ||
      appServers.find((w) => w.isActive);
    if (!activeApp) {
      throw new Error("Active app server is required");
    }
    return createAppsClient(activeApp.url);
  };

  const requireWalletClient = () => {
    const activeWallet = walletServers.find((w) =>
      w.id === activeWalletServerId && w.isActive
    ) || walletServers.find((w) => w.isActive);
    if (!activeWallet) {
      throw new Error("Active wallet server is required");
    }
    return createWalletClient(activeWallet.url);
  };

  const requireActiveWalletServer = () => {
    const activeWallet = walletServers.find((w) =>
      w.id === activeWalletServerId && w.isActive
    ) || walletServers.find((w) => w.isActive);
    if (!activeWallet) {
      throw new Error("Active wallet server is required");
    }
    return activeWallet;
  };

  const requireBackendClient = () => {
    if (!activeBackend) {
      throw new Error("Active backend is required");
    }
    return createBackendClient(activeBackend);
  };

  return (
    <div className="space-y-4">
      <SectionCard title="Create account" icon={<UserCircle className="h-4 w-4" />}>
        <div className="flex flex-wrap gap-2 mb-3">
          {(["account", "application", "application-user"] as ManagedAccountType[]).map((type) => (
            <button
              key={type}
              onClick={() => setCreationType(type)}
              className={cn(
                "inline-flex items-center gap-2 rounded px-3 py-2 text-sm font-semibold transition-colors border",
                creationType === type
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/60",
              )}
            >
              {type === "application-user"
                ? <ShieldCheck className="h-4 w-4" />
                : <KeyRound className="h-4 w-4" />}
              <span>{ACCOUNT_TYPE_LABEL[type]}</span>
            </button>
          ))}
        </div>
        {creationType === "account" && (
          <KeyAccountForm
            accountType="account"
            defaultIdentity={defaultIdentity}
            consumeNextIdentity={consumeNextIdentity}
            onCreate={(account) => addAccount(account)}
          />
        )}
        {creationType === "application" && (
          <KeyAccountForm
            accountType="application"
            defaultIdentity={defaultIdentity}
            consumeNextIdentity={consumeNextIdentity}
            onCreate={(account) => addAccount(account)}
          />
        )}
        {creationType === "application-user" && (
          <ApplicationUserAccountForm
            applications={applicationAccounts}
            defaultIdentity={defaultIdentity}
            consumeNextIdentity={consumeNextIdentity}
            onCreate={(account) => addAccount(account)}
            requireAppsClient={requireAppsClient}
            requireWalletClient={requireWalletClient}
            requireActiveWalletServer={requireActiveWalletServer}
            requireBackendClient={requireBackendClient}
          />
        )}
      </SectionCard>
    </div>
  );
}

function AccountsList({ filter }: { filter: ManagedAccountType | "all" }) {
  const { accounts, activeAccountId, setActiveAccount, removeAccount } = useAppStore();
  const filteredAccounts = useMemo(
    () => filter === "all" ? accounts : accounts.filter((a) => a.type === filter),
    [accounts, filter],
  );

  if (filteredAccounts.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No accounts yet. Use the right panel to create one.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {filteredAccounts.map((account) => (
        <AccountCard
          key={account.id}
          account={account}
          active={account.id === activeAccountId}
          onActivate={() => setActiveAccount(account.id)}
          onRemove={() => removeAccount(account.id)}
        />
      ))}
    </div>
  );
}

function ExplorerLink({ appKey }: { appKey: string }) {
  const pathSegments = ["mutable", "accounts", appKey].map((seg) =>
    encodeURIComponent(seg)
  );
  return (
    <Link
      className="text-xs font-mono text-primary hover:underline"
      to={routeForExplorerPath(`/${pathSegments.join("/")}`)}
    >
      Open in explorer
    </Link>
  );
}

function ActiveAccountSummary(
  { activeAccount }: { activeAccount: ManagedAccount | null },
) {
  if (!activeAccount) {
    return (
      <div className="text-sm text-muted-foreground">
        No active account selected. Use the list or create one in the right panel.
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-lg leading-none">{activeAccount.emoji}</span>
        <div>
          <div className="font-semibold">{activeAccount.name}</div>
          <div className="text-[11px] uppercase text-muted-foreground tracking-wide">
            {ACCOUNT_TYPE_LABEL[activeAccount.type]}
          </div>
          {activeAccount.type === "application-user" && (
            <div className="text-xs text-muted-foreground">
              User: {activeAccount.userSession.username}
              {" · "}
              App: {activeAccount.appName}
            </div>
          )}
        </div>
      </div>
      {activeAccount.type !== "application-user"
        ? <ExplorerLink appKey={activeAccount.keyBundle.appKey} />
        : <ExplorerLink appKey={activeAccount.appKey} />}
    </div>
  );
}

function AccountDetailsTable({ account }: { account: ManagedAccount }) {
  const baseRows: Array<{ label: string; value: string }> = [
    { label: "Type", value: ACCOUNT_TYPE_LABEL[account.type] },
    { label: "Created", value: new Date(account.createdAt).toLocaleString() },
  ];

  const rows =
    account.type === "application-user"
      ? [
        ...baseRows,
        { label: "User", value: account.userSession.username },
        { label: "App", value: account.appName },
        { label: "App Key", value: account.appKey },
        {
          label: "Account Public Key",
          value: account.authKeys.accountPublicKeyHex,
        },
        {
          label: "Encryption Public Key",
          value: account.authKeys.encryptionPublicKeyHex,
        },
        ...(account.googleClientId
          ? [{ label: "Google Client ID", value: account.googleClientId }]
          : []),
      ]
      : [
        ...baseRows,
        { label: "Auth key", value: account.keyBundle.appKey },
        {
          label: "Encryption key",
          value: account.keyBundle.encryptionPublicKeyHex,
        },
      ];

  return (
    <div className="overflow-hidden rounded border border-border bg-background/60">
      <table className="w-full text-xs">
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.label} className="align-top">
              <td className="w-1/3 bg-muted/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {row.label}
              </td>
              <td className="px-3 py-2">
                <div className="font-mono text-xs break-all">{row.value}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccountTypeBadge({ type }: { type: ManagedAccountType }) {
  return (
    <span className="text-[11px] px-2 py-1 rounded-full bg-muted/60 text-muted-foreground border border-border">
      {ACCOUNT_TYPE_LABEL[type]}
    </span>
  );
}

function AccountCard(
  { account, active, onActivate, onRemove }: {
    account: ManagedAccount;
    active: boolean;
    onActivate: () => void;
    onRemove: () => void;
  },
) {
  return (
    <div className="border border-border rounded-lg p-3 bg-muted/40 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-lg leading-none">{account.emoji}</span>
          <div className="flex flex-col">
            <span>{account.name}</span>
            <AccountTypeBadge type={account.type} />
          </div>
        </div>
        {active && (
          <span className="text-[11px] px-2 py-1 rounded-full bg-green-500/10 text-green-700 dark:text-green-300 border border-green-500/20">
            Active
          </span>
        )}
      </div>
      <AccountDetailsTable account={account} />
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onActivate}
          className={cn(
            "flex-1 inline-flex items-center justify-center rounded px-3 py-2 text-sm font-semibold transition-colors",
            active
              ? "bg-primary text-primary-foreground"
              : "border border-border bg-background hover:bg-muted",
          )}
        >
          {active ? "Selected" : "Select"}
        </button>
        <button
          onClick={onRemove}
          className="p-2 rounded border border-border text-destructive hover:bg-destructive/10 transition-colors"
          title="Delete account"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function KeyAccountForm(
  { accountType, onCreate, defaultIdentity, consumeNextIdentity }: {
    accountType: "account" | "application";
    onCreate: (account: ManagedAccount) => void;
    defaultIdentity: IdentityDefaults;
    consumeNextIdentity: () => IdentityDefaults;
  },
) {
  const [emoji, setEmoji] = useState(defaultIdentity.emoji);
  const [name, setName] = useState(defaultIdentity.name);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    setName(defaultIdentity.name);
    setEmoji(defaultIdentity.emoji);
  }, [defaultIdentity]);

  const handleCreate = async () => {
    if (!name.trim()) {
      throw new Error("Name is required");
    }
    if (!emoji.trim()) {
      throw new Error("Emoji is required");
    }
    setCreating(true);
    try {
      const keyBundle = await generateAppKeys();
      onCreate({
        id: crypto.randomUUID(),
        type: accountType,
        name: name.trim(),
        keyBundle,
        createdAt: Date.now(),
        emoji: emoji.trim(),
      });
      const next = consumeNextIdentity();
      setName(next.name);
      setEmoji(next.emoji);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-3">
      <NameEmojiFields
        name={name}
        setName={setName}
        emoji={emoji}
        setEmoji={setEmoji}
        nameLabel={`${ACCOUNT_TYPE_LABEL[accountType]} name`}
      />
      <button
        onClick={handleCreate}
        disabled={creating}
        className={cn(PRIMARY_BUTTON, creating && "opacity-70 cursor-not-allowed")}
      >
        <Plus className="h-4 w-4 mr-2" />
        Create {ACCOUNT_TYPE_LABEL[accountType]}
      </button>
    </div>
  );
}

function ApplicationUserAccountForm(
  props: {
    applications: ManagedKeyAccount[];
    onCreate: (account: ManagedApplicationUserAccount) => void;
    defaultIdentity: IdentityDefaults;
    consumeNextIdentity: () => IdentityDefaults;
    requireAppsClient: () => ReturnType<typeof createAppsClient>;
    requireWalletClient: () => ReturnType<typeof createWalletClient>;
    requireActiveWalletServer: () => { url: string };
    requireBackendClient: () => ReturnType<typeof createBackendClient>;
  },
) {
  const [selectedAppId, setSelectedAppId] = useState("");
  const [userSession, setUserSession] = useState<WriterUserSession | null>(null);
  const [appSessionForAccount, setAppSessionForAccount] = useState("");
  const [authKeys, setAuthKeys] = useState<AccountAuthKeys | null>(null);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [name, setName] = useState(props.defaultIdentity.name);
  const [emoji, setEmoji] = useState(props.defaultIdentity.emoji);
  const [authBusy, setAuthBusy] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [authMode, setAuthMode] = useState<"signup" | "login">("signup");
  const [authMethod, setAuthMethod] = useState<"password" | "google">("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [googleCredential, setGoogleCredential] = useState<string | null>(null);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [googleReady, setGoogleReady] = useState(false);
  const googleClientIdRef = useRef<string | null>(null);
  const googleScriptPromiseRef = useRef<Promise<void> | null>(null);
  useEffect(() => {
    setName(props.defaultIdentity.name);
    setEmoji(props.defaultIdentity.emoji);
  }, [props.defaultIdentity]);

  const selectedApp = props.applications.find((a) => a.id === selectedAppId) || null;

  useEffect(() => {
    setUserSession(null);
    setAuthKeys(null);
    setGoogleClientId(null);
    setAppSessionForAccount("");
    setGoogleCredential(null);
    setUsername("");
    setPassword("");
    setAuthMode("signup");
    setAuthMethod("password");
    if (selectedAppId) {
      void loadProfile();
    }
  }, [selectedAppId]);

  const requireSelectedApp = () => {
    if (!selectedApp) {
      throw new Error("Select an application account");
    }
    return selectedApp;
  };

  useEffect(() => {
    if (authMethod !== "google") {
      setGoogleReady(false);
      if (googleButtonRef.current) {
        googleButtonRef.current.innerHTML = "";
      }
      return;
    }
    if (!googleClientId || !selectedApp) {
      setGoogleReady(false);
      if (googleButtonRef.current) {
        googleButtonRef.current.innerHTML = "";
      }
      return;
    }

    if (!googleScriptPromiseRef.current) {
      googleScriptPromiseRef.current = new Promise<void>((resolve) => {
        // @ts-expect-error Google script check
        if (typeof window !== "undefined" && (window as any).google?.accounts?.id) {
          resolve();
          return;
        }
        const existing = document.querySelector(
          'script[src="https://accounts.google.com/gsi/client"]',
        ) as HTMLScriptElement | null;
        if (existing) {
          existing.addEventListener("load", () => resolve(), { once: true });
          return;
        }
        const script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        document.head.appendChild(script);
      });
    }

    let cancelled = false;
    googleScriptPromiseRef.current.then(() => {
      if (cancelled) return;
      // @ts-expect-error google namespace
      const google = (window as any).google;
      const api = google?.accounts?.id;
      if (!api || !googleButtonRef.current) return;

      if (googleClientIdRef.current !== googleClientId) {
        api.initialize({
          client_id: googleClientId,
          callback: (response: { credential?: string }) => {
            if (response.credential) {
              setGoogleCredential(response.credential);
            }
          },
        });
        googleClientIdRef.current = googleClientId;
      }

      googleButtonRef.current.innerHTML = "";
      api.renderButton(googleButtonRef.current, {
        theme: "outline",
        size: "large",
        type: "standard",
        text: authMode === "signup" ? "signup_with" : "signin_with",
        shape: "rectangular",
        logo_alignment: "left",
      });
      setGoogleReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [authMethod, authMode, googleClientId, selectedApp]);

  const loadProfile = async () => {
    const app = requireSelectedApp();
    setProfileLoading(true);
    try {
      const result = await fetchAppProfile({
        backendClient: props.requireBackendClient(),
        appKey: app.keyBundle.appKey,
      });
      if (!result.success) {
        throw new Error(result.error || "Failed to load app profile");
      }
      const payload = result.payload as Record<string, unknown> | null;
      const googleId = payload && typeof payload.googleClientId === "string"
        ? payload.googleClientId
        : null;
      setGoogleClientId(googleId);
      setGoogleCredential(null);
    } finally {
      setProfileLoading(false);
    }
  };

  const startAppSession = async () => {
    const app = requireSelectedApp();
    const res = await createSession({
      appsClient: props.requireAppsClient(),
      appKey: app.keyBundle.appKey,
      accountPrivateKeyPem: app.keyBundle.accountPrivateKeyPem,
    });
    setAppSessionForAccount(res.session);
    return res.session;
  };

  const fetchKeysForSession = async (currentSession: WriterUserSession) => {
    const app = requireSelectedApp();
    const keys = await fetchMyKeys({
      walletClient: props.requireWalletClient(),
      appKey: app.keyBundle.appKey,
      session: currentSession,
    });
    setAuthKeys(keys);
    return keys;
  };

  const handleSignup = async (username: string, password: string) => {
    const app = requireSelectedApp();
    setAuthBusy(true);
    try {
      const session = await signupWithPassword({
        walletClient: props.requireWalletClient(),
        appKey: app.keyBundle.appKey,
        username,
        password,
      });
      setUserSession(session);
      await fetchKeysForSession(session);
      await startAppSession();
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogin = async (username: string, password: string) => {
    const app = requireSelectedApp();
    setAuthBusy(true);
    try {
      const appSession = await startAppSession();
      const session = await loginWithPassword({
        walletClient: props.requireWalletClient(),
        appKey: app.keyBundle.appKey,
        session: appSession,
        username,
        password,
      });
      setUserSession(session);
      await fetchKeysForSession(session);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleGoogleCredential = async (
    mode: "signup" | "login",
    idToken: string,
  ) => {
    const app = requireSelectedApp();
    setAuthBusy(true);
    try {
      const walletServer = props.requireActiveWalletServer();
      const session = mode === "signup"
        ? await googleSignup({
          walletServerUrl: walletServer.url,
          appKey: app.keyBundle.appKey,
          googleIdToken: idToken,
        })
        : await googleLogin({
          walletServerUrl: walletServer.url,
          appKey: app.keyBundle.appKey,
          appSession: await startAppSession(),
          googleIdToken: idToken,
        });
      setUserSession(session);
      await fetchKeysForSession(session);
      if (mode === "signup") {
        await startAppSession();
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const saveAccount = async () => {
    const app = requireSelectedApp();
    if (!name.trim()) {
      throw new Error("Name is required");
    }
    if (!emoji.trim()) {
      throw new Error("Emoji is required");
    }

    setAuthBusy(true);
    try {
      let session: WriterUserSession | null = null;
      let appSession = appSessionForAccount || "";

      if (authMethod === "password") {
        if (!username.trim()) {
          throw new Error("Username is required");
        }
        if (!password) {
          throw new Error("Password is required");
        }
        if (authMode === "signup") {
          session = await signupWithPassword({
            walletClient: props.requireWalletClient(),
            appKey: app.keyBundle.appKey,
            username,
            password,
          });
          appSession = appSession || await startAppSession();
        } else {
          appSession = await startAppSession();
          session = await loginWithPassword({
            walletClient: props.requireWalletClient(),
            appKey: app.keyBundle.appKey,
            session: appSession,
            username,
            password,
          });
        }
      } else {
        if (!googleClientId) {
          throw new Error("Google login is not configured for this app");
        }
        if (!googleCredential) {
          throw new Error("Google credential is required");
        }
        const walletServer = props.requireActiveWalletServer();
        if (authMode === "signup") {
          session = await googleSignup({
            walletServerUrl: walletServer.url,
            appKey: app.keyBundle.appKey,
            googleIdToken: googleCredential,
          });
          appSession = appSession || await startAppSession();
        } else {
          appSession = await startAppSession();
          session = await googleLogin({
            walletServerUrl: walletServer.url,
            appKey: app.keyBundle.appKey,
            appSession,
            googleIdToken: googleCredential,
          });
        }
      }

      if (!session) {
        throw new Error("Authentication failed");
      }

      const keys = await fetchKeysForSession(session);
      setUserSession(session);
      if (appSession) {
        setAppSessionForAccount(appSession);
      }

      const resolvedKeys = keys || authKeys;
      if (!resolvedKeys) {
        throw new Error("Account keys are required");
      }

      const account: ManagedApplicationUserAccount = {
        id: crypto.randomUUID(),
        type: "application-user",
        name: name.trim(),
        emoji: emoji.trim(),
        createdAt: Date.now(),
        appAccountId: app.id,
        appName: app.name,
        appKey: app.keyBundle.appKey,
        appSession,
        userSession: session,
        authKeys: resolvedKeys,
        googleClientId,
      };

      props.onCreate(account);
      const next = props.consumeNextIdentity();
      setName(next.name);
      setEmoji(next.emoji);
      setUsername("");
      setPassword("");
      setGoogleCredential(null);
      setUserSession(null);
      setAuthKeys(null);
      setAppSessionForAccount("");
    } finally {
      setAuthBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <NameEmojiFields
        name={name}
        setName={setName}
        emoji={emoji}
        setEmoji={setEmoji}
        nameLabel="Account name"
      />

      <ApplicationSelector
        applications={props.applications}
        selectedAppId={selectedAppId}
    setSelectedAppId={setSelectedAppId}
  />

      <AuthSelector
        disabled={!selectedApp || authBusy || profileLoading}
        authMode={authMode}
        setAuthMode={setAuthMode}
        authMethod={authMethod}
        setAuthMethod={setAuthMethod}
        username={username}
        setUsername={setUsername}
        password={password}
        setPassword={setPassword}
        googleClientId={googleClientId}
        googleReady={googleReady}
        googleButtonRef={googleButtonRef}
        googleCredential={googleCredential}
        setGoogleCredential={setGoogleCredential}
      />
      {profileLoading && (
        <div className="text-xs text-muted-foreground">
          Loading application profile…
        </div>
      )}

      <button
        onClick={saveAccount}
        className={cn(PRIMARY_BUTTON, authBusy && "opacity-70")}
        disabled={authBusy}
      >
        <UserPlus className="h-4 w-4 mr-2" />
        Save Application User Account
      </button>
    </div>
  );
}

function InfoTable({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <div className="overflow-hidden rounded border border-border bg-background/60">
      <table className="w-full text-xs">
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.label} className="align-top">
              <td className="w-1/3 bg-muted/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {row.label}
              </td>
              <td className="px-3 py-2">
                <div className="font-mono text-xs break-all">{row.value}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NameEmojiFields(
  { name, setName, emoji, setEmoji, nameLabel }: {
    name: string;
    setName: (v: string) => void;
    emoji: string;
    setEmoji: (v: string) => void;
    nameLabel: string;
  },
) {
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-3">
        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">Emoji</label>
          <input
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            className="w-16 rounded border border-border bg-background px-3 py-2 text-sm text-center"
          />
        </div>
        <div className="flex-1 space-y-1">
          <label className="text-sm text-muted-foreground">{nameLabel}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>
    </div>
  );
}

function AuthSelector(
  props: {
    disabled: boolean;
    authMode: "signup" | "login";
    setAuthMode: (m: "signup" | "login") => void;
    authMethod: "password" | "google";
    setAuthMethod: (m: "password" | "google") => void;
    username: string;
    setUsername: (v: string) => void;
    password: string;
    setPassword: (v: string) => void;
    googleClientId: string | null;
    googleReady: boolean;
    googleButtonRef: React.RefObject<HTMLDivElement>;
    googleCredential: string | null;
    setGoogleCredential: (v: string | null) => void;
  },
) {
  const { disabled } = props;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => props.setAuthMode("signup")}
          className={cn(
            props.authMode === "signup" ? PRIMARY_BUTTON : SECONDARY_BUTTON,
            disabled && DISABLED_BUTTON,
          )}
          disabled={disabled}
        >
          Signup
        </button>
        <button
          onClick={() => props.setAuthMode("login")}
          className={cn(
            props.authMode === "login" ? PRIMARY_BUTTON : SECONDARY_BUTTON,
            disabled && DISABLED_BUTTON,
          )}
          disabled={disabled}
        >
          Login
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => props.setAuthMethod("password")}
          className={cn(
            props.authMethod === "password" ? PRIMARY_BUTTON : SECONDARY_BUTTON,
            disabled && DISABLED_BUTTON,
          )}
          disabled={disabled}
        >
          Username & Password
        </button>
        <button
          onClick={() => props.setAuthMethod("google")}
          className={cn(
            props.authMethod === "google" ? PRIMARY_BUTTON : SECONDARY_BUTTON,
            disabled && DISABLED_BUTTON,
          )}
          disabled={disabled || !props.googleClientId}
        >
          Google
        </button>
      </div>

      {props.authMethod === "password" && (
        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">Username</label>
            <input
              value={props.username}
              onChange={(e) => props.setUsername(e.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              disabled={disabled}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm text-muted-foreground">Password</label>
            <input
              value={props.password}
              type="password"
              onChange={(e) => props.setPassword(e.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              disabled={disabled}
            />
          </div>
        </div>
      )}

      {props.authMethod === "google" && (
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">
            Google Sign-in
          </label>
          <div
            ref={props.googleButtonRef}
            className={
              disabled || !props.googleClientId
                ? "opacity-50 pointer-events-none"
                : ""
            }
          />
          {!props.googleReady && (
            <div className="text-xs text-muted-foreground">
              {props.googleClientId
                ? "Loading Google login…"
                : "Google login not configured for this application."}
            </div>
          )}
          {props.googleCredential && (
            <div className="text-xs text-foreground">
              Google credential captured; will use on submit.
            </div>
          )}
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        Authentication runs when you click "Save Application User Account".
      </div>
    </div>
  );
}

function ApplicationSelector(
  { applications, selectedAppId, setSelectedAppId, disabled }: {
    applications: ManagedKeyAccount[];
    selectedAppId: string;
    setSelectedAppId: (id: string) => void;
    disabled?: boolean;
  },
) {
  return (
    <div className="space-y-2">
      <label className="text-sm text-muted-foreground">Application</label>
      <select
        value={selectedAppId}
        onChange={(e) => setSelectedAppId(e.target.value)}
        className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
        disabled={disabled}
      >
        <option value="">Select an application account</option>
        {applications.map((app) => (
          <option key={app.id} value={app.id}>
            {app.name} ({app.keyBundle.appKey.slice(0, 8)}…)
          </option>
        ))}
      </select>
    </div>
  );
}
