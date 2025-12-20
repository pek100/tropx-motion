/**
 * Compression Library Tests
 *
 * Run with: npx ts-node shared/compression/compression.test.ts
 */

import {
  compressQuaternions,
  decompressQuaternions,
  downsampleQuaternions,
  getCompressionRatio,
  COMPRESSION_VERSION,
} from './index';

// ─────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────

function generateQuaternionData(sampleCount: number): Float64Array {
  const data = new Float64Array(sampleCount * 4);

  // Simulate realistic knee flexion/extension pattern
  // Knee angle oscillates sinusoidally (like walking/squatting)
  const frequency = 0.5; // Hz (cycles per second at 100Hz sample rate)
  const sampleRate = 100;
  const maxAngleDeg = 90; // Max knee flexion

  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleRate;

    // Knee angle follows sine wave with small noise
    const angleDeg = (maxAngleDeg / 2) * (1 + Math.sin(2 * Math.PI * frequency * t));
    const angleRad = angleDeg * (Math.PI / 180);

    // Add tiny sensor noise (typical IMU noise)
    const noise = (Math.random() - 0.5) * 0.0001;

    // Convert to quaternion (rotation around X axis)
    const halfAngle = (angleRad + noise) / 2;
    const w = Math.cos(halfAngle);
    const x = Math.sin(halfAngle);
    const y = 0;
    const z = 0;

    const offset = i * 4;
    data[offset] = w;
    data[offset + 1] = x;
    data[offset + 2] = y;
    data[offset + 3] = z;
  }

  return data;
}

// Quantization introduces ~0.003% error (1/32767)
const QUANT_EPSILON = 1 / 32767 + 1e-10;

function arraysEqual(a: Float64Array, b: Float64Array, epsilon = QUANT_EPSILON): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > epsilon) {
      console.error(`Mismatch at index ${i}: ${a[i]} vs ${b[i]} (diff: ${Math.abs(a[i] - b[i])})`);
      return false;
    }
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

function testEmptyArray(): boolean {
  console.log('Test: Empty array...');
  const empty = new Float64Array(0);
  const compressed = compressQuaternions(empty);
  const decompressed = decompressQuaternions(compressed);

  if (decompressed.length !== 0) {
    console.error('FAIL: Empty array should decompress to empty');
    return false;
  }
  console.log('PASS: Empty array');
  return true;
}

function testSingleValue(): boolean {
  console.log('Test: Single quaternion...');
  const single = new Float64Array([1, 0, 0, 0]);
  const compressed = compressQuaternions(single);
  const decompressed = decompressQuaternions(compressed);

  if (!arraysEqual(single, decompressed)) {
    console.error('FAIL: Single value mismatch');
    return false;
  }
  console.log('PASS: Single quaternion');
  return true;
}

function testIdenticalValues(): boolean {
  console.log('Test: Identical values (best case compression)...');
  const count = 1000;
  const data = new Float64Array(count * 4);
  for (let i = 0; i < count; i++) {
    data[i * 4] = 1;
    data[i * 4 + 1] = 0;
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 0;
  }

  const originalSize = data.length * 8; // 8 bytes per float64
  const compressed = compressQuaternions(data);
  const decompressed = decompressQuaternions(compressed);

  if (!arraysEqual(data, decompressed)) {
    console.error('FAIL: Identical values mismatch');
    return false;
  }

  const ratio = getCompressionRatio(originalSize, compressed.length);
  console.log(`PASS: Identical values (ratio: ${ratio.toFixed(1)}x)`);
  return true;
}

function testRealisticData(): boolean {
  console.log('Test: Realistic quaternion data...');
  const count = 5000; // Similar to chunk size
  const data = generateQuaternionData(count);

  const originalSize = data.length * 8;
  const compressed = compressQuaternions(data);
  const decompressed = decompressQuaternions(compressed);

  if (!arraysEqual(data, decompressed)) {
    console.error('FAIL: Realistic data mismatch');
    return false;
  }

  const ratio = getCompressionRatio(originalSize, compressed.length);
  console.log(`PASS: Realistic data (${count} samples)`);
  console.log(`  Original: ${(originalSize / 1024).toFixed(1)} KB`);
  console.log(`  Compressed: ${(compressed.length / 1024).toFixed(1)} KB`);
  console.log(`  Ratio: ${ratio.toFixed(1)}x`);
  return true;
}

function testDownsampling(): boolean {
  console.log('Test: Downsampling...');
  const data = generateQuaternionData(1000);
  const downsampled = downsampleQuaternions(data, 100);

  if (downsampled.length !== 100 * 4) {
    console.error(`FAIL: Expected 400 values, got ${downsampled.length}`);
    return false;
  }

  // First and last should match (approximately)
  if (Math.abs(data[0] - downsampled[0]) > 1e-10) {
    console.error('FAIL: First value mismatch');
    return false;
  }

  console.log('PASS: Downsampling');
  return true;
}

function testLargeDataset(): boolean {
  console.log('Test: Large dataset (simulating 1 minute @ 100Hz)...');
  const count = 6000;
  const data = generateQuaternionData(count);

  const start = Date.now();
  const compressed = compressQuaternions(data);
  const compressTime = Date.now() - start;

  const start2 = Date.now();
  const decompressed = decompressQuaternions(compressed);
  const decompressTime = Date.now() - start2;

  if (!arraysEqual(data, decompressed)) {
    console.error('FAIL: Large dataset mismatch');
    return false;
  }

  const originalSize = data.length * 8;
  const ratio = getCompressionRatio(originalSize, compressed.length);

  console.log(`PASS: Large dataset`);
  console.log(`  Samples: ${count}`);
  console.log(`  Original: ${(originalSize / 1024).toFixed(1)} KB`);
  console.log(`  Compressed: ${(compressed.length / 1024).toFixed(1)} KB`);
  console.log(`  Ratio: ${ratio.toFixed(1)}x`);
  console.log(`  Compress time: ${compressTime}ms`);
  console.log(`  Decompress time: ${decompressTime}ms`);
  return true;
}

// ─────────────────────────────────────────────────────────────────
// Run All Tests
// ─────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('='.repeat(60));
  console.log('Compression Library Tests');
  console.log(`Version: ${COMPRESSION_VERSION}`);
  console.log('='.repeat(60));
  console.log('');

  const tests = [
    testEmptyArray,
    testSingleValue,
    testIdenticalValues,
    testRealisticData,
    testDownsampling,
    testLargeDataset,
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
    } catch (error) {
      console.error(`FAIL: ${test.name} threw error:`, error);
      failed++;
    }
    console.log('');
  }

  console.log('='.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
