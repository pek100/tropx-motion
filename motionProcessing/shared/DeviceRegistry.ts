// Device serial number registry for efficient device identification
export const MAX_DEVICES = 255; // uint8 limit

export interface DeviceInfo {
  id: string;      // BLE device ID (MAC address)
  name: string;    // Human-readable device name
  serial: number;  // Assigned serial number (0-255)
}

export class DeviceRegistry {
  private serialToDevice: Map<number, DeviceInfo> = new Map();
  private idToSerial: Map<string, number> = new Map();
  private nextSerial: number = 0;

  // Assign serial number to device, returns existing if already registered
  assignSerial(deviceId: string, deviceName: string): number {
    const existingSerial = this.idToSerial.get(deviceId);
    if (existingSerial !== undefined) {
      return existingSerial;
    }

    if (this.nextSerial >= MAX_DEVICES) {
      throw new Error(`Device limit reached (${MAX_DEVICES} max)`);
    }

    const serial = this.nextSerial++;
    const deviceInfo: DeviceInfo = { id: deviceId, name: deviceName, serial };

    this.serialToDevice.set(serial, deviceInfo);
    this.idToSerial.set(deviceId, serial);

    return serial;
  }

  // Get device info by serial number
  getDeviceInfo(serial: number): DeviceInfo | undefined {
    return this.serialToDevice.get(serial);
  }

  // Get serial by device ID
  getSerial(deviceId: string): number | undefined {
    return this.idToSerial.get(deviceId);
  }

  // Get device name by serial
  getDeviceName(serial: number): string | undefined {
    return this.serialToDevice.get(serial)?.name;
  }

  // Check if device is registered
  hasDevice(deviceId: string): boolean {
    return this.idToSerial.has(deviceId);
  }

  // Get all registered devices
  getAllDevices(): DeviceInfo[] {
    return Array.from(this.serialToDevice.values());
  }

  // Unregister device (e.g., on disconnect)
  unregisterDevice(deviceId: string): boolean {
    const serial = this.idToSerial.get(deviceId);
    if (serial === undefined) return false;

    this.serialToDevice.delete(serial);
    this.idToSerial.delete(deviceId);
    return true;
  }

  // Clear all registrations
  clear(): void {
    this.serialToDevice.clear();
    this.idToSerial.clear();
    this.nextSerial = 0;
  }

  // Get current device count
  getDeviceCount(): number {
    return this.serialToDevice.size;
  }
}