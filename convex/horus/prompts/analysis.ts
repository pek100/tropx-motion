/**
 * Analysis Agent Prompt
 *
 * Purpose: Generate clinical insights for UI display.
 * Produces insights with chart data, correlative insights, and normative benchmarking.
 * Enforces side specificity and binary classification (strength/weakness only).
 *
 * NEW: Generates VisualizationBlock arrays for HorusPane UI rendering.
 */

import {
  METRIC_REGISTRY,
  METRICS_BY_DOMAIN,
  DOMAIN_COLORS,
  calculatePercentile,
  forceClassification,
  getBenchmarkCategory,
  type MetricDomain,
} from "../metrics";
import type {
  DetectedPattern,
  ResearchEvidence,
  SessionMetrics,
  AnalysisOutput,
  Insight,
  CorrelativeInsight,
  NormativeBenchmark,
} from "../types";
import type { VisualizationBlock, AnalysisVisualization } from "../visualization/types";
import { getVisualizationCatalogForPrompt } from "../visualization/catalog";
import {
  computeAsymmetryEnrichment,
  identifyPotentialCorrelations,
  generateCorrelationPromptSection,
} from "../correlation";

// ─────────────────────────────────────────────────────────────────
// System Prompt
// ─────────────────────────────────────────────────────────────────

export const ANALYSIS_SYSTEM_PROMPT = `You are a clinical analysis system for the Horus biomechanics pipeline.

Your role is to synthesize patterns and research evidence into actionable clinical insights.

## Your Tasks

1. **Generate Insights**: Create 4-6 domain-specific insights (NOT more)
2. **Correlative Analysis**: Find 2-3 relationships between insights
3. **Normative Benchmarking**: Include 6-8 most important benchmarks only
4. **Force Classification**: Every metric is either a strength or weakness (no neutral)
5. **Generate Visualization Blocks**: 4-5 blocks per mode (NOT more)

## OUTPUT SIZE LIMITS (CRITICAL)
- Maximum 4-6 insights total
- Maximum 2-3 correlative insights
- Maximum 6-8 benchmarks (most clinically relevant)
- Maximum 4-5 visualization blocks per mode
- Keep content strings concise (1-2 sentences)
- Keep evidence arrays to 1-2 items per insight
- Keep recommendations to 1-2 per insight

## CRITICAL RULES

### Side Specificity (ENFORCED)
- ALWAYS use "Left Leg" or "Right Leg" (exact strings)
- NEVER use "left", "L", "right", "R", "affected", "involved"
- If a deficit is on the left, say "Left Leg shows..."
- If comparing, say "Left Leg vs Right Leg"

### Classification (NO NEUTRAL)
- Every insight MUST be classified as "strength" or "weakness"
- Use percentile 55 as tiebreaker for average metrics
- ≥55th percentile → strength
- <55th percentile → weakness

### Evidence Support
- Every insight must reference at least one research finding
- Cite sources in evidence array

### Chart Data
- Provide chart configuration for each insight
- Use appropriate chart type (radar, bar, comparison)
- Include reference lines for thresholds

### Visualization Blocks
- Generate EXACTLY 4-5 blocks per mode (no more!)
- Use metric expressions for values (NOT actual numbers)
- The UI will fill in real values from SessionMetrics

### Composable Slots (ShadCN-style)
Each visualization block can have optional composable slots. Use them based on clinical significance:

**MINIMAL use** (simple metrics):
\`\`\`json
{ "type": "stat_card", "title": "ROM", "metric": "leftLeg.peakFlexion", "unit": "°" }
\`\`\`

**RICH use** (significant findings):
\`\`\`json
{
  "type": "stat_card",
  "id": "finding-rom-1",
  "title": "ROM Deficit",
  "metric": "leftLeg.peakFlexion",
  "unit": "°",
  "limb": "Left Leg",
  "classification": "weakness",
  "benchmark": "deficient",
  "domain": "range",
  "details": {
    "evidence": ["ROM <100° associated with functional limitations (Bade et al.)"],
    "implications": ["May limit squatting and stair climbing"],
    "recommendations": ["Focus on heel slides, wall slides"],
    "relatedIds": ["finding-power-1"]
  },
  "expandable": true
}
\`\`\`

**Slot Guidelines**:
- \`id\`: Use for correlation linking (e.g., "finding-rom-1")
- \`classification\`: "strength" or "weakness" (REQUIRED for significant findings)
- \`limb\`: "Left Leg" or "Right Leg" (REQUIRED for per-leg metrics)
- \`benchmark\`: "optimal", "average", or "deficient"
- \`domain\`: "range", "symmetry", "power", "control", or "timing"
- \`details\`: Use for clinically significant findings worth explaining
- \`deficitLimb\`: For comparison_card, specify which limb has the deficit

### BAD Examples (Avoid These)
❌ "The affected limb shows reduced ROM" → Use "Left Leg" or "Right Leg"
❌ "L: 98°, R: 119°" → Use "Left Leg: 98°, Right Leg: 119°"
❌ Generic descriptions without limb → Always specify the limb
❌ Using details slot for simple metrics → Reserve for significant findings

## Output Format

{
  "insights": [
    {
      "id": "string",
      "domain": "range" | "symmetry" | "power" | "control" | "timing",
      "classification": "strength" | "weakness",
      "title": "Short title",
      "content": "Main insight text with specific values",
      "limbs": ["Left Leg"] | ["Right Leg"] | ["Left Leg", "Right Leg"],
      "evidence": ["Citation 1", "Citation 2"],
      "patternIds": ["pattern-1"],
      "chart": {
        "type": "bar" | "radar" | "comparison",
        "title": "Chart title",
        "data": [{ "label": "Label", "value": 100, "domain": "range" }],
        "references": [{ "label": "Good", "value": 120 }]
      },
      "percentile": 65,
      "recommendations": ["Optional recommendation"]
    }
  ],
  "correlativeInsights": [
    {
      "id": "string",
      "primaryInsightId": "insight-1",
      "relatedInsightIds": ["insight-2"],
      "explanation": "How these are related",
      "significance": "high" | "moderate" | "low"
    }
  ],
  "benchmarks": [
    {
      "metricName": "overallMaxRom",
      "displayName": "Maximum ROM",
      "domain": "range",
      "value": 115,
      "percentile": 72,
      "category": "optimal",
      "classification": "strength",
      "limb": "Left Leg"
    }
  ],
  "summary": "2-3 sentence overall summary",
  "strengths": ["Top strength 1", "Top strength 2", "Top strength 3"],
  "weaknesses": ["Top weakness 1", "Top weakness 2", "Top weakness 3"],
  "visualization": {
    "overallBlocks": [...],
    "sessionBlocks": [...]
  }
}

## Domain Colors (for charts)

- Range: ${DOMAIN_COLORS.range}
- Symmetry: ${DOMAIN_COLORS.symmetry}
- Power: ${DOMAIN_COLORS.power}
- Control: ${DOMAIN_COLORS.control}
- Timing: ${DOMAIN_COLORS.timing}

${getVisualizationCatalogForPrompt()}`;

// ─────────────────────────────────────────────────────────────────
// User Prompt Builder
// ─────────────────────────────────────────────────────────────────

export function buildAnalysisUserPrompt(
  patterns: DetectedPattern[],
  evidenceByPattern: Record<string, ResearchEvidence[]>,
  metrics: SessionMetrics,
  /** Pre-computed benchmarks for correlation detection */
  benchmarks?: NormativeBenchmark[]
): string {
  const sections: string[] = [];

  sections.push(`# Analysis Request

Generate clinical insights from the following patterns and evidence.

**Session ID**: ${metrics.sessionId}
**Movement Type**: ${metrics.movementType}
${metrics.opiScore ? `**OPI Score**: ${metrics.opiScore} (${metrics.opiGrade})` : ""}`);

  // Inject pre-computed correlation data if benchmarks provided
  if (benchmarks) {
    const asymmetryData = computeAsymmetryEnrichment(metrics);
    const correlations = identifyPotentialCorrelations(benchmarks, asymmetryData);
    const correlationSection = generateCorrelationPromptSection(asymmetryData, correlations);

    if (correlationSection) {
      sections.push(`\n${correlationSection}`);
    }
  }

  // Patterns with evidence
  sections.push(`
## Detected Patterns with Evidence

${patterns
  .map((p) => {
    const evidence = evidenceByPattern[p.id] || [];
    return `### ${p.id} (${p.type}, ${p.severity})
**Description**: ${p.description}
**Metrics**: ${p.metrics.join(", ")}
**Limbs**: ${p.limbs?.join(", ") || "Bilateral"}

**Evidence** (${evidence.length} sources):
${
  evidence.length > 0
    ? evidence
        .map(
          (e) =>
            `- [Tier ${e.tier}] ${e.citation}: ${e.findings.slice(0, 2).join("; ")}`
        )
        .join("\n")
    : "- No direct evidence found"
}`;
  })
  .join("\n\n")}`);

  // Raw metrics for benchmarking
  sections.push(`
## Raw Metrics for Benchmarking

### Left Leg
${Object.entries(metrics.leftLeg)
  .map(([k, v]) => {
    const config = METRIC_REGISTRY[k];
    if (!config) return null;
    const pct = calculatePercentile(v, config);
    const cat = getBenchmarkCategory(v, config);
    return `- ${config.displayName}: ${v.toFixed(1)}${config.unit} (${pct.toFixed(0)}th percentile, ${cat})`;
  })
  .filter(Boolean)
  .join("\n")}

### Right Leg
${Object.entries(metrics.rightLeg)
  .map(([k, v]) => {
    const config = METRIC_REGISTRY[k];
    if (!config) return null;
    const pct = calculatePercentile(v, config);
    const cat = getBenchmarkCategory(v, config);
    return `- ${config.displayName}: ${v.toFixed(1)}${config.unit} (${pct.toFixed(0)}th percentile, ${cat})`;
  })
  .filter(Boolean)
  .join("\n")}

### Bilateral
${Object.entries(metrics.bilateral)
  .map(([k, v]) => {
    const config = METRIC_REGISTRY[k];
    if (!config) return null;
    const pct = calculatePercentile(v, config);
    const cat = getBenchmarkCategory(v, config);
    return `- ${config.displayName}: ${v.toFixed(2)}${config.unit} (${pct.toFixed(0)}th percentile, ${cat})`;
  })
  .filter(Boolean)
  .join("\n")}`);

  sections.push(`
## Instructions

1. Create 4-6 insights (prioritize domains with deficient metrics)
2. ENFORCE side specificity: "Left Leg" or "Right Leg" only
3. FORCE classification: strength or weakness (use 55th percentile tiebreaker)
4. Generate 2-3 correlative insights linking related findings
5. Include 6-8 benchmarks for most important metrics only
6. Write 2-sentence summary with top 2 strengths and top 2 weaknesses
7. Generate EXACTLY 4-5 visualization blocks per mode:
   - **overallBlocks** (4-5 blocks): executive_summary, 2-3 stat_cards, next_steps
   - **sessionBlocks** (4-5 blocks): executive_summary, 1-2 stat_cards, 1 comparison_card or alert_card, next_steps

BE CONCISE. Quality over quantity. Avoid verbose explanations.

Return the JSON response.`);

  return sections.join("\n");
}

// ─────────────────────────────────────────────────────────────────
// Response Parser
// ─────────────────────────────────────────────────────────────────

export interface AnalysisOutputWithVisualization extends AnalysisOutput {
  visualization?: AnalysisVisualization;
}

export function parseAnalysisResponse(
  sessionId: string,
  responseText: string
): AnalysisOutputWithVisualization {
  // Extract JSON
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : responseText.trim();

  const parsed = JSON.parse(jsonStr);

  // Transform insights
  const insights: Insight[] = (parsed.insights || []).map(
    (i: Record<string, unknown>, idx: number) => ({
      id: (i.id as string) || `insight-${idx}`,
      domain: i.domain as MetricDomain,
      classification: i.classification as "strength" | "weakness",
      title: (i.title as string) || "",
      content: (i.content as string) || "",
      limbs: i.limbs as Insight["limbs"],
      evidence: Array.isArray(i.evidence) ? (i.evidence as string[]) : [],
      patternIds: Array.isArray(i.patternIds) ? (i.patternIds as string[]) : [],
      chart: i.chart as Insight["chart"],
      percentile: i.percentile as number | undefined,
      recommendations: i.recommendations as string[] | undefined,
    })
  );

  // Transform correlative insights
  const correlativeInsights: CorrelativeInsight[] = (
    parsed.correlativeInsights || []
  ).map((c: Record<string, unknown>, idx: number) => ({
    id: (c.id as string) || `corr-${idx}`,
    primaryInsightId: (c.primaryInsightId as string) || "",
    relatedInsightIds: Array.isArray(c.relatedInsightIds)
      ? (c.relatedInsightIds as string[])
      : [],
    explanation: (c.explanation as string) || "",
    significance: (c.significance as "high" | "moderate" | "low") || "moderate",
  }));

  // Transform benchmarks
  const benchmarks: NormativeBenchmark[] = (parsed.benchmarks || []).map(
    (b: Record<string, unknown>) => ({
      metricName: (b.metricName as string) || "",
      displayName: (b.displayName as string) || "",
      domain: b.domain as MetricDomain,
      value: (b.value as number) || 0,
      percentile: (b.percentile as number) || 50,
      category: b.category as NormativeBenchmark["category"],
      classification: b.classification as "strength" | "weakness",
      limb: b.limb as NormativeBenchmark["limb"],
    })
  );

  // Parse visualization blocks
  const visualization: AnalysisVisualization | undefined = parsed.visualization
    ? {
        overallBlocks: Array.isArray(parsed.visualization.overallBlocks)
          ? (parsed.visualization.overallBlocks as VisualizationBlock[])
          : [],
        sessionBlocks: Array.isArray(parsed.visualization.sessionBlocks)
          ? (parsed.visualization.sessionBlocks as VisualizationBlock[])
          : [],
      }
    : undefined;

  return {
    sessionId,
    insights,
    correlativeInsights,
    benchmarks,
    summary: (parsed.summary as string) || "",
    strengths: Array.isArray(parsed.strengths) ? (parsed.strengths as string[]) : [],
    weaknesses: Array.isArray(parsed.weaknesses)
      ? (parsed.weaknesses as string[])
      : [],
    analyzedAt: Date.now(),
    visualization,
  };
}

// ─────────────────────────────────────────────────────────────────
// Pre-compute Benchmarks
// ─────────────────────────────────────────────────────────────────

/**
 * Pre-compute normative benchmarks from metrics.
 * Provides consistent benchmarking regardless of LLM output.
 */
export function preComputeBenchmarks(metrics: SessionMetrics): NormativeBenchmark[] {
  const benchmarks: NormativeBenchmark[] = [];

  // Per-leg metrics (both legs)
  for (const [key, leftValue] of Object.entries(metrics.leftLeg)) {
    const config = METRIC_REGISTRY[key];
    if (!config) continue;

    const rightValue = metrics.rightLeg[key as keyof typeof metrics.rightLeg];

    // Left leg
    const leftPct = calculatePercentile(leftValue, config);
    const leftCat = getBenchmarkCategory(leftValue, config);
    const leftClass = forceClassification(leftCat, leftPct);

    benchmarks.push({
      metricName: key,
      displayName: config.displayName,
      domain: config.domain,
      value: leftValue,
      percentile: Math.round(leftPct),
      category: leftCat,
      classification: leftClass,
      limb: "Left Leg",
    });

    // Right leg
    const rightPct = calculatePercentile(rightValue, config);
    const rightCat = getBenchmarkCategory(rightValue, config);
    const rightClass = forceClassification(rightCat, rightPct);

    benchmarks.push({
      metricName: key,
      displayName: config.displayName,
      domain: config.domain,
      value: rightValue,
      percentile: Math.round(rightPct),
      category: rightCat,
      classification: rightClass,
      limb: "Right Leg",
    });
  }

  // Bilateral metrics
  for (const [key, value] of Object.entries(metrics.bilateral)) {
    const config = METRIC_REGISTRY[key];
    if (!config) continue;

    const pct = calculatePercentile(value, config);
    const cat = getBenchmarkCategory(value, config);
    const cls = forceClassification(cat, pct);

    benchmarks.push({
      metricName: key,
      displayName: config.displayName,
      domain: config.domain,
      value,
      percentile: Math.round(pct),
      category: cat,
      classification: cls,
    });
  }

  return benchmarks;
}
