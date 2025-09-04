import { WebSocket, WebSocketServer } from 'ws';
import { motionProcessingCoordinator } from '../../../motionProcessing/MotionProcessingCoordinator';
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
    private deviceSelectionInProgress = false;

    private connectedDevices = new Map<string, DeviceInfo>();
    private batteryLevels = new Map<string, number>();
    private isRecording = false;
    private recordingStartTime: Date | null = null;

    private WS_PORT = 8080;
    private readonly HEARTBEAT_INTERVAL = 30000;

    constructor() {
        this.dataBatcher = new DataBatcher(
            (batchedData) => {
                if (Array.isArray(batchedData)) {
                    batchedData.forEach(data => this.broadcastMotionData(data));
                } else {
                    this.broadcastMotionData(batchedData);
                }
            },
            10,
            16
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
            console.log('📊 Motion processing UI update received:', data);
            
            // Create formatted motion data
            const motionData = {
                left: data.left || { current: 0, max: 0, min: 0, rom: 0 },
                right: data.right || { current: 0, max: 0, min: 0, rom: 0 },
                timestamp: Date.now()
            };

            // Always broadcast to UI (not just when recording)
            this.dataBatcher.addData(motionData);

            // Also broadcast immediately for real-time UI updates
            this.broadcastMotionData(motionData);
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

            console.log('🎬 Starting recording session...', sessionData);

            const motionSuccess = motionProcessingCoordinator.startRecording(
                sessionData.sessionId,
                sessionData.exerciseId,
                sessionData.setNumber
            );

            if (!motionSuccess) {
                return { success: false, message: 'Failed to start motion processing' };
            }

            // Device streaming will be handled by the renderer process
            // The renderer will send motion data via WebSocket messages

            this.isRecording = true;
            this.recordingStartTime = new Date();
            this.currentSessionId = sessionData.sessionId;

            this.broadcastRecordingState();

            return { success: true, message: 'Recording started successfully' };

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

            console.log('🛑 Stopping recording session...');

            // Device streaming stop will be handled by the renderer process
            const success = await motionProcessingCoordinator.stopRecording();

            this.isRecording = false;
            this.recordingStartTime = null;
            const sessionId = this.currentSessionId;
            this.currentSessionId = null;

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
            return { success: false, message: `Failed to stop recording: ${error instanceof Error ? error.message : String(error)}` };
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

    async connectDevices(): Promise<{ success: boolean; message: string; devices?: DeviceInfo[] }> {
        try {
            console.log('🔍 Starting device connection process...');
            console.log('🔍 Note: Device connection must be initiated from renderer process');
            
            // Send message to renderer to trigger device connection
            this.broadcast({
                type: WSMessageType.SCAN_REQUEST,
                data: { 
                    action: 'connect_devices',
                    message: 'Connecting to Bluetooth devices from renderer process'
                },
                timestamp: Date.now()
            });

            return { 
                success: true, 
                message: 'Device connection initiated in renderer process'
            };
        } catch (error) {
            console.error('❌ Device connection trigger failed:', error);
            return { 
                success: false, 
                message: `Device connection trigger failed: ${error instanceof Error ? error.message : String(error)}` 
            };
        }
    }

    private discoveredDevices: any[] = [];
    private bluetoothCallback: ((deviceId: string) => void) | null = null;
    private pendingConnections: Map<string, boolean> = new Map(); // Track pending connections

    async scanForDevices(): Promise<{ success: boolean; message: string }> {
        try {
            console.log('📡 Starting device scan from main process...');
            console.log('📡 This will trigger select-bluetooth-device event handler');
            
            // Clear previous devices
            this.discoveredDevices = [];
            this.bluetoothCallback = null;
            
            // UPDATED: Trigger a Web Bluetooth scan that will activate the select-bluetooth-device handler
            // We do this by sending a message to the renderer to make a Web Bluetooth request
            // which will then trigger our main process handler
            
            this.broadcast({
                type: WSMessageType.SCAN_REQUEST,
                data: { 
                    action: 'trigger_main_process_scan',
                    message: 'Starting main process Bluetooth device discovery'
                },
                timestamp: Date.now()
            });

            return { 
                success: true, 
                message: 'Main process Bluetooth scan initiated - devices will appear in UI when found' 
            };
        } catch (error) {
            console.error('❌ Device scan trigger failed:', error);
            return { success: false, message: `Scan trigger failed: ${error instanceof Error ? error.message : String(error)}` };
        }
    }

    /**
     * Store discovered devices and callback for later connection requests
     */
    setDiscoveredDevices(devices: any[], callback: (deviceId: string) => void) {
        console.log('📋 Storing discovered devices for connection requests');
        this.discoveredDevices = devices;
        this.bluetoothCallback = callback;
    }

    /**
     * Send discovered devices to renderer for display
     */
    sendDiscoveredDevicesToRenderer(devices: any[]) {
        console.log('📡 Sending discovered devices to renderer:', devices.length);
        
        // Filter devices according to SDK specifications
        const filteredDevices = devices.filter(device => {
            const deviceName = device.deviceName?.toLowerCase() || '';
            
            // Use SDK-based filtering: must contain "tropx" and have proper naming pattern
            const isValidTropxDevice = deviceName.includes('tropx') &&
                                     (deviceName.includes('_ln_') || deviceName.includes('_rn_') ||
                                      deviceName.includes('ln_') || deviceName.includes('rn_'));
                                      
            if (isValidTropxDevice) {
                console.log(`✅ Valid SDK device: ${device.deviceName}`);
                return true;
            } else {
                console.log(`🚫 Filtered out non-SDK device: ${device.deviceName}`);
                return false;
            }
        });
        
        console.log(`📡 Filtered ${filteredDevices.length}/${devices.length} devices based on SDK criteria`);
        
        this.broadcast({
            type: WSMessageType.DEVICE_SCAN_RESULT,
            data: { 
                devices: filteredDevices.map(device => ({
                    id: device.deviceId,
                    name: device.deviceName,
                    connected: false,
                    batteryLevel: null
                }))
            },
            timestamp: Date.now()
        });
    }

    /**
     * Connect to a specific device using the stored Electron callback
     * This bridges Electron's device discovery with SDK connection
     */
    async connectToSpecificDevice(deviceName: string): Promise<{ success: boolean; message: string }> {
        try {
            console.log(`🔗 Connecting to specific device: ${deviceName}`);
            
            // Check if connection is already in progress for this device
            if (this.pendingConnections.get(deviceName)) {
                console.log(`⚠️ Connection already in progress for ${deviceName}`);
                return { success: false, message: `Connection already in progress for ${deviceName}` };
            }
            
            if (!this.bluetoothCallback) {
                return { success: false, message: 'No Bluetooth callback available - please scan for devices first' };
            }

            // Find the device in our discovered list
            const targetDevice = this.discoveredDevices.find(device => device.deviceName === deviceName);
            if (!targetDevice) {
                return { success: false, message: `Device ${deviceName} not found in discovered devices` };
            }

            // Mark this device as having a pending connection
            this.pendingConnections.set(deviceName, true);

            console.log(`📱 Selecting device via Electron callback: ${targetDevice.deviceName} (${targetDevice.deviceId})`);
            
            try {
                // Step 1: Use Electron's callback to make device available to Web Bluetooth
                this.bluetoothCallback(targetDevice.deviceId);
                
                // Step 2: Clear the callback to prevent reuse issues
                // Note: We keep the callback for now but track usage per device
                
                // Step 3: Give the system a moment to process the selection
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Step 4: The device should now be available to Web Bluetooth in the renderer
                // Send connection success message back to renderer so it can use the SDK
                this.broadcast({
                    type: WSMessageType.DEVICE_CONNECTED,
                    data: {
                        deviceId: targetDevice.deviceId,
                        deviceName: targetDevice.deviceName,
                        message: 'Device made available via Electron - ready for SDK connection'
                    },
                    timestamp: Date.now()
                });
                
                console.log(`✅ Device ${deviceName} made available via main process for SDK connection`);
                
                // Clear the pending connection status
                this.pendingConnections.delete(deviceName);
                
                return { success: true, message: `Device ${deviceName} made available for SDK connection` };
                
            } catch (callbackError) {
                // Clear pending status on callback error
                this.pendingConnections.delete(deviceName);
                throw callbackError;
            }
            
        } catch (error) {
            console.error(`❌ Failed to connect to device ${deviceName}:`, error);
            // Ensure pending status is cleared on any error
            this.pendingConnections.delete(deviceName);
            return { success: false, message: `Connection failed: ${error instanceof Error ? error.message : String(error)}` };
        }
    }


    handleBluetoothDeviceSelection(deviceList: any[], callback: (deviceId: string) => void): void {
        console.log('🔵 Electron select-bluetooth-device event triggered');
        console.log('🔵 Found', deviceList.length, 'Bluetooth devices');
        console.log('🔵 Raw device list from Electron:', deviceList);
        
        if (deviceList.length === 0) {
            console.log('🔵 No Bluetooth devices found - this could mean:');
            console.log('🔵 1. No BLE devices are advertising nearby');
            console.log('🔵 2. Device is not in discoverable/pairable mode');
            console.log('🔵 3. Bluetooth is disabled on system');
            console.log('🔵 4. Electron filtering is excluding devices');

            // Broadcast empty result to UI
            this.broadcast({
                type: WSMessageType.DEVICE_SCAN_RESULT,
                data: {
                    devices: [],
                    success: true,
                    message: 'No Bluetooth devices found',
                    selectedDevice: null
                },
                timestamp: Date.now()
            });

            callback(''); // Call callback with empty string for no device
            return;
        }
        
        // Log device details
        deviceList.forEach((device, index) => {
            console.log(`🔵 Device ${index + 1}:`, {
                name: device.deviceName,
                id: device.deviceId,
                paired: device.paired
            });
        });
        
        // CRITICAL: Filter devices to only show supported Tropx/Muse devices
        console.log('📋 Filtering devices for supported Tropx/Muse devices only...');

        // Filter for supported devices based on name patterns
        const supportedDevices = deviceList.filter(device => {
            const deviceName = device.deviceName || '';
            const isValidTropxDevice = deviceName.toLowerCase().includes('tropx') &&
                                     (deviceName.includes('_ln_') || deviceName.includes('_rn_') ||
                                      deviceName.includes('ln_') || deviceName.includes('rn_'));
            const isValidMuseDevice = deviceName.toLowerCase().includes('muse');

            const isSupported = isValidTropxDevice || isValidMuseDevice;

            if (!isSupported) {
                console.log(`❌ Filtering out unsupported device: "${deviceName}" (${device.deviceId})`);
            } else {
                console.log(`✅ Including supported device: "${deviceName}" (${device.deviceId})`);
            }

            return isSupported;
        });

        if (supportedDevices.length === 0) {
            console.log('❌ No supported Tropx/Muse devices found');
            // Broadcast empty result to UI
            this.broadcast({
                type: WSMessageType.DEVICE_SCAN_RESULT,
                data: {
                    devices: [],
                    success: true,
                    message: 'No supported Tropx/Muse devices found',
                    selectedDevice: null
                },
                timestamp: Date.now()
            });

            callback(''); // Call callback with empty string for no device
            return;
        }

        // Log supported device details
        supportedDevices.forEach((device, index) => {
            console.log(`🔵 Supported Device ${index + 1}:`, {
                name: device.deviceName,
                id: device.deviceId,
                paired: device.paired
            });
        });

        // CRITICAL: Register supported devices only
        // Note: Import MuseManager class, not instance, since main process doesn't have one
        console.log('📋 Registering discovered supported devices...');
        // We'll let the renderer handle the MuseManager registration since that's where the instance lives

        // Send ONLY SUPPORTED devices to renderer for UI display
        console.log('🔵 Broadcasting supported devices to UI for selection');

        const supportedDeviceList = supportedDevices.map(device => {
            const deviceName = device.deviceName || 'Unknown Device';

            console.log(`🔍 Adding supported device: "${deviceName}" (${device.deviceId})`);

            return {
                id: device.deviceId,
                name: deviceName,
                connected: false,
                batteryLevel: null,
                paired: device.paired || false
            };
        });

        this.broadcast({
            type: WSMessageType.DEVICE_SCAN_RESULT,
            data: {
                devices: supportedDeviceList,
                success: true,
                message: `Found ${supportedDevices.length} supported Tropx/Muse device(s)`,
                selectedDevice: null // No auto-selection, let user choose
            },
            timestamp: Date.now()
        });

        // Don't auto-select any device - let the user choose from the UI
        // Cancel the Web Bluetooth dialog since we're handling device selection in our UI
        console.log('🔵 Canceling Web Bluetooth dialog - devices will be shown in custom UI');
        callback(''); // Cancel the Web Bluetooth selection dialog
        console.log('✅ Device list broadcast completed, user can now select from UI');
    }

    /**
     * Processes motion data received from the renderer process
     */
    private processMotionDataFromRenderer(data: any): void {
        try {
            console.log('📊 Raw motion data received from renderer:', data);
            
            // Validate required data fields
            if (!data) {
                console.error('❌ No motion data provided');
                return;
            }

            const deviceName = data.deviceName || `device_${Date.now()}`;
            console.log(`📊 Processing motion data for device: ${deviceName}`);
            
            // Validate device name for joint assignment
            const isValidForJoints = deviceName.toLowerCase().includes('tropx') && 
                                   (deviceName.includes('_ln_') || deviceName.includes('_rn_') || 
                                    deviceName.includes('ln_') || deviceName.includes('rn_'));
            
            if (!isValidForJoints) {
                console.warn(`⚠️ Device "${deviceName}" doesn't match joint naming patterns`);
                console.warn('⚠️ Expected patterns: ln_top, ln_bottom, rn_top, rn_bottom');
                console.warn('⚠️ This device may not contribute to joint angle calculations');
            } else {
                console.log(`✅ Device "${deviceName}" has valid joint naming pattern`);
            }

            // Log detailed data structure
            console.log('📊 Motion data details:', {
                deviceName,
                timestamp: data.timestamp,
                hasQuaternion: !!data.quaternion,
                quaternion: data.quaternion,
                gyroscope: data.gyroscope,
                accelerometer: data.accelerometer,
                magnetometer: data.magnetometer,
                hasRawData: !!data.rawData
            });

            // Convert renderer data to IMU format expected by motion processing
            const imuData: IMUData = {
                timestamp: data.timestamp || Date.now(),
                // Primary orientation data - quaternion is essential for motion processing
                quaternion: data.quaternion || { w: 1, x: 0, y: 0, z: 0 },
                // Traditional IMU sensor data (optional but useful)
                gyr: data.gyroscope || { x: 0, y: 0, z: 0 },        // gyroscope → gyr
                axl: data.accelerometer || { x: 0, y: 0, z: 0 },    // accelerometer → axl  
                mag: data.magnetometer || { x: 0, y: 0, z: 0 }      // magnetometer → mag
            };

            console.log('📊 Converted IMU data:', imuData);

            // Check if motion processing coordinator is ready
            if (!motionProcessingCoordinator.getInitializationStatus()) {
                console.error('❌ Motion processing coordinator not initialized');
                return;
            }

            // Feed data into motion processing coordinator
            console.log(`📊 Calling motionProcessingCoordinator.processNewData(${deviceName}, imuData)`);
            console.log(`📊 Motion processing coordinator initialized: ${motionProcessingCoordinator.getInitializationStatus()}`);
            console.log(`📊 Motion processing coordinator healthy: ${motionProcessingCoordinator.isHealthy()}`);
            
            motionProcessingCoordinator.processNewData(deviceName, imuData);
            
            console.log('✅ Motion data processed successfully by coordinator');
            
            // Test if coordinator has current joint angles after processing
            setTimeout(() => {
                try {
                    const currentAngles = motionProcessingCoordinator.getCurrentJointAngles();
                    console.log('📊 Current joint angles after processing:', currentAngles);
                    
                    if (currentAngles && currentAngles.size > 0) {
                        console.log('✅ Motion processing coordinator is working!');
                    } else {
                        console.warn('⚠️ Motion processing coordinator not producing joint angles');
                    }
                } catch (error) {
                    console.error('❌ Error getting current joint angles:', error);
                }
            }, 200);

            // Check if coordinator is now reporting as healthy (has recent data)
            setTimeout(() => {
                const isHealthy = motionProcessingCoordinator.isHealthy();
                console.log(`📊 Motion processing coordinator health after data processing: ${isHealthy}`);
            }, 100);

        } catch (error) {
            console.error('❌ Error processing motion data from renderer:', error);
            console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        }
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
                    console.log('🔵 Received device selection from renderer:', parsed.data?.deviceId);
                    if (this.deviceSelectionCallback && parsed.data?.deviceId) {
                        console.log('🔵 Calling device selection callback with selected device');
                        this.deviceSelectionInProgress = false;
                        this.deviceSelectionCallback(parsed.data.deviceId);
                        this.deviceSelectionCallback = null;
                    }
                    break;

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

        if (this.isRecording) {
            motionProcessingCoordinator.stopRecording().catch(console.error);
        }

        console.log('✅ ElectronMotionService cleanup complete');
    }
}