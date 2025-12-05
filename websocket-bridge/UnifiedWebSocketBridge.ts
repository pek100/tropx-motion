import { ConnectionManager } from './core/ConnectionManager';
import { StreamingTransport } from './transport/StreamingTransport';
import { UnifiedMessageRouter } from './core/UnifiedMessageRouter';
import { BLEDomainProcessor } from './processors/BLEDomainProcessor';
import { StreamingDomainProcessor } from './processors/StreamingDomainProcessor';
import { SystemDomainProcessor } from './processors/SystemDomainProcessor';
import { ClientMetadataProcessor } from './processors/ClientMetadataProcessor';
import { BLEServiceAdapter } from '../ble-bridge/BLEServiceAdapter';
import { createBleService } from '../ble-bridge/BleServiceFactory';
import { MESSAGE_TYPES, DELIVERY_MODES } from './types/MessageTypes';

// Configuration for unified bridge
export interface UnifiedBridgeConfig {
  port?: number;
  enableBinaryProtocol: boolean;
  performanceMode: 'high_throughput' | 'low_latency' | 'balanced';
}

// Service interfaces for dependency injection
export interface UnifiedServices {
  motionCoordinator: any;
  systemMonitor?: any;
}

const DEFAULT_CONFIG: UnifiedBridgeConfig = {
  enableBinaryProtocol: true,
  performanceMode: 'balanced'
} as const;

export class UnifiedWebSocketBridge {
  private connectionManager: ConnectionManager;
  private streamingTransport: StreamingTransport;
  private unifiedRouter: UnifiedMessageRouter;

  // Domain processors
  private bleProcessor: BLEDomainProcessor;
  private streamingProcessor: StreamingDomainProcessor;
  private systemProcessor: SystemDomainProcessor;
  private clientMetadataProcessor: ClientMetadataProcessor;

  // Service adapters (initialized in initialize())
  private bleServiceAdapter: BLEServiceAdapter | null = null;

  private config: UnifiedBridgeConfig;
  private isRunning = false;
  private currentPort = 0;

  constructor(config: Partial<UnifiedBridgeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize core components
    this.connectionManager = new ConnectionManager();
    this.streamingTransport = new StreamingTransport({
      defaultMode: DELIVERY_MODES.FIRE_AND_FORGET
    });
    this.unifiedRouter = new UnifiedMessageRouter();

    // Initialize domain processors
    this.bleProcessor = new BLEDomainProcessor();
    this.streamingProcessor = new StreamingDomainProcessor();
    this.systemProcessor = new SystemDomainProcessor();
    this.clientMetadataProcessor = new ClientMetadataProcessor();

    this.setupUnifiedIntegration();
  }

  async initialize(services: UnifiedServices): Promise<number> {
    console.log('🚀 Initializing Unified WebSocket Bridge...');

    try {
      // Try to initialize BLE - but don't fail the whole bridge if BLE fails
      let bleInitialized = false;
      try {
        // Create adapter first so we can reference its event handler
        this.bleServiceAdapter = new BLEServiceAdapter(null as any); // Temporary, will inject service below

        // Create platform-appropriate BLE service using factory with callbacks
        console.log('🔍 Creating platform-appropriate BLE service...');
        const bleService = await createBleService(
          // CRITICAL: Motion callback must be provided to forward streaming data to UI
          (deviceId: string, motionData: any) => {
            // Forward motion data to adapter which processes and sends to motion coordinator
            (this.bleServiceAdapter as any).handleMotionData(deviceId, motionData);
          },
          (deviceId: string, event: string, data?: any) => {
            // Forward device events to adapter's handler
            this.bleServiceAdapter!.handleDeviceEvent(deviceId, event, data);
          }
        );

        // Inject service into adapter
        (this.bleServiceAdapter as any).bleService = bleService;

        // Initialize BLE service adapter
        bleInitialized = await this.bleServiceAdapter.initialize();
        if (!bleInitialized) {
          console.warn('⚠️ BLE service failed to initialize - continuing without BLE');
        } else {
          console.log('🔄 Enabling initial 25-second burst scan');
          this.bleServiceAdapter.enableBurstScanningFor(25000);
        }

        // Connect service adapters to existing services
        this.bleServiceAdapter.connect(services.motionCoordinator);

        // Setup broadcast function for BLE adapter
        this.bleServiceAdapter.setBroadcastFunction(async (message, clientIds) => {
          await this.connectionManager.broadcast(message);
        });
      } catch (bleError) {
        console.error('❌ BLE initialization failed - continuing without BLE:', bleError);
        this.bleServiceAdapter = null;
      }

      // Inject services into domain processors (BLE may be null)
      if (this.bleServiceAdapter) {
        this.bleProcessor.setBLEService(this.bleServiceAdapter);
      }
      if (services.systemMonitor) {
        this.systemProcessor.setSystemService(services.systemMonitor);
      }
      this.clientMetadataProcessor.setConnectionManager(this.connectionManager);

      // Setup streaming overload notifier
      this.streamingProcessor.setOverloadNotifier({
        notifyOverload: (stats) => this.notifyStreamingOverload(stats)
      });

      // Setup broadcast function for streaming processor
      this.streamingProcessor.setBroadcastFunction(async (message) => {
        await this.connectionManager.broadcast(message);
      });

      // Register domain processors with unified router
      this.unifiedRouter.registerProcessor(this.bleProcessor);
      this.unifiedRouter.registerProcessor(this.streamingProcessor);
      this.unifiedRouter.registerProcessor(this.systemProcessor);
      this.unifiedRouter.registerProcessor(this.clientMetadataProcessor);

      // Start the bridge
      this.currentPort = await this.start(this.config.port);
      console.log(`✅ Unified WebSocket Bridge initialized on port ${this.currentPort}`);

      return this.currentPort;

    } catch (error) {
      console.error('❌ Unified WebSocket Bridge initialization failed:', error);
      throw error;
    }
  }

  // Start the unified bridge
  async start(port?: number): Promise<number> {
    if (this.isRunning) {
      throw new Error('Unified WebSocket Bridge already running');
    }

    // Start connection manager
    this.currentPort = await this.connectionManager.start(port);
    this.isRunning = true;

    console.log(`🔗 Unified WebSocket Bridge started on port ${this.currentPort}`);
    return this.currentPort;
  }

  // Stop the unified bridge
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log('🛑 Stopping Unified WebSocket Bridge...');

    this.streamingTransport.stop();
    await this.connectionManager.stop();

    this.isRunning = false;
    console.log('✅ Unified WebSocket Bridge stopped');
  }

  // Get comprehensive status
  getStatus(): {
    isRunning: boolean;
    port: number;
    connections: number;
    domains: Record<string, any>;
    performance: any;
  } {
    const connectionManagerStats = this.isRunning ? this.connectionManager.getSystemHealth() : null;

    return {
      isRunning: this.isRunning,
      port: this.currentPort,
      connections: connectionManagerStats?.clients.length || 0,
      domains: {
        ble: this.bleProcessor.getStats(),
        streaming: this.streamingProcessor.getStats(),
        system: this.systemProcessor.getStats(),
        clientMetadata: this.clientMetadataProcessor.getStats()
      },
      performance: {
        router: this.unifiedRouter.getStats(),
        streamingTransport: this.streamingTransport.getStats()
      }
    };
  }

  async syncAllDevices(): Promise<{ success: boolean; results?: any[]; message?: string }> {
    if (!this.bleServiceAdapter) {
      return { success: false, message: 'BLE service not initialized' };
    }

    try {
      const result = await this.bleServiceAdapter.syncAllDevices();
      return result;
    } catch (error) {
      console.error('Bridge sync all devices error:', error);
      return {
        success: false,
        message: `Sync failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // Get performance metrics across all domains
  getPerformanceMetrics(): {
    throughput: number;
    latency: number;
    errorRate: number;
    connections: number;
    domains: Record<string, any>;
  } {
    const status = this.getStatus();
    const routerStats = this.unifiedRouter.getStats();
    const streamingStats = this.streamingProcessor.getStats();

    return {
      throughput: streamingStats.currentThroughput,
      latency: streamingStats.avgThroughput > 0 ? 1000 / streamingStats.avgThroughput : 0,
      errorRate: routerStats.totalProcessed > 0 ? routerStats.errors / routerStats.totalProcessed : 0,
      connections: status.connections,
      domains: status.domains
    };
  }

  private setupUnifiedIntegration(): void {
    // Connect connection manager to unified router
    this.connectionManager.onMessage(async (message, clientId) => {
      const response = await this.unifiedRouter.route(message, clientId);

      if (response) {
        await this.connectionManager.sendToClient(clientId, response);
      }
    });

    // Connect streaming transport to connection manager
    this.streamingTransport.setSendFunction(async (message, clientId) => {
      return await this.connectionManager.sendToClient(clientId, message);
    });

    // CRITICAL: Push full state to new clients immediately on connection
    // This ensures immediate state sync on page refresh/reconnect without waiting for client query
    this.connectionManager.onNewClientConnect(async (clientId) => {
      console.log(`📡 [BRIDGE] New client connected: ${clientId} - pushing current state...`);

      // Import UnifiedBLEStateStore to get current state
      const { UnifiedBLEStateStore } = await import('../ble-management');

      // Serialize and send STATE_UPDATE directly to the new client
      const stateMessage = UnifiedBLEStateStore.serializeStateUpdate();
      await this.connectionManager.sendToClient(clientId, stateMessage);

      console.log(`✅ [BRIDGE] Pushed STATE_UPDATE to ${clientId}: globalState=${stateMessage.globalState}, devices=${stateMessage.devices.length}`);
    });

    // Update client lists when connections change
    this.connectionManager.onHealthChange((health) => {
      const clientIds = health.clients.filter(c => c.connected).map(c => c.clientId);
      // Notify processors of client changes if needed
    });

    // Setup periodic cleanup
    setInterval(() => {
      this.performPeriodicCleanup();
    }, 60000); // Every minute
  }

  // Handle streaming overload notifications
  private notifyStreamingOverload(stats: any): void {
    console.warn(`🚨 STREAMING OVERLOAD DETECTED:`, {
      throughput: stats.currentThroughput,
      queueSize: stats.queueSize,
      dropRate: ((stats.dropped / (stats.processed + stats.dropped)) * 100).toFixed(2) + '%'
    });

    // Broadcast overload notification to UI clients
    const overloadMessage = {
      type: MESSAGE_TYPES.ERROR,
      timestamp: Date.now(),
      error: {
        code: 'STREAMING_OVERLOAD',
        message: 'High throughput detected - dropping samples',
        details: stats
      }
    };

    this.streamingTransport.broadcast(overloadMessage, []).catch(console.error);
  }

  // Periodic cleanup of all components
  private performPeriodicCleanup(): void {
    this.streamingTransport.performCleanup();

    // Reset streaming stats to prevent memory growth
    this.streamingProcessor.resetStats();

    // Log performance metrics periodically
    if (this.isRunning) {
      const metrics = this.getPerformanceMetrics();
      console.log(`📊 Unified Bridge Performance:`, {
        throughput: metrics.throughput.toFixed(0) + ' msg/s',
        connections: metrics.connections,
        errorRate: (metrics.errorRate * 100).toFixed(2) + '%',
        domains: {
          ble: metrics.domains.ble.processed,
          streaming: metrics.domains.streaming.processed,
          system: metrics.domains.system.processed
        }
      });
    }
  }
}