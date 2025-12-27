/**
 * Validator Agent Prompt
 *
 * Purpose: Verify accuracy of Analysis Agent output before saving.
 * Checks numerical accuracy, side specificity, classification completeness,
 * evidence support, and clinical safety.
 */

import { METRIC_REGISTRY, calculatePercentile, getBenchmarkCategory } from "../metrics";
import type {
  AnalysisOutput,
  SessionMetrics,
  DetectedPattern,
  ValidatorOutput,
  ValidationIssue,
} from "../types";

// ─────────────────────────────────────────────────────────────────
// Validation Rules
// ─────────────────────────────────────────────────────────────────

export const VALIDATION_RULES = {
  NUMERICAL_TOLERANCE: 2.0, // Allow 2 unit difference for rounding
  MAX_REVISIONS: 3,
};

// ─────────────────────────────────────────────────────────────────
// System Prompt
// ─────────────────────────────────────────────────────────────────

export const VALIDATOR_SYSTEM_PROMPT = `You validate biomechanics analysis for clinical accuracy.

Check for these issues only:

1. **metric_accuracy**: Numbers cited differ significantly from source metrics (>${VALIDATION_RULES.NUMERICAL_TOLERANCE} units off)
2. **hallucination**: Claims about data that doesn't exist, or made-up citations
3. **clinical_safety**: Diagnosis/prescription language instead of assessment language
4. **internal_consistency**: Contradictory statements within the analysis

Output JSON:
{
  "passed": boolean,
  "issues": [{ "ruleType": string, "severity": "error"|"warning", "insightIds": string[], "description": string, "suggestedFix": string }]
}

Pass unless there are significant accuracy or safety issues.`;

// ─────────────────────────────────────────────────────────────────
// User Prompt Builder
// ─────────────────────────────────────────────────────────────────

export function buildValidatorUserPrompt(
  analysis: AnalysisOutput,
  metrics: SessionMetrics,
  patterns: DetectedPattern[],
  revisionNumber: number
): string {
  const sections: string[] = [];

  sections.push(`# Validation Request

Validate the following analysis output (revision ${revisionNumber}/${VALIDATION_RULES.MAX_REVISIONS}).

**Session ID**: ${analysis.sessionId}`);

  // Analysis output to validate
  sections.push(`
## Analysis Output to Validate

### Summary
${analysis.summary}

### Strengths
${analysis.strengths.map((s, i) => `${i + 1}. ${s}`).join("\n")}

### Weaknesses
${analysis.weaknesses.map((w, i) => `${i + 1}. ${w}`).join("\n")}

### Insights (${analysis.insights.length})
${analysis.insights
  .map(
    (ins) => `
#### ${ins.id} - ${ins.title}
- **Domain**: ${ins.domain}
- **Classification**: ${ins.classification}
- **Limbs**: ${ins.limbs?.join(", ") || "N/A"}
- **Content**: ${ins.content}
- **Evidence**: ${ins.evidence.join("; ")}
- **Percentile**: ${ins.percentile ?? "Not provided"}`
  )
  .join("\n")}

### Correlative Insights (${analysis.correlativeInsights.length})
${analysis.correlativeInsights
  .map(
    (c) =>
      `- ${c.id}: ${c.primaryInsightId} ↔ ${c.relatedInsightIds.join(", ")} (${c.significance})`
  )
  .join("\n")}

### Benchmarks (${analysis.benchmarks.length})
${analysis.benchmarks
  .slice(0, 10)
  .map(
    (b) =>
      `- ${b.displayName}${b.limb ? ` (${b.limb})` : ""}: ${b.value} → ${b.percentile}th pct → ${b.classification}`
  )
  .join("\n")}
${analysis.benchmarks.length > 10 ? `... and ${analysis.benchmarks.length - 10} more` : ""}`);

  // Source metrics for verification
  sections.push(`
## Source Metrics (for verification)

### Left Leg
${Object.entries(metrics.leftLeg)
  .map(([k, v]) => {
    const config = METRIC_REGISTRY[k];
    return config ? `- ${config.displayName}: ${v.toFixed(1)}${config.unit}` : null;
  })
  .filter(Boolean)
  .join("\n")}

### Right Leg
${Object.entries(metrics.rightLeg)
  .map(([k, v]) => {
    const config = METRIC_REGISTRY[k];
    return config ? `- ${config.displayName}: ${v.toFixed(1)}${config.unit}` : null;
  })
  .filter(Boolean)
  .join("\n")}

### Bilateral
${Object.entries(metrics.bilateral)
  .map(([k, v]) => {
    const config = METRIC_REGISTRY[k];
    return config ? `- ${config.displayName}: ${v.toFixed(2)}${config.unit}` : null;
  })
  .filter(Boolean)
  .join("\n")}`);

  sections.push(`
Validate and return JSON.`);

  return sections.join("\n");
}

// ─────────────────────────────────────────────────────────────────
// Response Parser
// ─────────────────────────────────────────────────────────────────

export function parseValidatorResponse(
  sessionId: string,
  responseText: string,
  revisionNumber: number,
  analysis: AnalysisOutput
): ValidatorOutput {
  // Extract JSON
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : responseText.trim();

  const parsed = JSON.parse(jsonStr);

  const issues: ValidationIssue[] = (parsed.issues || []).map(
    (i: Record<string, unknown>) => ({
      ruleType: i.ruleType as ValidationIssue["ruleType"],
      severity: (i.severity as "error" | "warning") || "warning",
      insightIds: Array.isArray(i.insightIds) ? (i.insightIds as string[]) : [],
      description: (i.description as string) || "",
      suggestedFix: (i.suggestedFix as string) || "",
    })
  );

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const passed = errorCount === 0;

  return {
    sessionId,
    passed,
    issues,
    errorCount,
    warningCount,
    revisionNumber,
    validatedAnalysis: passed ? analysis : undefined,
    validatedAt: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────
// Programmatic Validation (Pre-LLM Check)
// ─────────────────────────────────────────────────────────────────

/**
 * Run programmatic validation before LLM call.
 * Only catches critical issues - NOT formatting.
 */
export function programmaticValidation(
  analysis: AnalysisOutput,
  metrics: SessionMetrics
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Check classification completeness (required field)
  for (const insight of analysis.insights) {
    if (!insight.classification || !["strength", "weakness"].includes(insight.classification)) {
      issues.push({
        ruleType: "internal_consistency",
        severity: "error",
        insightIds: [insight.id],
        description: `Insight missing classification`,
        suggestedFix: 'Set classification to "strength" or "weakness"',
      });
    }
  }

  // 2. Verify correlative insight references exist
  const insightIds = new Set(analysis.insights.map((i) => i.id));
  for (const corr of analysis.correlativeInsights) {
    if (!insightIds.has(corr.primaryInsightId)) {
      issues.push({
        ruleType: "internal_consistency",
        severity: "warning",
        insightIds: [corr.id],
        description: `Correlative insight references non-existent insight: ${corr.primaryInsightId}`,
        suggestedFix: "Fix the insight ID reference",
      });
    }
  }

  // 3. Check for critical clinical safety issues only
  const dangerousPatterns = [
    { pattern: /\b(diagnose|diagnosis)\b/i, term: "diagnosis" },
    { pattern: /\bprescrib(e|ed|ing)\s+(medication|drug|medicine)/i, term: "medication prescription" },
  ];

  for (const insight of analysis.insights) {
    const textToCheck = `${insight.content} ${insight.recommendations?.join(" ") || ""}`;
    for (const { pattern, term } of dangerousPatterns) {
      if (pattern.test(textToCheck)) {
        issues.push({
          ruleType: "clinical_safety",
          severity: "warning",
          insightIds: [insight.id],
          description: `Contains ${term} language - use assessment terms instead`,
          suggestedFix: "Rephrase to avoid diagnostic language",
        });
      }
    }
  }

  return issues;
}
