/**
 * SectionCard Component
 *
 * Visualization-focused finding card with progressive disclosure.
 * Prioritizes visual indicators over text for quick scanning.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  Lightbulb,
  ExternalLink,
  HelpCircle,
  AlertCircle,
  Activity,
  Zap,
  Target,
  Move,
  Timer,
  Shield,
  BookOpen,
} from "lucide-react";
import type { EvidenceTier } from "../primitives";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type SeverityLevel = "critical" | "severe" | "moderate" | "mild" | "profound";

export interface UserExplanation {
  summary: string;
  whatItMeans: string;
  whyItMatters: string;
  analogy?: string;
}

export type EvidenceLevel = "none" | "minimal" | "moderate" | "high" | "very-high";

export interface EvidenceStrength {
  level: EvidenceLevel;
  notes?: string;
}

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

export interface QAReasoning {
  question: string;
  answer: string;
}

export interface EnrichedSectionData {
  id: string;
  title: string;
  domain: string;
  severity: SeverityLevel;
  priority: number;
  clinicalNarrative: string;
  enrichedNarrative: string;
  userExplanation: UserExplanation;
  qaReasoning: QAReasoning[];
  citations: Citation[];
  links: QualityLink[];
  evidenceStrength: EvidenceStrength;
  recommendation: string;
  wasContradicted?: boolean;
  enrichmentFailed?: boolean;
}

interface SectionCardProps {
  section: EnrichedSectionData;
  defaultExpanded?: boolean;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Visual Components
// ─────────────────────────────────────────────────────────────────

/** Domain icons for quick visual identification */
const DOMAIN_ICONS: Record<string, React.ReactNode> = {
  symmetry: <Target className="h-4 w-4" />,
  power: <Zap className="h-4 w-4" />,
  control: <Activity className="h-4 w-4" />,
  range: <Move className="h-4 w-4" />,
  timing: <Timer className="h-4 w-4" />,
};

/** Get domain icon with fallback */
function getDomainIcon(domain: string): React.ReactNode {
  return DOMAIN_ICONS[domain.toLowerCase()] || <Activity className="h-4 w-4" />;
}

/** Get severity color */
function getSeverityColor(severity: SeverityLevel): string {
  switch (severity) {
    case "critical":
    case "profound":
      return "var(--tropx-red)";
    case "severe":
      return "#f97316"; // orange-500
    case "moderate":
      return "var(--tropx-warning-text)";
    case "mild":
    default:
      return "var(--tropx-success-text)";
  }
}

/** Severity dot indicator - simple colored dot with label */
function SeverityDot({ severity }: { severity: SeverityLevel }) {
  const color = getSeverityColor(severity);

  return (
    <div className="flex items-center gap-1.5">
      <div
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="text-[10px] capitalize" style={{ color }}>
        {severity}
      </span>
    </div>
  );
}

/** Evidence descriptions */
const EVIDENCE_DESCRIPTIONS: Record<EvidenceLevel, string> = {
  "none": "No research evidence found",
  "minimal": "Minimal research evidence",
  "moderate": "Moderate research evidence",
  "high": "High research evidence",
  "very-high": "Very high research evidence",
};

/** Evidence strength indicator - 4 bars showing confidence level */
function EvidenceStrengthIndicator({ level }: { level: EvidenceLevel }) {
  const levelToFilled: Record<EvidenceLevel, number> = {
    "none": 0,
    "minimal": 1,
    "moderate": 2,
    "high": 3,
    "very-high": 4,
  };
  const filled = levelToFilled[level] ?? 0;

  return (
    <div className="flex items-center gap-1.5">
      <Shield className="h-3 w-3 text-[var(--tropx-text-sub)]" />
      <div className="flex gap-0.5">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={cn(
              "h-2 w-1 rounded-sm",
              i < filled ? "bg-[var(--tropx-vibrant)]" : "bg-[var(--tropx-border)]/30"
            )}
          />
        ))}
      </div>
      <span className="text-[10px] text-[var(--tropx-text-sub)]">
        {EVIDENCE_DESCRIPTIONS[level]}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Collapsible Section Component
// ─────────────────────────────────────────────────────────────────

interface CollapsibleSectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function CollapsibleSection({
  title,
  icon,
  children,
  defaultOpen = false,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg overflow-hidden border border-[var(--tropx-border)]/30">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between gap-2 w-full px-3 py-2 text-left hover:bg-[var(--tropx-surface)]/50 transition-colors"
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--tropx-text-sub)]">
          {icon}
          {title}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-[var(--tropx-text-sub)] transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </button>
      {isOpen && (
        <div className="px-3 pb-3 text-xs leading-relaxed text-[var(--tropx-text-sub)]">
          {children}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Source Links Component (sorted by quality, expandable)
// ─────────────────────────────────────────────────────────────────

const VISIBLE_LINKS_COUNT = 5;

/** Tier priority: S=0, A=1, B=2, C=3, D=4 */
const TIER_PRIORITY: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };

/** High-quality domains to prioritize */
const PRIORITY_DOMAINS = [
  "pubmed.ncbi.nlm.nih.gov",
  "ncbi.nlm.nih.gov",
  "nature.com",
  "sciencedirect.com",
  "springer.com",
  "cochrane.org",
  "bmj.com",
  "jamanetwork.com",
  "physio-pedia.com",
];

function sortLinksByQuality(links: QualityLink[]): QualityLink[] {
  return [...links].sort((a, b) => {
    // First sort by tier (S > A > B > C > D)
    const tierA = TIER_PRIORITY[a.tier] ?? 4;
    const tierB = TIER_PRIORITY[b.tier] ?? 4;
    if (tierA !== tierB) return tierA - tierB;

    // Then prioritize known high-quality domains
    const aPriority = PRIORITY_DOMAINS.findIndex((d) => a.domain.includes(d));
    const bPriority = PRIORITY_DOMAINS.findIndex((d) => b.domain.includes(d));
    const aScore = aPriority === -1 ? 999 : aPriority;
    const bScore = bPriority === -1 ? 999 : bPriority;
    return aScore - bScore;
  });
}

function SourceLinks({ links }: { links: QualityLink[] }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const sortedLinks = sortLinksByQuality(links);
  const hasMore = sortedLinks.length > VISIBLE_LINKS_COUNT;
  const visibleLinks = isExpanded ? sortedLinks : sortedLinks.slice(0, VISIBLE_LINKS_COUNT);
  const hiddenCount = sortedLinks.length - VISIBLE_LINKS_COUNT;

  return (
    <div className="space-y-2">
      <span className="text-[10px] font-semibold text-[var(--tropx-text-sub)] uppercase tracking-wide">
        Sources
      </span>
      <div className="flex flex-wrap gap-1.5">
        {visibleLinks.map((link, index) => (
          <a
            key={index}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-full",
              "gradient-blue-card text-[var(--tropx-text-main)]",
              "hover:opacity-80 transition-opacity truncate max-w-[180px]"
            )}
            title={link.title}
          >
            <span className="truncate">{link.domain}</span>
            <ExternalLink className="h-2.5 w-2.5 flex-shrink-0" />
          </a>
        ))}
        {hasMore && !isExpanded && (
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-full bg-[var(--tropx-surface)] text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text-main)] transition-colors"
          >
            +{hiddenCount} more
          </button>
        )}
        {isExpanded && hasMore && (
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-full bg-[var(--tropx-surface)] text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text-main)] transition-colors"
          >
            Show less
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────

export function SectionCard({
  section,
  defaultExpanded = false,
  className,
}: SectionCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const severity = section.severity || "moderate";
  const hasLinks = section.links.length > 0;
  const evidenceLevel = section.evidenceStrength?.level || "moderate";

  return (
    <article
      className={cn(
        "rounded-xl overflow-hidden bg-[var(--tropx-card)] border border-[var(--tropx-border)]",
        className
      )}
      data-section-id={section.id}
    >
        {/* Header - domain icon + title + visual indicators */}
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full text-left px-3 py-2.5 hover:bg-[var(--tropx-surface)]/30 transition-colors"
          aria-expanded={isExpanded}
        >
          {/* Top row: Icon + Title + Chevron */}
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[var(--tropx-text-sub)]">
                {getDomainIcon(section.domain)}
              </span>
              <h3 className="text-sm font-semibold text-[var(--tropx-text-main)] truncate">
                {section.title}
              </h3>
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-[var(--tropx-text-sub)] transition-transform flex-shrink-0",
                isExpanded && "rotate-180"
              )}
            />
          </div>

          {/* Visual indicators row */}
          <div className="flex items-center gap-4">
            <SeverityDot severity={severity} />
            <EvidenceStrengthIndicator level={evidenceLevel} />
          </div>
        </button>

      {/* Expanded content - visual summary first, then collapsible text */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-3">
          {/* Key insight - one line summary */}
          <p
            className="text-sm text-[var(--tropx-text-main)] px-3 py-2 rounded-lg"
            style={{
              backgroundColor: `color-mix(in srgb, ${getSeverityColor(severity)} 12%, transparent)`,
            }}
          >
            {section.userExplanation.summary}
          </p>

          {/* Recommendation highlight if present */}
          {section.recommendation && (
            <div className="flex items-start gap-2 p-2 rounded-lg bg-[var(--tropx-surface)]/30">
              <Lightbulb className="h-3.5 w-3.5 text-[var(--tropx-success-text)] mt-0.5 flex-shrink-0" />
              <p className="text-xs text-[var(--tropx-text-main)]">
                {section.recommendation}
              </p>
            </div>
          )}

          {/* Learn more - all detailed text collapsed */}
          <CollapsibleSection
            title="Learn more"
            icon={<BookOpen className="h-3.5 w-3.5" />}
          >
            <div className="space-y-3">
              {/* What it means */}
              <div>
                <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#3b82f6]">
                  <HelpCircle className="h-3 w-3" />
                  What it means
                </span>
                <p className="mt-1">{section.userExplanation.whatItMeans}</p>
              </div>

              {/* Why it matters */}
              <div>
                <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#f59e0b]">
                  <AlertCircle className="h-3 w-3" />
                  Why it matters
                </span>
                <p className="mt-1">{section.userExplanation.whyItMatters}</p>
              </div>

              {/* Analogy if present */}
              {section.userExplanation.analogy && (
                <div>
                  <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#8b5cf6]">
                    <Lightbulb className="h-3 w-3" />
                    Simple explanation
                  </span>
                  <p className="mt-1 italic">{section.userExplanation.analogy}</p>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* Source Links - compact at bottom */}
          {hasLinks && <SourceLinks links={section.links} />}
        </div>
      )}
    </article>
  );
}
