/**
 * Horus v2 Programmatic Validators
 *
 * JSON schema validation without LLM - faster and more reliable.
 */

import type {
  Section,
  EnrichedSection,
  AnalysisAgentOutput,
  MetricContribution,
  QAReasoning,
  Citation,
  QualityLink,
  UserExplanation,
  EvidenceStrength,
  KeyFinding,
  SeverityLevel,
} from "./types";

// ─────────────────────────────────────────────────────────────────
// Validation Result Type
// ─────────────────────────────────────────────────────────────────

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors: string[];
}

// ─────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidTier(value: unknown): value is "S" | "A" | "B" | "C" | "D" {
  return typeof value === "string" && ["S", "A", "B", "C", "D"].includes(value);
}

function isValidEvidenceLevel(value: unknown): value is "strong" | "moderate" | "limited" {
  return typeof value === "string" && ["strong", "moderate", "limited"].includes(value);
}

function isValidSeverity(value: unknown): value is SeverityLevel {
  return typeof value === "string" && ["critical", "severe", "moderate", "mild", "profound"].includes(value);
}

/**
 * Validate a KeyFinding object.
 */
function validateKeyFinding(finding: unknown, errors: string[], path: string): finding is KeyFinding {
  if (!finding || typeof finding !== "object") {
    errors.push(`${path}: must be an object`);
    return false;
  }

  const obj = finding as Record<string, unknown>;

  if (!isNonEmptyString(obj.text)) {
    errors.push(`${path}.text: must be a non-empty string`);
    return false;
  }

  if (!isValidSeverity(obj.severity)) {
    errors.push(`${path}.severity: must be critical, severe, moderate, mild, or profound`);
    return false;
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────
// Section Validators
// ─────────────────────────────────────────────────────────────────

/**
 * Validate a single Q&A reasoning pair.
 */
function validateQAReasoning(qa: unknown, errors: string[], path: string): qa is QAReasoning {
  if (!qa || typeof qa !== "object") {
    errors.push(`${path}: must be an object`);
    return false;
  }

  const obj = qa as Record<string, unknown>;

  if (!isNonEmptyString(obj.question)) {
    errors.push(`${path}.question: must be a non-empty string`);
    return false;
  }

  if (!isNonEmptyString(obj.answer)) {
    errors.push(`${path}.answer: must be a non-empty string`);
    return false;
  }

  return true;
}

/**
 * Validate a metric contribution.
 */
function validateMetricContribution(
  mc: unknown,
  errors: string[],
  path: string
): mc is MetricContribution {
  if (!mc || typeof mc !== "object") {
    errors.push(`${path}: must be an object`);
    return false;
  }

  const obj = mc as Record<string, unknown>;

  if (!isNonEmptyString(obj.metric)) {
    errors.push(`${path}.metric: must be a non-empty string`);
    return false;
  }

  if (typeof obj.value !== "number" || isNaN(obj.value)) {
    errors.push(`${path}.value: must be a valid number`);
    return false;
  }

  // Unit can be empty for dimensionless metrics (ratios, coefficients, indices)
  if (typeof obj.unit !== "string") {
    errors.push(`${path}.unit: must be a string`);
    return false;
  }

  if (!isNonEmptyString(obj.role)) {
    errors.push(`${path}.role: must be a non-empty string`);
    return false;
  }

  // Optional type validation
  if (obj.type !== undefined) {
    const validTypes = ["raw", "computed", "derived", "comparison"];
    if (!validTypes.includes(obj.type as string)) {
      errors.push(`${path}.type: must be one of ${validTypes.join(", ")}`);
      return false;
    }
  }

  return true;
}

/**
 * Validate a section from the Analysis Agent.
 */
export function validateSection(section: unknown, errors: string[], path: string): section is Section {
  if (!section || typeof section !== "object") {
    errors.push(`${path}: must be an object`);
    return false;
  }

  const obj = section as Record<string, unknown>;

  // Required string fields
  const requiredStrings = ["id", "title", "domain", "clinicalNarrative"];
  for (const field of requiredStrings) {
    if (!isNonEmptyString(obj[field])) {
      errors.push(`${path}.${field}: must be a non-empty string`);
      return false;
    }
  }

  // severity must be a valid level
  const validSeverities = ["critical", "severe", "moderate", "mild"];
  if (!validSeverities.includes(obj.severity as string)) {
    errors.push(`${path}.severity: must be one of ${validSeverities.join(", ")}`);
    return false;
  }

  // priority must be a number between 1-10
  if (typeof obj.priority !== "number" || obj.priority < 1 || obj.priority > 10) {
    errors.push(`${path}.priority: must be a number between 1 and 10`);
    return false;
  }

  // jointContributions must be an object with string values
  if (!obj.jointContributions || typeof obj.jointContributions !== "object") {
    errors.push(`${path}.jointContributions: must be an object`);
    return false;
  }

  // qaReasoning must be an array
  if (!Array.isArray(obj.qaReasoning)) {
    errors.push(`${path}.qaReasoning: must be an array`);
    return false;
  }
  for (let i = 0; i < obj.qaReasoning.length; i++) {
    if (!validateQAReasoning(obj.qaReasoning[i], errors, `${path}.qaReasoning[${i}]`)) {
      return false;
    }
  }

  // metricContributions must be an array
  if (!Array.isArray(obj.metricContributions)) {
    errors.push(`${path}.metricContributions: must be an array`);
    return false;
  }
  for (let i = 0; i < obj.metricContributions.length; i++) {
    if (!validateMetricContribution(obj.metricContributions[i], errors, `${path}.metricContributions[${i}]`)) {
      return false;
    }
  }

  // searchQueries must be an array of strings
  if (!Array.isArray(obj.searchQueries)) {
    errors.push(`${path}.searchQueries: must be an array`);
    return false;
  }

  // recommendations must be an array of strings
  if (!Array.isArray(obj.recommendations)) {
    errors.push(`${path}.recommendations: must be an array`);
    return false;
  }

  // needsResearch must be a boolean
  if (typeof obj.needsResearch !== "boolean") {
    errors.push(`${path}.needsResearch: must be a boolean`);
    return false;
  }

  return true;
}

/**
 * Validate the Analysis Agent output.
 */
export function validateAnalysisOutput(
  data: unknown,
  sessionId: string
): ValidationResult<AnalysisAgentOutput> {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    return { success: false, errors: ["Output must be an object"] };
  }

  const obj = data as Record<string, unknown>;

  // Validate sections array
  if (!Array.isArray(obj.sections)) {
    errors.push("sections: must be an array");
  } else {
    for (let i = 0; i < obj.sections.length; i++) {
      validateSection(obj.sections[i], errors, `sections[${i}]`);
    }
  }

  // Validate summary
  if (!isNonEmptyString(obj.summary)) {
    errors.push("summary: must be a non-empty string");
  }

  // Validate strengths array
  if (!Array.isArray(obj.strengths)) {
    errors.push("strengths: must be an array");
  }

  // Validate weaknesses array
  if (!Array.isArray(obj.weaknesses)) {
    errors.push("weaknesses: must be an array");
  }

  // Validate radarScores object
  if (!obj.radarScores || typeof obj.radarScores !== "object") {
    errors.push("radarScores: must be an object");
  } else {
    const radar = obj.radarScores as Record<string, unknown>;
    const requiredMetrics = ["flexibility", "consistency", "symmetry", "smoothness", "control"];
    for (const metric of requiredMetrics) {
      if (typeof radar[metric] !== "number" || radar[metric] < 1 || radar[metric] > 10) {
        errors.push(`radarScores.${metric}: must be a number between 1 and 10`);
      }
    }
  }

  // Validate keyFindings array (KeyFinding objects with text and severity)
  if (!Array.isArray(obj.keyFindings)) {
    errors.push("keyFindings: must be an array");
  } else {
    for (let i = 0; i < obj.keyFindings.length; i++) {
      validateKeyFinding(obj.keyFindings[i], errors, `keyFindings[${i}]`);
    }
  }

  // Validate clinicalImplications string
  if (!isNonEmptyString(obj.clinicalImplications)) {
    errors.push("clinicalImplications: must be a non-empty string");
  }

  // Validate recommendations array
  if (!Array.isArray(obj.recommendations)) {
    errors.push("recommendations: must be an array");
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  const output: AnalysisAgentOutput = {
    sessionId,
    sections: obj.sections as Section[],
    summary: obj.summary as string,
    strengths: obj.strengths as string[],
    weaknesses: obj.weaknesses as string[],
    radarScores: obj.radarScores as AnalysisAgentOutput["radarScores"],
    keyFindings: obj.keyFindings as KeyFinding[],
    clinicalImplications: obj.clinicalImplications as string,
    recommendations: obj.recommendations as string[],
    analyzedAt: Date.now(),
  };

  return { success: true, data: output, errors: [] };
}

// ─────────────────────────────────────────────────────────────────
// Enriched Section Validators
// ─────────────────────────────────────────────────────────────────

/**
 * Validate a citation.
 */
function validateCitation(citation: unknown, errors: string[], path: string): citation is Citation {
  if (!citation || typeof citation !== "object") {
    errors.push(`${path}: must be an object`);
    return false;
  }

  const obj = citation as Record<string, unknown>;

  if (!isNonEmptyString(obj.text)) {
    errors.push(`${path}.text: must be a non-empty string`);
    return false;
  }

  if (!isNonEmptyString(obj.source)) {
    errors.push(`${path}.source: must be a non-empty string`);
    return false;
  }

  if (!isValidTier(obj.tier)) {
    errors.push(`${path}.tier: must be S, A, B, C, or D`);
    return false;
  }

  return true;
}

/**
 * Validate a quality link.
 */
function validateQualityLink(link: unknown, errors: string[], path: string): link is QualityLink {
  if (!link || typeof link !== "object") {
    errors.push(`${path}: must be an object`);
    return false;
  }

  const obj = link as Record<string, unknown>;

  if (!isNonEmptyString(obj.url)) {
    errors.push(`${path}.url: must be a non-empty string`);
    return false;
  }

  if (!isNonEmptyString(obj.title)) {
    errors.push(`${path}.title: must be a non-empty string`);
    return false;
  }

  if (!isValidTier(obj.tier)) {
    errors.push(`${path}.tier: must be S, A, B, C, or D`);
    return false;
  }

  if (!isNonEmptyString(obj.domain)) {
    errors.push(`${path}.domain: must be a non-empty string`);
    return false;
  }

  if (!isNonEmptyString(obj.relevance)) {
    errors.push(`${path}.relevance: must be a non-empty string`);
    return false;
  }

  return true;
}

/**
 * Validate user explanation.
 */
function validateUserExplanation(
  explanation: unknown,
  errors: string[],
  path: string
): explanation is UserExplanation {
  if (!explanation || typeof explanation !== "object") {
    errors.push(`${path}: must be an object`);
    return false;
  }

  const obj = explanation as Record<string, unknown>;

  const requiredFields = ["summary", "whatItMeans", "whyItMatters"];
  for (const field of requiredFields) {
    if (!isNonEmptyString(obj[field])) {
      errors.push(`${path}.${field}: must be a non-empty string`);
      return false;
    }
  }

  return true;
}

/**
 * Validate evidence strength.
 */
function validateEvidenceStrength(
  strength: unknown,
  errors: string[],
  path: string
): strength is EvidenceStrength {
  if (!strength || typeof strength !== "object") {
    errors.push(`${path}: must be an object`);
    return false;
  }

  const obj = strength as Record<string, unknown>;

  if (!isValidEvidenceLevel(obj.level)) {
    errors.push(`${path}.level: must be strong, moderate, or limited`);
    return false;
  }

  return true;
}

/**
 * Validate an enriched section from the Research Agent.
 */
export function validateEnrichedSection(
  section: unknown,
  errors: string[],
  path: string
): section is EnrichedSection {
  // First validate base section
  if (!validateSection(section, errors, path)) {
    return false;
  }

  const obj = section as unknown as Record<string, unknown>;

  // Validate enriched fields
  if (!isNonEmptyString(obj.enrichedNarrative)) {
    errors.push(`${path}.enrichedNarrative: must be a non-empty string`);
    return false;
  }

  if (!validateUserExplanation(obj.userExplanation, errors, `${path}.userExplanation`)) {
    return false;
  }

  // Validate citations array
  if (!Array.isArray(obj.citations)) {
    errors.push(`${path}.citations: must be an array`);
    return false;
  }
  for (let i = 0; i < obj.citations.length; i++) {
    if (!validateCitation(obj.citations[i], errors, `${path}.citations[${i}]`)) {
      return false;
    }
  }

  // Validate links array
  if (!Array.isArray(obj.links)) {
    errors.push(`${path}.links: must be an array`);
    return false;
  }
  for (let i = 0; i < obj.links.length; i++) {
    if (!validateQualityLink(obj.links[i], errors, `${path}.links[${i}]`)) {
      return false;
    }
  }

  // Validate evidence strength
  if (!validateEvidenceStrength(obj.evidenceStrength, errors, `${path}.evidenceStrength`)) {
    return false;
  }

  // wasContradicted must be a boolean
  if (typeof obj.wasContradicted !== "boolean") {
    errors.push(`${path}.wasContradicted: must be a boolean`);
    return false;
  }

  // enrichedRecommendations must be an array
  if (!Array.isArray(obj.enrichedRecommendations)) {
    errors.push(`${path}.enrichedRecommendations: must be an array`);
    return false;
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────
// Safe JSON Parser
// ─────────────────────────────────────────────────────────────────

/**
 * Safely parse JSON with error handling.
 */
export function safeJSONParse<T>(text: string): ValidationResult<T> {
  try {
    const data = JSON.parse(text);
    return { success: true, data: data as T, errors: [] };
  } catch (error) {
    return {
      success: false,
      errors: [`JSON parse error: ${error instanceof Error ? error.message : "Unknown error"}`],
    };
  }
}

/**
 * Extract JSON from LLM response that may contain markdown.
 */
export function extractJSON(text: string): string {
  // Try to find JSON in markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find raw JSON (object or array)
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    return jsonMatch[1];
  }

  // Return original if no JSON found
  return text;
}
