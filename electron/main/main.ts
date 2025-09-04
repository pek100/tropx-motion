import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { ElectronMotionService } from './services/ElectronMotionService';
import { isDev } from './utils/environment';

class ElectronApp {
    private mainWindow: BrowserWindow | null = null;
    private motionService: ElectronMotionService;

    constructor() {
        // Enable Web Bluetooth API and related features
        app.commandLine.appendSwitch('enable-experimental-web-platform-features');
        app.commandLine.appendSwitch('enable-web-bluetooth');
        app.commandLine.appendSwitch('enable-bluetooth-web-api');
        app.commandLine.appendSwitch('enable-features', 'WebBluetooth');
        app.commandLine.appendSwitch('enable-blink-features', 'WebBluetooth');
        app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
        
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
                enableBlinkFeatures: 'WebBluetooth'
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

        console.log('🔧 Setting up Bluetooth handlers...');

        let bluetoothCallback: ((deviceId: string) => void) | null = null;
        let foundDevices: any[] = [];
        let scanTimeout: NodeJS.Timeout | null = null;
        let lastDeviceFoundTime: number = 0;
        const SCAN_DURATION_MS = 10000; // 10 seconds total scan time
        const DEVICE_DISCOVERY_GRACE_PERIOD = 3000; // 3 seconds after last device found

        this.mainWindow.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
            console.log('🔵 select-bluetooth-device event fired at:', new Date().toISOString());
            console.log('🔵 Device count in this event:', deviceList.length);
            console.log('🔵 Total devices found so far:', foundDevices.length);

            event.preventDefault(); // CRITICAL: Prevent default Electron device picker
            
            // Store the callback for later use
            if (!bluetoothCallback) {
                bluetoothCallback = callback;
                console.log('🔵 Starting extended Bluetooth device discovery...');
                console.log(`🔵 Will scan for ${SCAN_DURATION_MS}ms with ${DEVICE_DISCOVERY_GRACE_PERIOD}ms grace period`);
            }

            // Process new devices from this scan event
            if (deviceList.length > 0) {
                console.log('🔵 ✅ NEW DEVICES FOUND IN THIS SCAN EVENT!');
                lastDeviceFoundTime = Date.now();

                // Add new devices to our accumulated list (avoid duplicates)
                deviceList.forEach((device, index) => {
                    console.log(`🔵 Processing device ${index}:`, {
                        name: device.deviceName,
                        id: device.deviceId,
                    });

                    // Check if we already have this device
                    const existingDevice = foundDevices.find(d => d.deviceId === device.deviceId);
                    if (!existingDevice) {
                        foundDevices.push(device);
                        console.log(`🔵 ✅ Added new device: "${device.deviceName}" (${device.deviceId})`);
                    } else {
                        console.log(`🔵 ⚠️ Device already found: "${device.deviceName}" (${device.deviceId})`);
                    }
                });
                
                console.log(`🔵 📊 Discovery progress: ${foundDevices.length} unique devices found`);
                foundDevices.forEach((device, idx) => {
                    console.log(`🔵   ${idx + 1}. "${device.deviceName}" (${device.deviceId})`);
                });

                // Reset the completion timer since we found new devices
                if (scanTimeout) {
                    clearTimeout(scanTimeout);
                }

                // Set completion timer for grace period after last device found
                scanTimeout = setTimeout(() => {
                    completeBluetoothDeviceDiscovery();
                }, DEVICE_DISCOVERY_GRACE_PERIOD);

            } else {
                console.log('🔵 Empty scan event - no new devices in this cycle');

                // If this is the first empty event and we haven't started a timer yet
                if (foundDevices.length === 0 && !scanTimeout) {
                    console.log('🔵 Starting initial scan timeout...');
                    scanTimeout = setTimeout(() => {
                        completeBluetoothDeviceDiscovery();
                    }, SCAN_DURATION_MS);
                }
            }
        });

        // Helper function to complete the device discovery process
        const completeBluetoothDeviceDiscovery = () => {
            console.log('🔵 🏁 Completing Bluetooth device discovery...');
            console.log(`🔵 📊 Final results: Found ${foundDevices.length} total devices`);

            if (foundDevices.length > 0) {
                foundDevices.forEach((device, idx) => {
                    console.log(`🔵 Final device ${idx + 1}: "${device.deviceName}" (${device.deviceId})`);
                });

                // UPDATED: Store devices and callback, then send to renderer
                this.motionService.setDiscoveredDevices(foundDevices, bluetoothCallback!);
                this.motionService.sendDiscoveredDevicesToRenderer(foundDevices);
            } else {
                console.log('🔵 No devices found during extended scan period');
                // Send empty list to renderer
                this.motionService.sendDiscoveredDevicesToRenderer([]);
                
                // Complete callback with no selection
                if (bluetoothCallback) {
                    bluetoothCallback(''); // Empty selection
                }
            }

            // Clean up scan state but keep devices and callback for connection requests
            if (scanTimeout) {
                clearTimeout(scanTimeout);
                scanTimeout = null;
            }
            
            // Clear scan-specific state but keep devices for connection
            bluetoothCallback = null; // This will be managed by motionService now
            foundDevices = [];
            lastDeviceFoundTime = 0;
        };

        // Store the helper function so it can be called from the timeout
        (this as any).completeBluetoothDeviceDiscovery = completeBluetoothDeviceDiscovery;
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
