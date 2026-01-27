/**
 * Horus v2 Analysis Agent Prompts
 *
 * Expert clinical persona with Q&A reasoning format.
 */

import type { SessionMetrics } from "../../types";
import { METRIC_REGISTRY, METRICS_BY_DOMAIN, type MetricDomain } from "../../metrics";

// ─────────────────────────────────────────────────────────────────
// Dynamic Metric Reference Generation
// ─────────────────────────────────────────────────────────────────

const DOMAIN_LABELS: Record<MetricDomain, string> = {
  range: "RANGE METRICS",
  symmetry: "SYMMETRY METRICS",
  power: "POWER METRICS",
  control: "CONTROL METRICS",
  timing: "TIMING METRICS",
};

/**
 * Generate metric reference section from METRIC_REGISTRY.
 * Single source of truth for all threshold values.
 */
function generateMetricReferences(): string {
  const sections: string[] = [];

  for (const domain of Object.keys(METRICS_BY_DOMAIN) as MetricDomain[]) {
    const metrics = METRICS_BY_DOMAIN[domain];
    const lines: string[] = [`${DOMAIN_LABELS[domain]} (${domain === "symmetry" || domain === "timing" ? "bilateral" : "per leg"}):`];

    for (const metricName of metrics) {
      const config = METRIC_REGISTRY[metricName];
      const dirLabel = config.direction === "higherBetter" ? "higherBetter" : "lowerBetter";
      const goodOp = config.direction === "higherBetter" ? "≥" : "≤";
      const poorOp = config.direction === "higherBetter" ? "≤" : "≥";

      lines.push(
        `- ${metricName}: GOOD ${goodOp}${config.goodThreshold}${config.unit}, POOR ${poorOp}${config.poorThreshold}${config.unit} (${dirLabel})`
      );
    }

    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n");
}

const METRIC_REFERENCE_SECTION = generateMetricReferences();

// ─────────────────────────────────────────────────────────────────
// System Prompt
// ─────────────────────────────────────────────────────────────────

export const ANALYSIS_SYSTEM_PROMPT = `You are an expert biomechanical analyst and sports physiotherapist with 20+ years of clinical experience in rehabilitation, sports medicine, and movement analysis.

Your expertise includes:
- Bilateral movement assessment and asymmetry analysis
- Neuromuscular control and coordination evaluation
- Power generation and velocity analysis
- Movement quality and consistency assessment
- Clinical interpretation of biomechanical metrics

=== IMPORTANT: PATIENT FRAMING ===
ALWAYS refer to the subject as "the patient" - NEVER use "you" or "your".
Example: "The patient shows significant asymmetry..." NOT "You show significant asymmetry..."
This applies to ALL text outputs including narratives, explanations, and recommendations.

=== YOUR APPROACH ===
You think like a seasoned clinician:
1. You observe the raw data and identify what stands out
2. You reason through the clinical significance using Q&A format
3. You connect metrics to real-world functional implications
4. You prioritize findings by clinical relevance and assign priority scores
5. You explain how different joints contribute to patterns

=== SESSION CONTEXT (Tags, Notes, Exercise Type) ===
Pay close attention to the session metadata when provided:
- **Tags**: May describe the exercise type (e.g., "squat", "lunge", "rehab"), patient condition (e.g., "ACL", "post-op"), or training phase (e.g., "warmup", "max effort"). Use these to contextualize your analysis - a post-op patient has different expectations than an athlete.
- **Notes**: May contain clinician observations, patient complaints, or session goals. Look for correlations between noted issues and the metric findings.
- **Activity Profile**: Indicates the movement pattern being assessed. Tailor your interpretation to what's expected for that movement.
- **Sets/Reps**: Higher rep counts may explain fatigue-related findings (declining consistency, increased asymmetry toward end of session).

When analyzing, consider:
- Does the exercise type explain certain metric patterns? (e.g., single-leg exercises naturally show some asymmetry)
- Do the tags suggest injury history that correlates with the deficits found?
- Do the notes mention anything that explains or contradicts the metrics?

=== PRIORITY SCORING (1-10) ===
Assign a priority score to each section based on clinical importance:
- 10: Life/limb threatening, requires immediate action
- 8-9: Critical finding requiring urgent attention
- 6-7: Significant finding that should be addressed soon
- 4-5: Moderate finding to monitor and address
- 2-3: Minor finding for awareness
- 1: Incidental finding, low clinical significance

Priority considers: severity, functional impact, injury risk, and treatability.

=== CLINICAL THRESHOLDS & SEVERITY ===

Severity Levels (for each finding):
- profound: Most severe, life-altering or requires immediate medical attention, >35% asymmetry
- critical: Requires immediate attention, high injury risk, >25% asymmetry or severe deficits
- severe: Significant concern, active intervention needed, 15-25% asymmetry
- moderate: Notable finding, should be addressed, 10-15% asymmetry
- mild: Minor concern, monitor over time, <10% asymmetry

=== METRIC REFERENCE RANGES (Evidence-Based) ===

Use these thresholds to interpret each metric's clinical significance:

${METRIC_REFERENCE_SECTION}

INTERPRETING VALUES:
- Values beyond POOR threshold = critical/severe finding
- Values between GOOD and POOR = moderate finding
- Values at/beyond GOOD threshold = strength (mild if slightly off)
- Always check DIRECTION: some metrics are "lowerBetter" (closer to 0 = better)

=== RADAR SCORES (1-10 scale) ===
You MUST calculate each dimension based on the actual metrics provided:

- flexibility: Based on ROM metrics (overallMaxRom, averageRom, peakFlexion, peakExtension)
  * 10 = excellent ROM (>120° knee flexion), 1 = severely limited (<60°)

- consistency: Based on ROM Coefficient of Variation (romCoV)
  * 10 = very consistent (<5% CoV), 5 = moderate (10-15% CoV), 1 = highly variable (>20% CoV)

- symmetry: Based on asymmetry metrics (romAsymmetry, velocityAsymmetry, netGlobalAsymmetry)
  * 10 = perfect symmetry (<5%), 5 = moderate asymmetry (15%), 1 = severe asymmetry (>30%)

- smoothness: Based on RMS Jerk values (lower = smoother)
  * 10 = very smooth (low jerk), 5 = moderate, 1 = jerky/erratic (high jerk)

- control: Based on timing metrics (temporalLag, phaseShift, crossCorrelation, maxFlexionTimingDiff)
  * 10 = excellent coordination (low lag, high correlation), 1 = poor coordination

IMPORTANT: Calculate these scores from the ACTUAL metric values - do NOT use default values like 5.

=== SPECULATIVE INSIGHTS (REQUIRED) ===
After your clinical analysis, you MUST step back and identify 1-3 interesting, non-obvious patterns.
This section is MANDATORY - do not skip it. Think creatively about:
- Unusual metric combinations that might indicate something unexpected
- Correlations between session context (tags, notes) and findings that suggest deeper issues
- Patterns that don't fit typical presentations - what could explain them?
- Hypotheses about underlying causes that warrant further investigation
- Connections to broader movement patterns or compensatory strategies

These insights are explicitly SPECULATIVE - they go beyond standard clinical interpretation.
Be creative but grounded in the data. Frame as hypotheses, not conclusions.

EXAMPLE SPECULATIVE INSIGHTS:
- "The combination of high velocity asymmetry (18%) with good ROM symmetry (4%) could suggest a neuromuscular timing issue rather than a structural limitation - the patient may have full range but impaired rate of force development on the left side."
- "The patient's high jerk values despite good ROM could indicate protective guarding behavior - possibly compensating for instability or pain not captured in the primary metrics."
- "Given the tags mention 'post-ACL', the disproportionate loading phase deficit compared to concentric phase might reflect lingering quadriceps inhibition typical of ACL reconstruction patients."

=== OUTPUT FORMAT ===
You MUST respond with valid JSON containing:
1. Radar scores for visual summary
2. Key findings as bullet points
3. Clinical implications summary
4. Clinical sections with severity ratings
5. Unified recommendations (not per-section)
6. Strengths and weaknesses
7. Speculative insights (interesting patterns and hypotheses)

=== CONCISENESS REQUIREMENTS ===
Keep responses focused and concise to avoid truncation:
- clinicalNarrative: 2-4 sentences max per section
- recommendations: 1 sentence each, max 5 total
- keyFindings: 3-5 findings, 1-2 sentences each
- speculativeInsights: 2-3 insights, 2-3 sentences each
- Avoid repetition - each section should add NEW information
- Focus on SIGNIFICANT findings only - skip minor observations`;

// ─────────────────────────────────────────────────────────────────
// User Prompt Builder
// ─────────────────────────────────────────────────────────────────

/**
 * Format session context for LLM consumption (only includes available data).
 */
function formatSessionContext(metrics: SessionMetrics): string {
  const parts: string[] = [];

  if (metrics.title) {
    parts.push(`Exercise: ${metrics.title}`);
  }
  if (metrics.activityProfile) {
    parts.push(`Activity Profile: ${metrics.activityProfile}`);
  }
  if (metrics.tags && metrics.tags.length > 0) {
    parts.push(`Tags: ${metrics.tags.join(", ")}`);
  }
  if (metrics.sets !== undefined || metrics.reps !== undefined) {
    const setsReps = [
      metrics.sets !== undefined ? `Sets: ${metrics.sets}` : null,
      metrics.reps !== undefined ? `Reps: ${metrics.reps}` : null,
    ].filter(Boolean).join(" | ");
    parts.push(setsReps);
  }
  if (metrics.notes) {
    parts.push(`Notes: ${metrics.notes}`);
  }

  if (parts.length === 0) {
    return "";
  }

  return `
=== SESSION CONTEXT ===
${parts.join("\n")}
`;
}

/**
 * Format metrics for LLM consumption.
 */
function formatMetricsForPrompt(metrics: SessionMetrics): string {
  const { leftLeg, rightLeg, bilateral, movementType } = metrics;

  // Build session context section (only if data exists)
  const contextSection = formatSessionContext(metrics);

  return `
=== SESSION METRICS ===
Movement Type: ${movementType}
${contextSection}
=== LEFT LEG METRICS ===
- Overall Max ROM: ${leftLeg.overallMaxRom.toFixed(1)}°
- Average ROM: ${leftLeg.averageRom.toFixed(1)}°
- Peak Flexion: ${leftLeg.peakFlexion.toFixed(1)}°
- Peak Extension: ${leftLeg.peakExtension.toFixed(1)}°
- Peak Angular Velocity: ${leftLeg.peakAngularVelocity.toFixed(1)}°/s
- Explosiveness (Loading): ${leftLeg.explosivenessLoading.toFixed(1)}°/s
- Explosiveness (Concentric): ${leftLeg.explosivenessConcentric.toFixed(1)}°/s
- RMS Jerk (Smoothness): ${leftLeg.rmsJerk.toFixed(2)}°/s³
- ROM Coefficient of Variation: ${leftLeg.romCoV.toFixed(1)}%

=== RIGHT LEG METRICS ===
- Overall Max ROM: ${rightLeg.overallMaxRom.toFixed(1)}°
- Average ROM: ${rightLeg.averageRom.toFixed(1)}°
- Peak Flexion: ${rightLeg.peakFlexion.toFixed(1)}°
- Peak Extension: ${rightLeg.peakExtension.toFixed(1)}°
- Peak Angular Velocity: ${rightLeg.peakAngularVelocity.toFixed(1)}°/s
- Explosiveness (Loading): ${rightLeg.explosivenessLoading.toFixed(1)}°/s
- Explosiveness (Concentric): ${rightLeg.explosivenessConcentric.toFixed(1)}°/s
- RMS Jerk (Smoothness): ${rightLeg.rmsJerk.toFixed(2)}°/s³
- ROM Coefficient of Variation: ${rightLeg.romCoV.toFixed(1)}%

=== BILATERAL ANALYSIS ===
- ROM Asymmetry: ${bilateral.romAsymmetry.toFixed(1)}%
- Velocity Asymmetry: ${bilateral.velocityAsymmetry.toFixed(1)}%
- Cross-Correlation: ${bilateral.crossCorrelation.toFixed(3)}
- Real Asymmetry Average: ${bilateral.realAsymmetryAvg.toFixed(1)}%
- Net Global Asymmetry: ${bilateral.netGlobalAsymmetry.toFixed(1)}%
- Phase Shift: ${bilateral.phaseShift.toFixed(1)}°
- Temporal Lag: ${bilateral.temporalLag.toFixed(1)}ms
- Max Flexion Timing Difference: ${bilateral.maxFlexionTimingDiff.toFixed(1)}ms`;
}

/**
 * Build the user prompt for the Analysis Agent.
 */
export function buildAnalysisUserPrompt(metrics: SessionMetrics): string {
  const formattedMetrics = formatMetricsForPrompt(metrics);

  return `${formattedMetrics}

=== YOUR TASK ===
Analyze these biomechanical metrics and generate a comprehensive clinical report.

REMEMBER: Always use "the patient" - never "you" or "your".

For each section:
1. Identify a clinically relevant finding from the data
2. Assign a severity level (critical/severe/moderate/mild)
3. Write a clear clinical narrative explaining what the patient shows
4. Use Q&A format to show your reasoning
5. List the specific metrics that support this finding
6. Generate 2-3 search queries for research validation
7. Provide initial recommendations (these will be refined later)

DOMAINS to consider (use standard or create custom as needed):
- range: ROM limitations, flexibility issues
- power: Velocity deficits, explosiveness issues
- control: Smoothness, consistency, motor control
- symmetry: Bilateral asymmetries, compensations
- timing: Temporal coordination, phase issues

=== OUTPUT JSON SCHEMA ===
{
  "overallGrade": "C",
  "radarScores": {
    "flexibility": 7,
    "consistency": 4,
    "symmetry": 3,
    "smoothness": 5,
    "control": 6
  },
  "keyFindings": [
    {
      "text": "Overall Grade",
      "severity": "severe",
      "viz": { "type": "grade", "value": "C", "scale": ["A", "B", "C", "D", "F"] }
    },
    {
      "text": "Global Asymmetry: 33.3%",
      "severity": "critical",
      "viz": { "type": "gauge", "value": 33.3, "max": 100, "unit": "%", "thresholds": [10, 20, 30] }
    },
    {
      "text": "ROM Asymmetry: favoring right leg",
      "severity": "profound",
      "viz": { "type": "comparison", "left": 65, "right": 110, "unit": "°", "labels": ["Left", "Right"] }
    },
    {
      "text": "Movement Consistency: High variability",
      "severity": "critical",
      "viz": { "type": "gauge", "value": 69, "max": 100, "unit": "% CoV", "thresholds": [10, 20, 30] }
    },
    {
      "text": "Risk Level: High injury risk",
      "severity": "critical",
      "viz": { "type": "level", "value": "high", "scale": ["low", "moderate", "high", "critical"] }
    }
  ],
  "clinicalImplications": "The patient presents with significant bilateral deficits indicating high injury risk and need for immediate intervention.",
  "sections": [
    {
      "id": "section-1",
      "title": "Concise title for the finding",
      "domain": "symmetry | power | control | range | timing | <custom>",
      "severity": "profound | critical | severe | moderate | mild",
      "priority": 8,
      "clinicalNarrative": "The patient shows [finding]. This indicates...",
      "jointContributions": {
        "Left Knee": "How left knee contributes to this finding",
        "Right Knee": "How right knee contributes to this finding"
      },
      "qaReasoning": [
        {
          "question": "What pattern is observed in the data?",
          "answer": "The patient demonstrates... (detailed clinical reasoning)"
        },
        {
          "question": "What is the functional impact?",
          "answer": "This affects the patient's ability to..."
        }
      ],
      "metricContributions": [
        {
          "metric": "bilateral.romAsymmetry",
          "value": 18.5,
          "unit": "%",
          "role": "Primary indicator of bilateral imbalance",
          "type": "computed"
        }
      ],
      "searchQueries": [
        "knee ROM asymmetry rehabilitation evidence",
        "bilateral lower limb asymmetry clinical significance"
      ],
      "recommendations": [
        "Focus on improving ROM in the deficit limb"
      ],
      "needsResearch": true
    }
  ],
  "summary": "Overall clinical summary highlighting the key findings and their interconnection for the patient.",
  "strengths": ["List of identified strengths from the metrics"],
  "weaknesses": ["List of identified weaknesses or areas needing attention"],
  "recommendations": [
    "Prioritized recommendation 1 for the patient",
    "Prioritized recommendation 2 for the patient",
    "Prioritized recommendation 3 for the patient"
  ],
  "speculativeInsights": [
    {
      "label": "Neuromuscular Timing Hypothesis",
      "description": "The high velocity asymmetry with good ROM symmetry suggests a neuromuscular timing issue rather than structural limitation."
    },
    {
      "label": "Compensatory Pattern",
      "description": "Given the session tags indicate post-op status, the asymmetry pattern could reflect a learned compensatory movement strategy."
    }
  ]
}

IMPORTANT:
- ALWAYS use "the patient" framing, NEVER "you" or "your"
- overallGrade: Assign a letter grade (A/B/C/D/F) based on overall movement quality:
  * A: Excellent - all metrics in good range, minimal asymmetry (<5%), strong performance
  * B: Good - most metrics acceptable, minor issues, asymmetry <10%
  * C: Fair - moderate deficits, some metrics in poor range, asymmetry 10-15%
  * D: Poor - significant deficits, multiple metrics in poor range, asymmetry 15-25%
  * F: Failing - severe deficits, critical findings, asymmetry >25% or safety concerns
- Generate 3-6 sections covering the most clinically relevant findings
- Assign appropriate severity to each section based on clinical thresholds
- Assign priority score (1-10) to each section based on clinical importance
- Score radar dimensions 1-10 based on the actual metrics
- keyFindings should be 4-6 concise findings, each with a visualization:
  - FIRST finding MUST be "Overall Grade" with type "grade" showing the letter grade (A/B/C/D/F)
  - "gauge": for percentages/scores (value, max, unit, thresholds array for color bands)
  - "comparison": for left vs right comparisons (left, right, unit, labels)
  - "grade": for letter grades (value like "F", scale like ["A","B","C","D","F"])
  - "level": for categorical levels (value like "high", scale like ["low","moderate","high","critical"])
- clinicalImplications should be 1-2 sentences
- recommendations at root level should be 3-5 prioritized action items
- IMPORTANT: Set needsResearch: true for ALL sections - every clinical finding benefits from research-backed evidence validation
- Use actual values from the provided metrics
- speculativeInsights: MUST include 1-3 creative hypotheses as objects with "label" (short 2-5 word title) and "description" (1-2 sentence explanation). Look for unusual metric combinations, patterns that don't fit typical presentations, or connections between session context and findings.

Respond with ONLY the JSON object, no additional text.`;
}

// ─────────────────────────────────────────────────────────────────
// Response Schema for Vertex AI
// ─────────────────────────────────────────────────────────────────

/**
 * JSON Schema for Analysis Agent structured output.
 */
export const ANALYSIS_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    overallGrade: { type: "string", enum: ["A", "B", "C", "D", "F"] },
    radarScores: {
      type: "object",
      properties: {
        flexibility: { type: "number" },
        consistency: { type: "number" },
        symmetry: { type: "number" },
        smoothness: { type: "number" },
        control: { type: "number" },
      },
      required: ["flexibility", "consistency", "symmetry", "smoothness", "control"],
    },
    keyFindings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          severity: { type: "string", enum: ["critical", "severe", "moderate", "mild", "profound"] },
          viz: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["gauge", "comparison", "grade", "level"] },
              value: {}, // can be string or number
              max: { type: "number" },
              unit: { type: "string" },
              thresholds: { type: "array", items: { type: "number" } },
              scale: { type: "array", items: { type: "string" } },
              left: { type: "number" },
              right: { type: "number" },
              labels: { type: "array", items: { type: "string" } },
            },
            required: ["type"],
          },
        },
        required: ["text", "severity", "viz"],
      },
    },
    clinicalImplications: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          domain: { type: "string" },
          severity: { type: "string", enum: ["profound", "critical", "severe", "moderate", "mild"] },
          priority: { type: "number" },
          clinicalNarrative: { type: "string" },
          jointContributions: {
            type: "object",
            additionalProperties: { type: "string" },
          },
          qaReasoning: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                answer: { type: "string" },
              },
              required: ["question", "answer"],
            },
          },
          metricContributions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                metric: { type: "string" },
                value: { type: "number" },
                unit: { type: "string" },
                role: { type: "string" },
                type: { type: "string" },
                context: { type: "string" },
              },
              required: ["metric", "value", "unit", "role"],
            },
          },
          searchQueries: {
            type: "array",
            items: { type: "string" },
          },
          recommendations: {
            type: "array",
            items: { type: "string" },
          },
          needsResearch: { type: "boolean" },
          additionalData: { type: "object" },
        },
        required: [
          "id",
          "title",
          "domain",
          "severity",
          "priority",
          "clinicalNarrative",
          "jointContributions",
          "qaReasoning",
          "metricContributions",
          "searchQueries",
          "recommendations",
          "needsResearch",
        ],
      },
    },
    summary: { type: "string" },
    strengths: {
      type: "array",
      items: { type: "string" },
    },
    weaknesses: {
      type: "array",
      items: { type: "string" },
    },
    recommendations: {
      type: "array",
      items: { type: "string" },
    },
    speculativeInsights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Short 2-5 word title for the hypothesis" },
          description: { type: "string", description: "1-2 sentence explanation of the hypothesis" },
        },
        required: ["label", "description"],
      },
      minItems: 1,
      description: "REQUIRED: 1-3 creative hypotheses about non-obvious patterns with label and description.",
    },
  },
  required: ["overallGrade", "radarScores", "keyFindings", "clinicalImplications", "sections", "summary", "strengths", "weaknesses", "recommendations", "speculativeInsights"],
};
