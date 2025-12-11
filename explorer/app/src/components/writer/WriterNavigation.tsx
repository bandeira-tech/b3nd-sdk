import { useNavigate } from "react-router-dom";
import { Server, ShieldCheck, Play, Settings, FileText } from "lucide-react";
import type { ReactNode } from "react";
import type { WriterSection } from "../../types";
import { useAppStore } from "../../stores/appStore";
import { cn } from "../../utils";

export function WriterNavigation() {
  const { writerSection, setWriterSection } = useAppStore();
  const navigate = useNavigate();

  const primarySections: Array<{
    key: WriterSection;
    label: string;
    description: string;
    icon: ReactNode;
  }> = [
    {
      key: "backend",
      label: "Backend",
      description: "Write/read data against the selected backend",
      icon: <Server className="h-4 w-4" />,
    },
    {
      key: "auth",
      label: "Auth",
      description: "Sessions, authentication, and proxy writes",
      icon: <ShieldCheck className="h-4 w-4" />,
    },
    {
      key: "actions",
      label: "Actions",
      description: "Invoke registered actions",
      icon: <Play className="h-4 w-4" />,
    },
  ];

  const appSections: Array<{
    key: WriterSection;
    label: string;
    description: string;
    icon: ReactNode;
  }> = [
    {
      key: "configuration",
      label: "Application",
      description: "Manage app profile",
      icon: <Settings className="h-4 w-4" />,
    },
    {
      key: "schema",
      label: "Schema",
      description: "Register and configure app actions",
      icon: <FileText className="h-4 w-4" />,
    },
  ];

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-2">
        {primarySections.map((section) => (
          <NavButton
            key={section.key}
          active={writerSection === section.key}
          onClick={() => {
            setWriterSection(section.key);
            navigate(`/writer/${section.key}`);
          }}
          icon={section.icon}
          label={section.label}
          description={section.description}
        />
      ))}
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold text-muted-foreground uppercase px-1">
          Application
        </div>
        {appSections.map((section) => (
          <NavButton
            key={section.key}
          active={writerSection === section.key}
          onClick={() => {
            setWriterSection(section.key);
            navigate(`/writer/${section.key}`);
          }}
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
