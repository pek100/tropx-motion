/**
 * TropX Device Protocol Handler - Noble-based implementation
 */

import {
  MotionData,
  Quaternion,
  TropXDeviceInfo,
  MotionDataCallback,
  DeviceEventCallback,
  NoblePeripheralWrapper,
  DeviceSyncState
} from './BleBridgeTypes';

import {
  BLE_CONFIG,
  TROPX_COMMANDS,
  TROPX_STATES,
  DATA_MODES,
  DATA_FREQUENCIES,
  PACKET_SIZES,
  QUATERNION_SCALE,
  TIMING,
  REFERENCE_EPOCH_MS
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

  // Static tracking for first packet timestamps across all devices
  private static firstPacketTimestamps = new Map<string, number>();
  private static firstDeviceName: string | null = null;

  // Reset first packet tracking (call when starting new recording session)
  static resetFirstPacketTracking(): void {
    TropXDevice.firstPacketTimestamps.clear();
    TropXDevice.firstDeviceName = null;
  }

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

  // Public getter for wrapper (for DeviceLocateService)
  getWrapper(): NoblePeripheralWrapper {
    return this.wrapper;
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

  /**
   * Reset device to IDLE state
   * @returns true if successful, false otherwise
   */
  async resetToIdle(): Promise<boolean> {
    const hasCharacteristics = await this.ensureCharacteristics();
    if (!hasCharacteristics) {
      console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] Cannot reset to IDLE: characteristics not available`);
      return false;
    }

    try {
      console.log(`🔄 [${this.wrapper.deviceInfo.name}] Resetting device to IDLE state...`);

      // Send IDLE command (same as stop streaming)
      const idleCommand = TropXCommands.Cmd_StopStream();
      await this.writeCommand(Buffer.from(idleCommand));

      // Wait for device to process
      await this.delay(300);

      console.log(`✅ [${this.wrapper.deviceInfo.name}] Reset command sent`);
      return true;
    } catch (error) {
      console.error(`❌ [${this.wrapper.deviceInfo.name}] Failed to reset to IDLE:`, error);
      return false;
    }
  }

  /**
   * Get current device system state
   * Device sends response via notification, not via read value
   * @returns Device state value or NONE if failed
   */
  async getSystemState(): Promise<number> {
    const hasCharacteristics = await this.ensureCharacteristics();
    if (!hasCharacteristics) {
      console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] Cannot get system state: characteristics not available`);
      return TROPX_STATES.NONE;
    }

    try {
      // Set up promise to wait for notification response
      const responsePromise = new Promise<Buffer>((resolve, reject) => {
        const timeout = setTimeout(() => {
          // Safety check: characteristic might be null if device disconnected
          if (this.wrapper.commandCharacteristic) {
            this.wrapper.commandCharacteristic.removeListener('data', handler);
          }
          reject(new Error('State command response timeout'));
        }, 2000);  // Increased to 2 seconds for devices that respond slowly

        const handler = (data: Buffer) => {
          clearTimeout(timeout);
          // Safety check: characteristic might be null if device disconnected
          if (this.wrapper.commandCharacteristic) {
            this.wrapper.commandCharacteristic.removeListener('data', handler);
          }
          console.log(`📨 [${this.wrapper.deviceInfo.name}] Received state response via notification: [${Array.from(data).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
          resolve(data);
        };

        this.wrapper.commandCharacteristic.once('data', handler);
      });

      // Enable notifications if not already enabled
      try {
        await this.wrapper.commandCharacteristic.subscribeAsync();
      } catch (subError: any) {
        if (!subError.message?.includes('already') && !subError.message?.includes('subscribed')) {
          console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] Could not enable command notifications:`, subError.message);
        }
      }

      // Send command
      const stateCommand = TropXCommands.Cmd_GetSystemState();
      await this.wrapper.commandCharacteristic.writeAsync(Buffer.from(stateCommand), false);

      // Wait for notification response (not read!)
      const responseData = await responsePromise;

      // Decode response
      const state = TropXCommands.Dec_SystemState(new Uint8Array(responseData));
      return state;

    } catch (error) {
      console.error(`❌ [${this.wrapper.deviceInfo.name}] Failed to get system state:`, error);
      return TROPX_STATES.NONE;
    }
  }

  /**
   * Validates device state before starting an operation
   * @param operation - Operation name for logging
   * @param validator - Function to validate if state is acceptable
   * @returns true if state is valid, false otherwise
   */
  async validateStateForOperation(operation: string, validator: (state: number) => boolean): Promise<boolean> {
    console.log(`🔍 [${this.wrapper.deviceInfo.name}] Checking device state for ${operation}...`);
    const state = await this.getSystemState();

    if (state === TROPX_STATES.NONE) {
      console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] Cannot ${operation}: unable to get device state`);
      return false;
    }

    if (!validator(state)) {
      console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] Cannot ${operation}: device in ${TropXCommands.getStateName(state)} state`);
      return false;
    }

    console.log(`✅ [${this.wrapper.deviceInfo.name}] Device state valid for ${operation}: ${TropXCommands.getStateName(state)}`);
    return true;
  }

  // Start quaternion data streaming (with lazy characteristic discovery like Python)
  async startStreaming(): Promise<boolean> {
    // Ensure characteristics are discovered (uses cached if already done)
    const hasCharacteristics = await this.ensureCharacteristics();
    if (!hasCharacteristics) {
      return false;
    }

    // State validation now handled globally in NobleBluetoothService.startGlobalStreaming()
    // Individual devices no longer check state - the global validator handles resets

    try {
      const streamingStartTime = Date.now();
      console.log(`🎬 [${this.wrapper.deviceInfo.name}] Starting quaternion streaming using proper command format...`);

      // Reset first packet flag to log fresh timestamps for this session
      this.hasLoggedFirstPacket = false;

      // CRITICAL: Clean up any stale handlers from previous operations (e.g., locate mode)
      // This prevents handler accumulation and subscription conflicts
      this.wrapper.dataCharacteristic.removeAllListeners('data');
      this.wrapper.dataCharacteristic.removeAllListeners('error');
      console.log(`🧹 [${this.wrapper.deviceInfo.name}] Cleaned up stale handlers before streaming`);

      // Subscribe to data notifications first
      const subscriptionStartTime = Date.now();
      try {
        await this.wrapper.dataCharacteristic.subscribeAsync();
      } catch (subscribeError: any) {
        // If already subscribed (e.g., incomplete locate cleanup), log but continue
        if (subscribeError.message?.includes('already') || subscribeError.message?.includes('subscribed')) {
          console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] Already subscribed (cleaning up from previous operation)`);
        } else {
          throw subscribeError; // Re-throw other errors
        }
      }

      // Set up data handler with logging
      this.wrapper.dataCharacteristic.on('data', (data: Buffer) => {
        this.handleDataNotification(data);
      });

      // Also listen for errors
      this.wrapper.dataCharacteristic.on('error', (error: any) => {
        console.error(`❌ [${this.wrapper.deviceInfo.name}] Data characteristic error:`, error);
      });

      console.log(`🎬 [${this.wrapper.deviceInfo.name}] Data subscription completed, listening for notifications (${Date.now() - subscriptionStartTime}ms)`);

      // Start streaming with hardware timestamps (QUATERNION_TIMESTAMP mode)
      // Mode 0x30 = QUATERNION (0x10) | TIMESTAMP (0x20)
      // This embeds device timestamps in packets for accurate synchronization
      const streamCommandStartTime = Date.now();
      const streamCommand = TropXCommands.Cmd_StartStream(DATA_MODES.QUATERNION_TIMESTAMP, DATA_FREQUENCIES.HZ_100);
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
  // @param referenceTimestamp - Optional Unix timestamp (seconds) to use for all devices (for parallel sync)
  async initializeDeviceRTC(referenceTimestamp?: number): Promise<boolean> {
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

      // Step 2: Set device RTC (per Muse PDF)
      // This sets the device's internal 32-bit Unix timestamp counter
      // Use provided reference timestamp for parallel sync, or current time if not provided
      const currentUnixSeconds = referenceTimestamp || Math.floor(Date.now() / 1000);
      const setTimeCmd = Buffer.from(TropXCommands.Cmd_SetDateTime(currentUnixSeconds));

      console.log(`🕐 [${this.wrapper.deviceInfo.name}] Setting RTC to ${new Date(currentUnixSeconds * 1000).toISOString()}${referenceTimestamp ? ' (common reference)' : ''}...`);
      await this.wrapper.commandCharacteristic.writeAsync(setTimeCmd, false);
      await this.delay(200); // Allow RTC to stabilize

      const setTimeResponse = await this.wrapper.commandCharacteristic.readAsync();
      if (setTimeResponse && setTimeResponse.length >= 4) {
        const errorCode = setTimeResponse[3];
        if (errorCode !== 0x00) {
          console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] RTC set returned error 0x${errorCode.toString(16)}`);
        } else {
          console.log(`✅ [${this.wrapper.deviceInfo.name}] RTC set successfully`);
        }
      }

      console.log(`✅ [${this.wrapper.deviceInfo.name}] Device RTC initialized, ready for time sync`);

      // Mark RTC as initialized (ALWAYS overwrite - fresh sync on every connection!)
      this.wrapper.deviceInfo.syncState = 'rtc_initialized';

      return true;

    } catch (error) {
      console.error(`❌ [${this.wrapper.deviceInfo.name}] RTC initialization failed:`, error);
      return false;
    }
  }

  // Perform time synchronization (Muse v3 TimeSync Protocol)
  // NOTE: Must call initializeDeviceRTC() first!
  //
  // Per official PDF: All timestamp operations must happen INSIDE timesync mode.
  // GET_TIMESTAMP (0xb2) only works between ENTER_TIMESYNC and EXIT_TIMESYNC.
  //
  // @param applyOffset - If false, computes offset but doesn't send SET_CLOCK_OFFSET (for normalization)
  // @returns Object with offset (ms) and avgRoundTrip (ms) for BLE delay normalization
  async syncTime(applyOffset: boolean = true): Promise<{ offset: number; avgRoundTrip: number }> {
    if (!this.wrapper.commandCharacteristic) {
      throw new Error('Command characteristic not available for time sync');
    }

    console.log(`⏱️ [${this.wrapper.deviceInfo.name}] Starting hardware time synchronization...`);

    try {
      // Step 1: Enter time sync mode (REQUIRED before GET_TIMESTAMP works)
      console.log(`⏱️ [${this.wrapper.deviceInfo.name}] Entering time sync mode...`);
      const enterCmd = Buffer.from([TROPX_COMMANDS.ENTER_TIMESYNC, 0x00]);
      await this.wrapper.commandCharacteristic.writeAsync(enterCmd, false);
      await this.delay(50); // Wait for mode transition

      // Step 2: Collect timestamp samples for offset calculation
      // Per PDF: GET_TIMESTAMP returns 64-bit timestamp in epoch format with ms resolution
      const estimator = new TimeSyncEstimator();
      const SAMPLE_COUNT = 20; // Reduced from 50 for faster sync (4-5 seconds instead of 10)

      console.log(`⏱️ [${this.wrapper.deviceInfo.name}] Collecting ${SAMPLE_COUNT} timestamp samples...`);

      for (let i = 0; i < SAMPLE_COUNT; i++) {
        // Record master time before send
        const t1 = Date.now();

        // Send get timestamp command (only works inside timesync mode!)
        const getTimestampCmd = Buffer.from([TROPX_COMMANDS.GET_TIMESTAMP, 0x00]);
        await this.wrapper.commandCharacteristic.writeAsync(getTimestampCmd, false);

        // Wait for response with device's timestamp
        // Response format: [TYPE=0x00, LENGTH=0x0a, CMD=0xb2, ERROR_CODE, TIMESTAMP (8 bytes)]
        const response = await this.wrapper.commandCharacteristic.readAsync();

        // Record master time after receive
        const t3 = Date.now();

        // Parse device timestamp (bytes 4-11, little-endian 64-bit unsigned)
        if (response && response.length >= 12) {
          const errorCode = response[3];

          if (errorCode !== 0x00) {
            console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] GET_TIMESTAMP returned error 0x${errorCode.toString(16)} at sample ${i + 1}`);
            continue;
          }

          // Device returns timestamp in MICROSECONDS since device power-on
          // The device's internal counter is INDEPENDENT from RTC (SET_DATETIME)!
          // GET_TIMESTAMP returns the raw counter value, which starts from 0 at power-on.
          // We need to compute an offset to map this to our REFERENCE_EPOCH.
          // Timestamp is 48-bit (6 bytes), not 64-bit - same format as streaming
          // Read first 6 bytes and convert from microseconds to milliseconds
          const tmp = Buffer.alloc(8);
          response.copy(tmp, 0, 4, 10); // Copy bytes 4-9 (6 bytes)
          const deviceTimestampMicroseconds = Number(tmp.readBigUInt64LE(0) & 0x0000FFFFFFFFFFFFn);
          const deviceTimestamp = deviceTimestampMicroseconds / 1000; // Convert µs to ms (device counter ms)

          // FIRMWARE DETECTION: Detect if device has ms-based internal counter
          // GET_TIMESTAMP always returns µs, but we need to check if the value is suspiciously small,
          // indicating the internal counter is actually in milliseconds.
          // If first sample < 1 billion µs (~16.7 min), device counter is in ms
          if (i === 0 && deviceTimestampMicroseconds < 1000000000) {
            // Device counter is in MILLISECONDS (firmware bug/variant)
            // When we send SET_CLOCK_OFFSET in µs, this firmware will add it directly to the ms counter
            // To compensate, we need to send the offset in ms (divide by 1000)
            (this.wrapper.deviceInfo as any).firmwareUsesMilliseconds = true; // Send offset in ms!
            console.log(`🔍 [${this.wrapper.deviceInfo.name}] Firmware detection: MS-based counter (timestamp = ${deviceTimestamp.toFixed(2)}ms) - will send offset in MS`);
          } else if (i === 0) {
            // Standard firmware: counter in µs, offset should be in µs
            (this.wrapper.deviceInfo as any).firmwareUsesMilliseconds = false; // Send offset in µs
            console.log(`🔍 [${this.wrapper.deviceInfo.name}] Firmware detection: Standard µs-based counter (timestamp = ${deviceTimestamp.toFixed(2)}ms) - will send offset in µs`);
          }

          // DEBUG: Log first few samples
          if (i < 3) {
            const masterMidpoint = (t1 + t3) / 2;
            const masterSinceRefEpoch = masterMidpoint - REFERENCE_EPOCH_MS;
            const offset = masterSinceRefEpoch - deviceTimestamp;
            console.log(`🔍 [${this.wrapper.deviceInfo.name}] Sample ${i + 1}:`);
            console.log(`   Master time (t1): ${t1}ms (${new Date(t1).toISOString()})`);
            console.log(`   Master time (t3): ${t3}ms (${new Date(t3).toISOString()})`);
            console.log(`   Master midpoint: ${masterMidpoint.toFixed(3)}ms`);
            console.log(`   Master since REFERENCE_EPOCH: ${masterSinceRefEpoch.toFixed(3)}ms`);
            console.log(`   Device counter: ${deviceTimestampMicroseconds}µs = ${deviceTimestamp.toFixed(3)}ms (since power-on)`);
            console.log(`   Clock offset: ${offset.toFixed(3)}ms (maps device counter to REFERENCE_EPOCH)`);
            console.log(`   Round trip: ${(t3 - t1).toFixed(2)}ms`);
          }

          // Add sample for offset calculation
          // CRITICAL: Device counter starts from 0 at power-on (NOT Unix epoch!)
          // Master time must be relative to REFERENCE_EPOCH to match streaming expectations
          // Offset = (Master_time - REFERENCE_EPOCH) - Device_counter
          // The firmware adds this offset to the device counter, so:
          // Device_counter + offset = time since REFERENCE_EPOCH
          const masterT1 = t1 - REFERENCE_EPOCH_MS;
          const masterT3 = t3 - REFERENCE_EPOCH_MS;
          estimator.addSample(masterT1, deviceTimestamp, masterT3);

          // Small delay between samples to avoid overwhelming device
          if (i < SAMPLE_COUNT - 1) {
            await this.delay(10);
          }
        } else {
          console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] Invalid timestamp response at sample ${i + 1}`);
        }
      }

      // Step 3: Compute clock offset using median filtering
      // The offset is: master_time - device_unix_time
      // This can be added to device timestamps to sync with master clock
      const { offset: clockOffset, avgRoundTrip } = estimator.computeOffset();
      console.log(`⏱️ [${this.wrapper.deviceInfo.name}] Computed clock offset: ${clockOffset.toFixed(2)}ms (avg RTT: ${avgRoundTrip.toFixed(2)}ms)`);

      // Step 4: Write clock offset to device hardware (per Muse PDF spec)
      // CRITICAL: Must be done BEFORE exiting time sync mode!
      // CRITICAL: Only send if not already synced (prevents double-application!)
      const currentSyncState = this.wrapper.deviceInfo.syncState || 'not_synced';
      const hasValidOffset = this.wrapper.deviceInfo.clockOffset !== undefined && this.wrapper.deviceInfo.clockOffset !== null;

      if (applyOffset && (currentSyncState !== 'fully_synced' || !hasValidOffset)) {
        console.log(`⏱️ [${this.wrapper.deviceInfo.name}] Current sync state: ${currentSyncState} - proceeding with SET_CLOCK_OFFSET`);

        // Mark offset as computed
        this.wrapper.deviceInfo.syncState = 'offset_computed';
        // Device will add this offset to its internal RTC counter
        // All subsequent timestamps (streaming + commands) will be synchronized
        const MAX_VALID_OFFSET = 2n ** 63n - 1n;
        const MIN_VALID_OFFSET = -(2n ** 63n);
        const offsetBigInt = BigInt(Math.round(clockOffset));

        if (offsetBigInt >= MIN_VALID_OFFSET && offsetBigInt <= MAX_VALID_OFFSET) {
          console.log(`⏱️ [${this.wrapper.deviceInfo.name}] Writing clock offset to device hardware (WHILE IN TIMESYNC MODE)...`);

          const setOffsetCmd = Buffer.allocUnsafe(10);
          setOffsetCmd[0] = TROPX_COMMANDS.SET_CLOCK_OFFSET; // 0x31
          setOffsetCmd[1] = 0x08; // LENGTH (8 bytes for int64)
          setOffsetCmd.writeBigInt64LE(offsetBigInt, 2); // OFFSET (signed int64)

          console.log(`⏱️ [${this.wrapper.deviceInfo.name}] SET_CLOCK_OFFSET command: [${[...setOffsetCmd].map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
          await this.wrapper.commandCharacteristic.writeAsync(setOffsetCmd, false);
          await this.delay(100); // Allow device to process offset

          // Read response to confirm
          const response = await this.wrapper.commandCharacteristic.readAsync();
          if (response && response.length >= 4) {
            const errorCode = response[3];
            if (errorCode === 0x00) {
              console.log(`✅ [${this.wrapper.deviceInfo.name}] Hardware offset written successfully`);
              console.log(`✅ Device RTC corrected by ${clockOffset.toFixed(2)}ms`);
              console.log(`✅ All streaming timestamps now synchronized to master clock`);

              // Mark as fully synced (prevents re-application on reconnect)
              this.wrapper.deviceInfo.syncState = 'fully_synced';
            } else {
              console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] SET_CLOCK_OFFSET returned error 0x${errorCode.toString(16)}`);
            }
          }
        } else {
          console.error(`❌ [${this.wrapper.deviceInfo.name}] Clock offset out of range: ${clockOffset.toFixed(2)}ms`);
          throw new Error(`Hardware offset out of range: ${clockOffset.toFixed(2)}ms`);
        }
      } else {
        // applyOffset=false means caller will handle exit and apply separately
        console.log(`⏱️ [${this.wrapper.deviceInfo.name}] Offset computed: ${clockOffset.toFixed(2)}ms (avg RTT: ${avgRoundTrip.toFixed(2)}ms)`);
        console.log(`⏱️ [${this.wrapper.deviceInfo.name}] Offset computed, caller will exit timesync and apply offset...`);
      }

      console.log(`✅ [${this.wrapper.deviceInfo.name}] Hardware time synchronization complete!`);
      return { offset: clockOffset, avgRoundTrip };

    } catch (error) {
      console.error(`❌ [${this.wrapper.deviceInfo.name}] Time sync failed:`, error);
      throw error;
    }
  }

  // Clear clock offset (set to 0)
  // CRITICAL: Must be called BEFORE entering timesync mode (when device is in IDLE state)
  async clearClockOffset(): Promise<void> {
    if (!this.wrapper.commandCharacteristic) {
      throw new Error('Command characteristic not available');
    }

    const clearOffsetCmd = Buffer.allocUnsafe(10);
    clearOffsetCmd[0] = TROPX_COMMANDS.SET_CLOCK_OFFSET; // 0x31
    clearOffsetCmd[1] = 0x08; // LENGTH (8 bytes for int64)
    clearOffsetCmd.writeBigInt64LE(0n, 2); // Set offset to 0

    await this.wrapper.commandCharacteristic.writeAsync(clearOffsetCmd, false);
    await this.delay(100);
  }

  // Exit timesync mode
  // CRITICAL: Per Muse PDF, must be called BEFORE sending SET_CLOCK_OFFSET
  async exitTimeSyncMode(): Promise<void> {
    if (!this.wrapper.commandCharacteristic) {
      throw new Error('Command characteristic not available');
    }

    console.log(`⏱️ [${this.wrapper.deviceInfo.name}] Exiting time sync mode...`);
    const exitCmd = Buffer.from([TROPX_COMMANDS.EXIT_TIMESYNC, 0x00]);
    await this.wrapper.commandCharacteristic.writeAsync(exitCmd, false);
    await this.delay(50);
    console.log(`✅ [${this.wrapper.deviceInfo.name}] Exited timesync mode`);
  }

  // Apply clock offset (set the computed offset)
  // CRITICAL: Per Muse PDF page 6, must be called AFTER exiting timesync mode
  async applyClockOffset(normalizedOffset: number): Promise<void> {
    if (!this.wrapper.commandCharacteristic) {
      throw new Error('Command characteristic not available');
    }

    console.log(`⏱️ [${this.wrapper.deviceInfo.name}] Applying clock offset: ${normalizedOffset.toFixed(2)}ms`);

    // Mark offset as computed
    this.wrapper.deviceInfo.syncState = 'offset_computed';

    // Detect firmware type and send offset in appropriate units
    const usesMilliseconds = (this.wrapper.deviceInfo as any).firmwareUsesMilliseconds || false;

    let offsetBigInt: bigint;
    let offsetUnits: string;

    if (usesMilliseconds) {
      // Send offset in milliseconds (for firmware with ms-based counters)
      offsetBigInt = BigInt(Math.round(normalizedOffset));
      offsetUnits = 'ms';
    } else {
      // Send offset in microseconds (per Muse spec, for standard firmware)
      offsetBigInt = BigInt(Math.round(normalizedOffset * 1000));
      offsetUnits = 'µs';
    }

    console.log(`🔍 [${this.wrapper.deviceInfo.name}] Offset conversion:`);
    console.log(`   Input (ms): ${normalizedOffset.toFixed(2)}`);
    console.log(`   Firmware expects: ${usesMilliseconds ? 'milliseconds' : 'microseconds'}`);
    console.log(`   Sending (${offsetUnits}): ${offsetBigInt.toString()}`);

    const setOffsetCmd = Buffer.allocUnsafe(10);
    setOffsetCmd[0] = TROPX_COMMANDS.SET_CLOCK_OFFSET; // 0x31
    setOffsetCmd[1] = 0x08; // LENGTH (8 bytes for int64)

    // CRITICAL: Per Muse API Python code (Muse_Utils.py:772-780), despite the confusing
    // indexing, the offset is written as little-endian 64-bit integer.
    // However, the firmware might only read 5 bytes (see Dec_ClockOffset line 1965)!
    // Let's use signed int64 little-endian as the protocol specifies.
    setOffsetCmd.writeBigInt64LE(offsetBigInt, 2); // Write as little-endian int64

    console.log(`📤 [${this.wrapper.deviceInfo.name}] SET_CLOCK_OFFSET command: [${[...setOffsetCmd].map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

    await this.wrapper.commandCharacteristic.writeAsync(setOffsetCmd, false);
    await this.delay(200);

    // Read response to confirm
    const response = await this.wrapper.commandCharacteristic.readAsync();
    console.log(`📥 [${this.wrapper.deviceInfo.name}] SET_CLOCK_OFFSET response: [${response ? [...response].map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ') : 'null'}]`);

    if (response && response.length >= 4) {
      const errorCode = response[3];
      if (errorCode === 0x00) {
        this.wrapper.deviceInfo.syncState = 'fully_synced';
        console.log(`✅ [${this.wrapper.deviceInfo.name}] Clock offset applied successfully`);
      } else {
        console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] SET_CLOCK_OFFSET returned error 0x${errorCode.toString(16)}`);
      }
    } else {
      console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] SET_CLOCK_OFFSET: Invalid or no response received`);
    }

    // Store the normalized offset
    this.wrapper.deviceInfo.clockOffset = normalizedOffset;
  }

  // Apply clock offset to device hardware AND exit timesync mode
  // CRITICAL: Must be called while STILL IN TIMESYNC MODE (before EXIT_TIMESYNC)
  async applyClockOffsetAndExit(normalizedOffset: number): Promise<void> {
    if (!this.wrapper.commandCharacteristic) {
      throw new Error('Command characteristic not available');
    }

    // Apply the normalized offset
    console.log(`⏱️ [${this.wrapper.deviceInfo.name}] Applying normalized offset (WHILE IN TIMESYNC MODE): ${normalizedOffset.toFixed(2)}ms`);

    // Mark offset as computed
    this.wrapper.deviceInfo.syncState = 'offset_computed';

    // FIRMWARE BUG WORKAROUND:
    // Some devices have firmware that expects offset in MILLISECONDS (matching their internal clock counter),
    // even though Muse spec says microseconds. We detected this during syncTime() by checking if the
    // device sends microsecond timestamps. If so, it means the device's internal counter is in milliseconds
    // (ironically!) and we need to send the offset in milliseconds too.
    //
    // Detection: Check if device info has a 'firmwareUsesMilliseconds' flag set during syncTime()
    const usesMilliseconds = (this.wrapper.deviceInfo as any).firmwareUsesMilliseconds || false;

    let offsetBigInt: bigint;
    let offsetUnits: string;

    if (usesMilliseconds) {
      // Send offset in milliseconds (for firmware that sends µs timestamps but expects ms offsets)
      offsetBigInt = BigInt(Math.round(normalizedOffset));
      offsetUnits = 'ms';
    } else {
      // Send offset in microseconds (per Muse spec, for correct firmware)
      offsetBigInt = BigInt(Math.round(normalizedOffset * 1000));
      offsetUnits = 'µs';
    }

    console.log(`🔍 [${this.wrapper.deviceInfo.name}] Offset conversion:`);
    console.log(`   Input (ms): ${normalizedOffset.toFixed(2)}`);
    console.log(`   Firmware expects: ${usesMilliseconds ? 'milliseconds' : 'microseconds'}`);
    console.log(`   Sending (${offsetUnits}): ${offsetBigInt.toString()}`);

    // Validate offset range
    const MIN_VALID_OFFSET = usesMilliseconds
      ? BigInt('-9223372036854775807')  // Full int64 range for ms
      : BigInt('-9223372036854775');     // Reduced range for µs (fits in ms range)
    const MAX_VALID_OFFSET = usesMilliseconds
      ? BigInt('9223372036854775807')
      : BigInt('9223372036854775');

    if (offsetBigInt >= MIN_VALID_OFFSET && offsetBigInt <= MAX_VALID_OFFSET) {
      const setOffsetCmd = Buffer.allocUnsafe(10);
      setOffsetCmd[0] = TROPX_COMMANDS.SET_CLOCK_OFFSET; // 0x31
      setOffsetCmd[1] = 0x08; // LENGTH (8 bytes for int64)
      setOffsetCmd.writeBigInt64LE(offsetBigInt, 2); // OFFSET (signed int64)

      console.log(`📤 [${this.wrapper.deviceInfo.name}] SET_CLOCK_OFFSET command: [${[...setOffsetCmd].map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

      await this.wrapper.commandCharacteristic.writeAsync(setOffsetCmd, false);
      await this.delay(200); // Increased delay to allow firmware to process

      // Read response to confirm
      const response = await this.wrapper.commandCharacteristic.readAsync();
      console.log(`📥 [${this.wrapper.deviceInfo.name}] SET_CLOCK_OFFSET response: [${response ? [...response].map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ') : 'null'}]`);

      if (response && response.length >= 4) {
        const errorCode = response[3];
        if (errorCode === 0x00) {
          this.wrapper.deviceInfo.syncState = 'fully_synced';
          console.log(`✅ [${this.wrapper.deviceInfo.name}] Normalized offset applied successfully`);
        } else {
          console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] SET_CLOCK_OFFSET returned error 0x${errorCode.toString(16)}`);
        }
      } else {
        console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] SET_CLOCK_OFFSET: Invalid or no response received`);
      }
    } else {
      throw new Error(`Offset out of range: ${normalizedOffset.toFixed(2)}ms`);
    }

    // Store the normalized offset
    this.wrapper.deviceInfo.clockOffset = normalizedOffset;

    // NOW exit timesync mode (AFTER applying offset!)
    console.log(`⏱️ [${this.wrapper.deviceInfo.name}] Exiting time sync mode...`);
    const exitCmd = Buffer.from([TROPX_COMMANDS.EXIT_TIMESYNC, 0x00]);
    await this.wrapper.commandCharacteristic.writeAsync(exitCmd, false);
    await this.delay(50);
  }

  // Legacy method - keeping for compatibility but not used

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

  // Time Sync API: Send raw command buffer and read response
  async sendRawCommand(commandBuffer: Buffer): Promise<Buffer> {
    if (!this.wrapper.commandCharacteristic) {
      throw new Error('Command characteristic not available');
    }

    await this.wrapper.commandCharacteristic.writeAsync(commandBuffer, false);
    await this.delay(50);

    const response = await this.wrapper.commandCharacteristic.readAsync();
    if (!response) {
      throw new Error('No response received from device');
    }

    return response;
  }

  // Time Sync API: Write command buffer without waiting for response
  async writeRawCommand(commandBuffer: Buffer): Promise<void> {
    if (!this.wrapper.commandCharacteristic) {
      throw new Error('Command characteristic not available');
    }

    await this.wrapper.commandCharacteristic.writeAsync(commandBuffer, false);
  }

  // Handle incoming data notifications
  private handleDataNotification(data: Buffer): void {
    // PERFORMANCE: Capture reception time immediately (fallback if no device timestamp)
    const receptionTimestamp = Date.now();

    try {
      // Validate packet size (mode 0x30 = QUATERNION_TIMESTAMP has 20 bytes)
      if (data.length !== PACKET_SIZES.TOTAL_QUATERNION_TIMESTAMP) {
        console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] Invalid packet size: ${data.length}, expected: ${PACKET_SIZES.TOTAL_QUATERNION_TIMESTAMP}`);
        return;
      }

      // Parse 8-byte header (general packet header, not the timestamp!)
      const header = data.subarray(0, PACKET_SIZES.HEADER);

      // Parse device timestamp from payload (mode 0x30 embeds timestamp AFTER quaternion)
      // Packet structure: [8-byte header][6-byte quaternion][6-byte timestamp]
      let syncedTimestamp = 0;
      try {
        // Timestamp is 48 bits (6 bytes), located at bytes 14-19 in the packet
        // Format: 6-byte little-endian integer - SHOULD be milliseconds but some devices send microseconds
        // Note: GET_TIMESTAMP command returns microseconds, streaming mode 0x30 SHOULD send milliseconds
        const timestampOffset = PACKET_SIZES.HEADER + PACKET_SIZES.QUATERNION; // Byte 14
        const timestampBytes = data.subarray(timestampOffset, timestampOffset + PACKET_SIZES.TIMESTAMP);
        const tmp = Buffer.alloc(8);
        timestampBytes.copy(tmp, 0, 0, 6); // Copy 6 bytes
        let deviceTimestamp = Number(tmp.readBigUInt64LE(0) & 0x0000FFFFFFFFFFFFn); // Mask to 48 bits

        // FINAL TRUTH: Firmware ALWAYS uses MILLISECONDS
        // 48-bit limit (281 trillion) = 8.9 years in microseconds (too small!)
        // 48-bit limit (281 trillion) = 8,925 years in milliseconds (perfect!)
        // Therefore: streaming timestamps are ALWAYS in milliseconds
        const deviceTimestampMs = deviceTimestamp;

        // Hardware clock offset already applied by SET_CLOCK_OFFSET during time sync
        syncedTimestamp = deviceTimestampMs;

        // DEBUG: Log first packet
        if (!this.hasLoggedFirstPacket) {
          // Track timestamp for this device
          TropXDevice.firstPacketTimestamps.set(this.wrapper.deviceInfo.name, syncedTimestamp);

          // If this is the first device, remember it as reference
          if (TropXDevice.firstDeviceName === null) {
            TropXDevice.firstDeviceName = this.wrapper.deviceInfo.name;
          }

          console.log(`🔍 [${this.wrapper.deviceInfo.name}] Firmware always uses MILLISECONDS (48-bit limit requires it)`);

          console.log(`📦 [${this.wrapper.deviceInfo.name}] First packet:`);
          console.log(`   Raw timestamp bytes: [${Array.from(timestampBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
          console.log(`   Parsed as 48-bit value: ${deviceTimestamp}ms`);
          console.log(`   Device timestamp: ${deviceTimestampMs.toFixed(3)}ms`);
          console.log(`   = ${new Date(syncedTimestamp).toISOString()}`);

          // Calculate delta from first device
          if (TropXDevice.firstDeviceName && TropXDevice.firstDeviceName !== this.wrapper.deviceInfo.name) {
            const firstTimestamp = TropXDevice.firstPacketTimestamps.get(TropXDevice.firstDeviceName);
            if (firstTimestamp !== undefined) {
              const delta = syncedTimestamp - firstTimestamp;
              console.log(`   ⏱️  Δ from ${TropXDevice.firstDeviceName}: ${delta > 0 ? '+' : ''}${delta.toFixed(3)}ms`);
            }
          }

          console.log(`   ℹ️  Hardware clock offset already applied (SET_CLOCK_OFFSET)`);
          this.hasLoggedFirstPacket = true;
        }
      } catch (parseError) {
        console.warn(`⚠️ [${this.wrapper.deviceInfo.name}] Could not parse device timestamp, using reception time`);
        syncedTimestamp = receptionTimestamp;
      }

      // Parse quaternion data (bytes 8-13)
      // In QUATERNION_TIMESTAMP mode: [8-byte header][6-byte quaternion][6-byte timestamp]
      const quaternionData = data.subarray(PACKET_SIZES.HEADER, PACKET_SIZES.HEADER + PACKET_SIZES.QUATERNION);
      const quaternion = this.parseQuaternionData(quaternionData);

      const motionData: MotionData = {
        timestamp: syncedTimestamp,
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

    // Notify with auto_reconnect flag so service can trigger reconnection
    this.notifyEvent('auto_reconnect', {
      deviceId: this.wrapper.deviceInfo.id,
      deviceName: this.wrapper.deviceInfo.name
    });
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
  // Public for DeviceLocateService
  async writeCommand(buffer: Buffer): Promise<void> {
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