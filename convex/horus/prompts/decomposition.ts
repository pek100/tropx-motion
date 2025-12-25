/**
 * Decomposition Agent Prompt
 *
 * Purpose: Extract patterns from metrics WITHOUT interpretation.
 * Outputs factual observations about threshold violations, asymmetries,
 * and cross-metric correlations with search terms for the Research Agent.
 */

import {
  METRIC_REGISTRY,
  METRICS_BY_DOMAIN,
  PER_LEG_METRICS,
  BILATERAL_METRICS,
  getBenchmarkCategory,
  calculateAsymmetry,
  CLINICAL_THRESHOLDS,
  type MetricDomain,
} from "../metrics";
import type { SessionMetrics, DecompositionOutput, DetectedPattern } from "../types";

// ─────────────────────────────────────────────────────────────────
// System Prompt
// ─────────────────────────────────────────────────────────────────

export const DECOMPOSITION_SYSTEM_PROMPT = `You are a biomechanical pattern recognition system for the Horus analysis pipeline.

Your role is to identify patterns in motion capture metrics WITHOUT providing clinical interpretation.
You detect facts only - the interpretation comes later from the Analysis Agent.

## Your Tasks

1. **Threshold Violations**: Flag metrics outside optimal/deficient thresholds
2. **Asymmetry Detection**: Identify left-right differences using direction-aware logic
3. **Cross-Metric Correlations**: Find related metric patterns
4. **Temporal Patterns**: Compare to previous session if available
5. **Quality Flags**: Note data quality issues

## Rules

- BE FACTUAL: State observations, not interpretations
- BE SPECIFIC: Use exact values with units
- BE COMPLETE: Check all metrics provided
- USE CORRECT LIMB NAMES: Always "Left Leg" or "Right Leg" (never "left" or "L")
- INCLUDE SEARCH TERMS: Provide 2-3 search terms for each pattern for research

## Output Format

Return a JSON object with:
{
  "patterns": [
    {
      "id": "string (unique)",
      "type": "threshold_violation" | "asymmetry" | "cross_metric_correlation" | "temporal_pattern" | "quality_flag",
      "metrics": ["metric names"],
      "severity": "high" | "moderate" | "low",
      "description": "Factual description",
      "values": { "metricName": value },
      "limbs": ["Left Leg"] | ["Right Leg"] | ["Left Leg", "Right Leg"] | null,
      "searchTerms": ["term1", "term2"],
      "benchmarkCategory": "optimal" | "average" | "deficient" | null
    }
  ]
}

## Severity Guidelines

- **High**: Metric in deficient category OR asymmetry >15%
- **Moderate**: Metric in average category (below good) OR asymmetry 10-15%
- **Low**: Minor deviation OR asymmetry 5-10%

## Metric Domains

- **Range**: ROM, flexion, extension
- **Symmetry**: Asymmetry indices, cross-correlation
- **Power**: Velocity, explosiveness
- **Control**: Jerk, consistency
- **Timing**: Phase shift, temporal lag`;

// ─────────────────────────────────────────────────────────────────
// User Prompt Builder
// ─────────────────────────────────────────────────────────────────

export function buildDecompositionUserPrompt(
  metrics: SessionMetrics,
  previousMetrics?: SessionMetrics
): string {
  const sections: string[] = [];

  // Header
  sections.push(`# Session Metrics Analysis Request

**Session ID**: ${metrics.sessionId}
**Movement Type**: ${metrics.movementType}
**Recorded At**: ${new Date(metrics.recordedAt).toISOString()}
${metrics.opiScore ? `**OPI Score**: ${metrics.opiScore} (${metrics.opiGrade})` : ""}`);

  // Left Leg Metrics
  sections.push(`
## Left Leg Metrics
${formatPerLegMetrics(metrics.leftLeg)}`);

  // Right Leg Metrics
  sections.push(`
## Right Leg Metrics
${formatPerLegMetrics(metrics.rightLeg)}`);

  // Bilateral Metrics
  sections.push(`
## Bilateral Metrics
${formatBilateralMetrics(metrics.bilateral)}`);

  // Thresholds Reference
  sections.push(`
## Reference Thresholds
${formatThresholds()}`);

  // Previous Session (if available)
  if (previousMetrics) {
    sections.push(`
## Previous Session (for comparison)
**Session ID**: ${previousMetrics.sessionId}
**Recorded At**: ${new Date(previousMetrics.recordedAt).toISOString()}

### Previous Left Leg
${formatPerLegMetrics(previousMetrics.leftLeg)}

### Previous Right Leg
${formatPerLegMetrics(previousMetrics.rightLeg)}

### Previous Bilateral
${formatBilateralMetrics(previousMetrics.bilateral)}`);
  }

  sections.push(`
## Instructions

1. Analyze each metric against thresholds
2. Check for asymmetries between legs
3. Look for correlations across metrics
4. ${previousMetrics ? "Compare with previous session for temporal patterns" : "No previous session available"}
5. Generate search terms for each pattern

Return JSON with the patterns found.`);

  return sections.join("\n");
}

// ─────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────

function formatPerLegMetrics(leg: SessionMetrics["leftLeg"]): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(leg)) {
    const config = METRIC_REGISTRY[key];
    if (!config) continue;

    const category = getBenchmarkCategory(value, config);
    const categoryEmoji =
      category === "optimal" ? "✓" : category === "deficient" ? "✗" : "○";

    lines.push(
      `- **${config.displayName}**: ${value.toFixed(1)}${config.unit} [${categoryEmoji} ${category}]`
    );
  }

  return lines.join("\n");
}

function formatBilateralMetrics(bilateral: SessionMetrics["bilateral"]): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(bilateral)) {
    const config = METRIC_REGISTRY[key];
    if (!config) continue;

    const category = getBenchmarkCategory(value, config);
    const categoryEmoji =
      category === "optimal" ? "✓" : category === "deficient" ? "✗" : "○";

    lines.push(
      `- **${config.displayName}**: ${value.toFixed(2)}${config.unit} [${categoryEmoji} ${category}]`
    );
  }

  return lines.join("\n");
}

function formatThresholds(): string {
  const lines: string[] = [];

  for (const domain of Object.keys(METRICS_BY_DOMAIN) as MetricDomain[]) {
    lines.push(`\n### ${domain.charAt(0).toUpperCase() + domain.slice(1)} Domain`);

    for (const metricName of METRICS_BY_DOMAIN[domain]) {
      const config = METRIC_REGISTRY[metricName];
      if (!config) continue;

      const direction =
        config.direction === "higherBetter"
          ? "≥ good, ≤ poor"
          : "≤ good, ≥ poor";

      lines.push(
        `- ${config.displayName}: Good ${direction === "≥ good, ≤ poor" ? "≥" : "≤"} ${config.goodThreshold}${config.unit}, Poor ${direction === "≥ good, ≤ poor" ? "≤" : "≥"} ${config.poorThreshold}${config.unit}`
      );
    }
  }

  lines.push(`
### Asymmetry Thresholds
- Low: <${CLINICAL_THRESHOLDS.ASYMMETRY_LOW}%
- Moderate: ${CLINICAL_THRESHOLDS.ASYMMETRY_LOW}-${CLINICAL_THRESHOLDS.ASYMMETRY_MODERATE}%
- High: >${CLINICAL_THRESHOLDS.ASYMMETRY_HIGH}%`);

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────
// Response Parser
// ─────────────────────────────────────────────────────────────────

export function parseDecompositionResponse(
  sessionId: string,
  responseText: string
): DecompositionOutput {
  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : responseText.trim();

  const parsed = JSON.parse(jsonStr);

  // Validate and transform patterns
  const patterns: DetectedPattern[] = (parsed.patterns || []).map(
    (p: Record<string, unknown>, idx: number) => ({
      id: (p.id as string) || `pattern-${idx}`,
      type: p.type as DetectedPattern["type"],
      metrics: Array.isArray(p.metrics) ? (p.metrics as string[]) : [],
      severity: (p.severity as DetectedPattern["severity"]) || "moderate",
      description: (p.description as string) || "",
      values: (p.values as Record<string, number>) || {},
      limbs: p.limbs as DetectedPattern["limbs"],
      searchTerms: Array.isArray(p.searchTerms) ? (p.searchTerms as string[]) : [],
      benchmarkCategory: p.benchmarkCategory as DetectedPattern["benchmarkCategory"],
    })
  );

  // Count patterns by type
  const patternCounts: DecompositionOutput["patternCounts"] = {
    threshold_violation: 0,
    asymmetry: 0,
    cross_metric_correlation: 0,
    temporal_pattern: 0,
    quality_flag: 0,
  };

  for (const p of patterns) {
    patternCounts[p.type]++;
  }

  return {
    sessionId,
    patterns,
    patternCounts,
    analyzedAt: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────
// Pre-Processing: Detect Patterns Programmatically
// ─────────────────────────────────────────────────────────────────

/**
 * Pre-detect patterns from metrics before LLM call.
 * This gives the LLM a head start and ensures we don't miss obvious patterns.
 */
export function preDetectPatterns(
  metrics: SessionMetrics,
  previousMetrics?: SessionMetrics
): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  let patternId = 0;

  const generateId = () => `pre-${patternId++}`;

  // 1. Check threshold violations for per-leg metrics
  for (const metricName of PER_LEG_METRICS) {
    const config = METRIC_REGISTRY[metricName];
    if (!config) continue;

    const leftKey = metricName as keyof SessionMetrics["leftLeg"];
    const rightKey = metricName as keyof SessionMetrics["rightLeg"];

    // Check if these keys exist in the leg metrics
    if (!(leftKey in metrics.leftLeg) || !(rightKey in metrics.rightLeg)) continue;

    const leftValue = metrics.leftLeg[leftKey];
    const rightValue = metrics.rightLeg[rightKey];

    const leftCategory = getBenchmarkCategory(leftValue, config);
    const rightCategory = getBenchmarkCategory(rightValue, config);

    // Report deficient metrics
    if (leftCategory === "deficient") {
      patterns.push({
        id: generateId(),
        type: "threshold_violation",
        metrics: [metricName],
        severity: "high",
        description: `Left Leg ${config.displayName} is ${leftValue.toFixed(1)}${config.unit}, below deficient threshold (${config.poorThreshold}${config.unit})`,
        values: { [metricName]: leftValue },
        limbs: ["Left Leg"],
        searchTerms: [
          `${config.displayName} deficit`,
          "knee rehabilitation",
          `${config.domain} impairment`,
        ],
        benchmarkCategory: "deficient",
      });
    }

    if (rightCategory === "deficient") {
      patterns.push({
        id: generateId(),
        type: "threshold_violation",
        metrics: [metricName],
        severity: "high",
        description: `Right Leg ${config.displayName} is ${rightValue.toFixed(1)}${config.unit}, below deficient threshold (${config.poorThreshold}${config.unit})`,
        values: { [metricName]: rightValue },
        limbs: ["Right Leg"],
        searchTerms: [
          `${config.displayName} deficit`,
          "knee rehabilitation",
          `${config.domain} impairment`,
        ],
        benchmarkCategory: "deficient",
      });
    }

    // 2. Check asymmetry for this metric
    const asymmetry = calculateAsymmetry(leftValue, rightValue, config.direction);

    if (asymmetry.percentage >= CLINICAL_THRESHOLDS.ASYMMETRY_LOW) {
      const severity =
        asymmetry.percentage >= CLINICAL_THRESHOLDS.ASYMMETRY_HIGH
          ? "high"
          : asymmetry.percentage >= CLINICAL_THRESHOLDS.ASYMMETRY_MODERATE
            ? "moderate"
            : "low";

      patterns.push({
        id: generateId(),
        type: "asymmetry",
        metrics: [metricName],
        severity,
        description: `${config.displayName} asymmetry of ${asymmetry.percentage.toFixed(1)}% detected. ${asymmetry.deficitLimb} shows deficit.`,
        values: {
          leftValue,
          rightValue,
          asymmetryPercent: asymmetry.percentage,
        },
        limbs: asymmetry.deficitLimb ? [asymmetry.deficitLimb] : undefined,
        searchTerms: [
          `${config.displayName} asymmetry`,
          "bilateral difference",
          `${asymmetry.deficitLimb?.toLowerCase().replace(" ", "_")} deficit`,
        ],
      });
    }
  }

  // 3. Check bilateral metrics
  for (const metricName of BILATERAL_METRICS) {
    const config = METRIC_REGISTRY[metricName];
    if (!config) continue;

    const bilateralKey = metricName as keyof SessionMetrics["bilateral"];
    if (!(bilateralKey in metrics.bilateral)) continue;

    const value = metrics.bilateral[bilateralKey];
    const category = getBenchmarkCategory(value, config);

    if (category === "deficient") {
      patterns.push({
        id: generateId(),
        type: "threshold_violation",
        metrics: [metricName],
        severity: "high",
        description: `${config.displayName} is ${value.toFixed(2)}${config.unit}, in deficient range`,
        values: { [metricName]: value },
        searchTerms: [
          `${config.displayName} impairment`,
          "bilateral coordination",
          `${config.domain} dysfunction`,
        ],
        benchmarkCategory: "deficient",
      });
    }
  }

  // 4. Temporal patterns (if previous session)
  if (previousMetrics) {
    // Compare OPI scores
    if (metrics.opiScore && previousMetrics.opiScore) {
      const change = metrics.opiScore - previousMetrics.opiScore;
      if (Math.abs(change) >= 5) {
        // MCID for OPI
        patterns.push({
          id: generateId(),
          type: "temporal_pattern",
          metrics: ["opiScore"],
          severity: change > 0 ? "low" : "high",
          description: `OPI score ${change > 0 ? "improved" : "declined"} by ${Math.abs(change).toFixed(0)} points from previous session`,
          values: {
            current: metrics.opiScore,
            previous: previousMetrics.opiScore,
            change,
          },
          searchTerms: [
            `performance ${change > 0 ? "improvement" : "decline"}`,
            "rehabilitation progress",
            "longitudinal change",
          ],
        });
      }
    }
  }

  return patterns;
}
