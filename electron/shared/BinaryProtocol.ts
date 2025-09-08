// Unified Binary Protocol for all WebSocket messages
// Extremely efficient, single protocol for maximum performance

export const BINARY_PROTOCOL = {
  // Message type constants
  MESSAGE_TYPES: {
    HEARTBEAT: 0x01,
    STATUS_UPDATE: 0x02,
    DEVICE_STATUS: 0x03,
    DEVICE_SCAN_RESULT: 0x04,
    MOTION_DATA: 0x05,
    RECORDING_STATE: 0x06,
    ERROR: 0x07,
    BATTERY_UPDATE: 0x08,
    SCAN_REQUEST: 0x09,
  },

  // Header structure (8 bytes)
  HEADER_SIZE: 8,
  VERSION: 1,
  
  // Maximum payload sizes for different message types
  MAX_PAYLOAD: {
    HEARTBEAT: 8,
    STATUS_UPDATE: 512,
    DEVICE_STATUS: 1024,
    DEVICE_SCAN_RESULT: 2048,
    MOTION_DATA: 32,
    RECORDING_STATE: 64,
    ERROR: 256,
    BATTERY_UPDATE: 128,
    SCAN_REQUEST: 64,
  },
} as const;

// Binary message header structure
interface BinaryHeader {
  version: number;        // 1 byte
  messageType: number;    // 1 byte
  payloadLength: number;  // 2 bytes
  timestamp: number;      // 4 bytes
}

export class UnifiedBinaryProtocol {
  // Serialize any message to binary format
  static serialize(messageType: string, data: unknown, timestamp: number = Date.now()): Buffer {
    const typeCode = this.getMessageTypeCode(messageType);
    if (typeCode === 0) {
      throw new Error(`Unknown message type: ${messageType}`);
    }

    const payload = this.serializePayload(typeCode, data);
    const totalSize = BINARY_PROTOCOL.HEADER_SIZE + payload.length;
    const buffer = Buffer.allocUnsafe(totalSize);

    // Write header
    let offset = 0;
    buffer.writeUInt8(BINARY_PROTOCOL.VERSION, offset++);
    buffer.writeUInt8(typeCode, offset++);
    buffer.writeUInt16LE(payload.length, offset);
    offset += 2;
    buffer.writeUInt32LE(timestamp & 0xFFFFFFFF, offset);
    offset += 4;

    // Write payload
    payload.copy(buffer, offset);

    return buffer;
  }

  // Deserialize binary data to message
  static deserialize(buffer: ArrayBuffer): { type: string; data: unknown; timestamp: number } | null {
    if (buffer.byteLength < BINARY_PROTOCOL.HEADER_SIZE) return null;

    const view = new DataView(buffer);
    let offset = 0;

    // Read header
    const version = view.getUint8(offset++);
    if (version !== BINARY_PROTOCOL.VERSION) return null;

    const messageType = view.getUint8(offset++);
    const payloadLength = view.getUint16(offset, true);
    offset += 2;
    const timestamp = view.getUint32(offset, true);
    offset += 4;

    if (buffer.byteLength !== BINARY_PROTOCOL.HEADER_SIZE + payloadLength) return null;

    // Read payload
    const payloadBuffer = buffer.slice(offset);
    const data = this.deserializePayload(messageType, payloadBuffer);
    const type = this.getMessageTypeName(messageType);

    if (!type || data === null) return null;

    return { type, data, timestamp };
  }

  // Get message type code from string
  private static getMessageTypeCode(messageType: string): number {
    const mapping: Record<string, number> = {
      'heartbeat': BINARY_PROTOCOL.MESSAGE_TYPES.HEARTBEAT,
      'status_update': BINARY_PROTOCOL.MESSAGE_TYPES.STATUS_UPDATE,
      'device_status': BINARY_PROTOCOL.MESSAGE_TYPES.DEVICE_STATUS,
      'device_scan_result': BINARY_PROTOCOL.MESSAGE_TYPES.DEVICE_SCAN_RESULT,
      'motion_data': BINARY_PROTOCOL.MESSAGE_TYPES.MOTION_DATA,
      'recording_state': BINARY_PROTOCOL.MESSAGE_TYPES.RECORDING_STATE,
      'error': BINARY_PROTOCOL.MESSAGE_TYPES.ERROR,
      'battery_update': BINARY_PROTOCOL.MESSAGE_TYPES.BATTERY_UPDATE,
      'scan_request': BINARY_PROTOCOL.MESSAGE_TYPES.SCAN_REQUEST,
    };
    return mapping[messageType] || 0;
  }

  // Get message type name from code
  private static getMessageTypeName(typeCode: number): string | null {
    const mapping: Record<number, string> = {
      [BINARY_PROTOCOL.MESSAGE_TYPES.HEARTBEAT]: 'heartbeat',
      [BINARY_PROTOCOL.MESSAGE_TYPES.STATUS_UPDATE]: 'status_update',
      [BINARY_PROTOCOL.MESSAGE_TYPES.DEVICE_STATUS]: 'device_status',
      [BINARY_PROTOCOL.MESSAGE_TYPES.DEVICE_SCAN_RESULT]: 'device_scan_result',
      [BINARY_PROTOCOL.MESSAGE_TYPES.MOTION_DATA]: 'motion_data',
      [BINARY_PROTOCOL.MESSAGE_TYPES.RECORDING_STATE]: 'recording_state',
      [BINARY_PROTOCOL.MESSAGE_TYPES.ERROR]: 'error',
      [BINARY_PROTOCOL.MESSAGE_TYPES.BATTERY_UPDATE]: 'battery_update',
      [BINARY_PROTOCOL.MESSAGE_TYPES.SCAN_REQUEST]: 'scan_request',
    };
    return mapping[typeCode] || null;
  }

  // Serialize payload based on message type
  private static serializePayload(messageType: number, data: unknown): Buffer {
    switch (messageType) {
      case BINARY_PROTOCOL.MESSAGE_TYPES.MOTION_DATA:
        return this.serializeMotionData(data as any);
      
      case BINARY_PROTOCOL.MESSAGE_TYPES.HEARTBEAT:
        return this.serializeHeartbeat(data as any);
      
      case BINARY_PROTOCOL.MESSAGE_TYPES.DEVICE_STATUS:
        return this.serializeDeviceStatus(data as any);
      
      case BINARY_PROTOCOL.MESSAGE_TYPES.DEVICE_SCAN_RESULT:
        return this.serializeDeviceScanResult(data as any);
      
      case BINARY_PROTOCOL.MESSAGE_TYPES.RECORDING_STATE:
        return this.serializeRecordingState(data as any);
      
      default:
        // Fallback: JSON for complex messages
        return Buffer.from(JSON.stringify(data), 'utf8');
    }
  }

  // Deserialize payload based on message type
  private static deserializePayload(messageType: number, buffer: ArrayBuffer): unknown {
    switch (messageType) {
      case BINARY_PROTOCOL.MESSAGE_TYPES.MOTION_DATA:
        return this.deserializeMotionData(buffer);
      
      case BINARY_PROTOCOL.MESSAGE_TYPES.HEARTBEAT:
        return this.deserializeHeartbeat(buffer);
      
      case BINARY_PROTOCOL.MESSAGE_TYPES.DEVICE_STATUS:
        return this.deserializeDeviceStatus(buffer);
      
      case BINARY_PROTOCOL.MESSAGE_TYPES.DEVICE_SCAN_RESULT:
        return this.deserializeDeviceScanResult(buffer);
      
      case BINARY_PROTOCOL.MESSAGE_TYPES.RECORDING_STATE:
        return this.deserializeRecordingState(buffer);
      
      default:
        // Fallback: JSON for complex messages
        try {
          const text = new TextDecoder().decode(buffer);
          return JSON.parse(text);
        } catch {
          return null;
        }
    }
  }

  // Motion data serialization (24 bytes) - Optimized with Float32Array
  private static serializeMotionData(data: any): Buffer {
    // Use Float32Array for optimal performance - single allocation and copy
    const floatArray = new Float32Array([
      data.left?.current || 0,
      data.left?.max || 0, 
      data.left?.min || 0,
      data.right?.current || 0,
      data.right?.max || 0,
      data.right?.min || 0
    ]);
    
    // Convert Float32Array buffer to Node.js Buffer
    return Buffer.from(floatArray.buffer);
  }

  // Motion data deserialization
  private static deserializeMotionData(buffer: ArrayBuffer): unknown {
    if (buffer.byteLength !== 24) return null;

    const view = new DataView(buffer);
    let offset = 0;

    const left = {
      current: view.getFloat32(offset, true),
      max: view.getFloat32(offset + 4, true),
      min: view.getFloat32(offset + 8, true),
      rom: 0
    };
    offset += 12;
    left.rom = Math.abs(left.max - left.min);

    const right = {
      current: view.getFloat32(offset, true),
      max: view.getFloat32(offset + 4, true),
      min: view.getFloat32(offset + 8, true),
      rom: 0
    };
    right.rom = Math.abs(right.max - right.min);

    return { left, right, timestamp: Date.now() };
  }

  // Heartbeat serialization (8 bytes)
  private static serializeHeartbeat(data: any): Buffer {
    const buffer = Buffer.allocUnsafe(8);
    buffer.writeBigUInt64LE(BigInt(data.timestamp || Date.now()), 0);
    return buffer;
  }

  // Heartbeat deserialization
  private static deserializeHeartbeat(buffer: ArrayBuffer): unknown {
    if (buffer.byteLength !== 8) return null;
    const view = new DataView(buffer);
    return { timestamp: Number(view.getBigUint64(0, true)) };
  }

  // Device status serialization
  private static serializeDeviceStatus(data: any): Buffer {
    // Use compact JSON for complex structures
    return Buffer.from(JSON.stringify(data), 'utf8');
  }

  // Device status deserialization
  private static deserializeDeviceStatus(buffer: ArrayBuffer): unknown {
    try {
      const text = new TextDecoder().decode(buffer);
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  // Device scan result serialization
  private static serializeDeviceScanResult(data: any): Buffer {
    return Buffer.from(JSON.stringify(data), 'utf8');
  }

  // Device scan result deserialization
  private static deserializeDeviceScanResult(buffer: ArrayBuffer): unknown {
    try {
      const text = new TextDecoder().decode(buffer);
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  // Recording state serialization (16 bytes)
  private static serializeRecordingState(data: any): Buffer {
    const buffer = Buffer.allocUnsafe(16);
    let offset = 0;

    buffer.writeUInt8(data.isRecording ? 1 : 0, offset++);
    buffer.writeUInt8(0, offset++); // padding
    buffer.writeUInt16LE(0, offset); // padding
    offset += 2;

    const startTime = data.startTime ? new Date(data.startTime).getTime() : 0;
    buffer.writeBigUInt64LE(BigInt(startTime), offset);
    offset += 8;

    return buffer;
  }

  // Recording state deserialization
  private static deserializeRecordingState(buffer: ArrayBuffer): unknown {
    if (buffer.byteLength !== 16) return null;

    const view = new DataView(buffer);
    const isRecording = view.getUint8(0) === 1;
    const startTime = Number(view.getBigUint64(4, true));

    return {
      isRecording,
      startTime: startTime > 0 ? new Date(startTime).toISOString() : undefined
    };
  }
}