/**
 * Movement Classifier - Client-side movement type classification
 * Lightweight port of Convex classification logic for pre-upload analysis
 */

import { QuaternionSample, quaternionToAngle } from '../QuaternionCodec';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type MovementType = 'bilateral' | 'unilateral' | 'mixed' | 'single_leg' | 'unknown';
export type ActivityProfile = 'power' | 'endurance' | 'rehabilitation' | 'general';

export interface MovementClassification {
  type: MovementType;
  confidence: number;
  correlation: number;
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const MIN_SAMPLES = 20;
const CV_THRESHOLD = 0.05; // coefficient of variation threshold for single-leg detection
const BILATERAL_THRESHOLD = 0.7;
const MIXED_THRESHOLD = 0.3;
const UNILATERAL_THRESHOLD = -0.3;

// ─────────────────────────────────────────────────────────────────
// Classification Logic
// ─────────────────────────────────────────────────────────────────

/**
 * Classify movement type from raw quaternion samples.
 * Analyzes cross-correlation between left and right knee angles.
 */
export function classifyMovement(samples: QuaternionSample[]): MovementClassification {
  if (samples.length < MIN_SAMPLES) {
    return { type: 'unknown', confidence: 0, correlation: 0 };
  }

  // Convert quaternions to angles
  const left: number[] = [];
  const right: number[] = [];

  for (const sample of samples) {
    if (sample.lq && sample.rq) {
      left.push(quaternionToAngle(sample.lq, 'y'));
      right.push(quaternionToAngle(sample.rq, 'y'));
    }
  }

  const n = Math.min(left.length, right.length);
  if (n < MIN_SAMPLES) {
    return { type: 'unknown', confidence: 0, correlation: 0 };
  }

  // Calculate means
  let meanL = 0, meanR = 0;
  for (let i = 0; i < n; i++) {
    meanL += left[i];
    meanR += right[i];
  }
  meanL /= n;
  meanR /= n;

  // Calculate standard deviations
  let sumSqL = 0, sumSqR = 0;
  for (let i = 0; i < n; i++) {
    sumSqL += (left[i] - meanL) ** 2;
    sumSqR += (right[i] - meanR) ** 2;
  }
  const stdL = Math.sqrt(sumSqL / n);
  const stdR = Math.sqrt(sumSqR / n);

  // Check for single-leg (one signal flat)
  const cvL = stdL / Math.abs(meanL || 1);
  const cvR = stdR / Math.abs(meanR || 1);
  if (cvL < CV_THRESHOLD || cvR < CV_THRESHOLD) {
    return { type: 'single_leg', confidence: 90, correlation: 0 };
  }

  if (stdL < 1e-10 || stdR < 1e-10) {
    return { type: 'unknown', confidence: 0, correlation: 0 };
  }

  // Calculate cross-correlation at zero lag
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += (left[i] - meanL) * (right[i] - meanR);
  }
  const correlation = sum / (n * stdL * stdR);

  // Classify based on correlation
  let type: MovementType;
  let confidence: number;

  if (correlation > BILATERAL_THRESHOLD) {
    // High positive correlation = bilateral (squat, jump)
    type = 'bilateral';
    confidence = Math.min(100, correlation * 100);
  } else if (correlation < UNILATERAL_THRESHOLD) {
    // Negative correlation = unilateral gait
    type = 'unilateral';
    confidence = Math.min(100, Math.abs(correlation) * 100 + 20);
  } else if (correlation > MIXED_THRESHOLD) {
    // Moderate correlation = mixed
    type = 'mixed';
    confidence = 50 + (correlation - MIXED_THRESHOLD) * 50;
  } else {
    // Low correlation
    type = 'unilateral';
    confidence = 60;
  }

  return { type, confidence, correlation };
}

// ─────────────────────────────────────────────────────────────────
// Activity Profile Mapping
// ─────────────────────────────────────────────────────────────────

/**
 * Map movement classification to suggested activity profile.
 */
export function getDefaultActivityProfile(classification: MovementClassification): ActivityProfile {
  switch (classification.type) {
    case 'bilateral':
      return 'power';         // Squats, jumps - synchronized explosive
    case 'unilateral':
      return 'endurance';     // Gait, running - rhythmic alternating
    case 'mixed':
      return 'general';       // Varied/transitional
    case 'single_leg':
    case 'unknown':
    default:
      return 'rehabilitation'; // Controlled therapy work
  }
}

/**
 * Convenience function: classify samples and return suggested activity profile.
 */
export function detectActivityProfile(samples: QuaternionSample[]): {
  profile: ActivityProfile;
  classification: MovementClassification;
} {
  const classification = classifyMovement(samples);
  const profile = getDefaultActivityProfile(classification);
  return { profile, classification };
}
