/**
 * QuaternionCodec - Shared encode/decode layer for quaternion storage.
 * Used by both save (to Convex) and load (from Convex) paths.
 */

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface Quaternion {
  w: number;
  x: number;
  y: number;
  z: number;
}

export interface QuaternionSample {
  t: number;
  lq: Quaternion | null;
  rq: Quaternion | null;
}

export interface UniformSample {
  t: number;
  lq: Quaternion | null;
  rq: Quaternion | null;
  leftFlag: SampleFlag;
  rightFlag: SampleFlag;
}

export enum SampleFlag {
  REAL = 0,
  INTERPOLATED = 1,
  MISSING = 2,
}

export interface PackedChunkData {
  startTime: number;
  endTime: number;
  sampleRate: number;
  sampleCount: number;
  activeJoints: string[];
  leftKneeQ: number[];
  rightKneeQ: number[];
  leftKneeInterpolated: number[];
  leftKneeMissing: number[];
  rightKneeInterpolated: number[];
  rightKneeMissing: number[];
}

export interface AngleSample {
  t: number;
  relative_s: number;
  left: number;
  right: number;
  leftFlag: SampleFlag;
  rightFlag: SampleFlag;
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const IDENTITY_QUAT: Quaternion = { w: 1, x: 0, y: 0, z: 0 };
const JOINTS = {
  LEFT_KNEE: "left_knee",
  RIGHT_KNEE: "right_knee",
} as const;

// ─────────────────────────────────────────────────────────────────
// Quaternion Math
// ─────────────────────────────────────────────────────────────────

/** Euler axis for angle extraction */
export type EulerAxis = 'x' | 'y' | 'z';

function dot(q1: Quaternion, q2: Quaternion): number {
  return q1.w * q2.w + q1.x * q2.x + q1.y * q2.y + q1.z * q2.z;
}

function normalize(q: Quaternion): Quaternion {
  const len = Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z);
  if (len === 0) return IDENTITY_QUAT;
  return { w: q.w / len, x: q.x / len, y: q.y / len, z: q.z / len };
}

/** SLERP interpolation between two quaternions */
export function slerp(q1: Quaternion, q2: Quaternion, t: number): Quaternion {
  let q2Adj = { ...q2 };
  let cosHalfTheta = dot(q1, q2);

  // Take shorter path
  if (cosHalfTheta < 0) {
    q2Adj = { w: -q2.w, x: -q2.x, y: -q2.y, z: -q2.z };
    cosHalfTheta = -cosHalfTheta;
  }

  // If quaternions are very close, use linear interpolation
  if (cosHalfTheta > 0.9995) {
    return normalize({
      w: q1.w + t * (q2Adj.w - q1.w),
      x: q1.x + t * (q2Adj.x - q1.x),
      y: q1.y + t * (q2Adj.y - q1.y),
      z: q1.z + t * (q2Adj.z - q1.z),
    });
  }

  const halfTheta = Math.acos(cosHalfTheta);
  const sinHalfTheta = Math.sqrt(1 - cosHalfTheta * cosHalfTheta);

  const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
  const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

  return {
    w: q1.w * ratioA + q2Adj.w * ratioB,
    x: q1.x * ratioA + q2Adj.x * ratioB,
    y: q1.y * ratioA + q2Adj.y * ratioB,
    z: q1.z * ratioA + q2Adj.z * ratioB,
  };
}

/**
 * Convert quaternion to Euler angle for a specific axis using rotation matrix.
 * Uses ZYX (aerospace) convention for decomposition.
 *
 * Rotation matrix from quaternion q = (w, x, y, z):
 * R = | 1-2(y²+z²)   2(xy-wz)    2(xz+wy) |
 *     | 2(xy+wz)    1-2(x²+z²)   2(yz-wx) |
 *     | 2(xz-wy)    2(yz+wx)    1-2(x²+y²) |
 *
 * Euler angles (ZYX order):
 * - X (Roll):  atan2(R₃₂, R₃₃) = atan2(2(yz+wx), 1-2(x²+y²))
 * - Y (Pitch): asin(-R₃₁) = asin(2(wy-xz)), with gimbal lock handling
 * - Z (Yaw):   atan2(R₂₁, R₁₁) = atan2(2(xy+wz), 1-2(y²+z²))
 *
 * @param q - Quaternion to convert
 * @param axis - Target axis ('x', 'y', or 'z'), defaults to 'y'
 * @returns Angle in degrees
 */
export function quaternionToAngle(q: Quaternion, axis: EulerAxis = 'y'): number {
  const { w, x, y, z } = q;
  let angle: number;

  switch (axis) {
    case 'x': {
      // Roll: atan2(2(yz + wx), 1 - 2(x² + y²))
      const sinr_cosp = 2 * (y * z + w * x);
      const cosr_cosp = 1 - 2 * (x * x + y * y);
      angle = Math.atan2(sinr_cosp, cosr_cosp);
      break;
    }
    case 'y': {
      // Pitch: asin(2(wy - xz)) with gimbal lock handling
      const sinp = 2 * (w * y - z * x);
      if (Math.abs(sinp) >= 1) {
        // Gimbal lock: clamp to ±90°
        angle = (Math.PI / 2) * Math.sign(sinp);
      } else {
        angle = Math.asin(sinp);
      }
      break;
    }
    case 'z': {
      // Yaw: atan2(2(xy + wz), 1 - 2(y² + z²))
      const siny_cosp = 2 * (x * y + w * z);
      const cosy_cosp = 1 - 2 * (y * y + z * z);
      angle = Math.atan2(siny_cosp, cosy_cosp);
      break;
    }
  }

  // Convert radians to degrees
  return angle * (180 / Math.PI);
}

/**
 * Convert quaternion to Euler angle (Y-axis / pitch) in degrees.
 * @deprecated Use quaternionToAngle(q, 'y') instead
 */
export function toEulerAngleY(q: Quaternion): number {
  return quaternionToAngle(q, 'y');
}

// ─────────────────────────────────────────────────────────────────
// Packing (for Convex upload)
// ─────────────────────────────────────────────────────────────────

/** Pack uniform samples into flat arrays for Convex storage */
export function pack(samples: UniformSample[]): PackedChunkData {
  if (samples.length === 0) {
    return {
      startTime: 0,
      endTime: 0,
      sampleRate: 100,
      sampleCount: 0,
      activeJoints: [],
      leftKneeQ: [],
      rightKneeQ: [],
      leftKneeInterpolated: [],
      leftKneeMissing: [],
      rightKneeInterpolated: [],
      rightKneeMissing: [],
    };
  }

  const leftKneeQ: number[] = [];
  const rightKneeQ: number[] = [];
  const leftKneeInterpolated: number[] = [];
  const leftKneeMissing: number[] = [];
  const rightKneeInterpolated: number[] = [];
  const rightKneeMissing: number[] = [];

  let leftActive = false;
  let rightActive = false;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];

    // Left knee
    if (s.lq) {
      leftActive = true;
      leftKneeQ.push(s.lq.w, s.lq.x, s.lq.y, s.lq.z);
      if (s.leftFlag === SampleFlag.INTERPOLATED) {
        leftKneeInterpolated.push(i);
      } else if (s.leftFlag === SampleFlag.MISSING) {
        leftKneeMissing.push(i);
      }
    } else {
      // Inactive joint - store identity
      leftKneeQ.push(IDENTITY_QUAT.w, IDENTITY_QUAT.x, IDENTITY_QUAT.y, IDENTITY_QUAT.z);
    }

    // Right knee
    if (s.rq) {
      rightActive = true;
      rightKneeQ.push(s.rq.w, s.rq.x, s.rq.y, s.rq.z);
      if (s.rightFlag === SampleFlag.INTERPOLATED) {
        rightKneeInterpolated.push(i);
      } else if (s.rightFlag === SampleFlag.MISSING) {
        rightKneeMissing.push(i);
      }
    } else {
      rightKneeQ.push(IDENTITY_QUAT.w, IDENTITY_QUAT.x, IDENTITY_QUAT.y, IDENTITY_QUAT.z);
    }
  }

  const activeJoints: string[] = [];
  if (leftActive) activeJoints.push(JOINTS.LEFT_KNEE);
  if (rightActive) activeJoints.push(JOINTS.RIGHT_KNEE);

  const startTime = samples[0].t;
  const endTime = samples[samples.length - 1].t;
  const durationMs = endTime - startTime;
  const sampleRate = durationMs > 0 ? Math.round((samples.length - 1) / (durationMs / 1000)) : 100;

  return {
    startTime,
    endTime,
    sampleRate,
    sampleCount: samples.length,
    activeJoints,
    leftKneeQ: leftActive ? leftKneeQ : [],
    rightKneeQ: rightActive ? rightKneeQ : [],
    leftKneeInterpolated: leftActive ? leftKneeInterpolated : [],
    leftKneeMissing: leftActive ? leftKneeMissing : [],
    rightKneeInterpolated: rightActive ? rightKneeInterpolated : [],
    rightKneeMissing: rightActive ? rightKneeMissing : [],
  };
}

// ─────────────────────────────────────────────────────────────────
// Unpacking (from Convex load)
// ─────────────────────────────────────────────────────────────────

/** Unpack flat arrays to uniform samples */
export function unpack(packed: PackedChunkData): UniformSample[] {
  const { sampleCount, startTime, sampleRate, activeJoints } = packed;
  if (sampleCount === 0) return [];

  const intervalMs = 1000 / sampleRate;
  const leftActive = activeJoints.includes(JOINTS.LEFT_KNEE);
  const rightActive = activeJoints.includes(JOINTS.RIGHT_KNEE);

  // Build flag lookup sets for O(1) access
  const leftInterpolatedSet = new Set(packed.leftKneeInterpolated);
  const leftMissingSet = new Set(packed.leftKneeMissing);
  const rightInterpolatedSet = new Set(packed.rightKneeInterpolated);
  const rightMissingSet = new Set(packed.rightKneeMissing);

  const samples: UniformSample[] = [];

  for (let i = 0; i < sampleCount; i++) {
    const t = startTime + i * intervalMs;
    const qIdx = i * 4;

    // Left quaternion
    let lq: Quaternion | null = null;
    let leftFlag = SampleFlag.REAL;
    if (leftActive && packed.leftKneeQ.length >= qIdx + 4) {
      lq = {
        w: packed.leftKneeQ[qIdx],
        x: packed.leftKneeQ[qIdx + 1],
        y: packed.leftKneeQ[qIdx + 2],
        z: packed.leftKneeQ[qIdx + 3],
      };
      if (leftInterpolatedSet.has(i)) leftFlag = SampleFlag.INTERPOLATED;
      else if (leftMissingSet.has(i)) leftFlag = SampleFlag.MISSING;
    }

    // Right quaternion
    let rq: Quaternion | null = null;
    let rightFlag = SampleFlag.REAL;
    if (rightActive && packed.rightKneeQ.length >= qIdx + 4) {
      rq = {
        w: packed.rightKneeQ[qIdx],
        x: packed.rightKneeQ[qIdx + 1],
        y: packed.rightKneeQ[qIdx + 2],
        z: packed.rightKneeQ[qIdx + 3],
      };
      if (rightInterpolatedSet.has(i)) rightFlag = SampleFlag.INTERPOLATED;
      else if (rightMissingSet.has(i)) rightFlag = SampleFlag.MISSING;
    }

    samples.push({ t, lq, rq, leftFlag, rightFlag });
  }

  return samples;
}

// ─────────────────────────────────────────────────────────────────
// Conversion to Angles
// ─────────────────────────────────────────────────────────────────

/**
 * Convert uniform samples to angle samples for display.
 * @param samples - Array of uniform samples with quaternion data
 * @param axis - Euler axis to extract ('x', 'y', or 'z'), defaults to 'y'
 * @returns Array of angle samples with left/right angles in degrees
 */
export function toAngles(samples: UniformSample[], axis: EulerAxis = 'y'): AngleSample[] {
  if (samples.length === 0) return [];

  const startTime = samples[0].t;

  return samples.map((s) => ({
    t: s.t,
    relative_s: Math.round((s.t - startTime) / 10) / 100,
    left: s.lq ? Math.round(quaternionToAngle(s.lq, axis) * 10) / 10 : 0,
    right: s.rq ? Math.round(quaternionToAngle(s.rq, axis) * 10) / 10 : 0,
    leftFlag: s.leftFlag,
    rightFlag: s.rightFlag,
  }));
}

/**
 * Convenience: unpack and convert to angles in one step.
 * @param packed - Packed chunk data from Convex
 * @param axis - Euler axis to extract ('x', 'y', or 'z'), defaults to 'y'
 * @returns Array of angle samples
 */
export function unpackToAngles(packed: PackedChunkData, axis: EulerAxis = 'y'): AngleSample[] {
  return toAngles(unpack(packed), axis);
}

// ─────────────────────────────────────────────────────────────────
// Multi-Chunk Reassembly
// ─────────────────────────────────────────────────────────────────

/** Merge multiple packed chunks into a single unified data set */
export function mergeChunks(chunks: PackedChunkData[]): PackedChunkData {
  if (chunks.length === 0) {
    return pack([]);
  }

  if (chunks.length === 1) {
    return chunks[0];
  }

  // Sort by startTime
  const sorted = [...chunks].sort((a, b) => a.startTime - b.startTime);

  const merged: PackedChunkData = {
    startTime: sorted[0].startTime,
    endTime: sorted[sorted.length - 1].endTime,
    sampleRate: sorted[0].sampleRate,
    sampleCount: 0,
    activeJoints: sorted[0].activeJoints,
    leftKneeQ: [],
    rightKneeQ: [],
    leftKneeInterpolated: [],
    leftKneeMissing: [],
    rightKneeInterpolated: [],
    rightKneeMissing: [],
  };

  let totalSamples = 0;

  for (const chunk of sorted) {
    // Offset flag indices by current sample count
    const offset = totalSamples;

    merged.leftKneeQ.push(...chunk.leftKneeQ);
    merged.rightKneeQ.push(...chunk.rightKneeQ);
    merged.leftKneeInterpolated.push(...chunk.leftKneeInterpolated.map((i) => i + offset));
    merged.leftKneeMissing.push(...chunk.leftKneeMissing.map((i) => i + offset));
    merged.rightKneeInterpolated.push(...chunk.rightKneeInterpolated.map((i) => i + offset));
    merged.rightKneeMissing.push(...chunk.rightKneeMissing.map((i) => i + offset));

    totalSamples += chunk.sampleCount;
  }

  merged.sampleCount = totalSamples;

  return merged;
}
