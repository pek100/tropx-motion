// electron_sdk/core/ElectronDeviceRegistry.ts
// Centralized device state management for the Electron BLE SDK

import type { 
  ElectronDevice, 
  ElectronDeviceState, 
  DeviceStateChangeCallback,
  IElectronDeviceRegistry 
} from './types';

export class ElectronDeviceRegistry implements IElectronDeviceRegistry {
  private devices: Map<string, ElectronDevice> = new Map();
  private changeCallbacks: Set<DeviceStateChangeCallback> = new Set();

  // Device management methods
  addDevice(device: ElectronDevice): void {
    const existingDevice = this.devices.get(device.id);
    
    // Update last seen time to current time
    const deviceWithTimestamp = {
      ...device,
      lastSeen: new Date()
    };
    
    this.devices.set(device.id, deviceWithTimestamp);
    
    // Notify listeners of the change
    this.notifyDeviceChange(device.id, deviceWithTimestamp);
    
    console.log(`📱 Registry: ${existingDevice ? 'Updated' : 'Added'} device: ${device.name} (${device.state})`);
  }

  updateDevice(deviceId: string, updates: Partial<ElectronDevice>): void {
    const existingDevice = this.devices.get(deviceId);
    if (!existingDevice) {
      console.warn(`⚠️ Registry: Cannot update non-existent device: ${deviceId}`);
      return;
    }

    const updatedDevice: ElectronDevice = {
      ...existingDevice,
      ...updates,
      lastSeen: new Date() // Always update the last seen time
    };

    this.devices.set(deviceId, updatedDevice);
    this.notifyDeviceChange(deviceId, updatedDevice);
    
    console.log(`🔄 Registry: Updated device ${existingDevice.name}: ${JSON.stringify(updates)}`);
  }

  removeDevice(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (!device) {
      console.warn(`⚠️ Registry: Cannot remove non-existent device: ${deviceId}`);
      return;
    }

    this.devices.delete(deviceId);
    console.log(`🗑️ Registry: Removed device: ${device.name}`);
    
    // Note: We don't notify listeners for removed devices to match current behavior
  }

  clearDevices(): void {
    const deviceCount = this.devices.size;
    this.devices.clear();
    console.log(`🧹 Registry: Cleared ${deviceCount} devices`);
  }

  // Device query methods
  getDevice(deviceId: string): ElectronDevice | null {
    return this.devices.get(deviceId) || null;
  }

  getDevices(): Map<string, ElectronDevice> {
    // Return a copy to prevent external mutation
    return new Map(this.devices);
  }

  getDevicesByState(state: ElectronDeviceState): ElectronDevice[] {
    return Array.from(this.devices.values()).filter(device => device.state === state);
  }

  getConnectedDevices(): ElectronDevice[] {
    return Array.from(this.devices.values()).filter(device => 
      device.state === "connected" || device.state === "streaming"
    );
  }

  // State transition methods
  transitionDeviceState(deviceId: string, newState: ElectronDeviceState): void {
    const device = this.devices.get(deviceId);
    if (!device) {
      console.warn(`⚠️ Registry: Cannot transition non-existent device: ${deviceId}`);
      return;
    }

    // Only update if state actually changed
    if (device.state !== newState) {
      this.updateDevice(deviceId, { state: newState });
      console.log(`🔄 Registry: Transitioned ${device.name}: ${device.state} → ${newState}`);
    }
  }

  // Special transition method for devices moving from connecting state
  transitionFromConnecting(deviceId: string, newState: ElectronDeviceState): void {
    const device = this.devices.get(deviceId);
    if (!device) {
      console.warn(`⚠️ Registry: Cannot transition non-existent device: ${deviceId}`);
      return;
    }

    // Only transition if device is currently connecting
    if (device.state === "connecting") {
      this.updateDevice(deviceId, { state: newState });
      console.log(`🔗 Registry: Transitioned ${device.name} from connecting → ${newState}`);
    } else {
      console.log(`ℹ️ Registry: Device ${device.name} not in connecting state (${device.state}), skipping transition`);
    }
  }

  // Clear non-connecting devices (mirrors current React logic)
  clearNonConnectingDevices(): void {
    const devicesToKeep = new Map<string, ElectronDevice>();
    
    this.devices.forEach((device, id) => {
      // Preserve connecting, connected, and streaming devices
      if (device.state === "connecting" || device.state === "connected" || device.state === "streaming") {
        devicesToKeep.set(id, device);
      }
    });

    const removedCount = this.devices.size - devicesToKeep.size;
    this.devices = devicesToKeep;
    
    console.log(`🧹 Registry: Cleared ${removedCount} non-connecting devices, kept ${devicesToKeep.size} active devices`);
  }

  // Event handling
  onDeviceChange(callback: DeviceStateChangeCallback): () => void {
    this.changeCallbacks.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.changeCallbacks.delete(callback);
    };
  }

  private notifyDeviceChange(deviceId: string, device: ElectronDevice): void {
    this.changeCallbacks.forEach(callback => {
      try {
        callback(deviceId, device);
      } catch (error) {
        console.error(`❌ Registry: Error in device change callback:`, error);
      }
    });
  }

  // Utility methods
  getDeviceCount(): number {
    return this.devices.size;
  }

  getConnectedDeviceCount(): number {
    return this.getConnectedDevices().length;
  }

  getDevicesByStateCount(state: ElectronDeviceState): number {
    return this.getDevicesByState(state).length;
  }

  // Debug method to get registry state
  getRegistryState(): {
    totalDevices: number;
    deviceStates: Record<ElectronDeviceState, number>;
    devices: ElectronDevice[];
  } {
    const devices = Array.from(this.devices.values());
    
    const deviceStates: Record<ElectronDeviceState, number> = {
      discovered: 0,
      connecting: 0,
      connected: 0,
      streaming: 0,
      disconnected: 0,
      error: 0
    };

    devices.forEach(device => {
      deviceStates[device.state]++;
    });

    return {
      totalDevices: devices.length,
      deviceStates,
      devices
    };
  }

  // Clean up method
  cleanup(): void {
    console.log(`🧹 Registry: Cleaning up registry with ${this.devices.size} devices`);
    this.devices.clear();
    this.changeCallbacks.clear();
  }
}