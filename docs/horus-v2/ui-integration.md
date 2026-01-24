---
id: horus-v2-ui
tags: [horus, ui, components, sections, electron]
related_files: [
  electron/renderer/src/components/dashboard/horus/HorusPane.tsx,
  electron/renderer/src/components/dashboard/horus/blocks/*,
  electron/renderer/src/components/dashboard/horus/primitives/*,
  convex/horus/v2/types.ts,
  convex/horus/v2/queries.ts
]
checklist: /docs/horus-v2/checklist.md
doc: /docs/horus-v2/README.md
status: planned
last_sync: 2026-01-22
---

# Horus V2 UI Integration Plan

## Overview

Connect Horus V2 agentic pipeline output to the dashboard UI using section cards that display enriched analysis findings with evidence citations.

## Data Flow

```
V2PipelineOutput (Convex)
    ↓
useV2Analysis hook (fetch + state)
    ↓
V2SectionsView (container)
    ↓
SectionCard[] (individual findings)
    ↓
[EvidenceTierBadge, CitationList, QAAccordion, ...]
```

## V2 Output → UI Mapping

### EnrichedSection Fields → SectionCard Display

| V2 Field | UI Location | Component |
|----------|-------------|-----------|
| `title` | Card header | Text |
| `domain` | Header badge | DomainBadge (existing) |
| `evidenceStrength.level` | Header badge | EvidenceTierBadge (new) |
| `userExplanation.summary` | Card body primary | Text |
| `userExplanation.whatItMeans` | Body secondary | Text |
| `userExplanation.whyItMatters` | Body tertiary | Text |
| `enrichedNarrative` | Expandable section | Collapsible |
| `qaReasoning[]` | Expandable accordion | QAAccordion (new) |
| `citations[]` | Expandable list | CitationList (new) |
| `enrichedRecommendations[]` | Card footer | Recommendation pills |
| `metricContributions[]` | Optional detail | MetricGrid (existing) |

### Pipeline Status → UI States

| Status | UI Display |
|--------|------------|
| `pending` | "Ready to analyze" button |
| `analyzing` | Loading skeleton + "Analyzing..." |
| `researching` | Progress indicator + section count |
| `complete` | Full section cards display |
| `error` | Error alert with retry option |

## New Components

### 1. EvidenceTierBadge

Evidence quality indicator using tier colors (S=gold, A=purple, B=blue, C=gray, D=muted).

```typescript
interface EvidenceTierBadgeProps {
  tier: EvidenceTier; // "S" | "A" | "B" | "C" | "D"
  showLabel?: boolean;
  size?: "sm" | "md";
}
```

Location: `primitives/EvidenceTierBadge.tsx`

### 2. SectionCard

Main card component displaying an EnrichedSection.

```typescript
interface SectionCardProps {
  section: EnrichedSection;
  defaultExpanded?: boolean;
  onCitationClick?: (citation: Citation) => void;
}
```

Structure:
```
┌─────────────────────────────────────────────────┐
│ [DomainBadge] Title            [EvidenceTier]   │ ← Header
├─────────────────────────────────────────────────┤
│ userExplanation.summary                         │
│                                                 │
│ What it means: ...                              │ ← Body
│ Why it matters: ...                             │
├─────────────────────────────────────────────────┤
│ ▶ Clinical Details (expandable)                 │
│ ▶ Q&A Reasoning (expandable)                    │ ← Expandable
│ ▶ Evidence (N citations)                        │
├─────────────────────────────────────────────────┤
│ [Rec 1] [Rec 2] [Rec 3]                        │ ← Footer
└─────────────────────────────────────────────────┘
```

Implementation notes:
- Use `<article>` as root element (semantic HTML)
- Apply `text-balance` to title
- Apply `leading-relaxed` to narrative text
- Use `aria-expanded` on expandable triggers
- Responsive: `p-3 md:p-4` padding

Location: `v2/SectionCard.tsx`

### 3. CitationList

Expandable list of citations with tier badges.

```typescript
interface CitationListProps {
  citations: Citation[];
  links?: QualityLink[];
  maxVisible?: number;
}
```

Location: `v2/CitationList.tsx`

### 4. QAAccordion

Accordion of Q&A reasoning pairs.

```typescript
interface QAAccordionProps {
  items: QAReasoning[];
  defaultOpen?: number; // Index of default open item
}
```

Location: `v2/QAAccordion.tsx`

### 5. V2SectionsView

Container that renders the full V2 analysis output.

```typescript
interface V2SectionsViewProps {
  output: V2PipelineOutput;
  layout?: "grid" | "list";
}
```

Structure:
```
┌─────────────────────────────────────────────────┐
│ Summary Card (strengths/weaknesses)             │
├──────────────────────┬──────────────────────────┤
│ [SectionCard 1]      │ [SectionCard 2]          │
├──────────────────────┼──────────────────────────┤
│ [SectionCard 3]      │ [SectionCard 4]          │
└──────────────────────┴──────────────────────────┘
```

Location: `v2/V2SectionsView.tsx`

### 6. V2SummaryCard

Overview card showing strengths/weaknesses from pipeline output.

```typescript
interface V2SummaryCardProps {
  summary: string;
  strengths: string[];
  weaknesses: string[];
}
```

Location: `v2/V2SummaryCard.tsx`

## Hook: useV2Analysis

```typescript
interface UseV2AnalysisReturn {
  // Data
  output: V2PipelineOutput | null;
  status: V2PipelineStatus;
  error: V2PipelineError | null;

  // Actions
  runAnalysis: () => Promise<void>;
  retryAnalysis: () => Promise<void>;

  // State
  isLoading: boolean;
  isAnalyzing: boolean;
  isResearching: boolean;
}

function useV2Analysis(sessionId: string): UseV2AnalysisReturn;
```

Location: `hooks/useV2Analysis.ts`

## Integration with HorusPane

The existing HorusPane has two modes: "overall" and "session". V2 integration targets the **session** mode.

### Current Session Mode Flow
```
HorusPane (session mode)
  → DemoContent (placeholder)
```

### New Session Mode Flow
```
HorusPane (session mode)
  → useV2Analysis(sessionId)
  → if analyzing: AnalyzingState
  → if complete: V2SectionsView
  → if error: ErrorState with retry
```

## File Structure

```
electron/renderer/src/components/dashboard/horus/
├── v2/                          # New directory
│   ├── index.ts                 # Exports
│   ├── SectionCard.tsx          # Main section card
│   ├── V2SectionsView.tsx       # Container
│   ├── V2SummaryCard.tsx        # Summary card
│   ├── CitationList.tsx         # Citations display
│   └── QAAccordion.tsx          # Q&A accordion
├── primitives/
│   └── EvidenceTierBadge.tsx    # New primitive
├── hooks/
│   └── useV2Analysis.ts         # New hook
└── HorusPane.tsx                # Updated integration
```

## Styling Approach

### Core Principles (per UIUX Skill)

1. **Reuse existing design tokens** - NO direct hex colors, use `var(--tropx-*)` tokens
2. **Reuse existing primitives**: DomainBadge, ExpandableDetails, IconWrapper
3. **Reuse existing gradients**: gradient-*-card classes
4. **Mobile-first responsive design** - Start with mobile, enhance with `md:` and `lg:` prefixes
5. **Flexbox for most layouts** - Grid only for V2SectionsView card grid
6. **Tailwind spacing scale** - Use `p-4`, `gap-3`, etc. NO arbitrary values like `p-[16px]`
7. **Gap classes for spacing** - Prefer `gap-*` over margin combinations

### Evidence Tier Colors (Reusing Existing Tokens)

Map evidence tiers to existing design tokens to maintain color palette consistency:

```css
/* In globals.css - LIGHT MODE */
--evidence-tier-s: var(--tropx-sand);        /* Gold/amber - Systematic Review (reuses existing) */
--evidence-tier-a: var(--tropx-vibrant);     /* Coral - RCT (avoids purple prominence) */
--evidence-tier-b: var(--tropx-info-text);   /* Blue - Peer-reviewed (reuses existing) */
--evidence-tier-c: var(--tropx-text-sub);    /* Gray - Professional (reuses existing) */
--evidence-tier-d: var(--leg-gray-band);     /* Muted - General (reuses existing) */

/* In globals.css - DARK MODE */
--evidence-tier-s: var(--tropx-sand);
--evidence-tier-a: var(--tropx-vibrant);
--evidence-tier-b: var(--tropx-info-text);
--evidence-tier-c: var(--tropx-text-sub);
--evidence-tier-d: var(--leg-gray-band);
```

**Rationale**: Avoids introducing new colors. Uses existing warm tones (sand, coral) for high-quality evidence, cool tones (blue, gray) for lower tiers. Avoids purple prominence per UIUX guidelines.

### Responsive Design

Mobile-first breakpoints for key components:

```typescript
// V2SectionsView - Card grid
<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:gap-6">

// SectionCard - Responsive padding
<Card className="p-3 md:p-4">

// CitationList - Stack on mobile, inline on desktop
<div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:gap-3">
```

### Accessibility Requirements

1. **Semantic HTML**
   - Use `<article>` for SectionCard (self-contained content)
   - Use `<section>` for V2SectionsView container
   - Use `<blockquote>` for citations

2. **ARIA Attributes**
   - `aria-expanded` on expandable sections
   - `aria-controls` linking expand buttons to content
   - `aria-label` on icon-only buttons
   - `role="list"` and `role="listitem"` for recommendation lists

3. **Screen Reader Support**
   - Add `sr-only` labels for evidence tiers: "Evidence quality: A tier"
   - Announce section count: "Analysis complete: 4 findings"

4. **Keyboard Navigation**
   - All expandable sections focusable and operable with Enter/Space
   - Tab order follows visual flow

5. **Typography**
   - Use `text-balance` on section titles
   - Use `leading-relaxed` on narrative text
   - Minimum font size 14px (text-sm = 14px)

### Tailwind Implementation Patterns

```typescript
// DO: Use spacing scale
className="p-4 gap-3 mt-2"

// DON'T: Use arbitrary values
className="p-[16px] gap-[12px] mt-[8px]"

// DO: Use gap for spacing
className="flex flex-col gap-3"

// DON'T: Mix margin with gap
className="flex flex-col gap-3 [&>*]:mb-2"

// DO: Use semantic tokens
className="text-[var(--tropx-text-main)] bg-[var(--tropx-card)]"

// DON'T: Use direct colors
className="text-slate-900 bg-white"
```

## Implementation Order

1. **Primitives first**: EvidenceTierBadge
2. **Small components**: CitationList, QAAccordion
3. **Main card**: SectionCard
4. **Container**: V2SectionsView, V2SummaryCard
5. **Hook**: useV2Analysis
6. **Integration**: Update HorusPane session mode

## Query Requirements

Add to `convex/horus/v2/queries.ts`:

```typescript
// Get pipeline output for session
export const getPipelineOutput = query({
  args: { sessionId: v.string() },
  returns: v.union(v.null(), v.object({ ... })),
  handler: async (ctx, { sessionId }) => {
    // Fetch from horusAnalyses table
  },
});

// Get pipeline status (lightweight)
export const getPipelineStatus = query({
  args: { sessionId: v.string() },
  returns: v.object({ status: v.string(), error: v.optional(...) }),
  handler: async (ctx, { sessionId }) => {
    // Fetch status only
  },
});
```
