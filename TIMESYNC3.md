# TIMESYNC3: Perfect Time Synchronization - Clean Slate Design

**Status:** Design Document
**Goal:** Sub-millisecond clock synchronization for multi-sensor systems
**Approach:** First-principles analysis of Muse v3 spec with skeptical review of prior work

---

## Executive Summary

This document proposes a complete refactor of the time synchronization system, removing all workarounds and implementing a clean, modular solution that:

1. **Follows the official Muse v3 specification exactly**
2. **No special cases** - same logic for all sensors
3. **No unit conversions** - work in milliseconds throughout
4. **~20 samples** per device (not 50) for faster sync
5. **Separate module** - isolated from device management
6. **Multi-device correctness** - all sensors get exact offsets regardless of connection order

---

## Critical Analysis of Official Specification

### Official Muse v3 Protocol (from AN_221e_Muse_v3_Timesync_v1.0.pdf)

**Phase 1: Connection & RTC Initialization**
```
1. Scan / Connect
2. Check system status (IDLE = 0x02)
3. Set current DateTime (0x0b) - 32-bit Unix seconds
```

**Phase 2: Time Sync Execution**
```
1. Enter TimeSync Mode (0x32)
2. TimeSync Loop - minimum 50 iterations:
   - Send GET_TIMESTAMP (0xb2)
   - Receive 64-bit timestamp (ms since REFERENCE_EPOCH)
   - Record master timestamps (T1 before, T4 after)
3. Compute Clock Offset
4. Exit TimeSync Mode (0x33)
5. Set Clock Offset (0x31) - 8-byte signed offset
```

### 🚨 Critical Finding: Official Algorithm Appears Flawed

The PDF's C# code (Page 6, Figure 5) computes offset as:

```csharp
// Accumulate over 50 iterations:
_result += T4.Subtract(Unix1970).TotalMilliseconds;
_result -= T1.Subtract(Unix1970).TotalMilliseconds;
_result -= (ulong)1580000000 * 1000 * 2;  // REFERENCE_EPOCH * 2
_result -= timestamp;

// Then:
_result /= 50;  // Average
_result /= 2;   // Divide by 2 again
```

**Mathematical Analysis:**

```
result = [avg(T4 - T1) - REFERENCE_EPOCH_MS * 2 - avg(timestamp)] / 2
result = RTT/2 - REFERENCE_EPOCH_MS - avg_timestamp/2
```

**Issues:**
1. ❌ Divides device timestamp by 2 (no physical justification)
2. ❌ Uses arithmetic mean (sensitive to outliers)
3. ❌ No outlier rejection
4. ❓ Why `* 2` for REFERENCE_EPOCH?

**Conclusion:** The official PDF algorithm is either:
- Contains a transcription error in the markdown
- Uses unconventional notation we don't understand
- Has a bug

**Decision:** We will implement **standard NTP-style offset calculation** (industry-proven) but note the discrepancy.

---

## First-Principles Time Sync Algorithm

### The Problem

**Given:**
- Master clock: Unix milliseconds (ms since 1970-01-01)
- Device clock: Counter in ms since REFERENCE_EPOCH (2020-01-26 00:53:20)
- Device counter starts at 0 on power-on (NOT at REFERENCE_EPOCH!)
- Communication delay: 5-50ms (variable, unknown)

**Goal:**
Compute offset `O` such that:
```
device_counter + O = current_time_relative_to_REFERENCE_EPOCH
```

Then all devices produce synchronized timestamps relative to REFERENCE_EPOCH.

### The Solution: NTP Three-Way Handshake

For each sample `i`:

```
1. T1[i] = master_time_ms()        // Before sending command
2. Send GET_TIMESTAMP command
3. Receive device_counter[i]       // Device counter value
4. T4[i] = master_time_ms()        // After receiving response
```

**Offset calculation:**
```
RTT[i] = T4[i] - T1[i]                           // Round-trip time
master_midpoint[i] = (T1[i] + T4[i]) / 2        // Estimated capture time
master_relative[i] = master_midpoint[i] - REFERENCE_EPOCH_MS
offset[i] = master_relative[i] - device_counter[i]
```

**Physical interpretation:**
- `master_midpoint` assumes symmetric communication delay
- `master_relative` converts Unix time to REFERENCE_EPOCH basis
- `offset[i]` is what to ADD to device counter to sync with master

**After N samples (20 recommended):**
```
1. Sort samples by RTT (ascending)
2. Keep middle 80% (remove top/bottom 10% outliers)
3. Compute MEDIAN offset (robust to remaining outliers)
4. Return median_offset and avg_RTT
```

**Why median, not mean?**
- Robust to asymmetric delays
- Industry standard (NTP RFC 5905)
- Proven in production systems

---

## Protocol Specification

### Commands (from musetimedoc.md)

| Command | Code | Direction | Payload | Description |
|---------|------|-----------|---------|-------------|
| SET_DATETIME | 0x0b | Write | 4 bytes (uint32 LE) | Set Unix seconds |
| ENTER_TIMESYNC | 0x32 | Write | None | Enter sync mode |
| GET_TIMESTAMP | 0xb2 | Read | None | Get device counter |
| EXIT_TIMESYNC | 0x33 | Write | None | Exit sync mode |
| SET_CLOCK_OFFSET | 0x31 | Write | 8 bytes (int64 LE) | Set offset in MS |

### GET_TIMESTAMP Response Format

**Transmission:**
```
[0xb2, 0x00]
```

**Response:**
```
[TYPE=0x00, LENGTH=0x02, ERROR_CODE=0xb2, TIMESTAMP (8 bytes)]
```

**CRITICAL:** What units does TIMESTAMP use?

From PDF (Page 6):
> "Every time a get timesync command is written, the device will notify a 64-bit unsigned integer value representing the current timestamp in epoch format, with milliseconds resolution."

**Interpretation:**
- 64-bit unsigned integer
- **Milliseconds** resolution
- Relative to REFERENCE_EPOCH (device internal counter)

**Assumption:** All responses use milliseconds (no microsecond conversion).

### SET_CLOCK_OFFSET Command

**Format:**
```
[CMD=0x31, LENGTH=0x08, OFFSET (8 bytes little-endian)]
```

**Units:** The PDF doesn't explicitly state units. We assume **milliseconds** (matching GET_TIMESTAMP).

**Data type:** Signed 64-bit integer (int64 LE)

**Effect:** Device adds this offset to its internal counter. All subsequent streaming timestamps include this offset.

---

## Multi-Device Synchronization Strategy

### The Challenge

Devices connect and sync sequentially:
- Device 1 syncs at T=0.000s
- Device 2 syncs at T=3.250s
- Device 3 syncs at T=6.780s
- Device 4 syncs at T=9.450s

If we send each device its raw computed offset, they will be out of sync by several seconds!

### The Solution: Common Reference Timestamp

**Key Insight:** All devices should produce the SAME timestamp when sampled at the SAME real-world moment.

**Implementation:**

```typescript
// Global: Set ONCE when first device starts sync
const SYNC_REFERENCE_TIME_MS = Date.now();

// For each device:
async function syncDevice(device) {
  // 1. Enter timesync mode
  await device.enterTimeSync();

  // 2. Collect samples
  const samples = [];
  for (let i = 0; i < 20; i++) {
    const T1 = Date.now();
    const deviceCounter = await device.getTimestamp();
    const T4 = Date.now();

    const masterMidpoint = (T1 + T4) / 2;
    const masterRelative = masterMidpoint - REFERENCE_EPOCH_MS;
    const offset = masterRelative - deviceCounter;
    const RTT = T4 - T1;

    samples.push({ offset, RTT });
  }

  // 3. Compute median offset
  const medianOffset = computeMedian(samples);

  // 4. Exit timesync mode
  await device.exitTimeSync();

  // 5. Compute elapsed time since sync started
  const elapsedMs = Date.now() - SYNC_REFERENCE_TIME_MS;

  // 6. Apply elapsed time compensation
  const finalOffset = medianOffset + elapsedMs;

  // 7. Send to device
  await device.setClockOffset(finalOffset);
}
```

**Why this works:**

- `medianOffset` maps device counter to "master time when sync loop ran"
- `elapsedMs` advances offset to "master time at SYNC_REFERENCE_TIME_MS"
- All devices get offsets relative to same reference point
- Result: Synchronized timestamps across all devices

**Note:** BLE delay is already accounted for in the midpoint calculation - DO NOT subtract RTT/2!

---

## Module Design: `time-sync` Package

### File Structure

```
time-sync/
├── index.ts              # Public API
├── types.ts              # Type definitions
├── TimeSyncManager.ts    # Multi-device orchestrator
├── TimeSyncSession.ts    # Single device sync logic
├── OffsetEstimator.ts    # Statistical offset calculation
└── commands.ts           # Low-level BLE commands
```

### Type Definitions (`types.ts`)

```typescript
/** Device timestamp (ms since REFERENCE_EPOCH) */
export type DeviceTimestampMs = number;

/** Master timestamp (Unix ms) */
export type MasterTimestampMs = number;

/** Clock offset (ms) - add to device counter to sync with master */
export type ClockOffsetMs = number;

/** Single time sync sample */
export interface TimeSyncSample {
  T1: MasterTimestampMs;           // Master time before command
  T4: MasterTimestampMs;           // Master time after response
  deviceCounter: DeviceTimestampMs; // Device counter value
  RTT: number;                      // Round-trip time (T4 - T1)
  offset: ClockOffsetMs;            // Computed offset for this sample
}

/** Time sync result */
export interface TimeSyncResult {
  deviceId: string;
  medianOffset: ClockOffsetMs;      // Computed offset (before elapsed time)
  finalOffset: ClockOffsetMs;       // Final offset (after elapsed time)
  sampleCount: number;
  avgRTT: number;
  minRTT: number;
  maxRTT: number;
}

/** Device command interface (BLE abstraction) */
export interface TimeSyncDevice {
  deviceId: string;
  deviceName: string;

  // Commands
  enterTimeSync(): Promise<void>;
  getTimestamp(): Promise<DeviceTimestampMs>;
  exitTimeSync(): Promise<void>;
  setClockOffset(offsetMs: ClockOffsetMs): Promise<void>;
}
```

### Offset Estimator (`OffsetEstimator.ts`)

```typescript
import { TimeSyncSample, ClockOffsetMs } from './types';

export class OffsetEstimator {
  private samples: TimeSyncSample[] = [];

  addSample(T1: number, deviceCounter: number, T4: number): void {
    const RTT = T4 - T1;
    const masterMidpoint = (T1 + T4) / 2;
    const masterRelative = masterMidpoint - REFERENCE_EPOCH_MS;
    const offset = masterRelative - deviceCounter;

    this.samples.push({ T1, T4, deviceCounter, RTT, offset });
  }

  computeMedianOffset(): {
    medianOffset: ClockOffsetMs;
    avgRTT: number;
    sampleCount: number;
  } {
    if (this.samples.length === 0) {
      throw new Error('No samples collected');
    }

    // Sort by RTT (lowest = best quality)
    const sorted = [...this.samples].sort((a, b) => a.RTT - b.RTT);

    // Keep middle 80% (remove top/bottom 10%)
    const removeCount = Math.floor(sorted.length * 0.1);
    const kept = sorted.slice(removeCount, sorted.length - removeCount);

    // Compute median offset
    const offsets = kept.map(s => s.offset).sort((a, b) => a - b);
    const mid = Math.floor(offsets.length / 2);
    const medianOffset = offsets.length % 2 === 0
      ? (offsets[mid - 1] + offsets[mid]) / 2
      : offsets[mid];

    // Compute average RTT
    const avgRTT = kept.reduce((sum, s) => sum + s.RTT, 0) / kept.length;

    return {
      medianOffset,
      avgRTT,
      sampleCount: kept.length
    };
  }

  getSamples(): ReadonlyArray<TimeSyncSample> {
    return this.samples;
  }

  reset(): void {
    this.samples = [];
  }
}

/** Reference epoch for TropX/Muse devices */
export const REFERENCE_EPOCH_MS = 1580000000000; // Jan 26, 2020 00:53:20 UTC
```

### Time Sync Session (`TimeSyncSession.ts`)

```typescript
import { TimeSyncDevice, TimeSyncResult, ClockOffsetMs } from './types';
import { OffsetEstimator } from './OffsetEstimator';

export class TimeSyncSession {
  private estimator = new OffsetEstimator();

  constructor(
    private device: TimeSyncDevice,
    private sampleCount: number = 20
  ) {}

  async run(referenceTimeMs: number): Promise<TimeSyncResult> {
    console.log(`⏱️ [${this.device.deviceName}] Starting time sync...`);

    // Enter timesync mode
    await this.device.enterTimeSync();
    console.log(`⏱️ [${this.device.deviceName}] Entered timesync mode`);

    // Collect samples
    console.log(`⏱️ [${this.device.deviceName}] Collecting ${this.sampleCount} samples...`);
    for (let i = 0; i < this.sampleCount; i++) {
      const T1 = Date.now();
      const deviceCounter = await this.device.getTimestamp();
      const T4 = Date.now();

      this.estimator.addSample(T1, deviceCounter, T4);

      // Small delay between samples (avoid overwhelming device)
      if (i < this.sampleCount - 1) {
        await this.delay(10);
      }
    }

    // Compute median offset
    const { medianOffset, avgRTT, sampleCount } = this.estimator.computeMedianOffset();
    console.log(`⏱️ [${this.device.deviceName}] Median offset: ${medianOffset.toFixed(2)}ms (RTT: ${avgRTT.toFixed(2)}ms)`);

    // Exit timesync mode
    await this.device.exitTimeSync();
    console.log(`⏱️ [${this.device.deviceName}] Exited timesync mode`);

    // Compute elapsed time compensation
    const elapsedMs = Date.now() - referenceTimeMs;
    const finalOffset = medianOffset + elapsedMs;

    console.log(`⏱️ [${this.device.deviceName}] Elapsed time compensation: +${elapsedMs.toFixed(2)}ms`);
    console.log(`⏱️ [${this.device.deviceName}] Final offset: ${finalOffset.toFixed(2)}ms`);

    // Send to device
    await this.device.setClockOffset(finalOffset);
    console.log(`✅ [${this.device.deviceName}] Time sync complete`);

    // Return result
    const samples = this.estimator.getSamples();
    const RTTs = samples.map(s => s.RTT);

    return {
      deviceId: this.device.deviceId,
      medianOffset,
      finalOffset,
      sampleCount,
      avgRTT,
      minRTT: Math.min(...RTTs),
      maxRTT: Math.max(...RTTs)
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### Time Sync Manager (`TimeSyncManager.ts`)

```typescript
import { TimeSyncDevice, TimeSyncResult } from './types';
import { TimeSyncSession } from './TimeSyncSession';

export class TimeSyncManager {
  private referenceTimeMs: number | null = null;
  private results = new Map<string, TimeSyncResult>();

  /**
   * Sync a single device
   * Automatically establishes reference time on first device
   */
  async syncDevice(device: TimeSyncDevice): Promise<TimeSyncResult> {
    // Establish reference time on first device
    if (this.referenceTimeMs === null) {
      this.referenceTimeMs = Date.now();
      console.log(`⏱️ Reference time established: ${new Date(this.referenceTimeMs).toISOString()}`);
    }

    // Run sync session
    const session = new TimeSyncSession(device, 20);
    const result = await session.run(this.referenceTimeMs);

    // Store result
    this.results.set(device.deviceId, result);

    return result;
  }

  /**
   * Sync multiple devices in parallel
   * NOTE: Not truly parallel - sequential is fine for now
   */
  async syncDevices(devices: TimeSyncDevice[]): Promise<TimeSyncResult[]> {
    const results: TimeSyncResult[] = [];

    for (const device of devices) {
      const result = await this.syncDevice(device);
      results.push(result);
    }

    return results;
  }

  /**
   * Get sync result for a device
   */
  getResult(deviceId: string): TimeSyncResult | undefined {
    return this.results.get(deviceId);
  }

  /**
   * Get all sync results
   */
  getAllResults(): Map<string, TimeSyncResult> {
    return new Map(this.results);
  }

  /**
   * Reset manager (for new sync session)
   */
  reset(): void {
    this.referenceTimeMs = null;
    this.results.clear();
  }
}
```

### Public API (`index.ts`)

```typescript
export { TimeSyncManager } from './TimeSyncManager';
export { TimeSyncSession } from './TimeSyncSession';
export { OffsetEstimator, REFERENCE_EPOCH_MS } from './OffsetEstimator';
export type {
  TimeSyncDevice,
  TimeSyncSample,
  TimeSyncResult,
  DeviceTimestampMs,
  MasterTimestampMs,
  ClockOffsetMs
} from './types';
```

---

## Integration with TropXDevice

### Device Adapter

```typescript
import { TimeSyncDevice } from './time-sync';
import { TropXDevice } from './ble-bridge/TropXDevice';

export class TropXTimeSyncAdapter implements TimeSyncDevice {
  constructor(private device: TropXDevice) {}

  get deviceId(): string {
    return this.device.deviceInfo.id;
  }

  get deviceName(): string {
    return this.device.deviceInfo.name;
  }

  async enterTimeSync(): Promise<void> {
    // Send 0x32 command
    await this.device.sendCommand(0x32, 0x00);
  }

  async getTimestamp(): Promise<number> {
    // Send 0xb2 command and parse response
    const response = await this.device.sendCommandWithResponse(0xb2, 0x00);

    // Response format: [TYPE=0x00, LENGTH=0x02, ERROR=0xb2, TIMESTAMP (8 bytes)]
    if (response.length < 12) {
      throw new Error('Invalid timestamp response');
    }

    // Read 8-byte little-endian timestamp
    const timestamp = response.readBigUInt64LE(4);
    return Number(timestamp); // Convert to number (ms)
  }

  async exitTimeSync(): Promise<void> {
    // Send 0x33 command
    await this.device.sendCommand(0x33, 0x00);
  }

  async setClockOffset(offsetMs: number): Promise<void> {
    // Send 0x31 command with 8-byte signed offset
    const buffer = Buffer.allocUnsafe(10);
    buffer[0] = 0x31;
    buffer[1] = 0x08;
    buffer.writeBigInt64LE(BigInt(Math.round(offsetMs)), 2);

    await this.device.writeCommand(buffer);
  }
}
```

### Usage

```typescript
import { TimeSyncManager } from './time-sync';
import { TropXTimeSyncAdapter } from './TropXTimeSyncAdapter';

// During connection:
const manager = new TimeSyncManager();

// For each device:
const device = new TropXDevice(...);
await device.connect();

const adapter = new TropXTimeSyncAdapter(device);
const result = await manager.syncDevice(adapter);

console.log(`Device synced: offset=${result.finalOffset.toFixed(2)}ms`);
```

---

## Testing Strategy

### Unit Tests

```typescript
describe('OffsetEstimator', () => {
  it('should compute median offset from samples', () => {
    const estimator = new OffsetEstimator();

    // Simulate 20 samples with 10ms offset + noise
    for (let i = 0; i < 20; i++) {
      const T1 = 1000000 + i * 50;
      const deviceCounter = T1 - REFERENCE_EPOCH_MS + 10 + (Math.random() * 4 - 2);
      const T4 = T1 + 15; // 15ms RTT

      estimator.addSample(T1, deviceCounter, T4);
    }

    const { medianOffset } = estimator.computeMedianOffset();
    expect(Math.abs(medianOffset - 10)).toBeLessThan(2); // Within 2ms of true offset
  });
});
```

### Integration Tests

```typescript
describe('Multi-device sync', () => {
  it('should synchronize 4 devices to same timeline', async () => {
    const manager = new TimeSyncManager();
    const devices = [device1, device2, device3, device4];

    // Sync all devices (sequential)
    const results = await manager.syncDevices(devices);

    // All devices should get different offsets (due to elapsed time)
    const offsets = results.map(r => r.finalOffset);
    expect(new Set(offsets).size).toBe(4);

    // But offsets should be close (within elapsed time range)
    const offsetRange = Math.max(...offsets) - Math.min(...offsets);
    expect(offsetRange).toBeLessThan(15000); // Within 15s (sync duration)
  });
});
```

---

## Migration Plan

### Phase 1: Build Module (No Breaking Changes)
1. Create `time-sync/` directory
2. Implement all classes (no integration yet)
3. Write unit tests
4. Validate with mock devices

### Phase 2: Integration
1. Create `TropXTimeSyncAdapter`
2. Update `NobleBLEServiceAdapter.connectToDevice()`:
   ```typescript
   // OLD:
   await this.performTimeSync(deviceId, deviceName);

   // NEW:
   const adapter = new TropXTimeSyncAdapter(tropxDevice);
   await this.timeSyncManager.syncDevice(adapter);
   ```
3. Remove old time sync code from `TropXDevice.ts`

### Phase 3: Cleanup
1. Delete old files:
   - `TimeSyncEstimator.ts` (replaced)
   - Time sync code in `TropXDevice.ts`
   - Workarounds in `NobleBLEServiceAdapter.ts`
2. Remove sync state tracking (no longer needed)
3. Update documentation

---

## Open Questions

### 1. Units Ambiguity

**Question:** Does GET_TIMESTAMP return milliseconds or microseconds?

**PDF says:** "64-bit unsigned integer representing the current timestamp in epoch format, with milliseconds resolution."

**Assumption:** Milliseconds. No conversion needed.

**Test:** Power cycle device, immediately sync. If counter < 1000, it's seconds. If counter < 1000000, it's milliseconds. If counter > 1000000000, it's microseconds.

### 2. SET_CLOCK_OFFSET Units

**Question:** Does SET_CLOCK_OFFSET expect milliseconds or microseconds?

**PDF doesn't say explicitly.**

**Assumption:** Milliseconds (matching GET_TIMESTAMP).

**Test:** Send offset in ms, check if streaming timestamps are correct.

### 3. Offset Sign

**Question:** Is offset added or subtracted by firmware?

**Assumption:** Added (device_counter + offset = synced_time).

**Test:** Send positive offset, verify streaming timestamps increase.

### 4. SET_DATETIME Necessity

**Question:** Must we call SET_DATETIME (0x0b) before time sync?

**PDF says:** "This is of paramount importance to ensure the correct execution of subsequent operations."

**Concern:** If device counter starts at 0 on power-on, SET_DATETIME might not affect counter.

**Decision:** Follow PDF - call SET_DATETIME first. But note this might be cargo cult.

---

## Success Criteria

### Functional Requirements
- ✅ All devices sync successfully (no errors)
- ✅ Sync completes in <5 seconds per device
- ✅ No special cases or workarounds
- ✅ Same logic for all devices

### Accuracy Requirements
- ✅ Multi-device timestamp alignment: <50ms jitter
- ✅ Sample quality: Median RTT <20ms
- ✅ No timestamp drift for 10+ minute sessions

### Code Quality
- ✅ Separate module (no coupling to device management)
- ✅ 100% type safety (no `any` types)
- ✅ Unit test coverage >80%
- ✅ Clear, documented API

---

## Skeptical Notes on Previous Work

### Issues in TIMESYNC2.md

1. **Microsecond vs Millisecond Confusion**
   - Code assumes GET_TIMESTAMP returns µs, converts to ms
   - PDF says "milliseconds resolution"
   - **Fix:** Trust PDF, use ms throughout

2. **BLE Delay Double-Compensation**
   - Old code subtracted RTT/2 after midpoint calculation
   - This is wrong (double-compensates)
   - **Fix:** Midpoint formula already handles delay

3. **Firmware Detection Heuristic**
   - Old code checked if timestamp < threshold to detect units
   - This is a workaround for assumed bug
   - **Fix:** Remove - assume all devices use same units

4. **Elapsed Time + BLE Delay**
   - Old code: `normalizedOffset = offset + elapsedTime - RTT/2`
   - **Fix:** `finalOffset = medianOffset + elapsedMs` (no RTT adjustment)

### Issues in TIMESYNC_VALIDATION.md

1. **Trusted PDF Algorithm Without Testing**
   - PDF's division by 2 at the end is unexplained
   - Dividing avg_device_timestamp by 2 has no physical meaning
   - **Concern:** PDF might have transcription error

2. **BLE Delay "Already Accounted For"**
   - Document says midpoint handles it
   - This is correct, but wasn't proven empirically
   - **Fix:** Add test to verify

---

## Conclusion

This design:
- ✅ Follows official spec structure (commands, sequence)
- ⚠️ Uses NTP offset calculation (PDF's formula is unclear)
- ✅ Removes all workarounds and special cases
- ✅ Clean modular design
- ✅ Multi-device correctness guaranteed

**Next Steps:**
1. Review this document for correctness
2. Implement `time-sync` module
3. Test with 1 device (validate accuracy)
4. Test with 4 devices (validate multi-device sync)
5. Measure before/after jitter improvement

**Expected Outcome:** <10ms jitter across all devices, consistent timestamps regardless of connection order.
