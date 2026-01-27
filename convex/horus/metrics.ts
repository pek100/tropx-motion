/**
 * Horus Metric Registry
 *
 * Single source of truth for all 21 dashboard metrics.
 * All names use camelCase to match existing codebase.
 */

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type MetricDomain = "range" | "symmetry" | "power" | "control" | "timing";
export type MetricDirection = "higherBetter" | "lowerBetter";
export type MetricScope = "perLeg" | "bilateral";
export type SpecificLimb = "Left Leg" | "Right Leg";
export type QualityTier = "S" | "A" | "B" | "C" | "D";

export interface MetricConfig {
  name: string;
  displayName: string;
  domain: MetricDomain;
  direction: MetricDirection;
  scope: MetricScope;
  unit: string;
  goodThreshold: number;
  poorThreshold: number;
  /** Intra-class correlation coefficient (reliability) */
  icc: number;
  /** Scientific citation for threshold */
  citation: string;
  /** Whether metric is currently active in OPI */
  activeInOpi: boolean;
  /** Whether metric is meaningful for multi-rep sessions (default: true) */
  meaningful: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Metric Registry (21 Dashboard Metrics)
// ─────────────────────────────────────────────────────────────────

export const METRIC_REGISTRY: Record<string, MetricConfig> = {
  // ═══════════════════════════════════════════════════════════════
  // RANGE DOMAIN (Per-Leg)
  // ═══════════════════════════════════════════════════════════════
  overallMaxRom: {
    name: "overallMaxRom",
    displayName: "Maximum ROM",
    domain: "range",
    direction: "higherBetter",
    scope: "perLeg",
    unit: "°",
    goodThreshold: 120,
    poorThreshold: 90,
    icc: 0.92,
    citation: "Knee flexion norms",
    activeInOpi: false,
    meaningful: true,
  },
  averageRom: {
    name: "averageRom",
    displayName: "Average ROM",
    domain: "range",
    direction: "higherBetter",
    scope: "perLeg",
    unit: "°",
    goodThreshold: 100,
    poorThreshold: 70,
    icc: 0.90,
    citation: "Knee flexion norms",
    activeInOpi: false,
    meaningful: true,
  },
  peakFlexion: {
    name: "peakFlexion",
    displayName: "Peak Flexion",
    domain: "range",
    direction: "higherBetter",
    scope: "perLeg",
    unit: "°",
    goodThreshold: 125,
    poorThreshold: 95,
    icc: 0.91,
    citation: "Knee flexion norms",
    activeInOpi: false,
    meaningful: true,
  },
  peakExtension: {
    name: "peakExtension",
    displayName: "Peak Extension",
    domain: "range",
    direction: "lowerBetter", // Closer to 0 is better
    scope: "perLeg",
    unit: "°",
    goodThreshold: 5,
    poorThreshold: 15,
    icc: 0.88,
    citation: "Full extension = 0°",
    activeInOpi: false,
    meaningful: true,
  },

  // ═══════════════════════════════════════════════════════════════
  // SYMMETRY DOMAIN (Bilateral)
  // ═══════════════════════════════════════════════════════════════
  romAsymmetry: {
    name: "romAsymmetry",
    displayName: "ROM Asymmetry",
    domain: "symmetry",
    direction: "lowerBetter",
    scope: "bilateral",
    unit: "%",
    goodThreshold: 5,
    poorThreshold: 15,
    icc: 0.82,
    citation: "Sadeghi et al. Gait Posture 2000",
    activeInOpi: true,
    meaningful: true,
  },
  velocityAsymmetry: {
    name: "velocityAsymmetry",
    displayName: "Velocity Asymmetry",
    domain: "symmetry",
    direction: "lowerBetter",
    scope: "bilateral",
    unit: "%",
    goodThreshold: 8,
    poorThreshold: 20,
    icc: 0.80,
    citation: "Derived from ROM asymmetry principles",
    activeInOpi: true,
    meaningful: true,
  },
  crossCorrelation: {
    name: "crossCorrelation",
    displayName: "Movement Synchronization",
    domain: "symmetry",
    direction: "higherBetter",
    scope: "bilateral",
    unit: "",
    goodThreshold: 0.95,
    poorThreshold: 0.75,
    icc: 0.88,
    citation: "Signal processing; >0.9 = high similarity",
    activeInOpi: true,
    meaningful: true,
  },
  realAsymmetryAvg: {
    name: "realAsymmetryAvg",
    displayName: "True Asymmetry",
    domain: "symmetry",
    direction: "lowerBetter",
    scope: "bilateral",
    unit: "°",
    goodThreshold: 5,
    poorThreshold: 20,
    icc: 0.82,
    citation: "Novel convolution-based separation",
    activeInOpi: true,
    meaningful: true,
  },
  netGlobalAsymmetry: {
    name: "netGlobalAsymmetry",
    displayName: "Net Global Asymmetry",
    domain: "symmetry",
    direction: "lowerBetter",
    scope: "bilateral",
    unit: "%",
    goodThreshold: 8,
    poorThreshold: 20,
    icc: 0.85,
    citation: "Weighted composite across parameters",
    activeInOpi: false,
    meaningful: true,
  },

  // ═══════════════════════════════════════════════════════════════
  // POWER DOMAIN (Per-Leg)
  // ═══════════════════════════════════════════════════════════════
  peakAngularVelocity: {
    name: "peakAngularVelocity",
    displayName: "Peak Velocity",
    domain: "power",
    direction: "higherBetter",
    scope: "perLeg",
    unit: "°/s",
    goodThreshold: 400,
    poorThreshold: 200,
    icc: 0.87,
    citation: "Biomechanics literature; sport-specific",
    activeInOpi: true,
    meaningful: true,
  },
  explosivenessConcentric: {
    name: "explosivenessConcentric",
    displayName: "Concentric Power",
    domain: "power",
    direction: "higherBetter",
    scope: "perLeg",
    unit: "°/s²",
    goodThreshold: 500,
    poorThreshold: 200,
    icc: 0.83,
    citation: "Acceleration during concentric phase",
    activeInOpi: true,
    meaningful: true,
  },
  explosivenessLoading: {
    name: "explosivenessLoading",
    displayName: "Loading Power",
    domain: "power",
    direction: "higherBetter",
    scope: "perLeg",
    unit: "°/s²",
    goodThreshold: 500,
    poorThreshold: 200,
    icc: 0.83,
    citation: "Acceleration during eccentric phase",
    activeInOpi: false,
    meaningful: true,
  },

  // ═══════════════════════════════════════════════════════════════
  // CONTROL DOMAIN (Per-Leg) - Disabled in OPI
  // ═══════════════════════════════════════════════════════════════
  rmsJerk: {
    name: "rmsJerk",
    displayName: "Movement Smoothness",
    domain: "control",
    direction: "lowerBetter",
    scope: "perLeg",
    unit: "°/s³",
    goodThreshold: 300,
    poorThreshold: 800,
    icc: 0.80,
    citation: "Jerk minimization principle; Flash & Hogan 1985",
    activeInOpi: false,
    meaningful: true,
  },
  romCoV: {
    name: "romCoV",
    displayName: "Movement Consistency",
    domain: "control",
    direction: "lowerBetter",
    scope: "perLeg",
    unit: "%",
    goodThreshold: 8,
    poorThreshold: 20,
    icc: 0.80,
    citation: "Movement variability; CV <10% acceptable",
    activeInOpi: false,
    meaningful: false, // Meaningless for multi-rep sessions - measures variability across reps, not stability
  },

  // ═══════════════════════════════════════════════════════════════
  // TIMING DOMAIN (Bilateral)
  // ═══════════════════════════════════════════════════════════════
  phaseShift: {
    name: "phaseShift",
    displayName: "Phase Offset",
    domain: "timing",
    direction: "lowerBetter",
    scope: "bilateral",
    unit: "°",
    goodThreshold: 10,
    poorThreshold: 30,
    icc: 0.85,
    citation: "Bilateral timing synchronization",
    activeInOpi: false,
    meaningful: true,
  },
  temporalLag: {
    name: "temporalLag",
    displayName: "Timing Delay",
    domain: "timing",
    direction: "lowerBetter",
    scope: "bilateral",
    unit: "ms",
    goodThreshold: 30,
    poorThreshold: 80,
    icc: 0.85,
    citation: "Interlimb timing",
    activeInOpi: false,
    meaningful: true,
  },
  maxFlexionTimingDiff: {
    name: "maxFlexionTimingDiff",
    displayName: "Peak Timing Difference",
    domain: "timing",
    direction: "lowerBetter",
    scope: "bilateral",
    unit: "ms",
    goodThreshold: 50,
    poorThreshold: 150,
    icc: 0.82,
    citation: "Temporal coordination of peak flexion",
    activeInOpi: false,
    meaningful: true,
  },
};

// ─────────────────────────────────────────────────────────────────
// Derived Lists
// ─────────────────────────────────────────────────────────────────

export const ALL_METRICS = Object.keys(METRIC_REGISTRY);

export const PER_LEG_METRICS = ALL_METRICS.filter(
  (m) => METRIC_REGISTRY[m].scope === "perLeg"
);

export const BILATERAL_METRICS = ALL_METRICS.filter(
  (m) => METRIC_REGISTRY[m].scope === "bilateral"
);

export const METRICS_BY_DOMAIN: Record<MetricDomain, string[]> = {
  range: ALL_METRICS.filter((m) => METRIC_REGISTRY[m].domain === "range"),
  symmetry: ALL_METRICS.filter((m) => METRIC_REGISTRY[m].domain === "symmetry"),
  power: ALL_METRICS.filter((m) => METRIC_REGISTRY[m].domain === "power"),
  control: ALL_METRICS.filter((m) => METRIC_REGISTRY[m].domain === "control"),
  timing: ALL_METRICS.filter((m) => METRIC_REGISTRY[m].domain === "timing"),
};

export const OPI_ACTIVE_METRICS = ALL_METRICS.filter(
  (m) => METRIC_REGISTRY[m].activeInOpi
);

/** Metrics that are meaningful for multi-rep sessions */
export const MEANINGFUL_METRICS = ALL_METRICS.filter(
  (m) => METRIC_REGISTRY[m].meaningful
);

// ─────────────────────────────────────────────────────────────────
// Quality Tier Utilities
// ─────────────────────────────────────────────────────────────────

export const QUALITY_TIER_VALUES: Record<QualityTier, number> = {
  S: 5,
  A: 4,
  B: 3,
  C: 2,
  D: 1,
};

export function compareTiers(a: QualityTier, b: QualityTier): number {
  return QUALITY_TIER_VALUES[a] - QUALITY_TIER_VALUES[b];
}

export function tierAtLeast(tier: QualityTier, minimum: QualityTier): boolean {
  return QUALITY_TIER_VALUES[tier] >= QUALITY_TIER_VALUES[minimum];
}

// ─────────────────────────────────────────────────────────────────
// Benchmark Utilities
// ─────────────────────────────────────────────────────────────────

export type BenchmarkCategory = "optimal" | "average" | "deficient";
export type Classification = "strength" | "weakness";

export function getBenchmarkCategory(
  value: number,
  config: MetricConfig
): BenchmarkCategory {
  const { direction, goodThreshold, poorThreshold } = config;

  if (direction === "higherBetter") {
    if (value >= goodThreshold) return "optimal";
    if (value <= poorThreshold) return "deficient";
    return "average";
  } else {
    if (value <= goodThreshold) return "optimal";
    if (value >= poorThreshold) return "deficient";
    return "average";
  }
}

export function calculatePercentile(value: number, config: MetricConfig): number {
  const { direction, goodThreshold, poorThreshold } = config;
  const range = Math.abs(goodThreshold - poorThreshold);

  // Guard: avoid division by zero
  if (range === 0) return 50;

  if (direction === "higherBetter") {
    if (value >= goodThreshold) {
      return Math.min(100, 90 + ((value - goodThreshold) / goodThreshold) * 10);
    }
    if (value <= poorThreshold) {
      return Math.max(0, (value / Math.max(poorThreshold, 1)) * 10);
    }
    return 10 + ((value - poorThreshold) / range) * 80;
  } else {
    if (value <= goodThreshold) {
      return Math.min(100, 90 + ((goodThreshold - value) / Math.max(goodThreshold, 1)) * 10);
    }
    if (value >= poorThreshold) {
      return Math.max(0, ((poorThreshold - value) / Math.max(poorThreshold, 1)) * 10 + 10);
    }
    return 10 + ((poorThreshold - value) / range) * 80;
  }
}

/**
 * Force classification to strength or weakness (no neutral).
 * Uses percentile 55 as tiebreaker for average category.
 */
export function forceClassification(
  category: BenchmarkCategory,
  percentile: number
): Classification {
  if (category === "optimal") return "strength";
  if (category === "deficient") return "weakness";
  return percentile >= 55 ? "strength" : "weakness";
}

// ─────────────────────────────────────────────────────────────────
// Asymmetry Utilities (Direction-Aware)
// ─────────────────────────────────────────────────────────────────

export interface AsymmetryResult {
  percentage: number;
  absoluteDiff: number;
  deficitLimb: SpecificLimb | null;
}

/**
 * Calculate asymmetry between two limb values.
 * Direction-aware: determines which limb has the deficit based on metric direction.
 */
export function calculateAsymmetry(
  leftValue: number,
  rightValue: number,
  direction: MetricDirection
): AsymmetryResult {
  const sum = leftValue + rightValue;

  // Guard: avoid division by zero
  if (sum === 0) {
    return { percentage: 0, absoluteDiff: 0, deficitLimb: null };
  }

  const absoluteDiff = Math.abs(leftValue - rightValue);
  const percentage = (200 * absoluteDiff) / sum;

  // Determine deficit limb based on direction
  let deficitLimb: SpecificLimb | null = null;
  if (leftValue !== rightValue) {
    if (direction === "higherBetter") {
      // Lower value = deficit
      deficitLimb = leftValue < rightValue ? "Left Leg" : "Right Leg";
    } else {
      // Higher value = deficit (for lower_better metrics)
      deficitLimb = leftValue > rightValue ? "Left Leg" : "Right Leg";
    }
  }

  return { percentage, absoluteDiff, deficitLimb };
}

// ─────────────────────────────────────────────────────────────────
// Domain Colors (For UI)
// ─────────────────────────────────────────────────────────────────

export const DOMAIN_COLORS: Record<MetricDomain, string> = {
  range: "#10B981", // Emerald
  symmetry: "#8B5CF6", // Violet
  power: "#F97316", // Orange
  control: "#06B6D4", // Cyan
  timing: "#EC4899", // Pink
};

export const LIMB_COLORS = {
  leftLeg: "#3B82F6", // Blue
  rightLeg: "#EF4444", // Red
} as const;

// ─────────────────────────────────────────────────────────────────
// Clinical Thresholds
// ─────────────────────────────────────────────────────────────────

export const CLINICAL_THRESHOLDS = {
  /** Asymmetry requiring clinical attention (>15%) */
  ASYMMETRY_HIGH: 15,
  /** Asymmetry considered significant (>10%) */
  ASYMMETRY_MODERATE: 10,
  /** Asymmetry considered minimal (<5%) */
  ASYMMETRY_LOW: 5,
  /** Cross-correlation for bilateral classification */
  BILATERAL_CORRELATION: 0.7,
} as const;

// ─────────────────────────────────────────────────────────────────
// MCID Values (Minimal Clinically Important Difference)
// ─────────────────────────────────────────────────────────────────

export const MCID = {
  rom: 10, // degrees
  velocity: 50, // °/s absolute
  velocityPercentage: 15, // %
  asymmetry: 5, // percentage points
  jerk: 100, // °/s³
  opiScore: 5, // points
  crossCorrelation: 0.05, // ratio
} as const;
