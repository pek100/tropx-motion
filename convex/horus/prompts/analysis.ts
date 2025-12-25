/**
 * Analysis Agent Prompt
 *
 * Purpose: Generate clinical insights for UI display.
 * Produces insights with chart data, correlative insights, and normative benchmarking.
 * Enforces side specificity and binary classification (strength/weakness only).
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

// ─────────────────────────────────────────────────────────────────
// System Prompt
// ─────────────────────────────────────────────────────────────────

export const ANALYSIS_SYSTEM_PROMPT = `You are a clinical analysis system for the Horus biomechanics pipeline.

Your role is to synthesize patterns and research evidence into actionable clinical insights.

## Your Tasks

1. **Generate Insights**: Create domain-specific insights with chart data
2. **Correlative Analysis**: Find relationships between insights (minimum 2)
3. **Normative Benchmarking**: Calculate percentiles for radar chart
4. **Force Classification**: Every metric is either a strength or weakness (no neutral)

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
  "weaknesses": ["Top weakness 1", "Top weakness 2", "Top weakness 3"]
}

## Domain Colors (for charts)

- Range: ${DOMAIN_COLORS.range}
- Symmetry: ${DOMAIN_COLORS.symmetry}
- Power: ${DOMAIN_COLORS.power}
- Control: ${DOMAIN_COLORS.control}
- Timing: ${DOMAIN_COLORS.timing}`;

// ─────────────────────────────────────────────────────────────────
// User Prompt Builder
// ─────────────────────────────────────────────────────────────────

export function buildAnalysisUserPrompt(
  patterns: DetectedPattern[],
  evidenceByPattern: Record<string, ResearchEvidence[]>,
  metrics: SessionMetrics
): string {
  const sections: string[] = [];

  sections.push(`# Analysis Request

Generate clinical insights from the following patterns and evidence.

**Session ID**: ${metrics.sessionId}
**Movement Type**: ${metrics.movementType}
${metrics.opiScore ? `**OPI Score**: ${metrics.opiScore} (${metrics.opiGrade})` : ""}`);

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

1. Create insights grouped by domain (prioritize domains with deficient metrics)
2. ENFORCE side specificity: "Left Leg" or "Right Leg" only
3. FORCE classification: strength or weakness (use 55th percentile tiebreaker)
4. Generate at least 2 correlative insights
5. Calculate benchmarks for all metrics (both legs)
6. Provide chart config for primary insights
7. Write concise summary with top 3 strengths and weaknesses

Return the JSON response.`);

  return sections.join("\n");
}

// ─────────────────────────────────────────────────────────────────
// Response Parser
// ─────────────────────────────────────────────────────────────────

export function parseAnalysisResponse(
  sessionId: string,
  responseText: string
): AnalysisOutput {
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
