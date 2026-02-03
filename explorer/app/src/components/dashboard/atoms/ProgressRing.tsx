import { cn } from "../../../utils";

interface ProgressRingProps {
  progress: number; // 0-100
  size?: "sm" | "md" | "lg";
  strokeWidth?: number;
  className?: string;
  showPercentage?: boolean;
}

const sizeConfig: Record<"sm" | "md" | "lg", { size: number; textSize: string }> = {
  sm: { size: 24, textSize: "text-[8px]" },
  md: { size: 40, textSize: "text-xs" },
  lg: { size: 64, textSize: "text-sm" },
};

export function ProgressRing({
  progress,
  size = "md",
  strokeWidth = 3,
  className,
  showPercentage = true,
}: ProgressRingProps) {
  const config = sizeConfig[size];
  const radius = (config.size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      <svg
        width={config.size}
        height={config.size}
        className="transform -rotate-90"
      >
        {/* Background circle */}
        <circle
          cx={config.size / 2}
          cy={config.size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted/30"
        />
        {/* Progress circle */}
        <circle
          cx={config.size / 2}
          cy={config.size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn(
            "transition-all duration-300",
            progress === 100
              ? "text-green-500"
              : progress > 0
              ? "text-primary"
              : "text-muted"
          )}
        />
      </svg>
      {showPercentage && (
        <span
          className={cn(
            "absolute font-medium text-foreground",
            config.textSize
          )}
        >
          {Math.round(progress)}%
        </span>
      )}
    </div>
  );
}
