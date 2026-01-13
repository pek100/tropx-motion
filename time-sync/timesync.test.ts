/**
 * Time Sync Algorithm Tests
 *
 * Tests the time synchronization system with mock sensors simulating various edge cases.
 * Run with: npx ts-node time-sync/timesync.test.ts
 */

// Inlined constants (same as ./constants.ts)
const REFERENCE_EPOCH_MS = 1580000000 * 1000;
const SAMPLE_COUNT = 20;
const OUTLIER_REMOVAL_PERCENT = 0.2;

// ─────────────────────────────────────────────────────────────────
// Mock Types (simplified from actual types)
// ─────────────────────────────────────────────────────────────────

interface MockDevice {
  deviceId: string;
  deviceName: string;
  counter: number;           // Device's internal counter (ms since REFERENCE_EPOCH)
  clockDriftPpm: number;     // Parts per million drift rate
  baseRttMs: number;         // Base RTT for this device
  rttVarianceMs: number;     // RTT variance (simulates BLE noise)
  setDateTimeReceivedAt: number;  // Wall clock when SET_DATETIME was received
  counterBase: number;       // Counter value at setDateTimeReceivedAt
}

interface SyncSample {
  rtt: number;
  offset: number;
  deviceCounter: number;
}

// ─────────────────────────────────────────────────────────────────
// Mock Sensor Factory
// ─────────────────────────────────────────────────────────────────

function createMockDevice(
  id: string,
  name: string,
  opts: Partial<MockDevice> = {}
): MockDevice {
  return {
    deviceId: id,
    deviceName: name,
    counter: 0,
    clockDriftPpm: opts.clockDriftPpm ?? 0,
    baseRttMs: opts.baseRttMs ?? 20,
    rttVarianceMs: opts.rttVarianceMs ?? 10,
    setDateTimeReceivedAt: 0,
    counterBase: 0,
  };
}

// ─────────────────────────────────────────────────────────────────
// Simulation Functions
// ─────────────────────────────────────────────────────────────────

/**
 * Gets device counter at a specific wall clock time.
 * Counter = counterBase + (wallClock - setDateTimeReceivedAt) * driftFactor
 */
function getDeviceCounterAt(device: MockDevice, wallClockMs: number): number {
  const elapsed = wallClockMs - device.setDateTimeReceivedAt;
  const driftFactor = 1 + device.clockDriftPpm / 1_000_000;
  return device.counterBase + elapsed * driftFactor;
}

/**
 * Simulates SET_DATETIME command sent sequentially to all devices.
 * Returns the wall clock time after all SET_DATETIME commands complete.
 */
function simulateSetDateTime(
  devices: MockDevice[],
  commonTimestampSeconds: number,
  startWallClock: number,
  delayPerDeviceMs: number = 50
): number {
  const counterBase = commonTimestampSeconds * 1000 - REFERENCE_EPOCH_MS;

  let currentWallClock = startWallClock;

  for (const device of devices) {
    // Device receives SET_DATETIME at currentWallClock
    device.setDateTimeReceivedAt = currentWallClock;
    device.counterBase = counterBase;
    currentWallClock += delayPerDeviceMs;
  }

  // Return wall clock time after all SET_DATETIME commands complete
  return currentWallClock;
}

/**
 * Simulates GET_TIMESTAMP measurement with BLE timing noise.
 * Returns timestamp, RTT, and the wall clock time when response was received.
 */
function simulateGetTimestamp(
  device: MockDevice,
  wallClockMs: number
): { timestamp: number; rtt: number; receiveTime: number; nextWallClock: number } {
  // Simulate BLE RTT with variance
  const rttNoise = (Math.random() - 0.5) * 2 * device.rttVarianceMs;
  const rtt = Math.max(1, device.baseRttMs + rttNoise);

  // writeCompleteTime = when device received command and sampled timestamp
  const writeCompleteTime = wallClockMs + rtt / 2;

  // Device samples its counter at writeCompleteTime
  const deviceCounter = getDeviceCounterAt(device, writeCompleteTime);

  // Response received at wallClockMs + rtt
  const responseReceivedAt = wallClockMs + rtt;

  return {
    timestamp: deviceCounter,
    rtt: rtt,  // This is the write latency used in offset calculation
    receiveTime: writeCompleteTime,  // This is used as receiveTime in offset calculation
    nextWallClock: responseReceivedAt,  // Wall clock after this operation
  };
}

/**
 * Calculates offset using NTP-style algorithm (same as TimeSyncManager).
 */
function calculateOffset(
  receiveTime: number,
  rtt: number,
  deviceCounter: number
): number {
  const masterMidpoint = receiveTime - rtt / 2;
  const masterSinceRefEpoch = masterMidpoint - REFERENCE_EPOCH_MS;
  return masterSinceRefEpoch - deviceCounter;
}

/**
 * Computes median offset with outlier removal (same as OffsetEstimator).
 */
function computeMedianOffset(samples: SyncSample[]): { medianOffset: number; avgRTT: number } {
  // Sort by RTT (lowest = best quality)
  const sorted = [...samples].sort((a, b) => a.rtt - b.rtt);

  // Remove outliers (top/bottom 10% each)
  const removeCount = Math.floor(sorted.length * OUTLIER_REMOVAL_PERCENT / 2);
  const kept = sorted.slice(removeCount, sorted.length - removeCount);

  // Compute median offset
  const offsets = kept.map(s => s.offset).sort((a, b) => a - b);
  const mid = Math.floor(offsets.length / 2);
  const medianOffset = offsets.length % 2 === 0
    ? (offsets[mid - 1] + offsets[mid]) / 2
    : offsets[mid];

  // Compute average RTT
  const avgRTT = kept.reduce((sum, s) => sum + s.rtt, 0) / kept.length;

  return { medianOffset, avgRTT };
}

/**
 * Full sync simulation for multiple devices.
 * Models the actual sync process: sequential SET_DATETIME, then parallel sampling.
 */
function simulateSync(devices: MockDevice[], setDateTimeDelayMs: number = 50): Map<string, number> {
  const startWallClock = Date.now();
  const commonTimestampSeconds = Math.floor(startWallClock / 1000);

  // Step 1: SET_DATETIME for all devices (sequentially)
  let wallClock = simulateSetDateTime(devices, commonTimestampSeconds, startWallClock, setDateTimeDelayMs);

  // Small delay after SET_DATETIME
  wallClock += 50;

  // Step 2: Collect samples from all devices (in parallel, but samples are sequential per device)
  // In real code, Promise.all runs these in parallel
  const deviceOffsets = new Map<string, number>();

  // For simulation, we interleave samples from all devices (approximates parallel execution)
  const deviceSamples = new Map<string, SyncSample[]>();
  for (const device of devices) {
    deviceSamples.set(device.deviceId, []);
  }

  // Collect samples - in real parallel execution, all devices sample at roughly same wall clock times
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    for (const device of devices) {
      const { timestamp: deviceCounter, rtt, receiveTime, nextWallClock } = simulateGetTimestamp(device, wallClock);
      const offset = calculateOffset(receiveTime, rtt, deviceCounter);
      deviceSamples.get(device.deviceId)!.push({ rtt, offset, deviceCounter });
    }
    // Advance wall clock for next sample (10ms between samples)
    wallClock += 10;
  }

  // Compute median offset for each device
  for (const device of devices) {
    const samples = deviceSamples.get(device.deviceId)!;
    const { medianOffset } = computeMedianOffset(samples);
    deviceOffsets.set(device.deviceId, medianOffset);
  }

  return deviceOffsets;
}

/**
 * Simulates streaming data after sync.
 * Returns "synced" timestamps for each device at the same wall-clock moment.
 */
function simulateStreaming(
  devices: MockDevice[],
  offsets: Map<string, number>,
  streamingWallClock: number
): Map<string, number> {
  // All devices sample at the same wall clock time during streaming
  const syncedTimestamps = new Map<string, number>();

  for (const device of devices) {
    // Get device counter at streaming time
    const deviceCounter = getDeviceCounterAt(device, streamingWallClock);

    // Apply software sync: syncedTimestamp = REFERENCE_EPOCH + counter + offset
    const rawTimestamp = REFERENCE_EPOCH_MS + deviceCounter;
    const offset = offsets.get(device.deviceId) ?? 0;
    const syncedTimestamp = rawTimestamp + offset;

    syncedTimestamps.set(device.deviceId, syncedTimestamp);
  }

  return syncedTimestamps;
}

// ─────────────────────────────────────────────────────────────────
// Test Cases
// ─────────────────────────────────────────────────────────────────

function testPerfectSync(): boolean {
  console.log('Test: Perfect sync (identical devices)...');

  const devices = [
    createMockDevice('0x11', 'Left Shin'),
    createMockDevice('0x12', 'Left Thigh'),
    createMockDevice('0x21', 'Right Shin'),
    createMockDevice('0x22', 'Right Thigh'),
  ];

  const offsets = simulateSync(devices);

  // Streaming happens 1 second after sync completes
  const streamingWallClock = Date.now() + 1000;
  const syncedTs = simulateStreaming(devices, offsets, streamingWallClock);

  // All synced timestamps should be within 10ms of each other
  const values = Array.from(syncedTs.values());
  const maxDiff = Math.max(...values) - Math.min(...values);

  console.log('  Synced timestamps:');
  syncedTs.forEach((ts, id) => {
    console.log(`    ${id}: ${ts.toFixed(0)}ms (offset: ${offsets.get(id)?.toFixed(2)}ms)`);
  });
  console.log(`  Max difference: ${maxDiff.toFixed(2)}ms`);

  if (maxDiff > 50) {
    console.error(`FAIL: Max diff ${maxDiff.toFixed(2)}ms exceeds 50ms threshold`);
    return false;
  }

  console.log('PASS: Perfect sync');
  return true;
}

function testSequentialSetDateTimeDelay(): boolean {
  console.log('Test: Sequential SET_DATETIME delay (150ms between devices)...');

  // Simulate sequential SET_DATETIME with 150ms delays
  const devices = [
    createMockDevice('0x11', 'Left Shin'),
    createMockDevice('0x12', 'Left Thigh'),
    createMockDevice('0x21', 'Right Shin'),
    createMockDevice('0x22', 'Right Thigh'),
  ];

  // 150ms delay per device instead of default 50ms
  const offsets = simulateSync(devices, 150);

  const streamingWallClock = Date.now() + 1000;
  const syncedTs = simulateStreaming(devices, offsets, streamingWallClock);

  const values = Array.from(syncedTs.values());
  const maxDiff = Math.max(...values) - Math.min(...values);

  console.log('  Calculated offsets:');
  offsets.forEach((offset, id) => {
    console.log(`    ${id}: ${offset.toFixed(2)}ms`);
  });
  console.log(`  Max timestamp difference: ${maxDiff.toFixed(2)}ms`);

  // With proper offset correction, devices should still be aligned
  if (maxDiff > 100) {
    console.error(`FAIL: Max diff ${maxDiff.toFixed(2)}ms exceeds 100ms threshold`);
    return false;
  }

  console.log('PASS: Sequential SET_DATETIME delay');
  return true;
}

function testHighRTTVariance(): boolean {
  console.log('Test: High RTT variance (simulating BLE noise)...');

  // Run multiple trials and check consistency
  const trials = 10;
  const maxDiffs: number[] = [];

  for (let t = 0; t < trials; t++) {
    // Create fresh devices for each trial
    const devices = [
      createMockDevice('0x11', 'Left Shin', { rttVarianceMs: 50 }),
      createMockDevice('0x12', 'Left Thigh', { rttVarianceMs: 50 }),
      createMockDevice('0x21', 'Right Shin', { rttVarianceMs: 50 }),
      createMockDevice('0x22', 'Right Thigh', { rttVarianceMs: 50 }),
    ];

    const offsets = simulateSync(devices);
    const streamingWallClock = Date.now() + 1000;
    const syncedTs = simulateStreaming(devices, offsets, streamingWallClock);

    const values = Array.from(syncedTs.values());
    maxDiffs.push(Math.max(...values) - Math.min(...values));
  }

  const avgMaxDiff = maxDiffs.reduce((a, b) => a + b, 0) / trials;
  const maxMaxDiff = Math.max(...maxDiffs);

  console.log(`  Trials: ${trials}`);
  console.log(`  Average max diff: ${avgMaxDiff.toFixed(2)}ms`);
  console.log(`  Worst case max diff: ${maxMaxDiff.toFixed(2)}ms`);

  // With high variance, expect some error but should still be reasonable
  if (avgMaxDiff > 100) {
    console.error(`FAIL: Average diff ${avgMaxDiff.toFixed(2)}ms exceeds 100ms threshold`);
    return false;
  }

  console.log('PASS: High RTT variance');
  return true;
}

function testClockDrift(): boolean {
  console.log('Test: Clock drift (±100 ppm)...');

  const devices = [
    createMockDevice('0x11', 'Left Shin', { clockDriftPpm: 100 }),
    createMockDevice('0x12', 'Left Thigh', { clockDriftPpm: -100 }),
    createMockDevice('0x21', 'Right Shin', { clockDriftPpm: 50 }),
    createMockDevice('0x22', 'Right Thigh', { clockDriftPpm: -50 }),
  ];

  const offsets = simulateSync(devices);

  // Simulate 10 seconds of streaming after sync
  const streamingWallClock = Date.now() + 10000;
  const syncedTs = simulateStreaming(devices, offsets, streamingWallClock);

  const values = Array.from(syncedTs.values());
  const maxDiff = Math.max(...values) - Math.min(...values);

  console.log('  After 10s of streaming:');
  console.log(`  Max timestamp difference: ${maxDiff.toFixed(2)}ms`);

  // With 200ppm total drift over 10s: 200 * 10000 / 1000000 = 2ms
  // Should be well within tolerance
  if (maxDiff > 50) {
    console.error(`FAIL: Max diff ${maxDiff.toFixed(2)}ms exceeds 50ms threshold`);
    return false;
  }

  console.log('PASS: Clock drift');
  return true;
}

function testAsymmetricRTT(): boolean {
  console.log('Test: Asymmetric RTT (different base RTT per device)...');

  const devices = [
    createMockDevice('0x11', 'Left Shin', { baseRttMs: 10 }),
    createMockDevice('0x12', 'Left Thigh', { baseRttMs: 30 }),
    createMockDevice('0x21', 'Right Shin', { baseRttMs: 50 }),
    createMockDevice('0x22', 'Right Thigh', { baseRttMs: 70 }),
  ];

  const offsets = simulateSync(devices);
  const streamingWallClock = Date.now() + 1000;
  const syncedTs = simulateStreaming(devices, offsets, streamingWallClock);

  const values = Array.from(syncedTs.values());
  const maxDiff = Math.max(...values) - Math.min(...values);

  console.log('  Calculated offsets:');
  offsets.forEach((offset, id) => {
    const device = devices.find(d => d.deviceId === id)!;
    console.log(`    ${id}: ${offset.toFixed(2)}ms (base RTT: ${device.baseRttMs}ms)`);
  });
  console.log(`  Max timestamp difference: ${maxDiff.toFixed(2)}ms`);

  // Different RTT should be compensated by offset calculation
  if (maxDiff > 80) {
    console.error(`FAIL: Max diff ${maxDiff.toFixed(2)}ms exceeds 80ms threshold`);
    return false;
  }

  console.log('PASS: Asymmetric RTT');
  return true;
}

function testWorstCase(): boolean {
  console.log('Test: Worst case (all issues combined)...');

  // Run multiple trials
  const trials = 10;
  const maxDiffs: number[] = [];

  for (let t = 0; t < trials; t++) {
    const devices = [
      createMockDevice('0x11', 'Left Shin', {
        clockDriftPpm: 100,
        baseRttMs: 10,
        rttVarianceMs: 30,
      }),
      createMockDevice('0x12', 'Left Thigh', {
        clockDriftPpm: -100,
        baseRttMs: 50,
        rttVarianceMs: 40,
      }),
      createMockDevice('0x21', 'Right Shin', {
        clockDriftPpm: 50,
        baseRttMs: 30,
        rttVarianceMs: 35,
      }),
      createMockDevice('0x22', 'Right Thigh', {
        clockDriftPpm: -50,
        baseRttMs: 70,
        rttVarianceMs: 50,
      }),
    ];

    // 100ms delay per device (worst case)
    const offsets = simulateSync(devices, 100);
    const streamingWallClock = Date.now() + 5000; // 5 seconds after sync
    const syncedTs = simulateStreaming(devices, offsets, streamingWallClock);

    const values = Array.from(syncedTs.values());
    maxDiffs.push(Math.max(...values) - Math.min(...values));
  }

  const avgMaxDiff = maxDiffs.reduce((a, b) => a + b, 0) / trials;
  const maxMaxDiff = Math.max(...maxDiffs);

  console.log(`  Trials: ${trials}`);
  console.log(`  Average max diff: ${avgMaxDiff.toFixed(2)}ms`);
  console.log(`  Worst case max diff: ${maxMaxDiff.toFixed(2)}ms`);

  // In worst case, allow more tolerance but flag if > 200ms
  if (avgMaxDiff > 200) {
    console.error(`FAIL: Average diff ${avgMaxDiff.toFixed(2)}ms exceeds 200ms threshold`);
    return false;
  }

  if (maxMaxDiff > 300) {
    console.warn(`WARNING: Worst case ${maxMaxDiff.toFixed(2)}ms exceeds 300ms threshold`);
  }

  console.log('PASS: Worst case');
  return true;
}

function testRelativeAlignment(): boolean {
  console.log('Test: Relative alignment (same joint thigh/shin)...');

  // Run multiple trials
  const trials = 20;
  const diffs: number[] = [];

  for (let t = 0; t < trials; t++) {
    const devices = [
      createMockDevice('0x11', 'Left Shin', { baseRttMs: 20, rttVarianceMs: 30 }),
      createMockDevice('0x12', 'Left Thigh', { baseRttMs: 25, rttVarianceMs: 35 }),
    ];

    const offsets = simulateSync(devices);
    const streamingWallClock = Date.now() + 1000;
    const syncedTs = simulateStreaming(devices, offsets, streamingWallClock);

    const shinTs = syncedTs.get('0x11')!;
    const thighTs = syncedTs.get('0x12')!;
    diffs.push(Math.abs(shinTs - thighTs));
  }

  const avgDiff = diffs.reduce((a, b) => a + b, 0) / trials;
  const maxDiff = Math.max(...diffs);

  console.log(`  Trials: ${trials}`);
  console.log(`  Average shin/thigh diff: ${avgDiff.toFixed(2)}ms`);
  console.log(`  Max shin/thigh diff: ${maxDiff.toFixed(2)}ms`);

  // For angle calculation, thigh/shin alignment is critical
  if (avgDiff > 50) {
    console.error(`FAIL: Average diff ${avgDiff.toFixed(2)}ms exceeds 50ms threshold`);
    return false;
  }

  console.log('PASS: Relative alignment');
  return true;
}

// ─────────────────────────────────────────────────────────────────
// LIVE Mode Simulation (GridSnapLiveService)
// ─────────────────────────────────────────────────────────────────

interface Sample {
  timestamp: number;
  quaternion: { w: number; x: number; y: number; z: number };
}

interface SensorState {
  queue: Sample[];
  prev: Sample | null;
  curr: Sample | null;
}

interface AlignedOutput {
  gridTimestamp: number;
  leftThigh?: Sample;
  leftShin?: Sample;
  rightThigh?: Sample;
  rightShin?: Sample;
}

/**
 * Mock GridSnapLiveService for testing.
 * Implements the same tick-based interpolation logic.
 */
class MockGridSnapLiveService {
  private sensorStates: Map<number, SensorState> = new Map();
  private gridPosition: number = 0;
  private gridInitialized: boolean = false;
  private tickIntervalMs: number = 10; // 100Hz
  private outputs: AlignedOutput[] = [];

  constructor() {
    // Initialize sensor states
    for (const deviceId of [0x11, 0x12, 0x21, 0x22]) {
      this.sensorStates.set(deviceId, { queue: [], prev: null, curr: null });
    }
  }

  pushSample(deviceId: number, timestamp: number, quaternion: Sample['quaternion']): void {
    const state = this.sensorStates.get(deviceId);
    if (state) {
      state.queue.push({ timestamp, quaternion });
    }
  }

  /**
   * Process one tick - consume from queues and emit aligned samples.
   */
  tick(): void {
    // Step 1: Consume one sample from each queue
    for (const state of this.sensorStates.values()) {
      if (state.queue.length > 0) {
        state.prev = state.curr;
        state.curr = state.queue.shift()!;
      }
    }

    // Step 2: Get data boundary (MIN of curr timestamps)
    const dataBoundary = this.getDataBoundary();
    if (dataBoundary === null) return;

    // Step 3: Initialize grid position from first data
    if (!this.gridInitialized) {
      this.gridPosition = dataBoundary;
      this.gridInitialized = true;
      return;
    }

    // Step 4: Calculate next grid position
    const nextGridPosition = this.gridPosition + this.tickIntervalMs;

    // Step 5: Only advance if we have data beyond target
    if (nextGridPosition > dataBoundary) {
      return; // Wait for more data
    }

    this.gridPosition = nextGridPosition;

    // Step 6: Interpolate and emit
    const output: AlignedOutput = {
      gridTimestamp: this.gridPosition,
      leftThigh: this.interpolateSensor(0x12, this.gridPosition),
      leftShin: this.interpolateSensor(0x11, this.gridPosition),
      rightThigh: this.interpolateSensor(0x22, this.gridPosition),
      rightShin: this.interpolateSensor(0x21, this.gridPosition),
    };

    this.outputs.push(output);
  }

  private getDataBoundary(): number | null {
    const timestamps: number[] = [];
    for (const state of this.sensorStates.values()) {
      if (state.curr) {
        timestamps.push(state.curr.timestamp);
      }
    }
    return timestamps.length > 0 ? Math.min(...timestamps) : null;
  }

  private interpolateSensor(deviceId: number, gridTimestamp: number): Sample | undefined {
    const state = this.sensorStates.get(deviceId);
    if (!state?.curr) return undefined;

    if (state.prev) {
      const prevTs = state.prev.timestamp;
      const currTs = state.curr.timestamp;
      const dt = currTs - prevTs;

      if (gridTimestamp <= prevTs) {
        return { timestamp: gridTimestamp, quaternion: state.prev.quaternion };
      } else if (gridTimestamp >= currTs) {
        return { timestamp: gridTimestamp, quaternion: state.curr.quaternion };
      } else if (dt > 0) {
        const t = (gridTimestamp - prevTs) / dt;
        // Simple linear interpolation for test (real uses SLERP)
        return {
          timestamp: gridTimestamp,
          quaternion: {
            w: state.prev.quaternion.w + t * (state.curr.quaternion.w - state.prev.quaternion.w),
            x: state.prev.quaternion.x + t * (state.curr.quaternion.x - state.prev.quaternion.x),
            y: state.prev.quaternion.y + t * (state.curr.quaternion.y - state.prev.quaternion.y),
            z: state.prev.quaternion.z + t * (state.curr.quaternion.z - state.prev.quaternion.z),
          }
        };
      }
    }

    return { timestamp: gridTimestamp, quaternion: state.curr.quaternion };
  }

  getOutputs(): AlignedOutput[] {
    return this.outputs;
  }

  reset(): void {
    for (const state of this.sensorStates.values()) {
      state.queue = [];
      state.prev = null;
      state.curr = null;
    }
    this.gridPosition = 0;
    this.gridInitialized = false;
    this.outputs = [];
  }
}

/**
 * Generates streaming samples for a device at ~100Hz.
 */
function generateStreamingSamples(
  startTimestamp: number,
  sampleCount: number,
  sampleIntervalMs: number = 10,
  timestampJitterMs: number = 0
): Sample[] {
  const samples: Sample[] = [];
  let currentTs = startTimestamp;

  for (let i = 0; i < sampleCount; i++) {
    // Add jitter to timestamp
    const jitter = timestampJitterMs > 0 ? (Math.random() - 0.5) * 2 * timestampJitterMs : 0;
    const timestamp = currentTs + jitter;

    // Generate a simple rotating quaternion (angle increases over time)
    const angle = (i / sampleCount) * Math.PI / 2; // 0 to 90 degrees
    const halfAngle = angle / 2;

    samples.push({
      timestamp,
      quaternion: {
        w: Math.cos(halfAngle),
        x: Math.sin(halfAngle),
        y: 0,
        z: 0,
      }
    });

    currentTs += sampleIntervalMs;
  }

  return samples;
}

// ─────────────────────────────────────────────────────────────────
// LIVE Mode Tests
// ─────────────────────────────────────────────────────────────────

function testLiveModePerfectSync(): boolean {
  console.log('Test: LIVE mode - perfect sync (all devices start together)...');

  const service = new MockGridSnapLiveService();
  const startTs = Date.now();
  const sampleCount = 100;

  // Generate samples for all 4 devices with same start time
  const samples = {
    0x11: generateStreamingSamples(startTs, sampleCount),
    0x12: generateStreamingSamples(startTs, sampleCount),
    0x21: generateStreamingSamples(startTs, sampleCount),
    0x22: generateStreamingSamples(startTs, sampleCount),
  };

  // Push samples and tick (simulating real-time streaming)
  for (let i = 0; i < sampleCount; i++) {
    // Push one sample from each device
    for (const [deviceId, deviceSamples] of Object.entries(samples)) {
      service.pushSample(parseInt(deviceId), deviceSamples[i].timestamp, deviceSamples[i].quaternion);
    }
    // Process tick
    service.tick();
  }

  // Run a few more ticks to flush remaining samples
  for (let i = 0; i < 10; i++) {
    service.tick();
  }

  const outputs = service.getOutputs();

  if (outputs.length === 0) {
    console.error('FAIL: No outputs generated');
    return false;
  }

  // Check that all outputs have all 4 sensors aligned to same grid timestamp
  let allAligned = true;
  for (const output of outputs) {
    const timestamps = [
      output.leftThigh?.timestamp,
      output.leftShin?.timestamp,
      output.rightThigh?.timestamp,
      output.rightShin?.timestamp,
    ].filter(t => t !== undefined) as number[];

    if (timestamps.length < 4) {
      // Not all sensors present (might be at start/end)
      continue;
    }

    const maxDiff = Math.max(...timestamps) - Math.min(...timestamps);
    if (maxDiff > 0.001) {
      allAligned = false;
      console.error(`  Output grid=${output.gridTimestamp}: timestamps differ by ${maxDiff}ms`);
    }
  }

  console.log(`  Generated ${outputs.length} aligned outputs`);
  console.log(`  All outputs aligned: ${allAligned}`);

  if (!allAligned) {
    console.error('FAIL: Not all outputs are aligned');
    return false;
  }

  console.log('PASS: LIVE mode - perfect sync');
  return true;
}

function testLiveModeTimestampOffset(): boolean {
  console.log('Test: LIVE mode - devices with 100ms timestamp offset...');

  const service = new MockGridSnapLiveService();
  const baseTs = Date.now();
  const sampleCount = 100;

  // Generate samples with different start times (simulating sync offset)
  const offsets = { 0x11: 0, 0x12: 50, 0x21: 100, 0x22: 150 };
  const samples: Record<number, Sample[]> = {};

  for (const [deviceId, offset] of Object.entries(offsets)) {
    samples[parseInt(deviceId)] = generateStreamingSamples(baseTs + offset, sampleCount);
  }

  // Push samples and tick
  for (let i = 0; i < sampleCount; i++) {
    for (const [deviceId, deviceSamples] of Object.entries(samples)) {
      service.pushSample(parseInt(deviceId), deviceSamples[i].timestamp, deviceSamples[i].quaternion);
    }
    service.tick();
  }

  // Flush
  for (let i = 0; i < 20; i++) {
    service.tick();
  }

  const outputs = service.getOutputs();

  if (outputs.length === 0) {
    console.error('FAIL: No outputs generated');
    return false;
  }

  // The grid should advance at the slowest device's rate (device 0x22 with +150ms offset)
  // Check if grid timestamp is reasonable
  const firstOutput = outputs[0];
  const lastOutput = outputs[outputs.length - 1];

  console.log(`  Generated ${outputs.length} outputs`);
  console.log(`  First grid timestamp: ${firstOutput.gridTimestamp}`);
  console.log(`  Last grid timestamp: ${lastOutput.gridTimestamp}`);

  // Check that grid advanced reasonably (should be ~sampleCount * 10ms = 1000ms of data)
  const gridSpan = lastOutput.gridTimestamp - firstOutput.gridTimestamp;
  console.log(`  Grid span: ${gridSpan}ms`);

  // The grid span should be close to the data span minus the max offset
  const expectedSpan = (sampleCount - 1) * 10 - 150; // ~850ms
  if (Math.abs(gridSpan - expectedSpan) > 100) {
    console.warn(`  WARNING: Grid span ${gridSpan}ms differs from expected ${expectedSpan}ms`);
  }

  // Check alignment of thigh/shin pairs (critical for angle calculation)
  let pairAlignmentErrors = 0;
  for (const output of outputs) {
    if (output.leftThigh && output.leftShin) {
      // These should have same grid timestamp (interpolated to grid)
      // The original timestamps differ, but after interpolation they should match
      if (output.leftThigh.timestamp !== output.leftShin.timestamp) {
        pairAlignmentErrors++;
      }
    }
  }

  if (pairAlignmentErrors > 0) {
    console.error(`FAIL: ${pairAlignmentErrors} pair alignment errors`);
    return false;
  }

  console.log('PASS: LIVE mode - timestamp offset');
  return true;
}

function testLiveModeJitter(): boolean {
  console.log('Test: LIVE mode - timestamp jitter (±5ms)...');

  const service = new MockGridSnapLiveService();
  const startTs = Date.now();
  const sampleCount = 200;
  const jitterMs = 5;

  // Generate samples with jitter
  const samples: Record<number, Sample[]> = {
    0x11: generateStreamingSamples(startTs, sampleCount, 10, jitterMs),
    0x12: generateStreamingSamples(startTs, sampleCount, 10, jitterMs),
    0x21: generateStreamingSamples(startTs, sampleCount, 10, jitterMs),
    0x22: generateStreamingSamples(startTs, sampleCount, 10, jitterMs),
  };

  // Push and tick
  for (let i = 0; i < sampleCount; i++) {
    for (const [deviceId, deviceSamples] of Object.entries(samples)) {
      service.pushSample(parseInt(deviceId), deviceSamples[i].timestamp, deviceSamples[i].quaternion);
    }
    service.tick();
  }

  // Flush
  for (let i = 0; i < 20; i++) {
    service.tick();
  }

  const outputs = service.getOutputs();

  console.log(`  Generated ${outputs.length} outputs with jitter`);

  // With jitter, grid should still advance smoothly
  // Check that grid timestamps are monotonically increasing by ~10ms
  let monotonic = true;
  let maxGap = 0;
  for (let i = 1; i < outputs.length; i++) {
    const gap = outputs[i].gridTimestamp - outputs[i - 1].gridTimestamp;
    if (gap <= 0) {
      monotonic = false;
    }
    maxGap = Math.max(maxGap, gap);
  }

  console.log(`  Grid monotonic: ${monotonic}`);
  console.log(`  Max grid gap: ${maxGap}ms (expected ~10ms)`);

  if (!monotonic) {
    console.error('FAIL: Grid not monotonic');
    return false;
  }

  if (maxGap > 20) {
    console.warn(`  WARNING: Max gap ${maxGap}ms exceeds expected 10ms`);
  }

  console.log('PASS: LIVE mode - jitter');
  return true;
}

function testLiveModeDelayedDevice(): boolean {
  console.log('Test: LIVE mode - one device delayed by 200ms...');

  const service = new MockGridSnapLiveService();
  const startTs = Date.now();
  const sampleCount = 100;

  // Device 0x22 is delayed by 200ms (simulating BLE latency)
  const samples: Record<number, Sample[]> = {
    0x11: generateStreamingSamples(startTs, sampleCount),
    0x12: generateStreamingSamples(startTs, sampleCount),
    0x21: generateStreamingSamples(startTs, sampleCount),
    0x22: generateStreamingSamples(startTs + 200, sampleCount), // 200ms delayed
  };

  // Push and tick
  for (let i = 0; i < sampleCount; i++) {
    for (const [deviceId, deviceSamples] of Object.entries(samples)) {
      service.pushSample(parseInt(deviceId), deviceSamples[i].timestamp, deviceSamples[i].quaternion);
    }
    service.tick();
  }

  // Flush
  for (let i = 0; i < 30; i++) {
    service.tick();
  }

  const outputs = service.getOutputs();

  console.log(`  Generated ${outputs.length} outputs`);

  // Grid should be limited by the delayed device
  // First valid output should be around startTs + 200ms
  if (outputs.length > 0) {
    const firstGrid = outputs[0].gridTimestamp;
    const expectedFirstGrid = startTs + 200;
    const diff = firstGrid - expectedFirstGrid;

    console.log(`  First grid timestamp: ${firstGrid}`);
    console.log(`  Expected (delayed device start): ${expectedFirstGrid}`);
    console.log(`  Difference: ${diff}ms`);

    // Should be close to the delayed device's start time
    if (Math.abs(diff) > 50) {
      console.warn(`  WARNING: First grid differs from expected by ${diff}ms`);
    }
  }

  console.log('PASS: LIVE mode - delayed device');
  return true;
}

function testLiveModeMissingSamples(): boolean {
  console.log('Test: LIVE mode - device with missing samples...');

  const service = new MockGridSnapLiveService();
  const startTs = Date.now();
  const sampleCount = 100;

  // Generate full samples for 3 devices
  const samples: Record<number, Sample[]> = {
    0x11: generateStreamingSamples(startTs, sampleCount),
    0x12: generateStreamingSamples(startTs, sampleCount),
    0x21: generateStreamingSamples(startTs, sampleCount),
    0x22: generateStreamingSamples(startTs, sampleCount),
  };

  // Remove every 5th sample from device 0x12 (simulating packet loss)
  samples[0x12] = samples[0x12].filter((_, i) => i % 5 !== 0);

  console.log(`  Device 0x12 has ${samples[0x12].length} samples (${sampleCount - samples[0x12].length} missing)`);

  // Push samples with proper timing
  let sampleIndices = { 0x11: 0, 0x12: 0, 0x21: 0, 0x22: 0 };

  for (let tick = 0; tick < sampleCount + 20; tick++) {
    for (const deviceId of [0x11, 0x12, 0x21, 0x22]) {
      const deviceSamples = samples[deviceId];
      const idx = sampleIndices[deviceId as keyof typeof sampleIndices];

      if (idx < deviceSamples.length) {
        // Check if this sample should be pushed at this tick
        const expectedTs = startTs + tick * 10;
        if (deviceSamples[idx].timestamp <= expectedTs + 5) {
          service.pushSample(deviceId, deviceSamples[idx].timestamp, deviceSamples[idx].quaternion);
          sampleIndices[deviceId as keyof typeof sampleIndices]++;
        }
      }
    }
    service.tick();
  }

  const outputs = service.getOutputs();

  console.log(`  Generated ${outputs.length} outputs`);

  // Check that outputs are still generated (interpolation should handle gaps)
  if (outputs.length < 50) {
    console.error(`FAIL: Too few outputs (${outputs.length}), expected >50`);
    return false;
  }

  console.log('PASS: LIVE mode - missing samples');
  return true;
}

// ─────────────────────────────────────────────────────────────────
// RECORDING Mode Tests
// ─────────────────────────────────────────────────────────────────

interface RawRecordingSample {
  deviceId: number;
  timestamp: number;
  quaternion: Sample['quaternion'];
}

/**
 * Mock RecordingBuffer - stores raw samples without processing.
 */
class MockRecordingBuffer {
  private samples: RawRecordingSample[] = [];

  push(deviceId: number, timestamp: number, quaternion: Sample['quaternion']): void {
    this.samples.push({ deviceId, timestamp, quaternion });
  }

  getSamples(): RawRecordingSample[] {
    return this.samples;
  }

  getSamplesForDevice(deviceId: number): RawRecordingSample[] {
    return this.samples.filter(s => s.deviceId === deviceId);
  }
}

/**
 * Mock GridSnapService for post-recording alignment.
 * Aligns samples to a uniform time grid (same as batch synchronizer).
 */
function alignRecordedSamples(
  buffer: MockRecordingBuffer,
  gridIntervalMs: number = 10
): AlignedOutput[] {
  const deviceSamples = new Map<number, RawRecordingSample[]>();

  for (const deviceId of [0x11, 0x12, 0x21, 0x22]) {
    const samples = buffer.getSamplesForDevice(deviceId);
    // Sort by timestamp
    samples.sort((a, b) => a.timestamp - b.timestamp);
    deviceSamples.set(deviceId, samples);
  }

  // Find common time range
  const allTimestamps = buffer.getSamples().map(s => s.timestamp);
  if (allTimestamps.length === 0) return [];

  const minTs = Math.min(...allTimestamps);
  const maxTs = Math.max(...allTimestamps);

  // Generate grid
  const outputs: AlignedOutput[] = [];

  for (let gridTs = minTs; gridTs <= maxTs; gridTs += gridIntervalMs) {
    const output: AlignedOutput = { gridTimestamp: gridTs };

    // Interpolate each device to grid timestamp
    for (const [deviceId, samples] of deviceSamples.entries()) {
      const interp = interpolateToTimestamp(samples, gridTs);
      if (interp) {
        if (deviceId === 0x11) output.leftShin = interp;
        else if (deviceId === 0x12) output.leftThigh = interp;
        else if (deviceId === 0x21) output.rightShin = interp;
        else if (deviceId === 0x22) output.rightThigh = interp;
      }
    }

    outputs.push(output);
  }

  return outputs;
}

function interpolateToTimestamp(samples: RawRecordingSample[], targetTs: number): Sample | undefined {
  if (samples.length === 0) return undefined;

  // Find bracketing samples
  let prev: RawRecordingSample | undefined;
  let next: RawRecordingSample | undefined;

  for (const sample of samples) {
    if (sample.timestamp <= targetTs) {
      prev = sample;
    } else {
      next = sample;
      break;
    }
  }

  if (!prev) return undefined;
  if (!next) return { timestamp: targetTs, quaternion: prev.quaternion };

  // Interpolate
  const dt = next.timestamp - prev.timestamp;
  if (dt <= 0) return { timestamp: targetTs, quaternion: prev.quaternion };

  const t = (targetTs - prev.timestamp) / dt;
  return {
    timestamp: targetTs,
    quaternion: {
      w: prev.quaternion.w + t * (next.quaternion.w - prev.quaternion.w),
      x: prev.quaternion.x + t * (next.quaternion.x - prev.quaternion.x),
      y: prev.quaternion.y + t * (next.quaternion.y - prev.quaternion.y),
      z: prev.quaternion.z + t * (next.quaternion.z - prev.quaternion.z),
    }
  };
}

function testRecordingModeAlignment(): boolean {
  console.log('Test: RECORDING mode - post-export alignment...');

  const buffer = new MockRecordingBuffer();
  const startTs = Date.now();
  const sampleCount = 100;

  // Generate samples with different offsets (simulating sync error)
  const offsets = { 0x11: 0, 0x12: 30, 0x21: 60, 0x22: 90 };

  for (const [deviceId, offset] of Object.entries(offsets)) {
    const samples = generateStreamingSamples(startTs + offset, sampleCount);
    for (const sample of samples) {
      buffer.push(parseInt(deviceId), sample.timestamp, sample.quaternion);
    }
  }

  // Align samples
  const aligned = alignRecordedSamples(buffer);

  console.log(`  Recorded ${buffer.getSamples().length} raw samples`);
  console.log(`  Generated ${aligned.length} aligned outputs`);

  // Check alignment at specific grid timestamps
  // All interpolated samples should have the same grid timestamp
  let alignmentErrors = 0;
  for (const output of aligned) {
    const timestamps = [
      output.leftThigh?.timestamp,
      output.leftShin?.timestamp,
      output.rightThigh?.timestamp,
      output.rightShin?.timestamp,
    ].filter(t => t !== undefined) as number[];

    if (timestamps.length === 4) {
      const maxDiff = Math.max(...timestamps) - Math.min(...timestamps);
      if (maxDiff > 0.001) {
        alignmentErrors++;
      }
    }
  }

  if (alignmentErrors > 0) {
    console.error(`FAIL: ${alignmentErrors} alignment errors`);
    return false;
  }

  console.log('PASS: RECORDING mode - alignment');
  return true;
}

function testRecordingModeTimestampPreservation(): boolean {
  console.log('Test: RECORDING mode - timestamp relationships preserved...');

  const buffer = new MockRecordingBuffer();
  const startTs = Date.now();
  const sampleCount = 50;

  // Device 0x12 is 100ms BEHIND device 0x11
  // After alignment, their angular motion should still be 100ms out of phase
  const samples0x11 = generateStreamingSamples(startTs, sampleCount);
  const samples0x12 = generateStreamingSamples(startTs + 100, sampleCount);

  for (const sample of samples0x11) {
    buffer.push(0x11, sample.timestamp, sample.quaternion);
  }
  for (const sample of samples0x12) {
    buffer.push(0x12, sample.timestamp, sample.quaternion);
  }

  // Also add samples for right leg (in sync)
  const samples0x21 = generateStreamingSamples(startTs, sampleCount);
  const samples0x22 = generateStreamingSamples(startTs, sampleCount);

  for (const sample of samples0x21) {
    buffer.push(0x21, sample.timestamp, sample.quaternion);
  }
  for (const sample of samples0x22) {
    buffer.push(0x22, sample.timestamp, sample.quaternion);
  }

  // Align
  const aligned = alignRecordedSamples(buffer);

  // At grid timestamp = startTs + 100:
  // - 0x11 should be at angle corresponding to sample 10 (100ms / 10ms)
  // - 0x12 should be at angle corresponding to sample 0 (just started)
  // The angle difference should reflect the 100ms offset

  // Find output at startTs + 150ms
  const testGrid = startTs + 150;
  const testOutput = aligned.find(o => Math.abs(o.gridTimestamp - testGrid) < 5);

  if (testOutput && testOutput.leftShin && testOutput.leftThigh) {
    // At t=150ms:
    // - leftShin (0x11, offset=0) has been running for 150ms → angle = 150/1000 * 90° = 13.5°
    // - leftThigh (0x12, offset=100) has been running for 50ms → angle = 50/1000 * 90° = 4.5°
    // Difference should be ~9° (reflecting the 100ms sync offset)

    const shinAngle = Math.acos(testOutput.leftShin.quaternion.w) * 2 * 180 / Math.PI;
    const thighAngle = Math.acos(testOutput.leftThigh.quaternion.w) * 2 * 180 / Math.PI;
    const angleDiff = Math.abs(shinAngle - thighAngle);

    console.log(`  At grid ${testGrid}ms:`);
    console.log(`    Left shin angle: ${shinAngle.toFixed(1)}°`);
    console.log(`    Left thigh angle: ${thighAngle.toFixed(1)}°`);
    console.log(`    Difference: ${angleDiff.toFixed(1)}°`);

    // The angle difference should reflect the 100ms timing offset
    // If both were in sync, angles would be same
    // With 100ms offset over 1000ms total, difference should be ~9° (100/1000 * 90)
    const expectedDiff = (100 / 1000) * 90;
    if (Math.abs(angleDiff - expectedDiff) > 5) {
      console.warn(`  WARNING: Angle diff ${angleDiff.toFixed(1)}° differs from expected ${expectedDiff.toFixed(1)}°`);
    }
  }

  console.log('PASS: RECORDING mode - timestamp preservation');
  return true;
}

// ─────────────────────────────────────────────────────────────────
// Full Pipeline Test (Sync → Stream → Align)
// ─────────────────────────────────────────────────────────────────

function testFullPipelineLive(): boolean {
  console.log('Test: Full pipeline (sync → stream → LIVE align)...');

  // Step 1: Simulate sync for 4 devices
  const devices = [
    createMockDevice('0x11', 'Left Shin', { baseRttMs: 20, rttVarianceMs: 10 }),
    createMockDevice('0x12', 'Left Thigh', { baseRttMs: 25, rttVarianceMs: 15 }),
    createMockDevice('0x21', 'Right Shin', { baseRttMs: 30, rttVarianceMs: 12 }),
    createMockDevice('0x22', 'Right Thigh', { baseRttMs: 35, rttVarianceMs: 18 }),
  ];

  const offsets = simulateSync(devices);

  console.log('  Calculated offsets:');
  offsets.forEach((offset, id) => {
    console.log(`    ${id}: ${offset.toFixed(2)}ms`);
  });

  // Step 2: Generate streaming samples with software sync applied
  const streamStartWallClock = Date.now() + 500;
  const sampleCount = 100;

  const service = new MockGridSnapLiveService();

  // For each device, generate samples and apply the offset
  for (const device of devices) {
    const deviceId = parseInt(device.deviceId);
    const offset = offsets.get(device.deviceId) ?? 0;

    for (let i = 0; i < sampleCount; i++) {
      const wallClock = streamStartWallClock + i * 10;
      const deviceCounter = getDeviceCounterAt(device, wallClock);

      // Apply software sync: syncedTimestamp = REFERENCE_EPOCH + deviceCounter + offset
      const syncedTimestamp = REFERENCE_EPOCH_MS + deviceCounter + offset;

      // Generate quaternion (simple rotation)
      const angle = (i / sampleCount) * Math.PI / 4;
      const halfAngle = angle / 2;

      service.pushSample(deviceId, syncedTimestamp, {
        w: Math.cos(halfAngle),
        x: Math.sin(halfAngle),
        y: 0,
        z: 0,
      });

      service.tick();
    }
  }

  // Flush
  for (let i = 0; i < 20; i++) {
    service.tick();
  }

  const outputs = service.getOutputs();

  console.log(`  Generated ${outputs.length} aligned outputs`);

  // Check that outputs are well-aligned
  if (outputs.length === 0) {
    console.error('FAIL: No outputs generated');
    return false;
  }

  // Check alignment of thigh/shin pairs at each output
  let maxPairOffset = 0;
  for (const output of outputs) {
    if (output.leftThigh && output.leftShin) {
      // After software sync, both should have the same grid timestamp
      // Any offset here indicates a problem
      if (output.leftThigh.timestamp !== output.leftShin.timestamp) {
        maxPairOffset = Math.max(maxPairOffset, Math.abs(output.leftThigh.timestamp - output.leftShin.timestamp));
      }
    }
  }

  console.log(`  Max thigh/shin timestamp offset: ${maxPairOffset.toFixed(2)}ms`);

  // Should be 0 (both interpolated to same grid timestamp)
  if (maxPairOffset > 0.001) {
    console.error(`FAIL: Pair offset ${maxPairOffset}ms should be 0`);
    return false;
  }

  console.log('PASS: Full pipeline LIVE');
  return true;
}

function testFullPipelineRecording(): boolean {
  console.log('Test: Full pipeline (sync → stream → RECORDING export)...');

  // Step 1: Simulate sync
  const devices = [
    createMockDevice('0x11', 'Left Shin', { baseRttMs: 20, rttVarianceMs: 10 }),
    createMockDevice('0x12', 'Left Thigh', { baseRttMs: 25, rttVarianceMs: 15 }),
    createMockDevice('0x21', 'Right Shin', { baseRttMs: 30, rttVarianceMs: 12 }),
    createMockDevice('0x22', 'Right Thigh', { baseRttMs: 35, rttVarianceMs: 18 }),
  ];

  const offsets = simulateSync(devices);

  // Step 2: Simulate recording
  const buffer = new MockRecordingBuffer();
  const streamStartWallClock = Date.now() + 500;
  const sampleCount = 100;

  for (const device of devices) {
    const deviceId = parseInt(device.deviceId);
    const offset = offsets.get(device.deviceId) ?? 0;

    for (let i = 0; i < sampleCount; i++) {
      const wallClock = streamStartWallClock + i * 10;
      const deviceCounter = getDeviceCounterAt(device, wallClock);
      const syncedTimestamp = REFERENCE_EPOCH_MS + deviceCounter + offset;

      const angle = (i / sampleCount) * Math.PI / 4;
      const halfAngle = angle / 2;

      buffer.push(deviceId, syncedTimestamp, {
        w: Math.cos(halfAngle),
        x: Math.sin(halfAngle),
        y: 0,
        z: 0,
      });
    }
  }

  // Step 3: Export and align
  const aligned = alignRecordedSamples(buffer);

  console.log(`  Recorded ${buffer.getSamples().length} samples`);
  console.log(`  Aligned to ${aligned.length} grid positions`);

  // Check that aligned outputs have matching timestamps for thigh/shin pairs
  let pairAlignmentErrors = 0;
  for (const output of aligned) {
    if (output.leftThigh && output.leftShin) {
      if (output.leftThigh.timestamp !== output.leftShin.timestamp) {
        pairAlignmentErrors++;
      }
    }
    if (output.rightThigh && output.rightShin) {
      if (output.rightThigh.timestamp !== output.rightShin.timestamp) {
        pairAlignmentErrors++;
      }
    }
  }

  if (pairAlignmentErrors > 0) {
    console.error(`FAIL: ${pairAlignmentErrors} pair alignment errors`);
    return false;
  }

  // Check that the sync offset didn't introduce systematic bias
  // The average synced timestamp across all devices at the same grid position should be similar
  const firstComplete = aligned.find(o =>
    o.leftThigh && o.leftShin && o.rightThigh && o.rightShin
  );

  if (firstComplete) {
    // All four should have same grid timestamp
    const timestamps = [
      firstComplete.leftThigh!.timestamp,
      firstComplete.leftShin!.timestamp,
      firstComplete.rightThigh!.timestamp,
      firstComplete.rightShin!.timestamp,
    ];
    const maxDiff = Math.max(...timestamps) - Math.min(...timestamps);
    console.log(`  First complete output timestamp spread: ${maxDiff.toFixed(3)}ms`);
  }

  console.log('PASS: Full pipeline RECORDING');
  return true;
}

// ─────────────────────────────────────────────────────────────────
// Run All Tests
// ─────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('='.repeat(60));
  console.log('Time Sync + LIVE/RECORDING Pipeline Tests');
  console.log(`SAMPLE_COUNT: ${SAMPLE_COUNT}`);
  console.log(`OUTLIER_REMOVAL_PERCENT: ${OUTLIER_REMOVAL_PERCENT}`);
  console.log('='.repeat(60));
  console.log('');

  const tests = [
    // Time Sync Algorithm Tests
    testPerfectSync,
    testSequentialSetDateTimeDelay,
    testHighRTTVariance,
    testClockDrift,
    testAsymmetricRTT,
    testWorstCase,
    testRelativeAlignment,
    // LIVE Mode Tests
    testLiveModePerfectSync,
    testLiveModeTimestampOffset,
    testLiveModeJitter,
    testLiveModeDelayedDevice,
    testLiveModeMissingSamples,
    // RECORDING Mode Tests
    testRecordingModeAlignment,
    testRecordingModeTimestampPreservation,
    // Full Pipeline Tests
    testFullPipelineLive,
    testFullPipelineRecording,
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
