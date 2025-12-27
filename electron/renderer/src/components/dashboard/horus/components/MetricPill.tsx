/**
 * MetricPill - Small metric badge/pill
 * Used for displaying compact metrics like Duration, Total Sets, Load.
 */

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface MetricPillProps {
  icon?: ReactNode;
  label: string;
  value: string | number;
  className?: string;
}

export function MetricPill({ icon, label, value, className }: MetricPillProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full",
        "bg-[var(--tropx-muted)] border border-[var(--tropx-border)]",
        className
      )}
    >
      {icon && <span className="text-[var(--tropx-text-sub)]">{icon}</span>}
      <span className="text-xs text-[var(--tropx-text-sub)] uppercase tracking-wide">
        {label}
      </span>
      <span className="text-xs font-semibold text-[var(--tropx-text-main)]">{value}</span>
    </div>
  );
}
