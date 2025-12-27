/**
 * ScoreRing - Circular score/progress indicator
 * Matches the concept design with animated ring and centered score.
 */

import { cn } from "@/lib/utils";

interface ScoreRingProps {
  value: number;
  label: string;
  size?: "sm" | "md" | "lg";
  color?: "default" | "success" | "warning" | "error";
  className?: string;
}

const sizeConfig = {
  sm: { ring: 56, stroke: 4, text: "text-lg", label: "text-[10px]" },
  md: { ring: 72, stroke: 5, text: "text-2xl", label: "text-xs" },
  lg: { ring: 88, stroke: 6, text: "text-3xl", label: "text-xs" },
};

const colorConfig = {
  default: {
    stroke: "var(--tropx-vibrant)",
    text: "text-tropx-vibrant",
  },
  success: {
    stroke: "var(--tropx-success-text)",
    text: "text-status-success-text",
  },
  warning: {
    stroke: "var(--tropx-warning-text)",
    text: "text-status-warning-text",
  },
  error: {
    stroke: "hsl(var(--destructive))",
    text: "text-destructive",
  },
};

export function ScoreRing({
  value,
  label,
  size = "md",
  color = "default",
  className,
}: ScoreRingProps) {
  const { ring, stroke, text, label: labelSize } = sizeConfig[size];
  const { stroke: strokeColor, text: textColor } = colorConfig[color];

  const radius = (ring - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(Math.max(value, 0), 100);
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <div className="relative" style={{ width: ring, height: ring }}>
        <svg
          width={ring}
          height={ring}
          viewBox={`0 0 ${ring} ${ring}`}
          className="-rotate-90"
        >
          {/* Background ring */}
          <circle
            cx={ring / 2}
            cy={ring / 2}
            r={radius}
            fill="none"
            stroke="var(--tropx-muted)"
            strokeWidth={stroke}
          />
          {/* Progress ring */}
          <circle
            cx={ring / 2}
            cy={ring / 2}
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-500 ease-out"
          />
        </svg>
        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("font-bold", text, textColor)}>{value}</span>
        </div>
      </div>
      <span className={cn("text-[var(--tropx-text-sub)] mt-1", labelSize)}>{label}</span>
    </div>
  );
}
