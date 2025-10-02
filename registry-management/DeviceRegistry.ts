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
}

type RegistryChangeHandler = (devices: RegisteredDevice[]) => void;

/**
 * Device Registry - Singleton
 *
 * Manages device registration and provides lookup methods for runtime use.
 */
export class DeviceRegistry {
  private static instance: DeviceRegistry | null = null;

  // Primary storage: BLE address → device info
  private devices = new Map<string, RegisteredDevice>();

  // Lookup indices for fast runtime queries
  private nameToDevice = new Map<string, RegisteredDevice>();
  private deviceIDToDevices = new Map<DeviceID, RegisteredDevice[]>();

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

    // Check if device already registered
    const existing = this.devices.get(bleAddress);
    if (existing) {
      existing.lastSeen = new Date();
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

    // Store in primary map
    this.devices.set(bleAddress, device);

    // Update lookup indices
    this.nameToDevice.set(deviceName, device);
    this.addToDeviceIDIndex(identification.deviceID, device);

    // Persist to file system
    this.saveToFileSystem();

    // Notify listeners
    this.notifyChanges();

    console.log(`✅ [DEVICE_REGISTRY] Registered "${deviceName}" (${bleAddress}) → ID 0x${device.deviceID.toString(16)} (${device.joint}, ${device.position})`);

    return device;
  }

  /**
   * Get device by BLE address (for runtime lookup)
   */
  getDeviceByAddress(bleAddress: string): RegisteredDevice | undefined {
    return this.devices.get(bleAddress);
  }

  /**
   * Get device by name (for runtime lookup)
   */
  getDeviceByName(deviceName: string): RegisteredDevice | undefined {
    return this.nameToDevice.get(deviceName);
  }

  /**
   * Get all devices assigned to a specific device ID
   */
  getDevicesByID(deviceID: DeviceID): RegisteredDevice[] {
    return this.deviceIDToDevices.get(deviceID) || [];
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
    const device = this.devices.get(bleAddress);
    if (!device) return false;

    this.devices.delete(bleAddress);
    this.nameToDevice.delete(device.deviceName);
    this.removeFromDeviceIDIndex(device.deviceID, device);

    this.saveToFileSystem();
    this.notifyChanges();

    console.log(`🔌 [DEVICE_REGISTRY] Unregistered "${device.deviceName}" (${bleAddress})`);
    return true;
  }

  /**
   * Update device last seen timestamp (called from data processing)
   */
  updateLastSeen(bleAddress: string): void {
    const device = this.devices.get(bleAddress);
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
    this.deviceIDToDevices.clear();
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
   * Add device to deviceID index
   */
  private addToDeviceIDIndex(deviceID: DeviceID, device: RegisteredDevice): void {
    const devices = this.deviceIDToDevices.get(deviceID) || [];
    devices.push(device);
    this.deviceIDToDevices.set(deviceID, devices);
  }

  /**
   * Remove device from deviceID index
   */
  private removeFromDeviceIDIndex(deviceID: DeviceID, device: RegisteredDevice): void {
    const devices = this.deviceIDToDevices.get(deviceID) || [];
    const filtered = devices.filter(d => d.bleAddress !== device.bleAddress);
    if (filtered.length > 0) {
      this.deviceIDToDevices.set(deviceID, filtered);
    } else {
      this.deviceIDToDevices.delete(deviceID);
    }
  }

  /**
   * Set clock offset for a device (from time synchronization)
   */
  setClockOffset(bleAddress: string, offsetMs: number): void {
    const device = this.devices.get(bleAddress);
    if (device) {
      device.clockOffset = offsetMs;
      console.log(`⏱️ [DEVICE_REGISTRY] Clock offset set for "${device.deviceName}": ${offsetMs.toFixed(2)}ms`);
      this.saveToFileSystem();
      this.notifyChanges();
    } else {
      console.warn(`⚠️ [DEVICE_REGISTRY] Cannot set clock offset: device "${bleAddress}" not found`);
    }
  }

  /**
   * Get clock offset for a device (returns 0 if not set)
   */
  getClockOffset(bleAddress: string): number {
    const device = this.devices.get(bleAddress);
    return device?.clockOffset ?? 0;
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
          lastSeen: new Date(deviceData.lastSeen)
        };
        this.devices.set(device.bleAddress, device);
        this.nameToDevice.set(device.deviceName, device);
        this.addToDeviceIDIndex(device.deviceID, device);
      });

      console.log(`📂 [DEVICE_REGISTRY] Loaded ${devices.length} devices from file system`);
    } catch (error) {
      console.error('Failed to load registry from file system:', error);
    }
  }
}

// Export singleton instance
export const deviceRegistry = DeviceRegistry.getInstance();
