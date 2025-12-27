/**
 * Response Schemas for Structured Output
 *
 * JSON schemas for Gemini structured output mode.
 * These ensure consistent, parseable responses from the LLM.
 */

// ─────────────────────────────────────────────────────────────────
// Research Agent Schema
// ─────────────────────────────────────────────────────────────────

export const RESEARCH_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    evidenceByPattern: {
      type: "object",
      description: "Evidence organized by pattern ID",
      additionalProperties: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Unique evidence ID" },
            tier: {
              type: "string",
              enum: ["S", "A", "B", "C", "D"],
              description: "Evidence quality tier",
            },
            sourceType: {
              type: "string",
              enum: ["embedded_knowledge", "web_search", "cache"],
            },
            citation: { type: "string", description: "Full citation" },
            url: { type: "string", description: "URL if available" },
            findings: {
              type: "array",
              items: { type: "string" },
              description: "Key findings from this source",
            },
            relevanceScore: {
              type: "number",
              description: "Relevance score 0-100",
            },
          },
          required: ["id", "tier", "sourceType", "citation", "findings", "relevanceScore"],
        },
      },
    },
    insufficientEvidence: {
      type: "array",
      items: { type: "string" },
      description: "Pattern IDs with insufficient evidence",
    },
  },
  required: ["evidenceByPattern", "insufficientEvidence"],
};

// ─────────────────────────────────────────────────────────────────
// Decomposition Agent Schema
// ─────────────────────────────────────────────────────────────────

export const DECOMPOSITION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    patterns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Unique pattern ID" },
          type: {
            type: "string",
            enum: [
              "threshold_violation",
              "asymmetry",
              "cross_metric_correlation",
              "temporal_pattern",
              "quality_flag",
            ],
          },
          metrics: {
            type: "array",
            items: { type: "string" },
            description: "Metric names involved",
          },
          severity: {
            type: "string",
            enum: ["high", "moderate", "low"],
          },
          description: { type: "string" },
          values: {
            type: "object",
            additionalProperties: { type: "number" },
          },
          limbs: {
            type: "array",
            items: { type: "string", enum: ["Left Leg", "Right Leg"] },
          },
          searchTerms: {
            type: "array",
            items: { type: "string" },
            description: "Terms for research lookup",
          },
          benchmarkCategory: {
            type: "string",
            enum: ["optimal", "average", "deficient"],
          },
        },
        required: ["id", "type", "metrics", "severity", "description", "searchTerms"],
      },
    },
  },
  required: ["patterns"],
};

// ─────────────────────────────────────────────────────────────────
// Analysis Agent Schema - Visualization Blocks (Discriminated Union)
// ─────────────────────────────────────────────────────────────────

// Each block type has its own schema with enforced required fields.
// Using anyOf with const type values creates a discriminated union.

const EXECUTIVE_SUMMARY_BLOCK = {
  type: "object",
  description: "Executive summary block with markdown content",
  properties: {
    type: { type: "string", enum: ["executive_summary"] },
    title: { type: "string", description: "Block title" },
    content: { type: "string", description: "Markdown content for the summary" },
  },
  required: ["type", "title", "content"],
};

const STAT_CARD_BLOCK = {
  type: "object",
  description: "Single metric stat card",
  properties: {
    type: { type: "string", enum: ["stat_card"] },
    title: { type: "string", description: "Block title" },
    metric: {
      type: "string",
      description: "Metric path e.g. leftLeg.peakFlexion, bilateral.romAsymmetry, rightLeg.averageRom",
    },
    unit: { type: "string", description: "Unit for display e.g. °, %, deg/s" },
    variant: {
      type: "string",
      enum: ["default", "success", "warning", "danger"],
      description: "Visual variant",
    },
    icon: { type: "string", description: "Lucide icon name e.g. TrendingUp, AlertTriangle" },
    comparison: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["baseline", "previous", "average", "target"] },
        formula: { type: "string", description: "Formula like ((current - baseline) / baseline) * 100" },
        label: { type: "string", description: "e.g. vs baseline, vs previous" },
        targetValue: { type: "number" },
      },
    },
  },
  required: ["type", "title", "metric", "unit"],
};

const ALERT_CARD_BLOCK = {
  type: "object",
  description: "Alert card for warnings or important notices",
  properties: {
    type: { type: "string", enum: ["alert_card"] },
    title: { type: "string", description: "Block title" },
    description: { type: "string", description: "Alert description text" },
    severity: {
      type: "string",
      enum: ["info", "warning", "error", "success"],
      description: "Alert severity level",
    },
    icon: { type: "string", description: "Lucide icon name" },
    relatedMetrics: {
      type: "array",
      items: { type: "string" },
      description: "Related metric paths",
    },
  },
  required: ["type", "title", "description", "severity"],
};

const NEXT_STEPS_BLOCK = {
  type: "object",
  description: "Actionable next steps list",
  properties: {
    type: { type: "string", enum: ["next_steps"] },
    title: { type: "string", description: "Block title" },
    items: {
      type: "array",
      description: "Action items",
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "Action item text" },
          priority: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["text"],
      },
    },
    collapsible: { type: "boolean" },
    defaultCollapsed: { type: "boolean" },
  },
  required: ["type", "title", "items"],
};

const COMPARISON_CARD_BLOCK = {
  type: "object",
  description: "Side-by-side comparison of two metrics (e.g. left vs right leg)",
  properties: {
    type: { type: "string", enum: ["comparison_card"] },
    title: { type: "string", description: "Block title" },
    leftLabel: { type: "string", description: "Left side label e.g. Left Leg" },
    rightLabel: { type: "string", description: "Right side label e.g. Right Leg" },
    leftMetric: {
      type: "string",
      description: "Left metric path - REQUIRED! e.g. leftLeg.peakFlexion, leftLeg.averageRom",
    },
    rightMetric: {
      type: "string",
      description: "Right metric path - REQUIRED! e.g. rightLeg.peakFlexion, rightLeg.averageRom",
    },
    unit: { type: "string", description: "Unit for display e.g. °, %, deg/s" },
    showDifference: { type: "boolean" },
    highlightBetter: { type: "boolean" },
    variant: { type: "string", enum: ["default", "warning"] },
  },
  required: ["type", "title", "leftLabel", "rightLabel", "leftMetric", "rightMetric"],
};

const PROGRESS_CARD_BLOCK = {
  type: "object",
  description: "Progress toward a target goal",
  properties: {
    type: { type: "string", enum: ["progress_card"] },
    title: { type: "string", description: "Block title" },
    description: { type: "string", description: "Progress description" },
    metric: {
      type: "string",
      description: "Metric path for current value e.g. leftLeg.peakFlexion",
    },
    target: { type: "number", description: "Target value to reach" },
    icon: { type: "string", description: "Lucide icon name" },
    celebrationLevel: { type: "string", enum: ["major", "minor"] },
  },
  required: ["type", "title", "metric", "target"],
};

const METRIC_GRID_BLOCK = {
  type: "object",
  description: "Grid of multiple metrics",
  properties: {
    type: { type: "string", enum: ["metric_grid"] },
    title: { type: "string", description: "Block title" },
    columns: { type: "string", enum: ["2", "3", "4"], description: "Number of columns" },
    metrics: {
      type: "array",
      description: "Metrics to display in grid",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Display label" },
          metric: { type: "string", description: "Metric path e.g. leftLeg.peakFlexion" },
          unit: { type: "string", description: "Unit for display" },
          trend: { type: "string", enum: ["show", "hide"] },
        },
        required: ["label", "metric"],
      },
    },
  },
  required: ["type", "title", "columns", "metrics"],
};

const QUOTE_CARD_BLOCK = {
  type: "object",
  description: "Quote or evidence citation card",
  properties: {
    type: { type: "string", enum: ["quote_card"] },
    title: { type: "string", description: "Block title" },
    content: { type: "string", description: "Quote or evidence text" },
    citation: { type: "string", description: "Source citation" },
    icon: { type: "string", description: "Lucide icon name" },
    variant: {
      type: "string",
      enum: ["info", "evidence", "recommendation"],
      description: "Visual variant",
    },
  },
  required: ["type", "title", "content"],
};

// Discriminated union: AI must choose ONE of these block types
// and include ALL required fields for that type
const VISUALIZATION_BLOCK_SCHEMA = {
  anyOf: [
    EXECUTIVE_SUMMARY_BLOCK,
    STAT_CARD_BLOCK,
    ALERT_CARD_BLOCK,
    NEXT_STEPS_BLOCK,
    COMPARISON_CARD_BLOCK,
    PROGRESS_CARD_BLOCK,
    METRIC_GRID_BLOCK,
    QUOTE_CARD_BLOCK,
  ],
};

// ─────────────────────────────────────────────────────────────────
// Analysis Agent Schema
// ─────────────────────────────────────────────────────────────────

export const ANALYSIS_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    insights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          domain: {
            type: "string",
            enum: ["range", "symmetry", "power", "control", "timing"],
          },
          classification: {
            type: "string",
            enum: ["strength", "weakness"],
          },
          title: { type: "string" },
          content: { type: "string" },
          limbs: {
            type: "array",
            items: { type: "string", enum: ["Left Leg", "Right Leg"] },
          },
          evidence: {
            type: "array",
            items: { type: "string" },
          },
          patternIds: {
            type: "array",
            items: { type: "string" },
          },
          percentile: { type: "number" },
          recommendations: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["id", "domain", "classification", "title", "content"],
      },
    },
    correlativeInsights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          primaryInsightId: { type: "string" },
          relatedInsightIds: {
            type: "array",
            items: { type: "string" },
          },
          explanation: { type: "string" },
          significance: {
            type: "string",
            enum: ["high", "moderate", "low"],
          },
        },
        required: ["id", "primaryInsightId", "relatedInsightIds", "explanation", "significance"],
      },
    },
    benchmarks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          metricName: { type: "string" },
          displayName: { type: "string" },
          domain: {
            type: "string",
            enum: ["range", "symmetry", "power", "control", "timing"],
          },
          value: { type: "number" },
          percentile: { type: "number" },
          category: {
            type: "string",
            enum: ["optimal", "average", "deficient"],
          },
          classification: {
            type: "string",
            enum: ["strength", "weakness"],
          },
          limb: { type: "string", enum: ["Left Leg", "Right Leg"] },
        },
        required: ["metricName", "displayName", "domain", "value", "percentile", "category", "classification"],
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
    visualization: {
      type: "object",
      description: "Visualization blocks for UI display",
      properties: {
        overallBlocks: {
          type: "array",
          description: "4-6 blocks for overall/longitudinal view",
          items: VISUALIZATION_BLOCK_SCHEMA,
        },
        sessionBlocks: {
          type: "array",
          description: "4-6 blocks for single session view",
          items: VISUALIZATION_BLOCK_SCHEMA,
        },
      },
      required: ["overallBlocks", "sessionBlocks"],
    },
  },
  required: ["insights", "correlativeInsights", "benchmarks", "summary", "strengths", "weaknesses", "visualization"],
};

// ─────────────────────────────────────────────────────────────────
// Validator Agent Schema
// ─────────────────────────────────────────────────────────────────

export const VALIDATOR_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    passed: { type: "boolean" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ruleType: {
            type: "string",
            enum: [
              "metric_accuracy",
              "hallucination",
              "clinical_safety",
              "internal_consistency",
            ],
          },
          severity: {
            type: "string",
            enum: ["error", "warning"],
          },
          insightIds: {
            type: "array",
            items: { type: "string" },
          },
          description: { type: "string" },
          suggestedFix: { type: "string" },
        },
        required: ["ruleType", "severity", "description", "suggestedFix"],
      },
    },
  },
  required: ["passed", "issues"],
};

// ─────────────────────────────────────────────────────────────────
// Progress Agent Schema
// ─────────────────────────────────────────────────────────────────

export const PROGRESS_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    trends: {
      type: "array",
      items: {
        type: "object",
        properties: {
          metricName: { type: "string" },
          displayName: { type: "string" },
          domain: {
            type: "string",
            enum: ["range", "symmetry", "power", "control", "timing"],
          },
          direction: {
            type: "string",
            enum: ["higherBetter", "lowerBetter"],
          },
          trend: {
            type: "string",
            enum: ["improving", "stable", "declining"],
          },
          currentValue: { type: "number" },
          previousValue: { type: "number" },
          baselineValue: { type: "number" },
          changeFromPrevious: { type: "number" },
          changeFromBaseline: { type: "number" },
          isClinicallyMeaningful: { type: "boolean" },
          limb: { type: "string", enum: ["Left Leg", "Right Leg"] },
        },
        required: [
          "metricName",
          "displayName",
          "domain",
          "direction",
          "trend",
          "currentValue",
          "changeFromPrevious",
          "isClinicallyMeaningful",
        ],
      },
    },
    milestones: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: {
            type: "string",
            enum: [
              "threshold_reached",
              "consistent_improvement",
              "personal_best",
              "symmetry_achieved",
            ],
          },
          title: { type: "string" },
          description: { type: "string" },
          achievedAt: { type: "number" },
          metrics: {
            type: "array",
            items: { type: "string" },
          },
          celebrationLevel: {
            type: "string",
            enum: ["major", "minor"],
          },
        },
        required: ["id", "type", "title", "description", "celebrationLevel"],
      },
    },
    regressions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          metricName: { type: "string" },
          declinePercentage: { type: "number" },
          isClinicallySignificant: { type: "boolean" },
          possibleReasons: {
            type: "array",
            items: { type: "string" },
          },
          recommendations: {
            type: "array",
            items: { type: "string" },
          },
          limb: { type: "string", enum: ["Left Leg", "Right Leg"] },
        },
        required: ["id", "metricName", "declinePercentage", "isClinicallySignificant"],
      },
    },
    projections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          metricName: { type: "string" },
          projectedValue: { type: "number" },
          targetDate: { type: "number" },
          confidence: { type: "number" },
          assumptions: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["metricName", "projectedValue", "confidence"],
      },
    },
    summary: { type: "string" },
    sessionsAnalyzed: { type: "number" },
    dateRange: {
      type: "object",
      properties: {
        start: { type: "number" },
        end: { type: "number" },
      },
      required: ["start", "end"],
    },
  },
  required: ["trends", "milestones", "regressions", "summary", "sessionsAnalyzed"],
};
