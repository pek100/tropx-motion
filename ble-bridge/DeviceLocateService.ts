/**
 * DeviceLocateService.ts
 *
 * Handles device location detection using accelerometer data.
 * When a user physically shakes a device, this service detects the acceleration
 * spikes and identifies which device is being shaken.
 */

import { EventEmitter } from 'events';
import { TropXDevice } from './TropXDevice';
import { DATA_MODES, DATA_FREQUENCIES, PACKET_SIZES } from './BleBridgeConstants';

// Threshold for detecting device shake (in g-force)
// Very sensitive - even gentle taps should be detected
const SHAKE_THRESHOLD_G = 0.05; // 0.3g threshold - VERY sensitive
const SHAKE_SAMPLE_WINDOW = 10; // Number of samples to analyze (reduced for faster detection)
const SHAKE_DEBOUNCE_MS = 100; // Minimum time between shake detections (reduced for more responsive UI)

export interface AccelerometerData {
  x: number; // g-force
  y: number; // g-force
  z: number; // g-force
  magnitude: number; // Total acceleration magnitude
  timestamp: number;
}

export class DeviceLocateService extends EventEmitter {
  private devices: Map<string, TropXDevice> = new Map();
  private accelerometerData: Map<string, AccelerometerData[]> = new Map();
  private lastShakeDetection: Map<string, number> = new Map();
  private lastDataReceived: Map<string, number> = new Map();
  private isActive: boolean = false;
  private dataHandlers: Map<string, (data: Buffer) => void> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;

  /**
   * Start locate mode on all connected devices
   */
  async startLocateMode(devices: TropXDevice[]): Promise<void> {
    if (this.isActive) {
      console.warn('Locate mode already active');
      return;
    }

    console.log(`🔍 Starting locate mode for ${devices.length} devices...`);

    // Validate device states before starting
    // Now using proper pattern: notifications enabled on command characteristic before reads
    const { TropXCommands } = await import('./TropXCommands');
    const invalidDevices: string[] = [];

    for (const device of devices) {
      const wrapper = device.getWrapper();
      const state = await device.getSystemState();

      if (state === 0x00) { // NONE - unable to get state
        invalidDevices.push(`${wrapper.deviceInfo.name} (cannot read state)`);
      } else if (!TropXCommands.isValidForLocate(state)) {
        invalidDevices.push(`${wrapper.deviceInfo.name} (${TropXCommands.getStateName(state)})`);
      }
    }

    if (invalidDevices.length > 0) {
      console.error(`❌ Cannot start locate mode - invalid device states:\n  ${invalidDevices.join('\n  ')}`);
      throw new Error(`Invalid device states: ${invalidDevices.join(', ')}`);
    }

    console.log(`✅ All devices in valid state for locate mode`);

    this.isActive = true;
    this.devices.clear();
    this.accelerometerData.clear();
    this.lastShakeDetection.clear();
    this.lastDataReceived.clear();

    // Start accelerometer streaming on all devices in parallel (asynchronously)
    await Promise.all(devices.map(async (device) => {
      try {
        const wrapper = device.getWrapper();

        // Store device reference
        const deviceId = wrapper.deviceInfo.id;
        this.devices.set(deviceId, device);
        this.accelerometerData.set(deviceId, []);

        // CRITICAL: Clean up any existing handlers first (prevents accumulation)
        wrapper.dataCharacteristic.removeAllListeners('data');
        wrapper.dataCharacteristic.removeAllListeners('error');
        console.log(`🧹 [${wrapper.deviceInfo.name}] Cleaned up stale handlers before locate mode`);

        // Set up data handler for accelerometer packets with error protection
        const handler = (data: Buffer) => {
          try {
            this.handleAccelerometerData(deviceId, data);
          } catch (error) {
            console.error(`❌ [${wrapper.deviceInfo.name}] Accelerometer handler error:`, error);
            // Don't throw - keep handler alive
          }
        };
        this.dataHandlers.set(deviceId, handler);

        // Subscribe to data characteristic (with error handling for already-subscribed)
        try {
          await wrapper.dataCharacteristic.subscribeAsync();
        } catch (subError: any) {
          if (subError.message?.includes('already') || subError.message?.includes('subscribed')) {
            console.warn(`⚠️ [${wrapper.deviceInfo.name}] Already subscribed (from previous operation)`);
          } else {
            throw subError;
          }
        }
        wrapper.dataCharacteristic.on('data', handler);

        // Also listen for characteristic errors
        wrapper.dataCharacteristic.on('error', (error: any) => {
          console.error(`❌ [${wrapper.deviceInfo.name}] Data characteristic error during locate:`, error);
        });

        // Start accelerometer streaming (100Hz for responsive detection)
        const streamCommand = this.createAccelerometerStreamCommand();
        await device.writeCommand(Buffer.from(streamCommand));

        console.log(`✅ [${wrapper.deviceInfo.name}] Accelerometer streaming started`);

        // Initialize last data received timestamp
        this.lastDataReceived.set(deviceId, Date.now());
      } catch (error) {
        const wrapper = device.getWrapper();
        console.error(`❌ Failed to start locate mode for device ${wrapper.deviceInfo.name}:`, error);
      }
    }));

    // Start health check to detect data stalls
    this.startHealthCheck();
  }

  /**
   * Monitor data flow and detect stalls
   */
  private startHealthCheck(): void {
    // Check every 2 seconds if devices are still sending data
    this.healthCheckInterval = setInterval(() => {
      if (!this.isActive) return;

      const now = Date.now();
      const stallTimeout = 2000; // 2 seconds without data = stall

      for (const [deviceId, device] of this.devices.entries()) {
        const lastReceived = this.lastDataReceived.get(deviceId);
        if (lastReceived && (now - lastReceived) > stallTimeout) {
          const wrapper = device.getWrapper();
          console.error(`❌ [${wrapper.deviceInfo.name}] Data stall detected! Last data: ${now - lastReceived}ms ago`);
          console.error(`   This indicates BLE notification subscription may have died`);
        }
      }
    }, 2000);
  }

  /**
   * Stop locate mode and return devices to idle
   */
  async stopLocateMode(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    console.log(`🛑 Stopping locate mode...`);
    this.isActive = false;

    // Stop health check
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Stop streaming on all devices sequentially (not parallel) to ensure clean shutdown
    for (const [deviceId, device] of this.devices.entries()) {
      try {
        const wrapper = device.getWrapper();
        console.log(`🛑 [${wrapper.deviceInfo.name}] Stopping locate mode...`);

        // STEP 1: Remove handlers FIRST to stop processing new data
        if (wrapper.dataCharacteristic) {
          wrapper.dataCharacteristic.removeAllListeners('data');
          wrapper.dataCharacteristic.removeAllListeners('error');
          console.log(`🗑️ [${wrapper.deviceInfo.name}] Removed all data/error handlers`);
        }

        // STEP 2: Send IDLE command to device
        const stopCommand = new Uint8Array([0x02, 0x01, 0x02]); // CMD_STATE, length=1, IDLE
        await device.writeCommand(Buffer.from(stopCommand));
        console.log(`🛑 [${wrapper.deviceInfo.name}] Sent IDLE command`);

        // STEP 3: Wait longer for device to fully stop and flush buffers
        await new Promise(resolve => setTimeout(resolve, 200));

        // STEP 4: Unsubscribe from notifications
        if (wrapper.dataCharacteristic) {
          try {
            await wrapper.dataCharacteristic.unsubscribeAsync();
            console.log(`📴 [${wrapper.deviceInfo.name}] Unsubscribed from data characteristic`);
          } catch (unsubError) {
            console.warn(`⚠️ [${wrapper.deviceInfo.name}] Unsubscribe error (may already be unsubscribed):`, unsubError);
          }
        }

        console.log(`✅ [${wrapper.deviceInfo.name}] Stopped accelerometer streaming`);
      } catch (error) {
        const wrapper = device.getWrapper();
        console.error(`❌ Failed to stop locate mode for device ${wrapper.deviceInfo.name}:`, error);
      }
    }

    this.devices.clear();
    this.accelerometerData.clear();
    this.dataHandlers.clear();
    this.lastDataReceived.clear();
    this.lastShakeDetection.clear();
  }

  /**
   * Create accelerometer stream command
   */
  private createAccelerometerStreamCommand(): Uint8Array {
    const buffer = new Uint8Array(7);

    buffer[0] = 0x02;  // CMD_STATE
    buffer[1] = 0x05;  // Length (5 bytes payload)
    buffer[2] = 0x08;  // STREAMING state

    // Convert mode to little-endian bytes (ACCELEROMETER mode = 0x02)
    const mode = DATA_MODES.ACCELEROMETER;
    const modeBuffer = new ArrayBuffer(4);
    const modeView = new DataView(modeBuffer);
    modeView.setUint32(0, mode, true);

    buffer[3] = modeView.getUint8(0);
    buffer[4] = modeView.getUint8(1);
    buffer[5] = modeView.getUint8(2);
    buffer[6] = DATA_FREQUENCIES.HZ_100; // 100Hz for responsive shake detection

    return buffer;
  }

  /**
   * Handle incoming accelerometer data packets
   */
  private handleAccelerometerData(deviceId: string, data: Buffer): void {
    if (!this.isActive) {
      console.warn(`⚠️ [${deviceId}] Received data but locate mode not active - ignoring`);
      return;
    }

    // Parse accelerometer packet (14 bytes: 8 header + 6 accel data)
    if (data.length !== PACKET_SIZES.TOTAL_ACCELEROMETER) {
      console.warn(`⚠️ [${deviceId}] Invalid packet size: ${data.length} (expected ${PACKET_SIZES.TOTAL_ACCELEROMETER}) - skipping`);
      return; // Invalid packet
    }

    // Update health check timestamp
    this.lastDataReceived.set(deviceId, Date.now());

    // Skip 8-byte header, read 3 x int16 accelerometer values (little-endian)
    const x_raw = data.readInt16LE(8);
    const y_raw = data.readInt16LE(10);
    const z_raw = data.readInt16LE(12);

    // Convert to g-force (sensitivity depends on full-scale setting)
    // Using ±4g full scale: sensitivity = 0.122 mg/LSB = 0.000122 g/LSB
    const sensitivity = 0.000122; // g/LSB for ±4g range
    const x = x_raw * sensitivity;
    const y = y_raw * sensitivity;
    const z = z_raw * sensitivity;

    // Calculate total acceleration magnitude
    const magnitude = Math.sqrt(x * x + y * y + z * z);

    const accelData: AccelerometerData = {
      x,
      y,
      z,
      magnitude,
      timestamp: Date.now()
    };

    // Store data sample
    const samples = this.accelerometerData.get(deviceId) || [];

    // Debug: Log first few samples to verify data is coming through
    if (samples.length < 3) {
      console.log(`📊 [${deviceId}] Accel: x=${x.toFixed(3)}g, y=${y.toFixed(3)}g, z=${z.toFixed(3)}g, mag=${magnitude.toFixed(3)}g`);
    }

    samples.push(accelData);

    // Keep only recent samples (rolling window)
    if (samples.length > SHAKE_SAMPLE_WINDOW) {
      samples.shift();
    }
    this.accelerometerData.set(deviceId, samples);

    // Detect shake pattern
    this.detectShake(deviceId, samples);
  }

  /**
   * Detect if device is being shaken based on acceleration patterns
   */
  private detectShake(deviceId: string, samples: AccelerometerData[]): void {
    if (samples.length < 5) return; // Need enough samples

    // Check debounce timer
    const lastShake = this.lastShakeDetection.get(deviceId) || 0;
    if (Date.now() - lastShake < SHAKE_DEBOUNCE_MS) {
      return; // Too soon after last detection
    }

    // Calculate average and peak acceleration
    const magnitudes = samples.map(s => s.magnitude);
    const avgMagnitude = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length;
    const maxMagnitude = Math.max(...magnitudes);

    // Detect spike above threshold
    // Very sensitive - any movement above threshold triggers detection
    const deviation = maxMagnitude - avgMagnitude;

    // Much more sensitive: lower threshold and lower deviation requirement
    if (maxMagnitude > SHAKE_THRESHOLD_G && deviation > 0.05) {
      console.log(`🔍 Shake detected on device ${deviceId}: ${maxMagnitude.toFixed(3)}g (avg: ${avgMagnitude.toFixed(3)}g, dev: ${deviation.toFixed(3)}g, threshold: ${SHAKE_THRESHOLD_G}g)`);

      // Update debounce timer
      this.lastShakeDetection.set(deviceId, Date.now());

      // Emit shake detection event
      this.emit('device_shaken', deviceId);
    }
  }

  /**
   * Get currently shaking devices (for WebSocket broadcast)
   */
  getShakingDevices(): string[] {
    const now = Date.now();
    const shakingDevices: string[] = [];

    for (const [deviceId, lastShake] of this.lastShakeDetection) {
      // Device is considered "shaking" for 300ms after detection
      // This is slightly longer than the debounce time (200ms) to show the vibration,
      // but short enough to not get stuck in a loop
      if (now - lastShake < 300) {
        shakingDevices.push(deviceId);
      }
    }

    return shakingDevices;
  }
}
