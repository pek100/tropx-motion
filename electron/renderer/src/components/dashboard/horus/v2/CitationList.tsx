/**
 * CitationList Component
 *
 * Displays research citations with evidence tier badges.
 * Supports expandable list with quality links.
 */

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, ExternalLink, Quote } from "lucide-react";
import { isElectron } from "@/lib/platform";
import { EvidenceTierBadge, type EvidenceTier } from "../primitives";

export interface Citation {
  text: string;
  source: string;
  tier: EvidenceTier;
}

export interface QualityLink {
  url: string;
  title: string;
  tier: EvidenceTier;
  domain: string;
  relevance: string;
}

interface CitationListProps {
  citations: Citation[];
  links?: QualityLink[];
  maxVisible?: number;
  className?: string;
}

export function CitationList({
  citations,
  links = [],
  maxVisible = 2,
  className,
}: CitationListProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (citations.length === 0 && links.length === 0) {
    return null;
  }

  const visibleCitations = isExpanded ? citations : citations.slice(0, maxVisible);
  const hasMore = citations.length > maxVisible || links.length > 0;
  const hiddenCount = citations.length - maxVisible + links.length;

  // Open links in system browser when in Electron
  const handleLinkClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    if (isElectron() && window.electronAPI?.shell?.openExternal) {
      e.preventDefault();
      window.electronAPI.shell.openExternal(url);
    }
  }, []);

  return (
    <div className={cn("space-y-2", className)}>
      {/* Citations */}
      <ul role="list" className="space-y-2">
        {visibleCitations.map((citation, index) => (
          <li key={index} role="listitem">
            <blockquote className="flex gap-2 p-2 rounded-lg bg-[var(--tropx-muted)]">
              <Quote
                className="h-4 w-4 flex-shrink-0 mt-0.5 text-[var(--tropx-text-sub)]"
                aria-hidden="true"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm leading-relaxed text-[var(--tropx-text-main)]">
                  {citation.text}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <cite className="text-xs text-[var(--tropx-text-sub)] not-italic truncate">
                    {citation.source}
                  </cite>
                  <EvidenceTierBadge tier={citation.tier} size="sm" />
                </div>
              </div>
            </blockquote>
          </li>
        ))}
      </ul>

      {/* Expanded links section */}
      {isExpanded && links.length > 0 && (
        <div className="pt-2 border-t border-[var(--tropx-border)]">
          <p className="text-xs font-medium text-[var(--tropx-text-sub)] mb-1.5">
            Related Sources
          </p>
          <ul role="list" className="space-y-1">
            {links.map((link, index) => (
              <li key={index} role="listitem">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => handleLinkClick(e, link.url)}
                  className="flex items-center gap-2 p-1.5 rounded text-xs hover:bg-[var(--tropx-muted)] transition-colors group"
                >
                  <EvidenceTierBadge tier={link.tier} size="sm" showIcon={false} />
                  <span className="flex-1 truncate text-[var(--tropx-text-main)] group-hover:underline">
                    {link.title}
                  </span>
                  <ExternalLink
                    className="h-3 w-3 flex-shrink-0 text-[var(--tropx-text-sub)]"
                    aria-hidden="true"
                  />
                  <span className="sr-only">(opens in new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Expand/collapse button */}
      {hasMore && (
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-xs font-medium text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text-main)] transition-colors"
          aria-expanded={isExpanded}
        >
          <ChevronDown
            className={cn(
              "h-3 w-3 transition-transform",
              isExpanded && "rotate-180"
            )}
            aria-hidden="true"
          />
          {isExpanded ? "Show less" : `Show ${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}
