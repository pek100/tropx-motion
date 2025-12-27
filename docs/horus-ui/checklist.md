---
id: horus-ui
tags: [ui, visualization, ai, blocks, recharts, critical]
related_files: [convex/horus/visualization/*, electron/renderer/src/components/dashboard/horus/*]
checklist: /docs/horus-ui/checklist.md
doc: /docs/horus-ui/README.md
status: in-progress
last_sync: 2024-12-25
---

# Horus UI Visualization System - Implementation Checklist

## Phase 1: Backend - Visualization Schema ✅

### 1.1 Type Definitions
- [x] Create `convex/horus/visualization/types.ts`
  - [x] `VisualizationBlock` union type (all block types)
  - [x] `MetricExpression` type (string with dot notation)
  - [x] `ExecutiveSummaryBlock` interface
  - [x] `StatCardBlock` interface
  - [x] `AlertCardBlock` interface
  - [x] `NextStepsBlock` interface
  - [x] `ComparisonCardBlock` interface
  - [x] `ProgressCardBlock` interface
  - [x] `MetricGridBlock` interface
  - [x] `QuoteCardBlock` interface
  - [x] `ChartBlockBlock` interface
  - [x] `ChartDataSpec` interface
  - [x] `RechartsType` union (all Recharts types)
  - [x] `LucideIconName` type

### 1.2 Recharts Catalog
- [x] Create `convex/horus/visualization/catalog.ts`
  - [x] `RECHARTS_CATALOG` - Available chart types with descriptions
  - [x] `getChartTypeDescription()` - For AI prompt context
  - [x] `getVisualizationCatalogForPrompt()` - Complete catalog for AI
  - [x] `ICON_CATALOG` - Curated subset of icons for AI
  - [x] `getMetricPaths()` - All valid metric expressions

### 1.3 Expression Evaluator
- [x] Create `convex/horus/visualization/evaluator.ts`
  - [x] `isValidMetricPath()` - Validate metric path
  - [x] `resolveMetricValue()` - Get value from SessionMetrics
  - [x] `evaluateFormula()` - Parse and compute formula (safe, no eval)
  - [x] Support math operators: `+`, `-`, `*`, `/`, `%`
  - [x] Support functions: `abs()`, `min()`, `max()`, `round()`, `sqrt()`, `pow()`
  - [x] Support context variables: `current`, `previous`, `baseline`, `average`, `min`, `max`
  - [x] Error handling for invalid expressions

### 1.4 Visualization Module Exports
- [x] Create `convex/horus/visualization/index.ts`
  - [x] Export all types
  - [x] Export catalog
  - [x] Export evaluator functions

---

## Phase 2: Frontend - Block Components ✅

### 2.1 ExecutiveSummary
- [x] Create `electron/renderer/src/components/dashboard/horus/blocks/ExecutiveSummary.tsx`
  - [x] Markdown rendering (react-markdown)
  - [x] Styled container with title
  - [x] Support inline highlighting via markdown syntax

### 2.2 StatCard
- [x] Create `electron/renderer/src/components/dashboard/horus/blocks/StatCard.tsx`
  - [x] Main metric value display
  - [x] Comparison badge (colored based on positive/negative)
  - [x] Unit display
  - [x] Icon support (Lucide)
  - [x] Variant styling (default, success, warning, danger)

### 2.3 AlertCard
- [x] Create `electron/renderer/src/components/dashboard/horus/blocks/AlertCard.tsx`
  - [x] Icon with severity color
  - [x] Title and description
  - [x] Severity variants (info, warning, error, success)

### 2.4 NextSteps
- [x] Create `electron/renderer/src/components/dashboard/horus/blocks/NextSteps.tsx`
  - [x] Collapsible container
  - [x] Ordered list of action items
  - [x] Priority indicators
  - [x] Expand/collapse animation

### 2.5 ComparisonCard
- [x] Create `electron/renderer/src/components/dashboard/horus/blocks/ComparisonCard.tsx`
  - [x] Side-by-side layout
  - [x] Left/right labels and values
  - [x] Difference display (optional)
  - [x] Better value highlighting

### 2.6 ProgressCard
- [x] Create `electron/renderer/src/components/dashboard/horus/blocks/ProgressCard.tsx`
  - [x] Progress indicator (percentage toward target)
  - [x] Milestone icon
  - [x] Celebration animation (for major milestones)
  - [x] Description text

### 2.7 MetricGrid
- [x] Create `electron/renderer/src/components/dashboard/horus/blocks/MetricGrid.tsx`
  - [x] Grid layout (2-4 columns)
  - [x] Compact metric cells
  - [x] Trend arrows (optional)
  - [x] Responsive column count

### 2.8 QuoteCard
- [x] Create `electron/renderer/src/components/dashboard/horus/blocks/QuoteCard.tsx`
  - [x] Quote-style container
  - [x] Citation text
  - [x] Variant styling
  - [x] Icon support

### 2.9 ChartBlock
- [x] Create `electron/renderer/src/components/dashboard/horus/blocks/ChartBlock.tsx`
  - [x] Generic Recharts wrapper
  - [x] Support Recharts types:
    - [x] LineChart
    - [x] BarChart
    - [x] AreaChart
    - [x] PieChart
    - [x] RadarChart
    - [x] RadialBarChart
    - [x] ScatterChart
    - [x] ComposedChart (combined types)
  - [x] Responsive container
  - [x] Reference lines support
  - [x] Tooltip customization
  - [x] Legend

### 2.10 BlockRenderer
- [x] Create `electron/renderer/src/components/dashboard/horus/BlockRenderer.tsx`
  - [x] Switch/map block type to component
  - [x] Pass computed values (from evaluator)
  - [x] Handle comparison computations
  - [x] Handle trend computations

---

## Phase 3: Frontend - HorusPane Container ✅

### 3.1 Main Container
- [x] Create `electron/renderer/src/components/dashboard/horus/HorusPane.tsx`
  - [x] Tab switcher: "Overall Analysis" | "Session Analysis"
  - [x] Loading state
  - [x] Error state
  - [x] Empty state (no analysis yet)
  - [x] Block list rendering
  - [x] Demo content for testing

### 3.2 Data Hooks
- [x] Create `electron/renderer/src/components/dashboard/horus/hooks/useVisualization.ts`
  - [x] `useVisualization()` - Fetch analysis and build context
  - [x] Build EvaluationContext from sessions
  - [x] Memoization for expensive computations

### 3.3 Dashboard Integration
- [ ] Update `electron/renderer/src/components/dashboard/DashboardView.tsx`
  - [ ] Import HorusPane
  - [ ] Add below ChartPane
  - [ ] Pass `selectedPatientId`, `selectedSessionId`, `sessions`
  - [ ] Handle mode switching based on session selection

### 3.4 Chat Input (Placeholder)
- [x] Chat input integrated in HorusPane
  - [x] Input field with send button
  - [x] Disabled state with "Coming soon" tooltip
  - [x] Visual placeholder only (no functionality yet)

---

## Phase 4: Backend - Update Analysis Agent

### 4.1 Update Analysis Types
- [ ] Update `convex/horus/types.ts`
  - [ ] Add `visualizationBlocks: VisualizationBlock[]` to `AnalysisOutput`
  - [ ] Keep existing fields for backward compatibility

### 4.2 Update Analysis Prompt
- [ ] Update `convex/horus/prompts/analysis.ts`
  - [ ] Add block type catalog to system prompt
  - [ ] Add Recharts type descriptions
  - [ ] Add available Lucide icons
  - [ ] Update output schema to include blocks
  - [ ] Add examples of good block outputs

### 4.3 Update Parser
- [ ] Update `convex/horus/llm/parser.ts`
  - [ ] Add `parseVisualizationBlocks()` function
  - [ ] Validate block structure
  - [ ] Validate metric expressions exist
  - [ ] Default invalid blocks to ExecutiveSummary

### 4.4 Update Validator
- [ ] Update `convex/horus/agents/validator.ts`
  - [ ] Validate visualization blocks
  - [ ] Check metric expressions are valid
  - [ ] Check icon names are valid
  - [ ] Check chart types are valid

---

## Phase 5: Testing & Polish

### 5.1 Unit Tests
- [ ] Test expression evaluator
- [ ] Test block rendering
- [ ] Test data hooks

### 5.2 Visual Testing
- [ ] Test all block types with sample data
- [ ] Test responsive layouts
- [ ] Test dark/light mode (if applicable)
- [ ] Test loading states
- [ ] Test error states

### 5.3 Integration Testing
- [ ] Test full pipeline: AI output → blocks → rendered UI
- [ ] Test mode switching (Overall ↔ Session)
- [ ] Test with real session data

---

## Critical Implementation Notes

### Expression Security
- Expression evaluator must NOT use `eval()`
- Use a proper expression parser (e.g., `mathjs` or custom)
- Whitelist allowed operators and functions

### Backward Compatibility
- Keep existing `AnalysisOutput` fields
- `visualizationBlocks` should be optional initially
- Fallback to legacy rendering if blocks not present

### Performance
- Memoize computed values
- Lazy load chart components
- Virtualize long block lists if needed

### AI Prompt Design
- Provide clear examples in prompt
- Limit block count (suggest 4-8 per analysis)
- Include metric names catalog in prompt

---

## File Structure Summary

```
convex/horus/visualization/
├── types.ts           # Block type definitions
├── catalog.ts         # Recharts & icon catalogs
├── evaluator.ts       # Expression parser
└── index.ts           # Module exports

electron/renderer/src/components/dashboard/horus/
├── HorusPane.tsx      # Main container
├── BlockRenderer.tsx  # Type → component router
├── ChatInput.tsx      # Placeholder for future chat
├── blocks/
│   ├── ExecutiveSummary.tsx
│   ├── StatCard.tsx
│   ├── AlertCard.tsx
│   ├── NextSteps.tsx
│   ├── ComparisonCard.tsx
│   ├── ProgressCard.tsx
│   ├── MetricGrid.tsx
│   ├── QuoteCard.tsx
│   └── ChartBlock.tsx
└── hooks/
    └── useVisualization.ts
```
