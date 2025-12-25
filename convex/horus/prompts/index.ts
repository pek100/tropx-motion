/**
 * Horus Agent Prompts - Central Export
 *
 * All agent prompts, builders, and parsers in one place.
 */

// ─────────────────────────────────────────────────────────────────
// Decomposition Agent
// ─────────────────────────────────────────────────────────────────

export {
  DECOMPOSITION_SYSTEM_PROMPT,
  buildDecompositionUserPrompt,
  parseDecompositionResponse,
  preDetectPatterns,
} from "./decomposition";

// ─────────────────────────────────────────────────────────────────
// Research Agent
// ─────────────────────────────────────────────────────────────────

export {
  RESEARCH_SYSTEM_PROMPT,
  buildResearchUserPrompt,
  parseResearchResponse,
  getTierFromDomain,
  buildSearchQuery,
  QUALITY_TIER_CONFIG,
  PRIORITY_DOMAINS,
} from "./research";

// ─────────────────────────────────────────────────────────────────
// Analysis Agent
// ─────────────────────────────────────────────────────────────────

export {
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisUserPrompt,
  parseAnalysisResponse,
  preComputeBenchmarks,
} from "./analysis";

// ─────────────────────────────────────────────────────────────────
// Validator Agent
// ─────────────────────────────────────────────────────────────────

export {
  VALIDATOR_SYSTEM_PROMPT,
  buildValidatorUserPrompt,
  parseValidatorResponse,
  programmaticValidation,
  VALIDATION_RULES,
} from "./validator";

// ─────────────────────────────────────────────────────────────────
// Progress Agent
// ─────────────────────────────────────────────────────────────────

export {
  PROGRESS_SYSTEM_PROMPT,
  buildProgressUserPrompt,
  parseProgressResponse,
  preComputeTrends,
  PROGRESS_CONFIG,
} from "./progress";
