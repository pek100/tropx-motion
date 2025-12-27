/**
 * Horus Correlation Module
 *
 * Data-driven correlation detection for enriching AI prompts.
 * Pre-computes asymmetry data and identifies potential correlations
 * so the AI can validate and expand on system-detected patterns.
 */

import type { SessionMetrics, NormativeBenchmark, PerLegMetricValues } from "./types";
import {
  METRIC_REGISTRY,
  PER_LEG_METRICS,
  type MetricConfig,
  type MetricDomain,
  type SpecificLimb,
  type BenchmarkCategory,
  calculateAsymmetry,
  getBenchmarkCategory,
  CLINICAL_THRESHOLDS,
} from "./metrics";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/**
 * Enriched asymmetry data for a single metric.
 */
export interface AsymmetryEnrichedMetric {
  /** Metric name (camelCase) */
  metricName: string;
  /** Display name for prompts */
  displayName: string;
  /** Metric domain */
  domain: MetricDomain;
  /** Asymmetry percentage */
  asymmetryPercentage: number;
  /** Absolute difference between limbs */
  absoluteDifference: number;
  /** Which limb has the deficit */
  deficitLimb: SpecificLimb | null;
  /** Left leg value */
  leftValue: number;
  /** Right leg value */
  rightValue: number;
  /** Severity level based on thresholds */
  severity: "critical" | "significant" | "minor" | "none";
  /** Benchmark category for deficit limb */
  deficitBenchmark?: BenchmarkCategory;
}

/**
 * Candidate correlation detected from data.
 */
export interface CorrelationCandidate {
  /** Type of correlation */
  type: "limb_consistent" | "cross_domain" | "inverse";
  /** Metric names involved */
  metrics: string[];
  /** Domain(s) involved */
  domains: MetricDomain[];
  /** Which limb shows consistent pattern (if applicable) */
  limb?: SpecificLimb;
  /** Brief description for AI prompt */
  description: string;
  /** Confidence level (0-1) */
  confidence: number;
}

// ─────────────────────────────────────────────────────────────────
// Asymmetry Enrichment
// ─────────────────────────────────────────────────────────────────

/**
 * Compute asymmetry enrichment for all per-leg metrics.
 * Uses calculateAsymmetry() from metrics.ts with direction awareness.
 */
export function computeAsymmetryEnrichment(
  metrics: SessionMetrics
): AsymmetryEnrichedMetric[] {
  const enriched: AsymmetryEnrichedMetric[] = [];

  for (const metricName of PER_LEG_METRICS) {
    const config = METRIC_REGISTRY[metricName];
    if (!config) continue;

    // Get values from left and right leg
    const leftValue = (metrics.leftLeg as unknown as Record<string, number>)[metricName];
    const rightValue = (metrics.rightLeg as unknown as Record<string, number>)[metricName];

    // Skip if values are missing
    if (leftValue === undefined || rightValue === undefined) continue;

    // Calculate asymmetry with direction awareness
    const asymmetry = calculateAsymmetry(leftValue, rightValue, config.direction);

    // Determine severity
    let severity: AsymmetryEnrichedMetric["severity"];
    if (asymmetry.percentage >= CLINICAL_THRESHOLDS.ASYMMETRY_HIGH) {
      severity = "critical";
    } else if (asymmetry.percentage >= CLINICAL_THRESHOLDS.ASYMMETRY_MODERATE) {
      severity = "significant";
    } else if (asymmetry.percentage >= CLINICAL_THRESHOLDS.ASYMMETRY_LOW) {
      severity = "minor";
    } else {
      severity = "none";
    }

    // Get benchmark category for deficit limb
    let deficitBenchmark: BenchmarkCategory | undefined;
    if (asymmetry.deficitLimb) {
      const deficitValue =
        asymmetry.deficitLimb === "Left Leg" ? leftValue : rightValue;
      deficitBenchmark = getBenchmarkCategory(deficitValue, config);
    }

    enriched.push({
      metricName,
      displayName: config.displayName,
      domain: config.domain,
      asymmetryPercentage: Math.round(asymmetry.percentage * 10) / 10,
      absoluteDifference: Math.round(asymmetry.absoluteDiff * 10) / 10,
      deficitLimb: asymmetry.deficitLimb,
      leftValue: Math.round(leftValue * 10) / 10,
      rightValue: Math.round(rightValue * 10) / 10,
      severity,
      deficitBenchmark,
    });
  }

  // Sort by severity (critical first) then by asymmetry percentage
  return enriched.sort((a, b) => {
    const severityOrder = { critical: 0, significant: 1, minor: 2, none: 3 };
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return b.asymmetryPercentage - a.asymmetryPercentage;
  });
}

// ─────────────────────────────────────────────────────────────────
// Correlation Detection
// ─────────────────────────────────────────────────────────────────

/**
 * Identify potential correlations from benchmarks and asymmetry data.
 * Returns candidates for AI to validate and expand.
 */
export function identifyPotentialCorrelations(
  benchmarks: NormativeBenchmark[],
  asymmetryData: AsymmetryEnrichedMetric[]
): CorrelationCandidate[] {
  const candidates: CorrelationCandidate[] = [];

  // 1. Find limb-consistent patterns (same limb shows multiple deficits)
  const limbDeficits = findLimbConsistentDeficits(asymmetryData);
  candidates.push(...limbDeficits);

  // 2. Find cross-domain correlations from benchmarks
  const crossDomain = findCrossDomainPatterns(benchmarks);
  candidates.push(...crossDomain);

  // 3. Find inverse patterns (one metric good, related metric bad)
  const inverse = findInversePatterns(benchmarks);
  candidates.push(...inverse);

  // Sort by confidence
  return candidates.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Find cases where the same limb shows deficits across multiple metrics.
 */
function findLimbConsistentDeficits(
  asymmetryData: AsymmetryEnrichedMetric[]
): CorrelationCandidate[] {
  const candidates: CorrelationCandidate[] = [];

  // Group by deficit limb
  const leftDeficits = asymmetryData.filter(
    (a) => a.deficitLimb === "Left Leg" && a.severity !== "none"
  );
  const rightDeficits = asymmetryData.filter(
    (a) => a.deficitLimb === "Right Leg" && a.severity !== "none"
  );

  // Check for limb-consistent patterns (2+ metrics on same limb)
  for (const [limb, deficits] of [
    ["Left Leg", leftDeficits],
    ["Right Leg", rightDeficits],
  ] as const) {
    if (deficits.length >= 2) {
      // Group by domain to find cross-domain patterns
      const domains = new Set(deficits.map((d) => d.domain));

      if (domains.size >= 2) {
        // Cross-domain consistency on same limb - high confidence
        candidates.push({
          type: "limb_consistent",
          metrics: deficits.map((d) => d.metricName),
          domains: Array.from(domains) as MetricDomain[],
          limb: limb as SpecificLimb,
          description: `${limb} shows consistent deficits across ${Array.from(domains).join(" and ")} domains`,
          confidence: 0.8 + domains.size * 0.05,
        });
      } else if (deficits.length >= 3) {
        // Multiple deficits in same domain
        candidates.push({
          type: "limb_consistent",
          metrics: deficits.map((d) => d.metricName),
          domains: Array.from(domains) as MetricDomain[],
          limb: limb as SpecificLimb,
          description: `${limb} shows multiple deficits in ${Array.from(domains)[0]} domain`,
          confidence: 0.7,
        });
      }
    }
  }

  return candidates;
}

/**
 * Find cross-domain patterns from benchmark data.
 */
function findCrossDomainPatterns(
  benchmarks: NormativeBenchmark[]
): CorrelationCandidate[] {
  const candidates: CorrelationCandidate[] = [];

  // Known correlations to look for
  const knownPairs: Array<{
    domains: [MetricDomain, MetricDomain];
    description: string;
  }> = [
    { domains: ["power", "range"], description: "Power output correlates with range of motion" },
    { domains: ["power", "control"], description: "Power generation affects movement control" },
    { domains: ["symmetry", "timing"], description: "Asymmetry impacts timing coordination" },
    { domains: ["range", "control"], description: "ROM limitations affect movement quality" },
  ];

  for (const { domains, description } of knownPairs) {
    const domain1Metrics = benchmarks.filter((b) => b.domain === domains[0]);
    const domain2Metrics = benchmarks.filter((b) => b.domain === domains[1]);

    // Check if both domains have consistent classification
    const domain1Weakness = domain1Metrics.filter(
      (b) => b.classification === "weakness"
    );
    const domain2Weakness = domain2Metrics.filter(
      (b) => b.classification === "weakness"
    );

    if (domain1Weakness.length > 0 && domain2Weakness.length > 0) {
      // Check for same-limb correlation
      const domain1Limbs = new Set(domain1Weakness.map((b) => b.limb).filter(Boolean));
      const domain2Limbs = new Set(domain2Weakness.map((b) => b.limb).filter(Boolean));
      const commonLimbs = [...domain1Limbs].filter((l) => domain2Limbs.has(l));

      if (commonLimbs.length > 0) {
        candidates.push({
          type: "cross_domain",
          metrics: [
            ...domain1Weakness.map((b) => b.metricName),
            ...domain2Weakness.map((b) => b.metricName),
          ],
          domains: domains,
          limb: commonLimbs[0] as SpecificLimb,
          description: `${description}; ${commonLimbs[0]} shows weaknesses in both`,
          confidence: 0.75,
        });
      } else {
        candidates.push({
          type: "cross_domain",
          metrics: [
            ...domain1Weakness.map((b) => b.metricName),
            ...domain2Weakness.map((b) => b.metricName),
          ],
          domains: domains,
          description,
          confidence: 0.6,
        });
      }
    }
  }

  return candidates;
}

/**
 * Find inverse patterns (one metric strong, related metric weak).
 */
function findInversePatterns(
  benchmarks: NormativeBenchmark[]
): CorrelationCandidate[] {
  const candidates: CorrelationCandidate[] = [];

  // Look for compensation patterns within same limb
  const limbBenchmarks: Record<string, NormativeBenchmark[]> = {
    "Left Leg": benchmarks.filter((b) => b.limb === "Left Leg"),
    "Right Leg": benchmarks.filter((b) => b.limb === "Right Leg"),
  };

  for (const [limb, metrics] of Object.entries(limbBenchmarks)) {
    const strengths = metrics.filter((b) => b.category === "optimal");
    const weaknesses = metrics.filter((b) => b.category === "deficient");

    // If there are both strengths and weaknesses in the same limb, potential compensation
    if (strengths.length > 0 && weaknesses.length > 0) {
      // Check for power/range compensation
      const powerStrength = strengths.find((b) => b.domain === "power");
      const rangeWeakness = weaknesses.find((b) => b.domain === "range");

      if (powerStrength && rangeWeakness) {
        candidates.push({
          type: "inverse",
          metrics: [powerStrength.metricName, rangeWeakness.metricName],
          domains: ["power", "range"],
          limb: limb as SpecificLimb,
          description: `${limb}: May be compensating for ROM limitation with power`,
          confidence: 0.65,
        });
      }

      // Check for velocity/control inverse
      const velocityStrength = strengths.find(
        (b) => b.metricName === "peakAngularVelocity"
      );
      const controlWeakness = weaknesses.find((b) => b.domain === "control");

      if (velocityStrength && controlWeakness) {
        candidates.push({
          type: "inverse",
          metrics: [velocityStrength.metricName, controlWeakness.metricName],
          domains: ["power", "control"],
          limb: limb as SpecificLimb,
          description: `${limb}: High velocity with reduced control may indicate compensation`,
          confidence: 0.6,
        });
      }
    }
  }

  return candidates;
}

// ─────────────────────────────────────────────────────────────────
// Prompt Generation
// ─────────────────────────────────────────────────────────────────

/**
 * Generate a prompt section with pre-computed correlation data.
 * Injects into AI prompt to guide correlative insight generation.
 */
export function generateCorrelationPromptSection(
  asymmetryData: AsymmetryEnrichedMetric[],
  correlations: CorrelationCandidate[]
): string {
  const sections: string[] = [];

  // Section 1: Critical/Significant Asymmetries
  const criticalAsymmetries = asymmetryData.filter(
    (a) => a.severity === "critical" || a.severity === "significant"
  );

  if (criticalAsymmetries.length > 0) {
    sections.push("## Pre-computed Asymmetry Analysis\n");
    sections.push("The following asymmetries have been detected:\n");

    for (const asym of criticalAsymmetries) {
      const severityLabel = asym.severity === "critical" ? "🔴 CRITICAL" : "🟡 SIGNIFICANT";
      sections.push(
        `### ${severityLabel}: ${asym.displayName} (${asym.asymmetryPercentage}%)`
      );
      sections.push(`- Deficit Limb: **${asym.deficitLimb}**`);
      sections.push(
        `- Left: ${asym.leftValue}${getUnit(asym.metricName)}, Right: ${asym.rightValue}${getUnit(asym.metricName)}`
      );
      if (asym.deficitBenchmark) {
        sections.push(`- Deficit limb benchmark: ${asym.deficitBenchmark}`);
      }
      sections.push("");
    }
  }

  // Section 2: Potential Correlations
  if (correlations.length > 0) {
    sections.push("## Potential Correlations (Validate & Expand)\n");
    sections.push(
      "The following patterns have been detected. Validate these against the metrics and explain the clinical significance:\n"
    );

    for (const corr of correlations) {
      const confLabel =
        corr.confidence >= 0.8
          ? "HIGH"
          : corr.confidence >= 0.6
            ? "MODERATE"
            : "LOW";
      sections.push(`### ${corr.type.replace(/_/g, " ").toUpperCase()} (${confLabel} confidence)`);
      sections.push(`- ${corr.description}`);
      sections.push(`- Domains: ${corr.domains.join(", ")}`);
      if (corr.limb) {
        sections.push(`- Limb: ${corr.limb}`);
      }
      sections.push(`- Metrics: ${corr.metrics.join(", ")}`);
      sections.push("");
    }
  }

  // Section 3: Guidance
  if (sections.length > 0) {
    sections.push("## Instructions\n");
    sections.push(
      "1. Use this pre-computed data to inform your correlative insights"
    );
    sections.push(
      "2. Validate the detected patterns against actual metric values"
    );
    sections.push("3. Explain the clinical significance of confirmed correlations");
    sections.push(
      "4. Look for additional non-obvious patterns not detected here"
    );
    sections.push(
      "5. ALWAYS specify limb explicitly: 'Left Leg' or 'Right Leg' (never 'affected limb')"
    );
    sections.push("");
  }

  return sections.length > 0 ? sections.join("\n") : "";
}

/**
 * Get unit string for a metric.
 */
function getUnit(metricName: string): string {
  const config = METRIC_REGISTRY[metricName];
  return config?.unit || "";
}

