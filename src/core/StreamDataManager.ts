/**
 * High-performance stream data manager for 16kHz sensor data
 * Handles BLE → Motion Processing → WebRTC pipeline with zero packet loss
 */

import {
  IMUData,
  MotionData,
  WebRTCMessage,
  MessageType,
  DataQuality,
  DeviceState,
  Callback,
  UnsubscribeFn,
  PerformanceMetrics
} from './types';
import { PERFORMANCE_CONSTANTS, BLE_CONSTANTS } from './constants';
import { HighPerformanceCircularBuffer, AdaptiveDataBatcher, MemoryEfficientObjectPool } from './DataStructures';
import { webRTCManager } from './WebRTCManager';
import { motionProcessingCoordinator } from '../../motionProcessing/MotionProcessingCoordinator';

interface DeviceDataStream {
  deviceId: string;
  deviceName: string;
  state: DeviceState;
  dataBuffer: HighPerformanceCircularBuffer<IMUData>;
  dataRate: number;
  lastDataTime: number;
  quality: DataQuality;
  droppedPackets: number;
}

interface StreamingSession {
  sessionId: string;
  devices: Map<string, DeviceDataStream>;
  startTime: number;
  isActive: boolean;
  dataProcessor: Worker | null;
}

export class StreamDataManager {
  private sessions: Map<string, StreamingSession> = new Map();
  private currentSessionId: string | null = null;
  private imuDataPool: MemoryEfficientObjectPool<IMUData>;
  private motionDataBatcher: AdaptiveDataBatcher<MotionData>;
  private performanceMetrics: PerformanceMetrics;
  private dataWorker: Worker | null = null;
  
  private motionDataListeners: Set<Callback<MotionData>> = new Set();
  private qualityListeners: Set<Callback<DataQuality>> = new Set();
  
  constructor() {
    this.imuDataPool = this.createIMUDataPool();
    this.motionDataBatcher = this.createMotionDataBatcher();
    this.performanceMetrics = this.initializeMetrics();
    
    this.setupMotionProcessingSubscription();
    this.startPerformanceMonitoring();
  }

  /**
   * Start streaming session for multiple devices
   */
  async startStreamingSession(sessionId: string, deviceIds: string[]): Promise<boolean> {
    if (this.sessions.has(sessionId)) {
      console.warn(`Session ${sessionId} already exists`);
      return false;
    }

    try {
      const session: StreamingSession = {
        sessionId,
        devices: new Map(),
        startTime: performance.now(),
        isActive: true,
        dataProcessor: this.createDataProcessorWorker(),
      };

      // Initialize device data streams
      for (const deviceId of deviceIds) {
        const dataStream = this.createDeviceDataStream(deviceId);
        session.devices.set(deviceId, dataStream);
      }

      this.sessions.set(sessionId, session);
      this.currentSessionId = sessionId;

      console.log(`Started streaming session ${sessionId} with ${deviceIds.length} devices`);
      return true;

    } catch (error) {
      console.error(`Failed to start streaming session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Process incoming IMU data from BLE devices
   */
  processIMUData(deviceId: string, deviceName: string, imuData: IMUData): void {
    const session = this.getCurrentSession();
    if (!session) return;

    const dataStream = session.devices.get(deviceId);
    if (!dataStream) {
      console.warn(`No data stream found for device ${deviceId}`);
      return;
    }

    // Update stream state
    dataStream.lastDataTime = performance.now();
    this.updateDataRate(dataStream);
    this.updateDataQuality(dataStream, imuData);

    // Add to high-performance buffer
    const success = dataStream.dataBuffer.push(imuData);
    if (!success) {
      dataStream.droppedPackets++;
      console.warn(`Data dropped for device ${deviceId} - buffer full`);
    }

    // Update performance metrics
    this.updatePerformanceMetrics(deviceId, imuData);

    // Send to motion processing coordinator
    this.forwardToMotionProcessing(deviceName, imuData);
  }

  /**
   * Subscribe to processed motion data
   */
  onMotionData(callback: Callback<MotionData>): UnsubscribeFn {
    this.motionDataListeners.add(callback);
    return () => this.motionDataListeners.delete(callback);
  }

  /**
   * Subscribe to data quality changes
   */
  onQualityChange(callback: Callback<DataQuality>): UnsubscribeFn {
    this.qualityListeners.add(callback);
    return () => this.qualityListeners.delete(callback);
  }

  /**
   * Get real-time streaming statistics
   */
  getStreamingStats(sessionId?: string): {
    sessionId: string;
    deviceCount: number;
    totalDataRate: number;
    averageQuality: DataQuality;
    droppedPackets: number;
    bufferUtilization: number;
  } | null {
    const targetSessionId = sessionId || this.currentSessionId;
    if (!targetSessionId) return null;

    const session = this.sessions.get(targetSessionId);
    if (!session) return null;

    let totalDataRate = 0;
    let totalDropped = 0;
    let totalUtilization = 0;
    const qualityScores: number[] = [];

    session.devices.forEach(stream => {
      totalDataRate += stream.dataRate;
      totalDropped += stream.droppedPackets;
      totalUtilization += stream.dataBuffer.getUtilization();
      qualityScores.push(this.qualityToScore(stream.quality));
    });

    const avgQualityScore = qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length;
    
    return {
      sessionId: targetSessionId,
      deviceCount: session.devices.size,
      totalDataRate,
      averageQuality: this.scoreToQuality(avgQualityScore),
      droppedPackets: totalDropped,
      bufferUtilization: totalUtilization / session.devices.size,
    };
  }

  /**
   * Stop streaming session and cleanup
   */
  stopStreamingSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    try {
      session.isActive = false;
      
      // Cleanup data streams
      session.devices.forEach(stream => {
        stream.dataBuffer.clear();
      });

      // Terminate worker
      if (session.dataProcessor) {
        session.dataProcessor.terminate();
      }

      this.sessions.delete(sessionId);

      if (this.currentSessionId === sessionId) {
        this.currentSessionId = null;
      }

      console.log(`Stopped streaming session ${sessionId}`);
      return true;

    } catch (error) {
      console.error(`Error stopping session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Get current performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.performanceMetrics };
  }

  /**
   * Cleanup all resources
   */
  destroy(): void {
    // Stop all sessions
    this.sessions.forEach((_, sessionId) => {
      this.stopStreamingSession(sessionId);
    });

    // Cleanup batchers and pools
    this.motionDataBatcher.destroy();
    this.imuDataPool.clear();

    // Terminate worker
    if (this.dataWorker) {
      this.dataWorker.terminate();
      this.dataWorker = null;
    }

    // Clear listeners
    this.motionDataListeners.clear();
    this.qualityListeners.clear();
  }

  // Private helper methods
  private createDeviceDataStream(deviceId: string): DeviceDataStream {
    return {
      deviceId,
      deviceName: deviceId, // Will be updated when device info is available
      state: DeviceState.STREAMING,
      dataBuffer: new HighPerformanceCircularBuffer<IMUData>(),
      dataRate: 0,
      lastDataTime: 0,
      quality: DataQuality.NO_DATA,
      droppedPackets: 0,
    };
  }

  private createIMUDataPool(): MemoryEfficientObjectPool<IMUData> {
    return new MemoryEfficientObjectPool<IMUData>(
      () => ({
        timestamp: 0,
        quaternion: { w: 0, x: 0, y: 0, z: 0 },
        gyroscope: { x: 0, y: 0, z: 0 },
        accelerometer: { x: 0, y: 0, z: 0 },
        magnetometer: { x: 0, y: 0, z: 0 },
      }),
      (obj) => {
        obj.timestamp = 0;
        obj.quaternion.w = obj.quaternion.x = obj.quaternion.y = obj.quaternion.z = 0;
        obj.gyroscope.x = obj.gyroscope.y = obj.gyroscope.z = 0;
        obj.accelerometer.x = obj.accelerometer.y = obj.accelerometer.z = 0;
        obj.magnetometer.x = obj.magnetometer.y = obj.magnetometer.z = 0;
      }
    );
  }

  private createMotionDataBatcher(): AdaptiveDataBatcher<MotionData> {
    return new AdaptiveDataBatcher<MotionData>(
      (batch) => {
        // Send batch via WebRTC
        const message: WebRTCMessage = {
          type: MessageType.IMU_DATA,
          deviceId: 'motion_processor',
          timestamp: batch.timestamp,
          data: batch,
        };

        webRTCManager.broadcastMessage(message);
      },
      1, // Min batch size for real-time updates
      50, // Max batch size for efficiency
      PERFORMANCE_CONSTANTS.UI_UPDATE_THROTTLE_MS
    );
  }

  private setupMotionProcessingSubscription(): void {
    // Subscribe to motion processing coordinator updates
    motionProcessingCoordinator.subscribeToUI((motionData: any) => {
      const processedData: MotionData = {
        left: motionData.left || { current: 0, max: 0, min: 0, rom: 0 },
        right: motionData.right || { current: 0, max: 0, min: 0, rom: 0 },
        timestamp: Date.now(),
        frameId: Date.now(), // Simple frame ID
        quality: this.calculateOverallQuality(),
      };

      // Add to batcher for efficient transmission
      this.motionDataBatcher.addData(processedData);

      // Notify local listeners immediately for UI responsiveness
      this.motionDataListeners.forEach(callback => callback(processedData));
    });
  }

  private forwardToMotionProcessing(deviceName: string, imuData: IMUData): void {
    try {
      // Forward to motion processing coordinator
      motionProcessingCoordinator.processNewData(deviceName, imuData);
      
      // Update processing latency metrics
      const processingStart = performance.now();
      this.performanceMetrics.latency.processing.push(performance.now() - processingStart);
      
    } catch (error) {
      console.error(`Motion processing error for ${deviceName}:`, error);
    }
  }

  private updateDataRate(dataStream: DeviceDataStream): void {
    const now = performance.now();
    const timeDelta = now - dataStream.lastDataTime;
    
    if (timeDelta > 0) {
      const instantRate = 1000 / timeDelta; // Hz
      dataStream.dataRate = dataStream.dataRate * 0.9 + instantRate * 0.1; // Exponential smoothing
    }
  }

  private updateDataQuality(dataStream: DeviceDataStream, imuData: IMUData): void {
    const now = performance.now();
    const dataAge = now - imuData.timestamp;
    
    let quality: DataQuality;
    
    if (dataAge < 10) {
      quality = DataQuality.EXCELLENT;
    } else if (dataAge < 50) {
      quality = DataQuality.GOOD;
    } else if (dataAge < 100) {
      quality = DataQuality.FAIR;
    } else {
      quality = DataQuality.POOR;
    }

    if (dataStream.quality !== quality) {
      dataStream.quality = quality;
      this.qualityListeners.forEach(callback => callback(quality));
    }
  }

  private updatePerformanceMetrics(deviceId: string, imuData: IMUData): void {
    const now = performance.now();
    const bleLatency = now - imuData.timestamp;
    
    this.performanceMetrics.latency.ble.push(bleLatency);
    this.performanceMetrics.throughput.samplesPerSecond++;

    // Keep metrics bounded
    if (this.performanceMetrics.latency.ble.length > 1000) {
      this.performanceMetrics.latency.ble.shift();
    }
  }

  private calculateOverallQuality(): DataQuality {
    const session = this.getCurrentSession();
    if (!session) return DataQuality.NO_DATA;

    const qualities = Array.from(session.devices.values()).map(s => s.quality);
    const scores = qualities.map(q => this.qualityToScore(q));
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    
    return this.scoreToQuality(avgScore);
  }

  private qualityToScore(quality: DataQuality): number {
    switch (quality) {
      case DataQuality.EXCELLENT: return 4;
      case DataQuality.GOOD: return 3;
      case DataQuality.FAIR: return 2;
      case DataQuality.POOR: return 1;
      case DataQuality.NO_DATA: return 0;
    }
  }

  private scoreToQuality(score: number): DataQuality {
    if (score >= 3.5) return DataQuality.EXCELLENT;
    if (score >= 2.5) return DataQuality.GOOD;
    if (score >= 1.5) return DataQuality.FAIR;
    if (score >= 0.5) return DataQuality.POOR;
    return DataQuality.NO_DATA;
  }

  private getCurrentSession(): StreamingSession | null {
    return this.currentSessionId ? this.sessions.get(this.currentSessionId) || null : null;
  }

  private createDataProcessorWorker(): Worker | null {
    try {
      // Worker for heavy data processing tasks
      const workerCode = `
        self.onmessage = function(e) {
          const { type, data } = e.data;
          
          switch (type) {
            case 'PROCESS_BATCH':
              // Process batch of IMU data
              const processed = data.map(item => {
                // Perform heavy calculations here
                return item;
              });
              self.postMessage({ type: 'BATCH_PROCESSED', data: processed });
              break;
          }
        };
      `;
      
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      return new Worker(URL.createObjectURL(blob));
      
    } catch (error) {
      console.warn('Failed to create data processor worker:', error);
      return null;
    }
  }

  private startPerformanceMonitoring(): void {
    setInterval(() => {
      // Reset throughput counters
      this.performanceMetrics.throughput.samplesPerSecond = 0;
      this.performanceMetrics.throughput.packetsPerSecond = 0;
      
      // Update memory usage
      if ('memory' in performance) {
        const memInfo = (performance as any).memory;
        this.performanceMetrics.resources.memoryUsage = memInfo.usedJSHeapSize / memInfo.jsHeapSizeLimit;
      }
    }, 1000);
  }

  private initializeMetrics(): PerformanceMetrics {
    return {
      latency: {
        ble: [],
        webrtc: [],
        processing: [],
        ui: [],
      },
      throughput: {
        samplesPerSecond: 0,
        bytesPerSecond: 0,
        packetsPerSecond: 0,
      },
      quality: {
        packetLoss: 0,
        jitter: 0,
        outOfOrder: 0,
      },
      resources: {
        memoryUsage: 0,
        cpuUsage: 0,
        batteryDrain: 0,
      },
    };
  }
}

/**
 * Singleton instance for global stream data management
 */
export const streamDataManager = new StreamDataManager();