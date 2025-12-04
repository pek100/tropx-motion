/**
 * Unified BLE State Store
 * Single source of truth for all BLE device and global state
 */

import { EventEmitter } from 'events';
import {
  DeviceID,
  DeviceState,
  GlobalState,
  SyncState,
  DisconnectReason,
  DeviceErrorType,
  DeviceError,
  UnifiedDeviceState,
  GlobalBLEState,
  StreamingHook,
  MotionData,
  DeviceStateChange,
  GlobalStateChange,
  StateUpdateMessage,
  StateUpdateDevice,
  TRANSITION_RULES,
  DEFAULT_DEVICE_STATE,
  DEFAULT_GLOBAL_STATE,
  BLE_CONFIG,
} from './types';
import { identifyDevice, isShin } from './operations';
import { getDeviceDisplayName, getDeviceShortName, getJointDisplayName } from './display';

// ─────────────────────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────────────────────

export interface StoreEvents {
  deviceStateChanged: (change: DeviceStateChange) => void;
  globalStateChanged: (change: GlobalStateChange) => void;
  deviceRegistered: (deviceId: DeviceID, state: UnifiedDeviceState) => void;
  deviceUnregistered: (deviceId: DeviceID) => void;
  stateUpdateReady: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class InvalidTransitionError extends Error {
  constructor(
    public readonly deviceId: DeviceID,
    public readonly fromState: DeviceState,
    public readonly toState: DeviceState
  ) {
    super(`Invalid transition for device ${deviceId}: ${fromState} → ${toState}`);
    this.name = 'InvalidTransitionError';
  }
}

export class DeviceNotFoundError extends Error {
  constructor(public readonly identifier: DeviceID | string) {
    super(`Device not found: ${identifier}`);
    this.name = 'DeviceNotFoundError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Store Implementation
// ─────────────────────────────────────────────────────────────────────────────

class UnifiedBLEStateStoreImpl extends EventEmitter {
  // Device state storage
  private devices = new Map<DeviceID, UnifiedDeviceState>();
  private addressToDeviceId = new Map<string, DeviceID>();

  // Global state
  private globalState: GlobalBLEState = { ...DEFAULT_GLOBAL_STATE };

  // Streaming hooks
  private hooks = new Map<DeviceID, StreamingHook>();

  // Broadcast
  private broadcastFunction: ((message: StateUpdateMessage) => Promise<void>) | null = null;
  private broadcastQueue = new Set<DeviceID>();
  private broadcastTimer: NodeJS.Timeout | null = null;

  // ───────────────────────────────────────────────────────────────────────────
  // State Machine Core
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Check if a state transition is valid
   */
  validateTransition(from: DeviceState, to: DeviceState): boolean {
    const validTargets = TRANSITION_RULES[from];
    return validTargets?.includes(to) ?? false;
  }

  /**
   * Get all valid transitions from a state
   */
  getValidTransitions(state: DeviceState): DeviceState[] {
    return TRANSITION_RULES[state] ?? [];
  }

  /**
   * Check if a device can transition to a target state
   */
  canTransition(deviceId: DeviceID, targetState: DeviceState): boolean {
    const device = this.devices.get(deviceId);
    if (!device) return false;
    return this.validateTransition(device.state, targetState);
  }

  /**
   * Transition a device to a new state (with validation)
   * @throws InvalidTransitionError if transition is not valid
   */
  transition(
    deviceId: DeviceID,
    newState: DeviceState,
    metadata?: Record<string, unknown>
  ): void {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new DeviceNotFoundError(deviceId);
    }

    const previousState = device.state;

    // Validate transition
    if (!this.validateTransition(previousState, newState)) {
      throw new InvalidTransitionError(deviceId, previousState, newState);
    }

    // Update state
    const now = Date.now();
    device.previousState = previousState;
    device.state = newState;
    device.stateChangedAt = now;

    // Clear error when leaving ERROR state
    if (previousState === DeviceState.ERROR && newState !== DeviceState.ERROR) {
      device.lastError = null;
    }

    // Clear reconnect state on ANY state change (except RECONNECTING → CONNECTING)
    // This ensures fresh retry counts when a device reconnects later
    const isReconnectTransition = previousState === DeviceState.RECONNECTING && newState === DeviceState.CONNECTING;
    if (device.reconnectAttempts > 0 && !isReconnectTransition) {
      device.reconnectAttempts = 0;
      device.nextReconnectAt = null;
      device.disconnectReason = null;
    }

    // Emit event
    const change: DeviceStateChange = {
      deviceId,
      previousState,
      newState,
      metadata,
      timestamp: now,
    };
    this.emit('deviceStateChanged', change);

    // Queue broadcast
    this.queueBroadcast(deviceId);
  }

  /**
   * Transition to ERROR state with error details
   */
  transitionToError(
    deviceId: DeviceID,
    errorType: DeviceErrorType,
    message: string
  ): void {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new DeviceNotFoundError(deviceId);
    }

    const previousState = device.state;

    // ERROR can be reached from most states
    if (!this.validateTransition(previousState, DeviceState.ERROR)) {
      // Force transition for error states (safety)
      console.warn(`[Store] Forcing ERROR transition from ${previousState}`);
    }

    const now = Date.now();
    device.previousState = previousState;
    device.state = DeviceState.ERROR;
    device.stateChangedAt = now;
    device.lastError = {
      type: errorType,
      message,
      timestamp: now,
    };

    this.emit('deviceStateChanged', {
      deviceId,
      previousState,
      newState: DeviceState.ERROR,
      metadata: { errorType, message },
      timestamp: now,
    });

    this.queueBroadcast(deviceId);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Device State Management
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Register a new device (identifies DeviceID from BLE name)
   * @returns DeviceID if successful, null if device name doesn't match patterns
   */
  registerDevice(bleAddress: string, bleName: string): DeviceID | null {
    // Check if already registered by address
    const existingId = this.addressToDeviceId.get(bleAddress);
    if (existingId !== undefined) {
      // Update existing device's lastSeen
      const existing = this.devices.get(existingId);
      if (existing) {
        existing.lastSeen = Date.now();
      }
      return existingId;
    }

    // Identify device from BLE name
    const deviceId = identifyDevice(bleName);
    if (deviceId === null) {
      console.warn(`[Store] Cannot identify device: ${bleName}`);
      return null;
    }

    // Check if this DeviceID is already taken by another address
    const existingDevice = this.devices.get(deviceId);
    if (existingDevice && existingDevice.bleAddress !== bleAddress) {
      console.warn(`[Store] DeviceID ${deviceId} already registered to ${existingDevice.bleAddress}`);
      // Allow re-registration (device may have been reset)
      this.addressToDeviceId.delete(existingDevice.bleAddress);
    }

    // Create device state
    const now = Date.now();
    const state: UnifiedDeviceState = {
      ...DEFAULT_DEVICE_STATE,
      deviceId,
      bleAddress,
      bleName,
      stateChangedAt: now,
      lastSeen: now,
    };

    // Store
    this.devices.set(deviceId, state);
    this.addressToDeviceId.set(bleAddress, deviceId);

    // Emit event
    this.emit('deviceRegistered', deviceId, state);
    this.queueBroadcast(deviceId);

    console.log(`[Store] Registered device: ${bleName} → ${deviceId} (0x${deviceId.toString(16)})`);
    return deviceId;
  }

  /**
   * Unregister a device (full cleanup)
   */
  unregisterDevice(deviceId: DeviceID): void {
    const device = this.devices.get(deviceId);
    if (!device) return;

    // Cleanup
    this.addressToDeviceId.delete(device.bleAddress);
    this.devices.delete(deviceId);
    this.hooks.delete(deviceId);
    this.broadcastQueue.delete(deviceId);

    // Emit event
    this.emit('deviceUnregistered', deviceId);
    this.queueBroadcast(); // Broadcast full state update
  }

  /**
   * Get device state by DeviceID
   */
  getDevice(deviceId: DeviceID): UnifiedDeviceState | null {
    return this.devices.get(deviceId) ?? null;
  }

  /**
   * Get DeviceID by BLE address
   */
  getDeviceIdByAddress(bleAddress: string): DeviceID | null {
    return this.addressToDeviceId.get(bleAddress) ?? null;
  }

  /**
   * Get device state by BLE address
   */
  getDeviceByAddress(bleAddress: string): UnifiedDeviceState | null {
    const deviceId = this.addressToDeviceId.get(bleAddress);
    if (deviceId === undefined) return null;
    return this.devices.get(deviceId) ?? null;
  }

  /**
   * Get all device states
   */
  getAllDevices(): UnifiedDeviceState[] {
    return Array.from(this.devices.values());
  }

  /**
   * Get devices by state
   */
  getDevicesByState(state: DeviceState): UnifiedDeviceState[] {
    return Array.from(this.devices.values()).filter(d => d.state === state);
  }

  /**
   * Get connected devices (CONNECTED, SYNCING, SYNCED, STREAMING)
   */
  getConnectedDevices(): UnifiedDeviceState[] {
    const connectedStates = [
      DeviceState.CONNECTED,
      DeviceState.SYNCING,
      DeviceState.SYNCED,
      DeviceState.STREAMING,
    ];
    return Array.from(this.devices.values()).filter(d => connectedStates.includes(d.state));
  }

  /**
   * Get streaming devices
   */
  getStreamingDevices(): UnifiedDeviceState[] {
    return this.getDevicesByState(DeviceState.STREAMING);
  }

  /**
   * Update device fields (partial update, no state transition)
   */
  updateDeviceFields(
    deviceId: DeviceID,
    fields: Partial<Omit<UnifiedDeviceState, 'deviceId' | 'bleAddress' | 'bleName' | 'state'>>
  ): void {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new DeviceNotFoundError(deviceId);
    }

    Object.assign(device, fields);
    this.queueBroadcast(deviceId);
  }

  /**
   * Update lastSeen timestamp
   */
  updateLastSeen(deviceId: DeviceID): void {
    const device = this.devices.get(deviceId);
    if (device) {
      device.lastSeen = Date.now();
    }
  }

  /**
   * Set sync state and clock offset
   */
  setSyncState(
    deviceId: DeviceID,
    syncState: SyncState,
    clockOffset?: number
  ): void {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new DeviceNotFoundError(deviceId);
    }

    device.syncState = syncState;
    if (clockOffset !== undefined) {
      device.clockOffset = clockOffset;
    }
    if (syncState === SyncState.SYNCED) {
      device.lastSyncAt = Date.now();
    }

    this.queueBroadcast(deviceId);
  }

  /**
   * Set reconnection state
   */
  setReconnectState(
    deviceId: DeviceID,
    attempts: number,
    nextReconnectAt: number | null,
    reason?: DisconnectReason
  ): void {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new DeviceNotFoundError(deviceId);
    }

    device.reconnectAttempts = attempts;
    device.nextReconnectAt = nextReconnectAt;
    if (reason !== undefined) {
      device.disconnectReason = reason;
    }

    this.queueBroadcast(deviceId);
  }

  /**
   * Clear reconnection state (used when user cancels or connection succeeds)
   */
  clearReconnectState(deviceId: DeviceID): void {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new DeviceNotFoundError(deviceId);
    }

    device.reconnectAttempts = 0;
    device.nextReconnectAt = null;
    device.disconnectReason = null;

    this.queueBroadcast(deviceId);
  }

  /**
   * Set sync progress (0-100 during sync, null when not syncing)
   */
  setSyncProgress(deviceId: DeviceID, progress: number | null): void {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new DeviceNotFoundError(deviceId);
    }

    device.syncProgress = progress;
    this.queueBroadcast(deviceId);
  }

  /**
   * Set vibrating/shaking state (for locate mode)
   * Uses forceBroadcast for immediate UI feedback
   */
  setVibrating(deviceId: DeviceID, isVibrating: boolean): void {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new DeviceNotFoundError(deviceId);
    }

    // Only update and broadcast if state changed
    if (device.isVibrating !== isVibrating) {
      device.isVibrating = isVibrating;
      // Use immediate broadcast for responsive locate mode UI
      this.forceBroadcast();
    }
  }

  /**
   * Set vibrating state by BLE address (convenience for DeviceLocateService)
   */
  setVibratingByAddress(bleAddress: string, isVibrating: boolean): void {
    const deviceId = this.addressToDeviceId.get(bleAddress);
    if (deviceId === undefined) return;

    this.setVibrating(deviceId, isVibrating);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Global State Management
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Set global BLE state
   */
  setGlobalState(newState: GlobalState): void {
    const previousState = this.globalState.state;
    if (previousState === newState) return;

    const now = Date.now();
    this.globalState.state = newState;

    // Update timestamps
    switch (newState) {
      case GlobalState.SCANNING:
        this.globalState.scanningStartedAt = now;
        break;
      case GlobalState.SYNCING:
        this.globalState.syncingStartedAt = now;
        break;
      case GlobalState.STREAMING:
        this.globalState.streamingStartedAt = now;
        break;
      case GlobalState.IDLE:
        this.globalState.scanningStartedAt = null;
        this.globalState.syncingStartedAt = null;
        this.globalState.streamingStartedAt = null;
        break;
    }

    // Emit event
    const change: GlobalStateChange = {
      previousState,
      newState,
      timestamp: now,
    };
    this.emit('globalStateChanged', change);

    // Queue broadcast (all devices)
    this.queueBroadcast();
  }

  /**
   * Get current global state
   */
  getGlobalState(): GlobalState {
    return this.globalState.state;
  }

  /**
   * Get full global state object
   */
  getGlobalStateDetails(): GlobalBLEState {
    return { ...this.globalState };
  }

  /**
   * Check if operations are blocked (syncing or streaming)
   */
  isOperationBlocked(): boolean {
    return (
      this.globalState.state === GlobalState.SYNCING ||
      this.globalState.state === GlobalState.STREAMING
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Streaming Hooks
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Register a streaming hook for a device
   */
  registerHook(deviceId: DeviceID, hook: StreamingHook): void {
    this.hooks.set(deviceId, hook);
  }

  /**
   * Unregister streaming hook
   */
  unregisterHook(deviceId: DeviceID): void {
    this.hooks.delete(deviceId);
  }

  /**
   * Check if device has a hook registered
   */
  hasHook(deviceId: DeviceID): boolean {
    return this.hooks.has(deviceId);
  }

  /**
   * Dispatch motion data to the appropriate hook
   * @returns DeviceID if dispatched, null if no hook found
   */
  dispatchMotionData(bleAddress: string, data: MotionData): DeviceID | null {
    const deviceId = this.addressToDeviceId.get(bleAddress);
    if (deviceId === undefined) return null;

    const hook = this.hooks.get(deviceId);
    if (!hook) return null;

    // Update lastSeen
    const device = this.devices.get(deviceId);
    if (device) {
      device.lastSeen = Date.now();
    }

    // Dispatch
    try {
      hook.onMotionData(data);
    } catch (error) {
      console.error(`[Store] Hook error for ${deviceId}:`, error);
      if (hook.onError) {
        hook.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }

    return deviceId;
  }

  /**
   * Notify disconnect through hook
   */
  notifyDisconnect(deviceId: DeviceID): void {
    const hook = this.hooks.get(deviceId);
    if (hook?.onDisconnect) {
      try {
        hook.onDisconnect();
      } catch (error) {
        console.error(`[Store] Disconnect hook error for ${deviceId}:`, error);
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Broadcast System
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Set the WebSocket broadcast function
   */
  setBroadcastFunction(fn: (message: StateUpdateMessage) => Promise<void>): void {
    this.broadcastFunction = fn;
  }

  /**
   * Queue a broadcast (debounced)
   */
  queueBroadcast(deviceId?: DeviceID): void {
    if (deviceId !== undefined) {
      this.broadcastQueue.add(deviceId);
    }

    // Debounce
    if (this.broadcastTimer === null) {
      this.broadcastTimer = setTimeout(() => {
        this.flushBroadcast();
      }, BLE_CONFIG.broadcast.debounceMs);
    }
  }

  /**
   * Flush pending broadcasts
   */
  private flushBroadcast(): void {
    this.broadcastTimer = null;

    if (!this.broadcastFunction) {
      console.warn('[Store] flushBroadcast called but broadcastFunction is null - broadcast skipped');
      return;
    }

    // Serialize state
    const message = this.serializeStateUpdate();
    console.log(`[Store] Flushing broadcast: globalState=${message.globalState}, devices=${message.devices.length}`);

    // Send
    this.broadcastFunction(message).catch(error => {
      console.error('[Store] Broadcast error:', error);
    });

    // Clear queue
    this.broadcastQueue.clear();

    // Emit local event
    this.emit('stateUpdateReady');
  }

  /**
   * Serialize current state to STATE_UPDATE message
   */
  serializeStateUpdate(): StateUpdateMessage {
    const devices: StateUpdateDevice[] = Array.from(this.devices.values()).map(device => ({
      deviceId: device.deviceId,
      bleAddress: device.bleAddress,
      bleName: device.bleName,
      displayName: getDeviceDisplayName(device.deviceId),
      shortName: getDeviceShortName(device.deviceId),
      joint: getJointDisplayName(device.deviceId),
      placement: isShin(device.deviceId) ? 'shin' : 'thigh',
      state: device.state,
      batteryLevel: device.batteryLevel,
      rssi: device.rssi,
      syncState: device.syncState,
      clockOffset: device.clockOffset,
      reconnectAttempts: device.reconnectAttempts,
      nextReconnectAt: device.nextReconnectAt,
      lastError: device.lastError,
      syncProgress: device.syncProgress,
      isVibrating: device.isVibrating,
    }));

    return {
      type: 0x40,
      timestamp: Date.now(),
      globalState: this.globalState.state,
      devices,
    };
  }

  /**
   * Force immediate broadcast (bypasses debounce)
   */
  forceBroadcast(): void {
    console.log('[Store] forceBroadcast called');
    if (this.broadcastTimer) {
      clearTimeout(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    this.flushBroadcast();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Utility
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Clear all state (for cleanup/reset)
   */
  clear(): void {
    // Clear timers
    if (this.broadcastTimer) {
      clearTimeout(this.broadcastTimer);
      this.broadcastTimer = null;
    }

    // Clear storage
    this.devices.clear();
    this.addressToDeviceId.clear();
    this.hooks.clear();
    this.broadcastQueue.clear();

    // Reset global state
    this.globalState = { ...DEFAULT_GLOBAL_STATE };

    console.log('[Store] Cleared all state');
  }

  /**
   * Get debug snapshot
   */
  getSnapshot(): {
    devices: UnifiedDeviceState[];
    globalState: GlobalBLEState;
    hookCount: number;
  } {
    return {
      devices: this.getAllDevices(),
      globalState: this.getGlobalStateDetails(),
      hookCount: this.hooks.size,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Export
// ─────────────────────────────────────────────────────────────────────────────

export const UnifiedBLEStateStore = new UnifiedBLEStateStoreImpl();

// Also export class for testing
export { UnifiedBLEStateStoreImpl };
