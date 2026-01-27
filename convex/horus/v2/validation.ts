/**
 * Horus v2 Validation Utilities
 *
 * Simple JSON parsing utilities. Schema validation is handled by Gemini's structured output.
 */

// ─────────────────────────────────────────────────────────────────
// Validation Result Type
// ─────────────────────────────────────────────────────────────────

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors: string[];
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
