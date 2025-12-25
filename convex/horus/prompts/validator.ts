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
  NUMERICAL_TOLERANCE: 0.5, // Allow 0.5 unit difference
  MIN_CORRELATIVE_INSIGHTS: 2,
  REQUIRED_LIMB_TERMS: ["Left Leg", "Right Leg"],
  FORBIDDEN_LIMB_TERMS: ["left", "right", "L", "R", "affected", "involved", "weak side"],
  MIN_EVIDENCE_PER_INSIGHT: 1,
  MAX_REVISIONS: 3,
};

// ─────────────────────────────────────────────────────────────────
// System Prompt
// ─────────────────────────────────────────────────────────────────

export const VALIDATOR_SYSTEM_PROMPT = `You are a quality assurance validator for the Horus biomechanics analysis pipeline.

Your role is to verify the Analysis Agent's output is accurate, complete, and safe before saving.

## Validation Rules

### 1. Numerical Accuracy
- Values in insights must match source metrics within ${VALIDATION_RULES.NUMERICAL_TOLERANCE} units
- Percentiles must be correctly calculated
- Asymmetry values must match bilateral metrics

### 2. Side Specificity (CRITICAL)
- ONLY "Left Leg" or "Right Leg" are allowed
- REJECT: "left", "right", "L", "R", "affected", "involved", "weak side"
- Check: insight content, titles, recommendations

### 3. Classification Completeness
- Every insight MUST have classification: "strength" or "weakness"
- No neutral classifications allowed
- Verify percentile tiebreaker logic (≥55 = strength)

### 4. Evidence Support
- Each insight must have at least ${VALIDATION_RULES.MIN_EVIDENCE_PER_INSIGHT} evidence citation
- Evidence should relate to the insight's claims

### 5. Clinical Safety
- No diagnosis statements (we assess, not diagnose)
- No treatment prescriptions (suggest, not prescribe)
- Recommendations should be general, not specific medical advice

### 6. Correlative Insights
- Minimum ${VALIDATION_RULES.MIN_CORRELATIVE_INSIGHTS} correlative insights required
- Referenced insight IDs must exist

## Output Format

{
  "passed": boolean,
  "issues": [
    {
      "ruleType": "numerical_accuracy" | "side_specificity" | "classification_completeness" | "evidence_support" | "clinical_safety",
      "severity": "error" | "warning",
      "insightIds": ["insight-1"],
      "description": "What is wrong",
      "suggestedFix": "How to fix it"
    }
  ],
  "errorCount": number,
  "warningCount": number
}

## Pass/Fail Criteria

- **PASS**: Zero errors (warnings allowed)
- **FAIL**: One or more errors → Analysis Agent must revise

## Important

After ${VALIDATION_RULES.MAX_REVISIONS} failed attempts, accept with warnings and flag for human review.`;

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
## Validation Checklist

1. [ ] Numerical values match source metrics (±${VALIDATION_RULES.NUMERICAL_TOLERANCE})
2. [ ] Side specificity uses only "Left Leg" / "Right Leg"
3. [ ] All insights have classification (strength/weakness)
4. [ ] Each insight has at least ${VALIDATION_RULES.MIN_EVIDENCE_PER_INSIGHT} evidence citation
5. [ ] No diagnosis or treatment prescriptions
6. [ ] At least ${VALIDATION_RULES.MIN_CORRELATIVE_INSIGHTS} correlative insights
7. [ ] All referenced insight IDs exist

Return validation result as JSON.`);

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
 * Catches obvious issues immediately.
 */
export function programmaticValidation(
  analysis: AnalysisOutput,
  metrics: SessionMetrics
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Check side specificity in all text fields
  for (const insight of analysis.insights) {
    const textToCheck = `${insight.title} ${insight.content} ${insight.recommendations?.join(" ") || ""}`;

    for (const forbidden of VALIDATION_RULES.FORBIDDEN_LIMB_TERMS) {
      // Case-insensitive check for standalone words
      const regex = new RegExp(`\\b${forbidden}\\b`, "i");
      if (regex.test(textToCheck)) {
        issues.push({
          ruleType: "side_specificity",
          severity: "error",
          insightIds: [insight.id],
          description: `Found forbidden term "${forbidden}" in insight. Use "Left Leg" or "Right Leg" instead.`,
          suggestedFix: `Replace "${forbidden}" with "Left Leg" or "Right Leg"`,
        });
      }
    }
  }

  // 2. Check classification completeness
  for (const insight of analysis.insights) {
    if (!insight.classification || !["strength", "weakness"].includes(insight.classification)) {
      issues.push({
        ruleType: "classification_completeness",
        severity: "error",
        insightIds: [insight.id],
        description: `Insight missing or invalid classification: "${insight.classification}"`,
        suggestedFix: 'Set classification to "strength" or "weakness"',
      });
    }
  }

  // 3. Check evidence support
  for (const insight of analysis.insights) {
    if (!insight.evidence || insight.evidence.length < VALIDATION_RULES.MIN_EVIDENCE_PER_INSIGHT) {
      issues.push({
        ruleType: "evidence_support",
        severity: "error",
        insightIds: [insight.id],
        description: `Insight has ${insight.evidence?.length || 0} evidence citations, minimum is ${VALIDATION_RULES.MIN_EVIDENCE_PER_INSIGHT}`,
        suggestedFix: "Add at least one evidence citation",
      });
    }
  }

  // 4. Check correlative insights count
  if (analysis.correlativeInsights.length < VALIDATION_RULES.MIN_CORRELATIVE_INSIGHTS) {
    issues.push({
      ruleType: "evidence_support",
      severity: "error",
      insightIds: [],
      description: `Only ${analysis.correlativeInsights.length} correlative insights, minimum is ${VALIDATION_RULES.MIN_CORRELATIVE_INSIGHTS}`,
      suggestedFix: "Add more correlative insights showing relationships between findings",
    });
  }

  // 5. Verify correlative insight references
  const insightIds = new Set(analysis.insights.map((i) => i.id));
  for (const corr of analysis.correlativeInsights) {
    if (!insightIds.has(corr.primaryInsightId)) {
      issues.push({
        ruleType: "evidence_support",
        severity: "error",
        insightIds: [corr.id],
        description: `Correlative insight references non-existent primary insight: ${corr.primaryInsightId}`,
        suggestedFix: "Fix the primaryInsightId to reference an existing insight",
      });
    }
    for (const relatedId of corr.relatedInsightIds) {
      if (!insightIds.has(relatedId)) {
        issues.push({
          ruleType: "evidence_support",
          severity: "warning",
          insightIds: [corr.id],
          description: `Correlative insight references non-existent related insight: ${relatedId}`,
          suggestedFix: "Fix the relatedInsightIds to reference existing insights",
        });
      }
    }
  }

  // 6. Check for clinical safety issues
  const unsafePatterns = [
    { pattern: /\bdiagnos(e|is|ed)\b/i, term: "diagnosis" },
    { pattern: /\bprescrib(e|ed|ing)\b/i, term: "prescription" },
    { pattern: /\btreat(ment)?\b/i, term: "treatment" },
    { pattern: /\b(must|should) (see|visit|consult) (a )?(doctor|physician|specialist)\b/i, term: "medical referral" },
  ];

  for (const insight of analysis.insights) {
    const textToCheck = `${insight.content} ${insight.recommendations?.join(" ") || ""}`;
    for (const { pattern, term } of unsafePatterns) {
      if (pattern.test(textToCheck)) {
        issues.push({
          ruleType: "clinical_safety",
          severity: "warning",
          insightIds: [insight.id],
          description: `Insight contains potential ${term} language`,
          suggestedFix: "Use assessment language instead of diagnostic/prescriptive terms",
        });
      }
    }
  }

  return issues;
}
