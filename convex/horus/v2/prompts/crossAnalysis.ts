/**
 * Cross-Analysis Agent Prompts
 *
 * System and user prompts for analyzing patterns across
 * a patient's historical sessions.
 */

import type {
  CrossAnalysisContextWithClusters,
  ClusterWithSemantics,
  ClusterAnalysisContext,
} from "../../crossAnalysis/types";

// ─────────────────────────────────────────────────────────────────
// System Prompt
// ─────────────────────────────────────────────────────────────────

export const CROSS_ANALYSIS_SYSTEM_PROMPT = `You are an expert biomechanical analyst specializing in longitudinal patient progress assessment. You analyze patterns across multiple sessions to identify trends, recurring issues, and progress over time.

=== IMPORTANT: PATIENT FRAMING ===
ALWAYS refer to the subject as "the patient" - NEVER use "you" or "your".
Example: "The patient shows improving ROM over the last 5 sessions" NOT "You show improving ROM"

=== YOUR EXPERTISE ===
You excel at:
1. Identifying meaningful trends across sessions (not just noise)
2. Recognizing recurring patterns that persist across multiple sessions
3. Comparing current performance to personal baselines
4. Distinguishing clinically meaningful changes from normal variation
5. Synthesizing complex data into actionable insights

=== CLINICAL SIGNIFICANCE THRESHOLDS ===
Not all changes are meaningful. Use these guidelines:

TREND MAGNITUDE:
- Significant: >15% deviation from baseline or >0.03 slope per session
- Moderate: 10-15% deviation or 0.02-0.03 slope
- Slight: 5-10% deviation or 0.01-0.02 slope
- Noise: <5% deviation or <0.01 slope (don't report)

PATTERN CONFIDENCE:
- High: Pattern seen in 4+ sessions, consistent direction
- Moderate: Pattern seen in 3 sessions
- Low: Pattern seen in 2 sessions only

BASELINE COMPARISON:
- Notable: Current value differs >1.5 standard deviations from median
- Borderline: 1-1.5 standard deviations
- Within normal: <1 standard deviation

=== ANALYSIS ALGORITHM ===

STEP 1: Review the baseline context
- Note the number of sessions analyzed
- Identify which metrics have established trends
- Understand the patient's personal normal ranges

STEP 2: Compare current session to baseline
- Calculate deviations from median
- Flag metrics >1.5 std from baseline
- Consider whether deviations are improvements or concerns

STEP 3: Identify meaningful trends
- Focus on trends with clinical significance
- Ignore minor fluctuations (<5% change)
- Consider the direction and consistency of trends

STEP 4: Look for recurring patterns
- Patterns that appear in multiple sessions
- Persistent weaknesses that haven't improved
- Asymmetries that are resolving or worsening

STEP 5: Synthesize findings
- Connect related trends (e.g., improving ROM and velocity together)
- Identify the most important insights (max 5)
- Provide actionable context

=== OUTPUT REQUIREMENTS ===
- trendInsights: 2-5 meaningful trends, each with narrative and clinical relevance
- recurringPatterns: 0-3 patterns that persist across sessions
- baselineComparison: Overall assessment vs patient's personal baseline
- notableSessions: 1-3 sessions from history worth highlighting
- refinedInsights: Evaluated speculative insights from the Analysis Agent (see below)
- summary: 2-3 sentence overview of cross-analysis findings
- analysisConfidence: Based on data quality and session count

=== SPECULATIVE INSIGHTS EVALUATION ===
The Analysis Agent may provide speculative insights (hypotheses worth investigating).
Your task is to evaluate these against the patient's history and output refined insights:

EVALUATION PROCESS:
1. For each speculative insight, check if the patient's history supports or refutes it
2. Keep insights supported by history, modify those that need refinement, discard contradicted ones
3. Add NEW insights if cross-analysis reveals important patterns not in the original list

OUTPUT FORMAT for refinedInsights (use natural clinical language, NOT code parameters):
- title: Clear, descriptive title using physiotherapy terminology (e.g., "Left Knee Extension Weakness" not "leftPeakExtension")
- summary: 1-2 sentence summary visible at a glance - the key finding
- details: 2-4 sentences of additional context, clinical reasoning, and historical evidence
- iconHint: Suggest an icon category that best represents this insight:
  - "leg" for leg/limb specific findings
  - "balance" for symmetry/asymmetry findings
  - "speed" for velocity/power findings
  - "range" for ROM/flexibility findings
  - "trend" for improving/declining patterns
  - "warning" for concerns requiring attention
  - "strength" for muscle/power findings
  - "timing" for coordination/timing findings
  - "recovery" for rehabilitation progress

LANGUAGE GUIDELINES:
- Use natural physiotherapy language, NOT technical parameter names
- Say "range of motion" not "ROM" or "overallMaxROM"
- Say "movement speed" or "angular velocity" not "peakAngularVelocity"
- Say "left leg" not "leftLeg"
- Say "movement smoothness" not "sparc" or "ldlj"
- Describe findings as a physiotherapist would explain to a colleague

Maximum 5 refined insights total

=== CONFIDENCE LEVELS ===
Rate your analysis confidence based on the amount of historical data:
- high: 5+ prior sessions with consistent data quality - strong trend detection possible
- moderate: 3-4 prior sessions - reasonable pattern detection, some trends emerging
- low: 2 prior sessions - limited trend detection, focus on direct comparisons
- low: 1 prior session only - VERY LIMITED analysis, can only compare current vs previous session

IMPORTANT: When confidence is "low" due to limited sessions:
- Explicitly state in your summary how many sessions were analyzed
- Focus on direct session-to-session comparison rather than trends
- Recommend collecting more sessions for more accurate longitudinal analysis
- Avoid making strong claims about "patterns" or "trends" with minimal data
- For 1 prior session: Frame as "compared to the previous session" not "trending"

=== PERFORMANCE CLUSTER ANALYSIS ===
When cluster analysis data is provided, use it to understand the patient's performance patterns:

CLUSTER INTERPRETATION:
- Clusters represent distinct performance states (e.g., "High Performance", "Average", "Needs Improvement")
- Each cluster has percentile bands based on SIMILARITY to cluster centroid:
  - p90 = Most typical/regular sessions for that performance level
  - p50 = Median typicality
  - p10 = Outliers/unusual sessions within that cluster
- IMPORTANT: Percentiles represent TYPICALITY, not performance. Performance comes from MEDIAN METRICS.

HOW TO USE CLUSTER DATA:
1. Lead with performance description (from median metrics)
   ✓ "High performance days show excellent range of motion (125°) with minimal asymmetry (3%)"
   ✗ "p90 band sessions have avgMaxROM 125"

2. Add semantic context (what conditions lead to this performance)
   ✓ "These sessions typically occur in the morning, often after warmup exercises"
   ✗ "Tags: morning (0.6 frequency)"

3. Describe cluster migration trends
   ✓ "The patient has been spending 20% more time in the High Performance cluster over the past 2 months"
   ✗ "High Performance cluster membership slope: 0.05 per period"

4. Note data quality
   - Limited (2-5 sessions): "Patterns are preliminary and may shift with more data"
   - Moderate (6-9 sessions): "Emerging patterns with reasonable confidence"
   - Good (10+ sessions): "Well-established performance patterns"

CLUSTER MIGRATION PATTERNS:
- consistent_improvement: Steady movement to better performance clusters
- improving: General positive trend with some variation
- stable: Consistent performance level over time
- declining: Movement toward lower performance clusters
- volatile: Frequent shifts between clusters
- plateau: Performance leveled off after improvement

=== DO NOT ===
- Report insignificant trends (<5% change)
- Make claims not supported by the data
- Compare to population norms (only patient's personal baseline)
- Use "you" or "your" when referring to the patient
- Use technical parameter names (use natural physiotherapy language)
- Report raw percentile bands without explaining their meaning`;

// ─────────────────────────────────────────────────────────────────
// User Prompt Builder
// ─────────────────────────────────────────────────────────────────

/**
 * Format a date timestamp for display.
 */
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Format a cluster for display in the prompt.
 */
function formatCluster(cluster: ClusterWithSemantics): string {
  const lines: string[] = [];
  lines.push(`### ${cluster.label} (Cluster ${cluster.clusterId})`);

  // Format each percentile band
  for (const [bandKey, band] of Object.entries(cluster.bands)) {
    const bandLabel =
      bandKey === "p90" ? "Typical Sessions" : bandKey === "p50" ? "Median Sessions" : "Outlier Sessions";
    lines.push(`\n**${bandLabel}** (${band.sessionCount} sessions)`);

    // Median metrics (top 5 by importance)
    const metricsEntries = Object.entries(band.medianMetrics).slice(0, 5);
    if (metricsEntries.length > 0) {
      lines.push("Metrics:");
      for (const [key, m] of metricsEntries) {
        lines.push(`  - ${m.displayName}: ${m.value.toFixed(1)}${m.unit}`);
      }
    }

    // Semantic context
    if (band.semantics.tags.length > 0) {
      const topTags = band.semantics.tags
        .slice(0, 3)
        .map((t) => `${t.tag} (${(t.frequency * 100).toFixed(0)}%)`)
        .join(", ");
      lines.push(`Common tags: ${topTags}`);
    }

    if (band.semantics.noteExcerpts.length > 0) {
      lines.push(`Notes: "${band.semantics.noteExcerpts.slice(0, 2).join('", "')}"`);
    }

    if (band.semantics.keyFindings.length > 0) {
      lines.push(`Key findings: ${band.semantics.keyFindings.slice(0, 2).join("; ")}`);
    }
  }

  // Distinguishing features
  if (cluster.distinguishingFeatures.length > 0) {
    lines.push("\nDistinguishing features (typical vs outlier):");
    for (const f of cluster.distinguishingFeatures.slice(0, 3)) {
      lines.push(
        `  - ${f.feature}: ${(f.typicalFrequency * 100).toFixed(0)}% vs ${(f.outlierFrequency * 100).toFixed(0)}%`
      );
    }
  }

  return lines.join("\n");
}

/**
 * Format cluster analysis context for the prompt.
 */
function formatClusterAnalysis(clusterAnalysis: ClusterAnalysisContext): string {
  const lines: string[] = [];

  // Data quality note
  const qualityNote =
    clusterAnalysis.dataQuality === "limited"
      ? "⚠️ Limited data (patterns may be preliminary)"
      : clusterAnalysis.dataQuality === "moderate"
        ? "Moderate data (emerging patterns)"
        : "Good data (well-established patterns)";
  lines.push(`Data Quality: ${qualityNote} (${clusterAnalysis.totalSessions} sessions)`);

  // Current session cluster
  if (clusterAnalysis.currentSessionCluster) {
    const c = clusterAnalysis.currentSessionCluster;
    lines.push(
      `\nCurrent session falls into: **${c.label}** (${(c.similarity * 100).toFixed(0)}% similarity)`
    );
  }

  // Cluster details
  lines.push("\n## Performance Clusters");
  for (const cluster of clusterAnalysis.clusters) {
    lines.push("\n" + formatCluster(cluster));
  }

  // Cluster trends
  lines.push("\n## Cluster Migration Trends");
  lines.push(`Overall pattern: **${clusterAnalysis.trends.overallPattern.replace(/_/g, " ")}**`);
  lines.push(`Time in clusters:`);
  lines.push(`  - High Performance: ${(clusterAnalysis.trends.timeInHighPerformance * 100).toFixed(0)}%`);
  lines.push(`  - Medium Performance: ${(clusterAnalysis.trends.timeInMediumPerformance * 100).toFixed(0)}%`);
  lines.push(`  - Low Performance: ${(clusterAnalysis.trends.timeInLowPerformance * 100).toFixed(0)}%`);

  // Per-cluster trends
  const meaningfulTrends = Object.values(clusterAnalysis.trends.clusterTrends).filter(
    (t) => t.membershipTrend !== "stable" || Math.abs(t.slopePerPeriod) > 5
  );
  if (meaningfulTrends.length > 0) {
    lines.push("\nMembership changes:");
    for (const t of meaningfulTrends) {
      const direction = t.slopePerPeriod > 0 ? "+" : "";
      lines.push(`  - ${t.label}: ${t.membershipTrend} (${direction}${t.slopePerPeriod.toFixed(1)}% per month)`);
    }
  }

  return lines.join("\n");
}

/**
 * Build the user prompt from cross-analysis context.
 */
export function buildCrossAnalysisUserPrompt(context: CrossAnalysisContextWithClusters): string {
  const { currentSession, baseline, recentHistory, trends, similarSessions, speculativeInsights, clusterAnalysis } =
    context;

  // Current session section
  const currentMetricsText = Object.entries(currentSession.metrics)
    .map(([key, m]) => `- ${m.displayName}: ${m.value.toFixed(1)}${m.unit}`)
    .join("\n");

  // Baseline section
  const baselineMetricsText = Object.entries(baseline.metrics)
    .map(
      ([key, m]) =>
        `- ${key}: median=${m.median.toFixed(1)}, std=${m.std.toFixed(2)}, trend=${m.trend}`
    )
    .join("\n");

  // Recent history section
  const historyText =
    recentHistory.length > 0
      ? recentHistory
          .slice(0, 5)
          .map((s) => {
            const notable =
              s.notableMetrics.length > 0
                ? s.notableMetrics
                    .map(
                      (m) =>
                        `${m.displayName}: ${m.value.toFixed(1)}${m.unit} (${m.deviationFromBaseline > 0 ? "+" : ""}${m.deviationFromBaseline.toFixed(0)}% from baseline)`
                    )
                    .join(", ")
                : "no notable deviations";
            return `- ${formatDate(s.date)}: OPI=${s.opiScore.toFixed(0)}, ${notable}`;
          })
          .join("\n")
      : "No historical sessions available";

  // Trends section
  const trendsText =
    trends.length > 0
      ? trends
          .filter((t) => t.isClinicallyMeaningful)
          .map(
            (t) =>
              `- ${t.displayName}: ${t.direction} (${t.slopePerSession > 0 ? "+" : ""}${(t.slopePerSession * 100).toFixed(1)}% per session)`
          )
          .join("\n")
      : "Insufficient data for trend analysis";

  // Similar sessions section
  const similarText =
    similarSessions.length > 0
      ? similarSessions
          .slice(0, 3)
          .map((s) => `- ${formatDate(s.date)}: ${(s.similarity * 100).toFixed(0)}% similar`)
          .join("\n")
      : "No similar sessions found";

  // Speculative insights section
  const speculativeText =
    speculativeInsights && speculativeInsights.length > 0
      ? speculativeInsights
          .map((s, i) => `${i + 1}. "${s.label}": ${s.description}`)
          .join("\n")
      : null;

  return `=== CROSS-ANALYSIS TASK ===
Analyze this patient's current session in context of their historical performance.

=== CURRENT SESSION ===
Date: ${formatDate(currentSession.date)}
Session ID: ${currentSession.sessionId}
Tags: ${currentSession.tags.length > 0 ? currentSession.tags.join(", ") : "none"}
OPI Score: ${currentSession.opiScore.toFixed(0)}${currentSession.opiGrade ? ` (Grade ${currentSession.opiGrade})` : ""}

Current Metrics:
${currentMetricsText}

=== PATIENT BASELINE (${baseline.tagGroup === "_default" ? "all sessions" : baseline.tagGroup}) ===
Sessions analyzed: ${baseline.sessionCount}

Baseline Metrics (median ± std, with trend):
${baselineMetricsText}

=== RECENT SESSION HISTORY ===
${historyText}

=== ESTABLISHED TRENDS ===
${trendsText}

=== MOST SIMILAR PAST SESSIONS ===
${similarText}
${clusterAnalysis ? `
=== PERFORMANCE CLUSTER ANALYSIS ===
${formatClusterAnalysis(clusterAnalysis)}
` : ""}${speculativeText ? `
=== SPECULATIVE INSIGHTS TO EVALUATE ===
The Analysis Agent identified these hypotheses. Evaluate them against patient history:
${speculativeText}
` : ""}
=== YOUR TASK ===
Analyze this patient's progress by:
1. Comparing the current session to their personal baseline
2. Identifying meaningful trends (ignore noise <5% change)
3. Finding recurring patterns across sessions
4. Highlighting notable sessions from their history
5. If cluster analysis is provided: Explain which performance cluster the current session falls into and what conditions are associated with that performance level
6. If cluster analysis is provided: Describe the patient's progress across clusters over time
7. Evaluating any speculative insights against historical data
8. Providing a concise summary with clinical relevance

REMEMBER: Use "the patient" framing, focus on clinically meaningful changes, and only compare to their personal baseline (not population norms).

=== OUTPUT JSON SCHEMA ===
{
  "trendInsights": [
    {
      "id": "trend-1",
      "metricName": "romAsymmetry",
      "displayName": "ROM Asymmetry",
      "direction": "improving",
      "magnitude": "significant",
      "narrative": "The patient's ROM asymmetry has decreased from 18% to 8% over the last 5 sessions, indicating improving bilateral balance.",
      "currentValue": 8.2,
      "baselineValue": 15.3,
      "changePercent": -46.4,
      "clinicalRelevance": "This improvement suggests the patient's targeted unilateral exercises are effectively addressing the imbalance."
    }
  ],
  "recurringPatterns": [
    {
      "id": "pattern-1",
      "patternType": "asymmetry_resolving",
      "title": "Resolving Left Leg Weakness",
      "description": "The patient has shown consistent improvement in left leg metrics across 4 consecutive sessions.",
      "affectedMetrics": ["leftMaxROM", "leftPeakVelocity"],
      "sessionIds": ["session-1", "session-2", "session-3", "session-4"],
      "confidence": 0.85,
      "recommendation": "Continue current rehabilitation protocol as the patient is responding well."
    }
  ],
  "baselineComparison": {
    "overallAssessment": "The patient is performing slightly above their personal baseline, with notable improvements in symmetry metrics.",
    "comparedToBaseline": "above",
    "significantDeviations": [
      {
        "metricName": "romAsymmetry",
        "displayName": "ROM Asymmetry",
        "currentValue": 8.2,
        "baselineMedian": 15.3,
        "deviationPercent": -46.4,
        "direction": "below"
      }
    ]
  },
  "notableSessions": [
    {
      "sessionId": "session-5",
      "date": 1704067200000,
      "tags": ["squat", "power"],
      "opiScore": 82,
      "relation": "best_performance",
      "relevance": "This session from 2 weeks ago represents the patient's best performance, with OPI score 15% above baseline."
    }
  ],
  "refinedInsights": [
    {
      "title": "Left Leg Compensation Pattern",
      "summary": "The patient consistently generates more power with the left leg during explosive movements, suggesting compensation for right-side weakness.",
      "details": "This pattern has appeared in 4 of the last 5 sessions. The left leg peak velocity has been 15-20% higher than the right across sessions from December through January. This may indicate an unconscious protective mechanism or strength imbalance that warrants targeted rehabilitation.",
      "iconHint": "leg"
    },
    {
      "title": "Improving Fatigue Tolerance",
      "summary": "The patient's ability to maintain range of motion throughout sessions has improved, indicating better endurance.",
      "details": "Early sessions showed a 12% decline in range of motion by the end of each session, likely due to fatigue. Recent sessions show only a 5% decline, suggesting the patient's conditioning and fatigue management have improved significantly over the past month.",
      "iconHint": "recovery"
    }
  ],
  "summary": "The patient shows meaningful improvement in bilateral symmetry over the last 5 sessions, with ROM asymmetry decreasing by 46%. Current performance is above their personal baseline, suggesting the rehabilitation protocol is effective.",
  "analysisConfidence": "high"
}

Respond with ONLY the JSON object.`;
}

// ─────────────────────────────────────────────────────────────────
// Response Schema
// ─────────────────────────────────────────────────────────────────

/**
 * JSON Schema for Cross-Analysis Agent structured output.
 */
export const CROSS_ANALYSIS_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    trendInsights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          metricName: { type: "string" },
          displayName: { type: "string" },
          direction: { type: "string", enum: ["improving", "stable", "declining"] },
          magnitude: { type: "string", enum: ["significant", "moderate", "slight"] },
          narrative: { type: "string" },
          currentValue: { type: "number" },
          baselineValue: { type: "number" },
          changePercent: { type: "number" },
          clinicalRelevance: { type: "string" },
        },
        required: [
          "id",
          "metricName",
          "displayName",
          "direction",
          "magnitude",
          "narrative",
          "currentValue",
          "baselineValue",
          "changePercent",
          "clinicalRelevance",
        ],
      },
      minItems: 2,
      maxItems: 5,
    },
    recurringPatterns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          patternType: {
            type: "string",
            enum: [
              "consistent_weakness",
              "improving_metric",
              "declining_metric",
              "plateau",
              "asymmetry_persistent",
              "asymmetry_resolving",
            ],
          },
          title: { type: "string" },
          description: { type: "string" },
          affectedMetrics: { type: "array", items: { type: "string" } },
          sessionIds: { type: "array", items: { type: "string" } },
          confidence: { type: "number" },
          recommendation: { type: "string" },
        },
        required: [
          "id",
          "patternType",
          "title",
          "description",
          "affectedMetrics",
          "sessionIds",
          "confidence",
          "recommendation",
        ],
      },
      maxItems: 3,
    },
    baselineComparison: {
      type: "object",
      properties: {
        overallAssessment: { type: "string" },
        comparedToBaseline: { type: "string", enum: ["above", "at", "below"] },
        significantDeviations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              metricName: { type: "string" },
              displayName: { type: "string" },
              currentValue: { type: "number" },
              baselineMedian: { type: "number" },
              deviationPercent: { type: "number" },
              direction: { type: "string", enum: ["above", "below"] },
            },
            required: [
              "metricName",
              "displayName",
              "currentValue",
              "baselineMedian",
              "deviationPercent",
              "direction",
            ],
          },
        },
      },
      required: ["overallAssessment", "comparedToBaseline", "significantDeviations"],
    },
    notableSessions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          date: { type: "number" },
          tags: { type: "array", items: { type: "string" } },
          opiScore: { type: "number" },
          relation: {
            type: "string",
            enum: ["most_similar", "best_performance", "worst_performance"],
          },
          relevance: { type: "string" },
        },
        required: ["sessionId", "date", "tags", "opiScore", "relation", "relevance"],
      },
      maxItems: 3,
    },
    refinedInsights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Clear, descriptive title using physiotherapy terminology" },
          summary: { type: "string", description: "1-2 sentence key finding visible at a glance" },
          details: { type: "string", description: "2-4 sentences of additional context and historical evidence" },
          iconHint: {
            type: "string",
            enum: ["leg", "balance", "speed", "range", "trend", "warning", "strength", "timing", "recovery"],
            description: "Icon category that best represents this insight",
          },
        },
        required: ["title", "summary", "details", "iconHint"],
      },
      maxItems: 5,
    },
    summary: { type: "string" },
    analysisConfidence: { type: "string", enum: ["high", "moderate", "low"] },
  },
  required: [
    "trendInsights",
    "recurringPatterns",
    "baselineComparison",
    "notableSessions",
    "refinedInsights",
    "summary",
    "analysisConfidence",
  ],
};
