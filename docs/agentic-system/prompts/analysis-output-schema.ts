/**
 * TropX Analysis Agent - Structured Output Schema
 *
 * Design Principles:
 * 1. SIDE SPECIFICITY: Every finding MUST name the specific limb ("Left Leg", "Right Leg")
 * 2. QUALITATIVE CLASSIFICATION: Every metric tagged as "strength" or "weakness" (no neutral)
 * 3. CHART-READY DATA: All insights include visualization-ready data
 * 4. NORMATIVE BENCHMARKING: All values compared to population standards
 * 5. CORRELATIVE INSIGHTS: Non-obvious cross-metric relationships identified
 */

// ═══════════════════════════════════════════════════════════════════════════
// CORE ENUMS & TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** Specific limb - NEVER use "bilateral" or "general" in findings */
export type SpecificLimb = "Left Leg" | "Right Leg";

/** Comparison context */
export type ComparisonType = "left_vs_right" | "vs_normative" | "vs_previous";

/** Qualitative classification - NO NEUTRAL OPTION */
export type Classification = "strength" | "weakness";

/** Severity levels */
export type Severity = "mild" | "moderate" | "severe";

/** Normative benchmark categories */
export type BenchmarkCategory = "optimal" | "average" | "deficient";

/** Domain categories matching UI */
export type Domain = "range" | "symmetry" | "power" | "control" | "timing";

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: INSIGHTS WITH CHARTS
// ═══════════════════════════════════════════════════════════════════════════

export interface AnalysisInsight {
  /** Unique identifier for this insight */
  id: string;

  /** Which domain this insight belongs to */
  domain: Domain;

  /** The specific limb this insight is about - REQUIRED */
  limb: SpecificLimb;

  /** Human-readable title (e.g., "Right Leg Shows Reduced ROM") */
  title: string;

  /** Detailed explanation (2-3 sentences) */
  description: string;

  /** Is this a strength or weakness? NO NEUTRAL! */
  classification: Classification;

  /** How severe is this finding? */
  severity: Severity;

  /** The primary metric driving this insight */
  primaryMetric: MetricValue;

  /** Supporting metrics */
  supportingMetrics: MetricValue[];

  /** Chart data for visualization */
  chartData: InsightChartData;

  /** Confidence in this finding (0-1) */
  confidence: number;

  /** Clinical relevance explanation */
  clinicalRelevance: string;

  /** Action to take based on this insight */
  recommendedAction: string;
}

export interface MetricValue {
  /** Metric name (e.g., "overallMaxRom") */
  name: string;

  /** Display name (e.g., "Maximum Range of Motion") */
  displayName: string;

  /** Raw value */
  value: number;

  /** Unit of measurement */
  unit: string;

  /** Which limb this value is for - REQUIRED */
  limb: SpecificLimb;

  /** Where does this fall vs normative data? */
  benchmarkCategory: BenchmarkCategory;

  /** Percentile ranking (0-100) */
  percentile: number;

  /** Is this a strength or weakness? */
  classification: Classification;
}

export interface InsightChartData {
  /** Chart type recommendation */
  chartType: "bar" | "line" | "comparison" | "gauge" | "sparkline";

  /** Data points for the chart */
  dataPoints: ChartDataPoint[];

  /** Reference lines (e.g., normative thresholds) */
  referenceLines?: ReferenceLine[];

  /** Highlighted regions (e.g., "deficient zone") */
  highlightedRegions?: HighlightedRegion[];
}

export interface ChartDataPoint {
  label: string;
  value: number;
  color?: string;
  limb?: SpecificLimb;
}

export interface ReferenceLine {
  label: string;
  value: number;
  type: "threshold" | "average" | "target";
  color: string;
}

export interface HighlightedRegion {
  label: string;
  min: number;
  max: number;
  color: string;
  opacity: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: CORRELATIVE INSIGHTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Non-obvious relationships between metrics
 * Examples:
 * - "Right Leg timing delay correlates with reduced power output"
 * - "Left Leg ROM limitation appears to cause compensatory jerk increase"
 */
export interface CorrelativeInsight {
  /** Unique identifier */
  id: string;

  /** Human-readable title */
  title: string;

  /** Detailed explanation of the correlation */
  description: string;

  /** The primary (causing/leading) metric */
  primaryMetric: {
    name: string;
    displayName: string;
    value: number;
    unit: string;
    limb: SpecificLimb;
  };

  /** The secondary (affected/lagging) metric */
  secondaryMetric: {
    name: string;
    displayName: string;
    value: number;
    unit: string;
    limb: SpecificLimb;
  };

  /** Type of relationship */
  relationshipType:
    | "causes"           // Primary metric causes secondary
    | "correlates_with"  // They move together
    | "compensates_for"  // Secondary compensates for primary
    | "inhibits"         // Primary limits secondary
    | "precedes";        // Primary happens before secondary (temporal)

  /** Strength of correlation (0-1) */
  correlationStrength: number;

  /** Clinical interpretation */
  clinicalImplication: string;

  /** Is this relationship concerning? */
  concernLevel: "none" | "watch" | "address" | "urgent";

  /** Chart showing the relationship */
  chartData: {
    chartType: "scatter" | "dual_axis" | "connected_bars";
    dataPoints: {
      primaryValue: number;
      secondaryValue: number;
      label?: string;
    }[];
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: NORMATIVE BENCHMARKING (RADAR CHART)
// ═══════════════════════════════════════════════════════════════════════════

export interface NormativeBenchmarking {
  /** Overall assessment */
  overallCategory: BenchmarkCategory;

  /** Demographic used for comparison */
  demographicProfile: {
    ageGroup: string;        // e.g., "25-34"
    activityLevel: string;   // e.g., "recreational"
    activityProfile: string; // e.g., "rehabilitation"
  };

  /** Per-limb benchmarking - SEPARATE FOR EACH LEG */
  leftLeg: LimbBenchmark;
  rightLeg: LimbBenchmark;

  /** Radar chart data for visualization */
  radarChartData: RadarChartData;

  /** Summary statement */
  summaryStatement: string;
}

export interface LimbBenchmark {
  limb: SpecificLimb;

  /** Overall category for this limb */
  overallCategory: BenchmarkCategory;

  /** Domain-level benchmarks */
  domains: {
    domain: Domain;
    score: number;           // 0-100 normalized score
    category: BenchmarkCategory;
    classification: Classification;
    keyMetric: {
      name: string;
      value: number;
      unit: string;
      percentile: number;
    };
  }[];

  /** Strengths for this specific limb */
  strengths: string[];

  /** Weaknesses for this specific limb */
  weaknesses: string[];
}

export interface RadarChartData {
  /** Axes for the radar chart */
  axes: {
    label: string;
    domain: Domain;
    maxValue: number;
  }[];

  /** Data series - one per limb */
  series: {
    name: string;
    limb: SpecificLimb;
    color: string;
    values: number[];  // Matches axes order
  }[];

  /** Optional: normative reference polygon */
  normativeReference?: {
    name: string;
    color: string;
    opacity: number;
    values: number[];
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: QUALITATIVE CLASSIFICATION SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every metric MUST be classified as strength or weakness
 * NO NEUTRAL/AVERAGE/NORMAL without classification
 */
export interface QualitativeClassification {
  /** Strengths grouped by limb */
  strengths: {
    leftLeg: ClassifiedMetric[];
    rightLeg: ClassifiedMetric[];
  };

  /** Weaknesses grouped by limb */
  weaknesses: {
    leftLeg: ClassifiedMetric[];
    rightLeg: ClassifiedMetric[];
  };

  /** Summary counts */
  summary: {
    leftLeg: { strengths: number; weaknesses: number };
    rightLeg: { strengths: number; weaknesses: number };
    total: { strengths: number; weaknesses: number };
  };

  /** Key takeaway statement */
  keyTakeaway: string;
}

export interface ClassifiedMetric {
  /** Metric identifier */
  metricName: string;

  /** Display name */
  displayName: string;

  /** The specific limb - REQUIRED */
  limb: SpecificLimb;

  /** Raw value */
  value: number;

  /** Unit */
  unit: string;

  /** Why is this a strength/weakness? */
  classification: Classification;

  /** Reasoning for classification */
  reason: string;

  /** How far from threshold? */
  thresholdDistance: {
    threshold: number;
    direction: "above" | "below";
    percentage: number;
  };

  /** Priority rank within its category */
  priorityRank: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: RECOMMENDATIONS
// ═══════════════════════════════════════════════════════════════════════════

export interface Recommendation {
  id: string;

  /** Which limb does this apply to? */
  limb: SpecificLimb;

  /** Title of recommendation */
  title: string;

  /** Detailed description */
  description: string;

  /** Priority */
  priority: "high" | "medium" | "low";

  /** Category */
  type: "exercise" | "technique" | "progression" | "caution" | "referral" | "monitoring";

  /** Which weaknesses does this address? */
  addressesWeaknesses: string[];  // Metric names

  /** Expected outcome */
  expectedOutcome: string;

  /** Based on which insight? */
  basedOnInsightId: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPLETE OUTPUT SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

export interface AnalysisAgentOutput {
  /** Session identifier */
  sessionId: string;

  /** When this analysis was generated */
  generatedAt: string;

  /** Schema version for forward compatibility */
  schemaVersion: "1.0.0";

  // ─────────────────────────────────────────────────────────────────────────
  // EXECUTIVE SUMMARY
  // ─────────────────────────────────────────────────────────────────────────

  executiveSummary: {
    /** 2-3 sentence overview */
    overview: string;

    /** Overall status */
    status: "excellent" | "good" | "fair" | "needs_attention" | "concerning";

    /** Top 3 findings (limb-specific) */
    topFindings: {
      limb: SpecificLimb;
      finding: string;
      classification: Classification;
    }[];

    /** Key action item */
    keyAction: string;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // INSIGHTS (with charts)
  // ─────────────────────────────────────────────────────────────────────────

  insights: AnalysisInsight[];

  // ─────────────────────────────────────────────────────────────────────────
  // CORRELATIVE INSIGHTS
  // ─────────────────────────────────────────────────────────────────────────

  correlativeInsights: CorrelativeInsight[];

  // ─────────────────────────────────────────────────────────────────────────
  // NORMATIVE BENCHMARKING (radar chart)
  // ─────────────────────────────────────────────────────────────────────────

  normativeBenchmarking: NormativeBenchmarking;

  // ─────────────────────────────────────────────────────────────────────────
  // QUALITATIVE CLASSIFICATION
  // ─────────────────────────────────────────────────────────────────────────

  qualitativeClassification: QualitativeClassification;

  // ─────────────────────────────────────────────────────────────────────────
  // RECOMMENDATIONS
  // ─────────────────────────────────────────────────────────────────────────

  recommendations: Recommendation[];

  // ─────────────────────────────────────────────────────────────────────────
  // METADATA
  // ─────────────────────────────────────────────────────────────────────────

  metadata: {
    /** Confidence in overall analysis */
    confidence: number;

    /** Processing time in ms */
    processingTimeMs: number;

    /** Which patterns were analyzed */
    patternsAnalyzed: string[];

    /** Which research sources were used */
    sourcesUsed: string[];

    /** Any caveats or limitations */
    caveats: string[];

    /** Data completeness (0-100) */
    dataCompleteness: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXAMPLE OUTPUT (for few-shot prompting)
// ═══════════════════════════════════════════════════════════════════════════

export const EXAMPLE_OUTPUT: Partial<AnalysisAgentOutput> = {
  sessionId: "sess_abc123",
  generatedAt: "2025-01-15T10:30:00Z",
  schemaVersion: "1.0.0",

  executiveSummary: {
    overview: "This session reveals a clear asymmetry pattern with the Right Leg showing strength in power metrics while the Left Leg demonstrates reduced range of motion and velocity. The 24.8% ROM asymmetry exceeds clinical thresholds and warrants attention.",
    status: "needs_attention",
    topFindings: [
      {
        limb: "Left Leg",
        finding: "Range of motion limited to 92° (vs 118° Right Leg)",
        classification: "weakness"
      },
      {
        limb: "Right Leg",
        finding: "Excellent peak velocity at 245°/s (91st percentile)",
        classification: "strength"
      },
      {
        limb: "Left Leg",
        finding: "Elevated movement jerk indicates compensatory patterns",
        classification: "weakness"
      }
    ],
    keyAction: "Focus on Left Leg mobility and ROM restoration"
  },

  insights: [
    {
      id: "insight_001",
      domain: "range",
      limb: "Left Leg",
      title: "Left Leg Shows Significantly Reduced ROM",
      description: "The Left Leg maximum ROM of 92° falls in the 18th percentile for this demographic, 26° below the Right Leg. This limitation is consistent across all ROM measures and represents a moderate deficit requiring intervention.",
      classification: "weakness",
      severity: "moderate",
      primaryMetric: {
        name: "overallMaxRom",
        displayName: "Maximum Range of Motion",
        value: 92,
        unit: "degrees",
        limb: "Left Leg",
        benchmarkCategory: "deficient",
        percentile: 18,
        classification: "weakness"
      },
      supportingMetrics: [
        {
          name: "averageRom",
          displayName: "Average ROM",
          value: 78,
          unit: "degrees",
          limb: "Left Leg",
          benchmarkCategory: "deficient",
          percentile: 22,
          classification: "weakness"
        }
      ],
      chartData: {
        chartType: "comparison",
        dataPoints: [
          { label: "Left Leg", value: 92, color: "#3B82F6", limb: "Left Leg" },
          { label: "Right Leg", value: 118, color: "#EF4444", limb: "Right Leg" }
        ],
        referenceLines: [
          { label: "Optimal", value: 120, type: "target", color: "#22C55E" },
          { label: "Minimum Normal", value: 100, type: "threshold", color: "#F59E0B" }
        ],
        highlightedRegions: [
          { label: "Deficient Zone", min: 0, max: 100, color: "#FEE2E2", opacity: 0.3 }
        ]
      },
      confidence: 0.94,
      clinicalRelevance: "Limited ROM in the Left Leg may indicate joint stiffness, muscle tightness, or protective guarding. This asymmetry level (>15%) is associated with increased injury risk in rehabilitation populations.",
      recommendedAction: "Implement targeted Left Leg mobility exercises focusing on end-range flexion."
    }
  ],

  correlativeInsights: [
    {
      id: "corr_001",
      title: "Left Leg ROM Limitation Drives Increased Movement Jerk",
      description: "The Left Leg's reduced ROM (92°) correlates strongly with its elevated RMS jerk (520 deg/s³). This suggests the Left Leg is working harder to achieve movement within its limited range, resulting in less smooth motion.",
      primaryMetric: {
        name: "overallMaxRom",
        displayName: "Maximum ROM",
        value: 92,
        unit: "degrees",
        limb: "Left Leg"
      },
      secondaryMetric: {
        name: "rmsJerk",
        displayName: "Movement Smoothness (Jerk)",
        value: 520,
        unit: "deg/s³",
        limb: "Left Leg"
      },
      relationshipType: "causes",
      correlationStrength: 0.78,
      clinicalImplication: "Restoring ROM in the Left Leg should naturally improve movement smoothness without specific jerk-focused interventions.",
      concernLevel: "address",
      chartData: {
        chartType: "connected_bars",
        dataPoints: [
          { primaryValue: 92, secondaryValue: 520, label: "Left Leg" },
          { primaryValue: 118, secondaryValue: 340, label: "Right Leg" }
        ]
      }
    }
  ],

  normativeBenchmarking: {
    overallCategory: "average",
    demographicProfile: {
      ageGroup: "25-34",
      activityLevel: "recreational",
      activityProfile: "rehabilitation"
    },
    leftLeg: {
      limb: "Left Leg",
      overallCategory: "deficient",
      domains: [
        {
          domain: "range",
          score: 42,
          category: "deficient",
          classification: "weakness",
          keyMetric: { name: "overallMaxRom", value: 92, unit: "degrees", percentile: 18 }
        },
        {
          domain: "power",
          score: 55,
          category: "average",
          classification: "weakness",
          keyMetric: { name: "peakAngularVelocity", value: 165, unit: "deg/s", percentile: 38 }
        }
      ],
      strengths: [],
      weaknesses: ["Range of Motion", "Peak Velocity", "Movement Smoothness"]
    },
    rightLeg: {
      limb: "Right Leg",
      overallCategory: "optimal",
      domains: [
        {
          domain: "range",
          score: 85,
          category: "optimal",
          classification: "strength",
          keyMetric: { name: "overallMaxRom", value: 118, unit: "degrees", percentile: 82 }
        },
        {
          domain: "power",
          score: 91,
          category: "optimal",
          classification: "strength",
          keyMetric: { name: "peakAngularVelocity", value: 245, unit: "deg/s", percentile: 91 }
        }
      ],
      strengths: ["Range of Motion", "Peak Velocity", "Movement Smoothness"],
      weaknesses: []
    },
    radarChartData: {
      axes: [
        { label: "ROM", domain: "range", maxValue: 100 },
        { label: "Symmetry", domain: "symmetry", maxValue: 100 },
        { label: "Power", domain: "power", maxValue: 100 },
        { label: "Control", domain: "control", maxValue: 100 },
        { label: "Timing", domain: "timing", maxValue: 100 }
      ],
      series: [
        {
          name: "Left Leg",
          limb: "Left Leg",
          color: "#3B82F6",
          values: [42, 45, 55, 48, 52]
        },
        {
          name: "Right Leg",
          limb: "Right Leg",
          color: "#EF4444",
          values: [85, 82, 91, 78, 80]
        }
      ],
      normativeReference: {
        name: "Population Average",
        color: "#9CA3AF",
        opacity: 0.2,
        values: [70, 70, 70, 70, 70]
      }
    },
    summaryStatement: "Right Leg performs at optimal levels across all domains. Left Leg shows deficient performance, particularly in range of motion and power output."
  },

  qualitativeClassification: {
    strengths: {
      leftLeg: [],
      rightLeg: [
        {
          metricName: "overallMaxRom",
          displayName: "Maximum ROM",
          limb: "Right Leg",
          value: 118,
          unit: "degrees",
          classification: "strength",
          reason: "Exceeds optimal threshold of 110° by 8°, placing in 82nd percentile",
          thresholdDistance: { threshold: 110, direction: "above", percentage: 7.3 },
          priorityRank: 1
        },
        {
          metricName: "peakAngularVelocity",
          displayName: "Peak Velocity",
          limb: "Right Leg",
          value: 245,
          unit: "deg/s",
          classification: "strength",
          reason: "Well above optimal threshold of 200 deg/s, demonstrating excellent power generation",
          thresholdDistance: { threshold: 200, direction: "above", percentage: 22.5 },
          priorityRank: 2
        }
      ]
    },
    weaknesses: {
      leftLeg: [
        {
          metricName: "overallMaxRom",
          displayName: "Maximum ROM",
          limb: "Left Leg",
          value: 92,
          unit: "degrees",
          classification: "weakness",
          reason: "Falls 18° below minimum normal threshold of 110°, indicating restricted mobility",
          thresholdDistance: { threshold: 110, direction: "below", percentage: 16.4 },
          priorityRank: 1
        },
        {
          metricName: "peakAngularVelocity",
          displayName: "Peak Velocity",
          limb: "Left Leg",
          value: 165,
          unit: "deg/s",
          classification: "weakness",
          reason: "Below optimal threshold, suggesting reduced power output or protective limitation",
          thresholdDistance: { threshold: 200, direction: "below", percentage: 17.5 },
          priorityRank: 2
        }
      ],
      rightLeg: []
    },
    summary: {
      leftLeg: { strengths: 0, weaknesses: 2 },
      rightLeg: { strengths: 2, weaknesses: 0 },
      total: { strengths: 2, weaknesses: 2 }
    },
    keyTakeaway: "Clear asymmetry exists with the Right Leg demonstrating 2 strengths and the Left Leg showing 2 weaknesses. Intervention should focus on the Left Leg to reduce asymmetry below clinical threshold."
  }
};
