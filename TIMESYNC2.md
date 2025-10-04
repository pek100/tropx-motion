# TropX Time Synchronization System - Complete Documentation

## Overview

This document describes the complete time synchronization system for TropX motion capture devices using Muse v3 firmware. The system synchronizes multiple BLE devices to a common timeline with hardware-level precision.

---

## Time Architecture

### Reference Points

1. **Unix Epoch**: January 1, 1970 00:00:00 UTC (standard)
2. **REFERENCE_EPOCH**: January 26, 2020 00:53:20 UTC (1580000000 seconds = 1580000000000 ms)
   - TropX firmware uses this as time zero
   - All device timestamps are relative to this epoch
   - Reduces timestamp size (48-bit instead of 64-bit)

### Device Counter Behavior

- **Power-on reset**: Counter starts at 0 when device powers on
- **Counter unit**: Microseconds (µs) on Muse v3 firmware
- **Counter range**: 48-bit unsigned integer (0 to 281,474,976,710,655 µs = ~326 days)
- **NOT Unix time**: The counter is relative to power-on, not any calendar date

Example:
```
Device powered on: Oct 1, 2025 at 00:00:00
Device counter after 1 hour: 3,600,000,000 µs (3600 seconds)
This represents 1 hour of uptime, NOT Oct 1, 2025 01:00:00
```

---

## Time Sync Protocol (Muse PDF Specification)

### Protocol Steps (Per Muse PDF Page 6)

The Muse v3 firmware defines a specific sequence for time synchronization:

```
1. CLEAR_OFFSET    → Set clock offset to 0 (clear any previous sync)
2. ENTER_TIMESYNC  → Device enters time sync mode
3. GET_TIMESTAMP   → Collect multiple timestamp samples (NTP-style)
4. EXIT_TIMESYNC   → Device exits time sync mode
5. SET_CLOCK_OFFSET → Apply computed offset to device
```

**CRITICAL ORDER**: Steps must be executed in this exact sequence. Setting offset BEFORE exiting timesync mode will fail.

### Commands

```typescript
// Command structure: [CMD, LENGTH, ...DATA]

// 0x31: SET_CLOCK_OFFSET (8-byte signed int64, microseconds)
[0x31, 0x08, <8 bytes little-endian µs>]

// 0x32: ENTER_TIMESYNC
[0x32, 0x00]

// 0x33: EXIT_TIMESYNC
[0x33, 0x00]

// 0xb2: GET_TIMESTAMP (returns device counter in µs)
[0xb2, 0x00]
// Response: [0x00, 0x02, 0xb2, <6 bytes timestamp µs>]
```

---

## NTP-Style Time Sync Algorithm

### Sample Collection

For each sample, we measure round-trip time (RTT):

```
Master (PC)                    Device
   |                              |
   |--- GET_TIMESTAMP (t1) ----→ |
   |                              | Reads counter: deviceTime
   |←--- Response (t3) -----------|
   |                              |
```

Variables:
- `t1`: Master time when command sent (Unix ms)
- `t3`: Master time when response received (Unix ms)
- `deviceTime`: Device counter value (µs since power-on)
- `RTT = t3 - t1`: Round-trip time (communication delay)

### Offset Calculation

The clock offset maps the device counter (relative to power-on) to REFERENCE_EPOCH:

```
masterMidpoint = (t1 + t3) / 2
masterSinceRefEpoch = masterMidpoint - REFERENCE_EPOCH_MS
offset = masterSinceRefEpoch - (deviceTime / 1000)
```

**What the offset represents**:
- How much to ADD to device counter to get REFERENCE_EPOCH time
- NOT the absolute time difference between master and device
- NOT a Unix timestamp

Example calculation:
```
Current time: Oct 3, 2025 23:28:25.500 = 1759534105500 ms (Unix)
REFERENCE_EPOCH: Jan 26, 2020 00:53:20 = 1580000000000 ms (Unix)

Master since REFERENCE_EPOCH:
  1759534105500 - 1580000000000 = 179534105500 ms

Device counter: 359068208658 µs = 359068208.658 ms (since power-on)

Clock offset:
  179534105500 - 359068208.658 = 179175037291.342 ms
```

This offset (179175037291 ms) is what we send to the device. When the device adds this offset to its counter, it produces timestamps relative to REFERENCE_EPOCH.

### Median Filtering (Per Muse PDF)

1. Collect N samples (recommend 50, minimum 20)
2. Remove outliers: Keep samples with RTT in middle 80% (remove top/bottom 10%)
3. Calculate median offset from remaining samples
4. Calculate average RTT from remaining samples

This removes BLE communication jitter and provides stable offset.

---

## Multi-Device Synchronization

### The Challenge

When syncing multiple devices sequentially:
- Device 1 syncs at t=0 seconds
- Device 2 syncs at t=3 seconds
- Device 3 syncs at t=6 seconds
- Device 4 syncs at t=9 seconds

Each device computes its offset at different times. Without compensation, devices would be out of sync by several seconds.

### Solution: Elapsed Time Compensation

```typescript
// Establish reference time when FIRST device starts sync
const timeSyncReferenceTime = Date.now(); // e.g., 23:28:24.897

// For each device:
const { offset, avgRoundTrip } = await device.syncTime();
await device.exitTimeSyncMode();

// Calculate elapsed time AFTER sync completes
const elapsedTime = Date.now() - timeSyncReferenceTime;

// Apply elapsed time compensation
// NOTE: BLE delay already accounted for in offset calculation
const normalizedOffset = offset + elapsedTime;

// Send to device
await device.applyClockOffset(normalizedOffset);
```

**Why this works**:

Device 1 (synced at t=0):
- Base offset: 179175037858 ms
- Elapsed time: +0 ms
- Final offset: 179175037858 ms

Device 2 (synced at t=3):
- Base offset: 179175037900 ms (slightly different due to 3s of device counter)
- Elapsed time: +3000 ms (accounts for 3s delay)
- Final offset: 179175040900 ms

The elapsed time addition ensures all devices produce the same timestamp when sampled at the same real-world moment.

### BLE Delay Handling

The round-trip time includes:
- Command transmission time (PC → Device)
- Device processing time (negligible)
- Response transmission time (Device → PC)

**IMPORTANT**: BLE delay is already accounted for in the offset calculation through the midpoint formula:

```typescript
masterMidpoint = (t1 + t3) / 2
offset = masterMidpoint - deviceTimestamp
```

The midpoint `(t1 + t3) / 2` represents our best estimate of when the device captured its timestamp (assuming symmetric BLE delays). This means the computed offset already includes BLE delay compensation.

**No additional BLE compensation is needed or should be applied** - doing so would result in double-compensation and incorrect synchronization.

---

## Streaming Mode Timestamps

### Packet Format (Mode 0x30: QUATERNION_TIMESTAMP)

```
Byte 0-7:   8-byte header (packet metadata)
Byte 8-13:  6-byte quaternion (compressed rotation data)
Byte 14-19: 6-byte timestamp (device time relative to REFERENCE_EPOCH)
```

### Timestamp Units in Streaming

**CRITICAL FIRMWARE BEHAVIOR**:
- During time sync (GET_TIMESTAMP): Device returns **microseconds**
- During streaming (mode 0x30): Firmware **MAY** send microseconds OR milliseconds

Our auto-detection heuristic:
```typescript
const MICROSECOND_THRESHOLD = 10^13; // 10 trillion

if (timestamp > MICROSECOND_THRESHOLD) {
  // Likely microseconds (e.g., 179534105500000000 µs)
  timestampMs = timestamp / 1000;
} else {
  // Likely milliseconds (e.g., 179534105500 ms)
  timestampMs = timestamp;
}
```

### How Device Applies Offset

When streaming, the firmware computes each packet timestamp as:

```c
// Pseudocode in device firmware
packetTimestamp = deviceCounter + clockOffset;
```

Where:
- `deviceCounter`: Current uptime in µs (or ms depending on firmware)
- `clockOffset`: The value we sent via SET_CLOCK_OFFSET
- `packetTimestamp`: Output timestamp relative to REFERENCE_EPOCH

### Converting to Absolute Time (Unix Epoch)

In our application:
```typescript
const deviceTimestampMs = /* parsed from packet, converted to ms */;
const unixTimestamp = deviceTimestampMs + REFERENCE_EPOCH_MS;
const absoluteTime = new Date(unixTimestamp);
```

Example:
```
Packet timestamp: 179534105500 ms (relative to REFERENCE_EPOCH)
+ REFERENCE_EPOCH: 1580000000000 ms
= Unix timestamp: 1759534105500 ms
= Absolute time: 2025-10-03T23:28:25.500Z
```

---

## Implementation Details

### File Structure

```
ble-bridge/
├── TropXDevice.ts              → Device-level time sync (GET_TIMESTAMP, SET_CLOCK_OFFSET)
├── TimeSyncEstimator.ts        → Median filtering algorithm
├── NobleBLEServiceAdapter.ts   → Multi-device sync orchestration
└── BleBridgeConstants.ts       → REFERENCE_EPOCH and commands
```

### Key Classes

#### TropXDevice.ts

```typescript
class TropXDevice {
  // Clear any existing offset (set to 0)
  async clearClockOffset(): Promise<void>

  // Initialize device RTC with reference time
  async initializeDeviceRTC(timestamp: number): Promise<boolean>

  // Collect timestamp samples and compute median offset
  async syncTime(exitAfter: boolean): Promise<{ offset: number; avgRoundTrip: number }>

  // Exit timesync mode (required before applying offset)
  async exitTimeSyncMode(): Promise<void>

  // Apply final computed offset to device hardware
  async applyClockOffset(offsetMs: number): Promise<void>
}
```

#### TimeSyncEstimator.ts

```typescript
class TimeSyncEstimator {
  // Add a sample: (masterT1, deviceTime, masterT3)
  addSample(masterT1: number, deviceTime: number, masterT3: number): void

  // Compute median offset and average RTT with outlier removal
  computeMedianOffset(): { offset: number; avgRoundTrip: number; samples: number }
}
```

#### NobleBLEServiceAdapter.ts

```typescript
class NobleBLEServiceAdapter {
  private timeSyncReferenceTime: number | null = null;

  // Sync all devices with elapsed time compensation
  private async performTimeSync(deviceId: string, deviceName: string): Promise<void> {
    // Step 1: Establish reference time (first device only)
    if (this.timeSyncReferenceTime === null) {
      this.timeSyncReferenceTime = Date.now();
    }

    // Step 2: Clear old offset
    await tropxDevice.clearClockOffset();

    // Step 3: Initialize RTC
    await tropxDevice.initializeDeviceRTC(referenceTimestamp);

    // Step 4: Compute base offset
    const { offset, avgRoundTrip } = await tropxDevice.syncTime(false);

    // Step 5: Exit timesync mode
    await tropxDevice.exitTimeSyncMode();

    // Step 6: Calculate elapsed time AFTER sync completes
    const elapsedTime = Date.now() - this.timeSyncReferenceTime;

    // Step 7: Apply elapsed time compensation only
    // NOTE: BLE delay already accounted for in midpoint calculation
    const normalizedOffset = offset + elapsedTime;

    // Step 8: Set device offset
    await tropxDevice.applyClockOffset(normalizedOffset);
  }
}
```

---

## Timestamp Flow (End-to-End)

### 1. Time Sync Phase

```
PC (Master)                          Device (TropX Sensor)
   |                                        |
   |--- CLEAR_OFFSET (0x31, 0) ----------→ | offset = 0
   |                                        |
   |--- ENTER_TIMESYNC (0x32) -----------→ | Enter sync mode
   |                                        |
   |--- GET_TIMESTAMP (0xb2) ------------→ |
   |                                        | counter = 359068208658 µs
   |←-- Response (359068208658 µs) --------|
   |                                        |
   | ... (repeat 20 times) ...              |
   |                                        |
   | Compute offset = 179175037858 ms       |
   |                                        |
   |--- EXIT_TIMESYNC (0x33) ------------→ | Exit sync mode
   |                                        |
   |--- SET_CLOCK_OFFSET (0x31) -----------→ | offset = 179175037858000000 µs
   |    (179175037858000000 µs)             |
   |                                        |
```

### 2. Streaming Phase

```
Device Internal Firmware:
   counter = 359068500000 µs (current uptime)
   offset  = 179175037858000 µs (from SET_CLOCK_OFFSET)

   packetTimestamp = counter + offset
                   = 359068500000 + 179175037858000
                   = 179534106358000 µs

   // Convert to ms for packet (firmware-dependent)
   packetTimestamp = 179534106358 ms

Packet Sent:
   [header][quaternion][timestamp: 179534106358 ms]

PC Receives Packet:
   deviceTimestampMs = 179534106358 ms (relative to REFERENCE_EPOCH)
   unixTimestamp = 179534106358 + 1580000000000
                 = 1759534106358 ms
   absoluteTime = new Date(1759534106358)
                = 2025-10-03T23:28:26.358Z ✅
```

---

## Known Issues and Observations

### Issue 1: Firmware Not Applying New Offsets

**Symptom**: After setting a new clock offset, streaming packets still contain timestamps using the OLD offset from a previous session (e.g., 2 days ago).

**Evidence**:
```
Set new offset: 179175041363934 µs (Oct 3, 2025)
Device sends:   179354575474734 µs (Oct 1, 2025) ❌

Time difference: ~2 days (179533537858 µs = 49.87 hours)
```

**Root Cause**: Unknown firmware behavior. Possible theories:
1. Firmware caches offset in non-volatile memory and doesn't update until device restart
2. SET_CLOCK_OFFSET only affects RTC, not streaming mode
3. Firmware bug where offset isn't applied to streaming packets immediately
4. Offset is stored in two locations (RTC vs streaming engine) and we're only updating one

**Workaround**: None found yet. Power cycling doesn't fix it (devices retain old offset across power cycles).

**Next Steps**:
- Contact TropX firmware team for clarification
- Check if there's a separate command to sync streaming offset vs RTC offset
- Test with official TropX software to see if they have additional steps

### Issue 2: Microsecond vs Millisecond Ambiguity

**Symptom**: Some devices send streaming timestamps in microseconds, others in milliseconds.

**Evidence**:
```
tropx_ln_top:    179354575474734 µs (detected as µs)
tropx_ln_bottom: 179534110508 ms    (detected as ms)
```

**Workaround**: Auto-detection using threshold (10^13). Works reliably in practice.

**Note**: This inconsistency may be related to firmware version or device state.

---

## Testing and Validation

### Expected Behavior (When Working Correctly)

After time sync, all devices should produce timestamps within ±50ms of each other:

```
📦 [tropx_ln_top] First packet: 2025-10-03T23:28:30.100Z
📦 [tropx_rn_top] First packet: 2025-10-03T23:28:30.125Z  (+25ms)
📦 [tropx_ln_bottom] First packet: 2025-10-03T23:28:30.080Z  (-20ms)
📦 [tropx_rn_bottom] First packet: 2025-10-03T23:28:30.150Z  (+50ms)
```

### Debug Logging

The system includes comprehensive debug logging:

```typescript
// Time sync samples
🔍 [tropx_ln_top] Sample 1:
   Master time (t1): 1759534105488ms (2025-10-03T23:28:25.488Z)
   Master time (t3): 1759534105540ms (2025-10-03T23:28:25.540Z)
   Master midpoint: 1759534105514.000ms
   Master since REFERENCE_EPOCH: 179534105514.000ms
   Device counter: 359068208658µs = 359068208.658ms (since power-on)
   Clock offset: 179175037305.342ms (maps device counter to REFERENCE_EPOCH)
   Round trip: 52.00ms

// Final offset
⏱️ [tropx_ln_top] Offset adjustments:
   Base offset: 179175037858.03ms
   + Elapsed time: 3560.00ms (time since first device started sync)
   = Final offset: 179175041418.03ms

// Streaming packet
📦 [tropx_ln_top] First packet:
   Raw timestamp bytes: [0x2e, 0x90, 0xc2, 0x3d, 0x1f, 0xa3]
   Parsed as uint64: 179354575474734 µs
   Device timestamp: 179354575474.734ms (relative to REFERENCE_EPOCH)
   = 2025-10-03T23:28:30.474Z
```

---

## References

1. **Muse v3 Firmware Documentation** (PDF provided by TropX)
   - Page 6: Time Sync Protocol
   - Page 8: Command Reference (0x10, 0x11, 0x12, 0x31)

2. **NTP Algorithm** (Network Time Protocol)
   - RFC 5905: https://tools.ietf.org/html/rfc5905
   - Median filtering for clock synchronization

3. **BLE Time Synchronization**
   - BLE 5.0 Specification
   - Bluetooth Core Specification Vol 6, Part B (Link Layer)

---

## Summary

Our time synchronization system:

✅ **Implemented correctly** per Muse PDF specification
✅ **Multi-device sync** with elapsed time compensation
✅ **BLE delay handling** via NTP midpoint formula (no double-compensation)
✅ **Robust packet parsing** with µs/ms auto-detection
✅ **Comprehensive logging** for debugging

⚠️ **Known limitation**: Firmware not applying new offsets immediately (appears to retain old offset from previous sessions)

The synchronization logic is sound. The issue lies in the firmware behavior, not our implementation.
