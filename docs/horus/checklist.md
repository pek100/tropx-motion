---
id: horus
tags: [ai, agents, analysis, convex, vertex-ai, critical]
related_files: [convex/horus/*, convex/lib/metrics/opi.ts]
checklist: /docs/horus/checklist.md
doc: /docs/horus/README.md
status: in-progress
last_sync: 2024-12-25
---

# Horus Implementation Checklist

## Phase 1: Foundation
- [x] 1.1 Create `convex/horus/metrics.ts` - Metric Registry (17 metrics, camelCase)
- [x] 1.2 Create `convex/horus/types.ts` - All TypeScript interfaces
- [x] 1.3 Update `convex/schema.ts` - Add Horus tables

## Phase 2: Agent Prompts
- [x] 2.1 Create `convex/horus/prompts/decomposition.ts`
- [x] 2.2 Create `convex/horus/prompts/research.ts`
- [x] 2.3 Create `convex/horus/prompts/analysis.ts`
- [x] 2.4 Create `convex/horus/prompts/validator.ts`
- [x] 2.5 Create `convex/horus/prompts/progress.ts`
- [x] 2.6 Create `convex/horus/prompts/index.ts` - Exports

## Phase 3: LLM Integration
- [x] 3.1 Create `convex/horus/llm/vertex.ts` - Gemini 2.0 Flash client
- [x] 3.2 Create `convex/horus/llm/parser.ts` - Structured output validation
- [x] 3.3 Create `convex/horus/llm/usage.ts` - Token tracking

## Phase 4: Agent Execution
- [x] 4.1 Create `convex/horus/agents/decomposition.ts`
- [x] 4.2 Create `convex/horus/agents/research.ts`
- [x] 4.3 Create `convex/horus/agents/analysis.ts`
- [x] 4.4 Create `convex/horus/agents/validator.ts`
- [x] 4.5 Create `convex/horus/agents/progress.ts`

## Phase 5: Vector Search
- [x] 5.1 Create `convex/horus/vectordb/embeddings.ts` - Embedding generation
- [x] 5.2 Create `convex/horus/vectordb/search.ts` - Search functions (includes index)

## Phase 6: Tools & Orchestration
- [x] 6.1 Create `convex/horus/orchestrator.ts` - Pipeline workflow (includes tool functions)
- [x] 6.2 Create `convex/horus/triggers.ts` - Auto + on-demand triggers

## Phase 7: API Layer
- [x] 7.1 Create `convex/horus/queries.ts` - Read endpoints
- [x] 7.2 Create `convex/horus/mutations.ts` - Write endpoints
- [x] 7.3 Create `convex/horus/actions.ts` - External API calls
- [x] 7.4 Create `convex/horus/index.ts` - Central exports

## Phase 8: Cleanup
- [x] 8.1 Remove old `convex/agentPrompts/` directory
- [ ] 8.2 Update imports across codebase (when integrating)
- [ ] 8.3 Add environment variables documentation

---

## File Structure

```
convex/horus/
├── metrics.ts           # Metric registry (21 metrics)
├── types.ts             # TypeScript interfaces
├── orchestrator.ts      # Pipeline workflow
├── triggers.ts          # Auto/manual triggers
├── queries.ts           # Read endpoints
├── mutations.ts         # Write endpoints
├── actions.ts           # External API calls
│
├── prompts/
│   ├── index.ts
│   ├── decomposition.ts
│   ├── research.ts
│   ├── analysis.ts
│   ├── validator.ts
│   └── progress.ts
│
├── agents/
│   ├── decomposition.ts
│   ├── research.ts
│   ├── analysis.ts
│   ├── validator.ts
│   └── progress.ts
│
├── llm/
│   ├── vertex.ts        # Gemini client
│   ├── parser.ts        # Output validation
│   └── usage.ts         # Token tracking
│
├── vectordb/
│   ├── index.ts         # Vector index
│   ├── embeddings.ts    # Embedding generation
│   └── search.ts        # Search functions
│
└── tools/
    ├── searchCache.ts
    ├── webSearch.ts
    ├── saveCache.ts
    ├── patientHistory.ts
    └── saveReport.ts
```

## Critical Fixes from Review

### Must Fix (from previous issues)
- [x] Use camelCase for all metric names
- [x] Add division-by-zero guards in asymmetry calculations (`calculateAsymmetry` in metrics.ts)
- [x] Consider metric direction in asymmetry logic (direction-aware deficit detection)
- [x] Use numeric tier comparison (not string) (`QUALITY_TIER_VALUES` with `compareTiers`)
- [x] Fix validator schema references (now validates insights correctly)
- [x] Define all 17 dashboard metrics with thresholds (verified against actual UI usage)
- [x] Clone array before sorting in progress agent (`[...historicalSessions].sort()`)
- [x] Add baseline=0 guard for percentage calculations (guards in `calculateTrend`)
