import { ConnectionManager } from './core/ConnectionManager';
import { MessageRouter } from './core/MessageRouter';
import { StreamingTransport } from './transport/StreamingTransport';
import { BLEHandler, BLEService } from './handlers/BLEHandler';
import { StreamingHandler, MotionService } from './handlers/StreamingHandler';
import { SystemHandler, SystemService } from './handlers/SystemHandler';
import { MESSAGE_TYPES, DELIVERY_MODES } from './types/MessageTypes';
import { BaseMessage } from './types/Interfaces';

// Integration interfaces for existing services
export interface ExistingServices {
  museManager: any; // MuseManager instance
  motionCoordinator: any; // MotionProcessingCoordinator instance
  systemMonitor?: any; // SystemMonitor instance
}

export interface BridgeConfig {
  port?: number;
  enableBinaryProtocol: boolean;
  enableReliableTransport: boolean;
  performanceMode: 'high_throughput' | 'low_latency' | 'balanced';
  streamingConfig: {
    motionDataReliable: boolean;
    maxClientsPerMessage: number;
    messageBufferSize: number;
  };
}

const DEFAULT_CONFIG: BridgeConfig = {
  enableBinaryProtocol: true,
  enableReliableTransport: true,
  performanceMode: 'balanced',
  streamingConfig: {
    motionDataReliable: false,
    maxClientsPerMessage: 10,
    messageBufferSize: 100,
  },
} as const;

export class WebSocketBridge {
  private connectionManager: ConnectionManager;
  private messageRouter: MessageRouter;
  private streamingTransport: StreamingTransport;

  // Handlers
  private bleHandler: BLEHandler;
  private streamingHandler: StreamingHandler;
  private systemHandler: SystemHandler;

  // Service adapters
  private bleServiceAdapter: BLEServiceAdapter;
  private motionServiceAdapter: MotionServiceAdapter;
  private systemServiceAdapter: SystemServiceAdapter;

  private config: BridgeConfig;
  private isRunning = false;
  private currentPort = 0;

  constructor(config: Partial<BridgeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize core components
    this.connectionManager = new ConnectionManager();
    this.messageRouter = new MessageRouter();
    this.streamingTransport = new StreamingTransport(
      { defaultMode: this.config.streamingConfig.motionDataReliable ? DELIVERY_MODES.RELIABLE : DELIVERY_MODES.FIRE_AND_FORGET }
    );

    // Initialize handlers
    this.bleHandler = new BLEHandler();
    this.streamingHandler = new StreamingHandler();
    this.systemHandler = new SystemHandler();

    // Initialize service adapters
    this.bleServiceAdapter = new BLEServiceAdapter();
    this.motionServiceAdapter = new MotionServiceAdapter();
    this.systemServiceAdapter = new SystemServiceAdapter();

    this.setupIntegration();
  }

  // Initialize with existing services
  async initialize(services: ExistingServices): Promise<number> {
    console.log('🚀 Initializing WebSocket Bridge...');

    // Connect service adapters to existing services
    this.bleServiceAdapter.connect(services.museManager);
    this.motionServiceAdapter.connect(services.motionCoordinator);
    if (services.systemMonitor) {
      this.systemServiceAdapter.connect(services.systemMonitor);
    }

    // Inject services into handlers
    this.bleHandler.setBLEService(this.bleServiceAdapter);
    this.streamingHandler.setMotionService(this.motionServiceAdapter);
    this.systemHandler.setSystemService(this.systemServiceAdapter);

    // Start the bridge
    this.currentPort = await this.start(this.config.port);
    console.log(`✅ WebSocket Bridge initialized on port ${this.currentPort}`);

    return this.currentPort;
  }

  // Start the WebSocket bridge
  async start(port?: number): Promise<number> {
    if (this.isRunning) {
      throw new Error('WebSocket Bridge already running');
    }

    // Configure streaming transport message types
    this.configureMessageTypes();

    // Start connection manager
    this.currentPort = await this.connectionManager.start(port);
    this.isRunning = true;

    console.log(`🔗 WebSocket Bridge started on port ${this.currentPort}`);
    return this.currentPort;
  }

  // Stop the WebSocket bridge
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log('🛑 Stopping WebSocket Bridge...');

    // Cleanup handlers
    this.streamingHandler.cleanup();
    this.systemHandler.cleanup();

    // Stop transport and connection manager
    this.streamingTransport.stop();
    await this.connectionManager.stop();

    this.isRunning = false;
    console.log('✅ WebSocket Bridge stopped');
  }

  // Get current status
  getStatus(): {
    isRunning: boolean;
    port: number;
    connections: number;
    performance: any;
    health: any;
  } {
    const connectionManagerStats = this.isRunning ? this.connectionManager.getSystemHealth() : null;

    return {
      isRunning: this.isRunning,
      port: this.currentPort,
      connections: connectionManagerStats?.clients.length || 0,
      performance: {
        messageRouter: this.messageRouter.getPerformanceSummary(),
        streamingTransport: this.streamingTransport.getStats(),
        streamingHandler: this.streamingHandler.getPerformanceMetrics(),
      },
      health: connectionManagerStats || null,
    };
  }

  // Get performance metrics
  getPerformanceMetrics(): {
    throughput: number;
    latency: number;
    errorRate: number;
    connections: number;
  } {
    const status = this.getStatus();
    const streamingMetrics = this.streamingHandler.getPerformanceMetrics();
    const routerMetrics = this.messageRouter.getPerformanceSummary();

    return {
      throughput: streamingMetrics.currentThroughput,
      latency: streamingMetrics.averageThroughput > 0 ? 1000 / streamingMetrics.averageThroughput : 0,
      errorRate: routerMetrics.totalHandled > 0 ? routerMetrics.totalErrors / routerMetrics.totalHandled : 0,
      connections: status.connections,
    };
  }

  // Update configuration at runtime
  updateConfig(config: Partial<BridgeConfig>): void {
    this.config = { ...this.config, ...config };

    // Update streaming transport configuration if needed
    if (config.streamingConfig?.motionDataReliable !== undefined) {
      this.streamingTransport.setMessageTypeMode(
        MESSAGE_TYPES.MOTION_DATA,
        config.streamingConfig.motionDataReliable ? DELIVERY_MODES.RELIABLE : DELIVERY_MODES.FIRE_AND_FORGET
      );
    }

    console.log('⚙️ WebSocket Bridge configuration updated');
  }

  // Setup integration between components
  private setupIntegration(): void {
    // Connect connection manager to message router
    this.connectionManager.onMessage(async (message, clientId) => {
      await this.messageRouter.route(message, clientId);
    });

    // Connect streaming transport to connection manager
    this.streamingTransport.setSendFunction(async (message, clientId) => {
      return await this.connectionManager.sendToClient(clientId, message);
    });

    // Set up fallback handler for unknown message types
    this.messageRouter.setFallbackHandler(async (message, clientId) => {
      console.log(`⚠️ Unknown message type ${message.type} from client ${clientId}`);
      return {
        type: MESSAGE_TYPES.ERROR,
        requestId: message.requestId,
        timestamp: Date.now(),
        error: {
          code: 'UNKNOWN_MESSAGE_TYPE',
          message: `Unknown message type: ${message.type}`,
          details: { receivedType: message.type }
        }
      };
    });

    // Set up streaming transport to handle responses
    this.messageRouter.register(
      MESSAGE_TYPES.ACK,
      async (message, clientId) => {
        this.streamingTransport.handleResponse(message, clientId);
      },
      { deliveryMode: DELIVERY_MODES.FIRE_AND_FORGET, timeout: 1000, maxRetries: 0 }
    );

    // Connect handlers to streaming and connection systems
    this.setupHandlerIntegration();

    // Set up periodic cleanup
    setInterval(() => {
      this.performPeriodicCleanup();
    }, 60000); // Every minute
  }

  // Setup handler integration
  private setupHandlerIntegration(): void {
    // Register BLE handler messages
    this.bleHandler.getHandlers().forEach(({ type, handler }) => {
      this.messageRouter.register(type, handler, {
        deliveryMode: DELIVERY_MODES.RELIABLE,
        timeout: 10000, // 10s timeout for BLE operations
        maxRetries: 2,
      });
    });

    // Register system handler messages
    this.systemHandler.getHandlers().forEach(({ type, handler }) => {
      this.messageRouter.register(type, handler, {
        deliveryMode: DELIVERY_MODES.RELIABLE,
        timeout: 5000,
        maxRetries: 1,
      });
    });

    // Connect streaming handler to broadcast functions
    this.streamingHandler.setBroadcastFunction(async (message, clientIds) => {
      await this.streamingTransport.broadcast(message, clientIds);
    });

    this.systemHandler.setBroadcastFunction(async (message, clientIds) => {
      await this.streamingTransport.broadcast(message, clientIds);
    });

    // Connect BLE service adapter to broadcast functions
    this.bleServiceAdapter.setBroadcastFunction(async (message, clientIds) => {
      await this.streamingTransport.broadcast(message, clientIds);
    });

    // Update client lists when connections change
    this.connectionManager.onHealthChange((health) => {
      const clientIds = health.clients.filter(c => c.connected).map(c => c.clientId);
      this.streamingHandler.setConnectedClients(clientIds);
      this.systemHandler.setConnectedClients(clientIds);
    });

    // 🔗 CRITICAL: Connect MessageRouter to WebSocketServer
    this.connectionManager.onMessage(async (message, clientId) => {
      console.log(`🔗 WebSocketBridge routing message type ${message.type} to MessageRouter`);
      const response = await this.messageRouter.route(message, clientId);

      if (response) {
        console.log(`🔗 WebSocketBridge sending response type ${response.type} to client ${clientId}`);
        await this.connectionManager.sendToClient(clientId, response);
      }
    });
  }

  // Configure message type delivery modes
  private configureMessageTypes(): void {
    // BLE operations - always reliable
    this.streamingTransport.setMessageTypeMode(MESSAGE_TYPES.BLE_SCAN_REQUEST, DELIVERY_MODES.RELIABLE);
    this.streamingTransport.setMessageTypeMode(MESSAGE_TYPES.BLE_CONNECT_REQUEST, DELIVERY_MODES.RELIABLE);
    this.streamingTransport.setMessageTypeMode(MESSAGE_TYPES.BLE_DISCONNECT_REQUEST, DELIVERY_MODES.RELIABLE);

    // Recording operations - always reliable
    this.streamingTransport.setMessageTypeMode(MESSAGE_TYPES.RECORD_START_REQUEST, DELIVERY_MODES.RELIABLE);
    this.streamingTransport.setMessageTypeMode(MESSAGE_TYPES.RECORD_STOP_REQUEST, DELIVERY_MODES.RELIABLE);

    // Streaming data - configurable
    const streamingMode = this.config.streamingConfig.motionDataReliable
      ? DELIVERY_MODES.RELIABLE
      : DELIVERY_MODES.FIRE_AND_FORGET;

    this.streamingTransport.setMessageTypeMode(MESSAGE_TYPES.MOTION_DATA, streamingMode);
    this.streamingTransport.setMessageTypeMode(MESSAGE_TYPES.DEVICE_STATUS, DELIVERY_MODES.FIRE_AND_FORGET);
    this.streamingTransport.setMessageTypeMode(MESSAGE_TYPES.BATTERY_UPDATE, DELIVERY_MODES.FIRE_AND_FORGET);

    // System messages - reliable
    this.streamingTransport.setMessageTypeMode(MESSAGE_TYPES.HEARTBEAT, DELIVERY_MODES.RELIABLE);
    this.streamingTransport.setMessageTypeMode(MESSAGE_TYPES.STATUS, DELIVERY_MODES.RELIABLE);
  }

  // Periodic cleanup of all components
  private performPeriodicCleanup(): void {
    this.streamingTransport.performCleanup();
    this.streamingHandler.resetStats(); // Reset to prevent memory growth

    // Log performance metrics periodically
    if (this.isRunning) {
      const metrics = this.getPerformanceMetrics();
      console.log(`📊 Bridge Performance: ${metrics.throughput.toFixed(0)} msg/s, ${metrics.connections} clients`);
    }
  }
}

// Service adapter classes
class BLEServiceAdapter implements BLEService {
  private museManager: any = null;
  private broadcastFunction: ((message: any, clientIds: string[]) => Promise<void>) | null = null;

  connect(museManager: any): void {
    this.museManager = museManager;
  }

  setBroadcastFunction(broadcastFn: (message: any, clientIds: string[]) => Promise<void>): void {
    this.broadcastFunction = broadcastFn;
  }

  async scanForDevices(): Promise<{ success: boolean; devices: any[]; message?: string }> {
    if (!this.museManager) return { success: false, devices: [], message: 'MuseManager not connected' };

    try {
      console.log('Triggering device scan...');

      // Broadcast scan request to all connected clients (replicating original flow)
      const scanMessage = {
        type: MESSAGE_TYPES.SCAN_REQUEST, // Using the original message type
        data: {
          action: 'trigger_bluetooth_scan',
          message: 'Trigger Web Bluetooth scan for device discovery'
        },
        timestamp: Date.now()
      };

      // We need access to the broadcast function - this will be injected by the WebSocketBridge
      if (this.broadcastFunction) {
        await this.broadcastFunction(scanMessage, []);
      }

      return {
        success: true,
        devices: [],
        message: 'Device scan initiated via broadcast'
      };
    } catch (error) {
      console.error('Scan trigger failed:', error);
      return {
        success: false,
        devices: [],
        message: `Scan trigger failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  async connectToDevice(deviceId: string, deviceName: string): Promise<{ success: boolean; message?: string }> {
    if (!this.museManager) return { success: false, message: 'MuseManager not connected' };

    try {
      const success = await this.museManager.connectToScannedDevice(deviceId, deviceName);
      return {
        success,
        message: success ? 'Connected successfully' : 'Connection failed',
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  async disconnectDevice(deviceId: string): Promise<{ success: boolean; message?: string }> {
    if (!this.museManager) return { success: false, message: 'MuseManager not connected' };

    try {
      const success = await this.museManager.disconnectDevice(deviceId);
      return {
        success,
        message: success ? 'Disconnected successfully' : 'Disconnection failed',
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Disconnection failed',
      };
    }
  }

  async startRecording(sessionId: string, exerciseId: string, setNumber: number): Promise<{ success: boolean; message?: string }> {
    // Implementation would integrate with motion coordinator
    return { success: true, message: 'Recording started' };
  }

  async stopRecording(): Promise<{ success: boolean; message?: string }> {
    // Implementation would integrate with motion coordinator
    return { success: true, message: 'Recording stopped' };
  }

  getConnectedDevices(): any[] {
    if (!this.museManager) return [];

    const devices = this.museManager.getAllDevices();
    return devices.filter((device: any) => device.connected);
  }

  isRecording(): boolean {
    // Implementation would check motion coordinator
    return false;
  }
}

class MotionServiceAdapter implements MotionService {
  private motionCoordinator: any = null;

  connect(motionCoordinator: any): void {
    this.motionCoordinator = motionCoordinator;
  }

  getCurrentMotionData(): Map<string, Float32Array> {
    const data = new Map<string, Float32Array>();

    if (this.motionCoordinator) {
      const uiData = this.motionCoordinator.getUIData();

      // Convert UI data format to Float32Array
      const floatArray = new Float32Array([
        uiData.left?.current || 0,
        uiData.left?.max || 0,
        uiData.left?.min || 0,
        uiData.right?.current || 0,
        uiData.right?.max || 0,
        uiData.right?.min || 0,
      ]);

      data.set('motion_data', floatArray);
    }

    return data;
  }

  getDeviceStatus(): Map<string, { connected: boolean; streaming: boolean }> {
    const status = new Map<string, { connected: boolean; streaming: boolean }>();

    if (this.motionCoordinator) {
      const connectionStates = this.motionCoordinator.getConnectionStates();

      connectionStates.forEach((state: any, deviceName: string) => {
        status.set(deviceName, {
          connected: state === 'connected',
          streaming: state === 'connected', // Assume streaming if connected
        });
      });
    }

    return status;
  }

  getBatteryLevels(): Map<string, number> {
    if (!this.motionCoordinator) return new Map();

    return this.motionCoordinator.getBatteryLevels();
  }

  subscribeToMotionData(callback: (deviceName: string, data: Float32Array) => void): () => void {
    if (!this.motionCoordinator) return () => {};

    return this.motionCoordinator.subscribeToUI((uiData: any) => {
      const floatArray = new Float32Array([
        uiData.left?.current || 0,
        uiData.left?.max || 0,
        uiData.left?.min || 0,
        uiData.right?.current || 0,
        uiData.right?.max || 0,
        uiData.right?.min || 0,
      ]);

      callback('motion_data', floatArray);
    });
  }

  subscribeToDeviceStatus(callback: (deviceName: string, status: { connected: boolean; streaming: boolean }) => void): () => void {
    // Implementation would subscribe to connection state changes
    return () => {};
  }

  subscribeToBatteryUpdates(callback: (deviceName: string, level: number) => void): () => void {
    // Implementation would subscribe to battery level changes
    return () => {};
  }
}

class SystemServiceAdapter implements SystemService {
  private systemMonitor: any = null;

  connect(systemMonitor: any): void {
    this.systemMonitor = systemMonitor;
  }

  getSystemStatus(): any {
    return {
      isRecording: false,
      connectedDevices: [],
      wsPort: 0,
      uptime: process.uptime() * 1000,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage ? process.cpuUsage() : undefined,
    };
  }

  getPerformanceMetrics(): any {
    return {
      wsConnections: 0,
      messagesPerSecond: 0,
      errorRate: 0,
      averageLatency: 0,
    };
  }

  async performSystemCleanup(): Promise<{ cleaned: number; errors: number }> {
    // Implementation would trigger system cleanup
    return { cleaned: 0, errors: 0 };
  }

  async restartServices(): Promise<{ success: boolean; message: string }> {
    // Implementation would restart services
    return { success: true, message: 'Services restarted' };
  }
}