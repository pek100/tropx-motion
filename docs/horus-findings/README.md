---
id: horus-findings
tags: [horus, ai, visualization, components, frontend, backend]
related_files:
  - electron/renderer/src/components/dashboard/horus/blocks/*.tsx
  - convex/horus/visualization/types.ts
  - convex/horus/llm/schemas.ts
  - convex/horus/prompts/analysis.ts
  - convex/horus/correlation.ts
checklist: /docs/horus-findings/checklist.md
doc: /docs/horus-findings/README.md
status: in-progress
last_sync: 2024-12-27
---

# Enhanced Horus AI Findings System

## Overview

Enhance the Analysis and Progress agents to generate richer findings with composable card slots (ShadCN-style approach).

## Goals

1. More detailed findings/concerns from Analysis & Progress agents
2. Correlative insights (non-obvious relationships)
3. Normative benchmarking (optimal/average/deficient)
4. Qualitative classification (strength/weakness on everything)
5. Side specificity (explicit limb naming: "Left Leg shows...")

## Approach

**Composable Card Slots** (ShadCN-style) - Enhance existing cards with optional slots:
- Primitives over monoliths
- Opt-in complexity
- Same card type, infinite configurations
- AI decides which slots to fill

### Web-Validated Design Principles
1. **Color System**: Green=strength, Amber=weakness, Red=critical only
2. **Progressive Disclosure**: Show details on demand, keep primary scannable
3. **Hover Preview**: Optional quick preview before click-to-expand
4. **Framer Motion**: Smooth expand/collapse animations
5. **Consistent Visual Language**: Same colors/icons mean same things everywhere

## Current State

### Components (9 blocks)
| Component | Has Expandable | Has Badges | Needs Enhancement |
|-----------|---------------|------------|-------------------|
| StatCard | No | Yes | Add slots |
| AlertCard | No | No | Add slots, rename severity→variant |
| ComparisonCard | No | No | Add deficitLimb, slots |
| ProgressCard | No | No | Add slots |
| MetricGrid | No | No | Add per-item slots |
| NextSteps | Yes | No | Already has expandable |
| QuoteCard | No | No | Add slots |
| ChartBlock | No | No | Minor enhancements |
| ExecutiveSummary | No | No | Add variant |

### Identified Inconsistencies
- Icon sizes: h-4 vs h-5 (need standardization)
- Prop naming: `severity` vs `variant`
- Only NextSteps has expandable support
- Three different comparison patterns
- Hard-coded gradient classes

## File Structure

```
/docs/horus-findings/
├── README.md           <- This file
├── decomposition.md    <- $FUNNEL tree structure
└── checklist.md        <- Implementation tasks

/convex/horus/
├── correlation.ts      <- NEW: Correlation detection
├── visualization/types.ts <- Enhanced with ComposableSlots
├── llm/schemas.ts      <- Updated block schemas
└── prompts/analysis.ts <- Correlation injection

/electron/renderer/src/components/dashboard/horus/
├── primitives/         <- NEW: Shared primitives
│   ├── ExpandableDetails.tsx
│   ├── ClassificationBadge.tsx
│   ├── LimbBadge.tsx
│   ├── BenchmarkBadge.tsx
│   └── index.ts
└── blocks/             <- Enhanced existing blocks
    ├── StatCard.tsx
    ├── AlertCard.tsx
    └── ...
```
