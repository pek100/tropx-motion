/**
 * Optimized Binary Protocol for Quaternion-only Data Streaming
 *
 * Highly efficient protocol for real-time quaternion transmission:
 * - Header: 8 bytes (version, type, timestamp)
 * - Payload: 16 bytes (4 x float32 quaternion components)
 * - Total: 24 bytes per quaternion packet
 */

import { MotionData, Quaternion } from './BleBridgeTypes';

export const QUATERNION_PROTOCOL = {
  VERSION: 2,
  HEADER_SIZE: 8,
  QUATERNION_SIZE: 16,  // 4 x float32
  TOTAL_SIZE: 24,       // Header + quaternion

  MESSAGE_TYPE: {
    QUATERNION_DATA: 0x30,
    DEVICE_STATUS: 0x31,
    BATTERY_UPDATE: 0x32
  }
} as const;

export class QuaternionBinaryProtocol {
  // Serialize quaternion motion data to binary
  static serializeQuaternionData(deviceId: string, motionData: MotionData): Buffer {
    const buffer = Buffer.allocUnsafe(QUATERNION_PROTOCOL.TOTAL_SIZE);
    let offset = 0;

    // Header (8 bytes)
    buffer.writeUInt8(QUATERNION_PROTOCOL.VERSION, offset++);
    buffer.writeUInt8(QUATERNION_PROTOCOL.MESSAGE_TYPE.QUATERNION_DATA, offset++);
    buffer.writeUInt16LE(QUATERNION_PROTOCOL.QUATERNION_SIZE, offset);
    offset += 2;
    buffer.writeUInt32LE((motionData.timestamp & 0xFFFFFFFF) >>> 0, offset);
    offset += 4;

    // Quaternion payload (16 bytes) - Float32Array for precision
    const quaternionArray = new Float32Array([
      motionData.quaternion.w,
      motionData.quaternion.x,
      motionData.quaternion.y,
      motionData.quaternion.z
    ]);

    // Copy Float32Array bytes to buffer
    const quaternionBuffer = Buffer.from(quaternionArray.buffer);
    quaternionBuffer.copy(buffer, offset);

    return buffer;
  }

  // Deserialize binary data to quaternion motion data
  static deserializeQuaternionData(buffer: ArrayBuffer): { deviceId: string; motionData: MotionData } | null {
    if (buffer.byteLength !== QUATERNION_PROTOCOL.TOTAL_SIZE) {
      console.warn(`Invalid quaternion packet size: ${buffer.byteLength}, expected: ${QUATERNION_PROTOCOL.TOTAL_SIZE}`);
      return null;
    }

    const view = new DataView(buffer);
    let offset = 0;

    // Read header
    const version = view.getUint8(offset++);
    if (version !== QUATERNION_PROTOCOL.VERSION) {
      console.warn(`Unsupported protocol version: ${version}`);
      return null;
    }

    const messageType = view.getUint8(offset++);
    if (messageType !== QUATERNION_PROTOCOL.MESSAGE_TYPE.QUATERNION_DATA) {
      console.warn(`Invalid message type: ${messageType}`);
      return null;
    }

    const payloadSize = view.getUint16(offset, true);
    offset += 2;

    if (payloadSize !== QUATERNION_PROTOCOL.QUATERNION_SIZE) {
      console.warn(`Invalid payload size: ${payloadSize}`);
      return null;
    }

    const timestamp = view.getUint32(offset, true);
    offset += 4;

    // Read quaternion components (Float32 little-endian)
    const quaternion: Quaternion = {
      w: view.getFloat32(offset, true),
      x: view.getFloat32(offset + 4, true),
      y: view.getFloat32(offset + 8, true),
      z: view.getFloat32(offset + 12, true)
    };

    const motionData: MotionData = {
      timestamp,
      quaternion
    };

    return {
      deviceId: 'unknown', // Will be set by caller based on connection
      motionData
    };
  }

  // Serialize device status update
  static serializeDeviceStatus(devices: any[], batteryLevels: Record<string, number>): Buffer {
    const jsonData = JSON.stringify({
      connectedDevices: devices,
      batteryLevels,
      timestamp: Date.now()
    });

    const payloadBuffer = Buffer.from(jsonData, 'utf8');
    const totalSize = QUATERNION_PROTOCOL.HEADER_SIZE + payloadBuffer.length;
    const buffer = Buffer.allocUnsafe(totalSize);

    let offset = 0;

    // Header
    buffer.writeUInt8(QUATERNION_PROTOCOL.VERSION, offset++);
    buffer.writeUInt8(QUATERNION_PROTOCOL.MESSAGE_TYPE.DEVICE_STATUS, offset++);
    buffer.writeUInt16LE(payloadBuffer.length, offset);
    offset += 2;
    buffer.writeUInt32LE((Date.now() & 0xFFFFFFFF) >>> 0, offset);
    offset += 4;

    // Payload
    payloadBuffer.copy(buffer, offset);

    return buffer;
  }

  // Serialize battery update
  static serializeBatteryUpdate(deviceId: string, batteryLevel: number): Buffer {
    const jsonData = JSON.stringify({
      deviceId,
      batteryLevel,
      timestamp: Date.now()
    });

    const payloadBuffer = Buffer.from(jsonData, 'utf8');
    const totalSize = QUATERNION_PROTOCOL.HEADER_SIZE + payloadBuffer.length;
    const buffer = Buffer.allocUnsafe(totalSize);

    let offset = 0;

    // Header
    buffer.writeUInt8(QUATERNION_PROTOCOL.VERSION, offset++);
    buffer.writeUInt8(QUATERNION_PROTOCOL.MESSAGE_TYPE.BATTERY_UPDATE, offset++);
    buffer.writeUInt16LE(payloadBuffer.length, offset);
    offset += 2;
    buffer.writeUInt32LE((Date.now() & 0xFFFFFFFF) >>> 0, offset);
    offset += 4;

    // Payload
    payloadBuffer.copy(buffer, offset);

    return buffer;
  }

  // Get message type from buffer
  static getMessageType(buffer: ArrayBuffer): number | null {
    if (buffer.byteLength < QUATERNION_PROTOCOL.HEADER_SIZE) return null;

    const view = new DataView(buffer);
    const version = view.getUint8(0);

    if (version !== QUATERNION_PROTOCOL.VERSION) return null;

    return view.getUint8(1);
  }

  // Validate buffer structure
  static validateBuffer(buffer: ArrayBuffer): boolean {
    if (buffer.byteLength < QUATERNION_PROTOCOL.HEADER_SIZE) return false;

    const view = new DataView(buffer);
    const version = view.getUint8(0);
    const messageType = view.getUint8(1);
    const payloadSize = view.getUint16(2, true);

    // Check version
    if (version !== QUATERNION_PROTOCOL.VERSION) return false;

    // Check total size matches expected
    const expectedSize = QUATERNION_PROTOCOL.HEADER_SIZE + payloadSize;
    if (buffer.byteLength !== expectedSize) return false;

    // Check valid message type
    const validTypes = Object.values(QUATERNION_PROTOCOL.MESSAGE_TYPE) as number[];
    if (!validTypes.includes(messageType)) return false;

    return true;
  }

  // Create performance stats for monitoring
  static createPerformanceStats() {
    return {
      packetsSerializedCount: 0,
      packetsDeserializedCount: 0,
      bytesSerializedTotal: 0,
      bytesDeserializedTotal: 0,
      lastPacketTimestamp: 0,

      recordSerialization: function(buffer: Buffer) {
        this.packetsSerializedCount++;
        this.bytesSerializedTotal += buffer.length;
        this.lastPacketTimestamp = Date.now();
      },

      recordDeserialization: function(buffer: ArrayBuffer) {
        this.packetsDeserializedCount++;
        this.bytesDeserializedTotal += buffer.byteLength;
      },

      getBandwidthUsage: function(): { packetsPerSecond: number; bytesPerSecond: number } {
        const now = Date.now();
        const timeDiff = (now - this.lastPacketTimestamp) / 1000;

        return {
          packetsPerSecond: this.packetsSerializedCount / Math.max(timeDiff, 1),
          bytesPerSecond: this.bytesSerializedTotal / Math.max(timeDiff, 1)
        };
      }
    };
  }
}