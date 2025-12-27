/**
 * QuoteCard Block
 *
 * Evidence citation or key finding highlight.
 * Enhanced with id and domain for correlation linking.
 * Uses TropX theme tokens for consistent styling.
 */

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { LucideIconName } from "../types";
import { DomainBadge, getIconSizeClass, type MetricDomain } from "../primitives";

interface QuoteCardProps {
  content: string;
  citation?: string;
  icon?: LucideIconName;
  variant?: "info" | "evidence" | "recommendation";
  className?: string;

  // Composable Slots (optional)
  id?: string;
  domain?: MetricDomain;
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
  // Composable slots
  id,
  domain,
}: QuoteCardProps) {
  const styles = variantStyles[variant];
  const iconName = icon || styles.defaultIcon;
  const IconComponent = Icons[iconName as keyof typeof Icons] as LucideIcon;

  return (
    <Card className={cn("py-3 rounded-l-none border-[var(--tropx-border)]", styles.container, className)} data-finding-id={id}>
      <CardContent className="px-4 py-0">
        <div className="flex gap-3">
          {IconComponent && (
            <div className="flex-shrink-0 mt-0.5">
              <IconComponent className={cn(getIconSizeClass("sm"), styles.icon)} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <blockquote className="text-sm italic text-[var(--tropx-text-main)]">&ldquo;{content}&rdquo;</blockquote>
            <div className="flex items-center gap-2 mt-1">
              {citation && (
                <cite className="text-xs text-[var(--tropx-text-sub)] not-italic">
                  — {citation}
                </cite>
              )}
              {domain && <DomainBadge domain={domain} size="sm" />}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
