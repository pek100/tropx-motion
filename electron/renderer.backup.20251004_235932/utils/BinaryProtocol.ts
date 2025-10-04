/**
 * @deprecated This file is deprecated. Use TropxWSClient from tropx-ws-client instead.
 * @see /tropx-ws-client/README.md for migration guide
 * @see /tropx-ws-client/MIGRATION_GUIDE.md for detailed migration steps
 */

// Browser-compatible Binary Protocol for WebSocket Bridge communication
// Based on websocket-bridge/protocol/BinaryProtocol.ts but without Node.js dependencies

// Message type constants (matches websocket-bridge/types/MessageTypes.ts)
export const MESSAGE_TYPES = {
  // System messages
  HEARTBEAT: 0x01,
  ERROR: 0x02,
  STATUS: 0x03,

  // BLE operations (reliable delivery required)
  BLE_SCAN_REQUEST: 0x10,
  BLE_SCAN_RESPONSE: 0x11,
  BLE_CONNECT_REQUEST: 0x12,
  BLE_CONNECT_RESPONSE: 0x13,
  BLE_DISCONNECT_REQUEST: 0x14,
  BLE_DISCONNECT_RESPONSE: 0x15,
  BLE_SYNC_REQUEST: 0x16,
  BLE_SYNC_RESPONSE: 0x17,

  // Broadcast messages (from original WebSocket service)
  SCAN_REQUEST: 0x40,

  // Recording operations (reliable delivery required)
  RECORD_START_REQUEST: 0x20,
  RECORD_START_RESPONSE: 0x21,
  RECORD_STOP_REQUEST: 0x22,
  RECORD_STOP_RESPONSE: 0x23,

  // Streaming data (fire-and-forget by default)
  MOTION_DATA: 0x30,
  DEVICE_STATUS: 0x31,
  BATTERY_UPDATE: 0x32,

  // Internal protocol
  ACK: 0xF0,
  PING: 0xF1,
  PONG: 0xF2,
} as const;

export type MessageType = typeof MESSAGE_TYPES[keyof typeof MESSAGE_TYPES];

// Protocol constants (matches websocket-bridge/types/MessageTypes.ts)
export const PROTOCOL = {
  VERSION: 1,
  HEADER_SIZE: 12,
  MAX_PAYLOAD_SIZE: 65535,
  DEFAULT_TIMEOUT: 5000,
  MAX_REQUEST_ID: 0xFFFFFFFF,
} as const;

// Base message interface
export interface BaseMessage {
  type: MessageType;
  requestId?: number;
  timestamp: number;
  [key: string]: any;
}

// Binary header structure
interface BinaryHeader {
  version: number;
  messageType: MessageType;
  payloadLength: number;
  requestId: number;
  timestamp: number;
}

export class BinaryProtocol {
  // Serialize message to binary format
  static serialize(message: BaseMessage): ArrayBuffer {
    const header = this.createHeader(message);
    const payload = this.serializePayload(message);

    const buffer = new ArrayBuffer(PROTOCOL.HEADER_SIZE + payload.byteLength);
    this.writeHeader(buffer, header);
    this.writePayload(buffer, payload);

    return buffer;
  }

  // Deserialize binary data to message
  static deserialize(buffer: ArrayBuffer): BaseMessage | null {
    // DISABLED for performance - called at 100Hz × 2 devices = 200 times/sec
    // console.log(`🔍 BinaryProtocol.deserialize: buffer length=${buffer.byteLength}, expected min=${PROTOCOL.HEADER_SIZE}`);

    if (buffer.byteLength < PROTOCOL.HEADER_SIZE) {
      // Keep error logs for debugging
      console.log(`❌ Buffer too small: ${buffer.byteLength} < ${PROTOCOL.HEADER_SIZE}`);
      return null;
    }

    const header = this.readHeader(buffer);
    // DISABLED for performance
    // console.log(`🔍 Read header:`, header);

    if (!this.validateHeader(header)) {
      // Keep error logs for debugging
      console.log(`❌ Header validation failed`);
      return null;
    }

    const payloadBuffer = buffer.slice(PROTOCOL.HEADER_SIZE);
    // DISABLED for performance
    // console.log(`🔍 Payload buffer length: ${payloadBuffer.byteLength}`);

    const message = this.deserializePayload(header.messageType, payloadBuffer, header);
    // DISABLED for performance
    // if (message) {
    //   console.log(`✅ Successfully deserialized message type: ${message.type}`);
    // } else {
    //   console.log(`❌ Payload deserialization failed for message type: ${header.messageType}`);
    // }

    return message;
  }

  // Create message header
  private static createHeader(message: BaseMessage): BinaryHeader {
    return {
      version: PROTOCOL.VERSION,
      messageType: message.type,
      payloadLength: 0, // Will be set after payload serialization
      requestId: message.requestId || 0,
      timestamp: message.timestamp,
    };
  }

  // Write header to buffer
  private static writeHeader(buffer: ArrayBuffer, header: BinaryHeader): void {
    const view = new DataView(buffer);
    let offset = 0;

    view.setUint8(offset++, header.version);
    view.setUint8(offset++, header.messageType);
    view.setUint16(offset, header.payloadLength, true);
    offset += 2;
    view.setUint32(offset, header.requestId, true);
    offset += 4;
    view.setUint32(offset, header.timestamp, true);
  }

  // Read header from buffer
  private static readHeader(buffer: ArrayBuffer): BinaryHeader {
    const view = new DataView(buffer);
    let offset = 0;

    return {
      version: view.getUint8(offset++),
      messageType: view.getUint8(offset++) as MessageType,
      payloadLength: view.getUint16(offset, true),
      requestId: view.getUint32(offset + 2, true),
      timestamp: view.getUint32(offset + 6, true),
    };
  }

  // Write payload to buffer
  private static writePayload(buffer: ArrayBuffer, payload: ArrayBuffer): void {
    const target = new Uint8Array(buffer, PROTOCOL.HEADER_SIZE);
    const source = new Uint8Array(payload);
    target.set(source);

    // Update payload length in header
    const view = new DataView(buffer);
    view.setUint16(2, payload.byteLength, true);
  }

  // Serialize payload based on message type
  private static serializePayload(message: BaseMessage): ArrayBuffer {
    switch (message.type) {
      case MESSAGE_TYPES.MOTION_DATA:
        return this.serializeMotionData(message);
      case MESSAGE_TYPES.HEARTBEAT:
      case MESSAGE_TYPES.PING:
      case MESSAGE_TYPES.PONG:
        return new ArrayBuffer(0); // No payload
      default:
        return this.serializeJSON(message);
    }
  }

  // Optimized motion data serialization
  private static serializeMotionData(message: BaseMessage): ArrayBuffer {
    const deviceName = message.deviceName || 'unknown';
    const deviceNameBytes = new TextEncoder().encode(deviceName);
    const deviceNameLength = deviceNameBytes.length;

    // Convert data to Float32Array if it's a plain object
    let floatData: Float32Array;
    if (message.data instanceof Float32Array) {
      floatData = message.data;
    } else {
      // Convert plain object to Float32Array [left.current, left.max, left.min, right.current, right.max, right.min]
      const data = message.data as any;
      floatData = new Float32Array([
        data.left?.current || 0,
        data.left?.max || 0,
        data.left?.min || 0,
        data.right?.current || 0,
        data.right?.max || 0,
        data.right?.min || 0
      ]);
    }

    const floatDataBytes = floatData.byteLength;

    // Structure: [deviceNameLength:2][deviceName:N][floatData:24]
    const buffer = new ArrayBuffer(2 + deviceNameLength + floatDataBytes);
    const view = new DataView(buffer);
    let offset = 0;

    // Write device name length
    view.setUint16(offset, deviceNameLength, true);
    offset += 2;

    // Write device name
    const nameArray = new Uint8Array(buffer, offset, deviceNameLength);
    nameArray.set(deviceNameBytes);
    offset += deviceNameLength;

    // Write float data directly
    const floatArray = new Uint8Array(buffer, offset, floatDataBytes);
    floatArray.set(new Uint8Array(floatData.buffer));

    return buffer;
  }

  // Fallback JSON serialization for complex messages
  private static serializeJSON(message: BaseMessage): ArrayBuffer {
    const json = JSON.stringify(message);
    return new TextEncoder().encode(json).buffer;
  }

  // Deserialize payload based on message type
  private static deserializePayload(messageType: MessageType, payload: ArrayBuffer, header: BinaryHeader): BaseMessage | null {
    const baseMessage: BaseMessage = {
      type: messageType,
      requestId: header.requestId || undefined,
      timestamp: header.timestamp,
    };

    switch (messageType) {
      case MESSAGE_TYPES.MOTION_DATA:
        return this.deserializeMotionData(payload, baseMessage);
      case MESSAGE_TYPES.HEARTBEAT:
      case MESSAGE_TYPES.PING:
      case MESSAGE_TYPES.PONG:
        return baseMessage;
      default:
        return this.deserializeJSON(payload, baseMessage);
    }
  }

  // Optimized motion data deserialization
  private static deserializeMotionData(payload: ArrayBuffer, baseMessage: BaseMessage): BaseMessage | null {
    if (payload.byteLength < 2) return null;

    const view = new DataView(payload);
    let offset = 0;

    // Read device name length
    const deviceNameLength = view.getUint16(offset, true);
    offset += 2;

    if (payload.byteLength < 2 + deviceNameLength + 24) return null;

    // Read device name
    const deviceNameBytes = new Uint8Array(payload, offset, deviceNameLength);
    const deviceName = new TextDecoder().decode(deviceNameBytes);
    offset += deviceNameLength;

    // Read float data and convert back to object format
    const floatBuffer = payload.slice(offset);
    const floatArray = new Float32Array(floatBuffer);

    // Convert Float32Array back to object format
    const data = {
      left: {
        current: floatArray[0] || 0,
        max: floatArray[1] || 0,
        min: floatArray[2] || 0
      },
      right: {
        current: floatArray[3] || 0,
        max: floatArray[4] || 0,
        min: floatArray[5] || 0
      },
      timestamp: baseMessage.timestamp
    };

    return {
      ...baseMessage,
      type: MESSAGE_TYPES.MOTION_DATA,
      deviceName,
      data,
    };
  }

  // Fallback JSON deserialization
  private static deserializeJSON(payload: ArrayBuffer, baseMessage: BaseMessage): BaseMessage | null {
    try {
      const json = new TextDecoder().decode(payload);
      // DISABLED for performance
      // console.log(`🔍 JSON payload string:`, json);
      const parsed = JSON.parse(json);
      // DISABLED for performance
      // console.log(`🔍 Parsed JSON:`, parsed);
      const result = { ...baseMessage, ...parsed };
      // DISABLED for performance
      // console.log(`🔍 Final merged message:`, result);
      return result;
    } catch (error) {
      console.error(`❌ JSON deserialization failed:`, error);
      return null;
    }
  }

  // Validate header integrity
  private static validateHeader(header: BinaryHeader): boolean {
    if (header.version !== PROTOCOL.VERSION) return false;
    if (header.payloadLength > PROTOCOL.MAX_PAYLOAD_SIZE) return false;
    // Note: Allow unknown message types to pass through - application layer will handle them

    return true;
  }

  // Validate message before serialization
  static validateMessage(message: BaseMessage): boolean {
    if (!message.type || !message.timestamp) return false;
    if (message.requestId && message.requestId > PROTOCOL.MAX_REQUEST_ID) return false;

    // Type-specific validation
    if (message.type === MESSAGE_TYPES.MOTION_DATA) {
      if (!message.data) return false;

      // Validate Float32Array format
      if (message.data instanceof Float32Array) {
        if (message.data.length !== 6) return false;
      } else {
        // Validate object format
        const data = message.data as any;
        if (!data.left || !data.right ||
            typeof data.left.current !== 'number' ||
            typeof data.right.current !== 'number') return false;
      }
    }

    return true;
  }
}