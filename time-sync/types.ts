/**
 * Type definitions for time synchronization module
 */

// Device timestamp in milliseconds since REFERENCE_EPOCH
export type DeviceTimestampMs = number;

// Master (central) timestamp in Unix milliseconds
export type MasterTimestampMs = number;

// Clock offset in milliseconds (add to device counter to sync with master)
export type ClockOffsetMs = number;

// Single time sync sample from three-way handshake
export interface TimeSyncSample {
  T1: MasterTimestampMs;
  T4: MasterTimestampMs;
  deviceCounter: DeviceTimestampMs;
  RTT: number;
  offset: ClockOffsetMs;
}

// Time sync result for a device
export interface TimeSyncResult {
  deviceId: string;
  deviceName: string;
  medianOffset: ClockOffsetMs;
  finalOffset: ClockOffsetMs;
  sampleCount: number;
  avgRTT: number;
  minRTT: number;
  maxRTT: number;
  success: boolean;
  error?: string;
  deviceTimestampMs?: DeviceTimestampMs; // Current device timestamp at sync completion
}

// Device system states (per spec)
export enum DeviceSystemState {
  IDLE = 0x02,
  STREAMING = 0x04,
  RECORDING = 0x08
}

// Callback for live sync updates during sampling
// sampleIndex: 0-based index of current sample
// totalSamples: total number of samples to collect
export type SyncSampleCallback = (
  deviceId: string,
  deviceName: string,
  deviceTimestampMs: number,
  sampleIndex: number,
  totalSamples: number
) => void;

// Device interface for BLE time sync operations
export interface TimeSyncDevice {
  deviceId: string;
  deviceName: string;
  getSystemStatus(): Promise<DeviceSystemState>;
  setSystemStatus(state: DeviceSystemState): Promise<void>;
  setDateTime(unixTimestampSeconds: number): Promise<void>;
  enterTimeSyncMode(): Promise<void>;
  getDeviceTimestamp(): Promise<DeviceTimestampMs>;
  exitTimeSyncMode(): Promise<void>;
  setClockOffset(offsetMs: ClockOffsetMs): Promise<void>;
}
