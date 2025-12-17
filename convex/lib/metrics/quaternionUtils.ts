/**
 * Quaternion utilities for metrics computation.
 * Ported from motionProcessing/shared/QuaternionService.ts for Convex compatibility.
 */

import type { Quaternion } from "./types";

const EPSILON = 1e-10;
const DEG_PER_RAD = 180 / Math.PI;

// Axis extraction map for rotation matrix → Euler angle
const AXIS_EXTRACTION_MAP = {
  x: [5, 4],
  y: [2, 0],
  z: [1, 3],
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
  if (norm < EPSILON || !isFinite(norm)) {
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
