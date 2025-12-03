/**
 * Reconnection Manager
 * Handles device reconnection with exponential backoff
 */

import {
  DeviceID,
  DeviceState,
  GlobalState,
  DisconnectReason,
  DeviceErrorType,
  BLE_CONFIG,
} from './types';
import { UnifiedBLEStateStore } from './UnifiedBLEStateStore';
import { formatDeviceID } from './display';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ConnectFunction = (bleAddress: string) => Promise<boolean>;
export type StartStreamingFunction = (deviceId: DeviceID) => Promise<boolean>;

export interface ReconnectState {
  deviceId: DeviceID;
  attempts: number;
  nextAttemptAt: number | null;
  reason: DisconnectReason;
  isActive: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconnection Manager Implementation
// ─────────────────────────────────────────────────────────────────────────────

class ReconnectionManagerImpl {
  // Timers for each device
  private timers: Map<DeviceID, NodeJS.Timeout> = new Map();

  // Track attempts per device
  private attempts: Map<DeviceID, number> = new Map();

  // Track disconnect reasons
  private reasons: Map<DeviceID, DisconnectReason> = new Map();

  // Injected functions
  private connectFn: ConnectFunction | null = null;
  private startStreamingFn: StartStreamingFunction | null = null;

  // ───────────────────────────────────────────────────────────────────────────
  // Configuration
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Set the connect function (injected by BLE layer)
   */
  setConnectFunction(fn: ConnectFunction): void {
    this.connectFn = fn;
  }

  /**
   * Set the start streaming function (injected by BLE layer)
   */
  setStartStreamingFunction(fn: StartStreamingFunction): void {
    this.startStreamingFn = fn;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Reconnection Logic
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Schedule a reconnection attempt for a device
   */
  scheduleReconnect(deviceId: DeviceID, reason: DisconnectReason): void {
    // Don't reconnect if user requested disconnect
    if (reason === DisconnectReason.USER_REQUESTED) {
      console.log(`[ReconnectManager] ${formatDeviceID(deviceId)} - user disconnect, not reconnecting`);
      return;
    }

    // Clear any existing timer
    this.cancelReconnect(deviceId);

    const currentAttempts = this.attempts.get(deviceId) ?? 0;
    const { maxAttempts, baseDelayMs, maxDelayMs, backoffMultiplier } = BLE_CONFIG.reconnect;

    // Check max attempts
    if (currentAttempts >= maxAttempts) {
      console.log(`[ReconnectManager] ${formatDeviceID(deviceId)} - max attempts (${maxAttempts}) reached`);
      this.handleMaxAttemptsExceeded(deviceId);
      return;
    }

    // Calculate delay with exponential backoff
    const delay = this.calculateBackoffDelay(currentAttempts);
    const nextAttemptAt = Date.now() + delay;

    // Update state
    this.attempts.set(deviceId, currentAttempts + 1);
    this.reasons.set(deviceId, reason);

    // Update store
    try {
      UnifiedBLEStateStore.transition(deviceId, DeviceState.RECONNECTING);
      UnifiedBLEStateStore.setReconnectState(
        deviceId,
        currentAttempts + 1,
        nextAttemptAt,
        reason
      );
    } catch (error) {
      console.error(`[ReconnectManager] Failed to update state for ${formatDeviceID(deviceId)}:`, error);
    }

    console.log(
      `[ReconnectManager] ${formatDeviceID(deviceId)} - attempt ${currentAttempts + 1}/${maxAttempts} in ${delay}ms`
    );

    // Schedule attempt
    const timer = setTimeout(() => {
      this.timers.delete(deviceId);
      this.attemptReconnect(deviceId);
    }, delay);

    this.timers.set(deviceId, timer);
  }

  /**
   * Calculate backoff delay based on attempt count
   */
  private calculateBackoffDelay(attempts: number): number {
    const { baseDelayMs, maxDelayMs, backoffMultiplier } = BLE_CONFIG.reconnect;
    const delay = baseDelayMs * Math.pow(backoffMultiplier, attempts);
    return Math.min(delay, maxDelayMs);
  }

  /**
   * Attempt to reconnect a device
   */
  private async attemptReconnect(deviceId: DeviceID): Promise<void> {
    if (!this.connectFn) {
      console.error('[ReconnectManager] No connect function registered');
      return;
    }

    const device = UnifiedBLEStateStore.getDevice(deviceId);
    if (!device) {
      console.error(`[ReconnectManager] Device ${formatDeviceID(deviceId)} not found`);
      this.cleanup(deviceId);
      return;
    }

    // Check if still in RECONNECTING state
    if (device.state !== DeviceState.RECONNECTING) {
      console.log(`[ReconnectManager] ${formatDeviceID(deviceId)} - no longer reconnecting (${device.state})`);
      this.cleanup(deviceId);
      return;
    }

    console.log(`[ReconnectManager] ${formatDeviceID(deviceId)} - attempting reconnect...`);

    try {
      // Transition to CONNECTING
      UnifiedBLEStateStore.transition(deviceId, DeviceState.CONNECTING);

      // Attempt connection
      const success = await this.connectFn(device.bleAddress);

      if (success) {
        console.log(`[ReconnectManager] ${formatDeviceID(deviceId)} - reconnected successfully`);
        this.cleanup(deviceId);

        // Transition to CONNECTED
        UnifiedBLEStateStore.transition(deviceId, DeviceState.CONNECTED);

        // Auto-recover streaming if global streaming is active
        await this.recoverStreamingIfActive(deviceId);
      } else {
        console.log(`[ReconnectManager] ${formatDeviceID(deviceId)} - reconnect failed`);
        const reason = this.reasons.get(deviceId) ?? DisconnectReason.CONNECTION_LOST;
        this.scheduleReconnect(deviceId, reason);
      }
    } catch (error) {
      console.error(`[ReconnectManager] ${formatDeviceID(deviceId)} - reconnect error:`, error);
      const reason = this.reasons.get(deviceId) ?? DisconnectReason.BLE_ERROR;
      this.scheduleReconnect(deviceId, reason);
    }
  }

  /**
   * Handle max reconnection attempts exceeded
   */
  private handleMaxAttemptsExceeded(deviceId: DeviceID): void {
    this.cleanup(deviceId);

    try {
      UnifiedBLEStateStore.transitionToError(
        deviceId,
        DeviceErrorType.MAX_RECONNECT_EXCEEDED,
        `Failed to reconnect after ${BLE_CONFIG.reconnect.maxAttempts} attempts`
      );
    } catch (error) {
      console.error(`[ReconnectManager] Failed to set error state for ${formatDeviceID(deviceId)}:`, error);
    }
  }

  /**
   * Recover streaming if global state is STREAMING
   */
  private async recoverStreamingIfActive(deviceId: DeviceID): Promise<void> {
    const globalState = UnifiedBLEStateStore.getGlobalState();

    if (globalState !== GlobalState.STREAMING) {
      return;
    }

    if (!this.startStreamingFn) {
      console.warn('[ReconnectManager] No startStreaming function registered');
      return;
    }

    console.log(`[ReconnectManager] ${formatDeviceID(deviceId)} - recovering streaming...`);

    try {
      const success = await this.startStreamingFn(deviceId);
      if (success) {
        UnifiedBLEStateStore.transition(deviceId, DeviceState.STREAMING);
        console.log(`[ReconnectManager] ${formatDeviceID(deviceId)} - streaming recovered`);
      } else {
        console.warn(`[ReconnectManager] ${formatDeviceID(deviceId)} - streaming recovery failed`);
      }
    } catch (error) {
      console.error(`[ReconnectManager] ${formatDeviceID(deviceId)} - streaming recovery error:`, error);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Control
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Cancel reconnection for a device
   */
  cancelReconnect(deviceId: DeviceID): void {
    const timer = this.timers.get(deviceId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(deviceId);
    }
  }

  /**
   * Clean up reconnection state for a device
   */
  cleanup(deviceId: DeviceID): void {
    this.cancelReconnect(deviceId);
    this.attempts.delete(deviceId);
    this.reasons.delete(deviceId);
  }

  /**
   * Get reconnection state for a device
   */
  getState(deviceId: DeviceID): ReconnectState | null {
    const attempts = this.attempts.get(deviceId);
    const reason = this.reasons.get(deviceId);
    const isActive = this.timers.has(deviceId);

    if (attempts === undefined) {
      return null;
    }

    const device = UnifiedBLEStateStore.getDevice(deviceId);

    return {
      deviceId,
      attempts,
      nextAttemptAt: device?.nextReconnectAt ?? null,
      reason: reason ?? DisconnectReason.UNKNOWN,
      isActive,
    };
  }

  /**
   * Check if a device is currently reconnecting
   */
  isReconnecting(deviceId: DeviceID): boolean {
    return this.timers.has(deviceId);
  }

  /**
   * Retry connection for a device in ERROR state (user-triggered)
   */
  retryConnection(deviceId: DeviceID): void {
    const device = UnifiedBLEStateStore.getDevice(deviceId);
    if (!device) {
      console.error(`[ReconnectManager] Device ${formatDeviceID(deviceId)} not found`);
      return;
    }

    if (device.state !== DeviceState.ERROR) {
      console.warn(`[ReconnectManager] Device ${formatDeviceID(deviceId)} not in ERROR state`);
      return;
    }

    // Reset attempts for user-triggered retry
    this.cleanup(deviceId);

    console.log(`[ReconnectManager] ${formatDeviceID(deviceId)} - user retry requested`);

    // Schedule immediate reconnect
    this.scheduleReconnect(deviceId, DisconnectReason.CONNECTION_LOST);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Cleanup
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Clean up all resources
   */
  cleanupAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.attempts.clear();
    this.reasons.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Export
// ─────────────────────────────────────────────────────────────────────────────

export const ReconnectionManager = new ReconnectionManagerImpl();
export { ReconnectionManagerImpl };
