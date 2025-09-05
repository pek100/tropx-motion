/**
 * Integration layer between old and new systems
 * Provides backward compatibility while enabling performance improvements
 */

import { 
  DeviceState, 
  DeviceEvent, 
  DeviceInfo, 
  IMUData, 
  MotionData,
  WebRTCMessage,
  MessageType
} from '../core/types';
import { deviceStateMachine } from '../core/DeviceStateMachine';
import { streamDataManager } from '../core/StreamDataManager';
import { webRTCManager } from '../core/WebRTCManager';
import { museManager } from '../../muse_sdk/core/MuseManager';
import { motionProcessingCoordinator } from '../../motionProcessing/MotionProcessingCoordinator';
import { PERFORMANCE_CONSTANTS } from '../core/constants';

/**
 * Bridge between new performance-optimized system and existing components
 */
export class SystemIntegration {
  private static instance: SystemIntegration | null = null;
  private isInitialized: boolean = false;
  private webrtcConnectionId: string = `integration_${Date.now()}`;
  
  private constructor() {}

  static getInstance(): SystemIntegration {
    if (!SystemIntegration.instance) {
      SystemIntegration.instance = new SystemIntegration();
    }
    return SystemIntegration.instance;
  }

  /**
   * Initialize the integration layer
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('System integration already initialized');
      return;
    }

    try {
      console.log('🔧 Initializing system integration layer...');

      // Initialize WebRTC connection
      await this.initializeWebRTC();

      // Setup data flow bridges
      this.setupDataFlowBridges();

      // Setup legacy compatibility
      this.setupLegacyCompatibility();

      this.isInitialized = true;
      console.log('✅ System integration initialized successfully');

    } catch (error) {
      console.error('❌ Failed to initialize system integration:', error);
      throw error;
    }
  }

  /**
   * Bridge function for legacy WebSocket-based components
   */
  createLegacyWebSocketBridge(): {
    isConnected: boolean;
    sendMessage: (message: any) => void;
    subscribe: (callback: (message: any) => void) => () => void;
  } {
    const subscribers = new Set<(message: any) => void>();

    // Subscribe to WebRTC messages and convert to legacy format
    const unsubscribeWebRTC = webRTCManager.onMessage((message: WebRTCMessage) => {
      const legacyMessage = this.convertWebRTCToLegacyMessage(message);
      subscribers.forEach(callback => {
        try {
          callback(legacyMessage);
        } catch (error) {
          console.error('Legacy WebSocket bridge callback error:', error);
        }
      });
    });

    return {
      get isConnected() {
        return webRTCManager.getPerformanceMetrics().throughput.packetsPerSecond > 0;
      },
      
      sendMessage: (message: any) => {
        const webrtcMessage = this.convertLegacyToWebRTCMessage(message);
        webRTCManager.sendMessage(this.webrtcConnectionId, webrtcMessage);
      },
      
      subscribe: (callback: (message: any) => void) => {
        subscribers.add(callback);
        return () => {
          subscribers.delete(callback);
          if (subscribers.size === 0) {
            unsubscribeWebRTC();
          }
        };
      }
    };
  }

  /**
   * Bridge device state changes to legacy format
   */
  createDeviceStateBridge(): {
    getDevices: () => Array<{
      id: string;
      name: string;
      connected: boolean;
      batteryLevel: number | null;
      streaming?: boolean;
    }>;
    onDeviceStateChange: (callback: (devices: any[]) => void) => () => void;
  } {
    const stateChangeSubscribers = new Set<(devices: any[]) => void>();
    
    // Setup state machine listeners for all states
    const unsubscribers = Object.values(DeviceState).map(state => {
      return deviceStateMachine.onStateChange(state, () => {
        const legacyDevices = this.convertDevicesToLegacyFormat();
        stateChangeSubscribers.forEach(callback => {
          try {
            callback(legacyDevices);
          } catch (error) {
            console.error('Device state bridge callback error:', error);
          }
        });
      });
    });

    return {
      getDevices: () => this.convertDevicesToLegacyFormat(),
      
      onDeviceStateChange: (callback: (devices: any[]) => void) => {
        stateChangeSubscribers.add(callback);
        return () => {
          stateChangeSubscribers.delete(callback);
          if (stateChangeSubscribers.size === 0) {
            unsubscribers.forEach(unsub => unsub());
          }
        };
      }
    };
  }

  /**
   * Bridge motion data to legacy components
   */
  createMotionDataBridge(): {
    subscribe: (callback: (data: any) => void) => () => void;
    getCurrentData: () => any;
  } {
    const subscribers = new Set<(data: any) => void>();
    let currentData: any = null;

    const unsubscribe = streamDataManager.onMotionData((motionData: MotionData) => {
      const legacyData = this.convertMotionDataToLegacyFormat(motionData);
      currentData = legacyData;
      
      subscribers.forEach(callback => {
        try {
          callback(legacyData);
        } catch (error) {
          console.error('Motion data bridge callback error:', error);
        }
      });
    });

    return {
      subscribe: (callback: (data: any) => void) => {
        subscribers.add(callback);
        
        // Send current data immediately if available
        if (currentData) {
          try {
            callback(currentData);
          } catch (error) {
            console.error('Motion data bridge immediate callback error:', error);
          }
        }
        
        return () => {
          subscribers.delete(callback);
          if (subscribers.size === 0) {
            unsubscribe();
          }
        };
      },
      
      getCurrentData: () => currentData
    };
  }

  /**
   * Get performance metrics in legacy format
   */
  getPerformanceMetrics(): {
    dataRate: number;
    quality: string;
    connectedDevices: number;
    webrtcConnected: boolean;
    memoryUsage: number;
  } {
    const webrtcMetrics = webRTCManager.getPerformanceMetrics();
    const streamStats = streamDataManager.getStreamingStats();

    return {
      dataRate: streamStats?.totalDataRate || 0,
      quality: streamStats?.averageQuality || 'no_data',
      connectedDevices: streamStats?.deviceCount || 0,
      webrtcConnected: webrtcMetrics.throughput.packetsPerSecond > 0,
      memoryUsage: webrtcMetrics.resources.memoryUsage,
    };
  }

  // Private helper methods
  private async initializeWebRTC(): Promise<void> {
    try {
      await webRTCManager.createConnection(this.webrtcConnectionId);
      webRTCManager.createDataChannel(this.webrtcConnectionId, 'legacy-bridge');
      console.log('✅ WebRTC connection initialized for integration');
    } catch (error) {
      console.error('❌ Failed to initialize WebRTC for integration:', error);
      throw error;
    }
  }

  private setupDataFlowBridges(): void {
    // Bridge IMU data from old MuseManager to new StreamDataManager
    const originalStartStreaming = museManager.startStreaming.bind(museManager);
    museManager.startStreaming = async (callback) => {
      return originalStartStreaming(async (deviceName: string, imuData: IMUData) => {
        // Forward to new system
        streamDataManager.processIMUData(deviceName, deviceName, imuData);
        
        // Also call original callback for backward compatibility
        if (callback) {
          callback(deviceName, imuData);
        }
      });
    };

    console.log('✅ Data flow bridges established');
  }

  private setupLegacyCompatibility(): void {
    // Ensure motion processing coordinator is compatible
    if (!motionProcessingCoordinator.getInitializationStatus()) {
      console.warn('⚠️ Motion processing coordinator not initialized, some features may not work');
    }

    // Setup automatic state transitions for legacy components
    this.setupAutomaticStateTransitions();

    console.log('✅ Legacy compatibility layer established');
  }

  private setupAutomaticStateTransitions(): void {
    // Monitor MuseManager for automatic state transitions
    const originalConnectToScannedDevice = museManager.connectToScannedDevice.bind(museManager);
    museManager.connectToScannedDevice = async (deviceId: string, deviceName: string) => {
      try {
        // Trigger state machine transition
        await deviceStateMachine.transition(
          DeviceState.DISCONNECTED_AVAILABLE,
          DeviceEvent.CONNECT_REQUEST,
          { deviceId, metadata: { deviceName } }
        );

        const result = await originalConnectToScannedDevice(deviceId, deviceName);

        if (result) {
          await deviceStateMachine.transition(
            DeviceState.CONNECTING,
            DeviceEvent.CONNECTED,
            { deviceId }
          );
        } else {
          await deviceStateMachine.transition(
            DeviceState.CONNECTING,
            DeviceEvent.ERROR_OCCURRED,
            { deviceId }
          );
        }

        return result;
      } catch (error) {
        await deviceStateMachine.transition(
          DeviceState.CONNECTING,
          DeviceEvent.ERROR_OCCURRED,
          { deviceId, error: error as Error }
        );
        throw error;
      }
    };
  }

  private convertWebRTCToLegacyMessage(message: WebRTCMessage): any {
    switch (message.type) {
      case MessageType.IMU_DATA:
        return {
          type: 'motion_data',
          data: message.data,
          timestamp: message.timestamp
        };
      case MessageType.DEVICE_STATUS:
        return {
          type: 'device_status',
          data: message.data,
          timestamp: message.timestamp
        };
      case MessageType.HEARTBEAT:
        return {
          type: 'heartbeat',
          data: message.data,
          timestamp: message.timestamp
        };
      default:
        return {
          type: message.type.toLowerCase(),
          data: message.data,
          timestamp: message.timestamp
        };
    }
  }

  private convertLegacyToWebRTCMessage(legacyMessage: any): WebRTCMessage {
    let messageType: MessageType;
    
    switch (legacyMessage.type) {
      case 'motion_data':
        messageType = MessageType.IMU_DATA;
        break;
      case 'device_status':
        messageType = MessageType.DEVICE_STATUS;
        break;
      case 'heartbeat':
        messageType = MessageType.HEARTBEAT;
        break;
      default:
        messageType = MessageType.CONTROL;
    }

    return {
      type: messageType,
      deviceId: legacyMessage.deviceId || 'legacy',
      timestamp: legacyMessage.timestamp || Date.now(),
      data: legacyMessage.data
    };
  }

  private convertDevicesToLegacyFormat(): Array<{
    id: string;
    name: string;
    connected: boolean;
    batteryLevel: number | null;
    streaming?: boolean;
  }> {
    const devices: Array<any> = [];
    
    // Get devices from MuseManager (legacy source)
    const legacyDevices = museManager.getAllDevices();
    
    legacyDevices.forEach(device => {
      devices.push({
        id: device.id,
        name: device.name,
        connected: device.connected,
        batteryLevel: device.batteryLevel,
        streaming: device.connected // Simplified for legacy compatibility
      });
    });

    return devices;
  }

  private convertMotionDataToLegacyFormat(motionData: MotionData): any {
    return {
      left: {
        current: motionData.left.current,
        max: motionData.left.max,
        min: motionData.left.min,
        rom: motionData.left.rom
      },
      right: {
        current: motionData.right.current,
        max: motionData.right.max,
        min: motionData.right.min,
        rom: motionData.right.rom
      },
      timestamp: motionData.timestamp,
      quality: motionData.quality
    };
  }

  /**
   * Cleanup integration resources
   */
  cleanup(): void {
    if (this.webrtcConnectionId) {
      webRTCManager.closeConnection(this.webrtcConnectionId);
    }
    
    this.isInitialized = false;
    console.log('🧹 System integration cleaned up');
  }
}

// Export singleton instance
export const systemIntegration = SystemIntegration.getInstance();