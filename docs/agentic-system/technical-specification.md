# TropX Agentic Analysis System - Technical Specification

## Table of Contents
1. [System Overview](#1-system-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Data Flow](#3-data-flow)
4. [Agent Specifications](#4-agent-specifications)
5. [VectorDB Design](#5-vectordb-design)
6. [Convex Integration](#6-convex-integration)
7. [Orchestration](#7-orchestration)
8. [Error Handling](#8-error-handling)
9. [Security & Privacy](#9-security--privacy)
10. [Cost Estimation](#10-cost-estimation)
11. [Implementation Phases](#11-implementation-phases)

---

## 1. System Overview

### Purpose
Transform raw biomechanical metrics (43 metrics across 9 categories) into actionable clinical insights through a multi-agent pipeline that:
- Identifies patterns in motion data
- Researches scientific evidence for findings
- Generates validated clinical analysis
- Tracks patient progress over time

### Design Principles
1. **Single Responsibility**: Each agent has one clear purpose
2. **Confidence Propagation**: Uncertainty flows through the pipeline
3. **Fail-Safe**: Graceful degradation, never silent failures
4. **Auditable**: Every decision logged and traceable
5. **Privacy-First**: Patient data encrypted/hashed throughout
6. **Convex-Native**: Use Convex for everything except LLM inference

### Technology Stack
- **Inference**: Vertex AI (Gemini 2.0 Flash) - LLM only
- **Agent Framework**: `@convex-dev/agent` (Convex Agent Component)
- **VectorDB**: Convex Vector Search (native)
- **Orchestration**: Convex Actions + Workflows
- **Storage**: Convex (all data)
- **Embeddings**: Vertex AI text-embedding-004 (768 dimensions)

### Why Convex-Native?
- **Consistency**: Vector search is real-time consistent with writes
- **Simplicity**: No external services to manage
- **Cost**: Included in Convex pricing
- **Integration**: Seamless with existing schema and auth

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              TROPX AGENTIC SYSTEM                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────┐                                                                │
│  │   CONVEX     │  Trigger: metrics.status = 'complete'                         │
│  │  (Existing)  │────────────────────────────────────────┐                       │
│  │              │                                        │                       │
│  │ ┌──────────┐ │                                        ▼                       │
│  │ │recording │ │                           ┌─────────────────────┐              │
│  │ │ Metrics  │ │                           │   ORCHESTRATOR      │              │
│  │ └──────────┘ │                           │  (Cloud Workflows)  │              │
│  │ ┌──────────┐ │                           └──────────┬──────────┘              │
│  │ │recording │ │                                      │                         │
│  │ │Sessions  │ │                                      ▼                         │
│  │ └──────────┘ │      ┌───────────────────────────────────────────────────┐     │
│  │ ┌──────────┐ │      │                  AGENT PIPELINE                   │     │
│  │ │ analysis │◄├──────┤                                                   │     │
│  │ │ Reports  │ │      │  ┌─────────────┐    ┌─────────────┐               │     │
│  │ └──────────┘ │      │  │ DECOMP.     │    │  RESEARCH   │               │     │
│  └──────────────┘      │  │   AGENT     │───▶│   AGENT     │               │     │
│                        │  │             │    │             │               │     │
│                        │  │ Patterns    │    │ Evidence    │               │     │
│                        │  └─────────────┘    └──────┬──────┘               │     │
│                        │                           │                       │     │
│                        │         ┌─────────────────┼─────────────────┐     │     │
│                        │         │                 ▼                 │     │     │
│                        │         │        ┌─────────────┐            │     │     │
│                        │         │        │  ANALYSIS   │◄───────┐   │     │     │
│                        │         │        │   AGENT     │        │   │     │     │
│                        │         │        │             │        │   │     │     │
│                        │         │        │  Report v1  │        │   │     │     │
│                        │         │        └──────┬──────┘        │   │     │     │
│                        │         │               │               │   │     │     │
│                        │         │               ▼               │   │     │     │
│                        │         │        ┌─────────────┐        │   │     │     │
│                        │         │        │  VALIDATOR  │        │   │     │     │
│                        │         │        │   AGENT     │────────┘   │     │     │
│                        │         │        │             │ (max 3x)   │     │     │
│                        │         │        │  Pass/Fail  │            │     │     │
│                        │         │        └──────┬──────┘            │     │     │
│                        │         │               │                   │     │     │
│                        │         │               ▼                   │     │     │
│                        │         │        ┌─────────────┐            │     │     │
│                        │         │        │  ANALYSIS   │            │     │     │
│                        │         │        │  AGENT v2   │            │     │     │
│                        │         │        │             │            │     │     │
│                        │         │        │ Progress    │            │     │     │
│                        │         │        └─────────────┘            │     │     │
│                        │         │                                   │     │     │
│                        │         └───────────────────────────────────┘     │     │
│                        └───────────────────────────────────────────────────┘     │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐     │
│  │                           VECTOR DATABASES                              │     │
│  │                                                                         │     │
│  │   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │     │
│  │   │ RESEARCH CACHE  │  │ PATIENT HISTORY │  │   NORMATIVE     │         │     │
│  │   │                 │  │                 │  │   BASELINES     │         │     │
│  │   │ • Papers        │  │ • Past analyses │  │                 │         │     │
│  │   │ • Guidelines    │  │ • Trends        │  │ • Population    │         │     │
│  │   │ • Quality tiers │  │ • Milestones    │  │   norms         │         │     │
│  │   │ • Topics        │  │ • Per-patient   │  │ • Clinical      │         │     │
│  │   │                 │  │                 │  │   thresholds    │         │     │
│  │   └─────────────────┘  └─────────────────┘  └─────────────────┘         │     │
│  │         ▲                      ▲                    │                   │     │
│  │         │                      │                    │                   │     │
│  │    Research Agent         Analysis Agent       Analysis Agent           │     │
│  │    (read/write)           v2 (read)           v1 (read only)            │     │
│  │                                                                         │     │
│  └─────────────────────────────────────────────────────────────────────────┘     │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Flow

### 3.1 Pipeline Stages

```
Stage 0: TRIGGER
  Input:  Convex webhook (metrics.status = 'complete')
  Output: Pipeline initiation with sessionId

Stage 1: DECOMPOSITION
  Input:  Raw metrics (43 metrics) + session metadata
  Output: PatternReport (5-15 patterns with confidence scores)

Stage 2: RESEARCH
  Input:  PatternReport + raw metrics + activity profile
  Output: ResearchReport (evidence per pattern, quality-rated)

Stage 3: ANALYSIS (Session Report)
  Input:  Raw metrics + PatternReport + ResearchReport + NormativeBaselines
  Output: SessionAnalysisReport (findings, recommendations, confidence)
  Note:   NO access to patient history

Stage 4: VALIDATION (Loop max 3x)
  Input:  SessionAnalysisReport + raw metrics + research citations
  Output: ValidationResult (PASS | NEEDS_REVISION | CRITICAL_FAIL)
  Action: If NEEDS_REVISION → back to Stage 3 with revision requests

Stage 5: PERSIST SESSION REPORT
  Action: Save validated report to Convex + Patient History VectorDB

Stage 6: ANALYSIS (Progress Report)
  Input:  Validated SessionAnalysisReport + Patient History (from VectorDB)
  Output: ProgressReport (trends, milestones, adjusted recommendations)
  Note:   NOW has access to patient history

Stage 7: PERSIST & NOTIFY
  Action: Save ProgressReport to Convex, notify user
```

### 3.2 Data Schemas

#### Input: Raw Metrics (from Convex)
```typescript
interface RawMetricsInput {
  sessionId: string;
  sessionMetadata: {
    sampleRate: number;
    totalSamples: number;
    durationMs: number;
    activityProfile: 'power' | 'endurance' | 'rehabilitation' | 'general';
    activeJoints: string[];
    startTime: number;
    endTime: number;
  };

  // Per-leg metrics (11 each)
  leftLeg: PerLegMetrics;
  rightLeg: PerLegMetrics;

  // Bilateral analysis (8 metrics)
  bilateralAnalysis: {
    romAsymmetry: number;
    velocityAsymmetry: number;
    jerkAsymmetry: number;
    netGlobalAsymmetry: number;
    phaseShift: number;
    crossCorrelation: number;
    temporalLag: number;
    optimalPhaseOffset: number;
  };

  // Movement classification
  movementClassification: {
    type: 'bilateral' | 'unilateral' | 'single_leg' | 'mixed' | 'unknown';
    confidence: number;
    dominantLeg?: 'left' | 'right';
  };

  // Advanced asymmetry
  advancedAsymmetry: {
    events: AsymmetryEvent[];
    averageAsymmetry: number;
    maxAsymmetry: number;
    percentageWithAsymmetry: number;
  };

  // OPI
  opiResult: {
    overallScore: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    domainScores: Record<string, number>;
    clinicalFlags: string[];
    confidence: number;
  };
}

interface PerLegMetrics {
  overallMaxRom: number;
  averageRom: number;
  peakFlexion: number;
  peakExtension: number;
  peakAngularVelocity: number;
  explosivenessLoading: number;
  explosivenessConcentric: number;
  rmsJerk: number;
  romCoefficientOfVariation: number;
  peakResultantAcceleration: number;
  cycleCount: number;
}
```

#### Stage 1 Output: PatternReport
```typescript
interface PatternReport {
  sessionId: string;
  generatedAt: string;
  processingTimeMs: number;

  patterns: Pattern[];

  summary: {
    totalPatternsFound: number;
    highPriorityCount: number;
    categoryCounts: Record<PatternCategory, number>;
  };
}

interface Pattern {
  id: string;  // UUID for tracking through pipeline
  category: PatternCategory;
  type: PatternType;

  description: string;  // Human-readable description

  affectedMetrics: {
    metric: string;
    value: number;
    unit: string;
    context?: string;  // e.g., "left leg", "bilateral"
  }[];

  severity: 'info' | 'mild' | 'moderate' | 'severe';
  confidence: number;  // 0-1
  priority: number;    // 1-10, for research ordering

  // For research agent
  searchTerms: string[];  // Suggested search queries
  relatedConcepts: string[];  // Medical/biomechanical concepts
}

type PatternCategory =
  | 'range_of_motion'
  | 'asymmetry'
  | 'power_velocity'
  | 'movement_quality'
  | 'temporal'
  | 'fatigue'
  | 'compensation';

type PatternType =
  // ROM patterns
  | 'limited_rom'
  | 'excessive_rom'
  | 'rom_asymmetry'
  | 'rom_variability'

  // Asymmetry patterns
  | 'static_asymmetry'
  | 'dynamic_asymmetry'
  | 'phase_desynchronization'
  | 'temporal_lag'

  // Power/velocity patterns
  | 'reduced_velocity'
  | 'velocity_asymmetry'
  | 'loading_deficit'
  | 'concentric_deficit'

  // Quality patterns
  | 'high_jerk'
  | 'inconsistent_movement'
  | 'smoothness_deficit'

  // Temporal patterns
  | 'warmup_effect'
  | 'fatigue_pattern'
  | 'performance_drift'

  // Compensation patterns
  | 'compensatory_pattern'
  | 'guarding_behavior';
```

#### Stage 2 Output: ResearchReport
```typescript
interface ResearchReport {
  sessionId: string;
  generatedAt: string;
  processingTimeMs: number;

  patternResearch: PatternResearch[];

  summary: {
    totalSourcesFound: number;
    sourcesByTier: Record<QualityTier, number>;
    cacheHitRate: number;  // Percentage from cache vs new searches
    knowledgeGaps: string[];  // Patterns with insufficient research
  };
}

interface PatternResearch {
  patternId: string;  // Links to Pattern.id

  findings: ResearchFinding[];

  synthesis: string;  // AI-generated summary of all findings
  clinicalRelevance: string;  // Why this matters clinically
  evidenceStrength: 'strong' | 'moderate' | 'limited' | 'insufficient';

  knowledgeGap: boolean;
  gapDescription?: string;
}

interface ResearchFinding {
  id: string;

  // Content
  title: string;
  summary: string;
  keyPoints: string[];
  relevantQuote?: string;

  // Source
  source: {
    url: string;
    domain: string;
    type: SourceType;
    title: string;
    authors?: string[];
    publicationDate?: string;
    journal?: string;
  };

  // Quality
  qualityTier: QualityTier;
  qualityScore: number;  // 0-100
  qualityFactors: {
    sourceAuthority: number;
    publicationType: number;
    recency: number;
    citationCount?: number;
    relevanceToPattern: number;
  };

  // Provenance
  fromCache: boolean;
  cachedAt?: string;
  retrievedAt: string;
}

type QualityTier = 'S' | 'A' | 'B' | 'C' | 'D';

type SourceType =
  | 'meta_analysis'
  | 'systematic_review'
  | 'randomized_controlled_trial'
  | 'cohort_study'
  | 'case_control_study'
  | 'case_series'
  | 'clinical_guideline'
  | 'textbook'
  | 'expert_opinion'
  | 'general_web';
```

#### Stage 3 Output: SessionAnalysisReport
```typescript
interface SessionAnalysisReport {
  sessionId: string;
  version: number;  // Increments with each revision
  generatedAt: string;
  processingTimeMs: number;

  // Executive summary (2-3 paragraphs)
  executiveSummary: string;

  // Detailed findings by domain
  findings: DomainFinding[];

  // Actionable recommendations
  recommendations: Recommendation[];

  // Overall assessment
  overallAssessment: {
    status: 'excellent' | 'good' | 'fair' | 'needs_attention' | 'concerning';
    primaryConcerns: string[];
    positiveIndicators: string[];
    areasForImprovement: string[];
  };

  // Confidence and caveats
  confidence: {
    overall: number;  // 0-1
    byDomain: Record<string, number>;
  };
  caveats: string[];
  limitations: string[];

  // Traceability
  patternsAddressed: string[];  // Pattern IDs
  sourcesUsed: string[];  // Research finding IDs
}

interface DomainFinding {
  domain: 'range' | 'symmetry' | 'power' | 'control' | 'timing';

  summary: string;

  observations: {
    observation: string;
    metrics: { name: string; value: number; unit: string; interpretation: string }[];
    comparisonToNorm: 'above_normal' | 'normal' | 'below_normal' | 'concerning';
    confidence: number;
  }[];

  clinicalImplications: string[];

  supportingEvidence: {
    findingId: string;
    relevance: string;
  }[];

  severity: 'normal' | 'mild' | 'moderate' | 'severe';
}

interface Recommendation {
  id: string;

  recommendation: string;
  rationale: string;

  priority: 'high' | 'medium' | 'low';
  domain: string;
  type: 'exercise' | 'technique' | 'progression' | 'caution' | 'referral' | 'monitoring';

  expectedOutcome: string;
  timeframe?: string;  // e.g., "2-4 weeks"

  supportingEvidence: string[];  // Finding IDs
  confidence: number;
}
```

#### Stage 4 Output: ValidationResult
```typescript
interface ValidationResult {
  sessionId: string;
  reportVersion: number;
  validatedAt: string;

  status: 'PASS' | 'NEEDS_REVISION' | 'CRITICAL_FAIL';

  checks: ValidationCheck[];

  // If NEEDS_REVISION
  revisionRequests?: RevisionRequest[];

  // If CRITICAL_FAIL
  criticalIssues?: string[];
  escalationRequired: boolean;

  summary: {
    checksPerformed: number;
    checksPassed: number;
    warnings: number;
    errors: number;
  };
}

interface ValidationCheck {
  checkType: ValidationCheckType;
  status: 'pass' | 'warning' | 'error';
  details: string;
  affectedSection?: string;
}

type ValidationCheckType =
  | 'numerical_accuracy'      // Do stated values match raw metrics?
  | 'logical_consistency'     // Do conclusions follow from evidence?
  | 'citation_validity'       // Do sources support the claims?
  | 'clinical_safety'         // Are recommendations safe?
  | 'completeness'            // Are all significant patterns addressed?
  | 'bias_check'              // Is there unsupported speculation?
  | 'contraindication_check'; // Any red flags for recommendations?

interface RevisionRequest {
  section: string;
  issue: string;
  severity: 'error' | 'warning';
  suggestedAction: string;
}
```

#### Stage 6 Output: ProgressReport
```typescript
interface ProgressReport {
  sessionId: string;
  patientIdHash: string;
  generatedAt: string;

  // How many sessions analyzed
  sessionCount: number;
  dateRange: { first: string; last: string };

  // Overall progress summary
  progressSummary: string;

  // Trends by domain
  trends: DomainTrend[];

  // Milestones achieved
  milestones: Milestone[];

  // Goals and progress
  goals: GoalProgress[];

  // Adjusted recommendations based on history
  adjustedRecommendations: {
    recommendation: string;
    adjustmentReason: string;
    basedOnTrend: string;
  }[];

  // Comparison to initial assessment
  comparisonToBaseline?: {
    metric: string;
    baselineValue: number;
    currentValue: number;
    changePercent: number;
    interpretation: string;
  }[];

  // Next session focus
  nextSessionFocus: string[];
}

interface DomainTrend {
  domain: string;
  direction: 'improving' | 'stable' | 'declining' | 'variable';
  confidence: number;

  keyMetricTrends: {
    metric: string;
    values: { date: string; value: number }[];
    trendLine: 'up' | 'down' | 'flat';
    changeRate: number;  // per session or per week
  }[];

  interpretation: string;
}

interface Milestone {
  achievement: string;
  dateAchieved: string;
  significance: string;
  domain: string;
}

interface GoalProgress {
  goal: string;
  targetMetric?: string;
  targetValue?: number;
  currentValue?: number;
  progressPercent: number;
  estimatedCompletion?: string;
  status: 'on_track' | 'ahead' | 'behind' | 'achieved' | 'revised';
}
```

---

## 4. Agent Specifications

### 4.1 Decomposition Agent

#### Purpose
Extract clinically meaningful patterns from raw metrics WITHOUT interpretation. Pure pattern recognition.

#### Access
- **Input**: Raw metrics, session metadata
- **Tools**: None (pure LLM reasoning)
- **Databases**: None

#### System Prompt
```
You are a biomechanical pattern recognition system. Your role is to identify patterns in motion capture data WITHOUT interpreting their clinical significance.

## Your Task
Analyze the provided metrics and identify patterns. For each pattern:
1. Describe WHAT you observe (not WHY it might occur)
2. List the specific metrics involved with their values
3. Rate your confidence in the pattern's existence
4. Suggest search terms for the research phase

## Pattern Categories to Look For

### Range of Motion Patterns
- ROM values outside typical ranges (< 90° or > 140° for knee flexion)
- Significant ROM asymmetry between legs (> 10° difference)
- High ROM variability (CV > 15%)
- ROM limiting movement classification

### Asymmetry Patterns
- Net global asymmetry > 10%
- Individual metric asymmetries > 15%
- Phase shift > 15°
- Temporal lag > 50ms
- Cross-correlation < 0.85 for bilateral movements

### Power/Velocity Patterns
- Peak angular velocity outside typical range
- Significant velocity asymmetry
- Loading vs concentric explosiveness imbalance
- Velocity-ROM ratio anomalies

### Movement Quality Patterns
- High RMS jerk (smoothness issues)
- Inconsistent cycle-to-cycle movement
- Low cross-correlation between legs
- SPARC values indicating poor smoothness

### Temporal Patterns
- Performance changes across the session (first vs last 20%)
- Fatigue indicators (declining velocity/ROM)
- Warm-up effects (improving metrics early)

### Compensation Patterns
- Asymmetric patterns that flip (alternating dominance)
- Correlated deficits across metrics
- Pattern combinations suggesting guarding

## Output Format
Return a structured PatternReport following the exact schema provided.

## Critical Rules
1. ONLY report patterns you can observe in the data
2. Do NOT speculate on causes or diagnoses
3. Do NOT make recommendations
4. Include ALL significant patterns, even if they seem related
5. Assign confidence based on how clear the pattern is in the data
6. If a metric is missing or invalid, note it and continue
```

#### Example Input/Output
```json
// Input
{
  "sessionId": "session_123",
  "sessionMetadata": {
    "activityProfile": "rehabilitation",
    "durationMs": 180000
  },
  "leftLeg": {
    "overallMaxRom": 95,
    "peakAngularVelocity": 180,
    "rmsJerk": 450
  },
  "rightLeg": {
    "overallMaxRom": 112,
    "peakAngularVelocity": 245,
    "rmsJerk": 320
  },
  "bilateralAnalysis": {
    "romAsymmetry": 16.4,
    "velocityAsymmetry": 30.6,
    "netGlobalAsymmetry": 18.2
  }
}

// Output (partial)
{
  "patterns": [
    {
      "id": "pat_001",
      "category": "asymmetry",
      "type": "static_asymmetry",
      "description": "Significant ROM asymmetry: left leg shows 95° vs right leg 112° (17° difference, 16.4% asymmetry index)",
      "affectedMetrics": [
        { "metric": "overallMaxRom", "value": 95, "unit": "degrees", "context": "left leg" },
        { "metric": "overallMaxRom", "value": 112, "unit": "degrees", "context": "right leg" },
        { "metric": "romAsymmetry", "value": 16.4, "unit": "percent", "context": "bilateral" }
      ],
      "severity": "moderate",
      "confidence": 0.95,
      "priority": 8,
      "searchTerms": ["knee ROM asymmetry", "bilateral knee flexion difference", "limb symmetry index rehabilitation"],
      "relatedConcepts": ["limb symmetry index", "bilateral deficit", "range of motion asymmetry"]
    },
    {
      "id": "pat_002",
      "category": "power_velocity",
      "type": "velocity_asymmetry",
      "description": "Marked velocity asymmetry: left leg 180°/s vs right leg 245°/s (30.6% asymmetry)",
      "affectedMetrics": [
        { "metric": "peakAngularVelocity", "value": 180, "unit": "deg/s", "context": "left leg" },
        { "metric": "peakAngularVelocity", "value": 245, "unit": "deg/s", "context": "right leg" },
        { "metric": "velocityAsymmetry", "value": 30.6, "unit": "percent", "context": "bilateral" }
      ],
      "severity": "moderate",
      "confidence": 0.92,
      "priority": 7,
      "searchTerms": ["angular velocity asymmetry knee", "movement speed bilateral difference"],
      "relatedConcepts": ["rate of force development", "neuromuscular control", "velocity deficit"]
    }
  ]
}
```

---

### 4.2 Research Agent

#### Purpose
Find and quality-rate scientific evidence for each identified pattern.

#### Access
- **Input**: PatternReport, raw metrics, activity profile
- **Tools**:
  - Web search (Google Custom Search API or Vertex AI Search)
  - VectorDB read/write (Research Cache)
- **Databases**: Research Cache (read/write)

#### System Prompt
```
You are a scientific research agent specializing in biomechanics, sports medicine, and rehabilitation. Your role is to find high-quality evidence related to identified movement patterns.

## Your Task
For each pattern provided:
1. Check the Research Cache for existing relevant research
2. If cache miss or stale (> 6 months), search for new evidence
3. Evaluate source quality using the tiering system
4. Synthesize findings into a coherent summary
5. Identify knowledge gaps

## Research Cache Strategy
1. First, query the cache with semantic search using pattern description
2. Check freshness: if lastVerifiedAt > 6 months, re-verify
3. If good cache hit (quality tier S-B, fresh), use cached content
4. If no cache or low quality only, perform web search
5. Always save new high-quality findings to cache

## Source Quality Tiers

### Tier S (Score: 90-100) - Gold Standard
- Meta-analyses from Cochrane, JOSPT
- Systematic reviews in high-impact journals
- Clinical practice guidelines (APTA, AAOS)

### Tier A (Score: 75-89) - High Quality
- Randomized controlled trials
- Large cohort studies (n > 100)
- Peer-reviewed journals (AJSM, BJSM, JOSPT)

### Tier B (Score: 60-74) - Moderate Quality
- Non-randomized controlled studies
- Case-control studies
- Smaller cohort studies (n > 30)
- Respected textbooks

### Tier C (Score: 40-59) - Limited Quality
- Case series
- Expert opinion in peer-reviewed sources
- Conference proceedings

### Tier D (Score: 20-39) - Low Quality
- Case reports
- Non-peer-reviewed sources
- Blog posts by qualified professionals
- General health websites

### Quality Scoring Formula
```
quality_score = (
  source_authority * 0.30 +
  publication_type * 0.25 +
  recency * 0.20 +
  relevance * 0.15 +
  citations * 0.10
)

source_authority: Domain reputation (pubmed: 100, general: 30)
publication_type: See tier definitions
recency: 100 if <2 years, decay 10/year, min 40
relevance: How directly it addresses the pattern
citations: Normalized citation count if available
```

## Search Strategy
1. Start with specific medical search terms
2. Include pattern-specific terminology
3. Add activity profile context (rehabilitation, sports, etc.)
4. Search reputable domains first:
   - pubmed.ncbi.nlm.nih.gov
   - jospt.org
   - physio-pedia.com
   - sportsmedtoday.com
   - acsm.org

## Output Requirements
- Minimum 2 sources per pattern (if available)
- At least 1 source should be Tier A or above
- Flag patterns with only Tier C+ sources as knowledge gaps
- Never fabricate sources - if nothing found, report gap

## Critical Rules
1. Verify URLs are real before including
2. Do not hallucinate citations
3. Clearly mark when evidence is indirect/tangential
4. Report cache hits vs new searches for transparency
```

#### Tools Definition
```typescript
// Tool: search_research_cache
interface SearchResearchCacheInput {
  query: string;  // Semantic search query
  topics?: string[];  // Filter by topics
  minQualityTier?: QualityTier;  // Minimum tier
  maxAge?: number;  // Max cache age in days
}

interface SearchResearchCacheOutput {
  results: CachedResearch[];
  totalFound: number;
}

// Tool: web_search
interface WebSearchInput {
  query: string;
  domains?: string[];  // Restrict to domains
  dateRange?: { start: string; end: string };
  maxResults?: number;
}

interface WebSearchOutput {
  results: WebSearchResult[];
  totalFound: number;
}

// Tool: save_to_research_cache
interface SaveToResearchCacheInput {
  entry: ResearchCacheEntry;
}
```

---

### 4.3 Analysis Agent

#### Purpose
Synthesize metrics, patterns, and research into actionable clinical insights.

#### Access (Session Report - First Pass)
- **Input**: Raw metrics, PatternReport, ResearchReport
- **Tools**: None
- **Databases**: Normative Baselines (read-only)
- **Explicitly NO access to**: Patient History VectorDB

#### Access (Progress Report - Second Pass)
- **Input**: Validated SessionAnalysisReport, session metadata
- **Tools**: VectorDB query
- **Databases**: Patient History VectorDB (read-only)

#### System Prompt (Session Report)
```
You are a clinical biomechanics analyst. Your role is to interpret movement data and provide actionable insights for physiotherapists and rehabilitation specialists.

## Your Task
Generate a comprehensive session analysis report by:
1. Interpreting the identified patterns in clinical context
2. Incorporating research evidence to support your analysis
3. Comparing metrics to normative baselines
4. Providing prioritized, evidence-based recommendations

## Report Structure

### Executive Summary
- 2-3 paragraphs summarizing key findings
- Lead with the most clinically significant observations
- Include overall assessment (excellent/good/fair/needs attention/concerning)

### Domain Findings
For each domain (Range, Symmetry, Power, Control, Timing):
- Summarize observations with specific metric values
- Compare to normative baselines (provide percentiles)
- Explain clinical implications
- Rate severity (normal/mild/moderate/severe)
- Link to supporting research

### Recommendations
For each recommendation:
- Be specific and actionable
- Provide rationale linked to findings
- Prioritize (high/medium/low)
- Include expected outcomes
- Support with evidence

## Normative Baseline Interpretation
When comparing to baselines:
- "Normal range": 25th-75th percentile
- "Mild concern": 10th-25th or 75th-90th percentile
- "Moderate concern": 5th-10th or 90th-95th percentile
- "Severe concern": Below 5th or above 95th percentile

Adjust interpretation based on:
- Activity profile (athletes have different norms)
- Age group (if known)
- Movement type (bilateral vs unilateral expectations)

## Evidence Integration
- Cite research findings by ID
- Note evidence strength (strong/moderate/limited)
- Acknowledge when recommendations have limited evidence
- Flag areas where research is lacking

## Critical Rules
1. Never diagnose medical conditions
2. Recommend specialist referral for concerning findings
3. Do not access or reference patient history
4. Be honest about uncertainty - include confidence scores
5. Prioritize safety - flag any red flags immediately
6. Keep recommendations within scope of movement analysis
7. Use professional clinical language
```

#### System Prompt (Progress Report)
```
You are continuing your analysis with access to the patient's historical data. Generate a progress report that tracks changes over time.

## Your Task
1. Query patient history for previous session analyses
2. Identify trends across sessions
3. Recognize milestones and achievements
4. Adjust recommendations based on progress

## Progress Analysis Framework

### Trend Identification
For each domain, determine:
- Direction: improving / stable / declining / variable
- Rate of change: calculate session-over-session or weekly change
- Consistency: is progress steady or fluctuating?

### Milestone Recognition
Identify and celebrate:
- First achievement of normal range values
- Asymmetry reduction milestones (e.g., <10% for first time)
- Consistency improvements
- New movement capabilities

### Goal Tracking
If previous sessions set goals:
- Report progress toward each goal
- Estimate time to completion
- Recommend goal adjustments if needed

### Recommendation Adjustment
Based on progress:
- Advance recommendations if good progress
- Maintain recommendations if stable
- Modify approach if declining
- Add new focus areas as old ones resolve

## Historical Comparison
Always include:
- Comparison to first/baseline session
- Comparison to previous session
- Trend over last 3-5 sessions (if available)

## Critical Rules
1. Acknowledge data limitations (e.g., "based on 3 sessions")
2. Don't over-interpret short-term fluctuations
3. Celebrate progress while noting areas still needing work
4. Be encouraging but realistic
```

---

### 4.4 Validator Agent

#### Purpose
Ensure analysis accuracy, safety, and evidence integrity WITHOUT conducting new research.

#### Access
- **Input**: SessionAnalysisReport, raw metrics, research findings
- **Tools**: Calculator (for numerical verification)
- **Databases**: None

#### System Prompt
```
You are a clinical quality assurance specialist. Your role is to validate analysis reports for accuracy, safety, and evidence integrity.

## Your Task
Perform the following validation checks:

### 1. Numerical Accuracy (Critical)
- Verify all stated metric values match the raw data
- Check calculations (percentages, comparisons)
- Ensure baseline comparisons are correct
- Flag any numerical discrepancies

### 2. Logical Consistency (Critical)
- Do conclusions follow from the evidence presented?
- Are severity ratings consistent with the data?
- Do recommendations address the identified issues?
- Are there contradictions within the report?

### 3. Citation Validity (Important)
- Do the cited research findings actually support the claims?
- Is evidence being overstated or misrepresented?
- Are limitations of evidence acknowledged?
- Check for cherry-picking favorable evidence

### 4. Clinical Safety (Critical)
- Are recommendations safe and appropriate?
- Are red flags properly identified and addressed?
- Is referral recommended when appropriate?
- Could any recommendation cause harm?

### 5. Completeness (Important)
- Are all significant patterns addressed?
- Are any domain findings suspiciously missing?
- Is the confidence appropriately calibrated?
- Are limitations and caveats included?

### 6. Bias Check (Moderate)
- Is there unsupported speculation?
- Are alternative explanations considered?
- Is language appropriately cautious?
- Are conclusions proportionate to evidence?

## Validation Output

### Status Determination
- **PASS**: No errors, warnings are minor and documented
- **NEEDS_REVISION**: Errors found that can be corrected
- **CRITICAL_FAIL**: Safety concerns or fundamental flaws

### For Each Issue Found
- Specify the check type
- Quote the problematic section
- Explain the issue clearly
- Provide specific revision guidance

## Critical Rules
1. DO NOT conduct new research
2. DO NOT rewrite the report yourself
3. Focus on verification, not improvement suggestions
4. Be specific - vague feedback is unhelpful
5. Err on the side of caution for safety issues
6. Maximum 3 revision cycles - then escalate
```

---

## 5. VectorDB Design (Convex Native)

Convex provides built-in vector search that is:
- **Consistent**: Writes are immediately searchable (no eventual consistency)
- **Integrated**: Uses same auth, schema, and query patterns
- **Scalable**: Supports millions of vectors

### 5.0 Existing Normative Baselines (From `convex/lib/metrics/opi.ts`)

**These are already in the codebase - no need for a separate VectorDB collection:**

```typescript
// From METRIC_CONFIGS in opi.ts
const EXISTING_BASELINES = {
  // SYMMETRY DOMAIN
  rom_asymmetry: { goodThreshold: 5, poorThreshold: 15, icc: 0.82 },
  velocity_asymmetry: { goodThreshold: 8, poorThreshold: 20, icc: 0.80 },
  cross_correlation: { goodThreshold: 0.95, poorThreshold: 0.75, icc: 0.88 },
  real_asymmetry_avg: { goodThreshold: 5, poorThreshold: 20, icc: 0.82 },

  // POWER DOMAIN
  peak_angular_velocity: { goodThreshold: 400, poorThreshold: 200, icc: 0.87 },
  explosiveness_concentric: { goodThreshold: 500, poorThreshold: 200, icc: 0.83 },

  // CLINICAL THRESHOLDS
  ASYMMETRY_HIGH: 15,  // % - clinical flag threshold
};

// From classification.ts
const CLASSIFICATION_THRESHOLDS = {
  bilateral_correlation: 0.7,      // > 0.7 = bilateral movement
  unilateral_phase_offset: 150-210, // degrees for gait
  single_leg_cv: 0.05,             // < 5% CV = flat signal
  phase_change: 30,                // degrees for transition detection
  asymmetry_event: 5,              // degrees threshold
};

// From bilateral.ts - Asymmetry weights
const ASYMMETRY_WEIGHTS = {
  overallMaxROM: 0.20,
  averageROM: 0.15,
  peakAngularVelocity: 0.20,
  rmsJerk: 0.175,
  explosivenessLoading: 0.15,
  explosivenessConcentric: 0.125,
};
```

**The Analysis Agent will import these directly from `convex/lib/metrics/opi.ts`** rather than querying a VectorDB.

### 5.1 Collection: Research Cache (Convex Table + Vector Index)

```typescript
// convex/schema.ts addition
export const researchCache = defineTable({
  // Identity
  id: v.string(),  // UUID

  // Embedding for semantic search
  embedding: v.array(v.float64()),  // 768 dimensions (text-embedding-004)

  // Content
  title: string;
  summary: string;  // 200-500 words
  keyPoints: string[];  // 3-5 bullet points
  fullTextExcerpt?: string;  // Up to 2000 chars of relevant text

  // Source Metadata
  sourceUrl: string;
  sourceDomain: string;
  sourceType: SourceType;
  sourceTitle: string;  // Page/article title
  authors?: string[];
  publicationDate?: string;  // ISO date or null
  journal?: string;
  doi?: string;

  // Quality Assessment
  qualityTier: QualityTier;
  qualityScore: number;  // 0-100
  qualityFactors: {
    sourceAuthority: number;
    publicationType: number;
    recency: number;
    citations?: number;
  };

  // Categorization (for filtering)
  topics: string[];  // e.g., ['knee_rom', 'asymmetry', 'acl_rehabilitation']
  relatedMetrics: string[];  // e.g., ['overallMaxRom', 'romAsymmetry']
  activityProfiles: string[];  // e.g., ['rehabilitation', 'sports']
  bodyRegions: string[];  // e.g., ['knee', 'lower_extremity']

  // Temporal
  cachedAt: string;  // When first cached
  lastVerifiedAt: string;  // When last confirmed still valid
  sourceLastModified?: string;  // If known

  // Usage Tracking
  retrievalCount: number;
  lastRetrievedAt?: string;
  usedInAnalysisCount: number;  // Times cited in final reports
}
```

#### Indexes
```
- Primary: id
- Vector: embedding (cosine similarity)
- Filter: topics, qualityTier, sourceType, cachedAt
- Compound: topics + qualityTier + cachedAt
```

#### Query Patterns
```typescript
// Pattern 1: Semantic search with quality filter
{
  vector: embedPattern(patternDescription),
  filter: {
    qualityTier: { $in: ['S', 'A', 'B'] },
    cachedAt: { $gt: sixMonthsAgo }
  },
  topK: 10
}

// Pattern 2: Topic-based retrieval
{
  filter: {
    topics: { $contains: 'knee_asymmetry' },
    activityProfiles: { $contains: 'rehabilitation' }
  },
  topK: 20
}
```

### 5.2 Collection: Patient Analysis History

```typescript
interface PatientAnalysisEntry {
  // Identity
  id: string;  // UUID
  patientIdHash: string;  // SHA-256 hash of patient ID
  sessionId: string;

  // Embedding (for semantic search on patient history)
  embedding: number[];  // Embed: executiveSummary + findings

  // Temporal
  sessionDate: string;
  analysisGeneratedAt: string;

  // Report Content (compressed/summarized)
  executiveSummary: string;

  domainSummaries: {
    domain: string;
    summary: string;
    severity: string;
    keyMetrics: { name: string; value: number }[];
  }[];

  keyFindings: string[];  // Top 5 findings

  recommendations: {
    recommendation: string;
    priority: string;
    type: string;
  }[];

  // Metrics Snapshot (for trend calculation)
  metricsSnapshot: {
    // Core metrics for trending
    leftRom: number;
    rightRom: number;
    romAsymmetry: number;
    leftVelocity: number;
    rightVelocity: number;
    velocityAsymmetry: number;
    netGlobalAsymmetry: number;
    opiScore: number;
    opiGrade: string;
    // Add more as needed
  };

  // Patterns (for cross-session pattern analysis)
  patternTypes: string[];  // e.g., ['rom_asymmetry', 'velocity_deficit']

  // Quality
  validationIterations: number;
  overallConfidence: number;

  // Activity Context
  activityProfile: string;
  movementClassification: string;
  sessionDuration: number;
}
```

#### Indexes
```
- Primary: id
- Unique: sessionId
- Filter: patientIdHash, sessionDate
- Vector: embedding (for semantic search)
- Compound: patientIdHash + sessionDate (for temporal queries)
```

#### Query Patterns
```typescript
// Pattern 1: Get patient history chronologically
{
  filter: { patientIdHash: hash(patientId) },
  sort: { sessionDate: 'desc' },
  limit: 20
}

// Pattern 2: Semantic search in patient history
{
  vector: embedQuery("asymmetry improvements"),
  filter: { patientIdHash: hash(patientId) },
  topK: 5
}

// Pattern 3: Get baseline (first session)
{
  filter: { patientIdHash: hash(patientId) },
  sort: { sessionDate: 'asc' },
  limit: 1
}
```

### 5.3 Collection: Normative Baselines

```typescript
interface NormativeBaseline {
  id: string;

  // Categorization
  metric: string;  // e.g., 'overallMaxRom'
  bodyRegion: string;  // e.g., 'knee'
  movementType: string;  // e.g., 'flexion'

  // Population segments
  activityProfile?: string;  // null = general population
  ageGroup?: string;  // e.g., '18-30', '30-45', null = all ages
  sex?: string;  // 'male', 'female', null = combined
  activityLevel?: string;  // 'sedentary', 'recreational', 'athletic'
  condition?: string;  // 'healthy', 'post_acl_3mo', 'osteoarthritis'

  // Statistical values
  mean: number;
  median: number;
  stdDev: number;
  sampleSize: number;

  percentiles: {
    p5: number;
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
    p95: number;
  };

  // Clinical thresholds
  normalRange: { min: number; max: number };
  mildConcernRange: { min: number; max: number };
  moderateConcernRange: { min: number; max: number };
  severeConcernThreshold: { below?: number; above?: number };

  // Source
  source: string;  // Citation
  sourceUrl?: string;
  publicationYear: number;

  // Metadata
  unit: string;
  lastUpdated: string;
}
```

---

## 6. Convex Integration

### 6.1 New Schema Additions

```typescript
// convex/schema.ts additions

export const analysisReports = defineTable({
  // Links
  sessionId: v.string(),
  patientId: v.optional(v.string()),

  // Pipeline Status
  status: v.union(
    v.literal('pending'),
    v.literal('decomposing'),
    v.literal('researching'),
    v.literal('analyzing'),
    v.literal('validating'),
    v.literal('generating_progress'),
    v.literal('complete'),
    v.literal('failed'),
    v.literal('failed_validation')  // Failed after max retries
  ),

  // Progress tracking
  currentStep: v.optional(v.string()),
  progress: v.optional(v.number()),  // 0-100

  // Pipeline Artifacts (for debugging/audit)
  decompositionResult: v.optional(v.any()),
  researchResult: v.optional(v.any()),
  analysisResult: v.optional(v.any()),
  validationResults: v.optional(v.array(v.any())),  // Array for iteration history

  // Final Reports
  sessionReport: v.optional(v.object({
    version: v.number(),
    executiveSummary: v.string(),
    findings: v.array(v.any()),
    recommendations: v.array(v.any()),
    overallAssessment: v.any(),
    confidence: v.any(),
    caveats: v.array(v.string()),
  })),

  progressReport: v.optional(v.object({
    progressSummary: v.string(),
    trends: v.array(v.any()),
    milestones: v.array(v.any()),
    goals: v.array(v.any()),
    adjustedRecommendations: v.array(v.any()),
  })),

  // Metadata
  validationIterations: v.number(),
  totalProcessingTimeMs: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
  errorDetails: v.optional(v.any()),

  // Timestamps
  createdAt: v.number(),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),

  // Soft delete
  isArchived: v.optional(v.boolean()),
})
  .index('by_session', ['sessionId'])
  .index('by_patient', ['patientId', 'createdAt'])
  .index('by_status', ['status', 'createdAt']);

// Analysis queue for background processing
export const analysisQueue = defineTable({
  sessionId: v.string(),
  priority: v.number(),  // Higher = more urgent

  status: v.union(
    v.literal('queued'),
    v.literal('processing'),
    v.literal('completed'),
    v.literal('failed')
  ),

  attempts: v.number(),
  lastAttemptAt: v.optional(v.number()),
  nextRetryAt: v.optional(v.number()),

  createdAt: v.number(),
})
  .index('by_status_priority', ['status', 'priority'])
  .index('by_session', ['sessionId']);
```

### 6.2 New Convex Functions

```typescript
// convex/analysis.ts

import { v } from "convex/values";
import { mutation, query, action, internalMutation, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";

// Trigger analysis when metrics complete
export const triggerAnalysis = internalMutation({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    // Check if analysis already exists
    const existing = await ctx.db
      .query("analysisReports")
      .withIndex("by_session", q => q.eq("sessionId", sessionId))
      .first();

    if (existing && existing.status !== 'failed') {
      return existing._id;
    }

    // Get session for patient info
    const session = await ctx.db
      .query("recordingSessions")
      .filter(q => q.eq(q.field("sessionId"), sessionId))
      .first();

    // Create analysis report
    const reportId = await ctx.db.insert("analysisReports", {
      sessionId,
      patientId: session?.subjectId,
      status: 'pending',
      validationIterations: 0,
      createdAt: Date.now(),
    });

    // Queue for processing
    await ctx.db.insert("analysisQueue", {
      sessionId,
      priority: 5,  // Default priority
      status: 'queued',
      attempts: 0,
      createdAt: Date.now(),
    });

    // Schedule processing
    await ctx.scheduler.runAfter(0, internal.analysis.processQueue);

    return reportId;
  },
});

// Process queued analyses
export const processQueue = internalAction({
  handler: async (ctx) => {
    // Get next item from queue
    const queueItem = await ctx.runQuery(internal.analysis.getNextQueueItem);

    if (!queueItem) {
      return; // Queue empty
    }

    try {
      // Mark as processing
      await ctx.runMutation(internal.analysis.updateQueueStatus, {
        id: queueItem._id,
        status: 'processing',
      });

      // Run the pipeline
      await ctx.runAction(internal.analysis.runPipeline, {
        sessionId: queueItem.sessionId,
      });

      // Mark complete
      await ctx.runMutation(internal.analysis.updateQueueStatus, {
        id: queueItem._id,
        status: 'completed',
      });

    } catch (error) {
      // Handle failure
      await ctx.runMutation(internal.analysis.handleQueueFailure, {
        id: queueItem._id,
        error: error.message,
      });
    }

    // Process next item
    await ctx.scheduler.runAfter(100, internal.analysis.processQueue);
  },
});

// Main pipeline orchestration
export const runPipeline = internalAction({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const startTime = Date.now();

    // Update status
    await ctx.runMutation(internal.analysis.updateStatus, {
      sessionId,
      status: 'decomposing',
      currentStep: 'Identifying patterns in metrics',
    });

    // Get metrics
    const metrics = await ctx.runQuery(api.recordingMetrics.getMetrics, { sessionId });
    if (!metrics) {
      throw new Error('Metrics not found');
    }

    // Stage 1: Decomposition
    const patternReport = await callVertexAI('decomposition', {
      metrics,
      sessionMetadata: await ctx.runQuery(internal.analysis.getSessionMetadata, { sessionId }),
    });

    await ctx.runMutation(internal.analysis.saveArtifact, {
      sessionId,
      artifact: 'decompositionResult',
      value: patternReport,
    });

    // Stage 2: Research
    await ctx.runMutation(internal.analysis.updateStatus, {
      sessionId,
      status: 'researching',
      currentStep: 'Finding scientific evidence',
      progress: 25,
    });

    const researchReport = await callVertexAI('research', {
      patternReport,
      metrics,
      activityProfile: metrics.activityProfile,
    });

    await ctx.runMutation(internal.analysis.saveArtifact, {
      sessionId,
      artifact: 'researchResult',
      value: researchReport,
    });

    // Stage 3 & 4: Analysis + Validation Loop
    let analysisReport = null;
    let validationResult = null;
    let iteration = 0;
    const maxIterations = 3;

    while (iteration < maxIterations) {
      iteration++;

      await ctx.runMutation(internal.analysis.updateStatus, {
        sessionId,
        status: 'analyzing',
        currentStep: `Generating analysis (attempt ${iteration})`,
        progress: 40 + (iteration * 10),
      });

      // Generate analysis
      analysisReport = await callVertexAI('analysis', {
        metrics,
        patternReport,
        researchReport,
        previousValidation: validationResult,  // null on first iteration
      });

      await ctx.runMutation(internal.analysis.updateStatus, {
        sessionId,
        status: 'validating',
        currentStep: 'Validating report accuracy',
        progress: 50 + (iteration * 10),
      });

      // Validate
      validationResult = await callVertexAI('validation', {
        analysisReport,
        metrics,
        researchReport,
      });

      await ctx.runMutation(internal.analysis.appendValidation, {
        sessionId,
        validation: validationResult,
        iteration,
      });

      if (validationResult.status === 'PASS') {
        break;
      }

      if (validationResult.status === 'CRITICAL_FAIL') {
        throw new Error(`Critical validation failure: ${validationResult.criticalIssues.join(', ')}`);
      }
    }

    if (validationResult.status !== 'PASS') {
      // Max iterations reached without pass
      await ctx.runMutation(internal.analysis.updateStatus, {
        sessionId,
        status: 'failed_validation',
        errorMessage: 'Max validation iterations reached',
      });
      return;
    }

    // Save session report
    await ctx.runMutation(internal.analysis.saveSessionReport, {
      sessionId,
      report: analysisReport,
    });

    // Save to Patient History VectorDB
    await saveToPatientHistory(sessionId, analysisReport);

    // Stage 5: Progress Report
    await ctx.runMutation(internal.analysis.updateStatus, {
      sessionId,
      status: 'generating_progress',
      currentStep: 'Analyzing historical progress',
      progress: 85,
    });

    const patientHistory = await queryPatientHistory(metrics.patientId);

    const progressReport = await callVertexAI('progress', {
      sessionReport: analysisReport,
      patientHistory,
      sessionMetadata: await ctx.runQuery(internal.analysis.getSessionMetadata, { sessionId }),
    });

    // Save progress report
    await ctx.runMutation(internal.analysis.saveProgressReport, {
      sessionId,
      report: progressReport,
    });

    // Complete
    await ctx.runMutation(internal.analysis.updateStatus, {
      sessionId,
      status: 'complete',
      progress: 100,
      totalProcessingTimeMs: Date.now() - startTime,
    });

    // Notify user
    await ctx.runMutation(api.notifications.create, {
      userId: metrics.ownerId,
      type: 'analysis_complete',
      title: 'Analysis Ready',
      message: 'Your session analysis is complete',
      data: { sessionId },
    });
  },
});

// Query functions
export const getAnalysisReport = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    return await ctx.db
      .query("analysisReports")
      .withIndex("by_session", q => q.eq("sessionId", sessionId))
      .first();
  },
});

export const getAnalysisStatus = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const report = await ctx.db
      .query("analysisReports")
      .withIndex("by_session", q => q.eq("sessionId", sessionId))
      .first();

    if (!report) {
      return null;
    }

    return {
      status: report.status,
      currentStep: report.currentStep,
      progress: report.progress,
      validationIterations: report.validationIterations,
      errorMessage: report.errorMessage,
    };
  },
});
```

### 6.3 Trigger Integration

Modify existing `recordingMetrics.ts` to trigger analysis:

```typescript
// In computeMetricsInternal, after successful computation:

// ... existing metric computation code ...

// Update status to complete
await ctx.runMutation(internal.recordingMetrics.updateStatus, {
  sessionId,
  status: 'complete',
});

// Trigger analysis pipeline
await ctx.runMutation(internal.analysis.triggerAnalysis, {
  sessionId,
});
```

---

## 7. Orchestration (Convex Native)

### 7.1 Convex Agent Component Setup

The `@convex-dev/agent` package provides the orchestration framework:

```typescript
// convex/agents/index.ts
import { Agent } from "@convex-dev/agent";
import { components } from "./_generated/api";
import { gemini } from "./llm";  // Vertex AI client

// Decomposition Agent
export const decompositionAgent = new Agent(components.agent, {
  name: "Decomposition Agent",
  chat: gemini.chat("gemini-2.0-flash"),
  instructions: DECOMPOSITION_SYSTEM_PROMPT,
  tools: {},  // No tools - pure reasoning
});

// Research Agent
export const researchAgent = new Agent(components.agent, {
  name: "Research Agent",
  chat: gemini.chat("gemini-2.0-flash"),
  instructions: RESEARCH_SYSTEM_PROMPT,
  tools: {
    searchCache: searchResearchCacheTool,
    webSearch: webSearchTool,
    saveToCache: saveToResearchCacheTool,
  },
});

// Analysis Agent
export const analysisAgent = new Agent(components.agent, {
  name: "Analysis Agent",
  chat: gemini.chat("gemini-2.0-flash"),
  instructions: ANALYSIS_SYSTEM_PROMPT,
  tools: {
    getNormativeBaselines: getNormativeBaselinesTool,
  },
});

// Validator Agent
export const validatorAgent = new Agent(components.agent, {
  name: "Validator Agent",
  chat: gemini.chat("gemini-2.0-flash"),
  instructions: VALIDATOR_SYSTEM_PROMPT,
  tools: {},  // No tools - verification only
});
```

### 7.2 Vertex AI LLM Client

```typescript
// convex/llm.ts
import { VertexAI } from "@google-cloud/vertexai";

const vertexAI = new VertexAI({
  project: process.env.GCP_PROJECT_ID,
  location: "us-central1",
});

export const gemini = {
  chat: (model: string) => ({
    // Adapter for @convex-dev/agent chat interface
    async generateText(options: { prompt: string; systemPrompt?: string }) {
      const generativeModel = vertexAI.getGenerativeModel({
        model,
        generationConfig: {
          maxOutputTokens: 8192,
          temperature: 0.2,
        },
      });

      const result = await generativeModel.generateContent({
        contents: [{ role: "user", parts: [{ text: options.prompt }] }],
        systemInstruction: options.systemPrompt,
      });

      return result.response.candidates?.[0]?.content?.parts?.[0]?.text || "";
    },
  }),
};
```

### 7.3 Pipeline Workflow (Convex Action)

```yaml
# analysis-pipeline.yaml
main:
  params: [input]
  steps:
    - init:
        assign:
          - sessionId: ${input.sessionId}
          - startTime: ${sys.now()}

    - getMetrics:
        call: http.get
        args:
          url: ${"https://your-convex-url/api/recordingMetrics/getMetrics"}
          query:
            sessionId: ${sessionId}
        result: metrics

    - decomposition:
        call: vertexai.predict
        args:
          model: "gemini-1.5-pro"
          prompt: ${buildDecompositionPrompt(metrics)}
        result: patternReport

    - research:
        call: runResearchAgent
        args:
          patterns: ${patternReport.patterns}
          metrics: ${metrics}
        result: researchReport

    - analysisLoop:
        for:
          value: iteration
          range: [1, 3]
          steps:
            - analyze:
                call: vertexai.predict
                args:
                  model: "gemini-1.5-pro"
                  prompt: ${buildAnalysisPrompt(metrics, patternReport, researchReport)}
                result: analysisReport

            - validate:
                call: vertexai.predict
                args:
                  model: "gemini-1.5-pro"
                  prompt: ${buildValidationPrompt(analysisReport, metrics)}
                result: validationResult

            - checkValidation:
                switch:
                  - condition: ${validationResult.status == "PASS"}
                    next: saveReports
                  - condition: ${validationResult.status == "CRITICAL_FAIL"}
                    raise: ${validationResult.criticalIssues}

    - saveReports:
        parallel:
          branches:
            - saveToConvex:
                call: http.post
                args:
                  url: "https://your-convex-url/api/analysis/saveReport"
                  body:
                    sessionId: ${sessionId}
                    report: ${analysisReport}
            - saveToVectorDB:
                call: savePatientHistory
                args:
                  sessionId: ${sessionId}
                  report: ${analysisReport}

    - progressReport:
        call: generateProgressReport
        args:
          sessionId: ${sessionId}
          analysisReport: ${analysisReport}
        result: progressReport

    - complete:
        call: http.post
        args:
          url: "https://your-convex-url/api/analysis/complete"
          body:
            sessionId: ${sessionId}
            progressReport: ${progressReport}
            processingTime: ${sys.now() - startTime}
```

### 7.2 Cloud Run Service

For the agent execution:

```typescript
// cloud-run/src/agents/index.ts

import { VertexAI } from '@google-cloud/vertexai';

const vertexAI = new VertexAI({
  project: process.env.GCP_PROJECT,
  location: 'us-central1',
});

const model = vertexAI.getGenerativeModel({
  model: 'gemini-1.5-pro-002',
  generationConfig: {
    maxOutputTokens: 8192,
    temperature: 0.2,  // Lower for more consistent output
  },
});

export async function runDecompositionAgent(metrics: RawMetricsInput): Promise<PatternReport> {
  const prompt = buildDecompositionPrompt(metrics);

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    systemInstruction: DECOMPOSITION_SYSTEM_PROMPT,
  });

  const response = result.response.candidates[0].content.parts[0].text;
  return parsePatternReport(response);
}

export async function runResearchAgent(
  patterns: Pattern[],
  metrics: RawMetricsInput,
  vectorDB: VectorDBClient
): Promise<ResearchReport> {
  const patternResearch: PatternResearch[] = [];

  for (const pattern of patterns) {
    // Check cache first
    const cached = await vectorDB.search({
      collection: 'research_cache',
      vector: await embed(pattern.description),
      filter: {
        qualityTier: { $in: ['S', 'A', 'B'] },
        cachedAt: { $gt: sixMonthsAgo() },
      },
      topK: 5,
    });

    let findings: ResearchFinding[] = [];

    if (cached.length >= 2 && cached.every(c => c.qualityTier <= 'B')) {
      // Good cache hit
      findings = cached.map(c => ({
        ...c,
        fromCache: true,
        retrievedAt: new Date().toISOString(),
      }));
    } else {
      // Need to search
      const searchResults = await webSearch(pattern.searchTerms);
      findings = await evaluateAndRateSources(searchResults, pattern);

      // Cache new findings
      for (const finding of findings) {
        if (finding.qualityTier <= 'B') {
          await vectorDB.insert('research_cache', {
            ...finding,
            embedding: await embed(finding.summary),
            cachedAt: new Date().toISOString(),
          });
        }
      }
    }

    // Generate synthesis
    const synthesis = await synthesizeFindings(pattern, findings);

    patternResearch.push({
      patternId: pattern.id,
      findings,
      synthesis: synthesis.summary,
      clinicalRelevance: synthesis.relevance,
      evidenceStrength: calculateEvidenceStrength(findings),
      knowledgeGap: findings.length < 2,
    });
  }

  return {
    sessionId: metrics.sessionId,
    generatedAt: new Date().toISOString(),
    patternResearch,
    summary: generateResearchSummary(patternResearch),
  };
}
```

---

## 8. Error Handling

### 8.1 Error Types and Responses

```typescript
enum AnalysisErrorType {
  // Recoverable
  TIMEOUT = 'TIMEOUT',
  RATE_LIMIT = 'RATE_LIMIT',
  TRANSIENT_FAILURE = 'TRANSIENT_FAILURE',

  // Partially recoverable
  DECOMPOSITION_FAILED = 'DECOMPOSITION_FAILED',
  RESEARCH_FAILED = 'RESEARCH_FAILED',

  // Non-recoverable
  INVALID_METRICS = 'INVALID_METRICS',
  CRITICAL_VALIDATION_FAIL = 'CRITICAL_VALIDATION_FAIL',
  MAX_RETRIES_EXCEEDED = 'MAX_RETRIES_EXCEEDED',
}

interface ErrorHandler {
  [AnalysisErrorType.TIMEOUT]: {
    action: 'retry',
    maxRetries: 3,
    backoff: 'exponential',
    initialDelay: 5000,
  },
  [AnalysisErrorType.RATE_LIMIT]: {
    action: 'retry',
    maxRetries: 5,
    backoff: 'exponential',
    initialDelay: 60000,
  },
  [AnalysisErrorType.DECOMPOSITION_FAILED]: {
    action: 'retry_with_fallback',
    fallback: 'basic_pattern_detection',
    maxRetries: 2,
  },
  [AnalysisErrorType.RESEARCH_FAILED]: {
    action: 'continue_without',
    skipTo: 'analysis',
    flag: 'limited_evidence',
  },
  [AnalysisErrorType.CRITICAL_VALIDATION_FAIL]: {
    action: 'escalate',
    notify: ['admin', 'user'],
    status: 'failed_validation',
  },
}
```

### 8.2 Retry Logic

```typescript
async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isRetryable(error)) {
        throw error;
      }

      const delay = calculateBackoff(attempt, config);
      console.log(`Attempt ${attempt} failed, retrying in ${delay}ms`);
      await sleep(delay);
    }
  }

  throw new MaxRetriesExceededError(lastError);
}

function calculateBackoff(attempt: number, config: RetryConfig): number {
  if (config.backoff === 'exponential') {
    return config.initialDelay * Math.pow(2, attempt - 1);
  }
  return config.initialDelay;
}
```

### 8.3 Fallback Strategies

```typescript
// If decomposition fails, use basic pattern detection
async function basicPatternDetection(metrics: RawMetricsInput): Promise<PatternReport> {
  const patterns: Pattern[] = [];

  // Simple threshold-based detection
  if (metrics.bilateralAnalysis.romAsymmetry > 15) {
    patterns.push({
      id: uuid(),
      category: 'asymmetry',
      type: 'rom_asymmetry',
      description: `ROM asymmetry of ${metrics.bilateralAnalysis.romAsymmetry.toFixed(1)}%`,
      affectedMetrics: [
        { metric: 'romAsymmetry', value: metrics.bilateralAnalysis.romAsymmetry, unit: '%' },
      ],
      severity: metrics.bilateralAnalysis.romAsymmetry > 25 ? 'moderate' : 'mild',
      confidence: 0.8,
      priority: 7,
      searchTerms: ['knee ROM asymmetry'],
      relatedConcepts: ['limb symmetry'],
    });
  }

  // ... more simple rules ...

  return {
    sessionId: metrics.sessionId,
    generatedAt: new Date().toISOString(),
    patterns,
    summary: {
      totalPatternsFound: patterns.length,
      highPriorityCount: patterns.filter(p => p.priority >= 7).length,
      categoryCounts: countByCategory(patterns),
    },
  };
}

// If research fails, continue with cached data only
async function researchWithCacheOnly(
  patterns: Pattern[],
  vectorDB: VectorDBClient
): Promise<ResearchReport> {
  // Only use existing cache, no web searches
  // Mark knowledge gaps more aggressively
}
```

---

## 9. Security & Privacy

### 9.1 Data Protection

```typescript
// Patient ID hashing
function hashPatientId(patientId: string): string {
  const salt = process.env.PATIENT_ID_SALT;
  return crypto
    .createHash('sha256')
    .update(patientId + salt)
    .digest('hex');
}

// Encrypt sensitive content before storing in VectorDB
async function encryptForStorage(data: any): Promise<EncryptedData> {
  const key = await getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf8'),
    cipher.final(),
  ]);

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}
```

### 9.2 Access Control

```typescript
// Verify user can access analysis
async function canAccessAnalysis(
  ctx: QueryCtx,
  userId: string,
  sessionId: string
): Promise<boolean> {
  const session = await ctx.db
    .query("recordingSessions")
    .filter(q => q.eq(q.field("sessionId"), sessionId))
    .first();

  if (!session) return false;

  // Owner can always access
  if (session.ownerId === userId) return true;

  // Subject can access their own data
  if (session.subjectId === userId) return true;

  // Check sharing permissions
  const sharing = await ctx.db
    .query("sessionSharing")
    .withIndex("by_session_user", q =>
      q.eq("sessionId", sessionId).eq("sharedWithId", userId)
    )
    .first();

  return !!sharing;
}
```

### 9.3 Audit Logging

```typescript
// Log all analysis access
async function logAnalysisAccess(
  ctx: MutationCtx,
  action: 'view' | 'generate' | 'export',
  sessionId: string,
  userId: string
): Promise<void> {
  await ctx.db.insert("auditLogs", {
    action: `analysis_${action}`,
    resourceType: 'analysis',
    resourceId: sessionId,
    userId,
    timestamp: Date.now(),
    ipAddress: ctx.request?.ip,
    userAgent: ctx.request?.headers?.['user-agent'],
  });
}
```

---

## 10. Cost Estimation

### 10.1 Per-Session Costs (Gemini 2.0 Flash)

Gemini 2.0 Flash pricing (as of Dec 2024):
- Input: $0.10 / 1M tokens
- Output: $0.40 / 1M tokens
- ~75% cheaper than Gemini 1.5 Pro

| Stage | Model | Input Tokens | Output Tokens | Cost (Gemini 2.0 Flash) |
|-------|-------|--------------|---------------|-------------------------|
| Decomposition | Flash | ~3,000 | ~1,500 | $0.0009 |
| Research (per pattern × 5) | Flash | ~2,000 × 5 | ~1,000 × 5 | $0.003 |
| Analysis | Flash | ~12,000 | ~4,000 | $0.0028 |
| Validation (× 2 avg) | Flash | ~8,000 × 2 | ~1,000 × 2 | $0.0024 |
| Progress | Flash | ~6,000 | ~2,000 | $0.0014 |
| **Subtotal LLM** | | | | **~$0.01** |

| Other Costs | Unit Cost | Usage | Cost |
|------------|-----------|-------|------|
| Embeddings (Vertex) | $0.00002/1K tokens | ~15K tokens | $0.0003 |
| Web Search (Google) | $0.005/query | ~10 queries | $0.05 |
| Convex (included) | - | Vector search + storage | $0.00 |
| **Subtotal Other** | | | **~$0.05** |

**Total per session: ~$0.06-0.08** (vs $0.25-0.35 with Pro)

### 10.2 Monthly Projections

| Sessions/Month | LLM Cost | Other Costs | Total |
|---------------|----------|-------------|-------|
| 100 | $1 | $5 | $6 |
| 1,000 | $10 | $50 | $60 |
| 10,000 | $100 | $500 | $600 |

### 10.3 Cost Optimization Strategies

1. **Aggressive research caching** (reduce web searches by 50-70%)
2. **Batch processing** during off-peak hours
3. **Skip progress report** if only 1 session exists
4. **Use existing normative baselines** (no separate VectorDB lookups needed)

---

## 11. Implementation Phases

### Phase 1: Foundation (2-3 weeks)
- [ ] Set up Vertex AI project and credentials
- [ ] Create VectorDB collections (research cache, normative baselines)
- [ ] Add Convex schema for analysis reports
- [ ] Build basic Decomposition Agent
- [ ] Test with sample metrics

### Phase 2: Research Pipeline (2-3 weeks)
- [ ] Implement web search integration
- [ ] Build source quality rating system
- [ ] Create Research Agent with caching
- [ ] Populate initial research cache with key sources
- [ ] Load normative baselines

### Phase 3: Analysis & Validation (2-3 weeks)
- [ ] Build Analysis Agent (session report)
- [ ] Build Validator Agent
- [ ] Implement validation loop
- [ ] Add retry and error handling
- [ ] Test full pipeline end-to-end

### Phase 4: Progress Tracking (1-2 weeks)
- [ ] Set up Patient History VectorDB
- [ ] Build Progress Report generation
- [ ] Implement historical trend analysis
- [ ] Test multi-session scenarios

### Phase 5: Integration & Polish (1-2 weeks)
- [ ] Integrate trigger from metrics completion
- [ ] Add UI for viewing reports
- [ ] Implement notifications
- [ ] Add export functionality
- [ ] Performance optimization

### Phase 6: Production Hardening (1 week)
- [ ] Security audit
- [ ] Load testing
- [ ] Monitoring and alerting
- [ ] Documentation
- [ ] User acceptance testing

---

## Appendix A: Prompt Templates

See separate document: `prompts/agent-prompts.md`

## Appendix B: Normative Baseline Sources

| Metric | Source | Population | Sample Size |
|--------|--------|------------|-------------|
| Knee ROM | JOSPT 2019 | Healthy adults 18-65 | 2,400 |
| LSI Thresholds | Grindem 2016 | ACL rehab | 850 |
| Angular Velocity | Sports Med 2020 | Athletes | 1,200 |
| Asymmetry Norms | BJSM 2018 | General population | 3,100 |

## Appendix C: Quality Tier Scoring Details

See separate document: `docs/source-quality-scoring.md`
