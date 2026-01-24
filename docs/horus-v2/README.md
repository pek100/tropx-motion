---
id: horus-v2
tags: [horus, ai, agents, analysis, research, convex]
related_files: [convex/horus/v2/*, convex/schema.ts]
checklist: /docs/horus-v2/checklist.md
doc: /docs/horus-v2/README.md
status: in-progress
last_sync: 2026-01-22
---

# Horus v2 - Single Session Analysis

Two-stage agentic pipeline replacing the v1 5-agent sequential system.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     Session Metrics Input                         │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                      STAGE 1: Analysis Agent                      │
│  Expert persona (20+ years clinical experience)                   │
│  - Generates N clinical sections                                  │
│  - Q&A reasoning per section                                      │
│  - Joint contributions mapping                                    │
│  - Metric traceability                                           │
│  - Search queries for research                                   │
│  - Flags needsResearch per section                               │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│              STAGE 2: Parallel Research Agents (N)                │
│                                                                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐       ┌─────────┐        │
│  │ Agent 1 │  │ Agent 2 │  │ Agent 3 │  ...  │ Agent N │        │
│  │Section 1│  │Section 2│  │Section 3│       │Section N│        │
│  └─────────┘  └─────────┘  └─────────┘       └─────────┘        │
│       │            │            │                 │              │
│       └────────────┴────────────┴─────────────────┘              │
│                         │                                        │
│  Each agent:                                                     │
│  1. Cache-first search (vector DB)                               │
│  2. Web search if needed (Serper API)                            │
│  3. Enrich narrative with citations                              │
│  4. Resolve contradictions by rewriting                          │
│  5. Generate user-friendly explanation                           │
│  6. Collect quality links with tier ratings                      │
│  7. Save B+ evidence to cache                                    │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Aggregated Output                           │
│  - All enriched sections combined                                │
│  - Programmatic validation (no LLM validator)                    │
│  - Final analysis result                                         │
└──────────────────────────────────────────────────────────────────┘
```

## Key Changes from v1

| Aspect | v1 | v2 |
|--------|----|----|
| Pipeline | 5 sequential agents | 2-stage (1 + N parallel) |
| Persona | None (rigid decomposition) | Expert clinician |
| Reasoning | Pattern extraction only | Q&A clinical reasoning |
| Schema | Fixed, strict | Flexible with custom fields |
| Validation | LLM validator (3 retries) | Programmatic only |
| Latency | High (5 sequential calls) | Target 15s |
| Web Search | None (LLM memory only) | Gemini grounding (built-in Google Search) |
| Output | Rigid classifications | Rich narrative with citations |

## Data Types

### Section (Analysis Agent Output)
```typescript
interface Section {
  id: string;
  title: string;
  domain: string; // 'range' | 'power' | 'control' | 'symmetry' | 'timing' | custom
  clinicalNarrative: string;
  jointContributions: Record<string, string>; // Flexible joint keys
  qaReasoning: Array<{ question: string; answer: string }>;
  metricContributions: Array<{
    metric: string;
    value: number;
    unit: string;
    role: string;
    type?: 'raw' | 'computed' | 'derived' | 'comparison';
    context?: string;
    [key: string]: any;
  }>;
  searchQueries: string[];
  recommendations: string[];
  needsResearch: boolean;
  additionalData?: Record<string, any>;
}
```

### EnrichedSection (Research Agent Output)
```typescript
interface EnrichedSection extends Section {
  enrichedNarrative: string;
  userExplanation: {
    summary: string;
    whatItMeans: string;
    whyItMatters: string;
    analogy?: string;
    [key: string]: string | undefined;
  };
  citations: Array<{
    text: string;
    source: string;
    tier: 'S' | 'A' | 'B' | 'C' | 'D';
    [key: string]: any;
  }>;
  links: Array<{
    url: string;
    title: string;
    tier: 'S' | 'A' | 'B' | 'C' | 'D';
    domain: string;
    relevance: string;
    [key: string]: any;
  }>;
  evidenceStrength: {
    level: 'strong' | 'moderate' | 'limited';
    notes?: string;
  };
  wasContradicted: boolean;
  enrichedRecommendations: string[];
}
```

## Evidence Tier System

| Tier | Quality | Sources |
|------|---------|---------|
| S | Systematic Review/Meta-Analysis | Cochrane, PubMed systematic reviews |
| A | RCT/High-Quality Primary Research | PubMed RCTs, major journals |
| B | Observational/Expert Consensus | Clinical guidelines, expert opinion |
| C | Case Studies/Professional Sources | Case reports, textbooks |
| D | General/Educational | General health sites, educational |

## API

### Public Actions
```typescript
// Main entry point
analyzeSessionV2({ sessionId: string }): Promise<AnalysisResult>

// Retry with options
retryAnalysisV2({ sessionId: string, fromStage?: 'analysis' | 'research' })

// Cache operations (reused from v1)
searchCache({ query: string, limit?: number, minTier?: Tier })
```

## Performance Targets

- Total pipeline: < 15 seconds
- Analysis Agent: < 5 seconds
- Research Agents (parallel): < 10 seconds each (with 10s timeout)
- Cache hit rate: > 50% for common patterns

## Configuration

### Environment Variables
```bash
# Required (same as v1)
VERTEX_AI_PROJECT_ID=<project>
VERTEX_AI_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS_JSON=<service-account-json>

# Note: No external search API needed!
# v2 uses Gemini's built-in Google Search grounding via the googleSearchRetrieval tool.
```

### Convex Infrastructure
- Existing vector search for research cache (reused from v1)
- No additional Convex components required
