/**
 * AutoCropService - Detect crop boundaries using autocorrelation.
 *
 * Simple approach:
 * 1. Slide a window across the signal
 * 2. For each window, compute autocorrelation at human movement lags (0.3-3s)
 * 3. If any lag has high correlation → repetitive movement detected
 * 4. Find regions with consistent repetitive movement
 */

import { QuaternionSample, quaternionToAngle } from '../../../../../shared/QuaternionCodec';

export interface AutoCropResult {
  startMs: number;
  endMs: number;
  confidence: number;
  detected: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const MIN_CROP_SAMPLES = 50;

// Human movement periods to check (seconds)
// We'll sample a few specific lag values instead of computing full ACF
const CHECK_PERIODS = [0.4, 0.6, 0.8, 1.0, 1.3, 1.6, 2.0, 2.5, 3.0];

// Detection thresholds
const REGULARITY_THRESHOLD = 0.3;    // Correlation ratio to consider "periodic"
const WINDOW_DURATION_SEC = 4.0;     // Window size for analysis
const WINDOW_STEP_SEC = 1.0;         // Step between windows

// Edge handling
const EDGE_PADDING_MS = 500;          // buffer at edges
const MIN_DURATION_RATIO = 0.1;

// ─────────────────────────────────────────────────────────────────
// Main Function
// ─────────────────────────────────────────────────────────────────

export function detectAutoCrop(
  samples: QuaternionSample[],
  durationMs: number
): AutoCropResult {
  if (samples.length < MIN_CROP_SAMPLES || durationMs <= 0) {
    return { startMs: 0, endMs: durationMs, confidence: 0, detected: false };
  }

  const sampleRate = samples.length / (durationMs / 1000);
  const timeStep = durationMs / samples.length;

  // Extract angles (combine both joints for robustness)
  const angles = samples.map(s => {
    const left = s.lq ? quaternionToAngle(s.lq, 'y') : null;
    const right = s.rq ? quaternionToAngle(s.rq, 'y') : null;
    if (left !== null && right !== null) return (left + right) / 2;
    return left ?? right ?? 0;
  });

  // Sliding window analysis
  const windowSize = Math.floor(WINDOW_DURATION_SEC * sampleRate);
  const stepSize = Math.floor(WINDOW_STEP_SEC * sampleRate);

  if (angles.length < windowSize) {
    // Short recording - analyze whole thing
    const score = computeRegularity(angles, sampleRate);
    if (score >= REGULARITY_THRESHOLD) {
      return { startMs: 0, endMs: durationMs, confidence: score, detected: false };
    }
    return { startMs: 0, endMs: durationMs, confidence: 0, detected: false };
  }

  // Compute regularity for each window position (track center point)
  const halfWindow = Math.floor(windowSize / 2);
  const windowScores: { center: number; score: number }[] = [];

  for (let i = 0; i <= angles.length - windowSize; i += stepSize) {
    const window = angles.slice(i, i + windowSize);
    const score = computeRegularity(window, sampleRate);
    windowScores.push({ center: i + halfWindow, score });
  }

  // Find ALL windows above threshold (don't require contiguity)
  const passingWindows = windowScores.filter(w => w.score >= REGULARITY_THRESHOLD);

  if (passingWindows.length === 0) {
    return { startMs: 0, endMs: durationMs, confidence: 0, detected: false };
  }

  // Use first and last passing windows to define the region
  const firstCenter = passingWindows[0].center;
  const lastCenter = passingWindows[passingWindows.length - 1].center;
  const bestScore = Math.max(...passingWindows.map(w => w.score));

  const bestRegion = { startCenter: firstCenter, endCenter: lastCenter };

  // The center is where we're MOST confident about movement
  // Don't expand by halfWindow - just use centers with small padding
  const startIdx = bestRegion.startCenter;
  const endIdx = bestRegion.endCenter;

  // Validate crop size
  const cropLength = endIdx - startIdx;
  if (cropLength < samples.length * MIN_DURATION_RATIO) {
    return { startMs: 0, endMs: durationMs, confidence: 0, detected: false };
  }

  // Convert to ms - ADD padding to expand the kept region
  let startMs = Math.max(0, (startIdx * timeStep) - EDGE_PADDING_MS);
  let endMs = Math.min(durationMs, (endIdx * timeStep) + EDGE_PADDING_MS);

  // Skip if nearly full duration
  if (startMs < 200 && endMs > durationMs - 200) {
    return { startMs: 0, endMs: durationMs, confidence: bestScore, detected: false };
  }

  return { startMs, endMs, confidence: bestScore, detected: true };
}

// ─────────────────────────────────────────────────────────────────
// Regularity Detection
// ─────────────────────────────────────────────────────────────────

/**
 * Compute regularity score by checking autocorrelation at specific lags.
 * Returns 0-1 where higher = more periodic.
 */
function computeRegularity(signal: number[], sampleRate: number): number {
  const n = signal.length;
  if (n < 20) return 0;

  // Remove mean
  const mean = signal.reduce((a, b) => a + b, 0) / n;
  const centered = signal.map(v => v - mean);

  // Compute variance (autocorrelation at lag 0)
  const variance = centered.reduce((sum, v) => sum + v * v, 0);
  if (variance < 1e-10) return 0;

  // Check autocorrelation at specific human movement periods
  let maxCorrelation = 0;

  for (const period of CHECK_PERIODS) {
    const lag = Math.round(period * sampleRate);
    if (lag >= n / 2) continue; // Lag too large for window

    // Compute autocorrelation at this lag
    let correlation = 0;
    for (let i = 0; i < n - lag; i++) {
      correlation += centered[i] * centered[i + lag];
    }

    // Normalize by variance
    const normalized = correlation / variance;
    maxCorrelation = Math.max(maxCorrelation, normalized);
  }

  return Math.max(0, maxCorrelation);
}

export default detectAutoCrop;
