/**
 * ExpandableDetails Primitive
 *
 * Collapsible section for progressive disclosure of card details.
 * Used by composable cards to show evidence, implications, recommendations.
 *
 * Features:
 * - Framer Motion smooth expand/collapse
 * - Optional hover preview (tooltip-style)
 * - Chevron only shown when content exists
 * - TropX theme tokens
 */

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  FileText,
  AlertCircle,
  Lightbulb,
  Link2,
} from "lucide-react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface DetailsSlot {
  /** Research citations / evidence supporting the finding */
  evidence?: string[];
  /** Clinical implications of this finding */
  implications?: string[];
  /** Actionable recommendations */
  recommendations?: string[];
  /** IDs linking to related cards/findings (for correlation) */
  relatedIds?: string[];
}

interface ExpandableDetailsProps {
  /** The details content to display */
  details: DetailsSlot;
  /** Whether to start expanded */
  defaultExpanded?: boolean;
  /** Enable hover preview before expanding */
  hoverPreview?: boolean;
  /** Additional className */
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Animation Variants
// ─────────────────────────────────────────────────────────────────

const contentVariants = {
  collapsed: {
    height: 0,
    opacity: 0,
    transition: {
      height: { duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] },
      opacity: { duration: 0.2 },
    },
  },
  expanded: {
    height: "auto",
    opacity: 1,
    transition: {
      height: { duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] },
      opacity: { duration: 0.2, delay: 0.1 },
    },
  },
};

const chevronVariants = {
  collapsed: { rotate: 0 },
  expanded: { rotate: 180 },
};

// ─────────────────────────────────────────────────────────────────
// Section Components
// ─────────────────────────────────────────────────────────────────

interface DetailSectionProps {
  title: string;
  icon: React.ReactNode;
  items: string[];
  iconColorClass: string;
}

function DetailSection({ title, icon, items, iconColorClass }: DetailSectionProps) {
  if (!items.length) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className={cn("flex-shrink-0", iconColorClass)}>{icon}</span>
        <span className="text-xs font-medium text-[var(--tropx-text-sub)] uppercase tracking-wide">
          {title}
        </span>
      </div>
      <ul className="space-y-1 pl-5">
        {items.map((item, idx) => (
          <li
            key={idx}
            className="text-sm text-[var(--tropx-text-main)] list-disc marker:text-[var(--tropx-text-sub)]"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Hover Preview Content
// ─────────────────────────────────────────────────────────────────

function HoverPreviewContent({ details }: { details: DetailsSlot }) {
  const totalItems =
    (details.evidence?.length || 0) +
    (details.implications?.length || 0) +
    (details.recommendations?.length || 0);

  return (
    <div className="space-y-1 text-xs">
      <p className="font-medium text-[var(--tropx-text-main)]">
        Click to expand details
      </p>
      <p className="text-[var(--tropx-text-sub)]">
        {details.evidence?.length ? `${details.evidence.length} evidence` : ""}
        {details.evidence?.length && details.implications?.length ? " · " : ""}
        {details.implications?.length
          ? `${details.implications.length} implications`
          : ""}
        {(details.evidence?.length || details.implications?.length) &&
        details.recommendations?.length
          ? " · "
          : ""}
        {details.recommendations?.length
          ? `${details.recommendations.length} recommendations`
          : ""}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────

export function ExpandableDetails({
  details,
  defaultExpanded = false,
  hoverPreview = true,
  className,
}: ExpandableDetailsProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const contentRef = useRef<HTMLDivElement>(null);

  // Check if there's any content to show
  const hasContent =
    (details.evidence?.length ?? 0) > 0 ||
    (details.implications?.length ?? 0) > 0 ||
    (details.recommendations?.length ?? 0) > 0;

  // Don't render if no content
  if (!hasContent) return null;

  const triggerButton = (
    <button
      onClick={() => setIsExpanded(!isExpanded)}
      className={cn(
        "flex items-center gap-1 text-xs font-medium",
        "text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text-main)]",
        "transition-colors duration-150",
        "py-1 px-2 -mx-2 rounded-md",
        "hover:bg-[var(--tropx-hover)]"
      )}
    >
      <span>Details</span>
      <motion.span
        variants={chevronVariants}
        animate={isExpanded ? "expanded" : "collapsed"}
        transition={{ duration: 0.2 }}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </motion.span>
    </button>
  );

  return (
    <div className={cn("mt-3 pt-3 border-t border-[var(--tropx-border)]", className)}>
      {/* Trigger with optional hover preview */}
      {hoverPreview && !isExpanded ? (
        <HoverCard openDelay={400} closeDelay={100}>
          <HoverCardTrigger asChild>{triggerButton}</HoverCardTrigger>
          <HoverCardContent
            side="top"
            align="start"
            className="w-auto max-w-xs bg-[var(--tropx-card)] border-[var(--tropx-border)]"
          >
            <HoverPreviewContent details={details} />
          </HoverCardContent>
        </HoverCard>
      ) : (
        triggerButton
      )}

      {/* Expandable content */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            ref={contentRef}
            variants={contentVariants}
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
            className="overflow-hidden"
          >
            <div className="pt-3 space-y-4">
              {details.evidence && details.evidence.length > 0 && (
                <DetailSection
                  title="Evidence"
                  icon={<FileText className="h-3.5 w-3.5" />}
                  items={details.evidence}
                  iconColorClass="text-[var(--tropx-info-text)]"
                />
              )}

              {details.implications && details.implications.length > 0 && (
                <DetailSection
                  title="Implications"
                  icon={<AlertCircle className="h-3.5 w-3.5" />}
                  items={details.implications}
                  iconColorClass="text-[var(--tropx-warning-text)]"
                />
              )}

              {details.recommendations && details.recommendations.length > 0 && (
                <DetailSection
                  title="Recommendations"
                  icon={<Lightbulb className="h-3.5 w-3.5" />}
                  items={details.recommendations}
                  iconColorClass="text-[var(--tropx-success-text)]"
                />
              )}

              {details.relatedIds && details.relatedIds.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-[var(--tropx-text-sub)]">
                  <Link2 className="h-3.5 w-3.5" />
                  <span>Related: {details.relatedIds.join(", ")}</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
