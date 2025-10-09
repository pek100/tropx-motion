/**
 * ESP32 Serial Port Auto-Detection
 * Cross-platform ESP32 serial port detection and connection
 */

import * as os from 'os';

export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export class SerialPortDetector {
  /**
   * Detect ESP32 serial ports
   * Returns list of likely ESP32 ports sorted by confidence
   */
  static async detectESP32Ports(): Promise<SerialPortInfo[]> {
    try {
      // Dynamically import serialport (only if installed)
      const { SerialPort } = await import('serialport');

      const ports = await SerialPort.list();
      const esp32Ports: SerialPortInfo[] = [];

      for (const port of ports) {
        const confidence = this.getESP32Confidence(port);

        if (confidence) {
          esp32Ports.push({
            path: port.path,
            manufacturer: port.manufacturer,
            serialNumber: port.serialNumber,
            vendorId: port.vendorId,
            productId: port.productId,
            confidence: confidence.level,
            reason: confidence.reason,
          });
        }
      }

      // Sort by confidence (high > medium > low)
      esp32Ports.sort((a, b) => {
        const order = { high: 3, medium: 2, low: 1 };
        return order[b.confidence] - order[a.confidence];
      });

      return esp32Ports;

    } catch (error) {
      console.warn('SerialPort module not available:', error);
      // Return platform-specific default paths
      return this.getDefaultPaths();
    }
  }

  /**
   * Get best ESP32 serial port
   */
  static async getBestESP32Port(): Promise<SerialPortInfo | null> {
    const ports = await this.detectESP32Ports();
    return ports.length > 0 ? ports[0] : null;
  }

  /**
   * Determine if a port is likely an ESP32
   */
  private static getESP32Confidence(port: any): { level: 'high' | 'medium' | 'low'; reason: string } | null {
    const manufacturer = port.manufacturer?.toLowerCase() || '';
    const path = port.path.toLowerCase();
    const vendorId = port.vendorId?.toLowerCase();
    const productId = port.productId?.toLowerCase();

    // High confidence: Known ESP32 USB chips
    if (manufacturer.includes('silicon labs')) {
      return { level: 'high', reason: 'Silicon Labs CP2102 (ESP32 standard)' };
    }
    if (manufacturer.includes('ftdi') || manufacturer.includes('future technology')) {
      return { level: 'high', reason: 'FTDI chip (common ESP32 variant)' };
    }
    if (manufacturer.includes('wch') || manufacturer.includes('ch340')) {
      return { level: 'high', reason: 'CH340 chip (ESP32 variant)' };
    }
    if (manufacturer.includes('espressif')) {
      return { level: 'high', reason: 'Espressif ESP32 (native USB)' };
    }

    // High confidence: Known vendor IDs
    if (vendorId === '10c4' && productId === 'ea60') {
      return { level: 'high', reason: 'CP2102 VID/PID' };
    }
    if (vendorId === '0403' && productId === '6001') {
      return { level: 'high', reason: 'FTDI VID/PID' };
    }
    if (vendorId === '1a86' && productId === '7523') {
      return { level: 'high', reason: 'CH340 VID/PID' };
    }

    // Medium confidence: Common ESP32 port names
    if (path.includes('usbserial') || path.includes('usbmodem')) {
      return { level: 'medium', reason: 'USB serial device (likely ESP32)' };
    }
    if (path.includes('ttyusb') || path.includes('ttyacm')) {
      return { level: 'medium', reason: 'Linux USB serial device' };
    }
    if (path.match(/com\d+/i)) {
      return { level: 'medium', reason: 'Windows COM port' };
    }

    // Low confidence: Generic serial ports
    if (path.includes('serial') || path.includes('tty')) {
      return { level: 'low', reason: 'Generic serial device' };
    }

    return null;
  }

  /**
   * Get default paths to try based on platform
   */
  private static getDefaultPaths(): SerialPortInfo[] {
    const platform = os.platform();
    const defaults: SerialPortInfo[] = [];

    if (platform === 'linux') {
      // Raspberry Pi GPIO serial
      defaults.push({
        path: '/dev/serial0',
        confidence: 'medium',
        reason: 'Raspberry Pi GPIO UART',
      });

      // Common USB serial ports
      for (let i = 0; i < 4; i++) {
        defaults.push({
          path: `/dev/ttyUSB${i}`,
          confidence: 'medium',
          reason: 'Linux USB serial',
        });
        defaults.push({
          path: `/dev/ttyACM${i}`,
          confidence: 'medium',
          reason: 'Linux ACM serial',
        });
      }
    } else if (platform === 'darwin') {
      // macOS USB serial patterns
      defaults.push({
        path: '/dev/tty.usbserial',
        confidence: 'medium',
        reason: 'macOS USB serial',
      });
      defaults.push({
        path: '/dev/tty.usbmodem',
        confidence: 'medium',
        reason: 'macOS USB modem',
      });
    } else if (platform === 'win32') {
      // Windows COM ports
      for (let i = 1; i <= 20; i++) {
        defaults.push({
          path: `COM${i}`,
          confidence: 'low',
          reason: 'Windows COM port',
        });
      }
    }

    return defaults;
  }

  /**
   * Try to open a serial port and verify it's responsive
   */
  static async verifySerialPort(path: string, baudRate: number = 115200): Promise<boolean> {
    try {
      const { SerialPort } = await import('serialport');

      return new Promise((resolve) => {
        const port = new SerialPort({
          path,
          baudRate,
          autoOpen: false,
        });

        const timeout = setTimeout(() => {
          port.close();
          resolve(false);
        }, 2000);

        port.open((err) => {
          clearTimeout(timeout);

          if (err) {
            resolve(false);
            return;
          }

          // Successfully opened
          port.close();
          resolve(true);
        });
      });
    } catch (error) {
      return false;
    }
  }

  /**
   * Log detected ESP32 ports
   */
  static async logDetectedPorts(): Promise<void> {
    console.log('');
    console.log('=== ESP32 Serial Port Detection ===');

    const ports = await this.detectESP32Ports();

    if (ports.length === 0) {
      console.log('❌ No ESP32 devices detected');
      console.log('');
      console.log('💡 Troubleshooting:');
      console.log('   1. Connect ESP32 via USB');
      console.log('   2. Install drivers if needed (CP2102/CH340)');
      console.log('   3. Check device is powered on');
      console.log('');
      return;
    }

    console.log(`✅ Found ${ports.length} potential ESP32 device(s):`);
    console.log('');

    ports.forEach((port, index) => {
      const icon = port.confidence === 'high' ? '✅' : port.confidence === 'medium' ? '⚠️' : '❓';
      console.log(`${icon} Port ${index + 1}: ${port.path}`);
      console.log(`   Confidence: ${port.confidence.toUpperCase()}`);
      console.log(`   Reason: ${port.reason}`);
      if (port.manufacturer) {
        console.log(`   Manufacturer: ${port.manufacturer}`);
      }
      if (port.serialNumber) {
        console.log(`   Serial: ${port.serialNumber}`);
      }
      console.log('');
    });

    const best = ports[0];
    console.log(`🎯 Recommended port: ${best.path}`);
    console.log('');
  }
}
