/**
 * Overall Performance Index (OPI) v1.2.2
 * Composite scoring system for biomechanical metrics.
 *
 * Based on: docs/recording-metrics-calculations/opi-v1.2.2-audited.md
 */

import type {
  MetricConfig,
  DomainScore,
  DomainScoreContributor,
  OPIResult,
  OPIGrade,
  OPIDomain,
  ActivityProfile,
  FullAnalysisResult,
} from "./types";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const DOMAINS: OPIDomain[] = ["symmetry", "power", "control", "stability"];

const METHODOLOGY_CITATIONS = [
  "Reliability weighting: Daryabeygi-Khotbehsara et al. Appl Bionics Biomech. 2019",
  "SEM calculation: Weir JP. J Strength Cond Res. 2005;19(1):231-240",
  "MDC95 formula: Haley SM, Fragala-Pinkham MA. Phys Ther. 2006;86(5):735-743",
  "Grade scale: Adapted from FMS framework (Cook et al. 2014)",
];

// Clinical flag thresholds
const CLINICAL_THRESHOLDS = {
  ASYMMETRY_HIGH: 15,
  SPARC_POOR: -3,
  RSI_LOW: 1.0,
} as const;

// ─────────────────────────────────────────────────────────────────
// Metric Configurations (14 metrics)
// ─────────────────────────────────────────────────────────────────

export const METRIC_CONFIGS: MetricConfig[] = [
  // === SYMMETRY DOMAIN ===
  {
    name: "rom_asymmetry",
    domain: "symmetry",
    direction: "lower_better",
    goodThreshold: 5,
    poorThreshold: 15,
    weight: 1.0,
    icc: 0.82,
    citation: "Sadeghi et al. Gait Posture 2000; Forczek & Staszkiewicz J Human Kinetics 2012",
    bilateral: true,
    unilateral: false,
  },
  {
    name: "velocity_asymmetry",
    domain: "symmetry",
    direction: "lower_better",
    goodThreshold: 8,
    poorThreshold: 20,
    weight: 1.0,
    icc: 0.8,
    citation: "Derived from ROM asymmetry principles",
    bilateral: true,
    unilateral: false,
  },
  {
    name: "cross_correlation",
    domain: "symmetry",
    direction: "higher_better",
    goodThreshold: 0.95,
    poorThreshold: 0.75,
    weight: 1.2,
    icc: 0.88,
    citation: "Signal processing; >0.9 = high similarity",
    bilateral: true,
    unilateral: false,
  },
  {
    name: "real_asymmetry_avg",
    domain: "symmetry",
    direction: "lower_better",
    goodThreshold: 5,
    poorThreshold: 20,
    weight: 1.3,
    icc: 0.82,
    citation: "Novel convolution-based separation; reliability estimated",
    bilateral: true,
    unilateral: true,
  },

  // === POWER DOMAIN ===
  {
    name: "RSI",
    domain: "power",
    direction: "higher_better",
    goodThreshold: 2.0,
    poorThreshold: 1.0,
    weight: 1.5,
    icc: 0.91,
    citation: "Flanagan & Comyns 2008; Sole et al. 2018",
    bilateral: true,
    unilateral: true,
  },
  {
    name: "jump_height_cm",
    domain: "power",
    direction: "higher_better",
    goodThreshold: 35,
    poorThreshold: 20,
    weight: 1.3,
    icc: 0.93,
    citation: "Sole et al. Sports 2018 - NCAA D1 norms",
    bilateral: true,
    unilateral: true,
  },
  {
    name: "peak_angular_velocity",
    domain: "power",
    direction: "higher_better",
    goodThreshold: 400,
    poorThreshold: 200,
    weight: 1.0,
    icc: 0.87,
    citation: "Biomechanics literature; sport-specific",
    bilateral: true,
    unilateral: true,
  },
  {
    name: "explosiveness_concentric",
    domain: "power",
    direction: "higher_better",
    goodThreshold: 500,
    poorThreshold: 200,
    weight: 1.0,
    icc: 0.83,
    citation: "Acceleration during concentric phase",
    bilateral: true,
    unilateral: true,
  },

  // === CONTROL (SMOOTHNESS) DOMAIN ===
  {
    name: "SPARC",
    domain: "control",
    direction: "higher_better", // Less negative = better
    goodThreshold: -1.5,
    poorThreshold: -3.0,
    weight: 1.3,
    icc: 0.91,
    citation: "Balasubramanian et al. 2015; Beck et al. 2018; Leclercq et al. 2024",
    bilateral: true,
    unilateral: true,
  },
  {
    name: "LDLJ",
    domain: "control",
    direction: "higher_better", // Less negative = better
    goodThreshold: -6,
    poorThreshold: -10,
    weight: 1.0,
    icc: 0.85,
    citation: "Balasubramanian et al. 2015; Leclercq et al. 2024",
    bilateral: true,
    unilateral: true,
  },
  {
    name: "n_velocity_peaks",
    domain: "control",
    direction: "lower_better",
    goodThreshold: 1,
    poorThreshold: 5,
    weight: 0.8,
    icc: 0.75,
    citation: "Smoothness literature - fewer peaks = smoother",
    bilateral: true,
    unilateral: true,
  },
  {
    name: "rms_jerk",
    domain: "control",
    direction: "lower_better",
    goodThreshold: 500,
    poorThreshold: 2000,
    weight: 0.9,
    icc: 0.8,
    citation: "Jerk minimization principle; Flash & Hogan 1985",
    bilateral: true,
    unilateral: true,
  },

  // === STABILITY DOMAIN ===
  {
    name: "rom_cov",
    domain: "stability",
    direction: "lower_better",
    goodThreshold: 5,
    poorThreshold: 15,
    weight: 1.0,
    icc: 0.8,
    citation: "Movement variability; CV <10% acceptable",
    bilateral: true,
    unilateral: true,
  },
  {
    name: "ground_contact_time",
    domain: "stability",
    direction: "optimal_range",
    optimalMin: 150,
    optimalMax: 250,
    goodThreshold: 200,
    poorThreshold: 350,
    weight: 1.0,
    icc: 0.9,
    citation: "Flanagan & Comyns 2008 - <250ms = fast SSC",
    bilateral: true,
    unilateral: true,
  },
];

// Domain weights by activity profile
export const DOMAIN_WEIGHTS: Record<ActivityProfile, Record<OPIDomain, number>> = {
  power: { symmetry: 0.15, power: 0.4, control: 0.25, stability: 0.2 },
  endurance: { symmetry: 0.3, power: 0.1, control: 0.25, stability: 0.35 },
  rehabilitation: { symmetry: 0.35, power: 0.1, control: 0.3, stability: 0.25 },
  general: { symmetry: 0.25, power: 0.25, control: 0.25, stability: 0.25 },
};

// ─────────────────────────────────────────────────────────────────
// Metric Value Extraction
// ─────────────────────────────────────────────────────────────────

/** Maps our metric structure to OPI input format. */
export function extractMetricsForOPI(
  metrics: FullAnalysisResult
): Map<string, number> {
  const result = new Map<string, number>();

  // Symmetry metrics
  if (metrics.bilateralAnalysis) {
    result.set("rom_asymmetry", metrics.bilateralAnalysis.asymmetryIndices.averageROM);
    result.set("velocity_asymmetry", metrics.bilateralAnalysis.asymmetryIndices.peakAngularVelocity);
    result.set("cross_correlation", metrics.bilateralAnalysis.temporalAsymmetry.crossCorrelation);
  }

  if (metrics.advancedAsymmetry) {
    result.set("real_asymmetry_avg", metrics.advancedAsymmetry.avgRealAsymmetry);
  }

  // Power metrics
  if (metrics.jumpMetrics) {
    result.set("RSI", metrics.jumpMetrics.rsi);
    result.set("jump_height_cm", metrics.jumpMetrics.jumpHeightCm);
    result.set("ground_contact_time", metrics.jumpMetrics.groundContactTimeMs);
  }

  // Average of both legs for per-leg metrics
  if (metrics.leftLeg && metrics.rightLeg) {
    const avgVelocity = (metrics.leftLeg.peakAngularVelocity + metrics.rightLeg.peakAngularVelocity) / 2;
    const avgExplosiveness = (metrics.leftLeg.explosivenessConcentric + metrics.rightLeg.explosivenessConcentric) / 2;
    const avgJerk = (metrics.leftLeg.rmsJerk + metrics.rightLeg.rmsJerk) / 2;
    const avgCoV = (metrics.leftLeg.romCoV + metrics.rightLeg.romCoV) / 2;

    result.set("peak_angular_velocity", avgVelocity);
    result.set("explosiveness_concentric", avgExplosiveness);
    result.set("rms_jerk", avgJerk);
    result.set("rom_cov", avgCoV);
  }

  // Smoothness metrics
  if (metrics.smoothnessMetrics) {
    result.set("SPARC", metrics.smoothnessMetrics.sparc);
    result.set("LDLJ", metrics.smoothnessMetrics.ldlj);
    result.set("n_velocity_peaks", metrics.smoothnessMetrics.nVelocityPeaks);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────
// Normalization
// ─────────────────────────────────────────────────────────────────

interface NormalizedMetric {
  score: number;
  confidence: number;
}

/** Normalize raw metric value to 0-100 score. */
export function normalizeMetric(
  value: number,
  config: MetricConfig
): NormalizedMetric {
  if (value === null || value === undefined || isNaN(value)) {
    return { score: -1, confidence: 0 };
  }

  let score: number;

  if (config.direction === "higher_better") {
    if (value >= config.goodThreshold) {
      score = 100;
    } else if (value <= config.poorThreshold) {
      score = 0;
    } else {
      score = ((value - config.poorThreshold) /
        (config.goodThreshold - config.poorThreshold)) * 100;
    }
  } else if (config.direction === "lower_better") {
    if (value <= config.goodThreshold) {
      score = 100;
    } else if (value >= config.poorThreshold) {
      score = 0;
    } else {
      score = ((config.poorThreshold - value) /
        (config.poorThreshold - config.goodThreshold)) * 100;
    }
  } else {
    // optimal_range
    const optMin = config.optimalMin!;
    const optMax = config.optimalMax!;
    if (value >= optMin && value <= optMax) {
      score = 100;
    } else {
      const range = optMax - optMin;
      const distance = value < optMin ? optMin - value : value - optMax;
      score = Math.max(0, 100 - (distance / range) * 100);
    }
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    confidence: config.icc * 100,
  };
}

// ─────────────────────────────────────────────────────────────────
// Domain Score Calculation
// ─────────────────────────────────────────────────────────────────

/** Calculate score for a single domain. */
export function calculateDomainScore(
  metrics: Map<string, number>,
  domain: OPIDomain,
  movementType: "bilateral" | "unilateral"
): DomainScore {
  const configs = METRIC_CONFIGS.filter((c) => c.domain === domain);
  const contributors: DomainScoreContributor[] = [];

  let weightedSum = 0;
  let totalWeight = 0;
  let sumSquaredSEM = 0;

  for (const config of configs) {
    // Skip metrics not applicable to movement type
    if (movementType === "bilateral" && !config.bilateral) continue;
    if (movementType === "unilateral" && !config.unilateral) continue;

    const value = metrics.get(config.name);
    if (value === undefined) continue;

    const { score, confidence } = normalizeMetric(value, config);
    if (score < 0) continue;

    // Reliability-weighted contribution (CGAM-inspired)
    const reliabilityWeight = config.weight * config.icc;

    weightedSum += score * reliabilityWeight;
    totalWeight += reliabilityWeight;

    // Estimate SEM contribution
    const metricSEM = (1 - config.icc) * score * 0.1;
    sumSquaredSEM += metricSEM ** 2;

    contributors.push({
      name: config.name,
      raw: value,
      normalized: score,
      weight: reliabilityWeight,
      citation: config.citation,
    });
  }

  const domainScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const combinedSEM = Math.sqrt(sumSquaredSEM);

  const applicableConfigs = configs.filter((c) =>
    movementType === "bilateral" ? c.bilateral : c.unilateral
  );
  const avgConfidence =
    contributors.length > 0
      ? (contributors.reduce((s, c) => s + c.weight, 0) /
          contributors.length /
          applicableConfigs.length) *
        100
      : 0;

  return {
    domain,
    score: Math.round(domainScore * 10) / 10,
    confidence: Math.round(avgConfidence),
    sem: Math.round(combinedSEM * 10) / 10,
    contributors,
  };
}

// ─────────────────────────────────────────────────────────────────
// Main OPI Calculation
// ─────────────────────────────────────────────────────────────────

/** Determine grade from overall score. */
function scoreToGrade(score: number): OPIGrade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

/** Generate clinical flags based on metric values. */
function generateClinicalFlags(metrics: Map<string, number>): string[] {
  const flags: string[] = [];

  const asymmetry =
    metrics.get("real_asymmetry_avg") ?? metrics.get("rom_asymmetry") ?? 0;
  if (asymmetry > CLINICAL_THRESHOLDS.ASYMMETRY_HIGH) {
    flags.push(
      `High asymmetry (${asymmetry.toFixed(1)}%) - >15% threshold [Sadeghi 2000]`
    );
  }

  const sparc = metrics.get("SPARC") ?? 0;
  if (sparc < CLINICAL_THRESHOLDS.SPARC_POOR) {
    flags.push(
      `Poor smoothness (SPARC=${sparc.toFixed(2)}) - <-3.0 threshold [Beck 2018]`
    );
  }

  const rsi = metrics.get("RSI") ?? 0;
  if (rsi > 0 && rsi < CLINICAL_THRESHOLDS.RSI_LOW) {
    flags.push(
      `Low reactive strength (RSI=${rsi.toFixed(2)}) - <1.0 threshold [Flanagan 2008]`
    );
  }

  return flags;
}

/** Calculate Overall Performance Index from full analysis result. */
export function calculateOPI(
  analysisResult: FullAnalysisResult,
  activityProfile: ActivityProfile = "general"
): OPIResult {
  // Determine movement type
  const movementType: "bilateral" | "unilateral" =
    analysisResult.movementClassification.type === "bilateral" ||
    analysisResult.movementClassification.type === "mixed"
      ? "bilateral"
      : "unilateral";

  // Extract metrics to Map
  const metrics = extractMetricsForOPI(analysisResult);

  // Calculate domain scores
  const domainScores = DOMAINS.map((d) =>
    calculateDomainScore(metrics, d, movementType)
  );

  // Calculate weighted overall score
  const weights = DOMAIN_WEIGHTS[activityProfile];
  let overallScore = 0;
  let totalWeight = 0;
  let sumSquaredSEM = 0;

  for (const ds of domainScores) {
    const w = weights[ds.domain] || 0.25;
    const effectiveW = w * (ds.confidence / 100 || 0.5); // Default 0.5 if no confidence

    overallScore += ds.score * effectiveW;
    totalWeight += effectiveW;
    sumSquaredSEM += (ds.sem * effectiveW) ** 2;
  }

  if (totalWeight > 0) {
    overallScore /= totalWeight;
  }

  // Uncertainty calculations
  const sem = Math.sqrt(sumSquaredSEM) / Math.max(totalWeight, 0.01);
  const mdc95 = sem * 2.77; // MDC95 = SEM * 1.96 * sqrt(2)

  const confidenceInterval = {
    lower: Math.max(0, overallScore - 1.96 * sem),
    upper: Math.min(100, overallScore + 1.96 * sem),
  };

  // Extract insights
  const allContributors = domainScores.flatMap((ds) => ds.contributors);
  const strengths = allContributors
    .filter((c) => c.normalized >= 80)
    .map((c) => `${c.name}: ${c.normalized.toFixed(0)}/100`);
  const weaknesses = allContributors
    .filter((c) => c.normalized < 50)
    .map((c) => `${c.name}: ${c.normalized.toFixed(0)}/100`);

  // Clinical flags
  const clinicalFlags = generateClinicalFlags(metrics);

  // Data completeness
  const possibleMetrics = METRIC_CONFIGS.filter((c) =>
    movementType === "bilateral" ? c.bilateral : c.unilateral
  ).length;
  const dataCompleteness = (allContributors.length / possibleMetrics) * 100;

  return {
    overallScore: Math.round(overallScore * 10) / 10,
    grade: scoreToGrade(overallScore),
    confidenceInterval: {
      lower: Math.round(confidenceInterval.lower * 10) / 10,
      upper: Math.round(confidenceInterval.upper * 10) / 10,
    },
    sem: Math.round(sem * 10) / 10,
    mdc95: Math.round(mdc95 * 10) / 10,
    domainScores,
    strengths,
    weaknesses,
    clinicalFlags,
    movementType,
    activityProfile,
    dataCompleteness: Math.round(dataCompleteness),
    methodologyCitations: METHODOLOGY_CITATIONS,
  };
}
