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
import { TimeSyncEstimator } from './TimeSyncEstimator';
import { deviceRegistry } from '../registry-management/DeviceRegistry';

export class TropXDevice {
  private wrapper: NoblePeripheralWrapper;
  private motionCallback: MotionDataCallback | null = null;
  private eventCallback: DeviceEventCallback | null = null;
  private streamingTimer: NodeJS.Timeout | null = null;
  private batteryTimer: NodeJS.Timeout | null = null;
  private hasLoggedFirstPacket: boolean = false;

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
      // NOTE: Don't fire 'connected' event yet - wait until battery is read
      // so UI gets complete device info including battery

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

      // Discover command characteristic for battery reading
      await this.ensureCharacteristics();

      // Get initial battery level synchronously BEFORE firing connected event
      // This ensures battery is available when device status is broadcast
      console.log(`🔋 [${this.wrapper.deviceInfo.name}] Reading initial battery level...`);
      try {
        await this.getBatteryLevel();
      } catch (error) {
        console.warn(`⚠️ Failed to read initial battery, will retry later:`, error);
        // Don't block connection on battery read failure
      }

      // Start periodic battery monitoring
      this.startBatteryMonitoring();

      // Now fire 'connected' event with complete device info (including battery)
      this.notifyEvent('connected');

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

  // Ensure characteristics are discovered (used for both battery and streaming)
  private async ensureCharacteristics(): Promise<boolean> {
    if (this.wrapper.commandCharacteristic && this.wrapper.dataCharacteristic) {
      return true; // Already discovered
    }

    if (!this.wrapper.service) {
      console.error('Device not properly connected - no service available');
      return false;
    }

    console.log(`🔍 [${this.wrapper.deviceInfo.name}] Discovering characteristics...`);
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
          console.log(`   Properties: ${JSON.stringify(char.properties)}`);
        } else if (char.uuid === BLE_CONFIG.DATA_CHARACTERISTIC_UUID.replace(/-/g, '')) {
          this.wrapper.dataCharacteristic = char;
          console.log(`✅ [${this.wrapper.deviceInfo.name}] Found data characteristic: ${char.uuid}`);
          console.log(`   Properties: ${JSON.stringify(char.properties)}`);
        }
      }

      if (!this.wrapper.commandCharacteristic || !this.wrapper.dataCharacteristic) {
        console.error(`❌ [${this.wrapper.deviceInfo.name}] Required TropX characteristics not found`);
        console.log(`Available characteristics: ${characteristics.map((c: any) => c.uuid).join(', ')}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`❌ [${this.wrapper.deviceInfo.name}] Failed to discover characteristics:`, error);
      return false;
    }
  }

  // Start quaternion data streaming (with lazy characteristic discovery like Python)
  async startStreaming(): Promise<boolean> {
    // Ensure characteristics are discovered (uses cached if already done)
    const hasCharacteristics = await this.ensureCharacteristics();
    if (!hasCharacteristics) {
      return false;
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
      // Use smart write - checks if writeWithoutResponse is supported for faster writes
      await this.writeCommand(Buffer.from(streamCommand));
      console.log(`🎬 [${this.wrapper.deviceInfo.name}] Streaming command sent (${Date.now() - streamCommandStartTime}ms)`);

      this.wrapper.isStreaming = true;
      this.wrapper.deviceInfo.state = 'streaming';
      this.notifyEvent('streaming_started');

      // Stop battery monitoring during streaming to eliminate BLE traffic interference
      this.stopBatteryMonitoring();

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
      // Use smart write - checks if writeWithoutResponse is supported for faster writes
      await this.writeCommand(Buffer.from(stopCommand));

      // Unsubscribe from notifications
      if (this.wrapper.dataCharacteristic) {
        await this.wrapper.dataCharacteristic.unsubscribeAsync();
        this.wrapper.dataCharacteristic.removeAllListeners('data');
      }

      this.wrapper.isStreaming = false;
      this.wrapper.deviceInfo.state = 'connected';
      this.notifyEvent('streaming_stopped');

      // Resume battery monitoring after streaming stops
      this.resumeBatteryMonitoring();

    } catch (error) {
      console.error(`Error stopping streaming: ${this.wrapper.deviceInfo.name}:`, error);
    }
  }

  // Initialize device RTC (Real-Time Clock) with current system time
  // MUST be called before syncTime() for proper hardware synchronization
  //
  // NOTE: TropX devices appear to always return "ms since boot" timestamps,
  // not Unix epoch timestamps like Muse devices. The RTC set command configures
  // internal timekeeping but doesn't change the timestamp format.
  async initializeDeviceRTC(): Promise<boolean> {
    if (!this.wrapper.commandCharacteristic) {
      throw new Error('Command characteristic not available for RTC initialization');
    }

    console.log(`🕐 [${this.wrapper.deviceInfo.name}] Initializing device RTC...`);

    try {
      // Step 1: Check device is in IDLE state (per PDF requirement)
      console.log(`🕐 [${this.wrapper.deviceInfo.name}] Checking device status...`);
      const stateCmd = Buffer.from(TropXCommands.Cmd_GetSystemState());
      await this.wrapper.commandCharacteristic.writeAsync(stateCmd, false);
      await this.delay(50);

      const stateResponse = await this.wrapper.commandCharacteristic.readAsync();
      // Response format: [TYPE=0x00, LENGTH=0x03, CMD=0x82, ERROR_CODE, SYSTEM_STATE]
      if (stateResponse && stateResponse.length >= 5) {
        const systemState = stateResponse[4];
        console.log(`🕐 [${this.wrapper.deviceInfo.name}] System state: 0x${systemState.toString(16).padStart(2, '0')}`);

        // IDLE state is 0x02 per PDF
        if (systemState !== TROPX_STATES.IDLE) {
          console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] Device not in IDLE state (expected 0x02, got 0x${systemState.toString(16)})`);
          // Continue anyway - device might still accept time set
        }
      }

      // Step 2: Set device RTC FIRST (per Muse PDF - this should reset timestamps to Unix epoch)
      const currentUnixSeconds = Math.floor(Date.now() / 1000);
      const setTimeCmd = Buffer.from(TropXCommands.Cmd_SetDateTime(currentUnixSeconds));

      console.log(`🕐 [${this.wrapper.deviceInfo.name}] Setting RTC to ${new Date(currentUnixSeconds * 1000).toISOString()}...`);
      await this.wrapper.commandCharacteristic.writeAsync(setTimeCmd, false);
      await this.delay(200); // Longer delay for RTC to stabilize and reset counters

      const setTimeResponse = await this.wrapper.commandCharacteristic.readAsync();
      if (setTimeResponse && setTimeResponse.length >= 4) {
        const errorCode = setTimeResponse[3];
        if (errorCode !== 0x00) {
          console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] RTC set returned error 0x${errorCode.toString(16)}`);
        }
      }

      // Step 3: Check if device timestamps are now in Unix epoch (Muse behavior)
      // or still in ms-since-boot (TropX behavior)
      console.log(`🕐 [${this.wrapper.deviceInfo.name}] Checking timestamp format after RTC set...`);

      const getTimestampCmd = Buffer.from([TROPX_COMMANDS.GET_TIMESTAMP, 0x00]);

      // Multi-sample boot offset for better accuracy (matches time sync approach)
      const BOOT_SAMPLES = 5;
      const bootSamples: Array<{ masterTime: number; deviceTime: number; rtt: number }> = [];

      for (let i = 0; i < BOOT_SAMPLES; i++) {
        const t1 = Date.now();
        await this.wrapper.commandCharacteristic.writeAsync(getTimestampCmd, false);
        const response = await this.wrapper.commandCharacteristic.readAsync();
        const t3 = Date.now();

        if (response && response.length >= 12) {
          const deviceTimestamp = Number(response.readBigUInt64LE(4));
          const masterMidpoint = (t1 + t3) / 2;
          const rtt = t3 - t1;

          bootSamples.push({
            masterTime: masterMidpoint,
            deviceTime: deviceTimestamp,
            rtt
          });

          if (i === 0) {
            console.log(`🔍 [${this.wrapper.deviceInfo.name}] Timestamp format check:`);
            console.log(`   Master time: ${masterMidpoint} (${new Date(masterMidpoint).toISOString()})`);
            console.log(`   Device timestamp: ${deviceTimestamp} (${new Date(deviceTimestamp).toISOString()})`);
            console.log(`   Response bytes: [${[...response].map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
          }
        }

        if (i < BOOT_SAMPLES - 1) await this.delay(5);
      }

      let deviceBootOffset = 0;

      if (bootSamples.length > 0) {
        const firstSample = bootSamples[0];
        const timeDiff = Math.abs(firstSample.deviceTime - firstSample.masterTime);

        if (timeDiff < 60000) {
          // Muse-style: Device returns Unix epoch after RTC set
          console.log(`✅ [${this.wrapper.deviceInfo.name}] Device using Unix epoch timestamps (Muse-style)`);
          console.log(`   Time difference: ${timeDiff.toFixed(2)}ms - within expected range`);
          deviceBootOffset = 0; // No offset needed
        } else {
          // TropX-style: Device still returns ms-since-boot
          console.log(`⚠️ [${this.wrapper.deviceInfo.name}] Device still using ms-since-boot (TropX-style)`);
          console.log(`   Device uptime: ${(firstSample.deviceTime / 1000 / 60 / 60).toFixed(2)} hours`);

          // Use best sample (lowest RTT) for boot offset
          bootSamples.sort((a, b) => a.rtt - b.rtt);
          const bestSample = bootSamples[0];

          deviceBootOffset = bestSample.masterTime - bestSample.deviceTime;
          console.log(`   Multi-sample boot offset: ${deviceBootOffset.toFixed(2)}ms (from ${BOOT_SAMPLES} samples)`);
          console.log(`   Best RTT: ${bestSample.rtt.toFixed(2)}ms`);
          console.log(`   Device boot time: ${new Date(deviceBootOffset).toISOString()}`);
        }
      }

      console.log(`✅ [${this.wrapper.deviceInfo.name}] Device RTC initialized successfully`);
      console.log(`✅ [${this.wrapper.deviceInfo.name}] Boot offset for time sync: ${deviceBootOffset.toFixed(2)}ms`);

      // Store boot offset for use in syncTime()
      (this.wrapper as any).deviceBootOffset = deviceBootOffset;

      return true;

    } catch (error) {
      console.error(`❌ [${this.wrapper.deviceInfo.name}] RTC initialization failed:`, error);
      return false;
    }
  }

  // Perform time synchronization (Muse v3 TimeSync Protocol)
  // NOTE: Must call initializeDeviceRTC() first!
  //
  // TropX devices return "ms since boot" timestamps, not Unix epoch.
  // We use the boot offset calculated during RTC init to convert them.
  async syncTime(): Promise<number> {
    if (!this.wrapper.commandCharacteristic) {
      throw new Error('Command characteristic not available for time sync');
    }

    console.log(`⏱️ [${this.wrapper.deviceInfo.name}] Starting time synchronization (fine-tuning)...`);

    // Get boot offset from RTC initialization
    const deviceBootOffset = (this.wrapper as any).deviceBootOffset || 0;
    if (deviceBootOffset === 0) {
      console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] No boot offset found - was initializeDeviceRTC() called?`);
    } else {
      console.log(`⏱️ [${this.wrapper.deviceInfo.name}] Using boot offset: ${deviceBootOffset.toFixed(2)}ms`);
    }

    try {
      // Step 1: Enter time sync mode
      console.log(`⏱️ [${this.wrapper.deviceInfo.name}] Entering time sync mode...`);
      const enterCmd = Buffer.from([TROPX_COMMANDS.ENTER_TIMESYNC, 0x00]);
      await this.wrapper.commandCharacteristic.writeAsync(enterCmd, false);
      await this.delay(50); // Wait for mode transition

      // Step 2: Collect timestamp samples for offset calculation
      // Device returns "ms since boot" - we convert to Unix epoch using boot offset
      const estimator = new TimeSyncEstimator();
      const SAMPLE_COUNT = 50; // Per PDF recommendation

      console.log(`⏱️ [${this.wrapper.deviceInfo.name}] Collecting ${SAMPLE_COUNT} timestamp samples...`);

      for (let i = 0; i < SAMPLE_COUNT; i++) {
        // Record master time before send
        const t1 = Date.now();

        // Send get timestamp command
        const getTimestampCmd = Buffer.from([TROPX_COMMANDS.GET_TIMESTAMP, 0x00]);
        await this.wrapper.commandCharacteristic.writeAsync(getTimestampCmd, false);

        // Wait for response with device's timestamp
        // Response format: [TYPE=0x00, LENGTH=0x02, CMD=0xb2, ERROR_CODE, TIMESTAMP (8 bytes)]
        const response = await this.wrapper.commandCharacteristic.readAsync();

        // Record master time after receive
        const t3 = Date.now();

        // Parse device timestamp (bytes 4-11, little-endian 64-bit unsigned)
        if (response && response.length >= 12) {
          // Device returns "ms since boot" - convert to Unix epoch
          const deviceTimeSinceBoot = Number(response.readBigUInt64LE(4));
          const deviceTimestamp = deviceTimeSinceBoot + deviceBootOffset;

          // DEBUG: Log first few samples to diagnose timestamp format issue
          if (i < 3) {
            console.log(`🔍 [${this.wrapper.deviceInfo.name}] Sample ${i + 1}:`);
            console.log(`   Master time (t1): ${t1} (${new Date(t1).toISOString()})`);
            console.log(`   Device time (raw): ${deviceTimeSinceBoot}ms since boot`);
            console.log(`   Device time (adjusted): ${deviceTimestamp} (${new Date(deviceTimestamp).toISOString()})`);
            console.log(`   Master time (t3): ${t3} (${new Date(t3).toISOString()})`);
            console.log(`   Response bytes: [${[...response.subarray(0, 12)].map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
          }

          // Add sample for offset calculation
          // offset = device_time - master_time_at_midpoint
          estimator.addSample(t1, deviceTimestamp, t3);

          // Small delay between samples to avoid overwhelming device
          if (i < SAMPLE_COUNT - 1) {
            await this.delay(10);
          }
        } else {
          console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] Invalid timestamp response at sample ${i + 1}`);
        }
      }

      // Step 3: Compute clock offset using median filtering
      const clockOffset = estimator.computeOffset();
      console.log(`⏱️ [${this.wrapper.deviceInfo.name}] Computed fine-tuned clock offset: ${clockOffset.toFixed(2)}ms`);

      // Sanity check: After boot offset correction, offset should be small (< 1000ms)
      if (Math.abs(clockOffset) > 1000) {
        console.error(`❌ [${this.wrapper.deviceInfo.name}] Clock offset too large (${clockOffset.toFixed(2)}ms)!`);
        console.error(`❌ This indicates boot offset calculation failed.`);
        throw new Error(`Clock offset out of range: ${clockOffset.toFixed(2)}ms (expected < 1000ms)`);
      }

      // Step 4: Exit time sync mode
      console.log(`⏱️ [${this.wrapper.deviceInfo.name}] Exiting time sync mode...`);
      const exitCmd = Buffer.from([TROPX_COMMANDS.EXIT_TIMESYNC, 0x00]);
      await this.wrapper.commandCharacteristic.writeAsync(exitCmd, false);
      await this.delay(50);

      // Step 5: Set hardware clock offset on device (per Muse PDF)
      // For TropX devices that return "ms since boot", we need to:
      // 1. Send boot offset so device converts its timestamps to Unix epoch
      // 2. Apply the fine-tuned clock offset for final precision
      const totalOffset = deviceBootOffset + clockOffset;

      console.log(`⏱️ [${this.wrapper.deviceInfo.name}] Calculating total hardware offset:`);
      console.log(`   Boot offset: ${deviceBootOffset.toFixed(2)}ms`);
      console.log(`   Clock offset: ${clockOffset.toFixed(2)}ms`);
      console.log(`   Total offset: ${totalOffset.toFixed(2)}ms`);

      const MAX_VALID_OFFSET = 2n ** 63n - 1n; // Max signed 64-bit integer
      const MIN_VALID_OFFSET = -(2n ** 63n);
      const offsetBigInt = BigInt(Math.round(totalOffset));

      if (offsetBigInt >= MIN_VALID_OFFSET && offsetBigInt <= MAX_VALID_OFFSET) {
        console.log(`⏱️ [${this.wrapper.deviceInfo.name}] Writing hardware offset to device...`);
        const setOffsetCmd = Buffer.allocUnsafe(10);
        setOffsetCmd[0] = TROPX_COMMANDS.SET_CLOCK_OFFSET; // TYPE (0x31)
        setOffsetCmd[1] = 0x08; // LENGTH (8 bytes for 64-bit offset)
        setOffsetCmd.writeBigInt64LE(offsetBigInt, 2); // VALUE (offset in ms)

        console.log(`⏱️ [${this.wrapper.deviceInfo.name}] SET_CLOCK_OFFSET command: [${[...setOffsetCmd].map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
        await this.wrapper.commandCharacteristic.writeAsync(setOffsetCmd, false);
        await this.delay(50);

        // Read response to confirm
        const response = await this.wrapper.commandCharacteristic.readAsync();
        if (response && response.length >= 4) {
          const errorCode = response[3];
          if (errorCode === 0x00) {
            console.log(`✅ [${this.wrapper.deviceInfo.name}] Hardware offset successfully written to device`);
            console.log(`✅ Device will now add ${totalOffset.toFixed(2)}ms to all timestamps`);
          } else {
            console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] SET_CLOCK_OFFSET returned error 0x${errorCode.toString(16)}`);
          }
        }
      } else {
        console.error(`❌ [${this.wrapper.deviceInfo.name}] Total offset out of range for int64: ${totalOffset.toFixed(2)}ms`);
        throw new Error(`Hardware offset out of range: ${totalOffset.toFixed(2)}ms`);
      }

      console.log(`✅ [${this.wrapper.deviceInfo.name}] Hardware time synchronization complete!`);
      console.log(`✅ Device timestamps will be automatically synchronized to Unix epoch`);

      return clockOffset;

    } catch (error) {
      console.error(`❌ [${this.wrapper.deviceInfo.name}] Time sync failed:`, error);
      throw error;
    }
  }

  // Get battery level
  async getBatteryLevel(): Promise<number | null> {
    if (!this.wrapper.commandCharacteristic) return null;

    try {
      const batteryCommand = TropXCommands.Cmd_GetBatteryCharge();
      // Battery command needs response (false) because we read the value back
      await this.wrapper.commandCharacteristic.writeAsync(Buffer.from(batteryCommand), false);

      // Wait for device to process command (TropX devices need ~100ms to prepare response)
      await this.delay(100);

      // Read response - battery level is at byte index 4 (not 0!)
      const response = await this.wrapper.commandCharacteristic.readAsync();
      if (response && response.length > 4) {
        const batteryLevel = response[4]; // Battery at byte 4, not 0!
        this.wrapper.deviceInfo.batteryLevel = batteryLevel;
        console.log(`🔋 [${this.wrapper.deviceInfo.name}] Battery level: ${batteryLevel}%`);

        // Notify battery update event so UI can update
        this.notifyEvent('battery_update', { batteryLevel });

        return batteryLevel;
      } else {
        console.warn(`🔋 [${this.wrapper.deviceInfo.name}] Battery response too short: ${response?.length} bytes`);
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

    // TEMP: Use false (write with response) until we verify characteristic supports writeWithoutResponse
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
    // PERFORMANCE: Capture reception time immediately (fallback if no device timestamp)
    const receptionTimestamp = Date.now();

    try {
      // Validate packet size
      if (data.length !== PACKET_SIZES.TOTAL) {
        console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] Invalid packet size: ${data.length}, expected: ${PACKET_SIZES.TOTAL}`);
        return;
      }

      // Parse 8-byte header to extract device timestamp
      const header = data.subarray(0, PACKET_SIZES.HEADER);

      // Try to parse device timestamp from header (64-bit LE at start of header)
      let deviceTimestamp = 0;
      try {
        // Assuming header structure: [TIMESTAMP (8 bytes)]
        deviceTimestamp = Number(header.readBigUInt64LE(0));

        // DEBUG: Log first packet to understand header structure
        if (!this.hasLoggedFirstPacket) {
          console.log(`📦 [${this.wrapper.deviceInfo.name}] First packet header analysis:`);
          console.log(`   Header bytes: [${[...header].map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
          console.log(`   Parsed timestamp (LE): ${deviceTimestamp}ms`);
          console.log(`   Reception timestamp: ${receptionTimestamp}ms`);
          console.log(`   Difference: ${(receptionTimestamp - deviceTimestamp).toFixed(2)}ms`);
          this.hasLoggedFirstPacket = true;
        }
      } catch (parseError) {
        console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] Could not parse device timestamp from header, using reception time`);
        deviceTimestamp = receptionTimestamp;
      }

      // Parse quaternion data (skip 8-byte header)
      const quaternionData = data.subarray(PACKET_SIZES.HEADER);
      const quaternion = this.parseQuaternionData(quaternionData);

      // HARDWARE TIME SYNC: Use device-embedded timestamp
      // - Device adds hardware offset (SET_CLOCK_OFFSET) to its internal counter
      // - Result: timestamps synchronized across devices with <1ms jitter
      // - BLE latency variance eliminated (timestamp generated at source)
      const motionData: MotionData = {
        timestamp: deviceTimestamp, // Device timestamp with hardware offset applied
        quaternion
      };

      // Forward to callback
      if (this.motionCallback) {
        // DISABLED for performance (100Hz × 2 devices = 200 logs/sec causes stuttering)
        // console.log(`📊 [${this.wrapper.deviceInfo.name}] Parsed motion data: q(${motionData.quaternion.w.toFixed(3)}, ${motionData.quaternion.x.toFixed(3)}, ${motionData.quaternion.y.toFixed(3)}, ${motionData.quaternion.z.toFixed(3)}) at ${motionData.timestamp}`);
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

  // Start battery monitoring (periodic updates only, initial read done during connect)
  private startBatteryMonitoring(): void {
    console.log(`🔋 [${this.wrapper.deviceInfo.name}] Starting periodic battery monitoring...`);

    // Set up periodic monitoring ONLY if not streaming
    // During 100Hz streaming (4 devices = 400 packets/sec), battery checks add unnecessary BLE traffic
    if (!this.wrapper.isStreaming) {
      this.batteryTimer = setInterval(async () => {
        await this.getBatteryLevel();
      }, TIMING.BATTERY_UPDATE_INTERVAL);
      console.log(`🔋 [${this.wrapper.deviceInfo.name}] Periodic battery monitoring active (${TIMING.BATTERY_UPDATE_INTERVAL/1000}s interval)`);
    } else {
      console.log(`🔋 [${this.wrapper.deviceInfo.name}] Battery monitoring paused during streaming`);
    }
  }

  // Stop battery monitoring (when streaming starts)
  private stopBatteryMonitoring(): void {
    if (this.batteryTimer) {
      clearInterval(this.batteryTimer);
      this.batteryTimer = null;
      console.log(`🔋 [${this.wrapper.deviceInfo.name}] Battery monitoring stopped`);
    }
  }

  // Resume battery monitoring (when streaming stops)
  private resumeBatteryMonitoring(): void {
    this.stopBatteryMonitoring();
    this.startBatteryMonitoring();
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

  // Smart command write - uses writeWithoutResponse if supported, otherwise write with response
  private async writeCommand(buffer: Buffer): Promise<void> {
    if (!this.wrapper.commandCharacteristic) {
      throw new Error('Command characteristic not available');
    }

    // Check if characteristic supports writeWithoutResponse for faster writes
    const props = this.wrapper.commandCharacteristic.properties;
    const supportsWriteWithoutResponse = props && (props.includes('writeWithoutResponse') || props.writeWithoutResponse === true);

    if (supportsWriteWithoutResponse) {
      // Fast write - no ACK needed
      await this.wrapper.commandCharacteristic.writeAsync(buffer, true);
    } else {
      // Fallback to write with response (slower but more reliable)
      await this.wrapper.commandCharacteristic.writeAsync(buffer, false);
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