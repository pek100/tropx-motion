/**
 * Quaternion Math Verification Tests
 *
 * Verifies the relative quaternion computation is mathematically correct.
 *
 * Run with: npx tsx motionProcessing/recording/AlignmentService.quaternion.test.ts
 */

import { AlignmentService } from './AlignmentService';
import { RawDeviceSample } from './types';
import { Quaternion } from '../shared/types';
import { QuaternionService } from '../shared/QuaternionService';

// Device IDs (from ble-management/types.ts)
const LEFT_SHIN = 0x11;
const LEFT_THIGH = 0x12;

// ─────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────

function createRotationQuat(angleDeg: number, axis: 'x' | 'y' | 'z' = 'x'): Quaternion {
    const halfAngle = (angleDeg * Math.PI / 180) / 2;
    const sin = Math.sin(halfAngle);
    const cos = Math.cos(halfAngle);

    switch (axis) {
        case 'x': return { w: cos, x: sin, y: 0, z: 0 };
        case 'y': return { w: cos, x: 0, y: sin, z: 0 };
        case 'z': return { w: cos, x: 0, y: 0, z: sin };
    }
}

function quatApproxEqual(q1: Quaternion, q2: Quaternion, epsilon = 0.001): boolean {
    // Quaternions q and -q represent the same rotation
    const directMatch =
        Math.abs(q1.w - q2.w) < epsilon &&
        Math.abs(q1.x - q2.x) < epsilon &&
        Math.abs(q1.y - q2.y) < epsilon &&
        Math.abs(q1.z - q2.z) < epsilon;

    const negatedMatch =
        Math.abs(q1.w + q2.w) < epsilon &&
        Math.abs(q1.x + q2.x) < epsilon &&
        Math.abs(q1.y + q2.y) < epsilon &&
        Math.abs(q1.z + q2.z) < epsilon;

    return directMatch || negatedMatch;
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

function testIdentityRelative(): boolean {
    console.log('Test: Identity relative (thigh and shin same orientation)...');

    // Both sensors at same orientation - relative should be identity
    const rawSamples: RawDeviceSample[] = [
        { deviceId: LEFT_THIGH, timestamp: 0, quaternion: createRotationQuat(45, 'x') },
        { deviceId: LEFT_SHIN, timestamp: 0, quaternion: createRotationQuat(45, 'x') },
    ];

    const result = AlignmentService.process(rawSamples, 100);

    if (result.length === 0 || result[0].lq === null) {
        console.error('FAIL: No output');
        return false;
    }

    const identity: Quaternion = { w: 1, x: 0, y: 0, z: 0 };
    if (!quatApproxEqual(result[0].lq, identity, 0.01)) {
        console.error(`FAIL: Expected identity, got w=${result[0].lq.w}, x=${result[0].lq.x}, y=${result[0].lq.y}, z=${result[0].lq.z}`);
        return false;
    }

    console.log('  PASS');
    return true;
}

function testKnownAngleDifference(): boolean {
    console.log('Test: Known angle difference (shin 45deg more than thigh)...');

    // Thigh at 0deg, shin at 45deg around X axis
    // Relative should be 45deg around X
    const rawSamples: RawDeviceSample[] = [
        { deviceId: LEFT_THIGH, timestamp: 0, quaternion: { w: 1, x: 0, y: 0, z: 0 } }, // identity
        { deviceId: LEFT_SHIN, timestamp: 0, quaternion: createRotationQuat(45, 'x') },
    ];

    const result = AlignmentService.process(rawSamples, 100);

    if (result.length === 0 || result[0].lq === null) {
        console.error('FAIL: No output');
        return false;
    }

    const expected = createRotationQuat(45, 'x');
    if (!quatApproxEqual(result[0].lq, expected, 0.01)) {
        console.error(`FAIL: Expected 45deg rotation, got w=${result[0].lq.w}, x=${result[0].lq.x}`);
        return false;
    }

    console.log('  PASS');
    return true;
}

function testNegativeAngleDifference(): boolean {
    console.log('Test: Negative angle difference (shin behind thigh)...');

    // Thigh at 45deg, shin at 0deg
    // Relative should be -45deg (shin is behind thigh)
    const rawSamples: RawDeviceSample[] = [
        { deviceId: LEFT_THIGH, timestamp: 0, quaternion: createRotationQuat(45, 'x') },
        { deviceId: LEFT_SHIN, timestamp: 0, quaternion: { w: 1, x: 0, y: 0, z: 0 } },
    ];

    const result = AlignmentService.process(rawSamples, 100);

    if (result.length === 0 || result[0].lq === null) {
        console.error('FAIL: No output');
        return false;
    }

    const expected = createRotationQuat(-45, 'x');
    if (!quatApproxEqual(result[0].lq, expected, 0.01)) {
        console.error(`FAIL: Expected -45deg rotation, got w=${result[0].lq.w}, x=${result[0].lq.x}`);
        return false;
    }

    console.log('  PASS');
    return true;
}

function testAngleExtractionY(): boolean {
    console.log('Test: Angle extraction from Y-axis rotation...');

    // Create a 60 degree Y-axis rotation
    const rawSamples: RawDeviceSample[] = [
        { deviceId: LEFT_THIGH, timestamp: 0, quaternion: { w: 1, x: 0, y: 0, z: 0 } },
        { deviceId: LEFT_SHIN, timestamp: 0, quaternion: createRotationQuat(60, 'y') },
    ];

    const result = AlignmentService.process(rawSamples, 100);

    if (result.length === 0 || result[0].lq === null) {
        console.error('FAIL: No output');
        return false;
    }

    // Extract Y-axis angle using QuaternionService
    const extractedAngle = QuaternionService.toEulerAngle(result[0].lq, 'y');

    if (Math.abs(extractedAngle - 60) > 1) {
        console.error(`FAIL: Expected 60 deg Y-rotation, extracted ${extractedAngle} deg`);
        return false;
    }

    console.log(`  PASS (extracted angle: ${extractedAngle.toFixed(1)} deg)`);
    return true;
}

function testCompoundRotation(): boolean {
    console.log('Test: Compound rotation (thigh at 30deg, shin at 75deg)...');

    // Thigh at 30deg, shin at 75deg around X axis
    // Relative should be 45deg around X (75 - 30 = 45)
    const rawSamples: RawDeviceSample[] = [
        { deviceId: LEFT_THIGH, timestamp: 0, quaternion: createRotationQuat(30, 'x') },
        { deviceId: LEFT_SHIN, timestamp: 0, quaternion: createRotationQuat(75, 'x') },
    ];

    const result = AlignmentService.process(rawSamples, 100);

    if (result.length === 0 || result[0].lq === null) {
        console.error('FAIL: No output');
        return false;
    }

    const expected = createRotationQuat(45, 'x');
    if (!quatApproxEqual(result[0].lq, expected, 0.02)) {
        console.error(`FAIL: Expected 45deg rotation, got w=${result[0].lq.w.toFixed(4)}, x=${result[0].lq.x.toFixed(4)}`);
        console.error(`       Expected w=${expected.w.toFixed(4)}, x=${expected.x.toFixed(4)}`);
        return false;
    }

    console.log('  PASS');
    return true;
}

function testSlerpInterpolation(): boolean {
    console.log('Test: SLERP interpolation between quaternions...');

    // Start at 0deg, end at 90deg, verify middle is ~45deg
    const rawSamples: RawDeviceSample[] = [
        { deviceId: LEFT_THIGH, timestamp: 0, quaternion: { w: 1, x: 0, y: 0, z: 0 } },
        { deviceId: LEFT_SHIN, timestamp: 0, quaternion: createRotationQuat(0, 'y') },
        { deviceId: LEFT_THIGH, timestamp: 100, quaternion: { w: 1, x: 0, y: 0, z: 0 } },
        { deviceId: LEFT_SHIN, timestamp: 100, quaternion: createRotationQuat(90, 'y') },
    ];

    const result = AlignmentService.process(rawSamples, 100);

    // Find sample at t=50 (middle)
    const middleSample = result.find(s => s.t === 50);
    if (!middleSample || !middleSample.lq) {
        console.error('FAIL: No middle sample');
        return false;
    }

    const middleAngle = QuaternionService.toEulerAngle(middleSample.lq, 'y');
    if (Math.abs(middleAngle - 45) > 2) {
        console.error(`FAIL: Expected ~45deg at t=50, got ${middleAngle.toFixed(1)}deg`);
        return false;
    }

    console.log(`  PASS (middle angle: ${middleAngle.toFixed(1)} deg)`);
    return true;
}

function testQuaternionNormalization(): boolean {
    console.log('Test: Non-normalized quaternion input...');

    // Input with non-normalized quaternion (should be handled)
    const nonNormalized: Quaternion = { w: 2, x: 0, y: 0, z: 0 }; // magnitude = 2
    const rawSamples: RawDeviceSample[] = [
        { deviceId: LEFT_THIGH, timestamp: 0, quaternion: nonNormalized },
        { deviceId: LEFT_SHIN, timestamp: 0, quaternion: createRotationQuat(45, 'x') },
    ];

    const result = AlignmentService.process(rawSamples, 100);

    if (result.length === 0 || result[0].lq === null) {
        console.error('FAIL: No output');
        return false;
    }

    // Should still produce valid result (QuaternionService.inverse normalizes)
    const expected = createRotationQuat(45, 'x');
    if (!quatApproxEqual(result[0].lq, expected, 0.02)) {
        console.error(`FAIL: Expected ~45deg rotation even with non-normalized input`);
        return false;
    }

    console.log('  PASS');
    return true;
}

// ─────────────────────────────────────────────────────────────────
// Run Tests
// ─────────────────────────────────────────────────────────────────

function runTests(): void {
    console.log('========================================');
    console.log('Quaternion Math Verification Tests');
    console.log('========================================\n');

    const tests = [
        testIdentityRelative,
        testKnownAngleDifference,
        testNegativeAngleDifference,
        testAngleExtractionY,
        testCompoundRotation,
        testSlerpInterpolation,
        testQuaternionNormalization,
    ];

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
        try {
            if (test()) {
                passed++;
            } else {
                failed++;
            }
        } catch (err) {
            console.error(`  FAIL (exception): ${err}`);
            failed++;
        }
    }

    console.log('\n========================================');
    console.log(`Results: ${passed}/${tests.length} passed`);
    if (failed > 0) {
        console.log(`FAILED: ${failed} test(s)`);
        process.exit(1);
    } else {
        console.log('All quaternion math tests passed!');
    }
}

runTests();
