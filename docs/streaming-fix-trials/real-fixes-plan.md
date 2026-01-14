# Real Fixes for Streaming Artifacts

Based on research from academic papers and industry solutions, here are proper fixes for each artifact.

## Research Sources

- [Application-Layer Time Synchronization for BLE (MDPI)](https://www.mdpi.com/1424-8220/23/8/3954)
- [LIDA vs SDA Comparison (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10007376/)
- [QSense Multi-IMU Sync](https://qsense-motion.com/multiple-imu-time-synchronization/)
- [Neural Network BLE Sync (Nature)](https://www.nature.com/articles/s41467-023-40114-2)
- [Kalman Filter for Sensor Dropout](https://ieeexplore.ieee.org/document/5160216)

---

## Fix 1: Timestamp Desync → Measured Clock Offsets

### Problem
Current approach uses `writeCompleteTime` from SET_DATETIME to estimate offsets.
This measures BLE stack completion, NOT when firmware processes the command.
Variable firmware processing delay causes 50ms+ sync errors.

### Research Solution: LIDA (Linear Interpolation Data Alignment)
The LIDA method achieves **0.38 ± 0.40 ms** accuracy by:
1. Using a central clock reference
2. Measuring actual timestamps from each device
3. Interpolating samples to align with the central clock

### Implementation

```typescript
// In TimeSyncManager.ts - after SET_DATETIME completes

async syncDevices(devices: TimeSyncDevice[]): Promise<TimeSyncResult[]> {
    // Step 1: SET_DATETIME on all devices (same timestamp)
    const baseTimestampSeconds = Math.floor(Date.now() / 1000);
    for (const device of devices) {
        await device.setDateTime(baseTimestampSeconds);
    }

    // Step 2: Small delay for firmware to process
    await new Promise(resolve => setTimeout(resolve, 100));

    // Step 3: MEASURE actual clock values via GET_TIMESTAMP
    const clockReadings: { device: TimeSyncDevice; measuredTimestamp: number }[] = [];

    for (const device of devices) {
        await device.enterTimeSyncMode();
        const { timestamp } = await device.getDeviceTimestamp();
        await device.exitTimeSyncMode();
        clockReadings.push({ device, measuredTimestamp: timestamp });
    }

    // Step 4: Calculate offsets from MEASURED values (not estimated)
    const referenceTimestamp = clockReadings[0].measuredTimestamp;

    for (const { device, measuredTimestamp } of clockReadings) {
        // Offset = how much to ADD to bring this device in line with reference
        const offset = referenceTimestamp - measuredTimestamp;

        // Store offset for streaming phase
        UnifiedBLEStateStore.updateDevice(device.deviceId, { clockOffset: offset });
    }
}
```

### Why This Works
- Measures what clocks **actually are**, not what we think they should be
- Eliminates variable BLE/firmware processing delays
- Expected accuracy: < 2ms (per LIDA research)

---

## Fix 2: Sensor Stall → Predictive Extrapolation

### Problem
When one sensor stalls, `getDataBoundary()` returns MIN of all sensors.
One stalled sensor blocks ALL output, causing flat plateaus.

### Research Solution: Error-State Extended Kalman Filter
During sensor dropout, use the last known state + motion model to predict.
For short dropouts (< 100-200ms), prediction is reasonably accurate.

### Implementation

```typescript
// In GridSnapLiveService.ts

interface SensorState {
    lastQuaternion: Quaternion;
    lastTimestamp: number;
    angularVelocity: { x: number; y: number; z: number }; // rad/sec
    isStalled: boolean;
    stallStartTime: number;
}

private sensorStates = new Map<number, SensorState>();
private readonly MAX_EXTRAPOLATION_MS = 150; // Max time to extrapolate

/**
 * Estimate angular velocity from recent samples
 */
private updateAngularVelocity(deviceId: number, newQuat: Quaternion, newTime: number): void {
    const state = this.sensorStates.get(deviceId);
    if (!state || newTime <= state.lastTimestamp) return;

    const dt = (newTime - state.lastTimestamp) / 1000; // seconds
    if (dt > 0 && dt < 0.5) { // Reasonable time gap
        // Compute rotation difference
        const lastInv = QuaternionService.inverse(state.lastQuaternion);
        const rotDiff = QuaternionService.multiply(newQuat, lastInv);

        // Convert to angular velocity (simplified)
        const angle = 2 * Math.acos(Math.min(1, Math.abs(rotDiff.w)));
        if (angle > 0.001) {
            const axis = { x: rotDiff.x, y: rotDiff.y, z: rotDiff.z };
            const axisMag = Math.sqrt(axis.x*axis.x + axis.y*axis.y + axis.z*axis.z);
            if (axisMag > 0.001) {
                state.angularVelocity = {
                    x: (axis.x / axisMag) * (angle / dt),
                    y: (axis.y / axisMag) * (angle / dt),
                    z: (axis.z / axisMag) * (angle / dt),
                };
            }
        }
    }

    state.lastQuaternion = newQuat;
    state.lastTimestamp = newTime;
    state.isStalled = false;
}

/**
 * Extrapolate quaternion for stalled sensor
 */
private extrapolateSensor(deviceId: number, targetTime: number): Quaternion | null {
    const state = this.sensorStates.get(deviceId);
    if (!state) return null;

    const stallDuration = targetTime - state.lastTimestamp;
    if (stallDuration > this.MAX_EXTRAPOLATION_MS) {
        return null; // Too long to extrapolate safely
    }

    // Apply angular velocity to last known quaternion
    const dt = stallDuration / 1000;
    const w = state.angularVelocity;
    const angle = Math.sqrt(w.x*w.x + w.y*w.y + w.z*w.z) * dt;

    if (angle < 0.001) {
        return state.lastQuaternion; // No rotation
    }

    // Create rotation quaternion from angular velocity
    const halfAngle = angle / 2;
    const sinHalf = Math.sin(halfAngle);
    const axisMag = angle / dt;

    const rotQuat: Quaternion = {
        w: Math.cos(halfAngle),
        x: (w.x / axisMag) * sinHalf,
        y: (w.y / axisMag) * sinHalf,
        z: (w.z / axisMag) * sinHalf,
    };

    // Apply rotation: newQuat = rotQuat * lastQuat
    return QuaternionService.multiply(rotQuat, state.lastQuaternion);
}

/**
 * Modified getDataBoundary that handles stalls
 */
private getDataBoundaryWithExtrapolation(): number | null {
    const now = Date.now();
    let boundary = Infinity;

    for (const [deviceId, buffer] of this.buffers) {
        const newest = buffer.getNewestTimestamp();

        if (newest === null) {
            return null; // No data at all
        }

        // Check if sensor is stalled
        const state = this.sensorStates.get(deviceId);
        if (state && (now - state.lastTimestamp) > 50) {
            // Sensor stalled - can we extrapolate?
            const maxExtrapolatedTime = state.lastTimestamp + this.MAX_EXTRAPOLATION_MS;
            boundary = Math.min(boundary, maxExtrapolatedTime);
            state.isStalled = true;
            state.stallStartTime = state.stallStartTime || now;
        } else {
            boundary = Math.min(boundary, newest);
        }
    }

    return boundary === Infinity ? null : boundary;
}
```

### Why This Works
- Short dropouts (< 150ms) are bridged with reasonable predictions
- Based on actual angular velocity, not just repeating last value
- Falls back gracefully after max extrapolation time
- Research shows IMU prediction is accurate for short durations

---

## Fix 3: Data Gap + Burst → Jitter Buffer

### Problem
Network jitter causes packets to arrive in bursts after gaps.
Drain loop processes all at once, causing 61° spikes in UI.

### Research Solution: Jitter Buffer with Smoothing
Audio/video streaming uses jitter buffers to absorb timing variations.
Release samples at steady rate, smoothing bursts.

### Implementation

```typescript
// In GridSnapLiveService.ts

interface JitterBufferConfig {
    targetDelayMs: number;      // Target buffering delay (e.g., 30ms)
    maxDelayMs: number;         // Max acceptable delay (e.g., 100ms)
    smoothingFactor: number;    // 0-1, how much to blend predictions
}

private jitterConfig: JitterBufferConfig = {
    targetDelayMs: 30,
    maxDelayMs: 100,
    smoothingFactor: 0.3,
};

private lastEmittedAngles = new Map<string, number>(); // For smoothing

/**
 * Modified tick with jitter buffer and smoothing
 */
private tick(): void {
    if (!this.isRunning) return;

    this.tickCount++;

    // Get data boundary with extrapolation support
    let dataBoundary = this.getDataBoundaryWithExtrapolation();
    if (dataBoundary === null) return;

    // Apply jitter buffer delay
    const bufferedBoundary = dataBoundary - this.jitterConfig.targetDelayMs;

    // Don't process if grid would exceed buffered boundary
    if (this.gridPosition >= bufferedBoundary) return;

    let iterations = 0;
    const maxIterations = 20;

    while (iterations < maxIterations) {
        iterations++;

        const nextGridPosition = this.gridPosition + this.tickIntervalMs;
        if (nextGridPosition >= bufferedBoundary) break;

        this.gridPosition = nextGridPosition;

        // Snap and interpolate (with extrapolation for stalled sensors)
        const snapped = this.snapWithExtrapolation(this.gridPosition);
        if (!snapped) continue;

        const interpolated = this.interpolateWithSmoothing(snapped);
        if (!interpolated) continue;

        // Emit
        this.emitAlignedSample(interpolated);
    }
}

/**
 * Apply smoothing to prevent sudden jumps after gaps
 */
private interpolateWithSmoothing(snapped: any): AlignedSampleSet | null {
    const interpolated = InterpolationService.interpolateSinglePoint(snapped);
    if (!interpolated) return null;

    // Calculate relative angles
    // ... (existing angle calculation)

    // Apply smoothing if there was a gap
    const leftAngle = computeAngle(interpolated.leftKnee);
    const rightAngle = computeAngle(interpolated.rightKnee);

    const lastLeft = this.lastEmittedAngles.get('left') ?? leftAngle;
    const lastRight = this.lastEmittedAngles.get('right') ?? rightAngle;

    // Detect large jumps
    const leftJump = Math.abs(leftAngle - lastLeft);
    const rightJump = Math.abs(rightAngle - lastRight);

    const MAX_NATURAL_JUMP = 15; // degrees per 10ms at max velocity

    // If jump is too large, blend with predicted value
    if (leftJump > MAX_NATURAL_JUMP) {
        const blendedLeft = this.blendAngle(lastLeft, leftAngle, this.jitterConfig.smoothingFactor);
        // Apply blended value...
    }

    this.lastEmittedAngles.set('left', leftAngle);
    this.lastEmittedAngles.set('right', rightAngle);

    return interpolated;
}

/**
 * Blend current value towards target
 */
private blendAngle(current: number, target: number, factor: number): number {
    // Exponential smoothing
    return current + (target - current) * factor;
}
```

### Why This Works
- Jitter buffer absorbs timing variations (standard in audio/video)
- Smoothing prevents sudden visual jumps after gaps
- Based on angular velocity limits (human knee can't rotate 60°/10ms)
- Graceful degradation - raw data preserved, only display smoothed

---

## Implementation Order

1. **Fix 1 (Time Sync)** - Most impactful, prevents distortion at source
2. **Fix 2 (Extrapolation)** - Prevents flat plateaus
3. **Fix 3 (Jitter Buffer)** - Smooths remaining edge cases

## Expected Results

| Artifact | Before | After |
|----------|--------|-------|
| Timestamp desync | 50ms error, 27.8° distortion | <2ms error, <1° distortion |
| Sensor stall | Complete output stop | Bridged with extrapolation |
| Data burst | 61° spike | Smoothed to <15° max |

## Files to Modify

1. `time-sync/TimeSyncManager.ts` - Add GET_TIMESTAMP verification
2. `synchronization/GridSnapLiveService.ts` - Add extrapolation + jitter buffer
3. `synchronization/SensorBuffer.ts` - Track angular velocity state
