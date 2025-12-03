import { useMemo, useState } from "react";
import { Plus, Trash2, UserCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { useAppStore } from "../../stores/appStore";
import { generateAppKeys } from "../../services/writer/writerService";
import type { ManagedAccount } from "../../types";
import { cn } from "../../utils";
import { SectionCard } from "../common/SectionCard";

export function AccountsView() {
  const { accounts, activeAccountId } = useAppStore();
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
        {accounts.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No accounts yet. Use the right panel to create one.
          </div>
        ) : (
          <AccountsList />
        )}
      </SectionCard>
    </div>
  );
}

export function AccountsSidePanel() {
  const { accounts, activeAccountId, addAccount, removeAccount, setActiveAccount } =
    useAppStore();

  const nameOptions = ["Pipi", "Bibi", "Tutu", "Gogo"] as const;
  const emojiMap: Record<typeof nameOptions[number], string> = {
    Pipi: "🕊️",
    Bibi: "🐇",
    Tutu: "🐢",
    Gogo: "🐉",
  };
  const initialName = nameOptions[accounts.length % nameOptions.length];
  const [name, setName] = useState(initialName);
  const [emoji, setEmoji] = useState(emojiMap[initialName]);
  const [creating, setCreating] = useState(false);

  const activeAccount = useMemo(
    () => accounts.find((a) => a.id === activeAccountId) || null,
    [accounts, activeAccountId],
  );

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
      const account: ManagedAccount = {
        id: crypto.randomUUID(),
        name: name.trim(),
        keyBundle,
        createdAt: Date.now(),
        emoji: (emoji || emojiMap[nameOptions[0]]).trim(),
      };
      addAccount(account);
      const nextName = nameOptions[(accounts.length + 1) % nameOptions.length];
      setName(nextName);
      setEmoji(emojiMap[nextName]);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionCard title="Create account" icon={<UserCircle className="h-4 w-4" />}>
        <div className="grid gap-3">
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Account name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Emoji</label>
            <input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className={cn(
              "inline-flex items-center justify-center rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors",
              "hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              creating && "opacity-70 cursor-not-allowed",
            )}
          >
            <Plus className="h-4 w-4 mr-2" />
            Create account
          </button>
        </div>
      </SectionCard>
    </div>
  );
}

function AccountsList() {
  const { accounts, activeAccountId, setActiveAccount, removeAccount } = useAppStore();

  if (accounts.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No accounts yet. Use the right panel to create one.
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-2 gap-3">
      {accounts.map((account) => (
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
  const uri = `mutable://accounts/${appKey}`;
  const pathSegments = ["mutable", "accounts", appKey].map((seg) =>
    encodeURIComponent(seg)
  );
  return (
    <Link
      className="text-xs font-mono text-primary hover:underline"
      to={`/explorer/${pathSegments.join("/")}`}
    >
      Open in explorer
    </Link>
  );
}

function ActiveAccountSummary({ activeAccount }: { activeAccount: ManagedAccount | null }) {
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
        <div className="font-semibold">{activeAccount.name}</div>
      </div>
      <ExplorerLink appKey={activeAccount.keyBundle.appKey} />
    </div>
  );
}

function AccountDetailsTable({ account }: { account: ManagedAccount }) {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Auth key", value: account.keyBundle.appKey },
    { label: "Encryption key", value: account.keyBundle.encryptionPublicKeyHex },
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
          <span>{account.name}</span>
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
