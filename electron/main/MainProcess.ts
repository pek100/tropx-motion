import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { MotionService } from './services/MotionService';
import { BluetoothService } from './services/BluetoothService';
import { isDev } from './utils/environment';
import { CONFIG, WINDOW_CONFIG, MESSAGE_TYPES } from '../shared/config';
import { RecordingSession, ApiResponse } from '../shared/types';

export class MainProcess {
  private mainWindow: BrowserWindow | null = null;
  private motionService: MotionService;
  private bluetoothService: BluetoothService;

  constructor() {
    this.motionService = new MotionService();
    this.bluetoothService = new BluetoothService();
    
    this.enableWebBluetoothFeatures();
    this.setupAppEvents();
    this.setupIpcHandlers();
  }

  // Enable Web Bluetooth API features
  private enableWebBluetoothFeatures(): void {
    console.log('Enabling Web Bluetooth features...');
    
    const flags = [
      'enable-experimental-web-platform-features',
      'enable-web-bluetooth',
      'enable-bluetooth-web-api',
      'enable-features=WebBluetooth,WebBluetoothScanning',
      'enable-blink-features=WebBluetooth,WebBluetoothScanning',
      'disable-features=OutOfBlinkCors',
      'enable-bluetooth-advertising',
      'enable-bluetooth-device-discovery'
    ];

    flags.forEach(flag => {
      const parts = flag.split('=');
      if (parts.length === 2) {
        app.commandLine.appendSwitch(parts[0], parts[1]);
      } else {
        app.commandLine.appendSwitch(flag);
      }
    });
    console.log('Web Bluetooth features enabled');
  }

  // Setup application lifecycle events
  private setupAppEvents(): void {
    app.whenReady().then(() => {
      console.log('Electron app ready, initializing...');
      this.createMainWindow();
      this.initializeServices();
      this.setupPermissionHandlers();
      console.log('Electron app fully initialized');

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

  // Create main application window
  private createMainWindow(): void {
    this.mainWindow = new BrowserWindow({
      width: WINDOW_CONFIG.DEFAULT_WIDTH,
      height: WINDOW_CONFIG.DEFAULT_HEIGHT,
      minWidth: WINDOW_CONFIG.MIN_WIDTH,
      minHeight: WINDOW_CONFIG.MIN_HEIGHT,
      titleBarStyle: 'hiddenInset',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload/preload.js'),
        webSecurity: !isDev,
        experimentalFeatures: true,
        enableBlinkFeatures: 'WebBluetooth,WebBluetoothScanning',
        allowRunningInsecureContent: isDev
      },
      show: false
    });

    const url = isDev ? 'http://localhost:3000' : path.join(__dirname, '../renderer/index.html');
    
    if (isDev) {
      console.log('Loading development URL:', url);
      this.mainWindow.loadURL(url);
      this.mainWindow.webContents.openDevTools();
    } else {
      console.log('Loading production file');
      this.mainWindow.loadFile(url);
    }

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show();
    });

    this.mainWindow.webContents.once('did-finish-load', () => {
      console.log('WebContents finished loading, setting up Bluetooth handlers...');
      this.setupBluetoothHandlers();
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
  }

  // Setup Bluetooth device selection handlers
  private setupBluetoothHandlers(): void {
    if (!this.mainWindow?.webContents) {
      console.error('Cannot setup Bluetooth handlers - webContents is null');
      return;
    }

    console.log('Setting up Web Bluetooth handlers...');
    this.bluetoothService.initialize(this.mainWindow.webContents);

    // Handle device discovery results
    this.mainWindow.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
      event.preventDefault();
      console.log('Device discovery event:', deviceList.length, 'devices found');

      const validDevices = deviceList.filter(device => {
        const name = (device.deviceName || '').toLowerCase();
        return name.includes('tropx') || name.includes('muse');
      });

      if (validDevices.length === 0) {
        this.motionService.broadcastMessage(MESSAGE_TYPES.DEVICE_SCAN_RESULT, {
          devices: [],
          success: false,
          message: 'No valid devices found - ensure devices are in pairing mode',
          scanComplete: true
        });
        return;
      }

      this.motionService.broadcastMessage(MESSAGE_TYPES.DEVICE_SCAN_RESULT, {
        devices: validDevices.map(device => ({
          id: device.deviceId,
          name: device.deviceName || 'Unknown Device',
          connected: false,
          batteryLevel: null
        })),
        success: true,
        message: `Found ${validDevices.length} device(s)`,
        scanComplete: true
      });
    });

    console.log('Bluetooth handlers setup complete');
  }

  // Setup IPC handlers for renderer communication
  private setupIpcHandlers(): void {
    // Window controls
    ipcMain.handle('window:minimize', () => this.mainWindow?.minimize());
    ipcMain.handle('window:maximize', () => {
      if (this.mainWindow?.isMaximized()) {
        this.mainWindow.unmaximize();
      } else {
        this.mainWindow?.maximize();
      }
    });
    ipcMain.handle('window:close', () => this.mainWindow?.close());

    // Motion service handlers
    ipcMain.handle('motion:getStatus', () => this.motionService.getStatus());
    ipcMain.handle('motion:connectDevices', () => this.motionService.connectDevices());
    ipcMain.handle('motion:scanDevices', () => this.motionService.scanForDevices());
    ipcMain.handle('motion:connectToDevice', (_, deviceName: string) => 
      this.motionService.connectToDevice(deviceName)
    );
    ipcMain.handle('motion:startRecording', (_, sessionData: RecordingSession) => 
      this.motionService.startRecording(sessionData)
    );
    ipcMain.handle('motion:stopRecording', () => this.motionService.stopRecording());
    ipcMain.handle('motion:getWebSocketPort', () => this.motionService.getWebSocketPort());

    // Bluetooth handlers
    ipcMain.handle('bluetooth:selectDevice', (_, deviceId: string) => 
      this.bluetoothService.selectDevice(deviceId)
    );
    ipcMain.handle('bluetooth:connectManual', (_, deviceName: string) => 
      this.bluetoothService.connectManualDevice(deviceName)
    );
    ipcMain.handle('bluetooth:cancelSelection', () => 
      this.bluetoothService.cancelOperation()
    );
    ipcMain.handle('bluetooth:pairingResponse', (_, response: unknown) => 
      this.bluetoothService.respondToPairing(response)
    );
    ipcMain.handle('bluetooth:getSystemInfo', () => ({
      platform: process.platform,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node
    }));
  }

  // Initialize core services
  private async initializeServices(): Promise<void> {
    try {
      await this.motionService.initialize();
      console.log('Motion service initialized');
    } catch (error) {
      console.error('Failed to initialize motion service:', error);
    }
  }

  // Setup permission handlers for secure contexts
  private setupPermissionHandlers(): void {
    if (!this.mainWindow?.webContents) return;

    this.mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
      console.log(`Permission request: ${permission}`);
      callback(true); // Allow all permissions for development
    });

    this.mainWindow.webContents.session.setDevicePermissionHandler((details) => {
      console.log('Device permission request:', details);
      return true; // Allow all device types
    });
  }

  // Cleanup resources on app shutdown
  private cleanup(): void {
    console.log('Cleaning up resources...');
    try {
      this.motionService.cleanup();
      this.bluetoothService.cleanup();
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
}

// Global error handlers
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
  
  // Handle Bluetooth-related errors gracefully
  if (error && typeof error === 'object' && 'name' in error) {
    const bluetoothErrors = ['NotFoundError', 'AbortError', 'SecurityError', 'NotAllowedError'];
    if (bluetoothErrors.includes((error as any).name)) {
      console.log('Bluetooth-related error handled gracefully:', (error as any).name);
      return;
    }
  }
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  
  const bluetoothErrors = ['NotFoundError', 'AbortError', 'SecurityError', 'NotAllowedError'];
  if (error?.name && bluetoothErrors.includes(error.name)) {
    console.log('Bluetooth-related exception handled gracefully:', error.name);
    return;
  }
  
  console.error('Fatal error - shutting down');
  process.exit(1);
});