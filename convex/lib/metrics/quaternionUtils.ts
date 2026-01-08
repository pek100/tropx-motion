/**
 * Quaternion utilities for metrics computation.
 * Ported from motionProcessing/shared/QuaternionService.ts for Convex compatibility.
 */

import type { Quaternion } from "./types";

/**
 * Quaternion mathematical constants.
 * NOTE: These must stay in sync with motionProcessing/shared/constants.ts QUATERNION
 */
const QUATERNION_CONSTANTS = {
  /** Magnitude threshold below which a quaternion is considered degenerate. */
  EPSILON: 1e-6,
  /** Dot product threshold for using linear interpolation in SLERP.
   *  When cos(θ) > 0.9995, angle < 1.8°, LERP ≈ SLERP with better stability. */
  SLERP_LINEAR_THRESHOLD: 0.9995,
} as const;

const DEG_PER_RAD = 180 / Math.PI;

// Standard Euler extraction (ZYX/roll-pitch-yaw convention):
// X (roll):  atan2(m7, m8) = atan2(yz+wx, 1-(xx+yy))
// Y (pitch): atan2(m2, m0) = atan2(xz+wy, 1-(yy+zz))
// Z (yaw):   atan2(m3, m0) = atan2(xy+wz, 1-(yy+zz))
const AXIS_EXTRACTION_MAP = {
  x: [7, 8],
  y: [2, 0],
  z: [3, 0],
} as const;

/** Creates identity quaternion (no rotation). */
export function createIdentity(): Quaternion {
  return { w: 1, x: 0, y: 0, z: 0 };
}

/** Validates quaternion has all required numeric components. */
export function isValidQuaternion(q: unknown): q is Quaternion {
  if (!q || typeof q !== "object") return false;
  const quat = q as Record<string, unknown>;
  return (
    typeof quat.w === "number" &&
    isFinite(quat.w) &&
    typeof quat.x === "number" &&
    isFinite(quat.x) &&
    typeof quat.y === "number" &&
    isFinite(quat.y) &&
    typeof quat.z === "number" &&
    isFinite(quat.z)
  );
}

/** Calculates quaternion magnitude. */
export function magnitude(q: Quaternion): number {
  return Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z);
}

/** Normalizes quaternion to unit length. */
export function normalize(q: Quaternion): Quaternion {
  const norm = magnitude(q);
  if (norm < QUATERNION_CONSTANTS.EPSILON || !isFinite(norm)) {
    return createIdentity();
  }
  const invNorm = 1.0 / norm;
  return {
    w: q.w * invNorm,
    x: q.x * invNorm,
    y: q.y * invNorm,
    z: q.z * invNorm,
  };
}

/** Converts quaternion to 3x3 rotation matrix (row-major). */
function quaternionToMatrix(q: Quaternion): number[] {
  const { w, x, y, z } = normalize(q);
  const x2 = x + x,
    y2 = y + y,
    z2 = z + z;
  const xx = x * x2,
    xy = x * y2,
    xz = x * z2;
  const yy = y * y2,
    yz = y * z2,
    zz = z * z2;
  const wx = w * x2,
    wy = w * y2,
    wz = w * z2;

  return [
    1 - (yy + zz),
    xy - wz,
    xz + wy,
    xy + wz,
    1 - (xx + zz),
    yz - wx,
    xz - wy,
    yz + wx,
    1 - (xx + yy),
  ];
}

/**
 * Extracts rotation angle around specified axis from quaternion.
 * Returns angle in degrees.
 */
export function toEulerAngle(q: Quaternion, axis: "x" | "y" | "z" = "y"): number {
  const matrix = quaternionToMatrix(q);
  const [a, b] = AXIS_EXTRACTION_MAP[axis];
  return Math.atan2(matrix[a], matrix[b]) * DEG_PER_RAD;
}

/**
 * Extracts quaternion from flat array at given index.
 * Array format: [w,x,y,z, w,x,y,z, ...]
 */
export function extractQuaternion(
  flatArray: number[],
  sampleIndex: number
): Quaternion | null {
  const offset = sampleIndex * 4;
  if (offset + 3 >= flatArray.length) return null;

  const q: Quaternion = {
    w: flatArray[offset],
    x: flatArray[offset + 1],
    y: flatArray[offset + 2],
    z: flatArray[offset + 3],
  };

  return isValidQuaternion(q) ? q : null;
}

/**
 * Converts flat quaternion array to angle array.
 * Returns array of knee angles in degrees.
 */
export function quaternionArrayToAngles(
  flatQuaternions: number[],
  axis: "x" | "y" | "z" = "y"
): number[] {
  const sampleCount = Math.floor(flatQuaternions.length / 4);
  const angles: number[] = new Array(sampleCount);

  for (let i = 0; i < sampleCount; i++) {
    const q = extractQuaternion(flatQuaternions, i);
    angles[i] = q ? toEulerAngle(q, axis) : 0;
  }

  return angles;
}

/**
 * Validates quaternion array has expected length.
 */
export function validateQuaternionArray(
  flatArray: number[],
  expectedSamples: number
): boolean {
  return flatArray.length === expectedSamples * 4;
}

/**
 * Converts an array of angles to a minified SVG path string.
 * Uses 0-100 coordinate space for easy scaling via viewBox.
 * Y is inverted so higher angles appear higher on screen.
 *
 * @param angles - Array of angles in degrees
 * @param refRange - Optional reference range {min, max} for consistent scaling across joints
 *
 * Minification techniques applied:
 * - Integer coordinates (0-100 range doesn't need decimals)
 * - Relative line commands after initial M (shorter for sequential points)
 * - Implicit separators (negative sign acts as separator)
 * - No spaces where possible
 */
export function anglesToSvgPath(
  angles: number[],
  refRange?: { min: number; max: number }
): string {
  if (angles.length === 0) return "";
  if (angles.length === 1) return "M0,50"; // Single point at center

  const min = refRange?.min ?? Math.min(...angles);
  const max = refRange?.max ?? Math.max(...angles);
  const range = max - min || 1;

  // Pre-calculate all Y values as integers
  // Higher angles → lower Y value (top of screen)
  // Clamp values to 0-100 range in case angles exceed refRange
  const yValues = angles.map((v) => {
    const normalized = ((v - min) / range) * 100;
    return Math.round(Math.max(0, Math.min(100, normalized)));
  });

  // Calculate X step (integer)
  const xStep = 100 / (angles.length - 1);

  // Start with absolute move to first point
  const parts: string[] = [`M0,${yValues[0]}`];

  let prevX = 0;
  let prevY = yValues[0];

  for (let i = 1; i < angles.length; i++) {
    const x = Math.round(i * xStep);
    const y = yValues[i];

    const dx = x - prevX;
    const dy = y - prevY;

    // Use relative line command 'l'
    // When dy is negative, it acts as separator: "l1-5" instead of "l1,-5"
    if (dy >= 0) {
      parts.push(`l${dx},${dy}`);
    } else {
      parts.push(`l${dx}${dy}`); // Negative sign acts as separator
    }

    prevX = x;
    prevY = y;
  }

  return parts.join("");
}

/**
 * Converts flat quaternion array to SVG paths for all 3 axes.
 * Returns an object with x, y, z path strings.
 *
 * @param flatQuaternions - Flat array of quaternion components [w,x,y,z,...]
 * @param refRange - Optional reference range {min, max} for consistent scaling
 */
export function quaternionArrayToSvgPaths(
  flatQuaternions: number[],
  refRange?: { min: number; max: number }
): {
  x: string;
  y: string;
  z: string;
} {
  const anglesX = quaternionArrayToAngles(flatQuaternions, "x");
  const anglesY = quaternionArrayToAngles(flatQuaternions, "y");
  const anglesZ = quaternionArrayToAngles(flatQuaternions, "z");

  return {
    x: anglesToSvgPath(anglesX, refRange),
    y: anglesToSvgPath(anglesY, refRange),
    z: anglesToSvgPath(anglesZ, refRange),
  };
}

/**
 * Converts left and right knee quaternion arrays to SVG paths with shared scaling.
 * Both joints use the same min/max range so they're visually comparable.
 *
 * @param leftQuaternions - Flat array of left knee quaternions
 * @param rightQuaternions - Flat array of right knee quaternions
 * @returns Object with leftPaths and rightPaths, both using shared scale
 */
export function bilateralQuaternionsToSvgPaths(
  leftQuaternions: number[] | null,
  rightQuaternions: number[] | null
): {
  leftPaths: { x: string; y: string; z: string } | null;
  rightPaths: { x: string; y: string; z: string } | null;
} {
  // Collect all angles from both joints to find shared min/max
  const allAnglesX: number[] = [];
  const allAnglesY: number[] = [];
  const allAnglesZ: number[] = [];

  let leftAnglesX: number[] = [];
  let leftAnglesY: number[] = [];
  let leftAnglesZ: number[] = [];
  let rightAnglesX: number[] = [];
  let rightAnglesY: number[] = [];
  let rightAnglesZ: number[] = [];

  if (leftQuaternions && leftQuaternions.length > 0) {
    leftAnglesX = quaternionArrayToAngles(leftQuaternions, "x");
    leftAnglesY = quaternionArrayToAngles(leftQuaternions, "y");
    leftAnglesZ = quaternionArrayToAngles(leftQuaternions, "z");
    allAnglesX.push(...leftAnglesX);
    allAnglesY.push(...leftAnglesY);
    allAnglesZ.push(...leftAnglesZ);
  }

  if (rightQuaternions && rightQuaternions.length > 0) {
    rightAnglesX = quaternionArrayToAngles(rightQuaternions, "x");
    rightAnglesY = quaternionArrayToAngles(rightQuaternions, "y");
    rightAnglesZ = quaternionArrayToAngles(rightQuaternions, "z");
    allAnglesX.push(...rightAnglesX);
    allAnglesY.push(...rightAnglesY);
    allAnglesZ.push(...rightAnglesZ);
  }

  // Calculate shared range per axis
  const rangeX = allAnglesX.length > 0
    ? { min: Math.min(...allAnglesX), max: Math.max(...allAnglesX) }
    : undefined;
  const rangeY = allAnglesY.length > 0
    ? { min: Math.min(...allAnglesY), max: Math.max(...allAnglesY) }
    : undefined;
  const rangeZ = allAnglesZ.length > 0
    ? { min: Math.min(...allAnglesZ), max: Math.max(...allAnglesZ) }
    : undefined;

  // Generate paths using shared ranges
  const leftPaths = leftQuaternions && leftQuaternions.length > 0
    ? {
        x: anglesToSvgPath(leftAnglesX, rangeX),
        y: anglesToSvgPath(leftAnglesY, rangeY),
        z: anglesToSvgPath(leftAnglesZ, rangeZ),
      }
    : null;

  const rightPaths = rightQuaternions && rightQuaternions.length > 0
    ? {
        x: anglesToSvgPath(rightAnglesX, rangeX),
        y: anglesToSvgPath(rightAnglesY, rangeY),
        z: anglesToSvgPath(rightAnglesZ, rangeZ),
      }
    : null;

  return { leftPaths, rightPaths };
}
