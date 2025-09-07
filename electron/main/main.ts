import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { ElectronMotionService } from './services/ElectronMotionService';
import { isDev } from './utils/environment';
import { WSMessageType } from './types/websocket';

class ElectronApp {
    private mainWindow: BrowserWindow | null = null;
    private motionService: ElectronMotionService;

    constructor() {
        // Enable Web Bluetooth API and related features (Enhanced for 2025)
        console.log('🔧 Enabling Web Bluetooth flags for optimal device discovery...');
        app.commandLine.appendSwitch('enable-experimental-web-platform-features');
        app.commandLine.appendSwitch('enable-web-bluetooth');
        app.commandLine.appendSwitch('enable-bluetooth-web-api');
        app.commandLine.appendSwitch('enable-features', 'WebBluetooth,WebBluetoothScanning');
        app.commandLine.appendSwitch('enable-blink-features', 'WebBluetooth,WebBluetoothScanning');
        app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
        
        // Additional flags for better Bluetooth device discovery
        app.commandLine.appendSwitch('enable-bluetooth-advertising');
        app.commandLine.appendSwitch('enable-bluetooth-device-discovery');
        console.log('✅ Web Bluetooth flags enabled');
        
        this.motionService = new ElectronMotionService();
        this.setupAppEvents();
        this.setupIpcHandlers();
    }

    private setupAppEvents() {
        app.whenReady().then(() => {
            console.log('🚀 Electron app ready, creating main window...');
            this.createMainWindow();
            console.log('🔧 Initializing services...');
            this.initializeServices();
            console.log('🔐 Setting up permission handlers...');
            this.setupPermissionHandlers();
            console.log('✅ Electron app fully initialized');

            app.on('activate', () => {
                if (BrowserWindow.getAllWindows().length === 0) {
                    this.createMainWindow();
                }
            });
        });

        app.on('window-all-closed', () => {
            if (process.platform !== 'darwin') {
                this.cleanup();
                app.quit();
            }
        });

        app.on('before-quit', () => {
            this.cleanup();
        });
    }

    private createMainWindow() {
        this.mainWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            minWidth: 800,
            minHeight: 600,
            titleBarStyle: 'hiddenInset',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, '../preload/preload.js'),
                webSecurity: !isDev,
                experimentalFeatures: true,
                enableBlinkFeatures: 'WebBluetooth,WebBluetoothScanning',
                // Enhanced permissions for Bluetooth device access
                allowRunningInsecureContent: isDev
            },
            show: false
        });

        console.log(`🔍 Environment check - isDev: ${isDev}, NODE_ENV: ${process.env.NODE_ENV}`);
        
        if (isDev) {
            console.log('🌐 Loading development URL: http://localhost:3000');
            this.mainWindow.loadURL('http://localhost:3000');
            this.mainWindow.webContents.openDevTools();
        } else {
            console.log('📁 Loading production file');
            this.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
        }

        this.mainWindow.once('ready-to-show', () => {
            this.mainWindow?.show();
        });

        // Setup Bluetooth handlers after webContents is ready
        this.mainWindow.webContents.once('did-finish-load', () => {
            console.log('🌐 WebContents finished loading, setting up Bluetooth handlers...');
            
            // Add Bluetooth diagnostics
            this.runBluetoothDiagnostics();
            
            this.setupBluetoothHandlers();
        });

        this.mainWindow.on('closed', () => {
            this.mainWindow = null;
        });
    }

    private setupBluetoothHandlers() {
        if (!this.mainWindow) {
            console.error('❌ Cannot setup Bluetooth handlers - mainWindow is null');
            return;
        }

        console.log('🔧 Setting up simplified Bluetooth handlers using grosdode pattern...');

        // Optimized grosdode pattern (data-driven refinement)
        let lastDeviceDiscovery = 0;
        this.mainWindow.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
            const timestamp = Date.now();
            
            // Reduce log spam - only log significant discoveries
            const shouldLogDetailed = deviceList.length > 0 || (timestamp - lastDeviceDiscovery) > 5000;
            
            if (shouldLogDetailed) {
                console.log('\n🔵 ===== DEVICE DISCOVERY (GROSDODE PATTERN) =====');
                console.log('🔵 Found devices:', deviceList.length);
                console.log('🔵 Status: ' + (deviceList.length > 0 ? '✅ SUCCESS' : '❌ EMPTY'));
                if (deviceList.length > 0) {
                    console.log('🔵 Devices:', deviceList.map(d => `${d.deviceName} (${d.deviceId})`).join(', '));
                }
                lastDeviceDiscovery = timestamp;
            }
            

            event.preventDefault(); // Required: Prevent default Electron device picker

            // Enhanced filtering for SDK devices with more permissive matching
            const validDevices = deviceList.filter(device => {
                const name = (device.deviceName || (device as any).name || '').toLowerCase();
                const isValidDevice = name.includes('tropx') || 
                                    name.includes('muse') || 
                                    name.includes('arduino') || // Sometimes devices show generic names
                                    name.includes('ble') ||
                                    device.deviceId?.toLowerCase().includes('tropx') ||
                                    device.deviceId?.toLowerCase().includes('muse');
                
                    return isValidDevice;
            });

            if (shouldLogDetailed && deviceList.length > 0) {
                console.log(`🔵 Valid SDK devices: ${validDevices.length}/${deviceList.length}`);
            }

            // Windows Bluetooth Fix: Even if no devices found, allow manual connection
            if (validDevices.length === 0) {
                if (shouldLogDetailed) {
                    console.log('🔵 No valid devices found - manual entry available');
                    console.log('🔵 =============================================\n');
                }
                
                // Send empty list but keep callback for manual device entry
                this.bluetoothDeviceCallback = callback;
                
                this.motionService.broadcastMessage({
                    type: WSMessageType.DEVICE_SCAN_RESULT,
                    data: {
                        devices: [],
                        success: false,
                        message: 'No devices found - try manual connection or ensure devices are in pairing mode',
                        scanComplete: true,
                        showManualEntry: true // Flag to show manual device entry option
                    },
                    timestamp: Date.now()
                });
                
                // Don't return callback yet - let user try manual entry
                return;
            }

            // Store callback for user selection
            this.bluetoothDeviceCallback = callback;

            // Send valid devices to renderer for selection
            this.motionService.broadcastMessage({
                type: WSMessageType.DEVICE_SCAN_RESULT,
                data: {
                    devices: validDevices.map(device => ({
                        id: device.deviceId,
                        name: device.deviceName || (device as any).name || 'Unknown Device',
                        connected: false,
                        batteryLevel: null
                    })),
                    success: true,
                    message: `Found ${validDevices.length} SDK device(s)`,
                    scanComplete: true
                },
                timestamp: Date.now()
            });

            if (shouldLogDetailed) {
                console.log('🔵 Device selection UI triggered');
                console.log('🔵 =============================================\n');
            }
        });

        // Setup Bluetooth pairing handler for Windows/Linux
        this.mainWindow.webContents.session.setBluetoothPairingHandler((details, callback) => {
            console.log('🔵 Bluetooth pairing requested:', details);

            // Store pairing callback
            this.bluetoothPairingCallback = callback;

            // Send pairing request to renderer
            this.motionService.broadcastMessage({
                type: WSMessageType.BLUETOOTH_PAIRING_REQUEST,
                data: {
                    deviceId: details.deviceId, // Fix: use deviceId instead of device
                    pairingKind: details.pairingKind,
                    pin: details.pin
                },
                timestamp: Date.now()
            });
        });

        // Setup permission handlers - note: Electron doesn't support 'bluetooth' permission type
        this.mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
            console.log('🔵 Permission check:', permission, 'from', requestingOrigin);

            // Allow all permissions for our app since Bluetooth isn't in the standard permission types
            return true;
        });

        // Setup device permission handler - note: Electron doesn't support 'bluetooth' device type
        this.mainWindow.webContents.session.setDevicePermissionHandler((details) => {
            console.log('🔵 Device permission request:', details);

            // Allow all device types since we're using Web Bluetooth API
            return true;
        });

        console.log('✅ Bluetooth handlers setup complete');
    }

    private bluetoothDeviceCallback: ((deviceId: string) => void) | null = null;
    private bluetoothPairingCallback: ((response: any) => void) | null = null;

    private async runBluetoothDiagnostics() {
        console.log('🔧 ===== BLUETOOTH DIAGNOSTICS =====');
        console.log('🔧 Platform:', process.platform);
        console.log('🔧 Electron version:', process.versions.electron);
        console.log('🔧 Chrome version:', process.versions.chrome);
        
        // Check if we can access Bluetooth at the system level
        try {
            if (this.mainWindow) {
                // Test basic Web Bluetooth availability in renderer
                const result = await this.mainWindow.webContents.executeJavaScript(`
                    (async () => {
                        return {
                            bluetoothAvailable: !!navigator.bluetooth,
                            secureContext: window.isSecureContext,
                            userAgent: navigator.userAgent,
                            permissions: await (async () => {
                                try {
                                    const result = await navigator.permissions.query({ name: 'bluetooth' });
                                    return result.state;
                                } catch (e) {
                                    return 'not-supported';
                                }
                            })()
                        };
                    })()
                `);
                
                console.log('🔧 Renderer Bluetooth status:', result);
                
                if (!result.bluetoothAvailable) {
                    console.error('❌ Web Bluetooth API not available in renderer!');
                    console.log('💡 This may be due to missing feature flags or platform limitations');
                }
                
                if (!result.secureContext) {
                    console.warn('⚠️ Not in secure context - may affect Bluetooth functionality');
                }
                
                if (result.permissions === 'denied') {
                    console.error('❌ Bluetooth permissions denied');
                } else if (result.permissions === 'not-supported') {
                    console.warn('⚠️ Bluetooth permissions API not supported');
                } else {
                    console.log('✅ Bluetooth permissions:', result.permissions);
                }

                // Additional Windows-specific checks
                if (process.platform === 'win32') {
                    console.log('🔧 Running Windows-specific Bluetooth checks...');
                    
                    // Check if Windows Bluetooth is actually enabled
                    const winBtCheck = await this.mainWindow.webContents.executeJavaScript(`
                        (async () => {
                            try {
                                // Try to get Bluetooth availability at system level
                                const adapter = await navigator.bluetooth.getAvailability();
                                return { adapter };
                            } catch (e) {
                                return { error: e.message };
                            }
                        })()
                    `);
                    
                    console.log('🔧 Windows Bluetooth availability check:', winBtCheck);
                    
                    if (winBtCheck.error) {
                        console.warn('⚠️ Windows Bluetooth system issue detected');
                        console.log('💡 Recommendations:');
                        console.log('💡 1. Check Windows Bluetooth is turned on in Settings');
                        console.log('💡 2. Update Bluetooth drivers via Device Manager');
                        console.log('💡 3. Run Windows Bluetooth troubleshooter');
                        console.log('💡 4. Restart Bluetooth service: services.msc → Bluetooth Support Service');
                    }
                }
            }
        } catch (error) {
            console.error('❌ Bluetooth diagnostics failed:', error);
        }
        
        console.log('🔧 ===== DIAGNOSTICS COMPLETE =====');
    }

    private setupIpcHandlers() {
        ipcMain.handle('window:minimize', () => {
            this.mainWindow?.minimize();
        });

        ipcMain.handle('window:maximize', () => {
            if (this.mainWindow?.isMaximized()) {
                this.mainWindow.unmaximize();
            } else {
                this.mainWindow?.maximize();
            }
        });

        ipcMain.handle('window:close', () => {
            this.mainWindow?.close();
        });

        ipcMain.handle('motion:getStatus', () => {
            return this.motionService.getStatus();
        });

        ipcMain.handle('motion:connectDevices', () => {
            return this.motionService.connectDevices();
        });

        ipcMain.handle('motion:scanDevices', () => {
            return this.motionService.scanForDevices();
        });

        ipcMain.handle('motion:startRecording', (_, sessionData) => {
            return this.motionService.startRecording(sessionData);
        });

        ipcMain.handle('motion:stopRecording', () => {
            return this.motionService.stopRecording();
        });

        ipcMain.handle('motion:getWebSocketPort', () => {
            return this.motionService.getWebSocketPort();
        });

        // Add handler for connecting to specific devices
        ipcMain.handle('motion:connectToDevice', (_, deviceName: string) => {
            return this.motionService.connectToSpecificDevice(deviceName);
        });

        // Add Bluetooth system diagnostics
        ipcMain.handle('bluetooth:getSystemInfo', async () => {
            return {
                platform: process.platform,
                electronVersion: process.versions.electron,
                chromeVersion: process.versions.chrome,
                nodeVersion: process.versions.node,
                appCommandLine: process.argv
            };
        });

        // Enhanced device selection handler with manual entry support
        ipcMain.handle('bluetooth:selectDevice', (_, deviceId: string) => {
            console.log('🔵 User selected device via grosdode pattern:', deviceId);
            if (this.bluetoothDeviceCallback) {
                this.bluetoothDeviceCallback(deviceId);
                this.bluetoothDeviceCallback = null;
                return { success: true, message: 'Device selected successfully' };
            } else {
                console.error('❌ No pending device selection callback');
                return { success: false, message: 'No pending device selection' };
            }
        });

        // Add manual device connection handler for Windows Bluetooth issues
        ipcMain.handle('bluetooth:connectManual', (_, deviceName: string) => {
            console.log('🔵 Manual device connection requested:', deviceName);
            
            // Create a mock device selection to trigger SDK connection
            if (this.bluetoothDeviceCallback) {
                // Use device name as ID for manual connections
                this.bluetoothDeviceCallback(deviceName);
                this.bluetoothDeviceCallback = null;
                return { success: true, message: `Manual connection initiated for ${deviceName}` };
            }
            
            return { success: false, message: 'No pending device selection for manual connection' };
        });

        // Enhanced scan with multiple attempts for Windows
        ipcMain.handle('bluetooth:scanEnhanced', async () => {
            console.log('🔵 Enhanced scan requested for Windows Bluetooth');
            
            try {
                // Multiple scan attempts to work around Windows Bluetooth limitations
                const scanAttempts = 3;
                let allDevices = [];
                
                for (let attempt = 1; attempt <= scanAttempts; attempt++) {
                    console.log(`🔵 Scan attempt ${attempt}/${scanAttempts}`);
                    
                    // Trigger a scan by having renderer call Web Bluetooth
                    this.mainWindow?.webContents.send('bluetooth-trigger-scan', { attempt });
                    
                    // Wait between attempts
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                
                return { success: true, message: 'Enhanced scan completed' };
            } catch (error) {
                console.error('❌ Enhanced scan failed:', error);
                return { success: false, message: `Enhanced scan failed: ${error instanceof Error ? error.message : String(error)}` };
            }
        });

        // Add Bluetooth pairing response handler
        ipcMain.handle('bluetooth:pairingResponse', (_, response: any) => {
            console.log('🔵 User pairing response:', response);
            if (this.bluetoothPairingCallback) {
                this.bluetoothPairingCallback(response);
                this.bluetoothPairingCallback = null;
                return { success: true, message: 'Pairing response sent' };
            } else {
                console.error('❌ No pending pairing callback');
                return { success: false, message: 'No pending pairing request' };
            }
        });

        // Add handler to cancel Bluetooth selection
        ipcMain.handle('bluetooth:cancelSelection', () => {
            console.log('🔵 User cancelled device selection');
            if (this.bluetoothDeviceCallback) {
                this.bluetoothDeviceCallback(''); // Empty string cancels selection
                this.bluetoothDeviceCallback = null;
                return { success: true, message: 'Selection cancelled' };
            }
            return { success: false, message: 'No pending selection to cancel' };
        });
    }

    private async initializeServices() {
        try {
            await this.motionService.initialize();
            console.log('✅ Motion processing service initialized');
        } catch (error) {
            console.error('❌ Failed to initialize motion service:', error);
        }
    }

    private setupPermissionHandlers() {
        if (this.mainWindow) {
            this.mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
                console.log(`🔐 Permission request: ${permission}`);
                // Allow all permissions for development
                callback(true);
            });

            this.mainWindow.webContents.session.setDevicePermissionHandler((details) => {
                console.log(`📱 Device permission request:`, details);
                // Allow all device types for development
                return true;
            });
        }
    }

    private cleanup() {
        console.log('🧹 Cleaning up resources...');
        try {
            this.motionService?.cleanup?.();
        } catch (error) {
            console.error('❌ Error during cleanup:', error);
        }
    }
}

// Create and start the Electron app
new ElectronApp();

// Global error handlers with better Bluetooth error handling
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled promise rejection:', error);
    
    // Don't crash on Bluetooth-related errors
    if (error && typeof error === 'object' && 'name' in error) {
        const errorName = (error as any).name;
        if (['NotFoundError', 'AbortError', 'SecurityError', 'NotAllowedError'].includes(errorName)) {
            console.log('ℹ️ Bluetooth-related error handled gracefully:', errorName);
            return; // Don't crash the app
        }
    }
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error);
    
    // Don't crash on Bluetooth-related errors
    if (error && error.name && ['NotFoundError', 'AbortError', 'SecurityError', 'NotAllowedError'].includes(error.name)) {
        console.log('ℹ️ Bluetooth-related exception handled gracefully:', error.name);
        return; // Don't crash the app
    }
    
    console.error('💥 Fatal error - shutting down');
    process.exit(1);
});
