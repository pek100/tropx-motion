/**
 * AlertCard Block
 *
 * Warning or notification with variant level.
 * Enhanced with composable slots for rich AI-generated findings.
 * Uses TropX theme tokens for consistent styling.
 *
 * Note: `severity` is deprecated, use `variant` instead.
 */

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { LucideIconName } from "../types";
import {
  ExpandableDetails,
  LimbBadge,
  DomainBadge,
  getIconSizeClass,
  type DetailsSlot,
  type Limb,
  type MetricDomain,
} from "../primitives";

type AlertVariant = "info" | "warning" | "error" | "success";

interface AlertCardProps {
  title: string;
  description: string;
  /** New prop name (preferred) */
  variant?: AlertVariant;
  /** @deprecated Use `variant` instead */
  severity?: AlertVariant;
  icon?: LucideIconName;
  className?: string;

  // Composable Slots (optional)
  id?: string;
  limb?: Limb;
  domain?: MetricDomain;
  details?: DetailsSlot;
  expandable?: boolean;
  defaultExpanded?: boolean;
}

const variantStyles = {
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
  variant,
  severity, // Deprecated, fallback to variant
  icon,
  className,
  // Composable slots
  id,
  limb,
  domain,
  details,
  expandable = true,
  defaultExpanded = false,
}: AlertCardProps) {
  // Use variant, fall back to severity for backward compatibility
  const resolvedVariant = variant ?? severity ?? "info";
  const styles = variantStyles[resolvedVariant];
  const iconName = icon || styles.defaultIcon;
  const IconComponent = Icons[iconName] as LucideIcon;

  // Check if any badges are present
  const hasBadges = limb || domain;

  return (
    <Card className={cn("py-3 border", styles.container, className)} data-finding-id={id}>
      <CardContent className="px-4 py-0">
        <div className="flex gap-3">
          {IconComponent && (
            <div className="flex-shrink-0 mt-0.5">
              <IconComponent className={cn(getIconSizeClass("md"), styles.icon)} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h4 className={cn("text-sm font-semibold", styles.title)}>{title}</h4>
            <p className={cn("text-sm mt-0.5", styles.description)}>{description}</p>

            {/* Composable badge slots */}
            {hasBadges && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {limb && <LimbBadge limb={limb} />}
                {domain && <DomainBadge domain={domain} />}
              </div>
            )}

            {/* Expandable details slot */}
            {expandable && details && (
              <ExpandableDetails
                details={details}
                defaultExpanded={defaultExpanded}
                hoverPreview={true}
              />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
