/**
 * Horus UI Types
 *
 * Local copy of visualization types for the renderer process.
 * These mirror the types in convex/horus/visualization/types.ts
 */

// ─────────────────────────────────────────────────────────────────
// Lucide Icon Names (Curated Subset)
// ─────────────────────────────────────────────────────────────────

export type LucideIconName =
  // Status & Alerts
  | "AlertTriangle"
  | "AlertCircle"
  | "CheckCircle"
  | "XCircle"
  | "Info"
  | "Bell"
  | "ShieldAlert"
  | "ShieldCheck"
  // Trends & Progress
  | "TrendingUp"
  | "TrendingDown"
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowRight"
  | "ArrowUpRight"
  | "ArrowDownRight"
  | "Minus"
  // Activity & Motion
  | "Activity"
  | "Zap"
  | "Flame"
  | "Timer"
  | "Clock"
  | "Gauge"
  | "BarChart2"
  | "LineChart"
  // Body & Health
  | "Heart"
  | "HeartPulse"
  | "Footprints"
  | "Move"
  | "Target"
  | "Crosshair"
  // Achievement & Milestones
  | "Trophy"
  | "Medal"
  | "Star"
  | "Award"
  | "Crown"
  | "PartyPopper"
  | "Sparkles"
  // Comparison & Balance
  | "Scale"
  | "GitCompare"
  | "ArrowLeftRight"
  | "Equal"
  | "Percent"
  // Analysis & Insights
  | "Eye"
  | "Lightbulb"
  | "Brain"
  | "Search"
  | "Microscope"
  | "FlaskConical"
  // Actions & Recommendations
  | "ListChecks"
  | "ClipboardList"
  | "Calendar"
  | "CalendarCheck"
  | "CircleCheck"
  | "Play"
  | "RefreshCw";

// ─────────────────────────────────────────────────────────────────
// Recharts Types
// ─────────────────────────────────────────────────────────────────

export type RechartsType =
  | "line"
  | "bar"
  | "area"
  | "pie"
  | "radar"
  | "radialBar"
  | "scatter"
  | "composed"
  | "funnel"
  | "treemap";

// ─────────────────────────────────────────────────────────────────
// Session Metrics (simplified for UI)
// ─────────────────────────────────────────────────────────────────

export interface PerLegMetrics {
  overallMaxRom: number;
  averageRom: number;
  peakFlexion: number;
  peakExtension: number;
  peakAngularVelocity: number;
  explosivenessConcentric: number;
  explosivenessLoading: number;
  rmsJerk: number;
  romCoV: number;
}

export interface BilateralMetrics {
  romAsymmetry: number;
  velocityAsymmetry: number;
  crossCorrelation: number;
  realAsymmetryAvg: number;
  netGlobalAsymmetry: number;
  phaseShift: number;
  temporalLag: number;
  maxFlexionTimingDiff: number;
}

export interface SessionMetrics {
  sessionId: string;
  leftLeg: PerLegMetrics;
  rightLeg: PerLegMetrics;
  bilateral: BilateralMetrics;
  opiScore?: number;
  opiGrade?: string;
  movementType: "bilateral" | "unilateral";
  recordedAt: number;
}

// ─────────────────────────────────────────────────────────────────
// Evaluation Context
// ─────────────────────────────────────────────────────────────────

export interface EvaluationContext {
  current: SessionMetrics;
  previous?: SessionMetrics;
  baseline?: SessionMetrics;
  history?: SessionMetrics[];
}

// ─────────────────────────────────────────────────────────────────
// Visualization Block Types
// ─────────────────────────────────────────────────────────────────

export type MetricExpression = string;
export type FormulaExpression = string;

export interface ExecutiveSummaryBlock {
  type: "executive_summary";
  title: string;
  content: string;
}

export interface StatCardBlock {
  type: "stat_card";
  title: string;
  metric: MetricExpression;
  unit?: string;
  comparison?: {
    type: "baseline" | "previous" | "average" | "target";
    formula?: FormulaExpression;
    label?: string;
    targetValue?: number;
  };
  icon?: LucideIconName;
  variant?: "default" | "success" | "warning" | "danger";
}

export interface AlertCardBlock {
  type: "alert_card";
  title: string;
  description: string;
  severity: "info" | "warning" | "error" | "success";
  icon?: LucideIconName;
  relatedMetrics?: MetricExpression[];
}

export interface NextStepsBlock {
  type: "next_steps";
  title?: string;
  items: Array<{
    text: string;
    priority?: "high" | "medium" | "low";
  }>;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export interface ComparisonCardBlock {
  type: "comparison_card";
  title: string;
  leftLabel: string;
  rightLabel: string;
  leftMetric: MetricExpression;
  rightMetric: MetricExpression;
  unit?: string;
  showDifference?: boolean;
  highlightBetter?: boolean;
}

export interface ProgressCardBlock {
  type: "progress_card";
  title: string;
  description: string;
  metric: MetricExpression;
  target: number | MetricExpression;
  icon?: LucideIconName;
  celebrationLevel?: "major" | "minor";
}

export interface MetricGridBlock {
  type: "metric_grid";
  title?: string;
  columns?: 2 | 3 | 4;
  metrics: Array<{
    label: string;
    metric: MetricExpression;
    unit?: string;
    trend?: "show" | "hide";
  }>;
}

export interface QuoteCardBlock {
  type: "quote_card";
  content: string;
  citation?: string;
  icon?: LucideIconName;
  variant?: "info" | "evidence" | "recommendation";
}

export interface ChartDataSpec {
  series?: Array<{
    name: string;
    metric: MetricExpression;
    color?: string;
    limb?: "Left Leg" | "Right Leg";
  }>;
  comparisons?: Array<{
    label: string;
    leftMetric: MetricExpression;
    rightMetric: MetricExpression;
  }>;
  timeSeries?: {
    metrics: MetricExpression[];
    range?: "all" | "last_7" | "last_30";
    limbs?: Array<"Left Leg" | "Right Leg">;
  };
  radarMetrics?: Array<{
    name: string;
    metric: MetricExpression;
    maxValue?: number;
  }>;
  pieSegments?: Array<{
    name: string;
    metric: MetricExpression;
    color?: string;
  }>;
  references?: Array<{
    label: string;
    value: number | MetricExpression;
    color?: string;
    dashed?: boolean;
  }>;
}

export interface ChartConfig {
  height?: number;
  showLegend?: boolean;
  showTooltip?: boolean;
  showGrid?: boolean;
  xAxisLabel?: string;
  yAxisLabel?: string;
  colors?: string[];
  animate?: boolean;
}

export interface ChartBlockBlock {
  type: "chart";
  chartType: RechartsType;
  title: string;
  dataSpec: ChartDataSpec;
  config?: ChartConfig;
}

export type VisualizationBlock =
  | ExecutiveSummaryBlock
  | StatCardBlock
  | AlertCardBlock
  | NextStepsBlock
  | ComparisonCardBlock
  | ProgressCardBlock
  | MetricGridBlock
  | QuoteCardBlock
  | ChartBlockBlock;

// ─────────────────────────────────────────────────────────────────
// Evaluation Helpers
// ─────────────────────────────────────────────────────────────────

export interface EvaluatedValue {
  value: number;
  formatted: string;
  success: boolean;
  error?: string;
}

/**
 * Resolve a metric path to its value from SessionMetrics
 */
export function resolveMetricValue(
  path: string | undefined,
  metrics: SessionMetrics
): number | undefined {
  if (!path) return undefined;
  if (path === "opiScore") return metrics.opiScore;

  const parts = path.split(".");
  if (parts.length !== 2) return undefined;

  const [prefix, metric] = parts;

  switch (prefix) {
    case "leftLeg":
      return (metrics.leftLeg as unknown as Record<string, number>)[metric];
    case "rightLeg":
      return (metrics.rightLeg as unknown as Record<string, number>)[metric];
    case "bilateral":
      return (metrics.bilateral as unknown as Record<string, number>)[metric];
    default:
      return undefined;
  }
}

/**
 * Simple metric evaluation (just resolves the path)
 */
export function evaluateMetric(
  expression: MetricExpression,
  context: EvaluationContext
): EvaluatedValue {
  const value = resolveMetricValue(expression, context.current);
  if (value === undefined) {
    return { value: 0, formatted: "N/A", success: false, error: `Invalid path: ${expression}` };
  }
  return { value, formatted: value.toFixed(1), success: true };
}

// ─────────────────────────────────────────────────────────────────
// Formula Evaluator (Safe - no eval())
// ─────────────────────────────────────────────────────────────────

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

type ContextVariable = "current" | "previous" | "baseline" | "average" | "min" | "max";

/**
 * Formula evaluator class
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

  evaluate(): number {
    const result = this.parseExpression();
    if (this.pos < this.tokens.length) {
      throw new Error(`Unexpected token: ${this.tokens[this.pos].value}`);
    }
    return result;
  }

  private parseExpression(): number {
    let left = this.parseTerm();
    while (this.peek()?.type === "OPERATOR" && /[+-]/.test(this.peek()!.value)) {
      const op = this.consume()!.value;
      const right = this.parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

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

  private parseFactor(): number {
    const token = this.peek();
    if (!token) throw new Error("Unexpected end of expression");

    if (token.type === "OPERATOR" && token.value === "-") {
      this.consume();
      return -this.parseFactor();
    }

    if (token.type === "NUMBER") {
      this.consume();
      return parseFloat(token.value);
    }

    if (token.type === "LPAREN") {
      this.consume();
      const result = this.parseExpression();
      this.expect("RPAREN");
      return result;
    }

    if (token.type === "IDENTIFIER") {
      return this.parseIdentifier();
    }

    throw new Error(`Unexpected token: ${token.value}`);
  }

  private parseIdentifier(): number {
    const ident = this.consume()!;
    const name = ident.value;

    if (this.peek()?.type === "LPAREN") {
      return this.parseFunctionCall(name);
    }

    if (this.peek()?.type === "DOT") {
      return this.parseMetricPath(name);
    }

    return this.resolveContextVariable(name as ContextVariable);
  }

  private parseFunctionCall(name: string): number {
    const fn = ALLOWED_FUNCTIONS[name.toLowerCase()];
    if (!fn) throw new Error(`Unknown function: ${name}`);

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

  private parseMetricPath(prefix: string): number {
    this.expect("DOT");
    const metric = this.expect("IDENTIFIER").value;
    const path = `${prefix}.${metric}`;

    const value = resolveMetricValue(path, this.context.current);
    if (value === undefined) throw new Error(`Invalid metric path: ${path}`);
    return value;
  }

  private resolveContextVariable(name: ContextVariable): number {
    if (!this.targetMetric) {
      throw new Error(`Context variable '${name}' requires a target metric`);
    }

    switch (name) {
      case "current": {
        const val = resolveMetricValue(this.targetMetric, this.context.current);
        if (val === undefined) throw new Error(`Cannot resolve ${this.targetMetric}`);
        return val;
      }
      case "previous": {
        if (!this.context.previous) return 0;
        return resolveMetricValue(this.targetMetric, this.context.previous) ?? 0;
      }
      case "baseline": {
        if (!this.context.baseline) return 0;
        return resolveMetricValue(this.targetMetric, this.context.baseline) ?? 0;
      }
      case "average": {
        if (!this.context.history?.length) {
          return resolveMetricValue(this.targetMetric, this.context.current) ?? 0;
        }
        const values = this.context.history
          .map((s) => resolveMetricValue(this.targetMetric!, s))
          .filter((v): v is number => v !== undefined);
        return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      }
      case "min": {
        if (!this.context.history?.length) {
          return resolveMetricValue(this.targetMetric, this.context.current) ?? 0;
        }
        const values = this.context.history
          .map((s) => resolveMetricValue(this.targetMetric!, s))
          .filter((v): v is number => v !== undefined);
        return values.length ? Math.min(...values) : 0;
      }
      case "max": {
        if (!this.context.history?.length) {
          return resolveMetricValue(this.targetMetric, this.context.current) ?? 0;
        }
        const values = this.context.history
          .map((s) => resolveMetricValue(this.targetMetric!, s))
          .filter((v): v is number => v !== undefined);
        return values.length ? Math.max(...values) : 0;
      }
      default:
        throw new Error(`Unknown context variable: ${name}`);
    }
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

    if (!Number.isFinite(value)) {
      return { value: 0, formatted: "N/A", success: false, error: "Result is not finite" };
    }

    const formatted = value >= 0 ? `+${value.toFixed(1)}%` : `${value.toFixed(1)}%`;
    return { value, formatted, success: true };
  } catch (error) {
    return {
      value: 0,
      formatted: "Error",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
