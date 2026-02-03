import { cn } from "../../../utils";
import type { TestStatus } from "../types";

interface StatusBadgeProps {
  status: TestStatus;
  size?: "sm" | "md";
  showLabel?: boolean;
}

const statusConfig: Record<
  TestStatus,
  { label: string; bgColor: string; textColor: string; icon: string }
> = {
  running: {
    label: "Running",
    bgColor: "bg-blue-500/20",
    textColor: "text-blue-500",
    icon: "◌",
  },
  passed: {
    label: "Passed",
    bgColor: "bg-green-500/20",
    textColor: "text-green-500",
    icon: "✓",
  },
  failed: {
    label: "Failed",
    bgColor: "bg-red-500/20",
    textColor: "text-red-500",
    icon: "✗",
  },
  skipped: {
    label: "Skipped",
    bgColor: "bg-yellow-500/20",
    textColor: "text-yellow-500",
    icon: "○",
  },
  pending: {
    label: "Pending",
    bgColor: "bg-gray-500/20",
    textColor: "text-gray-500",
    icon: "○",
  },
};

export function StatusBadge({
  status,
  size = "sm",
  showLabel = false,
}: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-medium rounded-full",
        config.bgColor,
        config.textColor,
        size === "sm" ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-sm",
        status === "running" && "animate-pulse"
      )}
    >
      <span className={cn(status === "running" && "animate-spin")}>
        {config.icon}
      </span>
      {showLabel && <span>{config.label}</span>}
    </span>
  );
}
