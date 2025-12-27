/**
 * QuoteCard Block
 *
 * Evidence citation or key finding highlight.
 * Uses TropX theme tokens for consistent styling.
 */

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { LucideIconName } from "../types";

interface QuoteCardProps {
  content: string;
  citation?: string;
  icon?: LucideIconName;
  variant?: "info" | "evidence" | "recommendation";
  className?: string;
}

const variantStyles = {
  info: {
    container: "border-l-4 border-l-[var(--tropx-info-text)] bg-[var(--tropx-card)]",
    icon: "text-[var(--tropx-info-text)]",
    defaultIcon: "Info" as LucideIconName,
  },
  evidence: {
    container: "border-l-4 border-l-[var(--tropx-vibrant)] bg-[var(--tropx-card)]",
    icon: "text-[var(--tropx-vibrant)]",
    defaultIcon: "FlaskConical" as LucideIconName,
  },
  recommendation: {
    container: "border-l-4 border-l-[var(--tropx-success-text)] bg-[var(--tropx-card)]",
    icon: "text-[var(--tropx-success-text)]",
    defaultIcon: "Lightbulb" as LucideIconName,
  },
};

export function QuoteCard({
  content,
  citation,
  icon,
  variant = "info",
  className,
}: QuoteCardProps) {
  const styles = variantStyles[variant];
  const iconName = icon || styles.defaultIcon;
  const IconComponent = Icons[iconName as keyof typeof Icons] as LucideIcon;

  return (
    <Card className={cn("py-3 rounded-l-none border-[var(--tropx-border)]", styles.container, className)}>
      <CardContent className="px-4 py-0">
        <div className="flex gap-3">
          {IconComponent && (
            <div className="flex-shrink-0 mt-0.5">
              <IconComponent className={cn("h-4 w-4", styles.icon)} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <blockquote className="text-sm italic text-[var(--tropx-text-main)]">&ldquo;{content}&rdquo;</blockquote>
            {citation && (
              <cite className="text-xs text-[var(--tropx-text-sub)] mt-1 block not-italic">
                — {citation}
              </cite>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
