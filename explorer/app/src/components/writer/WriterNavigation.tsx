import { Settings, Server, PenSquare, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { WriterSection } from "../../types";
import { useAppStore } from "../../stores/appStore";
import { cn } from "../../utils";

export function WriterNavigation() {
  const { writerSection, setWriterSection } = useAppStore();

  const sections: Array<{
    key: WriterSection;
    label: string;
    description: string;
    icon: ReactNode;
  }> = [
    {
      key: "config",
      label: "Configuration",
      description: "Keys, wallet, and app server setup",
      icon: <Settings className="h-4 w-4" />,
    },
    {
      key: "backend",
      label: "Backend",
      description: "Write/read data against the selected backend",
      icon: <Server className="h-4 w-4" />,
    },
    {
      key: "app",
      label: "App Actions",
      description: "Register app, sessions, actions, and schema",
      icon: <PenSquare className="h-4 w-4" />,
    },
    {
      key: "auth",
      label: "Auth",
      description: "User authentication and proxy writes",
      icon: <ShieldCheck className="h-4 w-4" />,
    },
  ];

  return (
    <div className="p-4 space-y-2">
      {sections.map((section) => (
        <button
          key={section.key}
          onClick={() => setWriterSection(section.key)}
          className={cn(
            "w-full text-left p-3 rounded-lg border transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            writerSection === section.key
              ? "border-primary bg-primary/5 text-foreground"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
          )}
        >
          <div className="flex items-center space-x-2">
            {section.icon}
            <div className="flex-1">
              <div className="font-medium text-sm">{section.label}</div>
              <div className="text-xs text-muted-foreground">
                {section.description}
              </div>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
