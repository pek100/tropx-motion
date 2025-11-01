import { app, BrowserWindow, ipcMain, protocol } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { MotionService } from './services/MotionService';
import { BluetoothService } from './services/BluetoothService';
import { isDev } from './utils/environment';
import { CONFIG, WINDOW_CONFIG, MESSAGE_TYPES, BLUETOOTH_CONFIG } from '../shared/config';
import { RecordingSession, ApiResponse } from '../shared/types';
import { SystemMonitor } from './services/SystemMonitor';
import { PlatformDetector } from '../../shared/PlatformDetector';
import { getWindowDimensions } from './window-size-override';

export class MainProcess {
  private mainWindow: BrowserWindow | null = null;
  private motionService: MotionService;
  private bluetoothService: BluetoothService;
  private systemMonitor: SystemMonitor; // monitor for memory/CPU

  constructor() {
    this.motionService = new MotionService();
    this.bluetoothService = new BluetoothService();
    this.systemMonitor = new SystemMonitor(() => this.mainWindow); // defer window resolution

    // Disable hardware acceleration to prevent GPU-related issues
    console.log('Disabling hardware acceleration for stability');
    app.disableHardwareAcceleration();

    this.enableWebBluetoothFeatures();
    this.setupAppEvents();
    this.setupIpcHandlers();
  }

  // Enable Web Bluetooth API features
  private enableWebBluetoothFeatures(): void {
    console.log('Enabling Web Bluetooth features...');

    if (process.env.TROPX_SAFE_MODE === '1') {
      console.log('TROPX_SAFE_MODE=1 -> Skipping all Chromium feature flags');
      return;
    }

    const flags = [
      'enable-experimental-web-platform-features',
      'enable-web-bluetooth',
      'enable-bluetooth-web-api',
      'enable-features=WebBluetooth,WebBluetoothScanning',
      'enable-blink-features=WebBluetooth,WebBluetoothScanning',
      'disable-features=OutOfBlinkCors',
      'enable-bluetooth-advertising',
      'enable-bluetooth-device-discovery',
      'disable-web-security',
      'autoplay-policy=no-user-gesture-required'
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
    app.whenReady().then(async () => {
      console.log('Electron app ready, initializing...');
      this.registerAppProtocol();
      this.createMainWindow();
      await this.initializeServices(); // CRITICAL: Await service initialization
      this.setupPermissionHandlers();
      console.log('Electron app fully initialized');

      // Auto-start performance monitor if enabled
      try {
        const shouldStart = process.env.TROPX_MONITOR === '1';
        const intervalEnv = Number(process.env.TROPX_MONITOR_INTERVAL || '');
        if (Number.isFinite(intervalEnv) && intervalEnv > 0) {
          this.systemMonitor.setIntervalMs(intervalEnv);
        }
        if (shouldStart) {
          this.systemMonitor.start();
          console.log('SystemMonitor auto-started');
        }
      } catch (e) {
        console.warn('Failed to start SystemMonitor:', e);
      }

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

  private registerAppProtocol(): void {
    const root = app.getAppPath();
    const rendererDir = path.join(root, 'dist', 'renderer');
    protocol.registerFileProtocol('app', (request, callback) => {
      try {
        const urlPath = new URL(request.url).pathname || '/index.html';
        const target = path.normalize(path.join(rendererDir, decodeURIComponent(urlPath.replace(/^\//, ''))));
        if (!target.startsWith(rendererDir)) return callback({ error: -3 }); // ABORT
        callback({ path: target });
      } catch (e) {
        console.error('app:// protocol error', e);
        callback({ error: -2 }); // FAILED
      }
    });
  }

  private resolveRendererIndex(): string | null {
    const candidates = [
      path.join(app.getAppPath(), 'dist', 'renderer', 'index.html'),
      path.join(process.resourcesPath, 'app.asar', 'dist', 'renderer', 'index.html'),
      path.join(process.resourcesPath, 'app', 'dist', 'renderer', 'index.html'),
      path.join(__dirname, '../renderer/index.html'),
      path.join(__dirname, '../../renderer/index.html'),
    ];
    const fs = require('fs');
    for (const p of candidates) {
      try { if (fs.existsSync(p)) return p; } catch {}
    }
    return null;
  }

  private copyRendererToUserData(): string | null {
    try {
      const fs = require('fs');
      const srcIndex = this.resolveRendererIndex();
      if (!srcIndex) return null;
      const srcDir = path.dirname(srcIndex);
      const destDir = path.join(app.getPath('userData'), 'renderer');
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      // Prefer cpSync if available; fallback to manual copy
      if (fs.cpSync) {
        fs.cpSync(srcDir, destDir, { recursive: true, force: true });
      } else {
        const fse = require('fs-extra');
        fse.copySync(srcDir, destDir, { overwrite: true });
      }
      const destIndex = path.join(destDir, 'index.html');
      return destIndex;
    } catch (e) {
      console.error('Failed to copy renderer to userData:', e);
      return null;
    }
  }

  // Create main application window
  private createMainWindow(): void {
    const preloadPath = app.isPackaged
      ? path.join(app.getAppPath(), 'dist', 'main', 'electron', 'preload', 'preload.js')
      : path.join(__dirname, '../preload/preload.js');

    const windowDims = getWindowDimensions();

    this.mainWindow = new BrowserWindow({
      width: windowDims.width,
      height: windowDims.height,
      minWidth: windowDims.minWidth,
      minHeight: windowDims.minHeight,
      frame: false, // Remove window frame on all platforms
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden', // macOS vs Windows/Linux
      trafficLightPosition: process.platform === 'darwin' ? { x: 15, y: 10 } : undefined, // macOS traffic lights position
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: preloadPath,
        webSecurity: false,
        experimentalFeatures: true,
        enableBlinkFeatures: 'WebBluetooth,WebBluetoothScanning',
        allowRunningInsecureContent: true,
      },
      show: false,
    });

    if (isDev && process.env.ELECTRON_START_URL) {
      this.mainWindow.loadURL(process.env.ELECTRON_START_URL);
    } else {
      // Load renderer from built files - try multiple approaches
      const rendererIndex = this.resolveRendererIndex();
      if (rendererIndex) {
        console.log('Loading renderer from:', rendererIndex);
        const fileUrl = pathToFileURL(rendererIndex).href;
        console.log('File URL:', fileUrl);
        this.mainWindow.loadURL(fileUrl).catch(async (err: any) => {
          console.error('File URL load failed:', err);
          // Try copying to userData as fallback
          const fallback = this.copyRendererToUserData();
          if (fallback) {
            try {
              console.log('Trying fallback at:', fallback);
              await this.mainWindow!.loadURL(pathToFileURL(fallback).href);
              console.log('Loaded renderer from fallback');
            } catch (e2) {
              console.error('Fallback renderer load failed:', e2);
              this.loadFallbackPage();
            }
          } else {
            this.loadFallbackPage();
          }
        });
      } else {
        console.error('No renderer index found');
        this.loadFallbackPage();
      }
    }

    if (process.env.TROPX_DEVTOOLS === '1') {
      this.mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    this.mainWindow.once('ready-to-show', () => this.mainWindow?.show());

    // Robust renderer diagnostics
    // PERFORMANCE FIX: Use async file writes with buffering to prevent event loop blocking
    const logBuffer: string[] = [];
    const LOG_FLUSH_INTERVAL = 1000; // Flush every 1 second
    const LOG_MAX_BUFFER = 100; // Or when buffer reaches 100 messages

    const logToFile = (msg: string) => {
      // Add to buffer instead of immediate sync write
      logBuffer.push(`[${new Date().toISOString()}] ${msg}\n`);

      // Flush if buffer is full
      if (logBuffer.length >= LOG_MAX_BUFFER) {
        flushLogBuffer();
      }
    };

    const flushLogBuffer = () => {
      if (logBuffer.length === 0) return;

      const fs = require('fs').promises;
      const logDir = app.getPath('userData');
      const messages = logBuffer.splice(0).join('');

      // Async write - doesn't block event loop
      fs.appendFile(path.join(logDir, 'renderer.log'), messages)
        .catch((err: any) => console.error('Log write error:', err));
    };

    // Periodic flush
    setInterval(flushLogBuffer, LOG_FLUSH_INTERVAL);

    this.mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      const lvl = ['LOG', 'WARN', 'ERROR'][level] || String(level);
      const msg = `CONSOLE ${lvl}: ${message} (${sourceId}:${line})`;
      console.log(msg);
      logToFile(msg);
    });
    this.mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
      const msg = `did-fail-load code=${errorCode} desc=${errorDescription} url=${validatedURL}`;
      console.error(msg);
      logToFile(msg);
    });
    this.mainWindow.webContents.on('render-process-gone', (_e, details) => {
      const msg = `render-process-gone: ${JSON.stringify(details)}`;
      console.error(msg);
      logToFile(msg);
    });

    this.mainWindow.webContents.once('did-finish-load', () => {
      console.log('Renderer finished load; initializing Bluetooth handlers');
      this.setupBluetoothHandlers();
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
  }

  private loadFallbackPage(): void {
    const fallbackHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Tropx Motion</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              padding: 40px; 
              background: #1a1a1a; 
              color: white; 
              text-align: center; 
            }
            .error { color: #ff6b6b; }
            .info { color: #51cf66; }
          </style>
        </head>
        <body>
          <h1 class="info">Tropx Motion</h1>
          <p class="error">Unable to load the main application interface.</p>
          <p>This usually indicates a packaging issue with the renderer files.</p>
          <p>Please check the console for detailed error messages.</p>
          <p><strong>Debug Info:</strong></p>
          <p>Process path: ${process.resourcesPath}</p>
          <p>__dirname: ${__dirname}</p>
        </body>
      </html>
    `;

    this.mainWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fallbackHtml)}`);
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
        // Use single source of truth for device patterns
        return BLUETOOTH_CONFIG.DEVICE_PATTERNS.some(pattern => name.includes(pattern.toLowerCase()));
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

    // System info handler (keep this for diagnostics)
    ipcMain.handle('bluetooth:getSystemInfo', () => ({
      platform: process.platform,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node
    }));

    // Platform detection handler
    ipcMain.handle('system:getPlatformInfo', () => {
      const info = PlatformDetector.detect();
      const config = PlatformDetector.getOptimizationConfig();
      return { info, config };
    });

    // Keep WebSocket port getter for backward compatibility
    ipcMain.handle('motion:getWebSocketPort', () => this.motionService.getWebSocketPort());

    // Performance monitor handlers
    ipcMain.handle('monitor:start', (_e, opts?: { intervalMs?: number }) => {
      try {
        if (opts?.intervalMs) this.systemMonitor.setIntervalMs(opts.intervalMs);
        this.systemMonitor.start();
        return { running: this.systemMonitor.isRunning() };
      } catch (err) {
        return { error: String(err) };
      }
    });
    ipcMain.handle('monitor:stop', () => {
      try {
        this.systemMonitor.stop();
        return { running: this.systemMonitor.isRunning() };
      } catch (err) {
        return { error: String(err) };
      }
    });
    ipcMain.handle('monitor:status', () => ({ running: this.systemMonitor.isRunning() }));
    ipcMain.handle('monitor:getSnapshot', async () => {
      try {
        return await this.systemMonitor.getSnapshot();
      } catch (err) {
        return { error: String(err) };
      }
    });
    ipcMain.handle('monitor:getRecentSamples', (_e, limit?: number) => {
      try {
        return this.systemMonitor.getRecentSamples(typeof limit === 'number' ? limit : 50);
      } catch (err) {
        return { error: String(err) };
      }
    });
    ipcMain.handle('monitor:setInterval', (_e, intervalMs: number) => {
      try {
        this.systemMonitor.setIntervalMs(intervalMs);
        return { ok: true };
      } catch (err) {
        return { error: String(err) };
      }
    });
  }

  // Initialize core services
  private async initializeServices(): Promise<void> {
    try {
      console.log('🚀 Starting MotionService initialization...');
      await this.motionService.initialize();
      console.log('✅ Motion service initialized successfully');

      // Verify WebSocket Bridge port
      const port = this.motionService.getWebSocketPort();
      console.log(`📡 WebSocket Bridge running on port: ${port}`);

      if (port === 0) {
        console.error('❌ CRITICAL: WebSocket Bridge port is 0 - BLE operations will fail');
      }
    } catch (error) {
      console.error('❌ Failed to initialize motion service:', error);
      console.error('❌ Stack trace:', error instanceof Error ? error.stack : error);
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
      // stop monitor
      this.systemMonitor.stop();
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
