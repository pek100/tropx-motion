---
id: horus
tags: [ai, agents, analysis, convex, vertex-ai, critical]
related_files: [convex/horus/*, convex/lib/metrics/opi.ts]
checklist: /docs/horus/checklist.md
doc: /docs/horus/README.md
status: in-progress
last_sync: 2024-12-25
---

# Horus - Multi-Agent Analysis System

## Overview

Horus is TropX Motion's AI-powered analysis system that transforms raw biomechanical metrics into actionable clinical insights. Named after the Egyptian god of the sky and kingship, known for his all-seeing eye.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         HORUS PIPELINE                                │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│   Metrics Complete                                                    │
│         │                                                             │
│         ▼                                                             │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐              │
│   │ DECOMP.     │───▶│  RESEARCH   │───▶│  ANALYSIS   │◀──┐         │
│   │   AGENT     │    │   AGENT     │    │   AGENT     │   │         │
│   │             │    │             │    │             │   │         │
│   │ Patterns    │    │ Evidence    │    │ Insights    │   │ max 3x  │
│   └─────────────┘    └─────────────┘    └──────┬──────┘   │         │
│                                                │          │         │
│                                                ▼          │         │
│                                         ┌─────────────┐   │         │
│                                         │  VALIDATOR  │───┘         │
│                                         │   AGENT     │             │
│                                         │             │             │
│                                         │ Pass/Fail   │             │
│                                         └──────┬──────┘             │
│                                                │                    │
│                           ┌────────────────────┼────────────────┐   │
│                           │                    │                │   │
│                           ▼                    ▼                │   │
│                    ┌─────────────┐      ┌─────────────┐         │   │
│                    │  SAVE TO    │      │  PROGRESS   │◀────────┘   │
│                    │  DATABASE   │      │   AGENT     │  on-demand  │
│                    │             │      │             │             │
│                    │ Session     │      │ Trends      │             │
│                    │ Report      │      │ Milestones  │             │
│                    └─────────────┘      └─────────────┘             │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Technology |
|-----------|------------|
| LLM | Vertex AI - Gemini 2.0 Flash |
| Backend | Convex (functions, database) |
| Vector DB | Convex Vector Search |
| Embeddings | Vertex AI text-embedding-004 |

## Agents

### 1. Decomposition Agent
**Purpose**: Extract patterns from metrics WITHOUT interpretation
- Threshold violation detection
- Asymmetry detection (direction-aware)
- Cross-metric correlations
- Outputs: List of patterns with search terms

### 2. Research Agent
**Purpose**: Find scientific evidence for patterns
- Vector DB cache lookup first
- Web search fallback (pubmed, jospt, etc.)
- Quality scoring (S/A/B/C/D tiers)
- Outputs: Evidence per pattern with citations

### 3. Analysis Agent
**Purpose**: Generate clinical insights for UI
- Insights with chart data
- Correlative insights (min 2 required)
- Normative benchmarking (radar chart)
- Qualitative classification (strength/weakness only)
- Side specificity enforced (Left Leg / Right Leg)

### 4. Validator Agent
**Purpose**: Verify accuracy before saving
- Numerical accuracy checks
- Side specificity enforcement
- Classification completeness
- Clinical safety checks
- Max 3 revision cycles

### 5. Progress Agent
**Purpose**: Longitudinal analysis across sessions
- Triggered: Auto after each session + on-demand
- Trend calculation with MCID thresholds
- Milestone detection
- Regression flagging
- Projections with confidence

## Metrics (21 Dashboard Metrics)

### Range Domain (Per-Leg)
- `overallMaxRom` - Maximum flexion ROM (°)
- `averageRom` - Average ROM per rep (°)
- `peakFlexion` - Maximum flexion angle (°)
- `peakExtension` - Maximum extension angle (°)

### Symmetry Domain (Bilateral)
- `romAsymmetry` - ROM difference (%)
- `velocityAsymmetry` - Speed difference (%)
- `crossCorrelation` - Movement synchronization (0-1)
- `realAsymmetryAvg` - True movement imbalance (°)
- `netGlobalAsymmetry` - Weighted composite (%)

### Power Domain (Per-Leg)
- `peakAngularVelocity` - Peak speed (°/s)
- `explosivenessConcentric` - Concentric power (°/s²)
- `explosivenessLoading` - Eccentric power (°/s²)

### Control Domain (Per-Leg)
- `rmsJerk` - Movement smoothness (°/s³)
- `romCoV` - Consistency (%)

### Timing Domain (Bilateral)
- `phaseShift` - Phase offset (°)
- `temporalLag` - Timing delay (ms)
- `maxFlexionTimingDiff` - Peak timing difference (ms)

## Error Handling

**Strategy**: Fail fast, let user retry

```typescript
// Pipeline returns error with failed agent info
{
  status: "error",
  failedAgent: "research",
  error: "Rate limit exceeded",
  partialResults: { decomposition: {...} },
  retryable: true
}

// User can retry specific agent
await retryAgent(sessionId, "research");
```

## Cost Estimate

| Agent | Input Tokens | Output Tokens | Cost/Session |
|-------|-------------|---------------|--------------|
| Decomposition | ~2,000 | ~1,500 | $0.004 |
| Research | ~1,500 | ~2,000 | $0.004 |
| Analysis | ~4,000 | ~5,000 | $0.011 |
| Validator | ~5,000 | ~1,000 | $0.007 |
| Progress | ~3,000 | ~4,000 | $0.008 |
| **Total** | ~15,500 | ~13,500 | **~$0.034** |

*Based on Gemini 2.0 Flash pricing: $0.075/1M input, $0.30/1M output*

## Environment Variables

```env
# Vertex AI
VERTEX_AI_PROJECT_ID=your-project-id
VERTEX_AI_LOCATION=us-central1

# Google Search (for Research Agent)
GOOGLE_SEARCH_API_KEY=your-api-key
GOOGLE_SEARCH_CX=your-search-engine-id
```

## File Paths

```
convex/horus/
├── metrics.ts           # 21 metric definitions
├── types.ts             # TypeScript interfaces
├── orchestrator.ts      # Pipeline workflow
├── triggers.ts          # Auto/manual triggers
├── queries.ts           # Read endpoints
├── mutations.ts         # Write endpoints
├── actions.ts           # External API calls
├── prompts/             # Agent prompts
├── agents/              # Agent execution
├── llm/                 # Vertex AI integration
├── vectordb/            # Vector search
└── tools/               # Agent tools
```

## Status

| Phase | Status | Files |
|-------|--------|-------|
| Foundation | 🔴 Not Started | metrics.ts, types.ts, schema |
| Prompts | 🔴 Not Started | prompts/* |
| LLM Integration | 🔴 Not Started | llm/* |
| Agent Execution | 🔴 Not Started | agents/* |
| Vector Search | 🔴 Not Started | vectordb/* |
| Tools & Orchestration | 🔴 Not Started | tools/*, orchestrator.ts |
| API Layer | 🔴 Not Started | queries.ts, mutations.ts |
