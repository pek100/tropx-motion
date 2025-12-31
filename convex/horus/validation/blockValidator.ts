/**
 * Block Validator - Programmatic Validation for Visualization Blocks
 *
 * Validates LLM-generated blocks after structured output parsing.
 * Produces a combined report that can be sent back to the analysis agent
 * for correction if needed.
 */

import { VALID_METRIC_TAGS, isValidMetricTag } from "../metricTags";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface ValidationIssue {
  blockIndex: number;
  blockType: string;
  field: string;
  issue: "invalid_tag" | "missing_required" | "type_error";
  message: string;
  invalidValue?: string;
  suggestion?: string;
}

export interface BlockValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
  validBlockCount: number;
  invalidBlockCount: number;
  summary: string;
}

export interface CombinedValidationReport {
  programmaticValidation: BlockValidationResult;
  aiValidation?: {
    passed: boolean;
    issues: Array<{
      ruleType: string;
      severity: string;
      description: string;
      suggestedFix: string;
    }>;
  };
  overallPassed: boolean;
  feedbackForRegeneration?: string;
}

// ─────────────────────────────────────────────────────────────────
// Block Type Definitions
// ─────────────────────────────────────────────────────────────────

interface AnyBlock {
  type: string;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────
// Validation Functions
// ─────────────────────────────────────────────────────────────────

/**
 * Find the closest valid tag suggestion for an invalid tag.
 */
function suggestTag(invalidTag: string): string | undefined {
  const normalized = invalidTag.toUpperCase().replace(/[<>]/g, "");

  // Try exact match after normalization
  const exactMatch = VALID_METRIC_TAGS.find(
    (tag) => tag.toUpperCase().replace(/[<>]/g, "") === normalized
  );
  if (exactMatch) return exactMatch;

  // Try partial match
  const partialMatch = VALID_METRIC_TAGS.find((tag) => {
    const tagNorm = tag.toUpperCase().replace(/[<>]/g, "");
    return tagNorm.includes(normalized) || normalized.includes(tagNorm);
  });
  if (partialMatch) return partialMatch;

  // Try keyword matching
  const keywords = normalized.split("_");
  for (const keyword of keywords) {
    if (keyword.length < 3) continue;
    const keywordMatch = VALID_METRIC_TAGS.find((tag) =>
      tag.toUpperCase().includes(keyword)
    );
    if (keywordMatch) return keywordMatch;
  }

  return undefined;
}

/**
 * Validate a single metric tag field.
 */
function validateMetricField(
  value: unknown,
  field: string,
  blockIndex: number,
  blockType: string
): ValidationIssue | null {
  if (value === undefined || value === null) {
    return {
      blockIndex,
      blockType,
      field,
      issue: "missing_required",
      message: `Missing required metric field "${field}"`,
    };
  }

  if (typeof value !== "string") {
    return {
      blockIndex,
      blockType,
      field,
      issue: "type_error",
      message: `Field "${field}" must be a string, got ${typeof value}`,
      invalidValue: String(value),
    };
  }

  if (!isValidMetricTag(value)) {
    const suggestion = suggestTag(value);
    return {
      blockIndex,
      blockType,
      field,
      issue: "invalid_tag",
      message: `Invalid metric tag "${value}"`,
      invalidValue: value,
      suggestion,
    };
  }

  return null;
}

/**
 * Validate a single block based on its type.
 */
function validateBlock(block: AnyBlock, index: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const blockType = block.type as string;

  switch (blockType) {
    case "stat_card": {
      const issue = validateMetricField(block.metric, "metric", index, blockType);
      if (issue) issues.push(issue);
      break;
    }

    case "comparison_card": {
      const leftIssue = validateMetricField(block.leftMetric, "leftMetric", index, blockType);
      if (leftIssue) issues.push(leftIssue);

      const rightIssue = validateMetricField(block.rightMetric, "rightMetric", index, blockType);
      if (rightIssue) issues.push(rightIssue);
      break;
    }

    case "progress_card": {
      const issue = validateMetricField(block.metric, "metric", index, blockType);
      if (issue) issues.push(issue);
      break;
    }

    case "metric_grid": {
      const metrics = block.metrics as Array<{ metric?: unknown }> | undefined;
      if (Array.isArray(metrics)) {
        metrics.forEach((item, itemIndex) => {
          const issue = validateMetricField(
            item.metric,
            `metrics[${itemIndex}].metric`,
            index,
            blockType
          );
          if (issue) issues.push(issue);
        });
      }
      break;
    }

    // These block types don't have metric fields to validate
    case "executive_summary":
    case "alert_card":
    case "next_steps":
    case "quote_card":
      break;

    default:
      // Unknown block type - log warning but don't fail
      console.warn(`[BlockValidator] Unknown block type: ${blockType}`);
  }

  return issues;
}

/**
 * Validate all blocks in a visualization output.
 */
export function validateBlocks(blocks: unknown[]): BlockValidationResult {
  if (!Array.isArray(blocks)) {
    return {
      isValid: false,
      issues: [{
        blockIndex: -1,
        blockType: "unknown",
        field: "blocks",
        issue: "type_error",
        message: "Blocks must be an array",
      }],
      validBlockCount: 0,
      invalidBlockCount: 0,
      summary: "Invalid blocks format: expected array",
    };
  }

  const allIssues: ValidationIssue[] = [];
  let invalidBlockCount = 0;

  blocks.forEach((block, index) => {
    const blockIssues = validateBlock(block as AnyBlock, index);
    if (blockIssues.length > 0) {
      allIssues.push(...blockIssues);
      invalidBlockCount++;
    }
  });

  const validBlockCount = blocks.length - invalidBlockCount;
  const isValid = allIssues.length === 0;

  let summary: string;
  if (isValid) {
    summary = `All ${blocks.length} blocks passed validation`;
  } else {
    summary = `${allIssues.length} issue(s) found in ${invalidBlockCount} block(s). ` +
      `${validBlockCount}/${blocks.length} blocks are valid.`;
  }

  return {
    isValid,
    issues: allIssues,
    validBlockCount,
    invalidBlockCount,
    summary,
  };
}

/**
 * Combine programmatic and AI validation results into a unified report.
 */
export function combineValidationReports(
  programmatic: BlockValidationResult,
  aiValidation?: {
    passed: boolean;
    issues: Array<{
      ruleType: string;
      severity: string;
      description: string;
      suggestedFix: string;
    }>;
  }
): CombinedValidationReport {
  const overallPassed = programmatic.isValid && (aiValidation?.passed ?? true);

  // Generate feedback for regeneration if there are issues
  let feedbackForRegeneration: string | undefined;

  if (!overallPassed) {
    const feedbackParts: string[] = [];

    // Add programmatic validation feedback
    if (!programmatic.isValid) {
      feedbackParts.push("## Metric Tag Validation Errors\n");
      for (const issue of programmatic.issues) {
        let msg = `- Block ${issue.blockIndex} (${issue.blockType}): ${issue.message}`;
        if (issue.suggestion) {
          msg += ` → Did you mean "${issue.suggestion}"?`;
        }
        feedbackParts.push(msg);
      }
      feedbackParts.push("\n**Fix:** Use ONLY the valid metric tags from the provided list.");
    }

    // Add AI validation feedback
    if (aiValidation && !aiValidation.passed) {
      feedbackParts.push("\n## Clinical/Content Validation Errors\n");
      for (const issue of aiValidation.issues) {
        feedbackParts.push(`- [${issue.severity.toUpperCase()}] ${issue.description}`);
        feedbackParts.push(`  Fix: ${issue.suggestedFix}`);
      }
    }

    feedbackForRegeneration = feedbackParts.join("\n");
  }

  return {
    programmaticValidation: programmatic,
    aiValidation,
    overallPassed,
    feedbackForRegeneration,
  };
}

/**
 * Validate visualization output and generate combined report.
 * Use this as the main entry point for post-generation validation.
 */
export function validateVisualizationOutput(
  visualization: {
    overallBlocks?: unknown[];
    sessionBlocks?: unknown[];
  },
  aiValidation?: {
    passed: boolean;
    issues: Array<{
      ruleType: string;
      severity: string;
      description: string;
      suggestedFix: string;
    }>;
  }
): CombinedValidationReport {
  // Validate both block arrays
  const overallResult = validateBlocks(visualization.overallBlocks ?? []);
  const sessionResult = validateBlocks(visualization.sessionBlocks ?? []);

  // Combine results
  const combined: BlockValidationResult = {
    isValid: overallResult.isValid && sessionResult.isValid,
    issues: [...overallResult.issues, ...sessionResult.issues.map(i => ({
      ...i,
      field: `sessionBlocks.${i.field}`,
    }))],
    validBlockCount: overallResult.validBlockCount + sessionResult.validBlockCount,
    invalidBlockCount: overallResult.invalidBlockCount + sessionResult.invalidBlockCount,
    summary: `Overall: ${overallResult.summary}. Session: ${sessionResult.summary}`,
  };

  return combineValidationReports(combined, aiValidation);
}
