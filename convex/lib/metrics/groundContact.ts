/**
 * Ground Contact, Force, Stiffness, and Gait Metrics (#20-28, #35-37)
 * Based on biomechanical-metrics-spec-v1.2.md
 *
 * TODO: review needed - All metrics in this file use angular acceleration
 * derived from joint angle data, NOT raw gyroscope/accelerometer data.
 * Results may differ from true biomechanical measurements.
 */

import type {
  JumpMetrics,
  ForcePowerMetrics,
  StiffnessMetrics,
  GaitCycleMetrics,
  GroundContact,
} from "./types";
import {
  calculateDerivative,
  detectGroundContacts,
  findRobustPeak,
} from "./helpers";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const GRAVITY = 9.81; // m/s²
const DEFAULT_MASS_KG = 70; // default body mass for stiffness calculations

// ─────────────────────────────────────────────────────────────────
// Ground Contact & Jump Metrics (#20-23)
// ─────────────────────────────────────────────────────────────────

/**
 * #20: ground_contact_time_ms
 * Average duration foot contacts ground.
 * TODO: review needed - uses angular acceleration, not raw gyro
 */
export function calculateGroundContactTime(accel: number[], timeStep: number): number {
  const contacts = detectGroundContacts(accel, timeStep);
  if (contacts.length === 0) return 0;

  let totalContact = 0;
  for (const c of contacts) {
    totalContact += c.contactTimeMs;
  }
  return totalContact / contacts.length;
}

/**
 * #21: flight_time_ms
 * Average airborne duration during jumps.
 * TODO: review needed - uses angular acceleration, not raw gyro
 */
export function calculateFlightTime(accel: number[], timeStep: number): number {
  const contacts = detectGroundContacts(accel, timeStep);
  if (contacts.length === 0) return 0;

  const validFlights = contacts.filter((c) => c.flightTimeMs > 0);
  if (validFlights.length === 0) return 0;

  let totalFlight = 0;
  for (const c of validFlights) {
    totalFlight += c.flightTimeMs;
  }
  return totalFlight / validFlights.length;
}

/**
 * #22: jump_height_cm
 * Estimated vertical displacement from flight time.
 * Formula: h = g * t² / 8
 * TODO: review needed - uses angular acceleration, not raw gyro
 */
export function calculateJumpHeight(flightTimeMs: number): number {
  if (flightTimeMs <= 0) return 0;
  const t = flightTimeMs / 1000;
  const heightM = (GRAVITY * t * t) / 8;
  return heightM * 100; // Convert to cm
}

/**
 * #23: RSI (Reactive Strength Index)
 * Ratio of jump height to ground contact time.
 * Formula: RSI = jump_height(m) / ground_contact_time(s)
 * TODO: review needed - uses angular acceleration, not raw gyro
 */
export function calculateRSI(jumpHeightCm: number, groundContactTimeMs: number): number {
  if (groundContactTimeMs <= 0) return 0;
  const heightM = jumpHeightCm / 100;
  const contactS = groundContactTimeMs / 1000;
  return heightM / contactS;
}

/** Calculate all jump metrics. */
export function calculateJumpMetrics(accel: number[], timeStep: number): JumpMetrics {
  const groundContactTimeMs = calculateGroundContactTime(accel, timeStep);
  const flightTimeMs = calculateFlightTime(accel, timeStep);
  const jumpHeightCm = calculateJumpHeight(flightTimeMs);
  const rsi = calculateRSI(jumpHeightCm, groundContactTimeMs);

  return {
    groundContactTimeMs,
    flightTimeMs,
    jumpHeightCm,
    rsi,
  };
}

// ─────────────────────────────────────────────────────────────────
// Force/Power Metrics (#24-26)
// ─────────────────────────────────────────────────────────────────

/**
 * #24: eRFD (Estimated Rate of Force Development)
 * Rate of acceleration change during concentric phase.
 * TODO: review needed - uses angular acceleration, not raw gyro
 */
export function calculateERFD(accel: number[], timeStep: number): number {
  // Find the steepest positive slope in acceleration
  let maxRFD = 0;
  const windowSize = Math.max(5, Math.floor(0.05 / timeStep)); // 50ms window

  for (let i = 0; i < accel.length - windowSize; i++) {
    const rfd = (accel[i + windowSize] - accel[i]) / (windowSize * timeStep);
    if (rfd > maxRFD) {
      maxRFD = rfd;
    }
  }

  return maxRFD;
}

/**
 * #25: normalized_force (peak)
 * Peak force relative to body weight.
 * TODO: review needed - uses angular acceleration, not raw gyro
 */
export function calculatePeakNormalizedForce(accel: number[]): number {
  if (accel.length === 0) return 0;
  const absAccel = accel.map(Math.abs);
  return findRobustPeak(absAccel);
}

/**
 * #26: impulse_estimate
 * Integral of acceleration over time (velocity change).
 * TODO: review needed - uses angular acceleration, not raw gyro
 */
export function calculateImpulseEstimate(accel: number[], timeStep: number): number {
  if (accel.length < 2) return 0;

  // Trapezoidal integration
  let impulse = 0;
  for (let i = 1; i < accel.length; i++) {
    impulse += ((accel[i] + accel[i - 1]) / 2) * timeStep;
  }
  return impulse;
}

/** Calculate all force/power metrics. */
export function calculateForcePowerMetrics(accel: number[], timeStep: number): ForcePowerMetrics {
  return {
    eRFD: calculateERFD(accel, timeStep),
    peakNormalizedForce: calculatePeakNormalizedForce(accel),
    impulseEstimate: calculateImpulseEstimate(accel, timeStep),
  };
}

// ─────────────────────────────────────────────────────────────────
// Stiffness Metrics (#27-28)
// ─────────────────────────────────────────────────────────────────

/**
 * #27: leg_stiffness
 * Spring-like behavior of the leg (Morin method).
 * Formula: k_leg = m * π * (tf + tc) / (tc² * ((tf + tc)/π - tc/4))
 * TODO: review needed - uses angular acceleration, not raw gyro
 */
export function calculateLegStiffness(
  mass: number,
  flightTimeMs: number,
  contactTimeMs: number
): number {
  if (contactTimeMs <= 0 || mass <= 0) return 0;

  const tf = flightTimeMs / 1000;
  const tc = contactTimeMs / 1000;

  const numerator = mass * Math.PI * (tf + tc);
  const denominator = tc * tc * ((tf + tc) / Math.PI - tc / 4);

  if (denominator <= 0) return 0;

  return numerator / denominator; // N/m
}

/**
 * #28: vertical_stiffness
 * Vertical spring stiffness (Morin method from temporal params).
 * TODO: review needed - uses angular acceleration, not raw gyro
 */
export function calculateVerticalStiffness(
  mass: number,
  flightTimeMs: number,
  contactTimeMs: number
): number {
  if (contactTimeMs <= 0 || mass <= 0) return 0;

  const tf = flightTimeMs / 1000;
  const tc = contactTimeMs / 1000;

  // Estimate peak force (sine wave assumption)
  const Fmax = mass * GRAVITY * (Math.PI / 2) * (tf / tc + 1);

  // Estimate COM displacement
  const deltaY = (Fmax * tc * tc) / (mass * Math.PI * Math.PI);

  return deltaY > 0 ? Fmax / deltaY : 0; // N/m
}

/** Calculate all stiffness metrics. */
export function calculateStiffnessMetrics(
  flightTimeMs: number,
  contactTimeMs: number,
  mass: number = DEFAULT_MASS_KG
): StiffnessMetrics {
  return {
    legStiffness: calculateLegStiffness(mass, flightTimeMs, contactTimeMs),
    verticalStiffness: calculateVerticalStiffness(mass, flightTimeMs, contactTimeMs),
  };
}

// ─────────────────────────────────────────────────────────────────
// Gait Cycle Metrics (#35-37)
// ─────────────────────────────────────────────────────────────────

/**
 * #35: stance_phase_pct
 * Percentage of gait cycle spent in stance.
 * TODO: review needed - uses angular acceleration, not raw gyro
 */
export function calculateStancePhasePct(stanceTimeMs: number, strideTimeMs: number): number {
  return strideTimeMs > 0 ? (stanceTimeMs / strideTimeMs) * 100 : 0;
}

/**
 * #36: swing_phase_pct
 * Percentage of gait cycle spent in swing.
 * TODO: review needed - uses angular acceleration, not raw gyro
 */
export function calculateSwingPhasePct(stanceTimeMs: number, strideTimeMs: number): number {
  if (strideTimeMs <= 0) return 0;
  const swingTimeMs = strideTimeMs - stanceTimeMs;
  return (swingTimeMs / strideTimeMs) * 100;
}

/**
 * #37: duty_factor
 * Ratio of contact time to stride time (0-1).
 * TODO: review needed - uses angular acceleration, not raw gyro
 */
export function calculateDutyFactor(contactTimeMs: number, strideTimeMs: number): number {
  return strideTimeMs > 0 ? contactTimeMs / strideTimeMs : 0;
}

/** Calculate all gait cycle metrics from ground contacts. */
export function calculateGaitCycleMetrics(accel: number[], timeStep: number): GaitCycleMetrics {
  const contacts = detectGroundContacts(accel, timeStep);

  if (contacts.length < 2) {
    return {
      stancePhasePct: 0,
      swingPhasePct: 0,
      dutyFactor: 0,
      strideTimeMs: 0,
    };
  }

  // Average stride time from consecutive contacts
  let totalStrideTime = 0;
  for (let i = 0; i < contacts.length - 1; i++) {
    const strideTime =
      (contacts[i + 1].touchdownIndex - contacts[i].touchdownIndex) * timeStep * 1000;
    totalStrideTime += strideTime;
  }
  const avgStrideTimeMs = totalStrideTime / (contacts.length - 1);

  // Average contact time (stance)
  let totalContactTime = 0;
  for (const c of contacts) {
    totalContactTime += c.contactTimeMs;
  }
  const avgContactTimeMs = totalContactTime / contacts.length;

  return {
    stancePhasePct: calculateStancePhasePct(avgContactTimeMs, avgStrideTimeMs),
    swingPhasePct: calculateSwingPhasePct(avgContactTimeMs, avgStrideTimeMs),
    dutyFactor: calculateDutyFactor(avgContactTimeMs, avgStrideTimeMs),
    strideTimeMs: avgStrideTimeMs,
  };
}

// ─────────────────────────────────────────────────────────────────
// Utility: Get acceleration from angles
// ─────────────────────────────────────────────────────────────────

/**
 * Derive angular acceleration from angle data.
 * Note: This is the second derivative of angle, not raw accelerometer data.
 * TODO: review needed - results may differ from true accelerometer measurements
 */
export function deriveAngularAcceleration(angles: number[], timeStep: number): number[] {
  const velocity = calculateDerivative(angles, timeStep);
  const acceleration = calculateDerivative(velocity, timeStep);
  return acceleration;
}
