---
id: horus-v2
tags: [horus, ai, agents, analysis, research, convex]
related_files: [convex/horus/*, convex/schema.ts]
checklist: /docs/horus-v2/checklist.md
doc: /docs/horus-v2/README.md
status: in-progress
last_sync: 2026-01-22
---

# Horus v2 - Decomposition

Two-stage agentic pipeline for single session biomechanical analysis.

```
Horus v2 Single Session Analysis
├── Stage 1: Analysis Agent
│   ├── Expert Persona Setup ✓ atomic
│   │   └── System prompt with 20+ years clinical experience persona
│   ├── Metrics Ingestion ✓ atomic
│   │   └── Accept SessionMetrics, format for LLM consumption
│   ├── Section Generation ✓ atomic
│   │   └── Generate N clinical sections with flexible schema
│   ├── Q&A Reasoning per Section ✓ atomic
│   │   └── Generate [Q]/[A] pairs showing clinical reasoning
│   ├── Joint Contributions ✓ atomic
│   │   └── Describe how each joint contributes to the finding
│   ├── Metric Traceability ✓ atomic
│   │   └── Link findings to specific metrics with type/context
│   ├── Search Query Generation ✓ atomic
│   │   └── Generate targeted search queries per section
│   └── Research Flag ✓ atomic
│       └── Mark needsResearch: true/false per section
│
├── Stage 2: Parallel Research Agents (N agents)
│   ├── Section Assignment ✓ atomic
│   │   └── Each agent receives one section to enrich
│   ├── Cache-First Search ✓ atomic
│   │   └── Search vector cache using section search queries
│   ├── Web Search Integration ✓ atomic
│   │   └── Call external search API for missing evidence
│   ├── Evidence Aggregation ✓ atomic
│   │   └── Combine cache + web results with tier ratings
│   ├── Narrative Enrichment ✓ atomic
│   │   └── Rewrite clinical narrative with citations
│   ├── Contradiction Resolution ✓ atomic
│   │   └── If evidence contradicts, rewrite section (wasContradicted: true)
│   ├── User-Friendly Explanation ✓ atomic
│   │   └── Generate summary, whatItMeans, whyItMatters, analogy
│   ├── Recommendation Enhancement ✓ atomic
│   │   └── Enrich recommendations with evidence-based suggestions
│   ├── Link Collection ✓ atomic
│   │   └── Collect high-quality URLs with tier ratings
│   └── Cache Persistence ✓ atomic
│       └── Save tier B+ evidence to research cache
│
├── Orchestration
│   ├── Pipeline Entry Point ✓ atomic
│   │   └── Single action that triggers full pipeline
│   ├── Analysis Agent Execution ✓ atomic
│   │   └── Call Analysis Agent, parse response
│   ├── Parallel Agent Spawning ✓ atomic
│   │   └── Spawn N Research Agents concurrently (Promise.all)
│   ├── Timeout Handling ✓ atomic
│   │   └── 10s timeout per Research Agent (Promise.race)
│   ├── Result Aggregation ✓ atomic
│   │   └── Combine all enriched sections into final output
│   └── Error Recovery ✓ atomic
│       └── Handle partial failures, return what succeeded
│
├── Data Layer
│   ├── Schema Updates ✓ atomic
│   │   └── Update horusAnalysis table for v2 output format
│   ├── Flexible Section Schema ✓ atomic
│   │   └── Define Section/EnrichedSection TypeScript interfaces
│   ├── Cache Schema Extension ✓ atomic
│   │   └── Extend horusResearchCache for new evidence format
│   └── Validation Helpers ✓ atomic
│       └── Programmatic JSON validation (no LLM validator)
│
├── External Integration
│   ├── Web Search API Selection ✓ atomic
│   │   └── Choose and integrate search provider (Serper/Tavily/Google)
│   ├── API Key Management ✓ atomic
│   │   └── Env variables for search API credentials
│   └── Rate Limiting ✓ atomic
│       └── Implement rate limiting for search API calls
│
└── Cleanup
    ├── Remove v1 Agents ✓ atomic
    │   └── Delete decomposition, validator, old research, old analysis agents
    ├── Remove v1 Prompts ✓ atomic
    │   └── Delete old prompt builders
    └── Update Exports ✓ atomic
        └── Clean up index.ts and public API
```

## Atomic Units (Implementation Order)

### Phase 1: Data Layer & Types
1. **Flexible Section Schema** - Define Section/EnrichedSection TypeScript interfaces with Record<string, any> flexibility
2. **Schema Updates** - Update Convex schema for v2 output format
3. **Validation Helpers** - Programmatic JSON validation functions

### Phase 2: Analysis Agent
4. **Expert Persona Setup** - System prompt with clinical expert persona
5. **Metrics Ingestion** - Format SessionMetrics for LLM consumption
6. **Section Generation** - LLM response schema for sections
7. **Q&A Reasoning per Section** - Include Q&A in section schema
8. **Joint Contributions** - Include flexible joint contributions
9. **Metric Traceability** - Link metrics to findings
10. **Search Query Generation** - Generate search queries per section
11. **Research Flag** - needsResearch boolean per section
12. **Analysis Agent Execution** - Main agent action

### Phase 3: External Integration
13. **Web Search API Selection** - Choose Serper API (fast, cheap, reliable)
14. **API Key Management** - Environment variable setup
15. **Rate Limiting** - Use Convex Rate Limiter component

### Phase 4: Research Agent
16. **Section Assignment** - Single section per agent instance
17. **Cache-First Search** - Search existing cache
18. **Web Search Integration** - Call Serper API
19. **Evidence Aggregation** - Combine sources with tiers
20. **Narrative Enrichment** - Rewrite with citations
21. **Contradiction Resolution** - Handle contradictions
22. **User-Friendly Explanation** - Generate user explanation
23. **Recommendation Enhancement** - Enrich recommendations
24. **Link Collection** - Collect quality URLs
25. **Cache Persistence** - Save to research cache

### Phase 5: Orchestration
26. **Pipeline Entry Point** - Main action entry
27. **Parallel Agent Spawning** - Promise.all for N agents
28. **Timeout Handling** - 10s per agent with Promise.race
29. **Result Aggregation** - Combine enriched sections
30. **Error Recovery** - Handle partial failures

### Phase 6: Cleanup
31. **Remove v1 Agents** - Delete old agent files
32. **Remove v1 Prompts** - Delete old prompt files
33. **Update Exports** - Clean up index.ts

## Dependencies Graph

```
[1] Types → [2] Schema → [3] Validation
                ↓
[4-11] Analysis Agent Components → [12] Analysis Execution
                                        ↓
[13-15] Web Search Integration ────────→↓
                                        ↓
[16-25] Research Agent Components → [26-30] Orchestration
                                        ↓
                              [31-33] Cleanup
```
