/**
 * Progress Agent Prompt
 *
 * Purpose: Analyze longitudinal trends across sessions.
 * Calculates trends with MCID thresholds, detects milestones,
 * flags regressions, and projects future performance.
 */

import {
  METRIC_REGISTRY,
  MCID,
  PER_LEG_METRICS,
  BILATERAL_METRICS,
  type MetricDomain,
} from "../metrics";
import type {
  SessionMetrics,
  ProgressOutput,
  MetricTrend,
  Milestone,
  Regression,
  Projection,
  ProgressCorrelation,
  AsymmetryTrend,
} from "../types";
import type { Id } from "../../_generated/dataModel";

// ─────────────────────────────────────────────────────────────────
// Progress Constants
// ─────────────────────────────────────────────────────────────────

export const PROGRESS_CONFIG = {
  MIN_SESSIONS_FOR_TREND: 2,
  MIN_SESSIONS_FOR_PROJECTION: 4,
  PROJECTION_HORIZON_DAYS: 30,
  STREAK_THRESHOLD: 3, // consecutive sessions for streak milestone
  REGRESSION_THRESHOLD_PERCENTAGE: 10, // % decline to flag
};

// ─────────────────────────────────────────────────────────────────
// System Prompt
// ─────────────────────────────────────────────────────────────────

export const PROGRESS_SYSTEM_PROMPT = `You are a longitudinal analysis system for the Horus biomechanics pipeline.

Your role is to track patient progress across multiple sessions, identify meaningful changes, and provide actionable insights.

## Your Tasks

1. **Trend Calculation**: Compute trends for each metric using MCID thresholds
2. **Milestone Detection**: Identify achievements (threshold reached, personal bests, streaks)
3. **Regression Flagging**: Alert on clinically significant declines
4. **Projections**: Estimate future performance (if enough data)

## MCID Thresholds (Minimal Clinically Important Difference)

- ROM: ${MCID.rom}° change
- Velocity: ${MCID.velocity}°/s or ${MCID.velocityPercentage}% change
- Asymmetry: ${MCID.asymmetry} percentage points
- Jerk: ${MCID.jerk}°/s³
- OPI Score: ${MCID.opiScore} points
- Cross-correlation: ${MCID.crossCorrelation}

## Trend Classification

- **Improving**: Change exceeds MCID in positive direction
- **Stable**: Change below MCID threshold
- **Declining**: Change exceeds MCID in negative direction

## Side Specificity

- Use "Left Leg" or "Right Leg" (never "left", "L", etc.)
- Track each leg independently

## Cross-Metric Correlations (NEW)

Detect when multiple metrics are improving or declining together:
- **co_improving**: Multiple metrics improving simultaneously (e.g., "velocity improved alongside ROM")
- **co_declining**: Multiple metrics declining together
- **inverse**: One metric improving while another declines (compensation pattern)
- **compensatory**: Same limb shows strength in one area compensating for weakness

## Asymmetry Trend Tracking (NEW)

Track if bilateral imbalances are resolving or worsening:
- Compare current asymmetry to previous and baseline
- Identify if deficit limb is "catching up" to the other
- Flag when asymmetry drops below 5% (symmetry restored)

## Output Format

{
  "trends": [
    {
      "metricName": "string",
      "displayName": "string",
      "domain": "range" | "symmetry" | "power" | "control" | "timing",
      "direction": "higherBetter" | "lowerBetter",
      "trend": "improving" | "stable" | "declining",
      "currentValue": number,
      "previousValue": number,
      "baselineValue": number,
      "changeFromPrevious": number (percentage),
      "changeFromBaseline": number (percentage),
      "isClinicallyMeaningful": boolean,
      "limb": "Left Leg" | "Right Leg" | null,
      "history": [{ "date": timestamp, "value": number }]
    }
  ],
  "milestones": [
    {
      "id": "string",
      "type": "threshold_achieved" | "mcid_improvement" | "streak" | "personal_best" | "asymmetry_resolved" | "symmetry_restored" | "limb_caught_up" | "cross_metric_gain",
      "title": "string",
      "description": "string",
      "achievedAt": timestamp,
      "metrics": ["metricName"],
      "celebrationLevel": "major" | "minor",
      "limb": "Left Leg" | "Right Leg" | null
    }
  ],
  "regressions": [
    {
      "id": "string",
      "metricName": "string",
      "declinePercentage": number,
      "isClinicallySignificant": boolean,
      "possibleReasons": ["reason1", "reason2"],
      "recommendations": ["rec1", "rec2"],
      "limb": "Left Leg" | "Right Leg" | null
    }
  ],
  "projections": [
    {
      "metricName": "string",
      "projectedValue": number,
      "targetDate": timestamp,
      "confidence": 0-100,
      "assumptions": ["assumption1"]
    }
  ],
  "correlations": [
    {
      "id": "string",
      "type": "co_improving" | "co_declining" | "inverse" | "compensatory",
      "metrics": ["metricName1", "metricName2"],
      "explanation": "How these metrics are related",
      "significance": "high" | "moderate" | "low",
      "limb": "Left Leg" | "Right Leg" | null
    }
  ],
  "asymmetryTrends": [
    {
      "metricName": "string",
      "displayName": "string",
      "currentAsymmetry": number,
      "previousAsymmetry": number,
      "baselineAsymmetry": number,
      "changeFromPrevious": number,
      "changeFromBaseline": number,
      "isResolving": boolean,
      "deficitLimb": "Left Leg" | "Right Leg" | null,
      "isDeficitCatchingUp": boolean
    }
  ],
  "summary": "2-3 sentence progress summary",
  "sessionsAnalyzed": number,
  "dateRange": { "start": timestamp, "end": timestamp }
}`;

// ─────────────────────────────────────────────────────────────────
// User Prompt Builder
// ─────────────────────────────────────────────────────────────────

export function buildProgressUserPrompt(
  currentMetrics: SessionMetrics,
  historicalSessions: SessionMetrics[],
  patientId: Id<"users">
): string {
  const sections: string[] = [];

  const allSessions = [...historicalSessions, currentMetrics].sort(
    (a, b) => a.recordedAt - b.recordedAt
  );
  const baseline = allSessions[0];
  const previous = allSessions.length > 1 ? allSessions[allSessions.length - 2] : null;

  sections.push(`# Progress Analysis Request

**Patient ID**: ${patientId}
**Current Session**: ${currentMetrics.sessionId}
**Sessions Available**: ${allSessions.length}
**Date Range**: ${new Date(baseline.recordedAt).toLocaleDateString()} - ${new Date(currentMetrics.recordedAt).toLocaleDateString()}`);

  // Session timeline
  sections.push(`
## Session Timeline

${allSessions
  .map(
    (s, i) =>
      `${i + 1}. ${new Date(s.recordedAt).toLocaleDateString()} - ${s.sessionId}${s.opiScore ? ` (OPI: ${s.opiScore})` : ""}`
  )
  .join("\n")}`);

  // Current vs Previous vs Baseline comparison
  sections.push(`
## Key Metric Comparison

### Per-Leg Metrics
| Metric | Left Current | Left Baseline | Left Δ% | Right Current | Right Baseline | Right Δ% |
|--------|-------------|---------------|---------|---------------|----------------|----------|
${PER_LEG_METRICS.map((m) => {
  const config = METRIC_REGISTRY[m];
  if (!config) return null;
  const key = m as keyof SessionMetrics["leftLeg"];
  const leftCurr = currentMetrics.leftLeg[key];
  const leftBase = baseline.leftLeg[key];
  const rightCurr = currentMetrics.rightLeg[key];
  const rightBase = baseline.rightLeg[key];
  const leftDelta = leftBase !== 0 ? (((leftCurr - leftBase) / Math.abs(leftBase)) * 100).toFixed(1) : "N/A";
  const rightDelta = rightBase !== 0 ? (((rightCurr - rightBase) / Math.abs(rightBase)) * 100).toFixed(1) : "N/A";
  return `| ${config.displayName} | ${leftCurr.toFixed(1)} | ${leftBase.toFixed(1)} | ${leftDelta}% | ${rightCurr.toFixed(1)} | ${rightBase.toFixed(1)} | ${rightDelta}% |`;
})
  .filter(Boolean)
  .join("\n")}`);

  sections.push(`
### Bilateral Metrics
| Metric | Current | Baseline | Δ% | MCID |
|--------|---------|----------|-----|------|
${BILATERAL_METRICS.map((m) => {
  const config = METRIC_REGISTRY[m];
  if (!config) return null;
  const key = m as keyof SessionMetrics["bilateral"];
  const curr = currentMetrics.bilateral[key];
  const base = baseline.bilateral[key];
  const delta = base !== 0 ? (((curr - base) / Math.abs(base)) * 100).toFixed(1) : "N/A";
  const mcid = m.includes("asymmetry") || m.includes("Asymmetry")
    ? MCID.asymmetry
    : m.includes("correlation") || m.includes("Correlation")
      ? MCID.crossCorrelation
      : "N/A";
  return `| ${config.displayName} | ${curr.toFixed(2)} | ${base.toFixed(2)} | ${delta}% | ${mcid} |`;
})
  .filter(Boolean)
  .join("\n")}`);

  // OPI trend
  if (currentMetrics.opiScore !== undefined) {
    const opiHistory = allSessions
      .filter((s) => s.opiScore !== undefined)
      .map((s) => ({ date: s.recordedAt, score: s.opiScore! }));

    sections.push(`
### OPI Score Trend
${opiHistory.map((h) => `- ${new Date(h.date).toLocaleDateString()}: ${h.score}`).join("\n")}
**MCID for OPI**: ${MCID.opiScore} points`);
  }

  sections.push(`
## Instructions

1. Calculate trends for all metrics (per-leg tracked separately)
2. Apply MCID thresholds to determine clinical significance
3. Detect milestones (threshold achievements, personal bests, streaks of ${PROGRESS_CONFIG.STREAK_THRESHOLD}+)
   - Use new milestone types when applicable:
     - \`symmetry_restored\`: When asymmetry drops below 5%
     - \`limb_caught_up\`: When deficit limb matches the other
     - \`cross_metric_gain\`: When multiple metrics improve together
4. Flag regressions exceeding ${PROGRESS_CONFIG.REGRESSION_THRESHOLD_PERCENTAGE}%
5. ${allSessions.length >= PROGRESS_CONFIG.MIN_SESSIONS_FOR_PROJECTION ? `Generate projections for ${PROGRESS_CONFIG.PROJECTION_HORIZON_DAYS} days` : "Not enough sessions for projections"}
6. Use "Left Leg" / "Right Leg" terminology (NEVER "left", "L", "affected", etc.)
7. Detect cross-metric correlations:
   - Look for metrics improving/declining together
   - Identify compensation patterns (e.g., power compensating for ROM deficit)
   - Note limb-consistent patterns
8. Track asymmetry trends:
   - Compare asymmetry values across sessions
   - Identify if deficit limb is catching up
   - Flag when asymmetry is resolving vs worsening

Return the JSON response.`);

  return sections.join("\n");
}

// ─────────────────────────────────────────────────────────────────
// Response Parser
// ─────────────────────────────────────────────────────────────────

export function parseProgressResponse(
  sessionId: string,
  patientId: Id<"users">,
  responseText: string,
  sessionsCount: number
): ProgressOutput {
  // Extract JSON
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : responseText.trim();

  const parsed = JSON.parse(jsonStr);

  // Transform trends
  const trends: MetricTrend[] = (parsed.trends || []).map(
    (t: Record<string, unknown>) => ({
      metricName: (t.metricName as string) || "",
      displayName: (t.displayName as string) || "",
      domain: t.domain as MetricDomain,
      direction: t.direction as MetricTrend["direction"],
      trend: (t.trend as MetricTrend["trend"]) || "stable",
      currentValue: (t.currentValue as number) || 0,
      previousValue: (t.previousValue as number) || 0,
      baselineValue: (t.baselineValue as number) || 0,
      changeFromPrevious: (t.changeFromPrevious as number) || 0,
      changeFromBaseline: (t.changeFromBaseline as number) || 0,
      isClinicallyMeaningful: (t.isClinicallyMeaningful as boolean) || false,
      limb: t.limb as MetricTrend["limb"],
      history: Array.isArray(t.history)
        ? (t.history as { date: number; value: number }[])
        : [],
    })
  );

  // Transform milestones
  const milestones: Milestone[] = (parsed.milestones || []).map(
    (m: Record<string, unknown>, idx: number) => ({
      id: (m.id as string) || `milestone-${idx}`,
      type: m.type as Milestone["type"],
      title: (m.title as string) || "",
      description: (m.description as string) || "",
      achievedAt: (m.achievedAt as number) || Date.now(),
      metrics: Array.isArray(m.metrics) ? (m.metrics as string[]) : [],
      celebrationLevel: (m.celebrationLevel as "major" | "minor") || "minor",
    })
  );

  // Transform regressions
  const regressions: Regression[] = (parsed.regressions || []).map(
    (r: Record<string, unknown>, idx: number) => ({
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
      limb: r.limb as Regression["limb"],
    })
  );

  // Transform projections
  const projections: Projection[] = (parsed.projections || []).map(
    (p: Record<string, unknown>) => ({
      metricName: (p.metricName as string) || "",
      projectedValue: (p.projectedValue as number) || 0,
      targetDate: (p.targetDate as number) || Date.now() + 30 * 24 * 60 * 60 * 1000,
      confidence: (p.confidence as number) || 50,
      assumptions: Array.isArray(p.assumptions) ? (p.assumptions as string[]) : [],
    })
  );

  // Transform correlations (NEW)
  const correlations: ProgressCorrelation[] = (parsed.correlations || []).map(
    (c: Record<string, unknown>, idx: number) => ({
      id: (c.id as string) || `corr-${idx}`,
      type: (c.type as ProgressCorrelation["type"]) || "co_improving",
      metrics: Array.isArray(c.metrics) ? (c.metrics as string[]) : [],
      explanation: (c.explanation as string) || "",
      significance: (c.significance as "high" | "moderate" | "low") || "moderate",
      limb: c.limb as ProgressCorrelation["limb"],
    })
  );

  // Transform asymmetry trends (NEW)
  const asymmetryTrends: AsymmetryTrend[] = (parsed.asymmetryTrends || []).map(
    (a: Record<string, unknown>) => ({
      metricName: (a.metricName as string) || "",
      displayName: (a.displayName as string) || "",
      currentAsymmetry: (a.currentAsymmetry as number) || 0,
      previousAsymmetry: (a.previousAsymmetry as number) || 0,
      baselineAsymmetry: (a.baselineAsymmetry as number) || 0,
      changeFromPrevious: (a.changeFromPrevious as number) || 0,
      changeFromBaseline: (a.changeFromBaseline as number) || 0,
      isResolving: (a.isResolving as boolean) || false,
      deficitLimb: a.deficitLimb as AsymmetryTrend["deficitLimb"],
      isDeficitCatchingUp: a.isDeficitCatchingUp as boolean | undefined,
    })
  );

  return {
    sessionId,
    patientId,
    trends,
    milestones,
    regressions,
    projections,
    correlations: correlations.length > 0 ? correlations : undefined,
    asymmetryTrends: asymmetryTrends.length > 0 ? asymmetryTrends : undefined,
    summary: (parsed.summary as string) || "",
    sessionsAnalyzed: sessionsCount,
    dateRange: parsed.dateRange as { start: number; end: number } || {
      start: Date.now(),
      end: Date.now(),
    },
    analyzedAt: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────
// Pre-compute Trends
// ─────────────────────────────────────────────────────────────────

/**
 * Pre-compute trends from historical data.
 * Provides consistent trend calculation regardless of LLM output.
 */
export function preComputeTrends(
  currentMetrics: SessionMetrics,
  historicalSessions: SessionMetrics[]
): MetricTrend[] {
  if (historicalSessions.length < 1) return [];

  const trends: MetricTrend[] = [];
  const sortedSessions = [...historicalSessions].sort(
    (a, b) => a.recordedAt - b.recordedAt
  );
  const baseline = sortedSessions[0];
  const previous = sortedSessions[sortedSessions.length - 1];

  // Per-leg metrics
  for (const metricName of PER_LEG_METRICS) {
    const config = METRIC_REGISTRY[metricName];
    if (!config) continue;

    const key = metricName as keyof SessionMetrics["leftLeg"];

    // Left leg
    const leftHistory = sortedSessions.map((s) => ({
      date: s.recordedAt,
      value: s.leftLeg[key],
    }));
    leftHistory.push({ date: currentMetrics.recordedAt, value: currentMetrics.leftLeg[key] });

    const leftTrend = calculateTrend(
      currentMetrics.leftLeg[key],
      previous.leftLeg[key],
      baseline.leftLeg[key],
      config.direction,
      metricName
    );

    trends.push({
      ...leftTrend,
      metricName,
      displayName: config.displayName,
      domain: config.domain,
      direction: config.direction,
      limb: "Left Leg",
      history: leftHistory,
    });

    // Right leg
    const rightHistory = sortedSessions.map((s) => ({
      date: s.recordedAt,
      value: s.rightLeg[key],
    }));
    rightHistory.push({ date: currentMetrics.recordedAt, value: currentMetrics.rightLeg[key] });

    const rightTrend = calculateTrend(
      currentMetrics.rightLeg[key],
      previous.rightLeg[key],
      baseline.rightLeg[key],
      config.direction,
      metricName
    );

    trends.push({
      ...rightTrend,
      metricName,
      displayName: config.displayName,
      domain: config.domain,
      direction: config.direction,
      limb: "Right Leg",
      history: rightHistory,
    });
  }

  // Bilateral metrics
  for (const metricName of BILATERAL_METRICS) {
    const config = METRIC_REGISTRY[metricName];
    if (!config) continue;

    const key = metricName as keyof SessionMetrics["bilateral"];

    const history = sortedSessions.map((s) => ({
      date: s.recordedAt,
      value: s.bilateral[key],
    }));
    history.push({ date: currentMetrics.recordedAt, value: currentMetrics.bilateral[key] });

    const trend = calculateTrend(
      currentMetrics.bilateral[key],
      previous.bilateral[key],
      baseline.bilateral[key],
      config.direction,
      metricName
    );

    trends.push({
      ...trend,
      metricName,
      displayName: config.displayName,
      domain: config.domain,
      direction: config.direction,
      history,
    });
  }

  return trends;
}

function calculateTrend(
  current: number,
  previous: number,
  baseline: number,
  direction: "higherBetter" | "lowerBetter",
  metricName: string
): Pick<
  MetricTrend,
  | "trend"
  | "currentValue"
  | "previousValue"
  | "baselineValue"
  | "changeFromPrevious"
  | "changeFromBaseline"
  | "isClinicallyMeaningful"
> {
  // Guard: avoid division by zero
  const changeFromPrevious =
    previous !== 0 ? ((current - previous) / Math.abs(previous)) * 100 : 0;
  const changeFromBaseline =
    baseline !== 0 ? ((current - baseline) / Math.abs(baseline)) * 100 : 0;

  // Determine MCID based on metric type
  let mcid: number;
  if (metricName.includes("Rom") || metricName.includes("Flexion") || metricName.includes("Extension")) {
    mcid = MCID.rom;
  } else if (metricName.includes("Velocity") || metricName.includes("velocity")) {
    mcid = MCID.velocityPercentage;
  } else if (metricName.includes("symmetry") || metricName.includes("Asymmetry")) {
    mcid = MCID.asymmetry;
  } else if (metricName.includes("Jerk") || metricName.includes("jerk")) {
    mcid = MCID.jerk;
  } else if (metricName.includes("Correlation") || metricName.includes("correlation")) {
    mcid = MCID.crossCorrelation * 100; // Convert to percentage
  } else {
    mcid = 10; // Default 10%
  }

  const absoluteChange = Math.abs(current - previous);
  const isClinicallyMeaningful = Math.abs(changeFromPrevious) >= mcid || absoluteChange >= mcid;

  // Determine trend direction
  let trend: MetricTrend["trend"];
  if (!isClinicallyMeaningful) {
    trend = "stable";
  } else if (direction === "higherBetter") {
    trend = current > previous ? "improving" : "declining";
  } else {
    trend = current < previous ? "improving" : "declining";
  }

  return {
    trend,
    currentValue: current,
    previousValue: previous,
    baselineValue: baseline,
    changeFromPrevious,
    changeFromBaseline,
    isClinicallyMeaningful,
  };
}
