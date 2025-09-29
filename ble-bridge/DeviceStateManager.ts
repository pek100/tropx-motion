/**
 * Centralized device state management - single source of truth for all device states
 * Provides session-based persistence and immediate state synchronization
 */

import { EventEmitter } from 'events';
import { TropXDeviceInfo, DeviceConnectionState } from './BleBridgeTypes';

export enum GlobalStreamingState {
  STOPPED = 'stopped',
  STARTING = 'starting',
  ACTIVE = 'active',
  STOPPING = 'stopping'
}

export interface ManagedDevice extends TropXDeviceInfo {
  state: DeviceConnectionState;
  lastConnected?: Date;
  lastStreamed?: Date;
  connectionAttempts: number;
  isManaged: boolean;
}

export interface StateChangeEvent {
  deviceId: string;
  previousState: DeviceConnectionState;
  newState: DeviceConnectionState;
  device: ManagedDevice;
}

export interface GlobalStreamingChangeEvent {
  previousState: GlobalStreamingState;
  newState: GlobalStreamingState;
  affectedDevices: string[];
}

export class DeviceConnectionStateManager extends EventEmitter {
  private static instance: DeviceConnectionStateManager;
  private devices = new Map<string, ManagedDevice>();
  private globalStreamingState = GlobalStreamingState.STOPPED;

  private constructor() {
    super();
  }

  static getInstance(): DeviceConnectionStateManager {
    if (!DeviceConnectionStateManager.instance) {
      DeviceConnectionStateManager.instance = new DeviceConnectionStateManager();
    }
    return DeviceConnectionStateManager.instance;
  }

  // Device state management
  updateDevice(deviceInfo: TropXDeviceInfo, newState?: DeviceConnectionState): ManagedDevice {
    const existingDevice = this.devices.get(deviceInfo.id);
    const currentState = newState || (existingDevice?.state ?? 'discovered');

    const managedDevice: ManagedDevice = {
      ...deviceInfo,
      state: currentState,
      lastConnected: existingDevice?.lastConnected,
      lastStreamed: existingDevice?.lastStreamed,
      connectionAttempts: existingDevice?.connectionAttempts ?? 0,
      isManaged: true
    };

    // Update timestamps based on state
    if (currentState === 'connected') {
      managedDevice.lastConnected = new Date();
    }
    if (currentState === 'streaming') {
      managedDevice.lastStreamed = new Date();
    }

    const previousState = existingDevice?.state ?? 'disconnected';
    this.devices.set(deviceInfo.id, managedDevice);

    // Emit immediate state change
    if (previousState !== currentState) {
      this.emit('deviceStateChanged', {
        deviceId: deviceInfo.id,
        previousState,
        newState: currentState,
        device: managedDevice
      } as StateChangeEvent);
    }

    return managedDevice;
  }

  setDeviceConnectionState(deviceId: string, newState: DeviceConnectionState): boolean {
    const device = this.devices.get(deviceId);
    if (!device) return false;

    const previousState = device.state;
    device.state = newState;

    // Update relevant timestamps
    if (newState === 'connected') {
      device.lastConnected = new Date();
    }
    if (newState === 'streaming') {
      device.lastStreamed = new Date();
    }
    if (newState === 'connecting') {
      device.connectionAttempts++;
    }

    this.emit('deviceStateChanged', {
      deviceId,
      previousState,
      newState,
      device
    } as StateChangeEvent);

    return true;
  }

  getDevice(deviceId: string): ManagedDevice | undefined {
    return this.devices.get(deviceId);
  }

  getAllDevices(): ManagedDevice[] {
    return Array.from(this.devices.values());
  }

  getDevicesByState(state: DeviceConnectionState): ManagedDevice[] {
    return Array.from(this.devices.values()).filter(device => device.state === state);
  }

  removeDevice(deviceId: string): boolean {
    return this.devices.delete(deviceId);
  }

  // Global streaming state management
  setGlobalStreamingState(newState: GlobalStreamingState): void {
    if (this.globalStreamingState === newState) return;

    const previousState = this.globalStreamingState;
    this.globalStreamingState = newState;

    const affectedDevices = this.getConnectedDeviceIds();

    this.emit('globalStreamingStateChanged', {
      previousState,
      newState,
      affectedDevices
    } as GlobalStreamingChangeEvent);
  }

  getGlobalStreamingState(): GlobalStreamingState {
    return this.globalStreamingState;
  }

  isGlobalStreamingActive(): boolean {
    return this.globalStreamingState === GlobalStreamingState.ACTIVE;
  }

  // Utility methods
  getConnectedDevices(): ManagedDevice[] {
    return this.getDevicesByState('connected')
      .concat(this.getDevicesByState('streaming'));
  }

  getConnectedDeviceIds(): string[] {
    return this.getConnectedDevices().map(device => device.id);
  }

  getStreamingDevices(): ManagedDevice[] {
    return this.getDevicesByState('streaming');
  }

  getDiscoveredDevices(): ManagedDevice[] {
    return this.getDevicesByState('discovered');
  }

  // Session management
  clearAllDevices(): void {
    const deviceIds = Array.from(this.devices.keys());
    this.devices.clear();
    this.emit('allDevicesCleared', { deviceIds });
  }

  // Debugging/monitoring
  getStateSnapshot(): Record<string, any> {
    return {
      deviceCount: this.devices.size,
      globalStreamingState: this.globalStreamingState,
      deviceStates: Object.fromEntries(
        Array.from(this.devices.entries()).map(([id, device]) => [
          id,
          { name: device.name, state: device.state, rssi: device.rssi }
        ])
      )
    };
  }
}

// Export singleton instance
export const deviceStateManager = DeviceConnectionStateManager.getInstance();