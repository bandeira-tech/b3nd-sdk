import { Compass, KeyRound } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../stores/appStore";
import { cn, routeForExplorerPath } from "../../utils";

export function ExplorerNavigation() {
  const {
    explorerSection,
    explorerIndexPath,
    explorerAccountKey,
    explorerAccountPath,
    setExplorerSection,
  } = useAppStore();
  const navigate = useNavigate();

  const sections: Array<{
    key: "index" | "account";
    label: string;
    description: string;
    icon: ReactNode;
    onClick: () => void;
  }> = [
    {
      key: "index",
      label: "Index",
      description: "Browse everything freely",
      icon: <Compass className="h-4 w-4" />,
      onClick: () => {
        setExplorerSection("index");
        navigate(routeForExplorerPath(explorerIndexPath || "/"));
      },
    },
    {
      key: "account",
      label: "Account",
      description: "Scope browsing to a specific account",
      icon: <KeyRound className="h-4 w-4" />,
      onClick: () => {
        setExplorerSection("account");
        const targetPath = explorerAccountKey
          ? routeForExplorerPath(
            explorerAccountPath || "/",
            { section: "account", accountKey: explorerAccountKey },
          )
          : routeForExplorerPath("/", { section: "account" });
        navigate(targetPath);
      },
    },
  ];

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-2">
        {sections.map((section) => (
          <NavButton
            key={section.key}
            active={explorerSection === section.key}
            onClick={section.onClick}
            icon={section.icon}
            label={section.label}
            description={section.description}
          />
        ))}
      </div>
    </div>
  );
}

function NavButton(
  { active, onClick, icon, label, description }: {
    active: boolean;
    onClick: () => void;
    icon: ReactNode;
    label: string;
    description: string;
  },
) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-3 rounded-lg border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary bg-primary/5 text-foreground"
          : "border-border text-muted-foreground hover:text-foreground hover:bg-accent",
      )}
    >
      <div className="flex items-center space-x-2">
        {icon}
        <div className="flex-1">
          <div className="font-medium text-sm">{label}</div>
          <div className="text-xs text-muted-foreground">
            {description}
          </div>
        </div>
      </div>
    </button>
  );
}
