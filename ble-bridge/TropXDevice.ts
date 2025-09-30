/**
 * TropX Device Protocol Handler - Noble-based implementation
 */

import {
  MotionData,
  Quaternion,
  TropXDeviceInfo,
  MotionDataCallback,
  DeviceEventCallback,
  NoblePeripheralWrapper
} from './BleBridgeTypes';

import {
  BLE_CONFIG,
  TROPX_COMMANDS,
  TROPX_STATES,
  DATA_MODES,
  DATA_FREQUENCIES,
  PACKET_SIZES,
  QUATERNION_SCALE,
  TIMING
} from './BleBridgeConstants';
import { TropXCommands } from './TropXCommands';

export class TropXDevice {
  private wrapper: NoblePeripheralWrapper;
  private motionCallback: MotionDataCallback | null = null;
  private eventCallback: DeviceEventCallback | null = null;
  private streamingTimer: NodeJS.Timeout | null = null;
  private batteryTimer: NodeJS.Timeout | null = null;

  constructor(
    peripheral: any,
    deviceInfo: TropXDeviceInfo,
    motionCallback?: MotionDataCallback,
    eventCallback?: DeviceEventCallback
  ) {
    this.wrapper = {
      peripheral,
      deviceInfo,
      service: null,
      commandCharacteristic: null,
      dataCharacteristic: null,
      isStreaming: false
    };
    this.motionCallback = motionCallback || null;
    this.eventCallback = eventCallback || null;
  }

  // Connect to device (simplified like Python Bleak)
  async connect(): Promise<boolean> {
    try {
      console.log(`🔗 Connecting to TropX device: ${this.wrapper.deviceInfo.name}`);

      // Simple connection like Python Bleak - no complex setup
      if (this.wrapper.peripheral.state === 'connected') {
        console.log('✅ Device already connected');
      } else {
        console.log('🔗 Establishing BLE connection...');
        await this.wrapper.peripheral.connectAsync();
        console.log('✅ Physical BLE connection established');
      }

      this.wrapper.deviceInfo.state = 'connected';
      this.notifyEvent('connected');

      // Simple delay like Python approach
      console.log('⏳ Brief delay for device stability...');
      await this.delay(1000);

      // Simplified service discovery (like Python Bleak approach)
      console.log('🔍 Discovering services...');
      let allServices: any[] = [];

      try {
        // Simple discovery - just get all services
        const result = await this.wrapper.peripheral.discoverServicesAsync([]);
        allServices = result.services || [];
        console.log(`✅ Found ${allServices.length} services`);

        // If no services found, try one more time with callback method (matches Python's simplicity)
        if (allServices.length === 0) {
          console.log('🔍 Retrying with callback method...');
          const callbackResult = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
            this.wrapper.peripheral.discoverServices([], (error: any, services: any[]) => {
              clearTimeout(timeout);
              if (error) reject(error);
              else resolve(services || []);
            });
          });

          if (Array.isArray(callbackResult)) {
            allServices = callbackResult;
            console.log(`✅ Callback method found ${allServices.length} services`);
          }
        }
      } catch (error) {
        console.log(`❌ Service discovery failed:`, error);
      }

      console.log(`📋 Services discovered: ${allServices.length}`);
      allServices.forEach((service: any, index: number) => {
        console.log(`  ${index + 1}. ${service.uuid} (${service.name || 'unnamed'})`);
      });

      // If no services found, this is probably a pairing issue (like Python would handle)
      if (allServices.length === 0) {
        console.log(`❌ No services found - device may need manual pairing`);
        console.log(`💡 Try pairing "${this.wrapper.deviceInfo.name}" in system Bluetooth settings first`);
        throw new Error('No services found - device may need manual pairing');
      }

      // Python-like approach: Don't discover characteristics immediately
      // Just store the connection state and discover characteristics when needed
      console.log(`✅ Connected to device with ${allServices.length} services available`);
      console.log(`📋 Available services: ${allServices.map(s => s.uuid).join(', ')}`);

      // Check if TropX service exists
      const tropxService = allServices.find((service: any) =>
        service.uuid === BLE_CONFIG.SERVICE_UUID.replace(/-/g, '') ||
        service.uuid === BLE_CONFIG.SERVICE_UUID
      );

      if (tropxService) {
        console.log(`✅ Found TropX service: ${tropxService.uuid}`);
        // Store service reference for later use
        this.wrapper.service = tropxService;
      } else {
        console.log(`⚠️ TropX service not found in available services`);
        console.log(`   Will attempt characteristic discovery during streaming setup`);
        // Store first service as fallback
        this.wrapper.service = allServices[0];
      }

      // Setup disconnect handler
      this.wrapper.peripheral.once('disconnect', () => {
        this.handleDisconnect();
      });

      // Start battery monitoring
      this.startBatteryMonitoring();

      console.log(`✅ Connected to TropX device: ${this.wrapper.deviceInfo.name}`);
      return true;

    } catch (error) {
      console.error(`❌ Failed to connect to device ${this.wrapper.deviceInfo.name}:`, error);
      this.wrapper.deviceInfo.state = 'error';
      this.notifyEvent('error', error);
      return false;
    }
  }

  // Disconnect from device
  async disconnect(): Promise<void> {
    try {
      console.log(`🔌 Disconnecting from device: ${this.wrapper.deviceInfo.name}`);

      if (this.wrapper.isStreaming) {
        await this.stopStreaming();
      }

      this.cleanup();

      if (this.wrapper.peripheral.state === 'connected') {
        await this.wrapper.peripheral.disconnectAsync();
      }

    } catch (error) {
      console.error(`Error disconnecting from device ${this.wrapper.deviceInfo.name}:`, error);
    }
  }

  // Start quaternion data streaming (with lazy characteristic discovery like Python)
  async startStreaming(): Promise<boolean> {
    if (!this.wrapper.service) {
      console.error('Device not properly connected - no service available');
      return false;
    }

    // Optimized characteristic discovery with caching
    if (!this.wrapper.commandCharacteristic || !this.wrapper.dataCharacteristic) {
      console.log(`🔍 [${this.wrapper.deviceInfo.name}] Discovering characteristics for streaming...`);
      try {
        // Fix EventEmitter memory leak warning
        if (this.wrapper.service.setMaxListeners) {
          this.wrapper.service.setMaxListeners(20);
        }

        const discoveryStartTime = Date.now();
        const characteristics = await this.wrapper.service.discoverCharacteristicsAsync([
          BLE_CONFIG.COMMAND_CHARACTERISTIC_UUID,
          BLE_CONFIG.DATA_CHARACTERISTIC_UUID
        ]);
        console.log(`🔍 [${this.wrapper.deviceInfo.name}] Characteristic discovery took ${Date.now() - discoveryStartTime}ms`);

        // Map characteristics
        for (const char of characteristics) {
          if (char.uuid === BLE_CONFIG.COMMAND_CHARACTERISTIC_UUID.replace(/-/g, '')) {
            this.wrapper.commandCharacteristic = char;
            console.log(`✅ [${this.wrapper.deviceInfo.name}] Found command characteristic: ${char.uuid}`);
          } else if (char.uuid === BLE_CONFIG.DATA_CHARACTERISTIC_UUID.replace(/-/g, '')) {
            this.wrapper.dataCharacteristic = char;
            console.log(`✅ [${this.wrapper.deviceInfo.name}] Found data characteristic: ${char.uuid}`);
          }
        }

        if (!this.wrapper.commandCharacteristic || !this.wrapper.dataCharacteristic) {
          console.error(`❌ [${this.wrapper.deviceInfo.name}] Required TropX characteristics not found`);
          console.log(`Available characteristics: ${characteristics.map((c: any) => c.uuid).join(', ')}`);
          return false;
        }
      } catch (error) {
        console.error(`❌ [${this.wrapper.deviceInfo.name}] Failed to discover characteristics:`, error);
        return false;
      }
    } else {
      console.log(`✅ [${this.wrapper.deviceInfo.name}] Using cached characteristics (faster streaming start)`);
    }

    try {
      const streamingStartTime = Date.now();
      console.log(`🎬 [${this.wrapper.deviceInfo.name}] Starting quaternion streaming using proper command format...`);

      // Subscribe to data notifications first
      const subscriptionStartTime = Date.now();
      await this.wrapper.dataCharacteristic.subscribeAsync();

      // Set up data handler with logging
      this.wrapper.dataCharacteristic.on('data', (data: Buffer) => {
        this.handleDataNotification(data);
      });

      // Also listen for errors
      this.wrapper.dataCharacteristic.on('error', (error: any) => {
        console.error(`❌ [${this.wrapper.deviceInfo.name}] Data characteristic error:`, error);
      });

      console.log(`🎬 [${this.wrapper.deviceInfo.name}] Data subscription completed, listening for notifications (${Date.now() - subscriptionStartTime}ms)`);

      // Start streaming with proper command format (like muse_sdk)
      const streamCommandStartTime = Date.now();
      const streamCommand = TropXCommands.Cmd_StartStream(DATA_MODES.QUATERNION, DATA_FREQUENCIES.HZ_100);
      await this.wrapper.commandCharacteristic.writeAsync(Buffer.from(streamCommand), false);
      console.log(`🎬 [${this.wrapper.deviceInfo.name}] Proper streaming command sent (${Date.now() - streamCommandStartTime}ms)`);

      this.wrapper.isStreaming = true;
      this.wrapper.deviceInfo.state = 'streaming';
      this.notifyEvent('streaming_started');

      const totalTime = Date.now() - streamingStartTime;
      console.log(`✅ [${this.wrapper.deviceInfo.name}] Streaming started successfully (total: ${totalTime}ms)`);
      return true;

    } catch (error) {
      console.error(`❌ Failed to start streaming: ${this.wrapper.deviceInfo.name}:`, error);
      this.notifyEvent('error', error);
      return false;
    }
  }

  // Stop data streaming
  async stopStreaming(): Promise<void> {
    if (!this.wrapper.isStreaming) return;

    try {
      console.log(`🛑 Stopping streaming: ${this.wrapper.deviceInfo.name}`);

      // Stop streaming with proper command format
      const stopCommand = TropXCommands.Cmd_StopStream();
      await this.wrapper.commandCharacteristic.writeAsync(Buffer.from(stopCommand), false);

      // Unsubscribe from notifications
      if (this.wrapper.dataCharacteristic) {
        await this.wrapper.dataCharacteristic.unsubscribeAsync();
        this.wrapper.dataCharacteristic.removeAllListeners('data');
      }

      this.wrapper.isStreaming = false;
      this.wrapper.deviceInfo.state = 'connected';
      this.notifyEvent('streaming_stopped');

    } catch (error) {
      console.error(`Error stopping streaming: ${this.wrapper.deviceInfo.name}:`, error);
    }
  }

  // Get battery level
  async getBatteryLevel(): Promise<number | null> {
    if (!this.wrapper.commandCharacteristic) return null;

    try {
      const batteryCommand = TropXCommands.Cmd_GetBatteryCharge();
      await this.wrapper.commandCharacteristic.writeAsync(Buffer.from(batteryCommand), false);

      // Read response - TropX devices typically respond immediately
      const response = await this.wrapper.commandCharacteristic.readAsync();
      if (response && response.length > 0) {
        const batteryLevel = response[0];
        this.wrapper.deviceInfo.batteryLevel = batteryLevel;
        console.log(`🔋 [${this.wrapper.deviceInfo.name}] Battery level: ${batteryLevel}%`);
        return batteryLevel;
      }
    } catch (error) {
      console.error(`Error reading battery level: ${this.wrapper.deviceInfo.name}:`, error);
    }

    return null;
  }

  // Send command to device
  private async sendCommand(command: number, value?: number): Promise<void> {
    if (!this.wrapper.commandCharacteristic) {
      throw new Error('Command characteristic not available');
    }

    const buffer = Buffer.alloc(value !== undefined ? 2 : 1);
    buffer[0] = command;
    if (value !== undefined) {
      buffer[1] = value;
    }

    await this.wrapper.commandCharacteristic.writeAsync(buffer, false);
  }

  // Send command and wait for response
  private async sendCommandWithResponse(command: number): Promise<Buffer | null> {
    if (!this.wrapper.commandCharacteristic) return null;

    const buffer = Buffer.from([command]);
    const response = await this.wrapper.commandCharacteristic.readAsync();
    return response;
  }

  // Handle incoming data notifications
  private handleDataNotification(data: Buffer): void {
    console.log(`📥 [${this.wrapper.deviceInfo.name}] Received ${data.length} bytes: [${Array.from(data.subarray(0, Math.min(16, data.length))).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}${data.length > 16 ? '...' : ''}]`);

    try {
      // Validate packet size
      if (data.length !== PACKET_SIZES.TOTAL) {
        console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] Invalid packet size: ${data.length}, expected: ${PACKET_SIZES.TOTAL}`);
        return;
      }

      // Parse quaternion data (skip 8-byte header)
      const quaternionData = data.subarray(PACKET_SIZES.HEADER);
      const quaternion = this.parseQuaternionData(quaternionData);

      const motionData: MotionData = {
        timestamp: Date.now(),
        quaternion
      };

      // Forward to callback
      if (this.motionCallback) {
        console.log(`📊 [${this.wrapper.deviceInfo.name}] Parsed motion data: q(${motionData.quaternion.w.toFixed(3)}, ${motionData.quaternion.x.toFixed(3)}, ${motionData.quaternion.y.toFixed(3)}, ${motionData.quaternion.z.toFixed(3)}) at ${motionData.timestamp}`);
        this.motionCallback(this.wrapper.deviceInfo.id, motionData);
      } else {
        console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] No motion callback set - data will be lost!`);
      }

    } catch (error) {
      console.error(`Error parsing motion data from ${this.wrapper.deviceInfo.name}:`, error);
    }
  }

  // Parse quaternion from binary data
  private parseQuaternionData(data: Buffer): Quaternion {
    // Read 3 x int16 values (x, y, z components)
    const x = data.readInt16LE(0) * QUATERNION_SCALE;
    const y = data.readInt16LE(2) * QUATERNION_SCALE;
    const z = data.readInt16LE(4) * QUATERNION_SCALE;

    // Compute w component using quaternion unit norm constraint
    const sumSquares = x * x + y * y + z * z;
    const w = Math.sqrt(Math.max(0, 1 - sumSquares));

    return { w, x, y, z };
  }

  // Handle device disconnect
  private handleDisconnect(): void {
    console.log(`🔌 Device disconnected: ${this.wrapper.deviceInfo.name}`);
    this.cleanup();
    this.wrapper.deviceInfo.state = 'disconnected';
    this.notifyEvent('disconnected');
  }

  // Start battery monitoring
  private startBatteryMonitoring(): void {
    // Get initial battery level immediately
    console.log(`🔋 [${this.wrapper.deviceInfo.name}] Starting battery monitoring...`);
    this.getBatteryLevel().then(level => {
      if (level !== null) {
        console.log(`🔋 [${this.wrapper.deviceInfo.name}] Initial battery level: ${level}%`);
      }
    }).catch(error => {
      console.error(`❌ [${this.wrapper.deviceInfo.name}] Failed to get initial battery level:`, error);
    });

    // Set up periodic monitoring
    this.batteryTimer = setInterval(async () => {
      await this.getBatteryLevel();
    }, TIMING.BATTERY_UPDATE_INTERVAL);
  }

  // Cleanup resources
  private cleanup(): void {
    if (this.streamingTimer) {
      clearTimeout(this.streamingTimer);
      this.streamingTimer = null;
    }

    if (this.batteryTimer) {
      clearInterval(this.batteryTimer);
      this.batteryTimer = null;
    }

    this.wrapper.isStreaming = false;
    this.wrapper.commandCharacteristic = null;
    this.wrapper.dataCharacteristic = null;
  }

  // Notify event callback
  private notifyEvent(event: string, data?: any): void {
    if (this.eventCallback) {
      this.eventCallback(this.wrapper.deviceInfo.id, event, data);
    }
  }

  // Utility delay function
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Getters
  get deviceInfo(): TropXDeviceInfo {
    return this.wrapper.deviceInfo;
  }

  get isConnected(): boolean {
    return this.wrapper.peripheral.state === 'connected';
  }

  get isStreaming(): boolean {
    return this.wrapper.isStreaming;
  }
}