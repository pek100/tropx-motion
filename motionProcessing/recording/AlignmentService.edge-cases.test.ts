/**
 * Edge Case Tests for AlignmentService
 *
 * Run with: npx tsx motionProcessing/recording/AlignmentService.edge-cases.test.ts
 */

import { AlignmentService } from './AlignmentService';
import { RawDeviceSample } from './types';
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

// ─────────────────────────────────────────────────────────────────
// Edge Case Tests
// ─────────────────────────────────────────────────────────────────

function testAsymmetricJointData(): boolean {
    console.log('Test: Asymmetric joint data (left has 2x samples of right)...');

    const rawSamples: RawDeviceSample[] = [];

    // Left joint: 20 samples at 5ms intervals (200Hz effective)
    for (let t = 0; t < 100; t += 5) {
        rawSamples.push(createRawSample(LEFT_THIGH, t, createIdentityQuat()));
        rawSamples.push(createRawSample(LEFT_SHIN, t + 1, createRotationQuat(45)));
    }

    // Right joint: 10 samples at 10ms intervals (100Hz effective)
    for (let t = 0; t < 100; t += 10) {
        rawSamples.push(createRawSample(RIGHT_THIGH, t, createIdentityQuat()));
        rawSamples.push(createRawSample(RIGHT_SHIN, t + 1, createRotationQuat(30)));
    }

    const result = AlignmentService.process(rawSamples, 100);

    // Should produce aligned samples based on left's timeline
    if (result.length < 10) {
        console.error(`FAIL: Expected at least 10 samples, got ${result.length}`);
        return false;
    }

    // Both joints should have data
    const withBoth = result.filter(s => s.lq !== null && s.rq !== null);
    if (withBoth.length !== result.length) {
        console.error(`FAIL: All samples should have both joints, only ${withBoth.length}/${result.length} do`);
        return false;
    }

    console.log(`  PASS (${result.length} samples with asymmetric input)`);
    return true;
}

function testVerySparseSamples(): boolean {
    console.log('Test: Very sparse samples (100ms apart)...');

    const rawSamples: RawDeviceSample[] = [
        createRawSample(LEFT_THIGH, 0, createIdentityQuat()),
        createRawSample(LEFT_SHIN, 0, createRotationQuat(0)),
        createRawSample(LEFT_THIGH, 100, createIdentityQuat()),
        createRawSample(LEFT_SHIN, 100, createRotationQuat(45)),
        createRawSample(LEFT_THIGH, 200, createIdentityQuat()),
        createRawSample(LEFT_SHIN, 200, createRotationQuat(90)),
    ];

    const result = AlignmentService.process(rawSamples, 100); // 100Hz = 10ms intervals

    // Should interpolate between sparse samples
    // 200ms / 10ms = 20 samples + 1 = 21 samples (0, 10, 20, ..., 200)
    if (result.length !== 21) {
        console.error(`FAIL: Expected 21 interpolated samples, got ${result.length}`);
        return false;
    }

    // Check middle sample (t=100) should be ~45 degrees
    const sample100 = result.find(s => s.t === 100);
    if (!sample100 || !sample100.lq) {
        console.error('FAIL: Missing sample at t=100');
        return false;
    }

    console.log(`  PASS (${result.length} samples from sparse input)`);
    return true;
}

function testSingleSamplePerJoint(): boolean {
    console.log('Test: Single sample per joint...');

    const rawSamples: RawDeviceSample[] = [
        createRawSample(LEFT_THIGH, 50, createIdentityQuat()),
        createRawSample(LEFT_SHIN, 50, createRotationQuat(30)),
    ];

    const result = AlignmentService.process(rawSamples, 100);

    // Should produce exactly 1 sample (no interpolation possible)
    if (result.length !== 1) {
        console.error(`FAIL: Expected 1 sample, got ${result.length}`);
        return false;
    }

    if (result[0].t !== 50) {
        console.error(`FAIL: Expected t=50, got t=${result[0].t}`);
        return false;
    }

    console.log('  PASS');
    return true;
}

function testLargeTimestampGap(): boolean {
    console.log('Test: Large timestamp gap in middle...');

    const rawSamples: RawDeviceSample[] = [];

    // First segment: 0-100ms
    for (let t = 0; t <= 100; t += 10) {
        rawSamples.push(createRawSample(LEFT_THIGH, t, createIdentityQuat()));
        rawSamples.push(createRawSample(LEFT_SHIN, t, createRotationQuat(30)));
    }

    // Gap: 100ms to 1000ms (no data)

    // Second segment: 1000-1100ms
    for (let t = 1000; t <= 1100; t += 10) {
        rawSamples.push(createRawSample(LEFT_THIGH, t, createIdentityQuat()));
        rawSamples.push(createRawSample(LEFT_SHIN, t, createRotationQuat(60)));
    }

    const result = AlignmentService.process(rawSamples, 100);

    // Should interpolate across the gap
    // From 0 to 1100 at 10ms intervals = 111 samples
    const expectedSamples = Math.ceil((1100 - 0) / 10) + 1;
    if (result.length !== expectedSamples) {
        console.error(`FAIL: Expected ${expectedSamples} samples, got ${result.length}`);
        return false;
    }

    // Check that the gap is filled with interpolated values
    const gapSample = result.find(s => s.t === 500);
    if (!gapSample) {
        console.error('FAIL: Missing interpolated sample at t=500');
        return false;
    }

    console.log(`  PASS (${result.length} samples, gap filled)`);
    return true;
}

function testTimestampPrecision(): boolean {
    console.log('Test: Timestamp precision (fractional ms)...');

    const rawSamples: RawDeviceSample[] = [
        createRawSample(LEFT_THIGH, 0.5, createIdentityQuat()),
        createRawSample(LEFT_SHIN, 0.5, createRotationQuat(30)),
        createRawSample(LEFT_THIGH, 10.7, createIdentityQuat()),
        createRawSample(LEFT_SHIN, 10.7, createRotationQuat(45)),
        createRawSample(LEFT_THIGH, 20.3, createIdentityQuat()),
        createRawSample(LEFT_SHIN, 20.3, createRotationQuat(60)),
    ];

    const result = AlignmentService.process(rawSamples, 100);

    // Should handle fractional timestamps
    if (result.length < 2) {
        console.error(`FAIL: Expected at least 2 samples, got ${result.length}`);
        return false;
    }

    // First sample should be at startTime (0.5)
    if (Math.abs(result[0].t - 0.5) > 0.1) {
        console.error(`FAIL: First sample should be at ~0.5, got ${result[0].t}`);
        return false;
    }

    console.log(`  PASS (${result.length} samples from fractional timestamps)`);
    return true;
}

function testDifferentSensorRates(): boolean {
    console.log('Test: Different sensor rates (thigh 50Hz, shin 100Hz)...');

    const rawSamples: RawDeviceSample[] = [];

    // Thigh at 50Hz (20ms intervals)
    for (let t = 0; t <= 100; t += 20) {
        rawSamples.push(createRawSample(LEFT_THIGH, t, createIdentityQuat()));
    }

    // Shin at 100Hz (10ms intervals)
    for (let t = 0; t <= 100; t += 10) {
        rawSamples.push(createRawSample(LEFT_SHIN, t, createRotationQuat(45)));
    }

    const result = AlignmentService.process(rawSamples, 100);

    // Output should be based on thigh samples (6 thigh samples = 6 aligned samples before interpolation)
    // Then interpolated to 11 samples (0, 10, 20, ..., 100)
    if (result.length !== 11) {
        console.error(`FAIL: Expected 11 samples, got ${result.length}`);
        return false;
    }

    console.log(`  PASS (${result.length} samples)`);
    return true;
}

function testMissingShinInMiddle(): boolean {
    console.log('Test: Missing shin samples in middle of recording...');

    const rawSamples: RawDeviceSample[] = [];

    // Full thigh coverage
    for (let t = 0; t <= 100; t += 10) {
        rawSamples.push(createRawSample(LEFT_THIGH, t, createIdentityQuat()));
    }

    // Shin with gap in middle (0-30, then 70-100)
    for (let t = 0; t <= 30; t += 10) {
        rawSamples.push(createRawSample(LEFT_SHIN, t, createRotationQuat(30)));
    }
    for (let t = 70; t <= 100; t += 10) {
        rawSamples.push(createRawSample(LEFT_SHIN, t, createRotationQuat(60)));
    }

    const result = AlignmentService.process(rawSamples, 100);

    // Even with shin gap, alignment should work using closest shin sample
    if (result.length !== 11) {
        console.error(`FAIL: Expected 11 samples, got ${result.length}`);
        return false;
    }

    // The middle samples should use the closest available shin data
    const sample50 = result.find(s => s.t === 50);
    if (!sample50 || !sample50.lq) {
        console.error('FAIL: Missing sample at t=50');
        return false;
    }

    console.log(`  PASS (${result.length} samples, shin gap handled)`);
    return true;
}

function testZeroDurationRecording(): boolean {
    console.log('Test: All samples at same timestamp...');

    const rawSamples: RawDeviceSample[] = [
        createRawSample(LEFT_THIGH, 100, createIdentityQuat()),
        createRawSample(LEFT_SHIN, 100, createRotationQuat(45)),
        createRawSample(LEFT_THIGH, 100, createIdentityQuat()),
        createRawSample(LEFT_SHIN, 100, createRotationQuat(45)),
    ];

    const result = AlignmentService.process(rawSamples, 100);

    // Should produce at least 1 sample
    if (result.length < 1) {
        console.error(`FAIL: Expected at least 1 sample, got ${result.length}`);
        return false;
    }

    console.log(`  PASS (${result.length} sample(s))`);
    return true;
}

function testNegativeTimestamps(): boolean {
    console.log('Test: Negative timestamps (edge case)...');

    const rawSamples: RawDeviceSample[] = [
        createRawSample(LEFT_THIGH, -100, createIdentityQuat()),
        createRawSample(LEFT_SHIN, -100, createRotationQuat(30)),
        createRawSample(LEFT_THIGH, 0, createIdentityQuat()),
        createRawSample(LEFT_SHIN, 0, createRotationQuat(45)),
        createRawSample(LEFT_THIGH, 100, createIdentityQuat()),
        createRawSample(LEFT_SHIN, 100, createRotationQuat(60)),
    ];

    const result = AlignmentService.process(rawSamples, 100);

    // Should handle negative timestamps correctly
    // From -100 to 100 at 10ms = 21 samples
    if (result.length !== 21) {
        console.error(`FAIL: Expected 21 samples, got ${result.length}`);
        return false;
    }

    // First timestamp should be -100
    if (result[0].t !== -100) {
        console.error(`FAIL: Expected first t=-100, got ${result[0].t}`);
        return false;
    }

    console.log(`  PASS (${result.length} samples with negative timestamps)`);
    return true;
}

function testVeryHighFrequency(): boolean {
    console.log('Test: Very high frequency target (1000Hz)...');

    const rawSamples: RawDeviceSample[] = [
        createRawSample(LEFT_THIGH, 0, createIdentityQuat()),
        createRawSample(LEFT_SHIN, 0, createRotationQuat(0)),
        createRawSample(LEFT_THIGH, 100, createIdentityQuat()),
        createRawSample(LEFT_SHIN, 100, createRotationQuat(90)),
    ];

    const result = AlignmentService.process(rawSamples, 1000); // 1000Hz = 1ms intervals

    // Should produce many interpolated samples
    // From 0 to 100 at 1ms = 101 samples
    if (result.length !== 101) {
        console.error(`FAIL: Expected 101 samples at 1000Hz, got ${result.length}`);
        return false;
    }

    console.log(`  PASS (${result.length} samples at 1000Hz)`);
    return true;
}

// ─────────────────────────────────────────────────────────────────
// Run Tests
// ─────────────────────────────────────────────────────────────────

function runTests(): void {
    console.log('========================================');
    console.log('AlignmentService Edge Case Tests');
    console.log('========================================\n');

    const tests = [
        testAsymmetricJointData,
        testVerySparseSamples,
        testSingleSamplePerJoint,
        testLargeTimestampGap,
        testTimestampPrecision,
        testDifferentSensorRates,
        testMissingShinInMiddle,
        testZeroDurationRecording,
        testNegativeTimestamps,
        testVeryHighFrequency,
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
        console.log('All edge case tests passed!');
    }
}

runTests();
