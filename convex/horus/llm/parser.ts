/**
 * Structured Output Parser
 *
 * Validates and transforms LLM responses into typed objects.
 * Uses Zod-like validation without the dependency.
 */

import type {
  DecompositionOutput,
  ResearchOutput,
  AnalysisOutput,
  ValidatorOutput,
  ProgressOutput,
} from "../types";

// ─────────────────────────────────────────────────────────────────
// Parse Result Type
// ─────────────────────────────────────────────────────────────────

export interface ParseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  rawResponse: string;
}

// ─────────────────────────────────────────────────────────────────
// JSON Extraction
// ─────────────────────────────────────────────────────────────────

/**
 * Extract JSON from LLM response.
 * Handles markdown code blocks, raw JSON, and partial responses.
 */
export function extractJSON(responseText: string): string {
  // Try markdown code block first (```json ... ``` or ``` ... ```)
  const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find JSON object directly
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  // Return as-is if nothing found
  return responseText.trim();
}

/**
 * Safely parse JSON with error handling.
 */
export function safeJSONParse<T>(jsonStr: string): ParseResult<T> {
  try {
    const data = JSON.parse(jsonStr) as T;
    return { success: true, data, rawResponse: jsonStr };
  } catch (error) {
    return {
      success: false,
      error: `JSON parse error: ${error instanceof Error ? error.message : "Unknown error"}`,
      rawResponse: jsonStr,
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// Decomposition Output Validator
// ─────────────────────────────────────────────────────────────────

export function validateDecompositionOutput(
  data: unknown,
  sessionId: string
): ParseResult<DecompositionOutput> {
  if (!data || typeof data !== "object") {
    return {
      success: false,
      error: "Response is not an object",
      rawResponse: JSON.stringify(data),
    };
  }

  const obj = data as Record<string, unknown>;

  // Validate patterns array
  if (!Array.isArray(obj.patterns)) {
    return {
      success: false,
      error: "Missing or invalid patterns array",
      rawResponse: JSON.stringify(data),
    };
  }

  // Validate each pattern
  const validTypes = [
    "threshold_violation",
    "asymmetry",
    "cross_metric_correlation",
    "temporal_pattern",
    "quality_flag",
  ];
  const validSeverities = ["high", "moderate", "low"];

  for (let i = 0; i < obj.patterns.length; i++) {
    const p = obj.patterns[i] as Record<string, unknown>;

    if (!validTypes.includes(p.type as string)) {
      return {
        success: false,
        error: `Pattern ${i}: invalid type "${p.type}"`,
        rawResponse: JSON.stringify(data),
      };
    }

    if (!validSeverities.includes(p.severity as string)) {
      return {
        success: false,
        error: `Pattern ${i}: invalid severity "${p.severity}"`,
        rawResponse: JSON.stringify(data),
      };
    }

    if (!Array.isArray(p.metrics) || p.metrics.length === 0) {
      return {
        success: false,
        error: `Pattern ${i}: metrics must be a non-empty array`,
        rawResponse: JSON.stringify(data),
      };
    }
  }

  // Build valid output
  const patternCounts: DecompositionOutput["patternCounts"] = {
    threshold_violation: 0,
    asymmetry: 0,
    cross_metric_correlation: 0,
    temporal_pattern: 0,
    quality_flag: 0,
  };

  const patterns = (obj.patterns as Record<string, unknown>[]).map((p, idx) => {
    const type = p.type as keyof typeof patternCounts;
    patternCounts[type]++;

    return {
      id: (p.id as string) || `pattern-${idx}`,
      type,
      metrics: p.metrics as string[],
      severity: p.severity as "high" | "moderate" | "low",
      description: (p.description as string) || "",
      values: (p.values as Record<string, number>) || {},
      limbs: p.limbs as ("Left Leg" | "Right Leg")[] | undefined,
      searchTerms: Array.isArray(p.searchTerms) ? (p.searchTerms as string[]) : [],
      benchmarkCategory: p.benchmarkCategory as
        | "optimal"
        | "average"
        | "deficient"
        | undefined,
    };
  });

  return {
    success: true,
    data: {
      sessionId,
      patterns,
      patternCounts,
      analyzedAt: Date.now(),
    },
    rawResponse: JSON.stringify(data),
  };
}

// ─────────────────────────────────────────────────────────────────
// Research Output Validator
// ─────────────────────────────────────────────────────────────────

export function validateResearchOutput(
  data: unknown,
  sessionId: string
): ParseResult<ResearchOutput> {
  if (!data || typeof data !== "object") {
    return {
      success: false,
      error: "Response is not an object",
      rawResponse: JSON.stringify(data),
    };
  }

  const obj = data as Record<string, unknown>;

  if (!obj.evidenceByPattern || typeof obj.evidenceByPattern !== "object") {
    return {
      success: false,
      error: "Missing or invalid evidenceByPattern",
      rawResponse: JSON.stringify(data),
    };
  }

  const validTiers = ["S", "A", "B", "C", "D"];
  const evidenceByPattern: ResearchOutput["evidenceByPattern"] = {};

  for (const [patternId, evidenceList] of Object.entries(obj.evidenceByPattern)) {
    if (!Array.isArray(evidenceList)) continue;

    evidenceByPattern[patternId] = (evidenceList as Record<string, unknown>[]).map(
      (e, idx) => ({
        id: (e.id as string) || `evidence-${patternId}-${idx}`,
        patternId,
        tier: validTiers.includes(e.tier as string)
          ? (e.tier as "S" | "A" | "B" | "C" | "D")
          : "D",
        sourceType: (e.sourceType as "cache" | "web_search" | "embedded_knowledge") ||
          "embedded_knowledge",
        citation: (e.citation as string) || "Unknown",
        url: e.url as string | undefined,
        findings: Array.isArray(e.findings) ? (e.findings as string[]) : [],
        relevanceScore: typeof e.relevanceScore === "number" ? e.relevanceScore : 50,
      })
    );
  }

  return {
    success: true,
    data: {
      sessionId,
      evidenceByPattern,
      insufficientEvidence: Array.isArray(obj.insufficientEvidence)
        ? (obj.insufficientEvidence as string[])
        : [],
      newCacheEntries: [], // Parsed separately if needed
      researchedAt: Date.now(),
    },
    rawResponse: JSON.stringify(data),
  };
}

// ─────────────────────────────────────────────────────────────────
// Analysis Output Validator
// ─────────────────────────────────────────────────────────────────

export function validateAnalysisOutput(
  data: unknown,
  sessionId: string
): ParseResult<AnalysisOutput> {
  if (!data || typeof data !== "object") {
    return {
      success: false,
      error: "Response is not an object",
      rawResponse: JSON.stringify(data),
    };
  }

  const obj = data as Record<string, unknown>;

  // Validate insights array
  if (!Array.isArray(obj.insights)) {
    return {
      success: false,
      error: "Missing or invalid insights array",
      rawResponse: JSON.stringify(data),
    };
  }

  const validDomains = ["range", "symmetry", "power", "control", "timing"];
  const validClassifications = ["strength", "weakness"];

  // Validate each insight
  for (let i = 0; i < obj.insights.length; i++) {
    const ins = obj.insights[i] as Record<string, unknown>;

    if (!validDomains.includes(ins.domain as string)) {
      return {
        success: false,
        error: `Insight ${i}: invalid domain "${ins.domain}"`,
        rawResponse: JSON.stringify(data),
      };
    }

    if (!validClassifications.includes(ins.classification as string)) {
      return {
        success: false,
        error: `Insight ${i}: invalid classification "${ins.classification}" (must be strength or weakness)`,
        rawResponse: JSON.stringify(data),
      };
    }
  }

  // Validate correlative insights
  if (!Array.isArray(obj.correlativeInsights)) {
    return {
      success: false,
      error: "Missing correlativeInsights array",
      rawResponse: JSON.stringify(data),
    };
  }

  if (obj.correlativeInsights.length < 2) {
    return {
      success: false,
      error: "Must have at least 2 correlative insights",
      rawResponse: JSON.stringify(data),
    };
  }

  return {
    success: true,
    data: {
      sessionId,
      insights: (obj.insights as Record<string, unknown>[]).map((ins, idx) => ({
        id: (ins.id as string) || `insight-${idx}`,
        domain: ins.domain as AnalysisOutput["insights"][0]["domain"],
        classification: ins.classification as "strength" | "weakness",
        title: (ins.title as string) || "",
        content: (ins.content as string) || "",
        limbs: ins.limbs as ("Left Leg" | "Right Leg")[] | undefined,
        evidence: Array.isArray(ins.evidence) ? (ins.evidence as string[]) : [],
        patternIds: Array.isArray(ins.patternIds) ? (ins.patternIds as string[]) : [],
        chart: ins.chart as AnalysisOutput["insights"][0]["chart"],
        percentile: ins.percentile as number | undefined,
        recommendations: ins.recommendations as string[] | undefined,
      })),
      correlativeInsights: (obj.correlativeInsights as Record<string, unknown>[]).map(
        (c, idx) => ({
          id: (c.id as string) || `corr-${idx}`,
          primaryInsightId: (c.primaryInsightId as string) || "",
          relatedInsightIds: Array.isArray(c.relatedInsightIds)
            ? (c.relatedInsightIds as string[])
            : [],
          explanation: (c.explanation as string) || "",
          significance: (c.significance as "high" | "moderate" | "low") || "moderate",
        })
      ),
      benchmarks: Array.isArray(obj.benchmarks)
        ? (obj.benchmarks as Record<string, unknown>[]).map((b) => ({
            metricName: (b.metricName as string) || "",
            displayName: (b.displayName as string) || "",
            domain: (b.domain as AnalysisOutput["benchmarks"][0]["domain"]) || "range",
            value: (b.value as number) || 0,
            percentile: (b.percentile as number) || 50,
            category: (b.category as "optimal" | "average" | "deficient") || "average",
            classification: (b.classification as "strength" | "weakness") || "strength",
            limb: b.limb as "Left Leg" | "Right Leg" | undefined,
          }))
        : [],
      summary: (obj.summary as string) || "",
      strengths: Array.isArray(obj.strengths) ? (obj.strengths as string[]) : [],
      weaknesses: Array.isArray(obj.weaknesses) ? (obj.weaknesses as string[]) : [],
      analyzedAt: Date.now(),
    },
    rawResponse: JSON.stringify(data),
  };
}

// ─────────────────────────────────────────────────────────────────
// Validator Output Validator
// ─────────────────────────────────────────────────────────────────

export function validateValidatorOutput(
  data: unknown,
  sessionId: string,
  revisionNumber: number
): ParseResult<Omit<ValidatorOutput, "validatedAnalysis">> {
  if (!data || typeof data !== "object") {
    return {
      success: false,
      error: "Response is not an object",
      rawResponse: JSON.stringify(data),
    };
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.passed !== "boolean") {
    return {
      success: false,
      error: "Missing or invalid 'passed' boolean",
      rawResponse: JSON.stringify(data),
    };
  }

  const issues = Array.isArray(obj.issues)
    ? (obj.issues as Record<string, unknown>[]).map((i) => ({
        ruleType: i.ruleType as ValidatorOutput["issues"][0]["ruleType"],
        severity: (i.severity as "error" | "warning") || "warning",
        insightIds: Array.isArray(i.insightIds) ? (i.insightIds as string[]) : [],
        description: (i.description as string) || "",
        suggestedFix: (i.suggestedFix as string) || "",
      }))
    : [];

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  return {
    success: true,
    data: {
      sessionId,
      passed: obj.passed as boolean,
      issues,
      errorCount,
      warningCount,
      revisionNumber,
      validatedAt: Date.now(),
    },
    rawResponse: JSON.stringify(data),
  };
}

// ─────────────────────────────────────────────────────────────────
// Progress Output Validator
// ─────────────────────────────────────────────────────────────────

export function validateProgressOutput(
  data: unknown,
  sessionId: string
): ParseResult<Omit<ProgressOutput, "patientId">> {
  if (!data || typeof data !== "object") {
    return {
      success: false,
      error: "Response is not an object",
      rawResponse: JSON.stringify(data),
    };
  }

  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.trends)) {
    return {
      success: false,
      error: "Missing or invalid trends array",
      rawResponse: JSON.stringify(data),
    };
  }

  const validTrends = ["improving", "stable", "declining"];

  for (let i = 0; i < obj.trends.length; i++) {
    const t = obj.trends[i] as Record<string, unknown>;
    if (!validTrends.includes(t.trend as string)) {
      return {
        success: false,
        error: `Trend ${i}: invalid trend "${t.trend}"`,
        rawResponse: JSON.stringify(data),
      };
    }
  }

  return {
    success: true,
    data: {
      sessionId,
      trends: (obj.trends as Record<string, unknown>[]).map((t) => ({
        metricName: (t.metricName as string) || "",
        displayName: (t.displayName as string) || "",
        domain: (t.domain as ProgressOutput["trends"][0]["domain"]) || "range",
        direction: (t.direction as "higherBetter" | "lowerBetter") || "higherBetter",
        trend: t.trend as "improving" | "stable" | "declining",
        currentValue: (t.currentValue as number) || 0,
        previousValue: (t.previousValue as number) || 0,
        baselineValue: (t.baselineValue as number) || 0,
        changeFromPrevious: (t.changeFromPrevious as number) || 0,
        changeFromBaseline: (t.changeFromBaseline as number) || 0,
        isClinicallyMeaningful: (t.isClinicallyMeaningful as boolean) || false,
        limb: t.limb as "Left Leg" | "Right Leg" | undefined,
        history: Array.isArray(t.history)
          ? (t.history as { date: number; value: number }[])
          : [],
      })),
      milestones: Array.isArray(obj.milestones)
        ? (obj.milestones as Record<string, unknown>[]).map((m, idx) => ({
            id: (m.id as string) || `milestone-${idx}`,
            type: m.type as ProgressOutput["milestones"][0]["type"],
            title: (m.title as string) || "",
            description: (m.description as string) || "",
            achievedAt: (m.achievedAt as number) || Date.now(),
            metrics: Array.isArray(m.metrics) ? (m.metrics as string[]) : [],
            celebrationLevel: (m.celebrationLevel as "major" | "minor") || "minor",
          }))
        : [],
      regressions: Array.isArray(obj.regressions)
        ? (obj.regressions as Record<string, unknown>[]).map((r, idx) => ({
            id: (r.id as string) || `regression-${idx}`,
            metricName: (r.metricName as string) || "",
            declinePercentage: (r.declinePercentage as number) || 0,
            isClinicallySignificant: (r.isClinicallySignificant as boolean) || false,
            possibleReasons: Array.isArray(r.possibleReasons)
              ? (r.possibleReasons as string[])
              : [],
            recommendations: Array.isArray(r.recommendations)
              ? (r.recommendations as string[])
              : [],
            limb: r.limb as "Left Leg" | "Right Leg" | undefined,
          }))
        : [],
      projections: Array.isArray(obj.projections)
        ? (obj.projections as Record<string, unknown>[]).map((p) => ({
            metricName: (p.metricName as string) || "",
            projectedValue: (p.projectedValue as number) || 0,
            targetDate: (p.targetDate as number) || Date.now(),
            confidence: (p.confidence as number) || 50,
            assumptions: Array.isArray(p.assumptions) ? (p.assumptions as string[]) : [],
          }))
        : [],
      summary: (obj.summary as string) || "",
      sessionsAnalyzed: (obj.sessionsAnalyzed as number) || 1,
      dateRange: (obj.dateRange as { start: number; end: number }) || {
        start: Date.now(),
        end: Date.now(),
      },
      analyzedAt: Date.now(),
    },
    rawResponse: JSON.stringify(data),
  };
}
