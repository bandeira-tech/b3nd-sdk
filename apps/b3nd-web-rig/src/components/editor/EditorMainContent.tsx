import { useState, useCallback, useEffect } from "react";
import {
  Save,
  CheckCircle,
  AlertCircle,
  Loader2,
  FileText,
  Lock,
  LockOpen,
  ShieldCheck,
  Shield,
  User,
  KeyRound,
} from "lucide-react";
import { computeSha256, generateHashUri } from "@bandeira-tech/b3nd-web/hash";
import {
  encrypt as encryptData,
  pemToCryptoKey,
  decrypt as decryptData,
} from "@bandeira-tech/b3nd-web/encrypt";
import type { EncryptedPayload } from "@bandeira-tech/b3nd-web/encrypt";
import { HttpClient } from "@bandeira-tech/b3nd-web";
import { useActiveBackend, useAppStore } from "../../stores/appStore";
import { HttpAdapter } from "../../adapters/HttpAdapter";
import { signAppPayload } from "../../services/writer/writerService";
import { cn } from "../../utils";
import type { EditorDocument, SaveVersionInput } from "./EditorLayoutSlot";
import type { ManagedKeyAccount } from "../../types";

interface EditorMainContentProps {
  activeDoc: EditorDocument | null;
  viewingVersionIndex: number | null;
  encryptionEnabled: boolean;
  onAddDocument: (title: string) => string;
  onSaveVersion: (input: SaveVersionInput) => void;
  onViewVersion: (index: number | null) => void;
  onSetEncryptionEnabled: (enabled: boolean) => void;
}

/**
 * Attempt to decrypt an EncryptedPayload using the account's encryption private key (PEM).
 * Returns the decrypted `{ title, body }` object or null on failure.
 */
async function tryDecryptContent(
  encPayload: EncryptedPayload,
  encryptionPrivateKeyPem: string,
): Promise<{ title: string; body: string } | null> {
  try {
    const privateKey = await pemToCryptoKey(encryptionPrivateKeyPem, "X25519");
    const decrypted = await decryptData(encPayload, privateKey);
    if (
      decrypted &&
      typeof decrypted === "object" &&
      "title" in (decrypted as Record<string, unknown>) &&
      "body" in (decrypted as Record<string, unknown>)
    ) {
      return decrypted as { title: string; body: string };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Checks if a ManagedAccount is a key-based account (account or application)
 * that can sign and encrypt.
 */
function isKeyAccount(
  account: { type: string } | null,
): account is ManagedKeyAccount {
  return account !== null && (account.type === "account" || account.type === "application");
}

export function EditorMainContent({
  activeDoc,
  viewingVersionIndex,
  encryptionEnabled,
  onSaveVersion,
  onViewVersion,
  onSetEncryptionEnabled,
}: EditorMainContentProps) {
  const activeBackend = useActiveBackend();
  const accounts = useAppStore((s) => s.accounts);
  const activeAccountId = useAppStore((s) => s.activeAccountId);
  const addLogEntry = useAppStore((s) => s.addLogEntry);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  // Decrypted version body for encrypted historical versions
  const [decryptedVersionBody, setDecryptedVersionBody] = useState<string | null>(null);
  const [decrypting, setDecrypting] = useState(false);

  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? null;
  const hasKeyAccount = isKeyAccount(activeAccount);
  const canEncrypt = hasKeyAccount && !!activeAccount.keyBundle.encryptionPublicKeyHex;

  // Sync local state when active doc changes
  useEffect(() => {
    if (!activeDoc) {
      setTitle("");
      setBody("");
      setStatus(null);
      return;
    }
    setTitle(activeDoc.title);
    // Load latest version body if available, otherwise empty
    if (activeDoc.versions.length > 0) {
      setBody(activeDoc.versions[0].body);
    } else {
      setBody("");
    }
    setStatus(null);
  }, [activeDoc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset decrypted version when viewing version changes
  useEffect(() => {
    setDecryptedVersionBody(null);
  }, [viewingVersionIndex]);

  const getBackendClient = useCallback((): HttpClient | null => {
    if (!activeBackend?.adapter || !(activeBackend.adapter instanceof HttpAdapter)) {
      return null;
    }
    if (!activeBackend.adapter.baseUrl) return null;
    return new HttpClient({ url: activeBackend.adapter.baseUrl.replace(/\/$/, "") });
  }, [activeBackend]);

  // Decrypt a historical version from the backend
  const handleDecryptVersion = useCallback(async (hashUri: string) => {
    if (!hasKeyAccount) return;

    const backendClient = getBackendClient();
    if (!backendClient) return;

    setDecrypting(true);
    try {
      const hashRead = await backendClient.read(hashUri);
      if (!hashRead.success || !hashRead.record) {
        addLogEntry({
          source: "editor",
          message: `Failed to read encrypted content for decryption: ${hashRead.error || "not found"}`,
          level: "error",
        });
        setDecryptedVersionBody("[Failed to read content from backend]");
        return;
      }

      const storedData = hashRead.record.data as unknown;
      // The stored data should be an EncryptedPayload { data, nonce, ephemeralPublicKey }
      if (
        storedData &&
        typeof storedData === "object" &&
        "data" in (storedData as Record<string, unknown>) &&
        "nonce" in (storedData as Record<string, unknown>)
      ) {
        const result = await tryDecryptContent(
          storedData as EncryptedPayload,
          activeAccount.keyBundle.encryptionPrivateKeyPem,
        );
        if (result) {
          setDecryptedVersionBody(result.body);
          addLogEntry({
            source: "editor",
            message: `Decrypted version content successfully`,
            level: "success",
          });
        } else {
          setDecryptedVersionBody("[Decryption failed -- wrong key or corrupted data]");
          addLogEntry({
            source: "editor",
            message: `Decryption failed for ${hashUri}`,
            level: "error",
          });
        }
      } else {
        // Not encrypted -- show raw body
        const rawData = storedData as { body?: string };
        setDecryptedVersionBody(rawData?.body ?? JSON.stringify(storedData));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDecryptedVersionBody(`[Decryption error: ${message}]`);
      addLogEntry({
        source: "editor",
        message: `Decryption error: ${message}`,
        level: "error",
      });
    } finally {
      setDecrypting(false);
    }
  }, [hasKeyAccount, activeAccount, getBackendClient, addLogEntry]);

  const handleSave = useCallback(async () => {
    if (!activeDoc) return;
    if (!body.trim()) return;

    const backendClient = getBackendClient();
    if (!backendClient) {
      setStatus({ ok: false, message: "No active backend configured" });
      return;
    }

    setSaving(true);
    setStatus(null);

    const shouldEncrypt = encryptionEnabled && canEncrypt && hasKeyAccount;

    try {
      // 1. Prepare content -- encrypt if enabled
      const contentObj = { title, body };
      let contentData: unknown;

      if (shouldEncrypt) {
        contentData = await encryptData(
          contentObj,
          activeAccount.keyBundle.encryptionPublicKeyHex,
        );
      } else {
        contentData = contentObj;
      }

      // 2. Hash the (possibly encrypted) content
      const hash = await computeSha256(contentData);
      const hashUri = generateHashUri(hash);

      // 3. Build link URI based on auth state
      const docPath = `docs/${activeDoc.id}`;
      let linkUri: string;
      let linkPayload: unknown;
      let signedBy: string | null = null;

      if (hasKeyAccount) {
        const pubkey = activeAccount.keyBundle.appKey;
        linkUri = `link://accounts/${pubkey}/${docPath}`;
        linkPayload = await signAppPayload({
          payload: hashUri,
          appKey: pubkey,
          accountPrivateKeyPem: activeAccount.keyBundle.accountPrivateKeyPem,
        });
        signedBy = pubkey;
      } else {
        linkUri = `link://open/${docPath}`;
        linkPayload = hashUri;
      }

      // 4. Store content at hash URI, then update link pointer
      const hashResponse = await backendClient.receive([hashUri, contentData]);
      if (!hashResponse.accepted) {
        setStatus({ ok: false, message: hashResponse.error || "Hash store rejected" });
        addLogEntry({
          source: "editor",
          message: `Hash store rejected: ${hashResponse.error || "unknown"}`,
          level: "error",
        });
        return;
      }

      const response = await backendClient.receive([linkUri, linkPayload]);

      if (response.accepted) {
        onSaveVersion({
          docId: activeDoc.id,
          title,
          body,
          hashUri,
          linkUri,
          encrypted: shouldEncrypt,
          signedBy,
          encryptionPublicKeyHex: shouldEncrypt
            ? activeAccount.keyBundle.encryptionPublicKeyHex
            : null,
        });

        const encLabel = shouldEncrypt ? " (encrypted)" : "";
        const authLabel = signedBy ? " (signed)" : "";
        setStatus({ ok: true, message: `Saved${authLabel}${encLabel}` });
        addLogEntry({
          source: "editor",
          message: `Saved${encLabel}${authLabel}: ${hashUri} -> ${linkUri}`,
          level: "success",
        });

        // 5. Read-back confirmation
        try {
          const hashRead = await backendClient.read(hashUri);
          if (hashRead.success && hashRead.record) {
            addLogEntry({
              source: "editor",
              message: `Read-back confirmed: ${JSON.stringify(hashRead.record.data).slice(0, 120)}`,
              level: "info",
            });
          } else {
            addLogEntry({
              source: "editor",
              message: `Read-back failed: ${hashRead.error || "unknown"}`,
              level: "warning",
            });
          }
        } catch (err) {
          addLogEntry({
            source: "editor",
            message: `Read-back error: ${err instanceof Error ? err.message : String(err)}`,
            level: "warning",
          });
        }
      } else {
        setStatus({ ok: false, message: response.error || "Save rejected" });
        addLogEntry({
          source: "editor",
          message: `Save rejected: ${response.error || "unknown"}`,
          level: "error",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ ok: false, message });
      addLogEntry({ source: "editor", message: `Save error: ${message}`, level: "error" });
    } finally {
      setSaving(false);
    }
  }, [
    activeDoc,
    title,
    body,
    getBackendClient,
    activeAccount,
    hasKeyAccount,
    canEncrypt,
    encryptionEnabled,
    onSaveVersion,
    addLogEntry,
  ]);

  // -- Empty state: no document selected --
  if (!activeDoc) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
        <FileText className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-sm">Select a document or create a new one</p>
      </div>
    );
  }

  // -- Viewing a historical version --
  const isViewingHistory = viewingVersionIndex !== null;
  const viewedVersion = isViewingHistory ? activeDoc.versions[viewingVersionIndex] : null;

  if (isViewingHistory && viewedVersion) {
    const versionIsEncrypted = viewedVersion.encrypted;

    return (
      <div className="h-full flex flex-col overflow-y-auto custom-scrollbar">
        <div className="max-w-3xl w-full mx-auto px-6 py-6 flex flex-col gap-5 flex-1">
          {/* Version metadata badges */}
          <div className="flex items-center gap-2 flex-wrap">
            {viewedVersion.signedBy && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                <ShieldCheck className="w-3 h-3" />
                Signed
              </span>
            )}
            {versionIsEncrypted ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                <Lock className="w-3 h-3" />
                Encrypted
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-muted text-muted-foreground border border-border">
                <LockOpen className="w-3 h-3" />
                Plaintext
              </span>
            )}
          </div>

          {/* Read-only title */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Title
            </label>
            <div className="px-3 py-1.5 text-sm rounded border border-border bg-muted/30">
              {activeDoc.title}
            </div>
          </div>

          {/* Read-only body */}
          <div className="flex-1 flex flex-col min-h-0">
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Content (version #{activeDoc.versions.length - viewingVersionIndex})
            </label>
            {versionIsEncrypted && decryptedVersionBody === null ? (
              <div className="flex-1 min-h-[200px] px-3 py-2 text-sm rounded border border-amber-500/30 bg-amber-500/5 flex flex-col items-center justify-center gap-3">
                <Lock className="w-8 h-8 text-amber-500/60" />
                <p className="text-xs text-muted-foreground text-center">
                  This version is encrypted. Decrypt with your account key to view.
                </p>
                <button
                  onClick={() => handleDecryptVersion(viewedVersion.hashUri)}
                  disabled={decrypting || !hasKeyAccount}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded",
                    "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
                    "hover:bg-amber-500/20 transition-colors",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                  )}
                >
                  {decrypting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <KeyRound className="w-3.5 h-3.5" />
                  )}
                  {decrypting ? "Decrypting..." : "Decrypt"}
                </button>
                {!hasKeyAccount && (
                  <p className="text-[10px] text-muted-foreground">
                    Select an account with encryption keys to decrypt
                  </p>
                )}
              </div>
            ) : (
              <div className="flex-1 min-h-[200px] px-3 py-2 text-sm rounded border border-border bg-muted/30 whitespace-pre-wrap overflow-auto">
                {versionIsEncrypted ? decryptedVersionBody : viewedVersion.body}
              </div>
            )}
          </div>

          {/* Back to editing */}
          <div>
            <button
              onClick={() => onViewVersion(null)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded",
                "bg-primary text-primary-foreground",
                "hover:bg-primary/90 transition-colors",
              )}
            >
              Back to editing
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -- Editing state --
  return (
    <div className="h-full flex flex-col overflow-y-auto custom-scrollbar">
      <div className="max-w-3xl w-full mx-auto px-6 py-6 flex flex-col gap-5 flex-1">
        {/* Account and security status bar */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Account indicator */}
          {hasKeyAccount ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-500/10 border border-blue-500/20">
              <User className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400 truncate max-w-[160px]">
                {activeAccount.name}
              </span>
              <ShieldCheck className="w-3 h-3 text-blue-500/60" />
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted border border-border">
              <Shield className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">
                No account (unsigned)
              </span>
            </div>
          )}

          {/* Encryption toggle */}
          <button
            onClick={() => onSetEncryptionEnabled(!encryptionEnabled)}
            disabled={!canEncrypt}
            title={
              !hasKeyAccount
                ? "Select an account to enable encryption"
                : !canEncrypt
                  ? "Account has no encryption key"
                  : encryptionEnabled
                    ? "Encryption enabled -- click to disable"
                    : "Encryption disabled -- click to enable"
            }
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition-colors text-[11px] font-medium",
              encryptionEnabled && canEncrypt
                ? "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400"
                : "bg-muted border-border text-muted-foreground",
              canEncrypt
                ? "hover:bg-accent/50 cursor-pointer"
                : "opacity-50 cursor-not-allowed",
            )}
          >
            {encryptionEnabled && canEncrypt ? (
              <Lock className="w-3.5 h-3.5" />
            ) : (
              <LockOpen className="w-3.5 h-3.5" />
            )}
            {encryptionEnabled && canEncrypt ? "Encrypted" : "Unencrypted"}
          </button>
        </div>

        {/* Title input */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Document title"
            className={cn(
              "w-full px-3 py-1.5 text-sm rounded border border-border bg-background",
              "focus:outline-none focus:ring-1 focus:ring-primary/50",
              "placeholder:text-muted-foreground/50",
            )}
          />
        </div>

        {/* Body textarea */}
        <div className="flex-1 flex flex-col min-h-0">
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            Content
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Start writing..."
            className={cn(
              "flex-1 min-h-[200px] px-3 py-2 text-sm rounded border bg-background resize-none",
              "focus:outline-none focus:ring-1 focus:ring-primary/50",
              "placeholder:text-muted-foreground/50",
              encryptionEnabled && canEncrypt
                ? "border-amber-500/30"
                : "border-border",
            )}
          />
        </div>

        {/* Save button + status */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || !body.trim() || !activeBackend}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded",
              "bg-primary text-primary-foreground",
              "hover:bg-primary/90 transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saving ? "Saving..." : "Save"}
          </button>

          {!activeBackend && (
            <span className="text-xs text-muted-foreground">
              No backend connected
            </span>
          )}

          {status && (
            <div className="flex items-center gap-1.5 text-xs">
              {status.ok ? (
                <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-red-500" />
              )}
              <span className={status.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                {status.message}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
