/**
 * Metrics Vector Utilities
 *
 * Converts session metrics to 32-dimensional vectors for
 * similarity search and baseline comparison in Cross-Analysis.
 *
 * Vector Layout (32 dimensions):
 * - Dims 0-6:   Range metrics
 * - Dims 7-14:  Symmetry metrics
 * - Dims 15-23: Power metrics
 * - Dims 24-31: Smoothness metrics
 */

import type { SessionMetrics } from "../types";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

export const VECTOR_DIMENSIONS = 32;

/**
 * Metric index mapping for the 32-dimensional vector.
 * Each metric has a normalization range and direction.
 */
export const METRIC_INDEX_MAP: Record<
  number,
  {
    name: string;
    displayName: string;
    source: "leftLeg" | "rightLeg" | "bilateral" | "smoothness" | "computed";
    key: string;
    minValue: number;
    maxValue: number;
    direction: "higherBetter" | "lowerBetter";
  }
> = {
  // ─── Range metrics (0-6) ───
  0: {
    name: "avgMaxROM",
    displayName: "Average Max ROM",
    source: "computed",
    key: "avgMaxROM",
    minValue: 0,
    maxValue: 180,
    direction: "higherBetter",
  },
  1: {
    name: "avgPeakFlexion",
    displayName: "Average Peak Flexion",
    source: "computed",
    key: "avgPeakFlexion",
    minValue: 0,
    maxValue: 180,
    direction: "higherBetter",
  },
  2: {
    name: "avgPeakExtension",
    displayName: "Average Peak Extension",
    source: "computed",
    key: "avgPeakExtension",
    minValue: 0,
    maxValue: 45,
    direction: "lowerBetter", // Closer to 0 is better
  },
  3: {
    name: "leftMaxROM",
    displayName: "Left Max ROM",
    source: "leftLeg",
    key: "overallMaxRom",
    minValue: 0,
    maxValue: 180,
    direction: "higherBetter",
  },
  4: {
    name: "rightMaxROM",
    displayName: "Right Max ROM",
    source: "rightLeg",
    key: "overallMaxRom",
    minValue: 0,
    maxValue: 180,
    direction: "higherBetter",
  },
  5: { name: "reserved1", displayName: "Reserved", source: "computed", key: "", minValue: 0, maxValue: 1, direction: "higherBetter" },
  6: { name: "reserved2", displayName: "Reserved", source: "computed", key: "", minValue: 0, maxValue: 1, direction: "higherBetter" },

  // ─── Symmetry metrics (7-14) - lower is better except crossCorrelation ───
  7: {
    name: "romAsymmetry",
    displayName: "ROM Asymmetry",
    source: "bilateral",
    key: "romAsymmetry",
    minValue: 0,
    maxValue: 50,
    direction: "lowerBetter",
  },
  8: {
    name: "velocityAsymmetry",
    displayName: "Velocity Asymmetry",
    source: "bilateral",
    key: "velocityAsymmetry",
    minValue: 0,
    maxValue: 50,
    direction: "lowerBetter",
  },
  9: {
    name: "crossCorrelation",
    displayName: "Movement Sync",
    source: "bilateral",
    key: "crossCorrelation",
    minValue: 0,
    maxValue: 1,
    direction: "higherBetter", // NOT inverted
  },
  10: {
    name: "realAsymmetryAvg",
    displayName: "True Asymmetry",
    source: "bilateral",
    key: "realAsymmetryAvg",
    minValue: 0,
    maxValue: 45,
    direction: "lowerBetter",
  },
  11: {
    name: "netGlobalAsymmetry",
    displayName: "Global Asymmetry",
    source: "bilateral",
    key: "netGlobalAsymmetry",
    minValue: 0,
    maxValue: 50,
    direction: "lowerBetter",
  },
  12: {
    name: "phaseShift",
    displayName: "Phase Shift",
    source: "bilateral",
    key: "phaseShift",
    minValue: 0,
    maxValue: 90,
    direction: "lowerBetter",
  },
  13: {
    name: "temporalLag",
    displayName: "Temporal Lag",
    source: "bilateral",
    key: "temporalLag",
    minValue: 0,
    maxValue: 200,
    direction: "lowerBetter",
  },
  14: {
    name: "maxFlexionTimingDiff",
    displayName: "Peak Timing Diff",
    source: "bilateral",
    key: "maxFlexionTimingDiff",
    minValue: 0,
    maxValue: 300,
    direction: "lowerBetter",
  },

  // ─── Power metrics (15-23) ───
  15: {
    name: "avgPeakVelocity",
    displayName: "Average Peak Velocity",
    source: "computed",
    key: "avgPeakVelocity",
    minValue: 0,
    maxValue: 600,
    direction: "higherBetter",
  },
  16: {
    name: "avgExplosivenessConcentric",
    displayName: "Average Concentric Power",
    source: "computed",
    key: "avgExplosivenessConcentric",
    minValue: 0,
    maxValue: 1000,
    direction: "higherBetter",
  },
  17: {
    name: "avgExplosivenessLoading",
    displayName: "Average Loading Power",
    source: "computed",
    key: "avgExplosivenessLoading",
    minValue: 0,
    maxValue: 1000,
    direction: "higherBetter",
  },
  18: {
    name: "leftPeakVelocity",
    displayName: "Left Peak Velocity",
    source: "leftLeg",
    key: "peakAngularVelocity",
    minValue: 0,
    maxValue: 600,
    direction: "higherBetter",
  },
  19: {
    name: "rightPeakVelocity",
    displayName: "Right Peak Velocity",
    source: "rightLeg",
    key: "peakAngularVelocity",
    minValue: 0,
    maxValue: 600,
    direction: "higherBetter",
  },
  20: {
    name: "leftExplosiveness",
    displayName: "Left Explosiveness",
    source: "leftLeg",
    key: "explosivenessConcentric",
    minValue: 0,
    maxValue: 1000,
    direction: "higherBetter",
  },
  21: {
    name: "rightExplosiveness",
    displayName: "Right Explosiveness",
    source: "rightLeg",
    key: "explosivenessConcentric",
    minValue: 0,
    maxValue: 1000,
    direction: "higherBetter",
  },
  22: { name: "reserved3", displayName: "Reserved", source: "computed", key: "", minValue: 0, maxValue: 1, direction: "higherBetter" },
  23: { name: "reserved4", displayName: "Reserved", source: "computed", key: "", minValue: 0, maxValue: 1, direction: "higherBetter" },

  // ─── Smoothness metrics (24-31) ───
  24: {
    name: "sparc",
    displayName: "SPARC Smoothness",
    source: "smoothness",
    key: "sparc",
    minValue: -10,
    maxValue: 0,
    direction: "higherBetter", // Less negative = better
  },
  25: {
    name: "ldlj",
    displayName: "LDLJ Smoothness",
    source: "smoothness",
    key: "ldlj",
    minValue: -20,
    maxValue: 0,
    direction: "higherBetter", // Less negative = better
  },
  26: {
    name: "nVelocityPeaks",
    displayName: "Velocity Peaks",
    source: "smoothness",
    key: "nVelocityPeaks",
    minValue: 0,
    maxValue: 20,
    direction: "lowerBetter",
  },
  27: {
    name: "rmsJerk",
    displayName: "RMS Jerk",
    source: "leftLeg", // Average of both legs
    key: "rmsJerk",
    minValue: 0,
    maxValue: 1000,
    direction: "lowerBetter",
  },
  28: { name: "reserved5", displayName: "Reserved", source: "computed", key: "", minValue: 0, maxValue: 1, direction: "higherBetter" },
  29: { name: "reserved6", displayName: "Reserved", source: "computed", key: "", minValue: 0, maxValue: 1, direction: "higherBetter" },
  30: { name: "reserved7", displayName: "Reserved", source: "computed", key: "", minValue: 0, maxValue: 1, direction: "higherBetter" },
  31: { name: "reserved8", displayName: "Reserved", source: "computed", key: "", minValue: 0, maxValue: 1, direction: "higherBetter" },
};

// ─────────────────────────────────────────────────────────────────
// Normalization Functions
// ─────────────────────────────────────────────────────────────────

/**
 * Normalize a metric value to [0, 1] range with direction awareness.
 * For "higherBetter" metrics: normalized = (value - min) / (max - min)
 * For "lowerBetter" metrics: normalized = 1 - (value - min) / (max - min)
 *
 * This means higher normalized values always indicate "better" performance.
 */
export function normalizeMetricValue(
  value: number,
  minValue: number,
  maxValue: number,
  direction: "higherBetter" | "lowerBetter"
): number {
  // Clamp value to range
  const clampedValue = Math.max(minValue, Math.min(maxValue, value));

  // Normalize to [0, 1]
  const range = maxValue - minValue;
  if (range === 0) return 0.5;

  const normalized = (clampedValue - minValue) / range;

  // Invert for "lowerBetter" metrics so higher always means better
  return direction === "lowerBetter" ? 1 - normalized : normalized;
}

/**
 * Denormalize a value back to its original scale.
 */
export function denormalizeMetricValue(
  normalizedValue: number,
  minValue: number,
  maxValue: number,
  direction: "higherBetter" | "lowerBetter"
): number {
  // Invert back for "lowerBetter" metrics
  const value = direction === "lowerBetter" ? 1 - normalizedValue : normalizedValue;

  // Denormalize
  const range = maxValue - minValue;
  return value * range + minValue;
}

// ─────────────────────────────────────────────────────────────────
// Vector Conversion
// ─────────────────────────────────────────────────────────────────

/**
 * Raw metrics extracted from a session before normalization.
 */
export interface RawMetricsForVector {
  opiScore?: number;
  avgMaxROM?: number;
  avgPeakFlexion?: number;
  avgPeakExtension?: number;
  romAsymmetry?: number;
  velocityAsymmetry?: number;
  crossCorrelation?: number;
  realAsymmetryAvg?: number;
  netGlobalAsymmetry?: number;
  phaseShift?: number;
  temporalLag?: number;
  maxFlexionTimingDiff?: number;
  peakAngularVelocity?: number;
  explosivenessConcentric?: number;
  explosivenessLoading?: number;
  leftMaxROM?: number;
  rightMaxROM?: number;
  leftPeakVelocity?: number;
  rightPeakVelocity?: number;
  sparc?: number;
  ldlj?: number;
  nVelocityPeaks?: number;
  rmsJerk?: number;
}

/**
 * Extract raw metrics from SessionMetrics for vectorization.
 */
export function extractRawMetrics(metrics: SessionMetrics): RawMetricsForVector {
  const { leftLeg, rightLeg, bilateral, smoothness, opiScore } = metrics;

  return {
    opiScore,
    // Range (computed averages)
    avgMaxROM: (leftLeg.overallMaxRom + rightLeg.overallMaxRom) / 2,
    avgPeakFlexion: (leftLeg.peakFlexion + rightLeg.peakFlexion) / 2,
    avgPeakExtension: (leftLeg.peakExtension + rightLeg.peakExtension) / 2,
    // Symmetry (bilateral)
    romAsymmetry: bilateral.romAsymmetry,
    velocityAsymmetry: bilateral.velocityAsymmetry,
    crossCorrelation: bilateral.crossCorrelation,
    realAsymmetryAvg: bilateral.realAsymmetryAvg,
    netGlobalAsymmetry: bilateral.netGlobalAsymmetry,
    phaseShift: bilateral.phaseShift,
    temporalLag: bilateral.temporalLag,
    maxFlexionTimingDiff: bilateral.maxFlexionTimingDiff,
    // Power (computed averages)
    peakAngularVelocity: (leftLeg.peakAngularVelocity + rightLeg.peakAngularVelocity) / 2,
    explosivenessConcentric: (leftLeg.explosivenessConcentric + rightLeg.explosivenessConcentric) / 2,
    explosivenessLoading: (leftLeg.explosivenessLoading + rightLeg.explosivenessLoading) / 2,
    // Per-leg values for context
    leftMaxROM: leftLeg.overallMaxRom,
    rightMaxROM: rightLeg.overallMaxRom,
    leftPeakVelocity: leftLeg.peakAngularVelocity,
    rightPeakVelocity: rightLeg.peakAngularVelocity,
    // Smoothness
    sparc: smoothness?.sparc,
    ldlj: smoothness?.ldlj,
    nVelocityPeaks: smoothness?.nVelocityPeaks,
    rmsJerk: (leftLeg.rmsJerk + rightLeg.rmsJerk) / 2,
  };
}

/**
 * Convert SessionMetrics to a 32-dimensional normalized vector.
 * Returns the vector and the raw metrics used.
 */
export function metricsToVector(metrics: SessionMetrics): {
  vector: number[];
  rawMetrics: RawMetricsForVector;
} {
  const raw = extractRawMetrics(metrics);
  const vector: number[] = new Array(VECTOR_DIMENSIONS).fill(0);

  // Fill each dimension
  for (let i = 0; i < VECTOR_DIMENSIONS; i++) {
    const config = METRIC_INDEX_MAP[i];
    if (!config || config.name.startsWith("reserved")) {
      vector[i] = 0.5; // Neutral value for reserved dimensions
      continue;
    }

    let value: number | undefined;

    // Get value based on source
    switch (config.source) {
      case "leftLeg":
        value = config.key === "rmsJerk"
          ? raw.rmsJerk
          : (metrics.leftLeg as Record<string, number>)[config.key];
        break;
      case "rightLeg":
        value = (metrics.rightLeg as Record<string, number>)[config.key];
        break;
      case "bilateral":
        value = (metrics.bilateral as Record<string, number>)[config.key];
        break;
      case "smoothness":
        value = metrics.smoothness?.[config.key as keyof typeof metrics.smoothness];
        break;
      case "computed":
        // Get from raw metrics
        value = (raw as Record<string, number | undefined>)[config.name];
        break;
    }

    // Normalize the value (default to midpoint if missing)
    if (value === undefined || isNaN(value)) {
      vector[i] = 0.5;
    } else {
      vector[i] = normalizeMetricValue(
        value,
        config.minValue,
        config.maxValue,
        config.direction
      );
    }
  }

  return { vector, rawMetrics: raw };
}

// ─────────────────────────────────────────────────────────────────
// Baseline Calculation
// ─────────────────────────────────────────────────────────────────

/**
 * Calculate the median of an array of numbers.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Calculate the standard deviation of an array of numbers.
 */
export function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Calculate median vector from multiple vectors.
 */
export function medianVector(vectors: number[][]): number[] {
  if (vectors.length === 0) return new Array(VECTOR_DIMENSIONS).fill(0.5);

  const result: number[] = [];
  for (let i = 0; i < VECTOR_DIMENSIONS; i++) {
    const values = vectors.map((v) => v[i]).filter((v) => !isNaN(v));
    result.push(median(values));
  }
  return result;
}

/**
 * Calculate standard deviation vector from multiple vectors.
 */
export function stdVector(vectors: number[][]): number[] {
  if (vectors.length < 2) return new Array(VECTOR_DIMENSIONS).fill(0);

  const result: number[] = [];
  for (let i = 0; i < VECTOR_DIMENSIONS; i++) {
    const values = vectors.map((v) => v[i]).filter((v) => !isNaN(v));
    result.push(standardDeviation(values));
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────
// Tag Group Key
// ─────────────────────────────────────────────────────────────────

/**
 * Create a canonical tag group key from session tags.
 * Used to group sessions for baseline calculation.
 *
 * Examples:
 * - ["squat", "power"] -> "power,squat"
 * - ["rehab", "left knee", "acl"] -> "acl,left knee,rehab"
 * - [] -> "_default"
 */
export function createTagGroupKey(tags: string[] | undefined): string {
  if (!tags || tags.length === 0) {
    return "_default";
  }

  // Sort tags alphabetically and join
  return [...tags]
    .map((t) => t.toLowerCase().trim())
    .filter((t) => t.length > 0)
    .sort()
    .join(",");
}

// ─────────────────────────────────────────────────────────────────
// Similarity Calculation
// ─────────────────────────────────────────────────────────────────

/**
 * Calculate cosine similarity between two vectors.
 * Returns value between 0 and 1 (higher = more similar).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Calculate Euclidean distance between two vectors.
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.pow(a[i] - b[i], 2);
  }
  return Math.sqrt(sum);
}

// ─────────────────────────────────────────────────────────────────
// Metric Display Names
// ─────────────────────────────────────────────────────────────────

/**
 * Get display name for a metric by index.
 */
export function getMetricDisplayName(index: number): string {
  return METRIC_INDEX_MAP[index]?.displayName ?? `Metric ${index}`;
}

/**
 * Get all non-reserved metric indices.
 */
export function getActiveMetricIndices(): number[] {
  return Object.keys(METRIC_INDEX_MAP)
    .map(Number)
    .filter((i) => !METRIC_INDEX_MAP[i].name.startsWith("reserved"));
}
