/**
 * AlignmentService Tests
 *
 * Run with: npx tsx motionProcessing/recording/AlignmentService.test.ts
 */

import { AlignmentService } from './AlignmentService';
import { RawDeviceSample, QuaternionSample } from './types';
import { Quaternion } from '../shared/types';

// Device IDs (from ble-management/types.ts)
const LEFT_SHIN = 0x11;
const LEFT_THIGH = 0x12;
const RIGHT_SHIN = 0x21;
const RIGHT_THIGH = 0x22;

// ─────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────

function createIdentityQuat(): Quaternion {
    return { w: 1, x: 0, y: 0, z: 0 };
}

function createRotationQuat(angleDeg: number): Quaternion {
    const halfAngle = (angleDeg * Math.PI / 180) / 2;
    return {
        w: Math.cos(halfAngle),
        x: Math.sin(halfAngle),
        y: 0,
        z: 0
    };
}

function createRawSample(deviceId: number, timestamp: number, quat: Quaternion): RawDeviceSample {
    return { deviceId, timestamp, quaternion: quat };
}

function quatEqual(q1: Quaternion, q2: Quaternion, epsilon = 0.001): boolean {
    return Math.abs(q1.w - q2.w) < epsilon &&
           Math.abs(q1.x - q2.x) < epsilon &&
           Math.abs(q1.y - q2.y) < epsilon &&
           Math.abs(q1.z - q2.z) < epsilon;
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

function testEmptyInput(): boolean {
    console.log('Test: Empty input...');
    const result = AlignmentService.process([], 100);

    if (result.length !== 0) {
        console.error('FAIL: Empty input should produce empty output');
        return false;
    }

    console.log('  PASS');
    return true;
}

function testSingleJointLeft(): boolean {
    console.log('Test: Single joint (left only)...');

    const rawSamples: RawDeviceSample[] = [
        createRawSample(LEFT_THIGH, 0, createIdentityQuat()),
        createRawSample(LEFT_SHIN, 0, createRotationQuat(45)),
        createRawSample(LEFT_THIGH, 10, createIdentityQuat()),
        createRawSample(LEFT_SHIN, 10, createRotationQuat(45)),
    ];

    const result = AlignmentService.process(rawSamples, 100);

    if (result.length === 0) {
        console.error('FAIL: Should produce output for single joint');
        return false;
    }

    // Check that right knee is null
    if (result[0].rq !== null) {
        console.error('FAIL: Right knee should be null for left-only input');
        return false;
    }

    // Check that left knee has data
    if (result[0].lq === null) {
        console.error('FAIL: Left knee should have data');
        return false;
    }

    console.log(`  PASS (${result.length} samples)`);
    return true;
}

function testSingleJointRight(): boolean {
    console.log('Test: Single joint (right only)...');

    const rawSamples: RawDeviceSample[] = [
        createRawSample(RIGHT_THIGH, 0, createIdentityQuat()),
        createRawSample(RIGHT_SHIN, 0, createRotationQuat(30)),
        createRawSample(RIGHT_THIGH, 10, createIdentityQuat()),
        createRawSample(RIGHT_SHIN, 10, createRotationQuat(30)),
    ];

    const result = AlignmentService.process(rawSamples, 100);

    if (result.length === 0) {
        console.error('FAIL: Should produce output for single joint');
        return false;
    }

    // Check that left knee is null
    if (result[0].lq !== null) {
        console.error('FAIL: Left knee should be null for right-only input');
        return false;
    }

    // Check that right knee has data
    if (result[0].rq === null) {
        console.error('FAIL: Right knee should have data');
        return false;
    }

    console.log(`  PASS (${result.length} samples)`);
    return true;
}

function testBothJoints(): boolean {
    console.log('Test: Both joints...');

    const rawSamples: RawDeviceSample[] = [
        // Left joint
        createRawSample(LEFT_THIGH, 0, createIdentityQuat()),
        createRawSample(LEFT_SHIN, 0, createRotationQuat(45)),
        createRawSample(LEFT_THIGH, 10, createIdentityQuat()),
        createRawSample(LEFT_SHIN, 10, createRotationQuat(45)),
        // Right joint
        createRawSample(RIGHT_THIGH, 0, createIdentityQuat()),
        createRawSample(RIGHT_SHIN, 0, createRotationQuat(30)),
        createRawSample(RIGHT_THIGH, 10, createIdentityQuat()),
        createRawSample(RIGHT_SHIN, 10, createRotationQuat(30)),
    ];

    const result = AlignmentService.process(rawSamples, 100);

    if (result.length === 0) {
        console.error('FAIL: Should produce output for both joints');
        return false;
    }

    // Check that both knees have data
    if (result[0].lq === null || result[0].rq === null) {
        console.error('FAIL: Both knees should have data');
        return false;
    }

    console.log(`  PASS (${result.length} samples)`);
    return true;
}

function testMissingSensor(): boolean {
    console.log('Test: Missing sensor (thigh only, no shin)...');

    const rawSamples: RawDeviceSample[] = [
        createRawSample(LEFT_THIGH, 0, createIdentityQuat()),
        createRawSample(LEFT_THIGH, 10, createIdentityQuat()),
        // No shin samples - can't compute relative quaternion
    ];

    const result = AlignmentService.process(rawSamples, 100);

    // Should return empty because we can't compute relative quaternion without both sensors
    if (result.length !== 0) {
        console.error('FAIL: Should produce empty output when missing shin sensor');
        return false;
    }

    console.log('  PASS');
    return true;
}

function testOutOfOrderSamples(): boolean {
    console.log('Test: Out-of-order samples...');

    // Samples arrive out of order (simulating BLE batching)
    const rawSamples: RawDeviceSample[] = [
        createRawSample(LEFT_SHIN, 10, createRotationQuat(45)),
        createRawSample(LEFT_THIGH, 0, createIdentityQuat()),
        createRawSample(LEFT_THIGH, 10, createIdentityQuat()),
        createRawSample(LEFT_SHIN, 0, createRotationQuat(45)),
    ];

    const result = AlignmentService.process(rawSamples, 100);

    if (result.length === 0) {
        console.error('FAIL: Should handle out-of-order samples');
        return false;
    }

    // Check timestamps are in order
    for (let i = 1; i < result.length; i++) {
        if (result[i].t < result[i - 1].t) {
            console.error('FAIL: Output timestamps should be in order');
            return false;
        }
    }

    console.log(`  PASS (${result.length} samples)`);
    return true;
}

function testInterpolationGrid(): boolean {
    console.log('Test: Interpolation to uniform grid...');

    // Create samples at non-uniform intervals
    const rawSamples: RawDeviceSample[] = [
        createRawSample(LEFT_THIGH, 0, createIdentityQuat()),
        createRawSample(LEFT_SHIN, 0, createRotationQuat(0)),
        createRawSample(LEFT_THIGH, 15, createIdentityQuat()),  // 15ms, not 10ms
        createRawSample(LEFT_SHIN, 15, createRotationQuat(45)),
        createRawSample(LEFT_THIGH, 35, createIdentityQuat()),  // 35ms, not 30ms
        createRawSample(LEFT_SHIN, 35, createRotationQuat(90)),
    ];

    const result = AlignmentService.process(rawSamples, 100); // 100Hz = 10ms intervals

    if (result.length < 2) {
        console.error('FAIL: Should produce interpolated samples');
        return false;
    }

    // Check that timestamps are at 10ms intervals
    const interval = 10; // 1000ms / 100Hz
    for (let i = 1; i < result.length; i++) {
        const expectedT = result[0].t + i * interval;
        const actualT = result[i].t;
        if (Math.abs(actualT - expectedT) > 0.1) {
            console.error(`FAIL: Expected t=${expectedT}, got t=${actualT}`);
            return false;
        }
    }

    console.log(`  PASS (${result.length} samples at 10ms intervals)`);
    return true;
}

function testRelativeQuaternion(): boolean {
    console.log('Test: Relative quaternion computation...');

    // Thigh at 0 degrees (identity), shin at 45 degrees
    // Relative should be 45 degrees (thigh^-1 * shin)
    const rawSamples: RawDeviceSample[] = [
        createRawSample(LEFT_THIGH, 0, createIdentityQuat()),
        createRawSample(LEFT_SHIN, 0, createRotationQuat(45)),
    ];

    const result = AlignmentService.process(rawSamples, 100);

    if (result.length === 0 || result[0].lq === null) {
        console.error('FAIL: Should produce relative quaternion');
        return false;
    }

    // The relative quaternion should represent ~45 degree rotation
    const expected = createRotationQuat(45);
    if (!quatEqual(result[0].lq, expected, 0.01)) {
        console.error(`FAIL: Expected relative quat ~45deg, got w=${result[0].lq.w}, x=${result[0].lq.x}`);
        return false;
    }

    console.log('  PASS');
    return true;
}

function testLongRecording(): boolean {
    console.log('Test: Long recording (10 seconds at 100Hz)...');

    const rawSamples: RawDeviceSample[] = [];
    const duration = 10000; // 10 seconds
    const sampleInterval = 10; // 100Hz

    // Generate 1000 samples per sensor (4 sensors)
    for (let t = 0; t < duration; t += sampleInterval) {
        const angle = 45 * Math.sin(2 * Math.PI * t / 2000); // Oscillate

        rawSamples.push(createRawSample(LEFT_THIGH, t, createIdentityQuat()));
        rawSamples.push(createRawSample(LEFT_SHIN, t + 1, createRotationQuat(angle)));
        rawSamples.push(createRawSample(RIGHT_THIGH, t + 2, createIdentityQuat()));
        rawSamples.push(createRawSample(RIGHT_SHIN, t + 3, createRotationQuat(angle * 0.8)));
    }

    const startTime = Date.now();
    const result = AlignmentService.process(rawSamples, 100);
    const elapsed = Date.now() - startTime;

    console.log(`  Raw samples: ${rawSamples.length}`);
    console.log(`  Output samples: ${result.length}`);
    console.log(`  Processing time: ${elapsed}ms`);

    if (result.length < 900) { // Should be ~1000 samples
        console.error('FAIL: Should produce ~1000 samples for 10s recording');
        return false;
    }

    // Check both joints have data
    const withBothJoints = result.filter(s => s.lq !== null && s.rq !== null);
    if (withBothJoints.length < result.length * 0.9) {
        console.error('FAIL: Most samples should have both joints');
        return false;
    }

    console.log(`  PASS (${elapsed}ms)`);
    return true;
}

// ─────────────────────────────────────────────────────────────────
// Run Tests
// ─────────────────────────────────────────────────────────────────

function runTests(): void {
    console.log('========================================');
    console.log('AlignmentService Unit Tests');
    console.log('========================================\n');

    const tests = [
        testEmptyInput,
        testSingleJointLeft,
        testSingleJointRight,
        testBothJoints,
        testMissingSensor,
        testOutOfOrderSamples,
        testInterpolationGrid,
        testRelativeQuaternion,
        testLongRecording,
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
        console.log('All tests passed!');
    }
}

runTests();
