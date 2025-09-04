/**
 * BLE Device Manager Tests
 * 
 * This file validates the behavior of the centralized BLE Device Manager
 * to ensure race conditions are fixed and streaming is properly controlled.
 */

import { BLEDeviceManager } from './BLEDeviceManager';
import { DeviceState, DeviceEvent } from './types';

// Mock navigator.bluetooth
Object.defineProperty(navigator, 'bluetooth', {
  writable: true,
  value: {
    requestDevice: jest.fn()
  }
});

// Mock MuseManager
jest.mock('../../sdk/core/MuseManager', () => ({
  museManager: {
    scanForDevices: jest.fn(),
    connectToScannedDevice: jest.fn(),
    disconnectDevice: jest.fn(),
    startStreaming: jest.fn(),
    stopStreaming: jest.fn(),
    updateBatteryLevel: jest.fn(),
    getBatteryLevel: jest.fn()
  }
}));

// Mock DeviceStateMachine
jest.mock('./DeviceStateMachine', () => ({
  deviceStateMachine: {
    transition: jest.fn(),
    onStateChange: jest.fn(() => () => {}), // Return unsubscribe function
    reset: jest.fn()
  }
}));

// Mock StreamDataManager
jest.mock('./StreamDataManager', () => ({
  streamDataManager: {
    processIMUData: jest.fn(),
    startStreamingSession: jest.fn()
  }
}));

describe('BLEDeviceManager', () => {
  let manager: BLEDeviceManager;
  
  beforeEach(() => {
    // Reset singleton
    BLEDeviceManager.reset();
    manager = BLEDeviceManager.getInstance();
    
    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    manager.cleanup();
  });

  describe('Initialization', () => {
    test('should initialize successfully', async () => {
      await expect(manager.initialize()).resolves.not.toThrow();
    });

    test('should not initialize twice', async () => {
      await manager.initialize();
      const consoleSpy = jest.spyOn(console, 'log');
      await manager.initialize();
      expect(consoleSpy).toHaveBeenCalledWith('🔄 BLE Device Manager already initialized');
    });

    test('should throw error if Web Bluetooth not available', async () => {
      // Temporarily remove bluetooth
      const originalBluetooth = navigator.bluetooth;
      (navigator as any).bluetooth = undefined;
      
      const newManager = BLEDeviceManager.getInstance();
      await expect(newManager.initialize()).rejects.toThrow('Web Bluetooth is not supported');
      
      // Restore bluetooth
      (navigator as any).bluetooth = originalBluetooth;
    });
  });

  describe('Device Scanning', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    test('should scan for devices successfully', async () => {
      const mockDevices = [
        { id: 'device1', name: 'TropX_LN_top' },
        { id: 'device2', name: 'TropX_RN_bottom' }
      ];
      
      require('../../sdk/core/MuseManager').museManager.scanForDevices.mockResolvedValue(mockDevices);
      
      const devices = await manager.scanForDevices();
      
      expect(devices).toHaveLength(2);
      expect(devices[0].name).toBe('TropX_LN_top');
      expect(devices[0].state).toBe(DeviceState.DISCONNECTED_AVAILABLE);
    });

    test('should handle scanning when already in progress', async () => {
      require('../../sdk/core/MuseManager').museManager.scanForDevices.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 100))
      );
      
      const consoleSpy = jest.spyOn(console, 'warn');
      const scanPromise1 = manager.scanForDevices();
      const scanPromise2 = manager.scanForDevices(); // Should warn
      
      await Promise.all([scanPromise1, scanPromise2]);
      expect(consoleSpy).toHaveBeenCalledWith('⚠️ Scan already in progress');
    });

    test('should clear previous scan results', async () => {
      // First scan
      const mockDevices1 = [{ id: 'device1', name: 'Device1' }];
      require('../../sdk/core/MuseManager').museManager.scanForDevices.mockResolvedValue(mockDevices1);
      await manager.scanForDevices();
      
      // Second scan with different devices
      const mockDevices2 = [{ id: 'device2', name: 'Device2' }];
      require('../../sdk/core/MuseManager').museManager.scanForDevices.mockResolvedValue(mockDevices2);
      await manager.scanForDevices();
      
      const devices = manager.getDevices();
      expect(devices.size).toBe(1);
      expect(devices.get('device2')?.name).toBe('Device2');
    });
  });

  describe('Device Connection', () => {
    beforeEach(async () => {
      await manager.initialize();
      
      // Setup mock devices
      const mockDevices = [{ id: 'device1', name: 'TestDevice' }];
      require('../../sdk/core/MuseManager').museManager.scanForDevices.mockResolvedValue(mockDevices);
      await manager.scanForDevices();
    });

    test('should connect device successfully', async () => {
      require('../../sdk/core/MuseManager').museManager.connectToScannedDevice.mockResolvedValue(true);
      require('../../sdk/core/MuseManager').museManager.getBatteryLevel.mockReturnValue(85);
      
      const success = await manager.connectDevice('device1');
      
      expect(success).toBe(true);
      const device = manager.getDevice('device1');
      expect(device?.state).toBe(DeviceState.CONNECTED_IDLE);
    });

    test('should handle connection failure', async () => {
      require('../../sdk/core/MuseManager').museManager.connectToScannedDevice.mockResolvedValue(false);
      
      const success = await manager.connectDevice('device1');
      
      expect(success).toBe(false);
      const device = manager.getDevice('device1');
      expect(device?.state).toBe(DeviceState.ERROR);
    });

    test('should prevent race conditions with connection locking', async () => {
      let connectCallCount = 0;
      require('../../sdk/core/MuseManager').museManager.connectToScannedDevice.mockImplementation(() => {
        connectCallCount++;
        return new Promise(resolve => setTimeout(() => resolve(true), 100));
      });
      
      // Start two connections simultaneously
      const promise1 = manager.connectDevice('device1');
      const promise2 = manager.connectDevice('device1');
      
      await Promise.all([promise1, promise2]);
      
      // Should only call connect once due to locking
      expect(connectCallCount).toBe(1);
    });

    test('should throw error for unknown device', async () => {
      await expect(manager.connectDevice('unknown')).rejects.toThrow('Device unknown not found');
    });
  });

  describe('Recording Mode and Streaming Control', () => {
    beforeEach(async () => {
      await manager.initialize();
      
      // Setup connected device
      const mockDevices = [{ id: 'device1', name: 'TestDevice' }];
      require('../../sdk/core/MuseManager').museManager.scanForDevices.mockResolvedValue(mockDevices);
      require('../../sdk/core/MuseManager').museManager.connectToScannedDevice.mockResolvedValue(true);
      require('../../sdk/core/MuseManager').museManager.startStreaming.mockResolvedValue(true);
      
      await manager.scanForDevices();
      await manager.connectDevice('device1');
    });

    test('should start recording mode and enable streaming', async () => {
      expect(manager.isRecording()).toBe(false);
      
      const success = await manager.startRecording();
      
      expect(success).toBe(true);
      expect(manager.isRecording()).toBe(true);
      
      const device = manager.getDevice('device1');
      expect(device?.state).toBe(DeviceState.STREAMING);
    });

    test('should stop recording mode and disable streaming', async () => {
      await manager.startRecording();
      expect(manager.isRecording()).toBe(true);
      
      await manager.stopRecording();
      
      expect(manager.isRecording()).toBe(false);
      const device = manager.getDevice('device1');
      expect(device?.state).toBe(DeviceState.CONNECTED_IDLE);
    });

    test('should not allow streaming without recording mode', async () => {
      // Device is connected but not recording
      expect(manager.isRecording()).toBe(false);
      
      const device = manager.getDevice('device1');
      expect(device?.state).toBe(DeviceState.CONNECTED_IDLE);
      
      // No streaming should occur automatically
      expect(require('../../sdk/core/MuseManager').museManager.startStreaming).not.toHaveBeenCalled();
    });

    test('should handle recording start with no connected devices', async () => {
      // Disconnect the device first
      await manager.disconnectDevice('device1');
      
      const success = await manager.startRecording();
      expect(success).toBe(false);
    });

    test('should prevent duplicate recording start', async () => {
      await manager.startRecording();
      
      const consoleSpy = jest.spyOn(console, 'warn');
      const success = await manager.startRecording();
      
      expect(success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('⚠️ Recording mode already active');
    });
  });

  describe('Device Disconnection', () => {
    beforeEach(async () => {
      await manager.initialize();
      
      // Setup connected and streaming device
      const mockDevices = [{ id: 'device1', name: 'TestDevice' }];
      require('../../sdk/core/MuseManager').museManager.scanForDevices.mockResolvedValue(mockDevices);
      require('../../sdk/core/MuseManager').museManager.connectToScannedDevice.mockResolvedValue(true);
      require('../../sdk/core/MuseManager').museManager.startStreaming.mockResolvedValue(true);
      require('../../sdk/core/MuseManager').museManager.disconnectDevice.mockResolvedValue(true);
      
      await manager.scanForDevices();
      await manager.connectDevice('device1');
      await manager.startRecording();
    });

    test('should disconnect streaming device and stop streaming', async () => {
      const device = manager.getDevice('device1');
      expect(device?.state).toBe(DeviceState.STREAMING);
      
      const success = await manager.disconnectDevice('device1');
      
      expect(success).toBe(true);
      expect(device?.state).toBe(DeviceState.DISCONNECTED_AVAILABLE);
      expect(require('../../sdk/core/MuseManager').museManager.stopStreaming).toHaveBeenCalled();
    });

    test('should handle disconnection of unknown device', async () => {
      const consoleSpy = jest.spyOn(console, 'warn');
      const success = await manager.disconnectDevice('unknown');
      
      expect(success).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith('⚠️ Device unknown not found for disconnection');
    });
  });

  describe('Event Listeners', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    test('should notify state change listeners', async () => {
      const mockListener = jest.fn();
      const unsubscribe = manager.onStateChange(mockListener);
      
      // Trigger a state change by scanning
      const mockDevices = [{ id: 'device1', name: 'TestDevice' }];
      require('../../sdk/core/MuseManager').museManager.scanForDevices.mockResolvedValue(mockDevices);
      await manager.scanForDevices();
      
      expect(mockListener).toHaveBeenCalled();
      
      unsubscribe();
    });

    test('should notify data listeners during streaming', async () => {
      const mockDataListener = jest.fn();
      manager.onData(mockDataListener);
      
      // Setup streaming
      const mockDevices = [{ id: 'device1', name: 'TestDevice' }];
      require('../../sdk/core/MuseManager').museManager.scanForDevices.mockResolvedValue(mockDevices);
      require('../../sdk/core/MuseManager').museManager.connectToScannedDevice.mockResolvedValue(true);
      
      let streamingCallback: Function | null = null;
      require('../../sdk/core/MuseManager').museManager.startStreaming.mockImplementation((callback: Function) => {
        streamingCallback = callback;
        return Promise.resolve(true);
      });
      
      await manager.scanForDevices();
      await manager.connectDevice('device1');
      await manager.startRecording();
      
      // Simulate data reception
      if (streamingCallback) {
        const mockIMUData = { timestamp: Date.now(), quaternion: { w: 1, x: 0, y: 0, z: 0 } };
        streamingCallback('TestDevice', mockIMUData);
      }
      
      expect(mockDataListener).toHaveBeenCalledWith('device1', expect.any(Object));
    });

    test('should notify error listeners', async () => {
      const mockErrorListener = jest.fn();
      manager.onError(mockErrorListener);
      
      // Trigger error by connecting to non-existent device
      await expect(manager.connectDevice('nonexistent')).rejects.toThrow();
      expect(mockErrorListener).toHaveBeenCalled();
    });
  });

  describe('Cleanup', () => {
    test('should cleanup all resources', async () => {
      await manager.initialize();
      
      // Setup some state
      const mockDevices = [{ id: 'device1', name: 'TestDevice' }];
      require('../../sdk/core/MuseManager').museManager.scanForDevices.mockResolvedValue(mockDevices);
      require('../../sdk/core/MuseManager').museManager.connectToScannedDevice.mockResolvedValue(true);
      
      await manager.scanForDevices();
      await manager.connectDevice('device1');
      await manager.startRecording();
      
      // Cleanup
      await manager.cleanup();
      
      expect(manager.getDevices().size).toBe(0);
      expect(manager.isRecording()).toBe(false);
    });
  });
});

/**
 * Integration Test Suite
 * Tests the complete flow from scanning to streaming
 */
describe('BLE Device Manager Integration', () => {
  let manager: BLEDeviceManager;
  
  beforeEach(() => {
    BLEDeviceManager.reset();
    manager = BLEDeviceManager.getInstance();
    jest.clearAllMocks();
  });

  test('complete workflow: scan -> connect -> record -> stop -> disconnect', async () => {
    // Setup mocks
    const mockDevices = [
      { id: 'tropx_ln_top', name: 'TropX_LN_top' },
      { id: 'tropx_rn_bottom', name: 'TropX_RN_bottom' }
    ];
    
    require('../../sdk/core/MuseManager').museManager.scanForDevices.mockResolvedValue(mockDevices);
    require('../../sdk/core/MuseManager').museManager.connectToScannedDevice.mockResolvedValue(true);
    require('../../sdk/core/MuseManager').museManager.startStreaming.mockResolvedValue(true);
    require('../../sdk/core/MuseManager').museManager.getBatteryLevel.mockReturnValue(75);
    
    // Initialize
    await manager.initialize();
    
    // 1. Scan for devices
    const scannedDevices = await manager.scanForDevices();
    expect(scannedDevices).toHaveLength(2);
    expect(scannedDevices[0].state).toBe(DeviceState.DISCONNECTED_AVAILABLE);
    
    // 2. Connect to devices
    const connected1 = await manager.connectDevice('tropx_ln_top');
    const connected2 = await manager.connectDevice('tropx_rn_bottom');
    expect(connected1).toBe(true);
    expect(connected2).toBe(true);
    
    // Verify connected state
    expect(manager.getDevice('tropx_ln_top')?.state).toBe(DeviceState.CONNECTED_IDLE);
    expect(manager.getDevice('tropx_rn_bottom')?.state).toBe(DeviceState.CONNECTED_IDLE);
    
    // 3. Start recording (should trigger streaming)
    const recordingStarted = await manager.startRecording();
    expect(recordingStarted).toBe(true);
    expect(manager.isRecording()).toBe(true);
    
    // Verify streaming state
    expect(manager.getDevice('tropx_ln_top')?.state).toBe(DeviceState.STREAMING);
    expect(manager.getDevice('tropx_rn_bottom')?.state).toBe(DeviceState.STREAMING);
    
    // 4. Stop recording (should stop streaming but keep connected)
    await manager.stopRecording();
    expect(manager.isRecording()).toBe(false);
    
    // Verify back to connected idle
    expect(manager.getDevice('tropx_ln_top')?.state).toBe(DeviceState.CONNECTED_IDLE);
    expect(manager.getDevice('tropx_rn_bottom')?.state).toBe(DeviceState.CONNECTED_IDLE);
    
    // 5. Disconnect devices
    await manager.disconnectDevice('tropx_ln_top');
    await manager.disconnectDevice('tropx_rn_bottom');
    
    // Verify disconnected
    expect(manager.getDevice('tropx_ln_top')?.state).toBe(DeviceState.DISCONNECTED_AVAILABLE);
    expect(manager.getDevice('tropx_rn_bottom')?.state).toBe(DeviceState.DISCONNECTED_AVAILABLE);
  });

  test('should handle partial connection failures gracefully', async () => {
    const mockDevices = [
      { id: 'device1', name: 'WorkingDevice' },
      { id: 'device2', name: 'BrokenDevice' }
    ];
    
    require('../../sdk/core/MuseManager').museManager.scanForDevices.mockResolvedValue(mockDevices);
    require('../../sdk/core/MuseManager').museManager.connectToScannedDevice
      .mockImplementation((deviceId: string) => deviceId === 'device1');
    require('../../sdk/core/MuseManager').museManager.startStreaming.mockResolvedValue(true);
    
    await manager.initialize();
    
    // Scan
    await manager.scanForDevices();
    
    // Try to connect both (one should fail)
    const success1 = await manager.connectDevice('device1');
    const success2 = await manager.connectDevice('device2');
    
    expect(success1).toBe(true);
    expect(success2).toBe(false);
    
    // Start recording with partial connections
    const recordingStarted = await manager.startRecording();
    expect(recordingStarted).toBe(true); // Should succeed with at least one device
    
    // Verify states
    expect(manager.getDevice('device1')?.state).toBe(DeviceState.STREAMING);
    expect(manager.getDevice('device2')?.state).toBe(DeviceState.ERROR);
  });
});

export {};