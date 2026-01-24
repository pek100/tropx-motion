---
id: horus-v2
tags: [horus, ai, agents, analysis, research, convex]
related_files: [convex/horus/*, convex/schema.ts]
checklist: /docs/horus-v2/checklist.md
doc: /docs/horus-v2/README.md
status: in-progress
last_sync: 2026-01-22
---

# Horus v2 Implementation Checklist

## Phase 1: Data Layer & Types
- [x] 1.1 Create `convex/horus/v2/types.ts` with flexible Section/EnrichedSection interfaces
- [x] 1.2 Reuse existing `convex/schema.ts` - v2 stores output in analysis field with version marker
- [x] 1.3 Create `convex/horus/v2/validation.ts` - programmatic validators

## Phase 2: Analysis Agent
- [x] 2.1 Create `convex/horus/v2/prompts/analysis.ts` - expert persona system prompt
- [x] 2.2 Create user prompt builder with metrics formatting
- [x] 2.3 Include LLM response schema in prompts file (ANALYSIS_RESPONSE_SCHEMA)
- [x] 2.4 Create `convex/horus/v2/agents/analysis.ts` - main Analysis Agent action

## Phase 3: Web Search Integration
- [x] 3.1 Use Gemini's built-in Google Search grounding (no external API needed!)
- [x] 3.2 Add `callVertexAIGrounded` action to `convex/horus/llm/vertex.ts`
- [x] 3.3 Create `convex/horus/v2/search/web.ts` - domain tier mapping utilities
- [x] 3.4 Extract links from grounding metadata in Research Agent

## Phase 4: Research Agent
- [x] 4.1 Create `convex/horus/v2/prompts/research.ts` - research agent prompts
- [x] 4.2 Include LLM response schema (RESEARCH_RESPONSE_SCHEMA)
- [x] 4.3 Create `convex/horus/v2/agents/research.ts` - Research Agent action
- [x] 4.4 Integrate cache-first search with web search fallback
- [x] 4.5 Implement evidence aggregation with tier ratings
- [x] 4.6 Implement user-friendly explanation generation
- [x] 4.7 Implement cache persistence for B+ tier evidence

## Phase 5: Orchestration
- [x] 5.1 Create `convex/horus/v2/orchestrator.ts` - main pipeline
- [x] 5.2 Implement parallel Research Agent spawning (Promise.all)
- [x] 5.3 Implement 10s timeout per agent (Promise.race)
- [x] 5.4 Implement result aggregation
- [x] 5.5 Implement error recovery for partial failures
- [x] 5.6 Create `convex/horus/v2/actions.ts` - public API entry points
- [x] 5.7 Create `convex/horus/v2/mutations.ts` - database operations
- [x] 5.8 Create `convex/horus/v2/queries.ts` - read operations

## Phase 6: Cleanup
- [ ] 6.1 Archive v1 code to `convex/horus/_deprecated/` (optional, deferred)
- [x] 6.2 Update `convex/horus/index.ts` exports
- [ ] 6.3 Update frontend to use new API (separate task)
- [x] 6.4 Fix token usage tracking for research agents
- [x] 6.5 Extract `buildSessionMetrics` to shared utilities (`utils.ts`)
- [x] 6.6 Remove duplicate `analyzeSessionV2` from orchestrator
- [x] 6.7 Clean up unused Serper API code (using Gemini grounding instead)
- [x] 6.8 Fix TypeScript type errors in v2 files

## Phase 7: UI Integration
- [x] 7.1 Create `primitives/EvidenceTierBadge.tsx` - evidence tier visualization (S/A/B/C/D)
- [x] 7.2 Create `v2/CitationList.tsx` - citations with tier badges
- [x] 7.3 Create `v2/QAAccordion.tsx` - Q&A reasoning accordion
- [x] 7.4 Create `v2/SectionCard.tsx` - main EnrichedSection card
- [x] 7.5 Create `v2/V2SummaryCard.tsx` - strengths/weaknesses summary
- [x] 7.6 Create `v2/V2SectionsView.tsx` - container for all section cards
- [x] 7.7 Create `hooks/useV2Analysis.ts` - fetch and manage v2 state
- [x] 7.8 Add evidence tier CSS variables to globals.css
- [x] 7.9 v2 queries already exist in `convex/horus/v2/queries.ts` (getAnalysisV2, getAnalysisStatusV2)
- [x] 7.10 Integrate V2SectionsView into HorusPane session mode

## Testing
- [x] T.1 Create mock SessionMetrics data (in testPipeline action)
- [ ] T.2 Test Analysis Agent in isolation
- [ ] T.3 Test Research Agent in isolation
- [ ] T.4 Test full pipeline with real data
- [ ] T.5 Verify 15s target latency

---

## Implementation Notes

### Serper API Integration
```typescript
// POST https://google.serper.dev/search
// Headers: X-API-KEY: <key>
// Body: { q: "search query", num: 5 }
```

### Parallel Execution Pattern
```typescript
const enrichedSections = await Promise.all(
  sections
    .filter(s => s.needsResearch)
    .map(section =>
      Promise.race([
        ctx.runAction(internal.horus.v2.agents.research.enrich, { section }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 10000)
        )
      ]).catch(err => ({
        ...section,
        enrichmentFailed: true,
        error: err.message
      }))
    )
);
```

### File Structure (Implemented)
```
convex/horus/v2/
├── index.ts              # Module exports
├── types.ts              # TypeScript interfaces (Section, EnrichedSection, etc.)
├── validation.ts         # Programmatic validators
├── orchestrator.ts       # Main pipeline with parallel execution
├── actions.ts            # Public API entry points
├── mutations.ts          # Database write operations
├── queries.ts            # Database read operations
├── utils.ts              # Shared utilities (buildSessionMetrics)
├── prompts/
│   ├── analysis.ts       # Analysis Agent prompts + response schema
│   └── research.ts       # Research Agent prompts + response schema
├── agents/
│   ├── analysis.ts       # Analysis Agent action
│   └── research.ts       # Research Agent action
└── search/
    └── web.ts            # Domain tier utilities (Gemini grounding replaces Serper)
```
