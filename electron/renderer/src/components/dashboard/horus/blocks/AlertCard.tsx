/**
 * AlertCard Block
 *
 * Warning or notification with severity level.
 * Uses TropX theme tokens for consistent styling.
 */

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { LucideIconName } from "../types";

interface AlertCardProps {
  title: string;
  description: string;
  severity: "info" | "warning" | "error" | "success";
  icon?: LucideIconName;
  className?: string;
}

const severityStyles = {
  info: {
    container: "gradient-info-card border-none",
    icon: "text-[var(--tropx-info-text)]",
    title: "text-[var(--tropx-text-main)]",
    description: "text-[var(--tropx-text-sub)]",
    defaultIcon: "Info" as LucideIconName,
  },
  warning: {
    container: "gradient-amber-card border-none",
    icon: "text-[var(--tropx-warning-text)]",
    title: "text-[var(--tropx-text-main)]",
    description: "text-[var(--tropx-text-sub)]",
    defaultIcon: "AlertTriangle" as LucideIconName,
  },
  error: {
    container: "gradient-red-card border-none",
    icon: "text-[var(--tropx-red)]",
    title: "text-[var(--tropx-text-main)]",
    description: "text-[var(--tropx-text-sub)]",
    defaultIcon: "AlertCircle" as LucideIconName,
  },
  success: {
    container: "gradient-green-card border-none",
    icon: "text-[var(--tropx-success-text)]",
    title: "text-[var(--tropx-text-main)]",
    description: "text-[var(--tropx-text-sub)]",
    defaultIcon: "CheckCircle" as LucideIconName,
  },
};

export function AlertCard({
  title,
  description,
  severity,
  icon,
  className,
}: AlertCardProps) {
  const styles = severityStyles[severity];
  const iconName = icon || styles.defaultIcon;
  const IconComponent = Icons[iconName] as LucideIcon;

  return (
    <Card className={cn("py-3 border", styles.container, className)}>
      <CardContent className="px-4 py-0">
        <div className="flex gap-3">
          {IconComponent && (
            <div className="flex-shrink-0 mt-0.5">
              <IconComponent className={cn("h-5 w-5", styles.icon)} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h4 className={cn("text-sm font-semibold", styles.title)}>{title}</h4>
            <p className={cn("text-sm mt-0.5", styles.description)}>{description}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
