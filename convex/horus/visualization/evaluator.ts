/**
 * Horus Expression Evaluator
 *
 * Safe parser and evaluator for metric expressions and formulas.
 * Does NOT use eval() - uses a proper tokenizer and AST evaluator.
 */

import type { SessionMetrics, PerLegMetricValues, BilateralMetricValues } from "../types";
import type { MetricExpression, FormulaExpression, EvaluatedValue } from "./types";
import { METRIC_REGISTRY } from "../metrics";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface EvaluationContext {
  /** Current session metrics */
  current: SessionMetrics;
  /** Previous session metrics (if available) */
  previous?: SessionMetrics;
  /** First session metrics (baseline) */
  baseline?: SessionMetrics;
  /** All historical sessions for average/min/max */
  history?: SessionMetrics[];
}

type TokenType =
  | "NUMBER"
  | "IDENTIFIER"
  | "OPERATOR"
  | "LPAREN"
  | "RPAREN"
  | "COMMA"
  | "DOT";

interface Token {
  type: TokenType;
  value: string;
}

// ─────────────────────────────────────────────────────────────────
// Metric Resolution
// ─────────────────────────────────────────────────────────────────

/**
 * Valid metric path prefixes
 */
const VALID_PREFIXES = ["leftLeg", "rightLeg", "bilateral"] as const;
type MetricPrefix = (typeof VALID_PREFIXES)[number];

/**
 * Check if a string is a valid metric path
 */
export function isValidMetricPath(path: string): boolean {
  // Handle direct properties
  if (path === "opiScore" || path === "opiGrade" || path === "movementType") {
    return true;
  }

  // Handle dotted paths
  const parts = path.split(".");
  if (parts.length !== 2) return false;

  const [prefix, metric] = parts;
  if (!VALID_PREFIXES.includes(prefix as MetricPrefix)) return false;

  // Check if metric exists in registry
  return metric in METRIC_REGISTRY;
}

/**
 * Resolve a metric path to its value from SessionMetrics
 */
export function resolveMetricValue(
  path: MetricExpression,
  metrics: SessionMetrics
): number | undefined {
  // Handle direct properties
  if (path === "opiScore") {
    return metrics.opiScore;
  }

  // Handle dotted paths
  const parts = path.split(".");
  if (parts.length !== 2) return undefined;

  const [prefix, metric] = parts;

  switch (prefix) {
    case "leftLeg":
      return (metrics.leftLeg as PerLegMetricValues)[
        metric as keyof PerLegMetricValues
      ];
    case "rightLeg":
      return (metrics.rightLeg as PerLegMetricValues)[
        metric as keyof PerLegMetricValues
      ];
    case "bilateral":
      return (metrics.bilateral as BilateralMetricValues)[
        metric as keyof BilateralMetricValues
      ];
    default:
      return undefined;
  }
}

/**
 * Get the unit for a metric
 */
export function getMetricUnit(path: MetricExpression): string {
  if (path === "opiScore") return "pts";

  const parts = path.split(".");
  if (parts.length !== 2) return "";

  const [, metric] = parts;
  return METRIC_REGISTRY[metric]?.unit || "";
}

// ─────────────────────────────────────────────────────────────────
// Tokenizer
// ─────────────────────────────────────────────────────────────────

/**
 * Tokenize a formula expression
 */
function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expression.length) {
    const char = expression[i];

    // Skip whitespace
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // Numbers (including decimals)
    if (/[0-9]/.test(char)) {
      let num = "";
      while (i < expression.length && /[0-9.]/.test(expression[i])) {
        num += expression[i];
        i++;
      }
      tokens.push({ type: "NUMBER", value: num });
      continue;
    }

    // Identifiers (variable names, functions)
    if (/[a-zA-Z_]/.test(char)) {
      let ident = "";
      while (i < expression.length && /[a-zA-Z0-9_]/.test(expression[i])) {
        ident += expression[i];
        i++;
      }
      tokens.push({ type: "IDENTIFIER", value: ident });
      continue;
    }

    // Operators
    if (/[+\-*/%]/.test(char)) {
      tokens.push({ type: "OPERATOR", value: char });
      i++;
      continue;
    }

    // Parentheses
    if (char === "(") {
      tokens.push({ type: "LPAREN", value: char });
      i++;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "RPAREN", value: char });
      i++;
      continue;
    }

    // Comma (for function arguments)
    if (char === ",") {
      tokens.push({ type: "COMMA", value: char });
      i++;
      continue;
    }

    // Dot (for property access)
    if (char === ".") {
      tokens.push({ type: "DOT", value: char });
      i++;
      continue;
    }

    // Unknown character - skip
    i++;
  }

  return tokens;
}

// ─────────────────────────────────────────────────────────────────
// Parser & Evaluator
// ─────────────────────────────────────────────────────────────────

/**
 * Allowed functions (whitelist for safety)
 */
const ALLOWED_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sqrt: Math.sqrt,
  pow: Math.pow,
};

/**
 * Context variables that can be used in formulas
 */
type ContextVariable = "current" | "previous" | "baseline" | "average" | "min" | "max";

/**
 * Evaluate a formula with the given context
 */
class FormulaEvaluator {
  private tokens: Token[];
  private pos: number = 0;
  private context: EvaluationContext;
  private targetMetric: MetricExpression | null = null;

  constructor(tokens: Token[], context: EvaluationContext) {
    this.tokens = tokens;
    this.context = context;
  }

  /**
   * Set the target metric for context variable resolution
   */
  setTargetMetric(metric: MetricExpression): void {
    this.targetMetric = metric;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Token | undefined {
    return this.tokens[this.pos++];
  }

  private expect(type: TokenType): Token {
    const token = this.consume();
    if (!token || token.type !== type) {
      throw new Error(`Expected ${type}, got ${token?.type || "EOF"}`);
    }
    return token;
  }

  /**
   * Main entry point - parse and evaluate expression
   */
  evaluate(): number {
    const result = this.parseExpression();
    if (this.pos < this.tokens.length) {
      throw new Error(`Unexpected token: ${this.tokens[this.pos].value}`);
    }
    return result;
  }

  /**
   * Parse addition/subtraction
   */
  private parseExpression(): number {
    let left = this.parseTerm();

    while (this.peek()?.type === "OPERATOR" && /[+-]/.test(this.peek()!.value)) {
      const op = this.consume()!.value;
      const right = this.parseTerm();
      left = op === "+" ? left + right : left - right;
    }

    return left;
  }

  /**
   * Parse multiplication/division/modulo
   */
  private parseTerm(): number {
    let left = this.parseFactor();

    while (this.peek()?.type === "OPERATOR" && /[*/%]/.test(this.peek()!.value)) {
      const op = this.consume()!.value;
      const right = this.parseFactor();
      if (op === "*") left *= right;
      else if (op === "/") left = right !== 0 ? left / right : 0;
      else if (op === "%") left = right !== 0 ? left % right : 0;
    }

    return left;
  }

  /**
   * Parse unary operators, numbers, identifiers, function calls
   */
  private parseFactor(): number {
    const token = this.peek();

    if (!token) {
      throw new Error("Unexpected end of expression");
    }

    // Unary minus
    if (token.type === "OPERATOR" && token.value === "-") {
      this.consume();
      return -this.parseFactor();
    }

    // Number literal
    if (token.type === "NUMBER") {
      this.consume();
      return parseFloat(token.value);
    }

    // Parenthesized expression
    if (token.type === "LPAREN") {
      this.consume();
      const result = this.parseExpression();
      this.expect("RPAREN");
      return result;
    }

    // Identifier (variable or function)
    if (token.type === "IDENTIFIER") {
      return this.parseIdentifier();
    }

    throw new Error(`Unexpected token: ${token.value}`);
  }

  /**
   * Parse identifier (variable, metric path, or function call)
   */
  private parseIdentifier(): number {
    const ident = this.consume()!;
    const name = ident.value;

    // Check for function call
    if (this.peek()?.type === "LPAREN") {
      return this.parseFunctionCall(name);
    }

    // Check for property access (metric path)
    if (this.peek()?.type === "DOT") {
      return this.parseMetricPath(name);
    }

    // Context variable
    return this.resolveContextVariable(name as ContextVariable);
  }

  /**
   * Parse function call like abs(x) or max(a, b)
   */
  private parseFunctionCall(name: string): number {
    const fn = ALLOWED_FUNCTIONS[name.toLowerCase()];
    if (!fn) {
      throw new Error(`Unknown function: ${name}`);
    }

    this.expect("LPAREN");
    const args: number[] = [];

    if (this.peek()?.type !== "RPAREN") {
      args.push(this.parseExpression());
      while (this.peek()?.type === "COMMA") {
        this.consume();
        args.push(this.parseExpression());
      }
    }

    this.expect("RPAREN");
    return fn(...args);
  }

  /**
   * Parse metric path like leftLeg.peakFlexion
   */
  private parseMetricPath(prefix: string): number {
    this.expect("DOT");
    const metric = this.expect("IDENTIFIER").value;
    const path = `${prefix}.${metric}`;

    const value = resolveMetricValue(path, this.context.current);
    if (value === undefined) {
      throw new Error(`Invalid metric path: ${path}`);
    }
    return value;
  }

  /**
   * Resolve context variable (current, previous, baseline, etc.)
   */
  private resolveContextVariable(name: ContextVariable): number {
    if (!this.targetMetric) {
      throw new Error(
        `Context variable '${name}' requires a target metric to be set`
      );
    }

    switch (name) {
      case "current": {
        const val = resolveMetricValue(this.targetMetric, this.context.current);
        if (val === undefined)
          throw new Error(`Cannot resolve ${this.targetMetric} for current`);
        return val;
      }

      case "previous": {
        if (!this.context.previous) return 0;
        const val = resolveMetricValue(this.targetMetric, this.context.previous);
        return val ?? 0;
      }

      case "baseline": {
        if (!this.context.baseline) return 0;
        const val = resolveMetricValue(this.targetMetric, this.context.baseline);
        return val ?? 0;
      }

      case "average": {
        if (!this.context.history || this.context.history.length === 0) {
          return resolveMetricValue(this.targetMetric, this.context.current) ?? 0;
        }
        const values = this.context.history
          .map((s) => resolveMetricValue(this.targetMetric!, s))
          .filter((v): v is number => v !== undefined);
        if (values.length === 0) return 0;
        return values.reduce((a, b) => a + b, 0) / values.length;
      }

      case "min": {
        if (!this.context.history || this.context.history.length === 0) {
          return resolveMetricValue(this.targetMetric, this.context.current) ?? 0;
        }
        const values = this.context.history
          .map((s) => resolveMetricValue(this.targetMetric!, s))
          .filter((v): v is number => v !== undefined);
        if (values.length === 0) return 0;
        return Math.min(...values);
      }

      case "max": {
        if (!this.context.history || this.context.history.length === 0) {
          return resolveMetricValue(this.targetMetric, this.context.current) ?? 0;
        }
        const values = this.context.history
          .map((s) => resolveMetricValue(this.targetMetric!, s))
          .filter((v): v is number => v !== undefined);
        if (values.length === 0) return 0;
        return Math.max(...values);
      }

      default:
        throw new Error(`Unknown context variable: ${name}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * Evaluate a simple metric expression (e.g., "leftLeg.peakFlexion")
 */
export function evaluateMetric(
  expression: MetricExpression,
  context: EvaluationContext
): EvaluatedValue {
  try {
    const value = resolveMetricValue(expression, context.current);
    if (value === undefined) {
      return {
        value: 0,
        formatted: "N/A",
        success: false,
        error: `Invalid metric path: ${expression}`,
      };
    }

    const unit = getMetricUnit(expression);
    return {
      value,
      formatted: formatValue(value, unit),
      success: true,
    };
  } catch (error) {
    return {
      value: 0,
      formatted: "Error",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Evaluate a formula expression with context
 */
export function evaluateFormula(
  formula: FormulaExpression,
  context: EvaluationContext,
  targetMetric?: MetricExpression
): EvaluatedValue {
  try {
    const tokens = tokenize(formula);
    const evaluator = new FormulaEvaluator(tokens, context);

    if (targetMetric) {
      evaluator.setTargetMetric(targetMetric);
    }

    const value = evaluator.evaluate();

    // Guard against NaN and Infinity
    if (!Number.isFinite(value)) {
      return {
        value: 0,
        formatted: "N/A",
        success: false,
        error: "Result is not a finite number",
      };
    }

    return {
      value,
      formatted: formatValue(value, "%"),
      success: true,
    };
  } catch (error) {
    return {
      value: 0,
      formatted: "Error",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Format a numeric value with unit
 */
export function formatValue(value: number, unit: string): string {
  // Handle percentages
  if (unit === "%" || unit === "pts") {
    return `${value >= 0 ? "+" : ""}${value.toFixed(1)}${unit}`;
  }

  // Handle degrees
  if (unit === "°") {
    return `${value.toFixed(1)}°`;
  }

  // Handle velocity
  if (unit === "°/s") {
    return `${value.toFixed(0)}°/s`;
  }

  // Handle acceleration
  if (unit === "°/s²" || unit === "°/s³") {
    return `${value.toFixed(0)}${unit}`;
  }

  // Handle milliseconds
  if (unit === "ms") {
    return `${value.toFixed(0)}ms`;
  }

  // Default: just show number
  if (!unit) {
    return value.toFixed(2);
  }

  return `${value.toFixed(1)}${unit}`;
}

/**
 * Extract all metric paths from a formula
 */
export function extractMetricPaths(formula: string): MetricExpression[] {
  const paths: MetricExpression[] = [];
  const regex = /(leftLeg|rightLeg|bilateral)\.(\w+)|opiScore/g;
  let match;

  while ((match = regex.exec(formula)) !== null) {
    paths.push(match[0]);
  }

  return paths;
}

/**
 * Validate that all metric paths in a formula are valid
 */
export function validateFormula(formula: FormulaExpression): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const paths = extractMetricPaths(formula);

  for (const path of paths) {
    if (!isValidMetricPath(path)) {
      errors.push(`Invalid metric path: ${path}`);
    }
  }

  // Try to tokenize
  try {
    tokenize(formula);
  } catch (error) {
    errors.push(`Tokenization error: ${error instanceof Error ? error.message : "Unknown"}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
