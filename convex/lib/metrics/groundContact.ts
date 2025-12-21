/**
 * Ground Contact, Force, Stiffness, and Gait Metrics (#20-28, #35-37)
 * Based on biomechanical-metrics-spec-v1.2.md
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ❌ ALL METRICS IN THIS FILE ARE DISABLED - NEEDS ACCELEROMETER DATA     ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║                                                                           ║
 * ║  These metrics require linear accelerometer data, NOT angular data       ║
 * ║  derived from knee joint angles. The current implementation produces     ║
 * ║  meaningless values.                                                     ║
 * ║                                                                           ║
 * ║  Affected metrics:                                                        ║
 * ║  • #20 Ground Contact Time - needs impact detection from accelerometer  ║
 * ║  • #21 Flight Time - needs "quiet period" detection during flight        ║
 * ║  • #22 Jump Height - depends on accurate flight time                     ║
 * ║  • #23 RSI - depends on jump height + contact time                       ║
 * ║  • #24 eRFD - needs linear acceleration (g/s)                            ║
 * ║  • #25 Normalized Force - F = m×a requires linear acceleration           ║
 * ║  • #26 Impulse Estimate - ∫a(t)dt needs linear acceleration              ║
 * ║  • #27 Leg Stiffness - k = F/Δx, F needs accelerometer + body mass       ║
 * ║  • #28 Vertical Stiffness - same as leg stiffness                        ║
 * ║  • #35-37 Gait Cycle - needs foot contact detection                      ║
 * ║                                                                           ║
 * ║  TODO: Re-enable when accelerometer data is available from IMU sensors.  ║
 * ║        Will also need user body mass input for stiffness calculations.   ║
 * ║                                                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
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
  // detectGroundContacts, // DISABLED - not usable with angular data
  // findRobustPeak,       // DISABLED - not needed
} from "./helpers";

// ─────────────────────────────────────────────────────────────────
// Constants (retained for future use when accelerometer data available)
// ─────────────────────────────────────────────────────────────────

const _GRAVITY = 9.81; // m/s² - unused until accelerometer enabled
const _DEFAULT_MASS_KG = 70; // default body mass - unused until accelerometer enabled

// ─────────────────────────────────────────────────────────────────
// Ground Contact & Jump Metrics (#20-23) - ❌ DISABLED
// ─────────────────────────────────────────────────────────────────

/**
 * #20: ground_contact_time_ms
 * ❌ DISABLED - NEEDS ACCELEROMETER DATA
 * Requires impact detection from linear accelerometer to detect foot contact.
 */
export function calculateGroundContactTime(_accel: number[], _timeStep: number): number {
  return 0; // DISABLED
}

/**
 * #21: flight_time_ms
 * ❌ DISABLED - NEEDS ACCELEROMETER DATA
 * Requires "quiet period" detection (near-zero g) during flight phase.
 */
export function calculateFlightTime(_accel: number[], _timeStep: number): number {
  return 0; // DISABLED
}

/**
 * #22: jump_height_cm
 * ❌ DISABLED - NEEDS ACCELEROMETER DATA
 * Formula h = g*t²/8 requires accurate flight time from accelerometer.
 */
export function calculateJumpHeight(_flightTimeMs: number): number {
  return 0; // DISABLED
}

/**
 * #23: RSI (Reactive Strength Index)
 * ❌ DISABLED - NEEDS ACCELEROMETER DATA
 * Depends on jump height + contact time (both require accelerometer).
 */
export function calculateRSI(_jumpHeightCm: number, _groundContactTimeMs: number): number {
  return 0; // DISABLED
}

/**
 * Calculate all jump metrics.
 * ❌ DISABLED - All values return 0 until accelerometer data available.
 */
export function calculateJumpMetrics(_accel: number[], _timeStep: number): JumpMetrics {
  return {
    groundContactTimeMs: 0,
    flightTimeMs: 0,
    jumpHeightCm: 0,
    rsi: 0,
  };
}

// ─────────────────────────────────────────────────────────────────
// Force/Power Metrics (#24-26) - ❌ DISABLED
// ─────────────────────────────────────────────────────────────────

/**
 * #24: eRFD (Estimated Rate of Force Development)
 * ❌ DISABLED - NEEDS ACCELEROMETER DATA
 * RFD is measured in g/s and requires linear acceleration, not angular.
 */
export function calculateERFD(_accel: number[], _timeStep: number): number {
  return 0; // DISABLED
}

/**
 * #25: normalized_force (peak)
 * ❌ DISABLED - NEEDS ACCELEROMETER DATA
 * F = m×a requires linear acceleration from accelerometer.
 */
export function calculatePeakNormalizedForce(_accel: number[]): number {
  return 0; // DISABLED
}

/**
 * #26: impulse_estimate
 * ❌ DISABLED - NEEDS ACCELEROMETER DATA
 * ∫a(t)dt needs linear acceleration from accelerometer.
 */
export function calculateImpulseEstimate(_accel: number[], _timeStep: number): number {
  return 0; // DISABLED
}

/**
 * Calculate all force/power metrics.
 * ❌ DISABLED - All values return 0 until accelerometer data available.
 */
export function calculateForcePowerMetrics(_accel: number[], _timeStep: number): ForcePowerMetrics {
  return {
    eRFD: 0,
    peakNormalizedForce: 0,
    impulseEstimate: 0,
  };
}

// ─────────────────────────────────────────────────────────────────
// Stiffness Metrics (#27-28) - ❌ DISABLED
// ─────────────────────────────────────────────────────────────────

/**
 * #27: leg_stiffness
 * ❌ DISABLED - NEEDS ACCELEROMETER DATA + BODY MASS
 * k = F/Δx requires force from accelerometer and user body mass input.
 * Currently uses hardcoded 70kg which is meaningless.
 */
export function calculateLegStiffness(
  _mass: number,
  _flightTimeMs: number,
  _contactTimeMs: number
): number {
  return 0; // DISABLED
}

/**
 * #28: vertical_stiffness
 * ❌ DISABLED - NEEDS ACCELEROMETER DATA + BODY MASS
 * Same requirements as leg stiffness.
 */
export function calculateVerticalStiffness(
  _mass: number,
  _flightTimeMs: number,
  _contactTimeMs: number
): number {
  return 0; // DISABLED
}

/**
 * Calculate all stiffness metrics.
 * ❌ DISABLED - All values return 0 until accelerometer data + body mass available.
 */
export function calculateStiffnessMetrics(
  _flightTimeMs: number,
  _contactTimeMs: number,
  _mass: number = _DEFAULT_MASS_KG
): StiffnessMetrics {
  return {
    legStiffness: 0,
    verticalStiffness: 0,
  };
}

// ─────────────────────────────────────────────────────────────────
// Gait Cycle Metrics (#35-37) - ❌ DISABLED
// ─────────────────────────────────────────────────────────────────

/**
 * #35: stance_phase_pct
 * ❌ DISABLED - NEEDS ACCELEROMETER/PRESSURE DATA
 * Requires foot contact detection from accelerometer or pressure sensors.
 */
export function calculateStancePhasePct(_stanceTimeMs: number, _strideTimeMs: number): number {
  return 0; // DISABLED
}

/**
 * #36: swing_phase_pct
 * ❌ DISABLED - NEEDS ACCELEROMETER/PRESSURE DATA
 * Requires foot contact detection from accelerometer or pressure sensors.
 */
export function calculateSwingPhasePct(_stanceTimeMs: number, _strideTimeMs: number): number {
  return 0; // DISABLED
}

/**
 * #37: duty_factor
 * ❌ DISABLED - NEEDS ACCELEROMETER/PRESSURE DATA
 * Requires foot contact detection from accelerometer or pressure sensors.
 */
export function calculateDutyFactor(_contactTimeMs: number, _strideTimeMs: number): number {
  return 0; // DISABLED
}

/**
 * Calculate all gait cycle metrics.
 * ❌ DISABLED - All values return 0 until accelerometer/pressure data available.
 */
export function calculateGaitCycleMetrics(_accel: number[], _timeStep: number): GaitCycleMetrics {
  return {
    stancePhasePct: 0,
    swingPhasePct: 0,
    dutyFactor: 0,
    strideTimeMs: 0,
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
