# Multi-Device Time Synchronization

## Overview

This document describes how TropX Motion synchronizes timestamps across multiple BLE motion sensor devices to achieve sub-10ms alignment. This enables accurate multi-device motion capture where timestamps from different sensors can be meaningfully compared.

## The Problem

When `SET_DATETIME` is sent sequentially to multiple BLE devices, each device receives the command at a different wall-clock time due to BLE latency (~180ms per device). If all devices receive the same timestamp value but at different times, their internal clocks will be offset by the cumulative BLE delay.

### Example with 4 devices:

```
Device 1: SET_DATETIME at T+0ms     → clock set to X
Device 2: SET_DATETIME at T+180ms   → clock set to X (but 180ms behind wall time)
Device 3: SET_DATETIME at T+360ms   → clock set to X (but 360ms behind)
Device 4: SET_DATETIME at T+540ms   → clock set to X (but 540ms behind)
```

Without correction, streaming timestamps would be offset by 0ms, 180ms, 360ms, 540ms respectively.

## The Solution: writeCompleteTime-based Software Offset

We measure the exact wall-clock time when each `SET_DATETIME` command completes (via BLE `writeCompleteTime` callback from the adapter). The offset for each device is simply:

```
offset = writeCompleteTime - firstWriteCompleteTime
```

This offset is stored and applied during streaming to align all timestamps.

### Why This Works

The key insight is that we use the **SAME timing measurement** that caused the clock offset to correct for it. There's no timing mismatch between measurement and application because they're derived from the same BLE write event.

## Implementation

### Sync Flow

```
1. Ensure all devices in IDLE state (parallel)
2. Send SET_DATETIME sequentially to each device
   - All receive the same Unix timestamp (seconds)
   - Record writeCompleteTime for each
3. Calculate offset = writeCompleteTime - firstWriteCompleteTime
4. Store offset in UnifiedBLEStateStore.clockOffset
5. During streaming, add offset to each incoming timestamp
```

### Key Files

| File | Purpose |
|------|---------|
| `time-sync/TimeSyncManager.ts` | Orchestrates sync, calculates offsets |
| `time-sync/adapters/TropXTimeSyncAdapter.ts` | Returns writeCompleteTime from setDateTime |
| `ble-bridge/TropXDevice.ts` | Applies offset in handleDataNotification |
| `ble-management/UnifiedBLEStateStore.ts` | Stores clockOffset per device |

### Code Example

```typescript
// TimeSyncManager.syncDevices()

const setDateTimeTimings: { device: TimeSyncDevice; writeCompleteTime: number }[] = [];
let firstWriteCompleteTime: number | null = null;

for (const device of devices) {
  const result = await device.setDateTime(baseTimestampSeconds);
  const writeCompleteTime = result?.writeCompleteTime ?? performance.now();

  if (firstWriteCompleteTime === null) {
    firstWriteCompleteTime = writeCompleteTime;
  }

  setDateTimeTimings.push({ device, writeCompleteTime });
}

// Calculate offsets
for (const { device, writeCompleteTime } of setDateTimeTimings) {
  const offset = writeCompleteTime - firstWriteCompleteTime;
  // offset is positive for devices set later
  // Store and apply during streaming
}
```

## Approaches That Were Tried and Rejected

### 1. Two-Pass Measurement

**Approach**: Measure BLE timing in pass 1, then set clocks in pass 2 using measured delays.

**Problem**: BLE timing varies between passes. Pass 1 might measure delays of 0ms, 180ms, 360ms, 540ms, but pass 2 might have delays of 0ms, 190ms, 350ms, 600ms. This mismatch causes ~50ms errors.

### 2. GET_TIMESTAMP Verification

**Approach**: After SET_DATETIME, use GET_TIMESTAMP to read actual device clocks and calculate offsets from measured values.

**Problem**: GET_TIMESTAMP returns values in a different format/range than streaming timestamps. The values showed ~2x the expected magnitude and didn't correlate with streaming data, making offset calculation meaningless.

### 3. Cumulative Timestamp Compensation

**Approach**: Instead of sending the same timestamp to all devices, adjust the timestamp value for later devices to compensate for BLE delay.

**Problem**: SET_DATETIME uses Unix timestamp in seconds (32-bit), so we can only compensate in 1-second increments. Sub-second delays cannot be encoded in the timestamp itself.

### 4. Hardware SET_CLOCK_OFFSET

**Approach**: Use the device's built-in SET_CLOCK_OFFSET command to apply corrections in firmware.

**Problem**: Firmware implementation was unreliable across different firmware versions. Software correction is more predictable and debuggable.

## Expected Accuracy

With this approach, first packet timestamps across 4 devices typically align within **5-10ms**.

Some residual error (10-50ms on occasional devices) may occur due to:
- Variable BLE processing time in device firmware
- BLE stack scheduling variations
- Device firmware clock jitter

## Debugging

### Logs to Check

During sync:
```
⏱️ [device] SET_DATETIME completed at Xms
⏱️ [device] SET_DATETIME at Xms, offset: +Yms
```

During streaming (first packet):
```
⏱️ [device] First packet:
   Raw sensor timestamp: Xms (since REFERENCE_EPOCH)
   Clock offset applied: +Yms
   Final timestamp: Zms
```

### Debug Files

- `C:\Users\<user>\Documents\TropX\timesync_debug.json` - Sync session data
- `C:\Users\<user>\Documents\TropX\timestamp_debug.json` - First 200 streaming samples

### Verifying Alignment

Compare first packet timestamps across devices after offset is applied. They should all be within ~10ms of each other.

## Constants

```typescript
// Reference epoch for device timestamps
REFERENCE_EPOCH_MS = 1580000000000  // Jan 26, 2020

// SET_DATETIME uses 32-bit Unix timestamp (seconds)
// Streaming timestamps are ms since REFERENCE_EPOCH
```

## Related Documentation

- `docs/Muse/AN_221e_Muse_v3_Timesync_v1.0-1.pdf` - Muse v3 time sync specification
- `docs/Muse/muse_v3_protocol_v2.15.pdf` - Protocol specification
