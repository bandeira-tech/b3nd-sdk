import { cn } from "../../../utils";

type HealthStatus = "healthy" | "unhealthy" | "unknown";

interface HealthDotProps {
  status: HealthStatus;
  size?: "sm" | "md" | "lg";
  pulse?: boolean;
}

const statusColors: Record<HealthStatus, string> = {
  healthy: "bg-green-500",
  unhealthy: "bg-red-500",
  unknown: "bg-gray-400",
};

const sizeClasses: Record<"sm" | "md" | "lg", string> = {
  sm: "w-2 h-2",
  md: "w-3 h-3",
  lg: "w-4 h-4",
};

export function HealthDot({ status, size = "md", pulse = true }: HealthDotProps) {
  return (
    <span className="relative inline-flex">
      <span
        className={cn(
          "rounded-full",
          sizeClasses[size],
          statusColors[status]
        )}
      />
      {pulse && status === "healthy" && (
        <span
          className={cn(
            "absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping",
            statusColors[status]
          )}
        />
      )}
    </span>
  );
}
