---
id: horus
tags: [ai, agents, analysis, convex, vertex-ai]
related_files: [convex/horus/*, convex/lib/metrics/*]
checklist: /docs/horus/checklist.md
doc: /docs/horus/README.md
status: in-progress
last_sync: 2024-12-25
---

# Horus System Decomposition

## Feature: Horus Multi-Agent Analysis System

```
Horus
├── 1. Foundation Layer
│   ├── 1.1 Metric Registry ✓ atomic
│   │   └── Single source of truth for all 21 metrics with thresholds
│   ├── 1.2 Type Definitions ✓ atomic
│   │   └── Shared TypeScript types for all agents
│   └── 1.3 Convex Schema ✓ atomic
│       └── Database tables for analyses, research cache, progress
│
├── 2. Agent Prompts
│   ├── 2.1 Decomposition Agent Prompt ✓ atomic
│   │   └── Pattern recognition without interpretation
│   ├── 2.2 Research Agent Prompt ✓ atomic
│   │   └── Evidence gathering with quality tiers
│   ├── 2.3 Analysis Agent Prompt ✓ atomic
│   │   └── Clinical insights with chart data
│   ├── 2.4 Validator Agent Prompt ✓ atomic
│   │   └── Accuracy verification rules
│   └── 2.5 Progress Agent Prompt ✓ atomic
│       └── Longitudinal trend analysis
│
├── 3. Convex Backend
│   ├── 3.1 Vector Search Setup
│   │   ├── 3.1.1 Research Cache Index ✓ atomic
│   │   ├── 3.1.2 Embedding Generation ✓ atomic
│   │   └── 3.1.3 Search Functions ✓ atomic
│   │
│   ├── 3.2 Agent Tools (Convex Actions)
│   │   ├── 3.2.1 searchResearchCache ✓ atomic
│   │   ├── 3.2.2 webSearch ✓ atomic
│   │   ├── 3.2.3 saveToResearchCache ✓ atomic
│   │   ├── 3.2.4 getPatientHistory ✓ atomic
│   │   └── 3.2.5 saveAnalysisReport ✓ atomic
│   │
│   ├── 3.3 Agent Execution
│   │   ├── 3.3.1 runDecomposition ✓ atomic
│   │   ├── 3.3.2 runResearch ✓ atomic
│   │   ├── 3.3.3 runAnalysis ✓ atomic
│   │   ├── 3.3.4 runValidator ✓ atomic
│   │   └── 3.3.5 runProgress ✓ atomic
│   │
│   └── 3.4 Orchestration
│       ├── 3.4.1 Pipeline Workflow ✓ atomic
│       │   └── Decomp → Research → Analysis → Validator loop
│       ├── 3.4.2 Trigger on Metrics Complete ✓ atomic
│       ├── 3.4.3 Error Handler ✓ atomic
│       │   └── Fail fast, expose retry per agent
│       └── 3.4.4 Progress Trigger ✓ atomic
│           └── Auto after session + on-demand API
│
├── 4. LLM Integration
│   ├── 4.1 Vertex AI Client ✓ atomic
│   │   └── Gemini 2.0 Flash configuration
│   ├── 4.2 Structured Output Parser ✓ atomic
│   │   └── JSON schema validation per agent
│   └── 4.3 Token Usage Tracking ✓ atomic
│       └── Cost monitoring per session
│
└── 5. API Layer
    ├── 5.1 Get Analysis Report ✓ atomic
    ├── 5.2 Get Progress Report ✓ atomic
    ├── 5.3 Retry Agent ✓ atomic
    ├── 5.4 Request Progress Report ✓ atomic
    └── 5.5 Get Pipeline Status ✓ atomic
```

## Atomic Units (27 total)

### Foundation (3)
1. **Metric Registry** - Single source of truth for 21 metrics with camelCase names, thresholds, domains, directions
2. **Type Definitions** - TypeScript interfaces for all agent inputs/outputs
3. **Convex Schema** - Tables: horusAnalyses, horusResearchCache, horusProgress, horusPipelineStatus

### Agent Prompts (5)
4. **Decomposition Agent Prompt** - Pattern recognition, threshold violations, asymmetry detection
5. **Research Agent Prompt** - Cache lookup, web search, quality scoring (S/A/B/C/D)
6. **Analysis Agent Prompt** - Insights with charts, correlative insights, normative benchmarking
7. **Validator Agent Prompt** - Numerical accuracy, side specificity, classification completeness
8. **Progress Agent Prompt** - Trend calculation, milestone detection, projections

### Vector Search (3)
9. **Research Cache Index** - Convex vector index for research findings (768 dims)
10. **Embedding Generation** - Vertex AI text-embedding-004 integration
11. **Search Functions** - Semantic search with quality tier filtering

### Agent Tools (5)
12. **searchResearchCache** - Query vector DB with quality filter
13. **webSearch** - Google Search API with domain priorities
14. **saveToResearchCache** - Store high-quality findings with embeddings
15. **getPatientHistory** - Fetch previous analyses for progress tracking
16. **saveAnalysisReport** - Persist validated analysis to Convex

### Agent Execution (5)
17. **runDecomposition** - Execute decomposition agent with Gemini
18. **runResearch** - Execute research agent with tool calls
19. **runAnalysis** - Execute analysis agent with structured output
20. **runValidator** - Execute validator, return pass/fail/revision
21. **runProgress** - Execute progress agent with patient history

### Orchestration (4)
22. **Pipeline Workflow** - Chain agents with validation loop (max 3)
23. **Trigger on Metrics Complete** - Convex mutation trigger
24. **Error Handler** - Fail fast, track which agent failed
25. **Progress Trigger** - Auto after session + on-demand endpoint

### LLM Integration (3)
26. **Vertex AI Client** - Gemini 2.0 Flash with structured output
27. **Structured Output Parser** - Zod schema validation
28. **Token Usage Tracking** - Log tokens per agent per session

### API Layer (5)
29. **getAnalysisReport** - Query for session analysis
30. **getProgressReport** - Query for patient progress
31. **retryAgent** - Re-run specific failed agent
32. **requestProgressReport** - Manual trigger for progress
33. **getPipelineStatus** - Current pipeline state

---

## Implementation Order

### Phase 1: Foundation (Day 1)
- Metric Registry with all 21 metrics
- Type definitions
- Convex schema

### Phase 2: Prompts (Day 1-2)
- All 5 agent prompts (fixed versions)

### Phase 3: LLM Integration (Day 2)
- Vertex AI client
- Structured output parsing

### Phase 4: Agent Execution (Day 2-3)
- All 5 runAgent functions

### Phase 5: Vector Search (Day 3)
- Research cache setup
- Embedding generation
- Search functions

### Phase 6: Tools & Orchestration (Day 3-4)
- Agent tools
- Pipeline workflow
- Triggers

### Phase 7: API Layer (Day 4)
- All query/mutation endpoints
