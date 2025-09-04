// electron/main/main.ts
import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { ElectronMotionService } from './services/ElectronMotionService';
import { isDev } from './utils/environment';

class ElectronApp {
    private mainWindow: BrowserWindow | null = null;
    private motionService: ElectronMotionService;

    constructor() {
        this.motionService = new ElectronMotionService();
        this.setupAppEvents();
        this.setupIpcHandlers();
    }

    private setupAppEvents() {
        app.whenReady().then(() => {
            this.createMainWindow();
            this.initializeServices();

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
                enableRemoteModule: false,
                preload: path.join(__dirname, '../preload/preload.js'),
                webSecurity: !isDev
            },
            show: false
        });

        // Setup device access for Bluetooth
        this.setupBluetoothHandlers();

        // Load the application
        if (isDev) {
            this.mainWindow.loadURL('http://localhost:3000');
            this.mainWindow.webContents.openDevTools();
        } else {
            this.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
        }

        this.mainWindow.once('ready-to-show', () => {
            this.mainWindow?.show();
        });

        this.mainWindow.on('closed', () => {
            this.mainWindow = null;
        });
    }

    private setupBluetoothHandlers() {
        if (!this.mainWindow) return;

        // Handle Bluetooth device selection
        this.mainWindow.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
            event.preventDefault();
            console.log('🔵 Bluetooth devices found:', deviceList.length);
            
            // Send device list to motion service for custom selection
            this.motionService.handleBluetoothDeviceSelection(deviceList, callback);
        });

        // Handle Bluetooth pairing if needed
        this.mainWindow.webContents.session.setBluetoothPairingHandler((details, callback) => {
            console.log('🔐 Bluetooth pairing request:', details);
            // Auto-accept pairing for known devices
            callback({ response: 'confirm', pin: '' });
        });
    }

    private setupIpcHandlers() {
        // Window controls
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

        // Motion processing commands
        ipcMain.handle('motion:getStatus', () => {
            return this.motionService.getStatus();
        });

        ipcMain.handle('motion:connectDevices', () => {
            return this.motionService.connectDevices();
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
    }

    private async initializeServices() {
        try {
            await this.motionService.initialize();
            console.log('✅ Motion processing service initialized');
        } catch (error) {
            console.error('❌ Failed to initialize motion service:', error);
        }
    }

    private cleanup() {
        console.log('🧹 Cleaning up application...');
        this.motionService?.cleanup();
    }
}

// Create and start the application
const electronApp = new ElectronApp();

// Handle unhandled errors
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
});