import { BaseMessage, MessageHandler, MotionDataMessage, DeviceStatusMessage, BatteryUpdateMessage } from '../types/Interfaces';
import { MESSAGE_TYPES } from '../types/MessageTypes';

// Motion processing service interface (will be injected)
export interface MotionService {
  getCurrentMotionData(): Map<string, Float32Array>; // deviceName -> [leftCurrent, leftMax, leftMin, rightCurrent, rightMax, rightMin]
  getDeviceStatus(): Map<string, { connected: boolean; streaming: boolean }>;
  getBatteryLevels(): Map<string, number>;
  subscribeToMotionData(callback: (deviceName: string, data: Float32Array) => void): () => void;
  subscribeToDeviceStatus(callback: (deviceName: string, status: { connected: boolean; streaming: boolean }) => void): () => void;
  subscribeToBatteryUpdates(callback: (deviceName: string, level: number) => void): () => void;
}

interface StreamingStats {
  motionMessages: number;
  deviceStatusMessages: number;
  batteryMessages: number;
  bytesStreamed: number;
  messagesPerSecond: number;
  lastResetTime: number;
  peakMessagesPerSecond: number;
}

interface PerformanceWindow {
  timestamp: number;
  messageCount: number;
}

const PERFORMANCE_WINDOW_SIZE = 10; // 10 seconds
const STATS_UPDATE_INTERVAL = 1000; // 1 second

export class StreamingHandler {
  private motionService: MotionService | null = null;
  private stats: StreamingStats;
  private performanceWindow: PerformanceWindow[] = [];
  private statsTimer: NodeJS.Timeout | null = null;

  // Subscription cleanup functions
  private motionSubscription: (() => void) | null = null;
  private deviceStatusSubscription: (() => void) | null = null;
  private batterySubscription: (() => void) | null = null;

  // Broadcasting function (will be injected)
  private broadcastFunction: ((message: BaseMessage, clientIds: string[]) => Promise<void>) | null = null;
  private connectedClients: string[] = [];

  constructor() {
    this.stats = {
      motionMessages: 0,
      deviceStatusMessages: 0,
      batteryMessages: 0,
      bytesStreamed: 0,
      messagesPerSecond: 0,
      lastResetTime: Date.now(),
      peakMessagesPerSecond: 0,
    };

    this.startStatsMonitoring();
  }

  // Inject motion service dependency
  setMotionService(service: MotionService): void {
    this.motionService = service;
    this.setupMotionSubscriptions();
  }

  // Set broadcast function for streaming data
  setBroadcastFunction(broadcastFn: (message: BaseMessage, clientIds: string[]) => Promise<void>): void {
    this.broadcastFunction = broadcastFn;
  }

  // Update connected clients list
  setConnectedClients(clientIds: string[]): void {
    this.connectedClients = [...clientIds];
  }

  // Add client to streaming list
  addClient(clientId: string): void {
    if (!this.connectedClients.includes(clientId)) {
      this.connectedClients.push(clientId);
    }
  }

  // Remove client from streaming list
  removeClient(clientId: string): void {
    const index = this.connectedClients.indexOf(clientId);
    if (index !== -1) {
      this.connectedClients.splice(index, 1);
    }
  }

  // Get message handlers (for initial data requests)
  getHandlers(): Array<{ type: number; handler: MessageHandler }> {
    return [
      // These handlers can be used for one-time data requests
      // Real-time streaming uses the subscription system
    ];
  }

  // Get current motion data for all devices (on-demand)
  getCurrentMotionData(): MotionDataMessage[] {
    if (!this.motionService) return [];

    const motionData = this.motionService.getCurrentMotionData();
    const messages: MotionDataMessage[] = [];

    motionData.forEach((data, deviceName) => {
      messages.push({
        type: MESSAGE_TYPES.MOTION_DATA,
        timestamp: Date.now(),
        deviceName,
        data,
      });
    });

    return messages;
  }

  // Get current device status for all devices
  getCurrentDeviceStatus(): DeviceStatusMessage[] {
    if (!this.motionService) return [];

    const deviceStatus = this.motionService.getDeviceStatus();
    const messages: DeviceStatusMessage[] = [];

    deviceStatus.forEach((status, deviceName) => {
      messages.push({
        type: MESSAGE_TYPES.DEVICE_STATUS,
        timestamp: Date.now(),
        deviceId: deviceName, // Using deviceName as ID for now
        deviceName,
        connected: status.connected,
        streaming: status.streaming,
      });
    });

    return messages;
  }

  // Get current battery levels for all devices
  getCurrentBatteryLevels(): BatteryUpdateMessage[] {
    if (!this.motionService) return [];

    const batteryLevels = this.motionService.getBatteryLevels();
    const messages: BatteryUpdateMessage[] = [];

    batteryLevels.forEach((level, deviceName) => {
      messages.push({
        type: MESSAGE_TYPES.BATTERY_UPDATE,
        timestamp: Date.now(),
        deviceName,
        level,
      });
    });

    return messages;
  }

  // Start streaming to all connected clients
  async startStreaming(): Promise<void> {
    if (!this.motionService || !this.broadcastFunction) {
      throw new Error('Motion service and broadcast function required');
    }

    console.log(`Started streaming to ${this.connectedClients.length} clients`);
  }

  // Stop streaming
  async stopStreaming(): Promise<void> {
    console.log('Stopped streaming');
  }

  // Get streaming statistics
  getStats(): StreamingStats {
    return { ...this.stats };
  }

  // Reset statistics
  resetStats(): void {
    this.stats = {
      motionMessages: 0,
      deviceStatusMessages: 0,
      batteryMessages: 0,
      bytesStreamed: 0,
      messagesPerSecond: 0,
      lastResetTime: Date.now(),
      peakMessagesPerSecond: 0,
    };
    this.performanceWindow = [];
  }

  // Get performance metrics
  getPerformanceMetrics(): {
    currentThroughput: number;
    averageThroughput: number;
    peakThroughput: number;
    clientCount: number;
    dataEfficiency: number; // bytes per message
  } {
    const totalMessages = this.stats.motionMessages + this.stats.deviceStatusMessages + this.stats.batteryMessages;
    const dataEfficiency = totalMessages > 0 ? this.stats.bytesStreamed / totalMessages : 0;

    const averageThroughput = this.performanceWindow.length > 0
      ? this.performanceWindow.reduce((sum, w) => sum + w.messageCount, 0) / this.performanceWindow.length
      : 0;

    return {
      currentThroughput: this.stats.messagesPerSecond,
      averageThroughput,
      peakThroughput: this.stats.peakMessagesPerSecond,
      clientCount: this.connectedClients.length,
      dataEfficiency,
    };
  }

  // Cleanup resources
  cleanup(): void {
    this.stopStatsMonitoring();
    this.cleanupSubscriptions();
    this.connectedClients = [];
  }

  // Setup motion data subscriptions
  private setupMotionSubscriptions(): void {
    if (!this.motionService) return;

    // Cleanup existing subscriptions
    this.cleanupSubscriptions();

    // Subscribe to motion data updates
    this.motionSubscription = this.motionService.subscribeToMotionData((deviceName, data) => {
      this.handleMotionDataUpdate(deviceName, data);
    });

    // Subscribe to device status updates
    this.deviceStatusSubscription = this.motionService.subscribeToDeviceStatus((deviceName, status) => {
      this.handleDeviceStatusUpdate(deviceName, status);
    });

    // Subscribe to battery updates
    this.batterySubscription = this.motionService.subscribeToBatteryUpdates((deviceName, level) => {
      this.handleBatteryUpdate(deviceName, level);
    });
  }

  // Handle motion data update from service
  private async handleMotionDataUpdate(deviceName: string, data: Float32Array): Promise<void> {
    if (!this.broadcastFunction || this.connectedClients.length === 0) return;

    const message: MotionDataMessage = {
      type: MESSAGE_TYPES.MOTION_DATA,
      timestamp: Date.now(),
      deviceName,
      data,
    };

    try {
      await this.broadcastFunction(message, this.connectedClients);
      this.updateStats('motion', this.calculateMessageSize(message));
    } catch (error) {
      console.error('Failed to broadcast motion data:', error);
    }
  }

  // Handle device status update from service
  private async handleDeviceStatusUpdate(deviceName: string, status: { connected: boolean; streaming: boolean }): Promise<void> {
    if (!this.broadcastFunction || this.connectedClients.length === 0) return;

    const message: DeviceStatusMessage = {
      type: MESSAGE_TYPES.DEVICE_STATUS,
      timestamp: Date.now(),
      deviceId: deviceName,
      deviceName,
      connected: status.connected,
      streaming: status.streaming,
    };

    try {
      await this.broadcastFunction(message, this.connectedClients);
      this.updateStats('deviceStatus', this.calculateMessageSize(message));
    } catch (error) {
      console.error('Failed to broadcast device status:', error);
    }
  }

  // Handle battery update from service
  private async handleBatteryUpdate(deviceName: string, level: number): Promise<void> {
    if (!this.broadcastFunction || this.connectedClients.length === 0) return;

    const message: BatteryUpdateMessage = {
      type: MESSAGE_TYPES.BATTERY_UPDATE,
      timestamp: Date.now(),
      deviceName,
      level,
    };

    try {
      await this.broadcastFunction(message, this.connectedClients);
      this.updateStats('battery', this.calculateMessageSize(message));
    } catch (error) {
      console.error('Failed to broadcast battery update:', error);
    }
  }

  // Update streaming statistics
  private updateStats(messageType: 'motion' | 'deviceStatus' | 'battery', messageSize: number): void {
    switch (messageType) {
      case 'motion':
        this.stats.motionMessages++;
        break;
      case 'deviceStatus':
        this.stats.deviceStatusMessages++;
        break;
      case 'battery':
        this.stats.batteryMessages++;
        break;
    }

    this.stats.bytesStreamed += messageSize;
    this.updatePerformanceWindow();
  }

  // Calculate approximate message size in bytes
  private calculateMessageSize(message: BaseMessage): number {
    if (message.type === MESSAGE_TYPES.MOTION_DATA) {
      // Binary protocol: header (12 bytes) + device name length (2 bytes) + device name + float data (24 bytes)
      const motionMsg = message as MotionDataMessage;
      return 12 + 2 + (motionMsg.deviceName || 'unknown').length + 24;
    }

    // For other messages, estimate JSON size
    return JSON.stringify(message).length;
  }

  // Update performance tracking window
  private updatePerformanceWindow(): void {
    const now = Date.now();
    const windowStart = now - (PERFORMANCE_WINDOW_SIZE * 1000);

    // Remove old entries
    this.performanceWindow = this.performanceWindow.filter(w => w.timestamp > windowStart);

    // Add or update current second
    const currentSecond = Math.floor(now / 1000) * 1000;
    let currentEntry = this.performanceWindow.find(w => w.timestamp === currentSecond);

    if (currentEntry) {
      currentEntry.messageCount++;
    } else {
      this.performanceWindow.push({
        timestamp: currentSecond,
        messageCount: 1,
      });
    }
  }

  // Start statistics monitoring
  private startStatsMonitoring(): void {
    this.statsTimer = setInterval(() => {
      this.updateStatsMetrics();
    }, STATS_UPDATE_INTERVAL);
  }

  // Stop statistics monitoring
  private stopStatsMonitoring(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  // Update computed statistics metrics
  private updateStatsMetrics(): void {
    const now = Date.now();
    const windowStart = now - (PERFORMANCE_WINDOW_SIZE * 1000);

    // Clean old entries
    this.performanceWindow = this.performanceWindow.filter(w => w.timestamp > windowStart);

    // Calculate messages per second
    const currentSecond = Math.floor(now / 1000) * 1000;
    const currentEntry = this.performanceWindow.find(w => w.timestamp === currentSecond);
    this.stats.messagesPerSecond = currentEntry?.messageCount || 0;

    // Update peak
    if (this.stats.messagesPerSecond > this.stats.peakMessagesPerSecond) {
      this.stats.peakMessagesPerSecond = this.stats.messagesPerSecond;
    }
  }

  // Cleanup all subscriptions
  private cleanupSubscriptions(): void {
    this.motionSubscription?.();
    this.deviceStatusSubscription?.();
    this.batterySubscription?.();

    this.motionSubscription = null;
    this.deviceStatusSubscription = null;
    this.batterySubscription = null;
  }
}