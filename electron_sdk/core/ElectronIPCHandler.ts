// electron_sdk/core/ElectronIPCHandler.ts
// Centralized IPC communication handler for the Electron BLE SDK

import type { 
  RecordingSessionData,
  IElectronIPCHandler 
} from './types';
import type { ApiResponse } from '../../electron/shared/types';

export class ElectronIPCHandler implements IElectronIPCHandler {
  
  constructor() {
    this.validateElectronAPI();
  }

  // Validation method to ensure electronAPI is available
  private validateElectronAPI(): void {
    if (!window.electronAPI) {
      throw new Error('ElectronAPI not available - ensure this is running in Electron renderer process');
    }
  }

  // Motion operations
  async getWebSocketPort(): Promise<number> {
    try {
      const port = await window.electronAPI!.motion.getWebSocketPort();
      console.log(`🌐 IPC: Got WebSocket port: ${port}`);
      return port;
    } catch (error) {
      console.error(`❌ IPC: Failed to get WebSocket port:`, error);
      throw new Error(`Failed to get WebSocket port: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async startRecording(sessionData: RecordingSessionData): Promise<ApiResponse> {
    try {
      console.log(`🎬 IPC: Starting recording session:`, sessionData);
      const result = await window.electronAPI!.motion.startRecording(sessionData);
      console.log(`✅ IPC: Start recording result:`, result);
      return result;
    } catch (error) {
      console.error(`❌ IPC: Failed to start recording:`, error);
      return {
        success: false,
        message: `Failed to start recording: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  async stopRecording(): Promise<ApiResponse> {
    try {
      console.log(`🛑 IPC: Stopping recording...`);
      const result = await window.electronAPI!.motion.stopRecording();
      console.log(`✅ IPC: Stop recording result:`, result);
      return result;
    } catch (error) {
      console.error(`❌ IPC: Failed to stop recording:`, error);
      return {
        success: false,
        message: `Failed to stop recording: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // Bluetooth operations
  async selectDevice(deviceId: string): Promise<ApiResponse> {
    try {
      console.log(`🔗 IPC: Selecting device: ${deviceId}`);
      const result = await window.electronAPI!.bluetooth.selectDevice(deviceId);
      console.log(`✅ IPC: Device selection result:`, result);
      return result;
    } catch (error) {
      console.error(`❌ IPC: Failed to select device ${deviceId}:`, error);
      return {
        success: false,
        message: `Failed to select device: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // Window operations
  async minimizeWindow(): Promise<void> {
    try {
      console.log(`🪟 IPC: Minimizing window...`);
      await window.electronAPI!.window.minimize();
      console.log(`✅ IPC: Window minimized`);
    } catch (error) {
      console.error(`❌ IPC: Failed to minimize window:`, error);
      throw new Error(`Failed to minimize window: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async maximizeWindow(): Promise<void> {
    try {
      console.log(`🪟 IPC: Maximizing window...`);
      await window.electronAPI!.window.maximize();
      console.log(`✅ IPC: Window maximized`);
    } catch (error) {
      console.error(`❌ IPC: Failed to maximize window:`, error);
      throw new Error(`Failed to maximize window: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async closeWindow(): Promise<void> {
    try {
      console.log(`🪟 IPC: Closing window...`);
      await window.electronAPI!.window.close();
      console.log(`✅ IPC: Window close initiated`);
    } catch (error) {
      console.error(`❌ IPC: Failed to close window:`, error);
      throw new Error(`Failed to close window: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Additional utility methods that might be needed

  // Get system info (already available via IPC)
  async getSystemInfo(): Promise<unknown> {
    try {
      console.log(`💻 IPC: Getting system info...`);
      const systemInfo = await window.electronAPI!.bluetooth.getSystemInfo();
      console.log(`✅ IPC: System info retrieved`);
      return systemInfo;
    } catch (error) {
      console.error(`❌ IPC: Failed to get system info:`, error);
      throw new Error(`Failed to get system info: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Check if electronAPI is available (useful for initialization)
  isElectronAPIAvailable(): boolean {
    return !!window.electronAPI;
  }

  // Get available electronAPI methods (useful for debugging)
  getAvailableMethods(): {
    window: string[];
    motion: string[];
    bluetooth: string[];
    system: string[];
  } {
    if (!window.electronAPI) {
      return { window: [], motion: [], bluetooth: [], system: [] };
    }

    return {
      window: Object.keys(window.electronAPI.window || {}),
      motion: Object.keys(window.electronAPI.motion || {}),
      bluetooth: Object.keys(window.electronAPI.bluetooth || {}),
      system: Object.keys(window.electronAPI.system || {}),
    };
  }

  // Cleanup method (for completeness)
  cleanup(): void {
    console.log(`🧹 IPC: ElectronIPCHandler cleanup complete`);
    // No specific cleanup needed for IPC handler, but method provided for consistency
  }
}