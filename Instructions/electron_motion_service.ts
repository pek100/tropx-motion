// electron/main/services/ElectronMotionService.ts
import { WebSocket, WebSocketServer } from 'ws';
import { motionProcessingCoordinator } from '../../../services/motionProcessing/MotionProcessingCoordinator';
import { museManager } from '../../../sdk/core/MuseManager';
import { IMUData } from '../../../sdk/core/MuseData';
import { WSMessage, WSMessageType, DeviceInfo, MotionDataUpdate, RecordingSession } from '../types/websocket';
import { DataBatcher } from '../utils/DataBatcher';

export class ElectronMotionService {
    private wsServer: WebSocketServer | null = null;
    private clients = new Set<WebSocket>();
    private dataBatcher: DataBatcher;
    private currentSessionId: string | null = null;
    private deviceSelectionCallback: ((deviceId: string) => void) | null = null;
    private isInitialized = false;
    private heartbeatInterval: NodeJS.Timeout | null = null;

    // Connection state
    private connectedDevices = new Map<string, DeviceInfo>();
    private batteryLevels = new Map<string, number>();
    private isRecording = false;
    private recordingStartTime: Date | null = null;

    // Configuration
    private readonly WS_PORT = 8080;
    private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds

    constructor() {
        this.dataBatcher = new DataBatcher(
            (batchedData) => this.broadcastMotionData(batchedData),
            10, // batch size
            16  // max delay (60fps)
        );
    }

    async initialize(): Promise<void> {
        try {
            console.log('🚀 Initializing Electron Motion Service...');

            // Initialize WebSocket server first
            await this.initializeWebSocketServer();

            // Initialize motion processing coordinator
            await this.initializeMotionProcessing();

            // Setup device management
            this.setupDeviceManagement();

            // Setup motion processing subscriptions
            this.setupMotionProcessingCallbacks();

            // Start heartbeat
            this.startHeartbeat();

            this.isInitialized = true;
            console.log('✅ Electron Motion Service initialized successfully');
            
            // Broadcast initial status
            this.broadcastStatus();

        } catch (error) {
            console.error('❌ Failed to initialize ElectronMotionService:', error);
            throw error;
        }
    }

    private async initializeWebSocketServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.wsServer = new WebSocketServer({
                    port: this.WS_PORT,
                    perMessageDeflate: false, // Better for real-time data
                });

                this.wsServer.on('listening', () => {
                    console.log(`🌐 WebSocket server listening on port ${this.WS_PORT}`);
                    resolve();
                });

                this.wsServer.on('connection', (ws, req) => {
                    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    console.log(`🔌 New WebSocket client connected: ${clientId}`);

                    this.clients.add(ws);

                    // Send current state immediately
                    this.sendCurrentState(ws);

                    // Setup message handling
                    ws.on('message', (data) => {
                        this.handleClientMessage(ws, data.toString(), clientId);
                    });

                    // Handle client disconnect
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
        // The coordinator should already be initialized from your existing code
        // We just need to ensure it's ready
        if (!motionProcessingCoordinator.getInitializationStatus()) {
            throw new Error('Motion processing coordinator not initialized');
        }
        console.log('✅ Motion processing coordinator ready');
    }

    private setupDeviceManagement(): void {
        // Subscribe to battery level updates
        const unsubscribeBattery = museManager.onBatteryLevelsUpdate((levels: Map<string, number>) => {
            levels.forEach((level, deviceId) => {
                this.batteryLevels.set(deviceId, level);
                motionProcessingCoordinator.updateBatteryLevel(deviceId, level);
            });
            
            this.broadcastDeviceStatus();
        });

        console.log('🔋 Device management setup complete');
    }

    private setupMotionProcessingCallbacks(): void {
        // Subscribe to UI data updates from motion processing
        const unsubscribeUI = motionProcessingCoordinator.subscribeToUI((data: any) => {
            if (!this.isRecording) return; // Only send data during recording

            // Add to batch for efficient streaming
            this.dataBatcher.addData({
                left: data.left || { current: 0, max: 0, min: 0, rom: 0 },
                right: data.right || { current: 0, max: 0, min: 0, rom: 0 },
                timestamp: Date.now()
            });
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

    // Public API Methods
    async connectDevices(): Promise<{ success: boolean; message: string }> {
        try {
            console.log('🔍 Starting device discovery...');
            const success = await museManager.discoverAndConnect();
            
            if (success) {
                // Update connected devices
                const devices = museManager.getConnectedDevices();
                this.updateConnectedDevices(devices);
                
                this.broadcastDeviceStatus();
                return { success: true, message: 'Devices connected successfully' };
            } else {
                return { success: false, message: 'Failed to connect to devices' };
            }
        } catch (error) {
            console.error('❌ Device connection error:', error);
            return { success: false, message: `Connection error: ${error.message}` };
        }
    }

    async startRecording(sessionData: RecordingSession): Promise<{ success: boolean; message: string }> {
        try {
            if (this.isRecording) {
                return { success: false, message: 'Recording already in progress' };
            }

            console.log('🎬 Starting recording session...', sessionData);

            // Start motion processing recording
            const motionSuccess = motionProcessingCoordinator.startRecording(
                sessionData.sessionId,
                sessionData.exerciseId,
                sessionData.setNumber
            );

            if (!motionSuccess) {
                return { success: false, message: 'Failed to start motion processing' };
            }

            // Start device streaming with callback
            const streamingCallback = this.createStreamingCallback();
            const streamSuccess = await museManager.startStreaming(streamingCallback);

            if (!streamSuccess) {
                motionProcessingCoordinator.stopRecording();
                return { success: false, message: 'Failed to start device streaming' };
            }

            // Update state
            this.isRecording = true;
            this.recordingStartTime = new Date();
            this.currentSessionId = sessionData.sessionId;

            // Broadcast recording started
            this.broadcastRecordingState();

            return { success: true, message: 'Recording started successfully' };

        } catch (error) {
            console.error('❌ Recording start error:', error);
            return { success: false, message: `Failed to start recording: ${error.message}` };
        }
    }

    async stopRecording(): Promise<{ success: boolean; message: string; recordingId?: string }> {
        try {
            if (!this.isRecording) {
                return { success: false, message: 'No recording in progress' };
            }

            console.log('🛑 Stopping recording session...');

            // Stop device streaming
            await museManager.stopStreaming();

            // Stop motion processing
            const success = await motionProcessingCoordinator.stopRecording();

            // Update state
            this.isRecording = false;
            this.recordingStartTime = null;
            const sessionId = this.currentSessionId;
            this.currentSessionId = null;

            // Broadcast recording stopped
            this.broadcastRecordingState();

            if (success) {
                return { 
                    success: true, 
                    message: 'Recording stopped successfully',
                    recordingId: sessionId || undefined
                };
            } else {
                return { success: false, message: 'Recording stopped but processing failed' };
            }

        } catch (error) {
            console.error('❌ Recording stop error:', error);
            return { success: false, message: `Failed to stop recording: ${error.message}` };
        }
    }

    getStatus() {
        return {
            isInitialized: this.isInitialized,
            isRecording: this.isRecording,
            connectedDevices: Array.from(this.connectedDevices.values()),
            batteryLevels: Object.fromEntries(this.batteryLevels),
            recordingStartTime: this.recordingStartTime?.toISOString(),
            wsPort: this.WS_PORT,
            clientCount: this.clients.size
        };
    }

    getWebSocketPort(): number {
        return this.WS_PORT;
    }

    // Bluetooth device selection handler
    handleBluetoothDeviceSelection(deviceList: any[], callback: (deviceId: string) => void): void {
        console.log('🔵 Handling Bluetooth device selection:', deviceList);
        
        // Store callback for when UI makes selection
        this.deviceSelectionCallback = callback;

        // Send device list to connected clients for selection
        this.broadcast({
            type: WSMessageType.BLUETOOTH_DEVICES,
            data: { devices: deviceList },
            timestamp: Date.now()
        });

        // Auto-select first device if available (can be customized)
        if (deviceList.length > 0) {
            const selectedDevice = deviceList[0];
            console.log('🔵 Auto-selecting device:', selectedDevice.deviceName);
            callback(selectedDevice.deviceId);
        } else {
            // No devices found
            callback('');
        }
    }

    // Private helper methods
    private createStreamingCallback() {
        return (deviceName: string, imuData: IMUData) => {
            // Process through motion coordinator
            motionProcessingCoordinator.processNewData(deviceName, imuData);
        };
    }

    private updateConnectedDevices(deviceMap: Map<string, any>): void {
        this.connectedDevices.clear();
        deviceMap.forEach((device, deviceId) => {
            this.connectedDevices.set(deviceId, {
                id: deviceId,
                name: device.device?.name || deviceId,
                connected: true,
                batteryLevel: this.batteryLevels.get(deviceId) || null
            });
        });
    }

    private handleClientMessage(ws: WebSocket, message: string, clientId: string): void {
        try {
            const parsed = JSON.parse(message);
            console.log(`📨 Message from ${clientId}:`, parsed.type);

            switch (parsed.type) {
                case 'ping':
                    this.sendToClient(ws, {
                        type: WSMessageType.PONG,
                        data: { timestamp: Date.now() },
                        timestamp: Date.now()
                    });
                    break;

                case 'select_bluetooth_device':
                    if (this.deviceSelectionCallback && parsed.data?.deviceId) {
                        this.deviceSelectionCallback(parsed.data.deviceId);
                        this.deviceSelectionCallback = null;
                    }
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

    private broadcast(message: WSMessage): void {
        const data = JSON.stringify(message);
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(data);
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
        this.broadcast({
            type: WSMessageType.DEVICE_STATUS,
            data: {
                connectedDevices: Array.from(this.connectedDevices.values()),
                batteryLevels: Object.fromEntries(this.batteryLevels)
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

        // Cleanup motion processing
        if (this.isRecording) {
            motionProcessingCoordinator.stopRecording().catch(console.error);
        }

        console.log('✅ ElectronMotionService cleanup complete');
    }
}