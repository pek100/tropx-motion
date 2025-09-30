import { Quaternion } from './types';
import {ANGLE} from './constants';

/**
 * Centralized service for all quaternion mathematical operations.
 * Consolidates quaternion utilities from utils, AngleCalculationService, and InterpolationService.
 */
export class QuaternionService {

    /**
     * Creates identity quaternion (no rotation) for safe fallback scenarios.
     */
    static createIdentity(): Quaternion {
        return { w: 1, x: 0, y: 0, z: 0 };
    }

    /**
     * Validates quaternion has all required numeric components.
     */
    static isValid(q: any): q is Quaternion {
        return q &&
            typeof q.w === 'number' && isFinite(q.w) &&
            typeof q.x === 'number' && isFinite(q.x) &&
            typeof q.y === 'number' && isFinite(q.y) &&
            typeof q.z === 'number' && isFinite(q.z);
    }

    /**
     * Calculates quaternion magnitude (length).
     */
    static magnitude(q: Quaternion): number {
        return Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z);
    }

    /**
     * Normalizes quaternion to unit length with fallback to identity on invalid input.
     */
    static normalize(q: Quaternion): Quaternion {
        if (!QuaternionService.isValid(q)) {
            return QuaternionService.createIdentity();
        }

        const norm = QuaternionService.magnitude(q);
        if (norm < ANGLE.EPSILON || !isFinite(norm)) {
            return QuaternionService.createIdentity();
        }

        const invNorm = 1.0 / norm;
        return {
            w: q.w * invNorm,
            x: q.x * invNorm,
            y: q.y * invNorm,
            z: q.z * invNorm
        };
    }

    /**
     * Computes quaternion inverse (conjugate for unit quaternions).
     */
    static inverse(q: Quaternion): Quaternion {
        const normalized = QuaternionService.normalize(q);
        return {
            w: normalized.w,
            x: -normalized.x,
            y: -normalized.y,
            z: -normalized.z
        };
    }

    /**
     * Calculates dot product between two quaternions.
     */
    static dot(q1: Quaternion, q2: Quaternion): number {
        return q1.w * q2.w + q1.x * q2.x + q1.y * q2.y + q1.z * q2.z;
    }

    /**
     * Efficiently writes normalized quaternion to Float32Array buffer.
     */
    static writeToBuffer(q: Quaternion, buffer: Float32Array, offset = 0): void {
        const normalized = QuaternionService.normalize(q);
        buffer[offset] = normalized.w;
        buffer[offset + 1] = normalized.x;
        buffer[offset + 2] = normalized.y;
        buffer[offset + 3] = normalized.z;
    }

    /**
     * Reads quaternion from Float32Array buffer.
     */
    static readFromBuffer(buffer: Float32Array, offset = 0): Quaternion {
        return {
            w: buffer[offset],
            x: buffer[offset + 1],
            y: buffer[offset + 2],
            z: buffer[offset + 3]
        };
    }

    static getInverseQuaternion(q: Float32Array, output: Float32Array): void {
        output[0] = q[0];
        output[1] = -q[1];
        output[2] = -q[2];
        output[3] = -q[3];
    }

    static negateQuaternion(q: Quaternion): Quaternion {
        return {
            w: -q.w,
            x: -q.x,
            y: -q.y,
            z: -q.z
        };
    }

    /**
     * Multiplies two quaternions using standard quaternion multiplication formula.
     * Result is stored in the output parameter for performance.
     */
    static multiplyQuaternions(q1: Float32Array, q2: Float32Array, output: Float32Array): void {
        const w1 = q1[0], x1 = q1[1], y1 = q1[2], z1 = q1[3];
        const w2 = q2[0], x2 = q2[1], y2 = q2[2], z2 = q2[3];

        output[0] = w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2;
        output[1] = w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2;
        output[2] = w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2;
        output[3] = w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2;
    }

    /**
     * Converts quaternion to 3x3 rotation matrix for angle extraction.
     * Uses standard quaternion-to-matrix conversion formulas.
     * Matrix is stored in row-major order in the output Float32Array.
     */
    static quaternionToMatrix(q: Float32Array, matrix: Float32Array): void {
        const w = q[0], x = q[1], y = q[2], z = q[3];
        const x2 = x + x, y2 = y + y, z2 = z + z;
        const xx = x * x2, xy = x * y2, xz = x * z2;
        const yy = y * y2, yz = y * z2, zz = z * z2;
        const wx = w * x2, wy = w * y2, wz = w * z2;

        matrix[0] = 1 - (yy + zz); matrix[1] = xy - wz; matrix[2] = xz + wy;
        matrix[3] = xy + wz; matrix[4] = 1 - (xx + zz); matrix[5] = yz - wx;
        matrix[6] = xz - wy; matrix[7] = yz + wx; matrix[8] = 1 - (xx + yy);
    }
}

/**
 * lerp helper function
 */
export const lerp = (a: number, b: number, t: number): number => (1 - t) * a + t * b;