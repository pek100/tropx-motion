import { MESSAGE_TYPES, PROTOCOL, MessageType } from '../types/MessageTypes';
import { BaseMessage, MotionDataMessage } from '../types/Interfaces';

// Binary message header structure (16 bytes total)
interface BinaryHeader {
  version: number;      // 1 byte
  messageType: number;  // 1 byte
  payloadLength: number;// 2 bytes
  requestId: number;    // 4 bytes
  timestamp: number;    // 8 bytes (Float64 for full ms-since-epoch)
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
    if (buffer.byteLength < PROTOCOL.HEADER_SIZE) {
      return null;
    }

    const header = this.readHeader(buffer);

    if (!this.validateHeader(header)) {
      return null;
    }

    const payloadBuffer = buffer.slice(PROTOCOL.HEADER_SIZE);
    const message = this.deserializePayload(header.messageType as MessageType, payloadBuffer, header);

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
    view.setFloat64(offset, header.timestamp, true); // Use Float64 for full timestamp
  }

  // Read header from buffer
  private static readHeader(buffer: ArrayBuffer): BinaryHeader {
    const view = new DataView(buffer);
    let offset = 0;

    return {
      version: view.getUint8(offset++),
      messageType: view.getUint8(offset++),
      payloadLength: view.getUint16(offset, true),
      requestId: view.getUint32(offset + 2, true),
      timestamp: view.getFloat64(offset + 6, true), // Use Float64 for full timestamp
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
        return this.serializeMotionData(message as MotionDataMessage);

      case MESSAGE_TYPES.HEARTBEAT:
      case MESSAGE_TYPES.PING:
      case MESSAGE_TYPES.PONG:
        return new ArrayBuffer(0); // No payload

      default:
        return this.serializeJSON(message);
    }
  }

  // Optimized motion data serialization using Float32Array
  private static serializeMotionData(message: MotionDataMessage): ArrayBuffer {
    const deviceName = message.deviceName || 'unknown';
    const deviceNameBytes = new TextEncoder().encode(deviceName);
    const deviceNameLength = deviceNameBytes.length;

    // Convert data to Float32Array if it's a plain object
    let floatData: Float32Array;
    if (message.data instanceof Float32Array) {
      floatData = message.data;
    } else {
      // Convert plain object to Float32Array [leftCurrent, rightCurrent]
      const data = message.data as any;
      floatData = new Float32Array([
        data.left?.current || 0,
        data.right?.current || 0
      ]);
    }

    const floatDataBytes = floatData.byteLength;

    // Structure: [deviceNameLength:2][deviceName:N][floatData:8] (2 floats * 4 bytes)
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
  private static deserializePayload(
    messageType: MessageType,
    payload: ArrayBuffer,
    header: BinaryHeader
  ): BaseMessage | null {
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

  // Optimized motion data deserialization to Float32Array
  private static deserializeMotionData(
    payload: ArrayBuffer,
    baseMessage: BaseMessage
  ): MotionDataMessage | null {
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

    // Convert Float32Array back to object format (only current values)
    const data = {
      left: {
        current: floatArray[0] || 0,
        max: 0,  // deprecated
        min: 0   // deprecated
      },
      right: {
        current: floatArray[1] || 0,
        max: 0,  // deprecated
        min: 0   // deprecated
      },
      timestamp: baseMessage.timestamp
    };

    return {
      ...baseMessage,
      type: MESSAGE_TYPES.MOTION_DATA,
      deviceName,
      data,
    } as MotionDataMessage;
  }

  // Fallback JSON deserialization
  private static deserializeJSON(payload: ArrayBuffer, baseMessage: BaseMessage): BaseMessage | null {
    try {
      const json = new TextDecoder().decode(payload);
      const parsed = JSON.parse(json);
      return { ...baseMessage, ...parsed };
    } catch {
      return null;
    }
  }

  // Validate header integrity
  private static validateHeader(header: BinaryHeader): boolean {
    if (header.version !== PROTOCOL.VERSION) return false;
    if (header.payloadLength > PROTOCOL.MAX_PAYLOAD_SIZE) return false;
    // Note: Allow unknown message types to pass through - MessageRouter will handle them

    return true;
  }

  // Calculate total message size for pre-allocation
  static calculateMessageSize(message: BaseMessage): number {
    const payload = this.serializePayload(message);
    return PROTOCOL.HEADER_SIZE + payload.byteLength;
  }

  // Validate message before serialization
  static validateMessage(message: BaseMessage): boolean {
    if (!message.type || !message.timestamp) return false;
    if (message.requestId && message.requestId > PROTOCOL.MAX_REQUEST_ID) return false;

    // Type-specific validation
    if (message.type === MESSAGE_TYPES.MOTION_DATA) {
      const motionMsg = message as MotionDataMessage;
      if (!motionMsg.data) return false;

      // Validate Float32Array format
      if (motionMsg.data instanceof Float32Array) {
        if (motionMsg.data.length !== 2) return false;
      }
      // Validate object format
      else {
        const data = motionMsg.data as any;
        if (!data.left || !data.right ||
            typeof data.left.current !== 'number' ||
            typeof data.right.current !== 'number') return false;
      }
    }

    return true;
  }
}