import { useState } from "react";
import type { ManagedAccountType } from "../../../types";
import { AccountsView, AccountsSidePanel } from "../../accounts/AccountsView";

export function AccountsLayoutSlot() {
  const [accountCreationType, setAccountCreationType] = useState<ManagedAccountType>("account");

  return (
    <div className="h-full flex overflow-hidden bg-background text-foreground">
      <div className="flex-1 overflow-auto custom-scrollbar">
        <div className="p-4 border-b border-gray-200 dark:border-gray-800 bg-muted/30">
          <nav className="flex items-center space-x-2 text-sm">
            <span className="font-medium text-foreground">Accounts</span>
          </nav>
        </div>
        <div className="p-6 space-y-4 w-full max-w-6xl mx-auto">
          <AccountsView />
        </div>
      </div>
      <div className="w-[360px] border-l border-border bg-card">
        <div className="h-full overflow-auto custom-scrollbar p-4">
          <AccountsSidePanel
            creationType={accountCreationType}
            setCreationType={setAccountCreationType}
          />
        </div>
      </div>
    </div>
  );
}
