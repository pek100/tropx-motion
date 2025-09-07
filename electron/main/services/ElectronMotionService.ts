import { WebSocket, WebSocketServer } from 'ws';
import { motionProcessingCoordinator } from '../../../motionProcessing/MotionProcessingCoordinator';
import { IMUData } from '../../../muse_sdk/core/MuseData';
import { WSMessage, WSMessageType, DeviceInfo, MotionDataUpdate, RecordingSession } from '../types/websocket';
import { DataBatcher } from '../utils/DataBatcher';
import { museManager } from '../../../muse_sdk/core/MuseManager';

export class ElectronMotionService {
    private wsServer: WebSocketServer | null = null;
    private clients = new Set<WebSocket>();
    private dataBatcher: DataBatcher;
    private currentSessionId: string | null = null;
    private isInitialized = false;
    private heartbeatInterval: NodeJS.Timeout | null = null;

    // Simplified state management using SDK
    private isRecording = false;
    private recordingStartTime: Date | null = null;

    private WS_PORT = 8080;
    private readonly HEARTBEAT_INTERVAL = 30000;

    constructor() {
        this.dataBatcher = new DataBatcher(
            (batchedData) => {
                // Real-time: data is always single item now
                this.broadcastMotionData(batchedData as MotionDataUpdate);
            },
            1,    // Real-time: immediate processing
            0     // No delays for real-time streaming
        );
    }

    async initialize(): Promise<void> {
        try {
            console.log('🚀 Initializing Electron Motion Service...');

            console.log('📡 Starting WebSocket server...');
            await this.initializeWebSocketServer();
            console.log('✅ WebSocket server started');

            console.log('🔧 Initializing motion processing...');
            await this.initializeMotionProcessing();
            console.log('✅ Motion processing initialized');

            console.log('📱 Setting up device management...');
            this.setupDeviceManagement();
            console.log('✅ Device management setup');

            console.log('🔗 Setting up motion processing callbacks...');
            this.setupMotionProcessingCallbacks();
            console.log('✅ Motion processing callbacks setup');

            console.log('💓 Starting heartbeat...');
            this.startHeartbeat();
            console.log('✅ Heartbeat started');

            this.isInitialized = true;
            console.log('✅ Electron Motion Service initialized successfully');
            
            this.broadcastStatus();

        } catch (error) {
            console.error('❌ Failed to initialize ElectronMotionService:', error);
            throw error;
        }
    }

    private async findAvailablePort(startPort: number): Promise<number> {
        const net = require('net');
        
        for (let port = startPort; port < startPort + 10; port++) {
            try {
                await new Promise((resolve, reject) => {
                    const server = net.createServer();
                    server.listen(port, () => {
                        server.close(() => resolve(port));
                    });
                    server.on('error', () => reject());
                });
                return port;
            } catch {
                continue;
            }
        }
        throw new Error(`No available ports found starting from ${startPort}`);
    }

    private async initializeWebSocketServer(): Promise<void> {
        return new Promise(async (resolve, reject) => {
            try {
                // Try to find an available port starting from 8080
                try {
                    this.WS_PORT = await this.findAvailablePort(8080);
                } catch (error) {
                    console.warn('⚠️ Could not find available port, trying original port 8080');
                }

                this.wsServer = new WebSocketServer({
                    port: this.WS_PORT,
                    perMessageDeflate: false,
                });

                this.wsServer.on('listening', () => {
                    console.log(`🌐 WebSocket server listening on port ${this.WS_PORT}`);
                    resolve();
                });

                this.wsServer.on('connection', (ws) => {
                    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    console.log(`🔌 New WebSocket client connected: ${clientId}`);

                    this.clients.add(ws);
                    this.sendCurrentState(ws);

                    ws.on('message', (data) => {
                        this.handleClientMessage(ws, data.toString(), clientId);
                    });

                    ws.on('close', () => {
                        console.log(`🔌 Client disconnected: ${clientId}`);
                        this.clients.delete(ws);
                    });

                    ws.on('error', (error) => {
                        console.error(`❌ WebSocket client error (${clientId}):`, error);
                        this.clients.delete(ws);
                    });
                });

                this.wsServer.on('error', (error) => {
                    console.error('❌ WebSocket server error:', error);
                    reject(error);
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    private async initializeMotionProcessing(): Promise<void> {
        try {
            const initStatus = motionProcessingCoordinator.getInitializationStatus();
            console.log('🔧 Motion processing coordinator init status:', initStatus);
            
            if (!initStatus) {
                throw new Error('Motion processing coordinator not initialized');
            }
            
            // Test if coordinator is healthy
            const isHealthy = motionProcessingCoordinator.isHealthy();
            console.log('🔧 Motion processing coordinator health check:', isHealthy);
            
            // Get current recording status
            const recordingStatus = motionProcessingCoordinator.getRecordingStatus();
            console.log('🔧 Motion processing recording status:', recordingStatus);
            
            console.log('✅ Motion processing coordinator ready and verified');
        } catch (error) {
            console.error('❌ Motion processing coordinator verification failed:', error);
            throw error;
        }
    }

    private setupDeviceManagement(): void {
        // Device management will be handled in the renderer process
        // Battery updates will come via WebSocket messages from renderer
        console.log('🔋 Device management delegated to renderer process');
    }

    private setupMotionProcessingCallbacks(): void {
        // Subscribe to UI updates from motion processing coordinator
        motionProcessingCoordinator.subscribeToUI((data: any) => {
            // Create formatted motion data
            const motionData = {
                left: data.left || { current: 0, max: 0, min: 0, rom: 0 },
                right: data.right || { current: 0, max: 0, min: 0, rom: 0 },
                timestamp: Date.now()
            };

            // Use batcher for efficient streaming (remove double broadcast)
            this.dataBatcher.addData(motionData);
        });

        console.log('📊 Motion processing callbacks setup complete');
    }

    private startHeartbeat(): void {
        this.heartbeatInterval = setInterval(() => {
            this.broadcast({
                type: WSMessageType.HEARTBEAT,
                data: { timestamp: Date.now() },
                timestamp: Date.now()
            });
        }, this.HEARTBEAT_INTERVAL);
    }


    async startRecording(sessionData: RecordingSession): Promise<{ success: boolean; message: string }> {
        try {
            if (this.isRecording) {
                return { success: false, message: 'Recording already in progress' };
            }

            console.log('🎬 SDK: Starting recording session with SDK commands...', sessionData);

            const motionSuccess = motionProcessingCoordinator.startRecording(
                sessionData.sessionId,
                sessionData.exerciseId,
                sessionData.setNumber
            );

            if (!motionSuccess) {
                return { success: false, message: 'Failed to start motion processing' };
            }

            // Send recording commands to all connected devices via SDK
            console.log('🎬 SDK: Sending start recording commands to all devices...');
            const recordingStarted = await museManager.startRecordingOnDevices();
            
            if (!recordingStarted) {
                // Clean up motion processing if device recording failed
                await motionProcessingCoordinator.stopRecording();
                return { success: false, message: 'Failed to start recording on devices via SDK' };
            }

            this.isRecording = true;
            this.recordingStartTime = new Date();
            this.currentSessionId = sessionData.sessionId;

            this.broadcastRecordingState();

            console.log('🎬 SDK: Recording started on devices and motion processing');
            return { success: true, message: 'Recording started successfully via SDK' };

        } catch (error) {
            console.error('❌ Recording start error:', error);
            return { success: false, message: `Failed to start recording: ${error instanceof Error ? error.message : String(error)}` };
        }
    }

    async stopRecording(): Promise<{ success: boolean; message: string; recordingId?: string }> {
        try {
            if (!this.isRecording) {
                return { success: false, message: 'No recording in progress' };
            }

            console.log('🛑 SDK: Stopping recording session with SDK commands...');

            // Send stop recording commands to all devices via SDK first
            console.log('🛑 SDK: Sending stop recording commands to all devices...');
            const recordingStopped = await museManager.stopRecordingOnDevices();

            // Stop motion processing
            const success = await motionProcessingCoordinator.stopRecording();

            this.isRecording = false;
            this.recordingStartTime = null;
            const sessionId = this.currentSessionId;
            this.currentSessionId = null;

            this.broadcastRecordingState();

            const statusMessage = recordingStopped ? 
                'Recording stopped successfully via SDK' : 
                'Recording stopped (some devices may not have received stop command)';

            console.log('🛑 SDK: Recording stopped on devices and motion processing');

            if (success) {
                return { 
                    success: true, 
                    message: statusMessage,
                    recordingId: sessionId || undefined
                };
            } else {
                return { success: false, message: 'Recording stopped but processing failed' };
            }

        } catch (error) {
            console.error('❌ Recording stop error:', error);
            return { success: false, message: `Failed to stop recording: ${error instanceof Error ? error.message : String(error)}` };
        }
    }

    getStatus() {
        // Get device info from SDK
        const sdkDevices = museManager.getAllDevices();
        const batteryLevels = Object.fromEntries(museManager.getAllBatteryLevels());

        return {
            isInitialized: this.isInitialized,
            isRecording: this.isRecording,
            connectedDevices: sdkDevices.map(d => ({
                id: d.id,
                name: d.name,
                connected: d.connected,
                batteryLevel: d.batteryLevel
            })),
            batteryLevels,
            recordingStartTime: this.recordingStartTime?.toISOString(),
            wsPort: this.WS_PORT,
            clientCount: this.clients.size
        };
    }

    getWebSocketPort(): number {
        return this.WS_PORT;
    }

    async connectDevices(): Promise<{ success: boolean; message: string; devices?: DeviceInfo[] }> {
        try {
            console.log('🔍 grosdode pattern: Simple device connection trigger');
            
            // Send simple message to trigger Web Bluetooth scan
            this.broadcast({
                type: WSMessageType.SCAN_REQUEST,
                data: { 
                    action: 'trigger_bluetooth_scan',
                    message: 'Triggering Web Bluetooth scan for device selection'
                },
                timestamp: Date.now()
            });

            return { 
                success: true, 
                message: 'Web Bluetooth scan triggered'
            };
        } catch (error) {
            console.error('❌ Device connection trigger failed:', error);
            return { 
                success: false, 
                message: `Connection trigger failed: ${error instanceof Error ? error.message : String(error)}` 
            };
        }
    }

    // Simplified state - let SDK handle device management
    private isScanning = false;

    async scanForDevices(): Promise<{ success: boolean; message: string }> {
        try {
            console.log('📡 grosdode pattern: Simple scan trigger');
            
            if (this.isScanning) {
                return { success: false, message: 'Scan already in progress' };
            }

            this.isScanning = true;
            
            // Simple trigger - let grosdode pattern handle the rest
            this.broadcast({
                type: WSMessageType.SCAN_REQUEST,
                data: { 
                    action: 'trigger_bluetooth_scan',
                    message: 'Trigger Web Bluetooth scan for grosdode device selection'
                },
                timestamp: Date.now()
            });

            // Reset scanning after reasonable timeout
            setTimeout(() => {
                this.isScanning = false;
            }, 10000);

            return { 
                success: true, 
                message: 'Web Bluetooth scan triggered'
            };
        } catch (error) {
            console.error('❌ Scan trigger failed:', error);
            this.isScanning = false;
            return { success: false, message: `Scan trigger failed: ${error instanceof Error ? error.message : String(error)}` };
        }
    }

    /**
     * Cancel scan - simplified
     */
    public cancelScan(): { success: boolean; message: string } {
        if (!this.isScanning) {
            return { success: false, message: 'No scan in progress' };
        }

        console.log('🚫 Scan canceled');
        this.isScanning = false;
        return { success: true, message: 'Scan canceled' };
    }

    /**
     * Store devices found via grosdode pattern in SDK
     */
    storeScannedDevices(devices: any[]) {
        console.log('📋 grosdode pattern: Storing devices in SDK');
        
        // Add devices to SDK registry
        const sdkDevices = devices.map(device => ({
            deviceId: device.deviceId,
            deviceName: device.deviceName
        }));
        
        museManager.addScannedDevices(sdkDevices);
        console.log(`📋 Added ${devices.length} devices to SDK registry`);
    }

    // Removed - grosdode pattern handles device filtering automatically

    /**
     * grosdode pattern: Simple device connection using SDK
     */
    async connectToSpecificDevice(deviceName: string): Promise<{ success: boolean; message: string }> {
        try {
            console.log(`🔗 grosdode pattern: Connecting to device via SDK: ${deviceName}`);

            // Use SDK to connect - it will handle the Web Bluetooth connection
            const success = await museManager.connectToScannedDevice('', deviceName);

            if (success) {
                // Notify UI of successful connection
                this.broadcastDeviceStatus();
                console.log(`✅ SDK connection successful for ${deviceName}`);
                return { success: true, message: `Connected to ${deviceName} via SDK` };
            } else {
                console.error(`❌ SDK connection failed for ${deviceName}`);
                return { success: false, message: `Failed to connect to ${deviceName}` };
            }

        } catch (error) {
            console.error(`❌ SDK connection error for ${deviceName}:`, error);
            return { success: false, message: `Connection error: ${error instanceof Error ? error.message : String(error)}` };
        }
    }


    // Removed - grosdode pattern handles device selection automatically in main.ts

    /**
     * Processes motion data received from the renderer process
     */
    private processMotionDataFromRenderer(data: any): void {
        try {
            // Validate required data fields
            if (!data) {
                console.error('❌ No motion data provided');
                return;
            }

            const deviceName = data.deviceName || `device_${Date.now()}`;

            // Only validate device naming pattern once on first connection (reduce logging overhead)
            const isValidForJoints = deviceName.toLowerCase().includes('tropx') &&
                                   (deviceName.includes('_ln_') || deviceName.includes('_rn_') || 
                                    deviceName.includes('ln_') || deviceName.includes('rn_'));
            
            // Convert renderer data to IMU format expected by motion processing
            const imuData: IMUData = {
                timestamp: data.timestamp || Date.now(),
                quaternion: data.quaternion || { w: 1, x: 0, y: 0, z: 0 },
                gyr: data.gyroscope || { x: 0, y: 0, z: 0 },
                axl: data.accelerometer || { x: 0, y: 0, z: 0 },
                mag: data.magnetometer || { x: 0, y: 0, z: 0 }
            };

            // Check if motion processing coordinator is ready
            if (!motionProcessingCoordinator.getInitializationStatus()) {
                console.error('❌ Motion processing coordinator not initialized');
                return;
            }

            // Feed data into motion processing coordinator (core processing)
            motionProcessingCoordinator.processNewData(deviceName, imuData);

        } catch (error) {
            console.error('❌ Error processing motion data from renderer:', error);
        }
    }

    // Removed - using SDK for device management

    private handleClientMessage(ws: WebSocket, message: string, clientId: string): void {
        try {
            const parsed = JSON.parse(message);

            switch (parsed.type) {
                case 'ping':
                    this.sendToClient(ws, {
                        type: WSMessageType.PONG,
                        data: { timestamp: Date.now() },
                        timestamp: Date.now()
                    });
                    break;

                // 🔵 Handle device discovery trigger from renderer after successful connection
                case 'trigger_device_discovery':
                    console.log('🔵 [ElectronMotionService] Received device discovery trigger request');
                    console.log('🔵 Device info:', parsed.data);
                    this.triggerDeviceDiscoveryPattern(parsed.data);
                    break;

                // Removed - grosdode pattern handles device selection in main.ts
                // case 'select_bluetooth_device': - no longer needed

                case 'motion_data':
                    // Process incoming motion data from renderer
                    this.processMotionDataFromRenderer(parsed.data);
                    break;

                case 'request_status':
                    this.sendCurrentState(ws);
                    break;

                default:
                    console.warn(`Unknown message type: ${parsed.type}`);
            }
        } catch (error) {
            console.error(`❌ Error handling client message:`, error);
        }
    }

    private sendCurrentState(ws: WebSocket): void {
        const status = this.getStatus();
        this.sendToClient(ws, {
            type: WSMessageType.STATUS_UPDATE,
            data: status,
            timestamp: Date.now()
        });
    }

    private sendToClient(ws: WebSocket, message: WSMessage): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    // Public method for broadcasting messages (used by main process)
    public broadcastMessage(message: WSMessage): void {
        this.broadcast(message);
    }

    // Private broadcast method for internal use - optimized to serialize once
    private broadcast(message: WSMessage): void {
        if (this.clients.size === 0) return; // Early exit if no clients

        const data = JSON.stringify(message);
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(data);
                } catch (error) {
                    console.error('❌ Failed to send data to client, removing:', error);
                    this.clients.delete(client);
                }
            } else {
                // Clean up disconnected clients
                this.clients.delete(client);
            }
        });
    }

    private broadcastStatus(): void {
        this.broadcast({
            type: WSMessageType.STATUS_UPDATE,
            data: this.getStatus(),
            timestamp: Date.now()
        });
    }

    private broadcastDeviceStatus(): void {
        // Get device info from SDK
        const sdkDevices = museManager.getAllDevices();
        const batteryLevels = Object.fromEntries(museManager.getAllBatteryLevels());

        this.broadcast({
            type: WSMessageType.DEVICE_STATUS,
            data: {
                connectedDevices: sdkDevices.filter(d => d.connected).map(d => ({
                    id: d.id,
                    name: d.name,
                    connected: d.connected,
                    batteryLevel: d.batteryLevel
                })),
                batteryLevels
            },
            timestamp: Date.now()
        });
    }

    private broadcastRecordingState(): void {
        this.broadcast({
            type: WSMessageType.RECORDING_STATE,
            data: {
                isRecording: this.isRecording,
                startTime: this.recordingStartTime?.toISOString(),
                sessionId: this.currentSessionId
            },
            timestamp: Date.now()
        });
    }

    private broadcastMotionData(data: MotionDataUpdate): void {
        this.broadcast({
            type: WSMessageType.MOTION_DATA,
            data,
            timestamp: Date.now()
        });
    }

    /**
     * 🔵 Trigger device discovery pattern after successful connection
     */
    private triggerDeviceDiscoveryPattern(deviceData: any): void {
        try {
            console.log('🔵 [ElectronMotionService] Triggering device discovery pattern...');
            console.log('🔵 Connected device:', deviceData.deviceName, deviceData.deviceId);

            // Send the same scan request that the scan button triggers
            this.broadcast({
                type: WSMessageType.SCAN_REQUEST,
                data: {
                    action: 'trigger_bluetooth_scan',
                    message: `Device discovery after connection: ${deviceData.deviceName}`,
                    triggeredBy: 'post_connection',
                    connectedDevice: deviceData.deviceName
                },
                timestamp: Date.now()
            });

            console.log('🔵 Device discovery pattern broadcast sent to all clients');

        } catch (error) {
            console.error('❌ Failed to trigger device discovery pattern:', error);
        }
    }

    cleanup(): void {
        console.log('🧹 Cleaning up ElectronMotionService...');
        
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        this.dataBatcher.cleanup();
        
        this.clients.forEach(client => {
            client.close();
        });
        this.clients.clear();

        if (this.wsServer) {
            this.wsServer.close();
        }

        if (this.isRecording) {
            motionProcessingCoordinator.stopRecording().catch(console.error);
        }

        console.log('✅ ElectronMotionService cleanup complete');
    }
}
