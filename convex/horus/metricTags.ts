/**
 * Valid Metric Tags - Single Source of Truth
 *
 * This file defines all valid semantic metric tags that can be used
 * in visualization blocks. The AI is constrained to ONLY use these tags.
 *
 * IMPORTANT: Keep this in sync with the frontend METRIC_TAG_MAP in:
 * electron/renderer/src/components/dashboard/horus/types.ts
 */

/**
 * All valid metric tags for LLM schema validation.
 * These are used as enum constraints in structured output.
 */
export const VALID_METRIC_TAGS = [
  // ═══════════════════════════════════════════════════════════════════
  // OPI Score
  // ═══════════════════════════════════════════════════════════════════
  "<OPI_SCORE>",

  // ═══════════════════════════════════════════════════════════════════
  // Per-leg metrics - Left
  // ═══════════════════════════════════════════════════════════════════
  "<LEFT_PEAK_FLEXION>",
  "<LEFT_PEAK_EXTENSION>",
  "<LEFT_AVG_ROM>",
  "<LEFT_MAX_ROM>",
  "<LEFT_VELOCITY>",
  "<LEFT_POWER>",
  "<LEFT_LOADING_POWER>",
  "<LEFT_JERK>",
  "<LEFT_ROM_COV>",

  // ═══════════════════════════════════════════════════════════════════
  // Per-leg metrics - Right
  // ═══════════════════════════════════════════════════════════════════
  "<RIGHT_PEAK_FLEXION>",
  "<RIGHT_PEAK_EXTENSION>",
  "<RIGHT_AVG_ROM>",
  "<RIGHT_MAX_ROM>",
  "<RIGHT_VELOCITY>",
  "<RIGHT_POWER>",
  "<RIGHT_LOADING_POWER>",
  "<RIGHT_JERK>",
  "<RIGHT_ROM_COV>",

  // ═══════════════════════════════════════════════════════════════════
  // Averaged metrics (left+right / 2)
  // ═══════════════════════════════════════════════════════════════════
  "<AVG_PEAK_FLEXION>",
  "<AVG_PEAK_EXTENSION>",
  "<AVG_ROM>",
  "<AVG_MAX_ROM>",
  "<AVG_VELOCITY>",
  "<AVG_POWER>",
  "<AVG_LOADING_POWER>",
  "<AVG_JERK>",
  "<AVG_ROM_COV>",

  // ═══════════════════════════════════════════════════════════════════
  // Bilateral/Symmetry metrics
  // ═══════════════════════════════════════════════════════════════════
  "<ROM_ASYMMETRY>",
  "<VELOCITY_ASYMMETRY>",
  "<CROSS_CORRELATION>",
  "<NET_ASYMMETRY>",
  "<REAL_ASYMMETRY>",

  // ═══════════════════════════════════════════════════════════════════
  // Timing metrics
  // ═══════════════════════════════════════════════════════════════════
  "<PHASE_SHIFT>",
  "<TEMPORAL_LAG>",
  "<TIMING_DIFF>",

  // ═══════════════════════════════════════════════════════════════════
  // Smoothness metrics
  // ═══════════════════════════════════════════════════════════════════
  "<SPARC>",
  "<LDLJ>",
  "<VELOCITY_PEAKS>",
] as const;

export type ValidMetricTag = (typeof VALID_METRIC_TAGS)[number];

/**
 * Get a formatted string of all valid tags for prompt injection.
 */
export function getValidTagsForPrompt(): string {
  return VALID_METRIC_TAGS.map((tag) => `  ${tag}`).join("\n");
}

/**
 * Check if a string is a valid metric tag.
 */
export function isValidMetricTag(tag: string): tag is ValidMetricTag {
  return VALID_METRIC_TAGS.includes(tag as ValidMetricTag);
}
