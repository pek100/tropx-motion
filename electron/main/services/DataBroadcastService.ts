import { CONFIG, MESSAGE_TYPES } from '../../shared/config';
import { WSMessage, MotionDataUpdate, DeviceInfo, RecordingSession } from '../../shared/types';

export class DataBroadcastService {
  private subscribers = new Set<(message: WSMessage) => void>();

  // Subscribe to data broadcasts
  subscribe(callback: (message: WSMessage) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  // Broadcast motion data update
  broadcastMotionData(data: MotionDataUpdate): void {
    this.broadcast({
      type: MESSAGE_TYPES.MOTION_DATA,
      data,
      timestamp: Date.now()
    });
  }

  // Broadcast device status update
  broadcastDeviceStatus(devices: DeviceInfo[], batteryLevels: Record<string, number>): void {
    this.broadcast({
      type: MESSAGE_TYPES.DEVICE_STATUS,
      data: {
        connectedDevices: devices.filter(d => d.connected),
        batteryLevels,
        totalDevices: devices.length
      },
      timestamp: Date.now()
    });
  }

  // Broadcast recording state change
  broadcastRecordingState(isRecording: boolean, session?: RecordingSession): void {
    this.broadcast({
      type: MESSAGE_TYPES.RECORDING_STATE,
      data: {
        isRecording,
        startTime: session ? new Date().toISOString() : undefined,
        sessionId: session?.sessionId
      },
      timestamp: Date.now()
    });
  }

  // Broadcast device scan results
  broadcastScanResults(devices: DeviceInfo[], success: boolean, message: string): void {
    this.broadcast({
      type: MESSAGE_TYPES.DEVICE_SCAN_RESULT,
      data: {
        devices,
        success,
        message,
        scanComplete: true
      },
      timestamp: Date.now()
    });
  }

  // Broadcast battery level updates
  broadcastBatteryUpdate(batteryLevels: Record<string, number>): void {
    this.broadcast({
      type: MESSAGE_TYPES.BATTERY_UPDATE,
      data: { batteryLevels },
      timestamp: Date.now()
    });
  }

  cleanup(): void {
    this.subscribers.clear();
  }

  // Send message to all subscribers
  private broadcast(message: WSMessage): void {
    if (this.subscribers.size === 0) return;

    this.subscribers.forEach(callback => {
      try {
        callback(message);
      } catch (error) {
        console.error('Error in broadcast subscriber:', error);
      }
    });
  }
}