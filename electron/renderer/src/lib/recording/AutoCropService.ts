/**
 * AutoCropService - Automatically detect optimal crop boundaries using FFT.
 *
 * Uses FFT to filter the signal to human movement frequencies, then applies
 * threshold-based detection to find where meaningful movement starts and ends.
 *
 * Algorithm:
 * 1. Convert quaternions to angles for each joint
 * 2. FFT the entire signal
 * 3. Bandpass filter: zero out frequencies outside human movement range (0.2-5 Hz)
 * 4. Inverse FFT to get filtered signal
 * 5. Compute envelope (absolute value) of filtered signal
 * 6. Threshold to find where movement starts and ends
 * 7. Take the intersection across all joints
 *
 * Human movement frequency bands:
 * - Slow movements (rehab, stretching): 0.1 - 0.5 Hz
 * - Walking, squats, lunges: 0.5 - 2 Hz
 * - Running, jumping: 2 - 5 Hz
 */

import { QuaternionSample, quaternionToAngle } from '../../../../../shared/QuaternionCodec';

export interface AutoCropResult {
  startMs: number;
  endMs: number;
  confidence: number; // 0-1, how confident we are in the crop
  detected: boolean;  // Whether a crop was detected (false = keep full recording)
}

interface JointCropResult {
  startIdx: number;
  endIdx: number;
  confidence: number;
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const MIN_CROP_SAMPLES = 50;         // Minimum samples to attempt auto-crop

// Human movement frequency bands (Hz)
const MIN_MOVEMENT_FREQ = 0.6;       // Slowest meaningful movement
const MAX_MOVEMENT_FREQ = 5.0;       // Fastest meaningful movement

// Detection thresholds
const ENVELOPE_THRESHOLD_PERCENTILE = 0.65;  // Top 85% of envelope amplitude = moving
const EDGE_PADDING_MS = 0;         // Padding to add at edges after detection
const MIN_DURATION_RATIO = 0;      // Minimum crop must be 10% of original
const SMOOTHING_WINDOW = 0;         // Samples to smooth the envelope

// ─────────────────────────────────────────────────────────────────
// Main Function
// ─────────────────────────────────────────────────────────────────

/**
 * Detect optimal crop boundaries for a recording using FFT bandpass filtering.
 * @param samples QuaternionSample array from the recording
 * @param durationMs Total duration in milliseconds
 */
export function detectAutoCrop(
  samples: QuaternionSample[],
  durationMs: number
): AutoCropResult {
  if (samples.length < MIN_CROP_SAMPLES || durationMs <= 0) {
    return { startMs: 0, endMs: durationMs, confidence: 0, detected: false };
  }

  // Calculate sample rate dynamically from data
  const sampleRate = samples.length / (durationMs / 1000);
  const timeStep = durationMs / samples.length; // ms per sample

  // Extract angles for each joint
  const leftAngles = samples.map(s => s.lq ? quaternionToAngle(s.lq, 'y') : null);
  const rightAngles = samples.map(s => s.rq ? quaternionToAngle(s.rq, 'y') : null);

  // Detect crop for each joint
  const results: JointCropResult[] = [];

  if (leftAngles.some(a => a !== null)) {
    const leftResult = detectJointCrop(leftAngles, sampleRate);
    if (leftResult) results.push(leftResult);
  }

  if (rightAngles.some(a => a !== null)) {
    const rightResult = detectJointCrop(rightAngles, sampleRate);
    if (rightResult) results.push(rightResult);
  }

  if (results.length === 0) {
    return { startMs: 0, endMs: durationMs, confidence: 0, detected: false };
  }

  // Take the intersection (max start, min end) across joints
  const startIdx = Math.max(...results.map(r => r.startIdx));
  const endIdx = Math.min(...results.map(r => r.endIdx));
  const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;

  // Validate the crop makes sense
  const cropLength = endIdx - startIdx;
  if (cropLength < samples.length * MIN_DURATION_RATIO) {
    return { startMs: 0, endMs: durationMs, confidence: 0, detected: false };
  }

  // Convert to milliseconds with padding
  let startMs = Math.max(0, (startIdx * timeStep) - EDGE_PADDING_MS);
  let endMs = Math.min(durationMs, (endIdx * timeStep) + EDGE_PADDING_MS);

  // If crop is very close to full duration, don't bother
  if (startMs < 100 && endMs > durationMs - 100) {
    return { startMs: 0, endMs: durationMs, confidence: 0, detected: false };
  }

  return {
    startMs,
    endMs,
    confidence: avgConfidence,
    detected: true,
  };
}

// ─────────────────────────────────────────────────────────────────
// Joint-level Detection
// ─────────────────────────────────────────────────────────────────

function detectJointCrop(
  angles: (number | null)[],
  sampleRate: number
): JointCropResult | null {
  // Fill nulls with interpolation
  const filled = fillNulls(angles);
  if (filled.length < MIN_CROP_SAMPLES) return null;

  // FFT the entire signal, bandpass filter, then inverse FFT
  const filtered = bandpassFilter(filled, sampleRate, MIN_MOVEMENT_FREQ, MAX_MOVEMENT_FREQ);

  // Compute envelope (absolute value) and smooth it
  const envelope = filtered.map(Math.abs);
  const smoothed = smoothSignal(envelope, SMOOTHING_WINDOW);

  // Find threshold based on percentile
  const sortedEnvelope = [...smoothed].sort((a, b) => a - b);
  const thresholdIdx = Math.floor(sortedEnvelope.length * ENVELOPE_THRESHOLD_PERCENTILE);
  const threshold = sortedEnvelope[thresholdIdx];

  // Find where envelope exceeds threshold
  const aboveThreshold = smoothed.map(v => v > threshold);

  // Find first and last regions above threshold
  const startIdx = findFirstAboveThreshold(aboveThreshold);
  const endIdx = findLastAboveThreshold(aboveThreshold);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return null;
  }

  // Confidence based on how much of the signal is in the movement region
  const regionEnvelope = smoothed.slice(startIdx, endIdx + 1);
  const maxEnvelope = Math.max(...smoothed);
  const avgRegionEnvelope = regionEnvelope.reduce((a, b) => a + b, 0) / regionEnvelope.length;
  const confidence = maxEnvelope > 0 ? avgRegionEnvelope / maxEnvelope : 0;

  return { startIdx, endIdx, confidence };
}

// ─────────────────────────────────────────────────────────────────
// FFT Bandpass Filter
// ─────────────────────────────────────────────────────────────────

/**
 * Apply bandpass filter using FFT.
 * 1. FFT the signal
 * 2. Zero out frequencies outside the passband
 * 3. Inverse FFT to reconstruct
 */
function bandpassFilter(
  signal: number[],
  sampleRate: number,
  lowFreq: number,
  highFreq: number
): number[] {
  const n = signal.length;

  // Remove DC component (mean)
  const mean = signal.reduce((a, b) => a + b, 0) / n;
  const centered = signal.map(v => v - mean);

  // Compute FFT
  const fft = computeFFT(centered);

  // Apply bandpass filter in frequency domain
  const freqResolution = sampleRate / n;

  for (let k = 0; k < n; k++) {
    // For real signals, frequency bins are symmetric
    // k < n/2: positive frequencies
    // k > n/2: negative frequencies (mirror)
    const freq = k <= n / 2 ? k * freqResolution : (n - k) * freqResolution;

    // Zero out frequencies outside the passband
    if (freq < lowFreq || freq > highFreq) {
      fft.real[k] = 0;
      fft.imag[k] = 0;
    }
  }

  // Inverse FFT to reconstruct filtered signal
  const filtered = computeInverseFFT(fft);

  return filtered;
}

/**
 * Compute FFT using DFT (O(n²) but acceptable for typical recording lengths).
 */
function computeFFT(signal: number[]): { real: number[]; imag: number[] } {
  const n = signal.length;
  const real: number[] = new Array(n).fill(0);
  const imag: number[] = new Array(n).fill(0);

  for (let k = 0; k < n; k++) {
    for (let t = 0; t < n; t++) {
      const angle = (2 * Math.PI * k * t) / n;
      real[k] += signal[t] * Math.cos(angle);
      imag[k] -= signal[t] * Math.sin(angle);
    }
  }

  return { real, imag };
}

/**
 * Compute inverse FFT.
 */
function computeInverseFFT(fft: { real: number[]; imag: number[] }): number[] {
  const n = fft.real.length;
  const result: number[] = new Array(n).fill(0);

  for (let t = 0; t < n; t++) {
    for (let k = 0; k < n; k++) {
      const angle = (2 * Math.PI * k * t) / n;
      result[t] += fft.real[k] * Math.cos(angle) - fft.imag[k] * Math.sin(angle);
    }
    result[t] /= n;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function fillNulls(data: (number | null)[]): number[] {
  const result: number[] = [];
  let lastValid = 0;

  for (const val of data) {
    if (val !== null) {
      lastValid = val;
      result.push(val);
    } else {
      result.push(lastValid);
    }
  }

  return result;
}

/**
 * Smooth signal using moving average.
 */
function smoothSignal(signal: number[], windowSize: number): number[] {
  const halfWindow = Math.floor(windowSize / 2);
  const result: number[] = [];

  for (let i = 0; i < signal.length; i++) {
    const start = Math.max(0, i - halfWindow);
    const end = Math.min(signal.length, i + halfWindow + 1);
    const window = signal.slice(start, end);
    const avg = window.reduce((a, b) => a + b, 0) / window.length;
    result.push(avg);
  }

  return result;
}

/**
 * Find first index where the signal is above threshold.
 */
function findFirstAboveThreshold(flags: boolean[]): number {
  for (let i = 0; i < flags.length; i++) {
    if (flags[i]) return i;
  }
  return -1;
}

/**
 * Find last index where the signal is above threshold.
 */
function findLastAboveThreshold(flags: boolean[]): number {
  for (let i = flags.length - 1; i >= 0; i--) {
    if (flags[i]) return i;
  }
  return -1;
}

export default detectAutoCrop;
