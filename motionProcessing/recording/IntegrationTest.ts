/**
 * Integration Test: Recording → Export → Verify
 *
 * Tests the full pipeline:
 * 1. RecordingBuffer stores raw samples
 * 2. CSVExporter processes through AlignmentService
 * 3. Output matches expected format
 *
 * Run with: npx tsx motionProcessing/recording/IntegrationTest.ts
 */

import { RecordingBuffer } from './RecordingBuffer';
import { CSVExporter } from './CSVExporter';
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

// ─────────────────────────────────────────────────────────────────
// Integration Tests
// ─────────────────────────────────────────────────────────────────

function testRecordingBufferToCSV(): boolean {
    console.log('Test: RecordingBuffer → CSVExporter pipeline...');

    // Clear any previous data
    RecordingBuffer.clear();

    // Start recording
    RecordingBuffer.start(100);

    // Simulate 1 second of sensor data at ~100Hz
    const duration = 1000; // 1 second
    const interval = 10;   // 100Hz

    for (let t = 0; t < duration; t += interval) {
        const angle = 45 * Math.sin(2 * Math.PI * t / 500); // Oscillate

        // Push raw samples from all 4 sensors
        RecordingBuffer.pushRawSample(LEFT_THIGH, t, createIdentityQuat());
        RecordingBuffer.pushRawSample(LEFT_SHIN, t + 1, createRotationQuat(angle));
        RecordingBuffer.pushRawSample(RIGHT_THIGH, t + 2, createIdentityQuat());
        RecordingBuffer.pushRawSample(RIGHT_SHIN, t + 3, createRotationQuat(angle * 0.8));
    }

    // Stop recording
    RecordingBuffer.stop();

    // Check raw samples stored
    const rawSamples = RecordingBuffer.getRawSamples();
    console.log(`  Raw samples stored: ${rawSamples.length}`);

    if (rawSamples.length !== 400) { // 100 samples × 4 devices
        console.error(`FAIL: Expected 400 raw samples, got ${rawSamples.length}`);
        return false;
    }

    // Export to CSV (calls AlignmentService internally)
    const exportResult = CSVExporter.export({ targetHz: 100 });

    if (!exportResult.success) {
        console.error(`FAIL: Export failed: ${exportResult.error}`);
        return false;
    }

    console.log(`  Export samples: ${exportResult.sampleCount}`);
    console.log(`  Duration: ${exportResult.durationSeconds?.toFixed(2)}s`);

    // Verify CSV format
    const lines = exportResult.csv!.trim().split('\n');

    // Skip metadata lines (start with #)
    const dataLines = lines.filter(l => !l.startsWith('#'));
    const header = dataLines[0];

    // Check header format: timestamp,relative_s,left_knee,right_knee
    const expectedHeader = 'timestamp,relative_s,left_knee,right_knee';
    if (header !== expectedHeader) {
        console.error(`FAIL: Unexpected header: ${header}`);
        return false;
    }

    // Check data rows (skip header)
    const rows = dataLines.slice(1);
    if (rows.length < 90) { // Should be ~100 samples
        console.error(`FAIL: Expected ~100 data rows, got ${rows.length}`);
        return false;
    }

    // Verify first few rows have valid data
    for (let i = 0; i < Math.min(5, rows.length); i++) {
        const parts = rows[i].split(',');
        if (parts.length !== 4) {
            console.error(`FAIL: Row ${i} has ${parts.length} columns, expected 4`);
            return false;
        }

        const timestamp = parseFloat(parts[0]);
        const relativeS = parseFloat(parts[1]);
        const leftAngle = parseFloat(parts[2]);
        const rightAngle = parseFloat(parts[3]);

        if (isNaN(timestamp) || isNaN(relativeS) || isNaN(leftAngle) || isNaN(rightAngle)) {
            console.error(`FAIL: Row ${i} has invalid data: ${rows[i]}`);
            return false;
        }
    }

    // Verify timestamps are at uniform intervals
    const timestamps: number[] = rows.map(l => parseFloat(l.split(',')[0]));
    for (let i = 1; i < Math.min(10, timestamps.length); i++) {
        const delta = timestamps[i] - timestamps[i - 1];
        if (Math.abs(delta - 10) > 1) { // 10ms interval ± 1ms tolerance
            console.error(`FAIL: Non-uniform interval at row ${i}: ${delta}ms`);
            return false;
        }
    }

    console.log('  PASS');
    RecordingBuffer.clear();
    return true;
}

function testAlignmentServiceDirect(): boolean {
    console.log('Test: AlignmentService direct processing...');

    // Create raw samples directly
    const rawSamples: RawDeviceSample[] = [];

    for (let t = 0; t < 500; t += 10) {
        const angle = 30 * Math.sin(2 * Math.PI * t / 250);

        rawSamples.push({ deviceId: LEFT_THIGH, timestamp: t, quaternion: createIdentityQuat() });
        rawSamples.push({ deviceId: LEFT_SHIN, timestamp: t + 1, quaternion: createRotationQuat(angle) });
        rawSamples.push({ deviceId: RIGHT_THIGH, timestamp: t + 2, quaternion: createIdentityQuat() });
        rawSamples.push({ deviceId: RIGHT_SHIN, timestamp: t + 3, quaternion: createRotationQuat(angle * 0.7) });
    }

    console.log(`  Input raw samples: ${rawSamples.length}`);

    // Process through AlignmentService
    const aligned = AlignmentService.process(rawSamples, 100);

    console.log(`  Output aligned samples: ${aligned.length}`);

    if (aligned.length < 45) { // Should be ~50 samples for 500ms at 100Hz
        console.error(`FAIL: Expected ~50 aligned samples, got ${aligned.length}`);
        return false;
    }

    // Check all samples have both joints
    const withBoth = aligned.filter(s => s.lq !== null && s.rq !== null);
    if (withBoth.length < aligned.length * 0.9) {
        console.error(`FAIL: Most samples should have both joints`);
        return false;
    }

    // Check timestamps are uniform
    for (let i = 1; i < aligned.length; i++) {
        const delta = aligned[i].t - aligned[i - 1].t;
        if (Math.abs(delta - 10) > 0.1) {
            console.error(`FAIL: Non-uniform timestamp at index ${i}: delta=${delta}`);
            return false;
        }
    }

    console.log('  PASS');
    return true;
}

function testSingleJointRecording(): boolean {
    console.log('Test: Single joint recording (left only)...');

    RecordingBuffer.clear();
    RecordingBuffer.start(100);

    // Only push left joint data
    for (let t = 0; t < 500; t += 10) {
        const angle = 45 * Math.sin(2 * Math.PI * t / 250);
        RecordingBuffer.pushRawSample(LEFT_THIGH, t, createIdentityQuat());
        RecordingBuffer.pushRawSample(LEFT_SHIN, t + 1, createRotationQuat(angle));
    }

    RecordingBuffer.stop();

    const exportResult = CSVExporter.export({ targetHz: 100 });

    if (!exportResult.success) {
        console.error(`FAIL: Export failed: ${exportResult.error}`);
        return false;
    }

    // Check CSV has data
    const lines = exportResult.csv!.trim().split('\n');
    const dataLines = lines.filter(l => !l.startsWith('#'));
    if (dataLines.length < 40) {
        console.error(`FAIL: Expected ~50 rows, got ${dataLines.length}`);
        return false;
    }

    // Right knee should be 0 (missing) - format is: timestamp,relative_s,left_knee,right_knee
    const firstDataRow = dataLines[1].split(',');
    const rightAngle = parseFloat(firstDataRow[3]);
    if (rightAngle !== 0) {
        console.error(`FAIL: Right knee should be 0 when missing, got ${rightAngle}`);
        return false;
    }

    console.log(`  Export samples: ${exportResult.sampleCount}`);
    console.log('  PASS');
    RecordingBuffer.clear();
    return true;
}

function testEmptyRecording(): boolean {
    console.log('Test: Empty recording...');

    RecordingBuffer.clear();
    RecordingBuffer.start(100);
    RecordingBuffer.stop();

    const exportResult = CSVExporter.export({ targetHz: 100 });

    if (exportResult.success) {
        console.error('FAIL: Empty recording should not export successfully');
        return false;
    }

    if (!exportResult.error?.includes('No recording data')) {
        console.error(`FAIL: Unexpected error: ${exportResult.error}`);
        return false;
    }

    console.log('  PASS');
    return true;
}

function testOutOfOrderSamples(): boolean {
    console.log('Test: Out-of-order BLE samples...');

    RecordingBuffer.clear();
    RecordingBuffer.start(100);

    // Simulate out-of-order BLE arrival
    const timestamps = [0, 20, 10, 30, 50, 40];
    for (const t of timestamps) {
        RecordingBuffer.pushRawSample(LEFT_THIGH, t, createIdentityQuat());
        RecordingBuffer.pushRawSample(LEFT_SHIN, t + 1, createRotationQuat(30));
    }

    RecordingBuffer.stop();

    // getRawSamples should sort by timestamp
    const sorted = RecordingBuffer.getRawSamples();
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].timestamp < sorted[i - 1].timestamp) {
            console.error('FAIL: Raw samples not sorted');
            return false;
        }
    }

    // Export should work
    const exportResult = CSVExporter.export({ targetHz: 100 });
    if (!exportResult.success) {
        console.error(`FAIL: Export failed: ${exportResult.error}`);
        return false;
    }

    console.log(`  Export samples: ${exportResult.sampleCount}`);
    console.log('  PASS');
    RecordingBuffer.clear();
    return true;
}

// ─────────────────────────────────────────────────────────────────
// Run Tests
// ─────────────────────────────────────────────────────────────────

function runTests(): void {
    console.log('========================================');
    console.log('Integration Tests: Recording Pipeline');
    console.log('========================================\n');

    const tests = [
        testEmptyRecording,
        testAlignmentServiceDirect,
        testRecordingBufferToCSV,
        testSingleJointRecording,
        testOutOfOrderSamples,
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
