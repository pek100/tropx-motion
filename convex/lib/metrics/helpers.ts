/**
 * Signal processing helper functions for biomechanical metrics.
 * Based on biomechanical-metrics-spec-v1.2.md
 */

import type {
  MovementCycle,
  GroundContact,
  CrossCorrelationResult,
  FFTResult,
} from "./types";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const DEFAULT_ROBUST_PEAK_K = 3;
const MIN_CYCLE_DURATION = 0.3; // seconds
const MAX_CYCLE_DURATION = 5.0; // seconds
const DEFAULT_IMPACT_THRESHOLD = 2.0; // g
const DEFAULT_FREEFALL_THRESHOLD = 0.3; // g
const MIN_CONTACT_TIME_MS = 50;
const MAX_CONTACT_TIME_MS = 1000;

// ─────────────────────────────────────────────────────────────────
// Derivative & Basic Math
// ─────────────────────────────────────────────────────────────────

/** Central difference derivative. */
export function calculateDerivative(values: number[], timeStep: number): number[] {
  if (values.length < 3) return [];
  const derivative: number[] = new Array(values.length - 2);
  const twoTimeStep = 2 * timeStep;

  for (let i = 1; i < values.length - 1; i++) {
    derivative[i - 1] = (values[i + 1] - values[i - 1]) / twoTimeStep;
  }
  return derivative;
}

/** Calculate mean of array. */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Calculate standard deviation of array. */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const sumSq = values.reduce((sum, v) => sum + (v - avg) ** 2, 0);
  return Math.sqrt(sumSq / values.length);
}

/** Calculate RMS of array. */
export function rms(values: number[]): number {
  if (values.length === 0) return 0;
  const sumSq = values.reduce((sum, v) => sum + v * v, 0);
  return Math.sqrt(sumSq / values.length);
}

// ─────────────────────────────────────────────────────────────────
// Filtering
// ─────────────────────────────────────────────────────────────────

/** Moving average filter with edge handling. */
export function applyMovingAverageFilter(values: number[], windowSize: number): number[] {
  if (windowSize <= 1 || values.length === 0) return [...values];
  const halfWindow = Math.floor(windowSize / 2);
  const filtered: number[] = new Array(values.length);

  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - halfWindow);
    const end = Math.min(values.length, i + halfWindow + 1);
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += values[j];
    }
    filtered[i] = sum / (end - start);
  }
  return filtered;
}

/** Biquad filter (IIR second-order section). */
function applyBiquad(
  x: number[],
  a0: number,
  a1: number,
  a2: number,
  b1: number,
  b2: number
): number[] {
  const y: number[] = new Array(x.length).fill(0);
  y[0] = a0 * x[0];
  if (x.length > 1) {
    y[1] = a0 * x[1] + a1 * x[0] - b1 * y[0];
  }

  for (let i = 2; i < x.length; i++) {
    y[i] = a0 * x[i] + a1 * x[i - 1] + a2 * x[i - 2] - b1 * y[i - 1] - b2 * y[i - 2];
  }
  return y;
}

/** 4th order Butterworth low-pass filter (zero-phase via forward-backward). */
export function butterworthLowPass(values: number[], fc: number, fs: number): number[] {
  if (values.length < 4) return [...values];

  // Normalized cutoff frequency
  const wc = Math.tan(Math.PI * fc / fs);
  const wc2 = wc * wc;

  // 2nd order Butterworth coefficients
  const k = Math.SQRT2 * wc;
  const norm = 1 / (1 + k + wc2);

  const a0 = wc2 * norm;
  const a1 = 2 * a0;
  const a2 = a0;
  const b1 = 2 * (wc2 - 1) * norm;
  const b2 = (1 - k + wc2) * norm;

  // Forward-backward filtering for zero-phase (4th order total)
  const pass1 = applyBiquad(values, a0, a1, a2, b1, b2);
  const pass2 = applyBiquad([...pass1].reverse(), a0, a1, a2, b1, b2).reverse();
  const pass3 = applyBiquad(pass2, a0, a1, a2, b1, b2);
  const pass4 = applyBiquad([...pass3].reverse(), a0, a1, a2, b1, b2).reverse();

  return pass4;
}

// ─────────────────────────────────────────────────────────────────
// Peak Detection
// ─────────────────────────────────────────────────────────────────

/** Find all local maxima in signal. */
export function findLocalMaxima(values: number[]): { index: number; value: number }[] {
  const peaks: { index: number; value: number }[] = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] > values[i - 1] && values[i] > values[i + 1]) {
      peaks.push({ index: i, value: values[i] });
    }
  }
  return peaks;
}

/** Find all local minima in signal. */
export function findLocalMinima(values: number[]): { index: number; value: number }[] {
  const troughs: { index: number; value: number }[] = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] < values[i - 1] && values[i] < values[i + 1]) {
      troughs.push({ index: i, value: values[i] });
    }
  }
  return troughs;
}

/**
 * Robust peak detection - outlier resistant, adaptive.
 * Uses MAD (Median Absolute Deviation) for threshold.
 */
export function findRobustPeak(values: number[], k: number = DEFAULT_ROBUST_PEAK_K): number {
  if (values.length === 0) return 0;
  if (values.length < 3) return Math.max(...values);

  // Find all local maxima
  const peaks = findLocalMaxima(values).map((p) => p.value);

  if (peaks.length === 0) return Math.max(...values);
  if (peaks.length <= 2) return Math.max(...peaks);

  // Sort peaks descending
  const sorted = [...peaks].sort((a, b) => b - a);

  // Calculate consecutive diffs
  const diffs: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    diffs.push(sorted[i] - sorted[i + 1]);
  }

  // Median diff
  const sortedDiffs = [...diffs].sort((a, b) => a - b);
  const medianDiff = sortedDiffs[Math.floor(sortedDiffs.length / 2)];

  // MAD for adaptive threshold
  const absDevs = diffs.map((d) => Math.abs(d - medianDiff)).sort((a, b) => a - b);
  const mad = absDevs[Math.floor(absDevs.length / 2)] || medianDiff * 0.5;
  const threshold = medianDiff + k * Math.max(mad, medianDiff * 0.1);

  // Walk from top until gap is reasonable
  for (let i = 0; i < diffs.length; i++) {
    if (diffs[i] <= threshold) {
      return sorted[i];
    }
  }

  // Fallback: 95th percentile
  const allSorted = [...values].sort((a, b) => b - a);
  const idx95 = Math.floor(allSorted.length * 0.05);
  return allSorted[idx95];
}

/** Robust minimum detection (invert and use peak detection). */
export function findRobustMin(values: number[], k: number = DEFAULT_ROBUST_PEAK_K): number {
  const inverted = values.map((v) => -v);
  return -findRobustPeak(inverted, k);
}

// ─────────────────────────────────────────────────────────────────
// Cycle Detection
// ─────────────────────────────────────────────────────────────────

/** Detect movement cycles based on peaks with prominence threshold. */
export function detectMovementCycles(values: number[], timeStep: number): MovementCycle[] {
  if (values.length < 10) return [];

  const cycles: MovementCycle[] = [];
  const range = Math.max(...values) - Math.min(...values);
  const prominence = Math.max(2, range * 0.1);

  // Detect peaks with prominence
  const peaks: { index: number; value: number }[] = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] > values[i - 1] && values[i] > values[i + 1]) {
      const windowStart = Math.max(0, i - 10);
      const windowEnd = Math.min(values.length, i + 11);

      let leftMin = Infinity;
      for (let j = windowStart; j < i; j++) {
        if (values[j] < leftMin) leftMin = values[j];
      }

      let rightMin = Infinity;
      for (let j = i + 1; j < windowEnd; j++) {
        if (values[j] < rightMin) rightMin = values[j];
      }

      const peakProminence = values[i] - Math.max(leftMin, rightMin);
      if (peakProminence >= prominence) {
        peaks.push({ index: i, value: values[i] });
      }
    }
  }

  // Create cycles from consecutive peaks
  for (let i = 0; i < peaks.length - 1; i++) {
    const duration = (peaks[i + 1].index - peaks[i].index) * timeStep;
    if (duration >= MIN_CYCLE_DURATION && duration <= MAX_CYCLE_DURATION) {
      cycles.push({
        startIndex: peaks[i].index,
        endIndex: peaks[i + 1].index,
        duration,
      });
    }
  }
  return cycles;
}

// ─────────────────────────────────────────────────────────────────
// Asymmetry
// ─────────────────────────────────────────────────────────────────

/** Standard bilateral asymmetry index. */
export function calculateBilateralAsymmetry(leftValue: number, rightValue: number): number {
  const maxValue = Math.max(Math.abs(leftValue), Math.abs(rightValue));
  return maxValue > 0 ? (Math.abs(leftValue - rightValue) / maxValue) * 100 : 0;
}

// ─────────────────────────────────────────────────────────────────
// Cross-Correlation
// ─────────────────────────────────────────────────────────────────

/** Normalized cross-correlation with lag search. */
export function calculateCrossCorrelation(
  left: number[],
  right: number[]
): CrossCorrelationResult {
  const n = Math.min(left.length, right.length);
  if (n < 10) return { correlation: 1, lag: 0 };

  // Calculate means
  let meanL = 0,
    meanR = 0;
  for (let i = 0; i < n; i++) {
    meanL += left[i];
    meanR += right[i];
  }
  meanL /= n;
  meanR /= n;

  // Calculate standard deviations
  let sumSqL = 0,
    sumSqR = 0;
  for (let i = 0; i < n; i++) {
    sumSqL += (left[i] - meanL) ** 2;
    sumSqR += (right[i] - meanR) ** 2;
  }
  const stdL = Math.sqrt(sumSqL / n);
  const stdR = Math.sqrt(sumSqR / n);

  if (stdL < 1e-10 || stdR < 1e-10) return { correlation: 1, lag: 0 };

  // Search for best correlation across lags
  const maxLag = Math.min(50, Math.floor(n / 4));
  let bestCorr = -Infinity;
  let bestLag = 0;

  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let sum = 0;
    let count = 0;

    for (let i = 0; i < n; i++) {
      const j = i + lag;
      if (j >= 0 && j < n) {
        sum += (left[i] - meanL) * (right[j] - meanR);
        count++;
      }
    }

    const corr = count > 0 ? sum / (count * stdL * stdR) : 0;

    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  return { correlation: bestCorr, lag: bestLag };
}

/** Get correlation at zero lag only. */
export function calculateCorrelationAtZero(left: number[], right: number[]): number {
  const n = Math.min(left.length, right.length);
  if (n < 10) return 1;

  let meanL = 0,
    meanR = 0;
  for (let i = 0; i < n; i++) {
    meanL += left[i];
    meanR += right[i];
  }
  meanL /= n;
  meanR /= n;

  let sumSqL = 0,
    sumSqR = 0,
    sumProd = 0;
  for (let i = 0; i < n; i++) {
    const dL = left[i] - meanL;
    const dR = right[i] - meanR;
    sumSqL += dL * dL;
    sumSqR += dR * dR;
    sumProd += dL * dR;
  }

  const stdL = Math.sqrt(sumSqL / n);
  const stdR = Math.sqrt(sumSqR / n);

  if (stdL < 1e-10 || stdR < 1e-10) return 1;
  return sumProd / (n * stdL * stdR);
}

// ─────────────────────────────────────────────────────────────────
// Ground Contact Detection
// ─────────────────────────────────────────────────────────────────

/**
 * Detect ground contacts from acceleration data.
 * TODO: review needed - uses angular acceleration, not raw gyro
 */
export function detectGroundContacts(
  accel: number[],
  timeStep: number,
  impactThreshold: number = DEFAULT_IMPACT_THRESHOLD,
  freefallThreshold: number = DEFAULT_FREEFALL_THRESHOLD
): GroundContact[] {
  const contacts: GroundContact[] = [];
  let i = 0;

  while (i < accel.length - 1) {
    if (accel[i] > impactThreshold) {
      const touchdownIndex = i;
      const impactMagnitude = accel[i];

      // Find takeoff
      let takeoffIndex = i + 1;
      while (takeoffIndex < accel.length && accel[takeoffIndex] > freefallThreshold) {
        takeoffIndex++;
      }

      if (takeoffIndex < accel.length) {
        // Find next touchdown for flight time
        let nextTouchdown = takeoffIndex + 1;
        while (nextTouchdown < accel.length && accel[nextTouchdown] < impactThreshold) {
          nextTouchdown++;
        }

        const contactTimeMs = (takeoffIndex - touchdownIndex) * timeStep * 1000;
        const flightTimeMs =
          nextTouchdown < accel.length
            ? (nextTouchdown - takeoffIndex) * timeStep * 1000
            : 0;

        if (contactTimeMs > MIN_CONTACT_TIME_MS && contactTimeMs < MAX_CONTACT_TIME_MS) {
          contacts.push({
            touchdownIndex,
            takeoffIndex,
            contactTimeMs,
            flightTimeMs,
            impactMagnitude,
          });
        }

        i = nextTouchdown;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  return contacts;
}

// ─────────────────────────────────────────────────────────────────
// FFT (for SPARC)
// ─────────────────────────────────────────────────────────────────

/** DFT implementation (for production, consider fft.js library). */
export function performFFT(signal: number[]): FFTResult {
  const N = signal.length;
  const real: number[] = new Array(N).fill(0);
  const imag: number[] = new Array(N).fill(0);

  for (let k = 0; k < N; k++) {
    for (let n = 0; n < N; n++) {
      const angle = (2 * Math.PI * k * n) / N;
      real[k] += signal[n] * Math.cos(angle);
      imag[k] -= signal[n] * Math.sin(angle);
    }
  }

  return { real, imag };
}

/** Calculate magnitude spectrum from FFT result. */
export function fftMagnitude(fft: FFTResult): number[] {
  return fft.real.map((r, i) => Math.sqrt(r * r + fft.imag[i] * fft.imag[i]));
}

// ─────────────────────────────────────────────────────────────────
// Convolution (for Advanced Asymmetry)
// ─────────────────────────────────────────────────────────────────

/** Generate normalized Gaussian kernel. */
export function generateGaussianKernel(size: number): number[] {
  const kernel: number[] = new Array(size);
  const sigma = size / 4;
  const mid = Math.floor(size / 2);
  let sum = 0;

  for (let i = 0; i < size; i++) {
    const val = Math.exp(-0.5 * Math.pow((i - mid) / sigma, 2));
    kernel[i] = val;
    sum += val;
  }

  // Normalize
  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }
  return kernel;
}

/** Convolution with edge handling. */
export function convolveSignal(signal: number[], kernel: number[]): number[] {
  const result: number[] = new Array(signal.length);
  const half = Math.floor(kernel.length / 2);

  for (let i = 0; i < signal.length; i++) {
    let sum = 0;
    let weightSum = 0;

    for (let j = 0; j < kernel.length; j++) {
      const idx = i + j - half;
      if (idx >= 0 && idx < signal.length) {
        sum += signal[idx] * kernel[j];
        weightSum += kernel[j];
      }
    }

    result[i] = weightSum > 0 ? sum / weightSum : 0;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────
// Cycle Length Estimation (for Phase Analysis)
// ─────────────────────────────────────────────────────────────────

/** Estimate cycle length from autocorrelation. */
export function estimateCycleLength(signal: number[], n: number): number {
  const len = Math.min(signal.length, n);
  let meanVal = 0;
  for (let i = 0; i < len; i++) meanVal += signal[i];
  meanVal /= len;

  let sumSq = 0;
  for (let i = 0; i < len; i++) sumSq += (signal[i] - meanVal) ** 2;
  const variance = sumSq / len;
  if (variance < 1e-10) return len;

  // Find first peak in autocorrelation after lag 0
  const maxSearchLag = Math.floor(len / 2);
  let prevCorr = 1;
  let increasing = false;

  for (let lag = 1; lag < maxSearchLag; lag++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < len - lag; i++) {
      sum += (signal[i] - meanVal) * (signal[i + lag] - meanVal);
      count++;
    }
    const corr = sum / (count * variance);

    if (corr > prevCorr) increasing = true;
    if (increasing && corr < prevCorr && prevCorr > 0.3) {
      return lag - 1;
    }
    prevCorr = corr;
  }
  return maxSearchLag;
}

// ─────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return (1 - t) * a + t * b;
}

/** Clamp value between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Convert samples to time in ms. */
export function samplesToMs(samples: number, timeStep: number): number {
  return samples * timeStep * 1000;
}

/** Convert time in ms to samples. */
export function msToSamples(ms: number, timeStep: number): number {
  return Math.round(ms / (timeStep * 1000));
}

// ─────────────────────────────────────────────────────────────────
// Repeating Pattern Detection (for Phase Alignment)
// ─────────────────────────────────────────────────────────────────

const DEFAULT_VELOCITY_BIN_SIZE = 10; // deg/s

const DEFAULT_ACCELERATION_BIN_SIZE = 50; // deg/s²

/**
 * Find mask of repeating acceleration patterns using histogram binning.
 * Uses acceleration (derivative of velocity) to capture movement dynamics.
 * Points with acceleration in frequently-occurring bins (>= 75th percentile) are marked true.
 * Used to filter out transitions/noise for phase alignment.
 */
export function findRepeatingVelocityMask(
  velocities: number[],
  binSize: number = DEFAULT_ACCELERATION_BIN_SIZE
): boolean[] {
  const n = velocities.length;
  if (n < 2) return new Array(n).fill(true);

  // Compute acceleration (derivative of velocity)
  const accelerations: number[] = new Array(n);
  accelerations[0] = velocities[1] - velocities[0];
  for (let i = 1; i < n - 1; i++) {
    accelerations[i] = velocities[i + 1] - velocities[i - 1]; // central difference
  }
  accelerations[n - 1] = velocities[n - 1] - velocities[n - 2];

  // Bin accelerations into histogram
  const binned = accelerations.map((a) => Math.round(a / binSize) * binSize);

  // Count frequency of each bin
  const histogram = new Map<number, number>();
  for (const bin of binned) {
    histogram.set(bin, (histogram.get(bin) || 0) + 1);
  }

  // Find 75th percentile frequency (stricter than median)
  const frequencies = [...histogram.values()].sort((a, b) => a - b);
  const thresholdFreq = frequencies[Math.floor(frequencies.length * 0.75)];

  // Mark points in bins with frequency >= 75th percentile as repeating
  return binned.map((bin) => (histogram.get(bin) || 0) >= thresholdFreq);
}
