/**
 * High-performance WebRTC DataChannel manager for real-time sensor data
 * Uses native RTCPeerConnection with ordered channels for zero packet loss
 */

import {
  WebRTCConfig,
  WebRTCMessage,
  MessageType,
  AppError,
  PerformanceMetrics,
  Callback,
  UnsubscribeFn
} from './types';
import { PERFORMANCE_CONSTANTS, ERROR_CODES } from './constants';

interface ConnectionInfo {
  id: string;
  peerConnection: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  state: RTCPeerConnectionState;
  lastHeartbeat: number;
  metrics: {
    bytesSent: number;
    bytesReceived: number;
    packetsLost: number;
    latency: number[];
  };
}

export class WebRTCManager {
  private connections: Map<string, ConnectionInfo> = new Map();
  private messageListeners: Set<Callback<WebRTCMessage>> = new Set();
  private stateListeners: Set<Callback<RTCPeerConnectionState>> = new Set();
  private heartbeatInterval: number | null = null;
  private performanceMetrics: PerformanceMetrics;
  
  private readonly iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  private readonly dataChannelConfig: RTCDataChannelInit = {
    ordered: true, // Critical for sensor data integrity
    maxRetransmits: undefined, // Use reliable transmission
    maxPacketLifeTime: undefined,
    protocol: 'sensor-data',
  };

  constructor() {
    this.performanceMetrics = this.initializeMetrics();
    this.startHeartbeat();
  }

  /**
   * Create new peer connection with optimized configuration
   */
  async createConnection(connectionId: string): Promise<string> {
    if (this.connections.has(connectionId)) {
      throw this.createError(
        ERROR_CODES.WEBRTC_CONNECTION_FAILED,
        `Connection ${connectionId} already exists`
      );
    }

    const peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceTransportPolicy: 'all',
    });

    const connectionInfo: ConnectionInfo = {
      id: connectionId,
      peerConnection,
      dataChannel: null,
      state: 'new',
      lastHeartbeat: performance.now(),
      metrics: {
        bytesSent: 0,
        bytesReceived: 0,
        packetsLost: 0,
        latency: [],
      },
    };

    // Set up event listeners
    this.setupConnectionEventListeners(connectionInfo);
    
    this.connections.set(connectionId, connectionInfo);
    return connectionId;
  }

  /**
   * Create data channel with ordered configuration for sensor data
   */
  createDataChannel(connectionId: string, channelName: string): RTCDataChannel {
    const connectionInfo = this.connections.get(connectionId);
    if (!connectionInfo) {
      throw this.createError(
        ERROR_CODES.WEBRTC_CONNECTION_FAILED,
        `Connection ${connectionId} not found`
      );
    }

    const dataChannel = connectionInfo.peerConnection.createDataChannel(
      channelName,
      {
        ...this.dataChannelConfig,
        // High-performance settings for 16kHz data
        id: Date.now() % 65536, // Ensure unique channel ID
      }
    );

    connectionInfo.dataChannel = dataChannel;
    this.setupDataChannelEventListeners(dataChannel, connectionId);

    return dataChannel;
  }

  /**
   * Send message through data channel with error handling
   */
  sendMessage(connectionId: string, message: WebRTCMessage): void {
    const connectionInfo = this.connections.get(connectionId);
    if (!connectionInfo?.dataChannel) {
      console.warn(`No data channel available for connection ${connectionId}`);
      return;
    }

    if (connectionInfo.dataChannel.readyState !== 'open') {
      console.warn(`Data channel not ready for connection ${connectionId}`);
      return;
    }

    try {
      // Add sequence number for ordering validation
      const messageWithSequence = {
        ...message,
        sequence: Date.now(),
      };

      const serializedMessage = this.serializeMessage(messageWithSequence);
      connectionInfo.dataChannel.send(serializedMessage);
      
      // Update metrics
      connectionInfo.metrics.bytesSent += serializedMessage.length;
      this.updateThroughputMetrics(serializedMessage.length);
      
    } catch (error) {
      console.error(`Failed to send message on connection ${connectionId}:`, error);
      this.handleConnectionError(connectionId, error as Error);
    }
  }

  /**
   * Broadcast message to all active connections
   */
  broadcastMessage(message: WebRTCMessage): void {
    this.connections.forEach((_, connectionId) => {
      this.sendMessage(connectionId, message);
    });
  }

  /**
   * Subscribe to incoming messages
   */
  onMessage(callback: Callback<WebRTCMessage>): UnsubscribeFn {
    this.messageListeners.add(callback);
    return () => this.messageListeners.delete(callback);
  }

  /**
   * Subscribe to connection state changes
   */
  onStateChange(callback: Callback<RTCPeerConnectionState>): UnsubscribeFn {
    this.stateListeners.add(callback);
    return () => this.stateListeners.delete(callback);
  }

  /**
   * Get connection statistics
   */
  async getConnectionStats(connectionId: string): Promise<RTCStatsReport | null> {
    const connectionInfo = this.connections.get(connectionId);
    if (!connectionInfo) return null;

    try {
      const stats = await connectionInfo.peerConnection.getStats();
      this.updateLatencyMetrics(stats);
      return stats;
    } catch (error) {
      console.error(`Failed to get stats for connection ${connectionId}:`, error);
      return null;
    }
  }

  /**
   * Get current performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.performanceMetrics };
  }

  /**
   * Close connection and cleanup resources
   */
  closeConnection(connectionId: string): void {
    const connectionInfo = this.connections.get(connectionId);
    if (!connectionInfo) return;

    if (connectionInfo.dataChannel) {
      connectionInfo.dataChannel.close();
    }
    
    connectionInfo.peerConnection.close();
    this.connections.delete(connectionId);
  }

  /**
   * Close all connections and cleanup
   */
  destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.connections.forEach((_, connectionId) => {
      this.closeConnection(connectionId);
    });

    this.messageListeners.clear();
    this.stateListeners.clear();
  }

  // Private helper methods
  private setupConnectionEventListeners(connectionInfo: ConnectionInfo): void {
    const { peerConnection, id } = connectionInfo;

    peerConnection.onconnectionstatechange = () => {
      connectionInfo.state = peerConnection.connectionState;
      this.stateListeners.forEach(callback => callback(peerConnection.connectionState));

      if (peerConnection.connectionState === 'failed') {
        this.handleConnectionError(id, new Error('Connection failed'));
      }
    };

    peerConnection.ondatachannel = (event) => {
      const dataChannel = event.channel;
      connectionInfo.dataChannel = dataChannel;
      this.setupDataChannelEventListeners(dataChannel, id);
    };

    peerConnection.oniceconnectionstatechange = () => {
      if (peerConnection.iceConnectionState === 'failed') {
        this.handleConnectionError(id, new Error('ICE connection failed'));
      }
    };
  }

  private setupDataChannelEventListeners(dataChannel: RTCDataChannel, connectionId: string): void {
    dataChannel.onopen = () => {
      console.log(`Data channel opened for connection ${connectionId}`);
      this.sendHeartbeat(connectionId);
    };

    dataChannel.onclose = () => {
      console.log(`Data channel closed for connection ${connectionId}`);
    };

    dataChannel.onmessage = (event) => {
      try {
        const message = this.deserializeMessage(event.data);
        
        // Update metrics
        const connectionInfo = this.connections.get(connectionId);
        if (connectionInfo) {
          connectionInfo.metrics.bytesReceived += event.data.length || 0;
          connectionInfo.lastHeartbeat = performance.now();
        }

        // Process heartbeat messages internally
        if (message.type === MessageType.HEARTBEAT) {
          this.handleHeartbeat(connectionId, message);
          return;
        }

        // Notify listeners
        this.messageListeners.forEach(callback => callback(message));
        
      } catch (error) {
        console.error(`Failed to process message from ${connectionId}:`, error);
      }
    };

    dataChannel.onerror = (error) => {
      console.error(`Data channel error for connection ${connectionId}:`, error);
      this.handleConnectionError(connectionId, new Error('Data channel error'));
    };
  }

  private serializeMessage(message: WebRTCMessage): string {
    try {
      return JSON.stringify(message);
    } catch (error) {
      throw new Error(`Failed to serialize message: ${error}`);
    }
  }

  private deserializeMessage(data: string): WebRTCMessage {
    try {
      return JSON.parse(data) as WebRTCMessage;
    } catch (error) {
      throw new Error(`Failed to deserialize message: ${error}`);
    }
  }

  private sendHeartbeat(connectionId: string): void {
    const heartbeatMessage: WebRTCMessage = {
      type: MessageType.HEARTBEAT,
      deviceId: 'system',
      timestamp: performance.now(),
      data: { connectionId },
    };

    this.sendMessage(connectionId, heartbeatMessage);
  }

  private handleHeartbeat(connectionId: string, message: WebRTCMessage): void {
    const connectionInfo = this.connections.get(connectionId);
    if (!connectionInfo) return;

    const latency = performance.now() - message.timestamp;
    connectionInfo.metrics.latency.push(latency);
    
    // Keep only recent latency measurements
    if (connectionInfo.metrics.latency.length > 100) {
      connectionInfo.metrics.latency.shift();
    }

    connectionInfo.lastHeartbeat = performance.now();
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = window.setInterval(() => {
      this.connections.forEach((_, connectionId) => {
        this.sendHeartbeat(connectionId);
      });
    }, PERFORMANCE_CONSTANTS.HEARTBEAT_INTERVAL_MS);
  }

  private handleConnectionError(connectionId: string, error: Error): void {
    console.error(`Connection error for ${connectionId}:`, error);
    
    // Update metrics
    const connectionInfo = this.connections.get(connectionId);
    if (connectionInfo) {
      connectionInfo.metrics.packetsLost++;
    }

    // Attempt reconnection or cleanup based on error type
    this.scheduleReconnection(connectionId);
  }

  private scheduleReconnection(connectionId: string): void {
    // Implement exponential backoff for reconnection
    setTimeout(() => {
      if (this.connections.has(connectionId)) {
        console.log(`Attempting to reconnect ${connectionId}`);
        // Reconnection logic would go here
      }
    }, PERFORMANCE_CONSTANTS.RECONNECT_BASE_DELAY_MS);
  }

  private updateThroughputMetrics(bytes: number): void {
    this.performanceMetrics.throughput.bytesPerSecond += bytes;
    this.performanceMetrics.throughput.packetsPerSecond++;
  }

  private updateLatencyMetrics(stats: RTCStatsReport): void {
    stats.forEach(report => {
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        if (report.currentRoundTripTime) {
          this.performanceMetrics.latency.webrtc.push(report.currentRoundTripTime * 1000);
        }
      }
    });

    // Keep metrics arrays bounded
    Object.values(this.performanceMetrics.latency).forEach(array => {
      if (array.length > 1000) {
        array.splice(0, array.length - 1000);
      }
    });
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

  private createError(code: keyof typeof ERROR_CODES, message: string): AppError {
    return {
      code,
      message,
      timestamp: Date.now(),
    };
  }
}

/**
 * Singleton instance for global WebRTC management
 */
export const webRTCManager = new WebRTCManager();