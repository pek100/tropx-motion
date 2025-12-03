/**
 * Watchdog
 * Monitors device heartbeats and triggers streaming recovery or reconnection on timeout
 */

import {
  DeviceID,
  DeviceState,
  DisconnectReason,
  BLE_CONFIG,
} from './types';
import { UnifiedBLEStateStore } from './UnifiedBLEStateStore';
import { ReconnectionManager } from './ReconnectionManager';
import { formatDeviceID } from './display';

// Callback type for streaming recovery
export type StreamingRecoveryCallback = (deviceId: DeviceID, bleAddress: string) => Promise<boolean>;

// Callback type for checking actual BLE connection state
export type BLEConnectionCheckCallback = (bleAddress: string) => boolean;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface WatchdogStatus {
  isRunning: boolean;
  checkIntervalMs: number;
  timeoutMs: number;
  monitoredDevices: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Watchdog Implementation
// ─────────────────────────────────────────────────────────────────────────────

class WatchdogImpl {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private streamingRecoveryCallback: StreamingRecoveryCallback | null = null;
  private bleConnectionCheckCallback: BLEConnectionCheckCallback | null = null;
  private recoveryAttempts: Map<DeviceID, number> = new Map();
  private lastRecoveryAttempt: Map<DeviceID, number> = new Map();
  private stateChangeUnsubscribe: (() => void) | null = null;

  // ───────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Start the watchdog
   */
  start(): void {
    if (this.isRunning) {
      console.log('[Watchdog] Already running');
      return;
    }

    this.isRunning = true;
    const { checkIntervalMs } = BLE_CONFIG.watchdog;

    console.log(`[Watchdog] Starting (check every ${checkIntervalMs}ms)`);

    // Subscribe to state changes to clear recovery attempts
    this.subscribeToStateChanges();

    this.timer = setInterval(() => {
      this.checkAllDevices();
    }, checkIntervalMs);
  }

  /**
   * Subscribe to state changes to clear recovery attempts
   */
  private subscribeToStateChanges(): void {
    const handler = (change: { deviceId: DeviceID; previousState: DeviceState; newState: DeviceState }) => {
      // Clear recovery attempts on ANY state change
      // This ensures fresh recovery counts when streaming restarts
      if (this.recoveryAttempts.has(change.deviceId) || this.lastRecoveryAttempt.has(change.deviceId)) {
        console.log(`[Watchdog] Clearing recovery attempts for ${formatDeviceID(change.deviceId)} on state change: ${change.previousState} → ${change.newState}`);
        this.recoveryAttempts.delete(change.deviceId);
        this.lastRecoveryAttempt.delete(change.deviceId);
      }
    };

    UnifiedBLEStateStore.on('deviceStateChanged', handler);

    this.stateChangeUnsubscribe = () => {
      UnifiedBLEStateStore.removeListener('deviceStateChanged', handler);
    };
  }

  /**
   * Stop the watchdog
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // Unsubscribe from state changes
    if (this.stateChangeUnsubscribe) {
      this.stateChangeUnsubscribe();
      this.stateChangeUnsubscribe = null;
    }

    // Clear recovery tracking
    this.recoveryAttempts.clear();
    this.lastRecoveryAttempt.clear();

    console.log('[Watchdog] Stopped');
  }

  /**
   * Set the streaming recovery callback
   * Called when a streaming device stops sending data - allows restarting streaming
   */
  setStreamingRecoveryCallback(callback: StreamingRecoveryCallback): void {
    this.streamingRecoveryCallback = callback;
    console.log('[Watchdog] Streaming recovery callback registered');
  }

  /**
   * Set the BLE connection check callback
   * Called to verify if a device is actually connected at the BLE level
   * before triggering a reconnection
   */
  setBLEConnectionCheckCallback(callback: BLEConnectionCheckCallback): void {
    this.bleConnectionCheckCallback = callback;
    console.log('[Watchdog] BLE connection check callback registered');
  }

  /**
   * Check if watchdog is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get watchdog status
   */
  getStatus(): WatchdogStatus {
    const devices = UnifiedBLEStateStore.getAllDevices();
    const monitoredDevices = devices.filter(d => this.shouldMonitor(d.state)).length;

    return {
      isRunning: this.isRunning,
      checkIntervalMs: BLE_CONFIG.watchdog.checkIntervalMs,
      timeoutMs: BLE_CONFIG.watchdog.timeoutMs,
      monitoredDevices,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Heartbeat
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Update last seen timestamp for a device (called on data receive)
   */
  heartbeat(deviceId: DeviceID): void {
    UnifiedBLEStateStore.updateLastSeen(deviceId);
  }

  /**
   * Update last seen by BLE address (convenience method)
   */
  heartbeatByAddress(bleAddress: string): void {
    const deviceId = UnifiedBLEStateStore.getDeviceIdByAddress(bleAddress);
    if (deviceId !== null) {
      this.heartbeat(deviceId);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Monitoring
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Check all devices for timeout
   */
  private checkAllDevices(): void {
    const devices = UnifiedBLEStateStore.getAllDevices();
    const now = Date.now();
    const { timeoutMs, streamingRecoveryMs } = BLE_CONFIG.watchdog;

    for (const device of devices) {
      if (!this.shouldMonitor(device.state)) {
        // Clear recovery attempts if device is no longer monitored
        this.recoveryAttempts.delete(device.deviceId);
        this.lastRecoveryAttempt.delete(device.deviceId);
        continue;
      }

      const timeSinceLastSeen = now - device.lastSeen;

      // For STREAMING devices, try streaming recovery first (shorter timeout)
      if (device.state === DeviceState.STREAMING && timeSinceLastSeen > streamingRecoveryMs) {
        const lastRecovery = this.lastRecoveryAttempt.get(device.deviceId) || 0;
        const timeSinceLastRecovery = now - lastRecovery;

        // Only attempt recovery every 2 seconds to avoid flooding
        if (timeSinceLastRecovery > 2000) {
          this.attemptStreamingRecovery(device.deviceId, device.bleAddress, timeSinceLastSeen);
        }
      }

      // Full timeout - trigger reconnection
      if (timeSinceLastSeen > timeoutMs) {
        this.handleTimeout(device.deviceId, timeSinceLastSeen);
      }
    }
  }

  /**
   * Attempt to recover streaming for a device
   */
  private async attemptStreamingRecovery(deviceId: DeviceID, bleAddress: string, timeSinceLastSeen: number): Promise<void> {
    const attempts = this.recoveryAttempts.get(deviceId) || 0;
    const MAX_RECOVERY_ATTEMPTS = 2;

    if (attempts >= MAX_RECOVERY_ATTEMPTS) {
      // Already tried recovery, will handle via full timeout
      return;
    }

    if (!this.streamingRecoveryCallback) {
      console.warn(`[Watchdog] ${formatDeviceID(deviceId)} - no streaming recovery callback set`);
      return;
    }

    console.warn(
      `[Watchdog] ${formatDeviceID(deviceId)} - streaming stalled (${Math.round(timeSinceLastSeen / 1000)}s) - attempting recovery ${attempts + 1}/${MAX_RECOVERY_ATTEMPTS}`
    );

    this.recoveryAttempts.set(deviceId, attempts + 1);
    this.lastRecoveryAttempt.set(deviceId, Date.now());

    try {
      const success = await this.streamingRecoveryCallback(deviceId, bleAddress);
      if (success) {
        console.log(`[Watchdog] ${formatDeviceID(deviceId)} - streaming recovered successfully`);
        // Reset recovery attempts on success
        this.recoveryAttempts.set(deviceId, 0);
      } else {
        console.warn(`[Watchdog] ${formatDeviceID(deviceId)} - streaming recovery failed`);
      }
    } catch (error) {
      console.error(`[Watchdog] ${formatDeviceID(deviceId)} - streaming recovery error:`, error);
    }
  }

  /**
   * Check if a device state should be monitored
   */
  private shouldMonitor(state: DeviceState): boolean {
    // Only monitor connected and streaming devices
    return [
      DeviceState.CONNECTED,
      DeviceState.SYNCING,
      DeviceState.SYNCED,
      DeviceState.STREAMING,
    ].includes(state);
  }

  /**
   * Handle device timeout
   */
  private handleTimeout(deviceId: DeviceID, timeSinceLastSeen: number): void {
    const device = UnifiedBLEStateStore.getDevice(deviceId);
    if (!device) return;

    // CRITICAL: Check if device is actually still connected at BLE level
    // This prevents false disconnects when data temporarily pauses but connection is alive
    if (this.bleConnectionCheckCallback) {
      const isActuallyConnected = this.bleConnectionCheckCallback(device.bleAddress);
      if (isActuallyConnected) {
        // Device is still connected at BLE level - just update lastSeen and skip disconnect
        console.log(
          `[Watchdog] ${formatDeviceID(deviceId)} - data timeout (${Math.round(timeSinceLastSeen / 1000)}s) but BLE still connected - skipping disconnect`
        );
        // Update lastSeen to reset the timeout counter
        UnifiedBLEStateStore.updateLastSeen(deviceId);
        return;
      }
    }

    console.warn(
      `[Watchdog] ${formatDeviceID(deviceId)} - confirmed disconnected (${Math.round(timeSinceLastSeen / 1000)}s since last seen)`
    );

    // Notify disconnect through store
    UnifiedBLEStateStore.notifyDisconnect(deviceId);

    // Trigger reconnection
    try {
      // First transition to a state that allows RECONNECTING
      if (device.state !== DeviceState.RECONNECTING) {
        // Can't transition directly in all cases, handle gracefully
        ReconnectionManager.scheduleReconnect(deviceId, DisconnectReason.WATCHDOG_TIMEOUT);
      }
    } catch (error) {
      console.error(`[Watchdog] Failed to trigger reconnect for ${formatDeviceID(deviceId)}:`, error);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Cleanup
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.stop();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Export
// ─────────────────────────────────────────────────────────────────────────────

export const Watchdog = new WatchdogImpl();
export { WatchdogImpl };
