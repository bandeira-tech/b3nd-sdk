import { useEffect, useState } from "react";
import { KeyRound, Link as LinkIcon, Send } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../stores/appStore";
import { cn, routeForExplorerPath, sanitizePath } from "../../utils";

export function ExplorerAccountPanel() {
  const {
    explorerAccountKey,
    explorerAccountPath,
    setExplorerSection,
    setExplorerAccountKey,
  } = useAppStore();
  const [accountKeyInput, setAccountKeyInput] = useState(explorerAccountKey || "");
  const [pathInput, setPathInput] = useState(explorerAccountPath || "/");
  const navigate = useNavigate();

  useEffect(() => {
    setAccountKeyInput(explorerAccountKey || "");
  }, [explorerAccountKey]);

  useEffect(() => {
    setPathInput(explorerAccountPath || "/");
  }, [explorerAccountPath]);

  const relativePathForAccountInput = () => {
    const normalized = sanitizePath(pathInput || "/");
    const trimmedKey = accountKeyInput.trim();
    if (!trimmedKey) return normalized;
    const prefix = `/mutable/accounts/${trimmedKey}`;
    if (normalized.startsWith(prefix)) {
      const remainder = normalized.slice(prefix.length) || "/";
      return sanitizePath(remainder);
    }
    return normalized;
  };

  const trimmedKey = accountKeyInput.trim();
  const targetRoute = trimmedKey
    ? routeForExplorerPath(relativePathForAccountInput(), {
      section: "account",
      accountKey: trimmedKey,
    })
    : null;

  const handleApply = (event: React.FormEvent) => {
    event.preventDefault();
    if (!trimmedKey) {
      throw new Error("Account public key is required");
    }
    const normalizedPath = relativePathForAccountInput();
    setExplorerSection("account");
    setExplorerAccountKey(trimmedKey);
    navigate(
      routeForExplorerPath(normalizedPath, {
        section: "account",
        accountKey: trimmedKey,
      }),
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Account scope
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Browse explorer data limited to a single account by providing its public key.
        </p>
      </div>

      <form className="space-y-3" onSubmit={handleApply}>
        <label className="space-y-1 block">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Account public key
          </div>
          <div className="relative">
            <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={accountKeyInput}
              onChange={(e) => setAccountKeyInput(e.target.value)}
              placeholder="Enter account public key"
              className="w-full pl-10 pr-3 py-2 rounded border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </label>

        <label className="space-y-1 block">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Path inside account
          </div>
          <input
            type="text"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder="/"
            className="w-full px-3 py-2 rounded border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>

        <button
          type="submit"
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors",
            "hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <Send className="h-4 w-4" />
          Open in explorer
        </button>
      </form>

      {targetRoute && (
        <div className="rounded border border-border bg-muted/40 p-3 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <LinkIcon className="h-4 w-4" />
            <span className="font-semibold text-foreground">Shareable link</span>
          </div>
          <div className="mt-2 font-mono break-all text-foreground">
            {targetRoute}
          </div>
        </div>
      )}
    </div>
  );
}
