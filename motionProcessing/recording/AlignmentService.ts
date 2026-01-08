/**
 * AlignmentService - Post-processes raw per-device samples into aligned QuaternionSample[].
 *
 * Uses the SAME components as live path (SensorBuffer + JointAligner)
 * but with unlimited buffer size for entire recordings.
 *
 * Pipeline:
 * 1. Load raw samples into SensorBuffers (batch mode - no size limit)
 * 2. Use JointAligner to align thigh↔shin within each joint
 * 3. Compute relative quaternions using same method as AngleCalculationService
 * 4. Align left↔right joints and interpolate to uniform grid
 */

import { Quaternion } from '../shared/types';
import { QuaternionService } from '../shared/QuaternionService';
import { RawDeviceSample, AlignedJointSample, QuaternionSample } from './types';
import { SensorBuffer } from '../synchronization/SensorBuffer';

// Device IDs (from ble-management/types.ts DeviceID enum)
// Upper nibble: joint (1=left, 2=right), Lower nibble: position (1=shin, 2=thigh)
const DEVICE_ID = {
    LEFT_SHIN: 0x11,
    LEFT_THIGH: 0x12,
    RIGHT_SHIN: 0x21,
    RIGHT_THIGH: 0x22,
} as const;

export class AlignmentService {

    // Reusable buffers for quaternion math (same as AngleCalculationService)
    private static readonly workingQuat1 = new Float32Array(4);
    private static readonly workingQuat2 = new Float32Array(4);
    private static readonly workingQuatRel = new Float32Array(4);

    /**
     * Main entry point - processes raw samples into aligned QuaternionSample[].
     * Called by both CSVExporter and UploadService.
     */
    static process(raw: RawDeviceSample[], targetHz: number): QuaternionSample[] {
        if (raw.length === 0) return [];

        // Step 1: Load samples into SensorBuffers (batch mode - Infinity size limit)
        const leftThighBuffer = new SensorBuffer(DEVICE_ID.LEFT_THIGH, Infinity);
        const leftShinBuffer = new SensorBuffer(DEVICE_ID.LEFT_SHIN, Infinity);
        const rightThighBuffer = new SensorBuffer(DEVICE_ID.RIGHT_THIGH, Infinity);
        const rightShinBuffer = new SensorBuffer(DEVICE_ID.RIGHT_SHIN, Infinity);

        for (const sample of raw) {
            switch (sample.deviceId) {
                case DEVICE_ID.LEFT_THIGH:
                    leftThighBuffer.addSample(sample.timestamp, sample.quaternion);
                    break;
                case DEVICE_ID.LEFT_SHIN:
                    leftShinBuffer.addSample(sample.timestamp, sample.quaternion);
                    break;
                case DEVICE_ID.RIGHT_THIGH:
                    rightThighBuffer.addSample(sample.timestamp, sample.quaternion);
                    break;
                case DEVICE_ID.RIGHT_SHIN:
                    rightShinBuffer.addSample(sample.timestamp, sample.quaternion);
                    break;
            }
        }

        // Step 2: Align sensors within each joint (batch mode - find closest matches)
        const leftAligned = this.alignJointSensors(leftThighBuffer, leftShinBuffer);
        const rightAligned = this.alignJointSensors(rightThighBuffer, rightShinBuffer);

        // Step 3: Align left and right joints
        const combined = this.alignJoints(leftAligned, rightAligned);

        // Step 4: Interpolate to uniform grid
        return this.interpolateToGrid(combined, targetHz);
    }

    /**
     * Aligns thigh and shin sensors within a joint using batch-mode alignment.
     * For each thigh sample, finds the closest shin sample and computes relative quaternion.
     * Uses SensorBuffer's findClosestIndex() - same algorithm as live JointAligner.
     */
    private static alignJointSensors(
        thighBuffer: SensorBuffer,
        shinBuffer: SensorBuffer
    ): AlignedJointSample[] {
        if (thighBuffer.isEmpty() || shinBuffer.isEmpty()) {
            return [];
        }

        const result: AlignedJointSample[] = [];

        // For each thigh sample, find closest shin and compute relative quaternion
        for (let i = 0; i < thighBuffer.getSize(); i++) {
            const thighSample = thighBuffer.getSampleAtIndex(i);
            if (!thighSample) continue;

            const closestShinIdx = shinBuffer.findClosestIndex(thighSample.timestamp);
            if (closestShinIdx < 0) continue;

            const shinSample = shinBuffer.getSampleAtIndex(closestShinIdx);
            if (!shinSample) continue;

            // Compute relative quaternion: thigh⁻¹ × shin
            // EXACT same implementation as AngleCalculationService.computeRelativeQuat()
            const relativeQuat = this.computeRelativeQuat(
                thighSample.quaternion,
                shinSample.quaternion
            );

            result.push({
                timestamp: thighSample.timestamp,
                relativeQuaternion: relativeQuat
            });
        }

        return result;
    }

    /**
     * Computes relative quaternion: thigh⁻¹ × shin
     * EXACT same implementation as AngleCalculationService.computeRelativeQuat()
     */
    private static computeRelativeQuat(thighQuat: Quaternion, shinQuat: Quaternion): Quaternion {
        QuaternionService.writeToBuffer(thighQuat, this.workingQuat1);
        QuaternionService.writeToBuffer(shinQuat, this.workingQuat2);
        QuaternionService.getInverseQuaternion(this.workingQuat1, this.workingQuat1);
        QuaternionService.multiplyQuaternions(this.workingQuat1, this.workingQuat2, this.workingQuatRel);

        return QuaternionService.readFromBuffer(this.workingQuatRel);
    }

    /**
     * Aligns left and right joints by closest timestamp.
     * Handles single-joint mode (only left OR only right sensors connected).
     */
    private static alignJoints(
        left: AlignedJointSample[],
        right: AlignedJointSample[]
    ): QuaternionSample[] {
        // Handle edge cases
        if (left.length === 0 && right.length === 0) return [];

        // Single-joint mode: only right knee
        if (left.length === 0) {
            return right.map(s => ({
                t: s.timestamp,
                lq: null,
                rq: s.relativeQuaternion
            }));
        }

        // Single-joint mode: only left knee
        if (right.length === 0) {
            return left.map(s => ({
                t: s.timestamp,
                lq: s.relativeQuaternion,
                rq: null
            }));
        }

        // Both joints - align by closest timestamp
        const result: QuaternionSample[] = [];
        let rightIdx = 0;

        for (const leftSample of left) {
            // Find closest right sample (advancing pointer for efficiency)
            while (
                rightIdx < right.length - 1 &&
                Math.abs(right[rightIdx + 1].timestamp - leftSample.timestamp) <
                Math.abs(right[rightIdx].timestamp - leftSample.timestamp)
            ) {
                rightIdx++;
            }

            result.push({
                t: leftSample.timestamp,
                lq: leftSample.relativeQuaternion,
                rq: right[rightIdx].relativeQuaternion
            });
        }

        return result;
    }

    /**
     * Interpolates samples to a uniform grid using SLERP.
     * Uses index-based loop to avoid floating-point accumulation.
     */
    private static interpolateToGrid(
        samples: QuaternionSample[],
        targetHz: number
    ): QuaternionSample[] {
        if (samples.length === 0) return [];
        if (samples.length === 1) return [{ ...samples[0] }];

        const intervalMs = 1000 / targetHz;
        const startTime = samples[0].t;
        const endTime = samples[samples.length - 1].t;

        // Index-based loop (no floating-point accumulation)
        const sampleCount = Math.ceil((endTime - startTime) / intervalMs) + 1;
        const result: QuaternionSample[] = [];

        let sampleIdx = 0;

        for (let i = 0; i < sampleCount; i++) {
            const t = startTime + i * intervalMs;
            if (t > endTime) break;  // Use > not >= to avoid extra sample

            // Find bracketing samples
            while (sampleIdx < samples.length - 1 && samples[sampleIdx + 1].t <= t) {
                sampleIdx++;
            }

            const curr = samples[sampleIdx];
            const next = samples[sampleIdx + 1] || curr;

            // No interpolation needed if same sample or same timestamp
            if (curr === next || curr.t === next.t) {
                result.push({ t, lq: curr.lq, rq: curr.rq });
            } else {
                // SLERP between curr and next
                const alpha = (t - curr.t) / (next.t - curr.t);
                result.push({
                    t,
                    lq: this.slerpNullable(curr.lq, next.lq, alpha),
                    rq: this.slerpNullable(curr.rq, next.rq, alpha)
                });
            }
        }

        return result;
    }

    /**
     * SLERP that handles null quaternions.
     * Returns the non-null quaternion if one is null, or null if both are null.
     */
    private static slerpNullable(
        q1: Quaternion | null,
        q2: Quaternion | null,
        t: number
    ): Quaternion | null {
        if (q1 === null && q2 === null) return null;
        if (q1 === null) return q2;
        if (q2 === null) return q1;
        return QuaternionService.slerp(q1, q2, t);
    }
}
