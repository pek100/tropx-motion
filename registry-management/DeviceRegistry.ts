/**
 * Device Registry
 *
 * Central registry for managing device connections and their mappings to joints.
 * Follows Azure IoT Hub best practice: use registry for provisioning/management only,
 * not for high-throughput runtime operations.
 *
 * Features:
 * - Automatic device identification on registration
 * - Manual override support via file system
 * - Persistent mapping across sessions
 * - Event notifications for mapping changes
 */

import { DeviceID } from './DeviceMappingConfig';
import { identifyDevice, DeviceIdentification, getFullIdentifier } from './DeviceIdentifier';
import { DeviceSyncState } from '../ble-bridge/BleBridgeTypes';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export interface RegisteredDevice {
  bleAddress: string;       // BLE MAC address or iOS UUID
  deviceName: string;       // Human-readable device name (e.g., "tropx_ln_bottom")
  deviceID: DeviceID;       // Assigned device ID (0x11, 0x12, etc.)
  joint: string;            // Joint name (e.g., "left-knee")
  position: string;         // Sensor position (e.g., "bottom")
  description: string;      // Human-readable description
  registeredAt: Date;       // When device was first registered
  lastSeen: Date;           // Last time device sent data
  isManualOverride: boolean; // Whether mapping was manually set
  clockOffset?: number;     // Clock offset in milliseconds (from time sync)
  syncState?: DeviceSyncState; // Time sync state (prevents double-application of offset)
  timestampUnit?: 'microseconds' | 'milliseconds'; // Timestamp unit used by this device's firmware
  deviceState?: string;     // Current device state (Ready, Standby, Streaming, etc.)
  deviceStateValue?: number; // Numeric state value
  deviceStateLastUpdate?: number; // Timestamp of last state update
  isReconnecting?: boolean; // Whether device is currently reconnecting
  reconnectAttempts?: number; // Number of reconnect attempts made
}

type RegistryChangeHandler = (devices: RegisteredDevice[]) => void;

/**
 * Device Registry - Singleton
 *
 * Manages device registration and provides lookup methods for runtime use.
 */
export class DeviceRegistry {
  private static instance: DeviceRegistry | null = null;

  // Primary storage: DeviceID → device info (most efficient lookup)
  private devices = new Map<DeviceID, RegisteredDevice>();

  // Lookup indices for fast runtime queries
  private nameToDevice = new Map<string, RegisteredDevice>();
  private bleAddressToDevice = new Map<string, RegisteredDevice>();

  // Event handlers for UI updates
  private changeHandlers = new Set<RegistryChangeHandler>();

  // File system paths for persistence
  private readonly REGISTRY_FILE: string;
  private readonly OVERRIDES_FILE: string;

  // PERFORMANCE FIX: Debounce file writes to prevent event loop blocking
  private saveTimeout: NodeJS.Timeout | null = null;
  private readonly SAVE_DEBOUNCE_MS = 500; // Wait 500ms before writing
  private pendingSave = false;

  private constructor() {
    // Use Electron's userData directory for persistence
    const userDataPath = app.getPath('userData');
    this.REGISTRY_FILE = path.join(userDataPath, 'device-registry.json');
    this.OVERRIDES_FILE = path.join(userDataPath, 'device-overrides.json');

    console.log(`📁 [DEVICE_REGISTRY] Storage path: ${userDataPath}`);
    this.loadFromFileSystem();
  }

  static getInstance(): DeviceRegistry {
    if (!DeviceRegistry.instance) {
      DeviceRegistry.instance = new DeviceRegistry();
    }
    return DeviceRegistry.instance;
  }

  /**
   * Register a device - called when device connects
   * Automatically identifies device and assigns ID
   *
   * @param bleAddress - BLE MAC address or iOS UUID
   * @param deviceName - Device name from BLE advertisement
   * @returns Registered device info, or null if device couldn't be identified
   */
  registerDevice(bleAddress: string, deviceName: string): RegisteredDevice | null {
    // Check for manual override first
    const manualMapping = this.getManualOverride(deviceName);
    let identification: DeviceIdentification | null;
    let isManual = false;

    if (manualMapping) {
      identification = manualMapping;
      isManual = true;
      console.log(`📌 [DEVICE_REGISTRY] Using manual override for "${deviceName}"`);
    } else {
      // Automatic identification
      identification = identifyDevice(deviceName);
      if (!identification) {
        console.error(`❌ [DEVICE_REGISTRY] Cannot identify device "${deviceName}" - no matching pattern`);
        return null;
      }
    }

    // Check if device already registered (by DeviceID)
    const existing = this.devices.get(identification.deviceID);
    if (existing) {
      // Update BLE address and name if changed
      existing.bleAddress = bleAddress;
      existing.deviceName = deviceName;
      existing.lastSeen = new Date();

      // Update lookup indices
      this.nameToDevice.set(deviceName, existing);
      this.bleAddressToDevice.set(bleAddress, existing);

      console.log(`♻️ [DEVICE_REGISTRY] Device "${deviceName}" already registered as ID 0x${existing.deviceID.toString(16)}`);
      this.notifyChanges();
      return existing;
    }

    // Create new registration
    const device: RegisteredDevice = {
      bleAddress,
      deviceName,
      deviceID: identification.deviceID,
      joint: identification.joint,
      position: identification.position,
      description: identification.description,
      registeredAt: new Date(),
      lastSeen: new Date(),
      isManualOverride: isManual
    };

    // Store in primary map (using DeviceID as key)
    this.devices.set(identification.deviceID, device);

    // Update lookup indices
    this.nameToDevice.set(deviceName, device);
    this.bleAddressToDevice.set(bleAddress, device);

    // Persist to file system
    this.saveToFileSystem();

    // Notify listeners
    this.notifyChanges();

    console.log(`✅ [DEVICE_REGISTRY] Registered "${deviceName}" (${bleAddress}) → ID 0x${device.deviceID.toString(16)} (${device.joint}, ${device.position})`);

    return device;
  }

  /**
   * Get device by DeviceID (primary key - most efficient)
   */
  getDeviceByID(deviceID: DeviceID): RegisteredDevice | undefined {
    return this.devices.get(deviceID);
  }

  /**
   * Get device by BLE address (lookup index)
   */
  getDeviceByAddress(bleAddress: string): RegisteredDevice | undefined {
    return this.bleAddressToDevice.get(bleAddress);
  }

  /**
   * Get device by name (lookup index)
   */
  getDeviceByName(deviceName: string): RegisteredDevice | undefined {
    return this.nameToDevice.get(deviceName);
  }

  /**
   * Get all devices assigned to a joint
   */
  getDevicesByJoint(jointName: string): RegisteredDevice[] {
    return Array.from(this.devices.values()).filter(d => d.joint === jointName);
  }

  /**
   * Get all registered devices
   */
  getAllDevices(): RegisteredDevice[] {
    return Array.from(this.devices.values());
  }

  /**
   * Unregister device (on disconnect)
   */
  unregisterDevice(bleAddress: string): boolean {
    const device = this.bleAddressToDevice.get(bleAddress);
    if (!device) return false;

    this.devices.delete(device.deviceID);
    this.nameToDevice.delete(device.deviceName);
    this.bleAddressToDevice.delete(bleAddress);

    this.saveToFileSystem();
    this.notifyChanges();

    console.log(`🔌 [DEVICE_REGISTRY] Unregistered "${device.deviceName}" (${bleAddress})`);
    return true;
  }

  /**
   * Update device last seen timestamp (called from data processing)
   * Can accept BLE address, device name, or DeviceID
   */
  updateLastSeen(deviceIdentifier: string | DeviceID): void {
    let device: RegisteredDevice | undefined;

    if (typeof deviceIdentifier === 'number') {
      device = this.devices.get(deviceIdentifier);
    } else {
      device = this.bleAddressToDevice.get(deviceIdentifier) || this.nameToDevice.get(deviceIdentifier);
    }

    if (device) {
      device.lastSeen = new Date();
    }
  }

  /**
   * Clear all devices (for reset/testing)
   */
  clearAll(): void {
    this.devices.clear();
    this.nameToDevice.clear();
    this.bleAddressToDevice.clear();
    this.saveToFileSystem();
    this.notifyChanges();
    console.log(`🧹 [DEVICE_REGISTRY] Cleared all devices`);
  }

  /**
   * Subscribe to registry changes (for UI updates)
   */
  onChange(handler: RegistryChangeHandler): () => void {
    this.changeHandlers.add(handler);
    // Immediately notify with current state
    handler(this.getAllDevices());
    // Return unsubscribe function
    return () => this.changeHandlers.delete(handler);
  }

  /**
   * Manual override: assign specific device to specific ID
   * Stored in file system separately from auto-detected devices
   */
  setManualOverride(deviceName: string, deviceID: DeviceID, joint: string, position: string): void {
    const overrides = this.loadManualOverrides();
    overrides[deviceName] = {
      deviceID,
      joint,
      position,
      description: `Manually assigned: ${deviceName}`,
      matchedBy: 'manual' as const
    };
    // ASYNC write - doesn't block event loop
    fs.promises.writeFile(this.OVERRIDES_FILE, JSON.stringify(overrides, null, 2))
      .then(() => console.log(`📌 [DEVICE_REGISTRY] Manual override set: "${deviceName}" → ID 0x${deviceID.toString(16)}`))
      .catch(error => console.error('Failed to save manual override:', error));
  }

  /**
   * Remove manual override for a device
   */
  removeManualOverride(deviceName: string): void {
    const overrides = this.loadManualOverrides();
    delete overrides[deviceName];
    // ASYNC write - doesn't block event loop
    fs.promises.writeFile(this.OVERRIDES_FILE, JSON.stringify(overrides, null, 2))
      .then(() => console.log(`🗑️ [DEVICE_REGISTRY] Manual override removed for "${deviceName}"`))
      .catch(error => console.error('Failed to remove manual override:', error));
  }

  /**
   * Get manual override for a device (if exists)
   */
  private getManualOverride(deviceName: string): DeviceIdentification | null {
    const overrides = this.loadManualOverrides();
    return overrides[deviceName] || null;
  }

  /**
   * Load manual overrides from file system
   */
  private loadManualOverrides(): Record<string, DeviceIdentification> {
    try {
      if (!fs.existsSync(this.OVERRIDES_FILE)) {
        return {};
      }
      const data = fs.readFileSync(this.OVERRIDES_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to load manual overrides:', error);
      return {};
    }
  }

  /**
   * Set clock offset for a device (from time synchronization)
   * Can accept BLE address, device name, or DeviceID
   */
  setClockOffset(deviceIdentifier: string | DeviceID, offsetMs: number, syncState?: DeviceSyncState): void {
    let device: RegisteredDevice | undefined;

    // Try to find device by different identifiers
    if (typeof deviceIdentifier === 'number') {
      // DeviceID (most efficient)
      device = this.devices.get(deviceIdentifier);
    } else {
      // BLE address or device name
      device = this.bleAddressToDevice.get(deviceIdentifier) || this.nameToDevice.get(deviceIdentifier);
    }

    if (device) {
      device.clockOffset = offsetMs;
      if (syncState) {
        device.syncState = syncState;
        console.log(`⏱️ [DEVICE_REGISTRY] Clock offset set for "${device.deviceName}": ${offsetMs.toFixed(2)}ms (sync state: ${syncState})`);
      } else {
        console.log(`⏱️ [DEVICE_REGISTRY] Clock offset set for "${device.deviceName}": ${offsetMs.toFixed(2)}ms`);
      }
      this.saveToFileSystem();
      this.notifyChanges();
    } else {
      console.warn(`⚠️ [DEVICE_REGISTRY] Cannot set clock offset: device "${deviceIdentifier}" not found`);
    }
  }

  /**
   * Get clock offset for a device (returns 0 if not set)
   * Can accept BLE address, device name, or DeviceID
   */
  getClockOffset(deviceIdentifier: string | DeviceID): number {
    let device: RegisteredDevice | undefined;

    if (typeof deviceIdentifier === 'number') {
      device = this.devices.get(deviceIdentifier);
    } else {
      device = this.bleAddressToDevice.get(deviceIdentifier) || this.nameToDevice.get(deviceIdentifier);
    }

    return device?.clockOffset ?? 0;
  }

  /**
   * Update device state (from state polling)
   * Can accept BLE address, device name, or DeviceID
   */
  setDeviceState(deviceIdentifier: string | DeviceID, stateName: string, stateValue: number): void {
    let device: RegisteredDevice | undefined;

    if (typeof deviceIdentifier === 'number') {
      device = this.devices.get(deviceIdentifier);
    } else {
      device = this.bleAddressToDevice.get(deviceIdentifier) || this.nameToDevice.get(deviceIdentifier);
    }

    if (device) {
      const previousState = device.deviceState;
      device.deviceState = stateName;
      device.deviceStateValue = stateValue;
      device.deviceStateLastUpdate = Date.now();

      // Only log and notify if state actually changed
      if (previousState !== stateName) {
        console.log(`📊 [DEVICE_REGISTRY] Device "${device.deviceName}" state: ${previousState || 'Unknown'} → ${stateName}`);
        this.notifyChanges();
      }
    }
  }

  /**
   * Set device as reconnecting
   * Can accept BLE address, device name, or DeviceID
   */
  setReconnecting(deviceIdentifier: string | DeviceID, attempts: number): void {
    let device: RegisteredDevice | undefined;

    if (typeof deviceIdentifier === 'number') {
      device = this.devices.get(deviceIdentifier);
    } else {
      device = this.bleAddressToDevice.get(deviceIdentifier) || this.nameToDevice.get(deviceIdentifier);
    }

    if (device) {
      device.isReconnecting = true;
      device.reconnectAttempts = attempts;
      console.log(`🔄 [DEVICE_REGISTRY] Device "${device.deviceName}" reconnecting (attempt ${attempts})`);
      this.notifyChanges();
    }
  }

  /**
   * Clear reconnecting state
   * Can accept BLE address, device name, or DeviceID
   */
  clearReconnecting(deviceIdentifier: string | DeviceID): void {
    let device: RegisteredDevice | undefined;

    if (typeof deviceIdentifier === 'number') {
      device = this.devices.get(deviceIdentifier);
    } else {
      device = this.bleAddressToDevice.get(deviceIdentifier) || this.nameToDevice.get(deviceIdentifier);
    }

    if (device) {
      device.isReconnecting = false;
      device.reconnectAttempts = 0;
      console.log(`✅ [DEVICE_REGISTRY] Device "${device.deviceName}" reconnecting cleared`);
      this.notifyChanges();
    }
  }

  /**
   * Remove device entirely from registry
   * Can accept BLE address, device name, or DeviceID
   */
  removeDevice(deviceIdentifier: string | DeviceID): boolean {
    let device: RegisteredDevice | undefined;

    if (typeof deviceIdentifier === 'number') {
      device = this.devices.get(deviceIdentifier);
    } else {
      device = this.bleAddressToDevice.get(deviceIdentifier) || this.nameToDevice.get(deviceIdentifier);
    }

    if (device) {
      this.devices.delete(device.deviceID);
      this.nameToDevice.delete(device.deviceName);
      this.bleAddressToDevice.delete(device.bleAddress);
      this.saveToFileSystem();
      this.notifyChanges();
      console.log(`🗑️ [DEVICE_REGISTRY] Removed device "${device.deviceName}" from registry`);
      return true;
    }
    return false;
  }

  /**
   * Notify all change handlers
   */
  private notifyChanges(): void {
    const devices = this.getAllDevices();
    this.changeHandlers.forEach(handler => {
      try {
        handler(devices);
      } catch (error) {
        console.error('Error in registry change handler:', error);
      }
    });
  }

  /**
   * Save registry to file system (debounced to prevent event loop blocking)
   * PERFORMANCE FIX: Uses async I/O with debouncing
   */
  private saveToFileSystem(): void {
    // Mark that we have pending changes
    this.pendingSave = true;

    // Clear existing timeout
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    // Debounce: Wait before writing to batch multiple updates
    this.saveTimeout = setTimeout(() => {
      this.flushToFileSystem();
    }, this.SAVE_DEBOUNCE_MS);
  }

  /**
   * Actually write to file system (async)
   */
  private async flushToFileSystem(): Promise<void> {
    if (!this.pendingSave) return;

    this.pendingSave = false;
    this.saveTimeout = null;

    try {
      const data = Array.from(this.devices.values()).map(device => ({
        ...device,
        registeredAt: device.registeredAt.toISOString(),
        lastSeen: device.lastSeen.toISOString()
      }));

      // ASYNC write - doesn't block event loop
      await fs.promises.writeFile(
        this.REGISTRY_FILE,
        JSON.stringify(data, null, 2)
      );

      console.log(`💾 [DEVICE_REGISTRY] Saved ${data.length} devices to file system (async)`);
    } catch (error) {
      console.error('Failed to save registry to file system:', error);
    }
  }

  /**
   * Load registry from file system
   */
  private loadFromFileSystem(): void {
    try {
      if (!fs.existsSync(this.REGISTRY_FILE)) {
        console.log(`📂 [DEVICE_REGISTRY] No existing registry file found - starting fresh`);
        return;
      }

      const fileData = fs.readFileSync(this.REGISTRY_FILE, 'utf-8');
      const devices: any[] = JSON.parse(fileData);

      devices.forEach(deviceData => {
        const device: RegisteredDevice = {
          ...deviceData,
          registeredAt: new Date(deviceData.registeredAt),
          lastSeen: new Date(deviceData.lastSeen),
          // Clear reconnecting state on app restart (stale from previous session)
          isReconnecting: false,
          reconnectAttempts: 0
        };
        // Store with DeviceID as primary key
        this.devices.set(device.deviceID, device);
        // Build lookup indices
        this.nameToDevice.set(device.deviceName, device);
        this.bleAddressToDevice.set(device.bleAddress, device);
      });

      console.log(`📂 [DEVICE_REGISTRY] Loaded ${devices.length} devices from file system`);
    } catch (error) {
      console.error('Failed to load registry from file system:', error);
    }
  }
}

// Export singleton instance
export const deviceRegistry = DeviceRegistry.getInstance();
