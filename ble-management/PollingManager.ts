/**
 * Polling Manager
 * Manages periodic polling of device state with automatic blocking during critical operations
 */

import {
  DeviceID,
  DeviceState,
  GlobalState,
  BLE_CONFIG,
  POLLING_ALLOWED_STATES,
  POLLING_BLOCKED_GLOBAL_STATES,
} from './types';
import { UnifiedBLEStateStore } from './UnifiedBLEStateStore';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type PollType = 'battery' | 'rssi' | 'firmwareState';

export interface PollResult {
  deviceId: DeviceID;
  type: PollType;
  value: number | null;
  timestamp: number;
  error?: string;
}

export type PollFunction = (deviceId: DeviceID) => Promise<number | null>;

// ─────────────────────────────────────────────────────────────────────────────
// Polling Manager Implementation
// ─────────────────────────────────────────────────────────────────────────────

class PollingManagerImpl {
  // Timers for each poll type
  private timers: Map<PollType, NodeJS.Timeout> = new Map();

  // Poll functions (injected by BLE layer)
  private pollFunctions: Map<PollType, PollFunction> = new Map();

  // State
  private isBlocked = false;
  private blockReason: string | null = null;
  private isRunning = false;

  // ───────────────────────────────────────────────────────────────────────────
  // Configuration
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Register a poll function for a specific type
   */
  registerPollFunction(type: PollType, fn: PollFunction): void {
    this.pollFunctions.set(type, fn);
    console.log(`[PollingManager] Registered poll function for ${type}`);
  }

  /**
   * Unregister a poll function
   */
  unregisterPollFunction(type: PollType): void {
    this.pollFunctions.delete(type);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Start polling for all registered types
   */
  start(): void {
    if (this.isRunning) {
      console.log('[PollingManager] Already running');
      return;
    }

    if (this.isBlocked) {
      console.log(`[PollingManager] Cannot start - blocked: ${this.blockReason}`);
      return;
    }

    this.isRunning = true;
    console.log('[PollingManager] Starting polling');

    // Start each poll type
    this.startPollType('battery', BLE_CONFIG.polling.battery);
    this.startPollType('rssi', BLE_CONFIG.polling.rssi);
    this.startPollType('firmwareState', BLE_CONFIG.polling.firmwareState);
  }

  /**
   * Stop all polling
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    console.log('[PollingManager] Stopping polling');

    // Clear all timers
    for (const [type, timer] of this.timers) {
      clearInterval(timer);
      console.log(`[PollingManager] Stopped ${type} polling`);
    }
    this.timers.clear();
  }

  /**
   * Check if polling is currently running
   */
  isPollingActive(): boolean {
    return this.isRunning && !this.isBlocked;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Blocking
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Block all polling (called during critical operations)
   */
  block(reason: string): void {
    if (this.isBlocked) return;

    console.log(`[PollingManager] Blocking: ${reason}`);
    this.isBlocked = true;
    this.blockReason = reason;

    // Stop all active polling
    this.stop();
  }

  /**
   * Resume polling after block
   */
  unblock(): void {
    if (!this.isBlocked) return;

    console.log(`[PollingManager] Unblocking (was: ${this.blockReason})`);
    this.isBlocked = false;
    this.blockReason = null;

    // Restart polling
    this.start();
  }

  /**
   * Check if polling is blocked
   */
  isPollingBlocked(): boolean {
    return this.isBlocked;
  }

  /**
   * Get block reason
   */
  getBlockReason(): string | null {
    return this.blockReason;
  }

  /**
   * Handle global state change (auto-block/unblock)
   */
  onGlobalStateChange(newState: GlobalState): void {
    if (POLLING_BLOCKED_GLOBAL_STATES.includes(newState)) {
      this.block(`Global state: ${newState}`);
    } else if (this.isBlocked && this.blockReason?.startsWith('Global state:')) {
      this.unblock();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal Polling
  // ───────────────────────────────────────────────────────────────────────────

  private startPollType(type: PollType, intervalMs: number): void {
    const pollFn = this.pollFunctions.get(type);
    if (!pollFn) {
      console.log(`[PollingManager] No poll function for ${type}, skipping`);
      return;
    }

    // Clear existing timer if any
    const existingTimer = this.timers.get(type);
    if (existingTimer) {
      clearInterval(existingTimer);
    }

    // Start new timer
    const timer = setInterval(() => {
      this.pollAllDevices(type, pollFn);
    }, intervalMs);

    this.timers.set(type, timer);
    console.log(`[PollingManager] Started ${type} polling (${intervalMs}ms interval)`);

    // Poll immediately
    this.pollAllDevices(type, pollFn);
  }

  private async pollAllDevices(type: PollType, pollFn: PollFunction): Promise<void> {
    if (this.isBlocked) return;

    const devices = UnifiedBLEStateStore.getAllDevices();
    const eligibleDevices = devices.filter(d => this.shouldPollDevice(d.deviceId, d.state));

    if (eligibleDevices.length === 0) return;

    // Poll all eligible devices in parallel
    const results = await Promise.allSettled(
      eligibleDevices.map(async (device) => {
        try {
          const value = await pollFn(device.deviceId);
          return {
            deviceId: device.deviceId,
            type,
            value,
            timestamp: Date.now(),
          } as PollResult;
        } catch (error) {
          return {
            deviceId: device.deviceId,
            type,
            value: null,
            timestamp: Date.now(),
            error: error instanceof Error ? error.message : String(error),
          } as PollResult;
        }
      })
    );

    // Update store with results
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.value !== null) {
        const { deviceId, type: pollType, value } = result.value;

        switch (pollType) {
          case 'battery':
            UnifiedBLEStateStore.updateDeviceFields(deviceId, { batteryLevel: value });
            break;
          case 'rssi':
            UnifiedBLEStateStore.updateDeviceFields(deviceId, { rssi: value });
            break;
          case 'firmwareState':
            UnifiedBLEStateStore.updateDeviceFields(deviceId, { firmwareState: value });
            break;
        }
      }
    }
  }

  /**
   * Check if a device should be polled
   */
  private shouldPollDevice(deviceId: DeviceID, state: DeviceState): boolean {
    return POLLING_ALLOWED_STATES.includes(state);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Manual Polling
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Manually poll a specific device (bypasses interval)
   */
  async pollDevice(deviceId: DeviceID, type: PollType): Promise<PollResult> {
    const pollFn = this.pollFunctions.get(type);
    if (!pollFn) {
      return {
        deviceId,
        type,
        value: null,
        timestamp: Date.now(),
        error: 'No poll function registered',
      };
    }

    try {
      const value = await pollFn(deviceId);
      return {
        deviceId,
        type,
        value,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        deviceId,
        type,
        value: null,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Cleanup
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Clean up all resources
   */
  cleanup(): void {
    this.stop();
    this.pollFunctions.clear();
    this.isBlocked = false;
    this.blockReason = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Export
// ─────────────────────────────────────────────────────────────────────────────

export const PollingManager = new PollingManagerImpl();
export { PollingManagerImpl };
