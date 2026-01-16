/**
 * useChartGradients - Hook to read chart gradient opacity values from CSS variables.
 *
 * CSS variables for opacity are defined in globals.css but SVG stopOpacity attributes
 * require numeric values, not CSS variable strings. This hook reads the CSS variables
 * and provides them as numbers for use in SVG gradient definitions.
 */

import { useMemo } from "react";

interface ChartGradientValues {
  /** Main chart gradient start opacity (at top) */
  gradientStart: number;
  /** Main chart gradient end opacity (at bottom) */
  gradientEnd: number;
  /** Multi-axis mode gradient start opacity */
  axisGradientStart: number;
  /** Multi-axis mode gradient end opacity */
  axisGradientEnd: number;
  /** Base opacity for asymmetry overlay regions */
  asymmetryOpacity: number;
}

/**
 * Reads a CSS variable value from the document root
 */
function getCSSVariable(name: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;

  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();

  const parsed = parseFloat(value);
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * Hook to get chart gradient opacity values from CSS variables.
 * Falls back to default values if CSS variables are not defined.
 */
export function useChartGradients(): ChartGradientValues {
  return useMemo(() => ({
    gradientStart: getCSSVariable("--chart-gradient-start", 0.15),
    gradientEnd: getCSSVariable("--chart-gradient-end", 0),
    axisGradientStart: getCSSVariable("--chart-axis-gradient-start", 0.15),
    axisGradientEnd: getCSSVariable("--chart-axis-gradient-end", 0.02),
    asymmetryOpacity: getCSSVariable("--chart-asymmetry-opacity", 0.25),
  }), []);
}

/**
 * Non-hook version for use outside React components.
 * Reads CSS variables directly (safe for SSR with fallbacks).
 */
export function getChartGradients(): ChartGradientValues {
  return {
    gradientStart: getCSSVariable("--chart-gradient-start", 0.15),
    gradientEnd: getCSSVariable("--chart-gradient-end", 0),
    axisGradientStart: getCSSVariable("--chart-axis-gradient-start", 0.15),
    axisGradientEnd: getCSSVariable("--chart-axis-gradient-end", 0.02),
    asymmetryOpacity: getCSSVariable("--chart-asymmetry-opacity", 0.25),
  };
}
