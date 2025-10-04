import { MESSAGE_TYPES, PROTOCOL, BaseMessage, MotionDataMessage, MessageType } from '../types';

interface BinaryHeader {
  version: number;
  messageType: number;
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
    if (buffer.byteLength < PROTOCOL.HEADER_SIZE) return null;
    const header = this.readHeader(buffer);
    if (!this.validateHeader(header)) return null;
    const payloadBuffer = buffer.slice(PROTOCOL.HEADER_SIZE);
    return this.deserializePayload(header.messageType as MessageType, payloadBuffer, header);
  }

  private static createHeader(message: BaseMessage): BinaryHeader {
    return {
      version: PROTOCOL.VERSION,
      messageType: message.type,
      payloadLength: 0,
      requestId: message.requestId || 0,
      timestamp: message.timestamp,
    };
  }

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

  private static readHeader(buffer: ArrayBuffer): BinaryHeader {
    const view = new DataView(buffer);
    let offset = 0;
    return {
      version: view.getUint8(offset++),
      messageType: view.getUint8(offset++),
      payloadLength: view.getUint16(offset, true),
      requestId: view.getUint32(offset + 2, true),
      timestamp: view.getUint32(offset + 6, true),
    };
  }

  private static writePayload(buffer: ArrayBuffer, payload: ArrayBuffer): void {
    const target = new Uint8Array(buffer, PROTOCOL.HEADER_SIZE);
    const source = new Uint8Array(payload);
    target.set(source);
    const view = new DataView(buffer);
    view.setUint16(2, payload.byteLength, true);
  }

  private static serializePayload(message: BaseMessage): ArrayBuffer {
    if (message.type === MESSAGE_TYPES.MOTION_DATA) {
      return this.serializeMotionData(message as MotionDataMessage);
    }
    if ([MESSAGE_TYPES.HEARTBEAT, MESSAGE_TYPES.PING, MESSAGE_TYPES.PONG].includes(message.type)) {
      return new ArrayBuffer(0);
    }
    return this.serializeJSON(message);
  }

  // Optimized motion data serialization using Float32Array
  private static serializeMotionData(message: MotionDataMessage): ArrayBuffer {
    const deviceName = message.deviceName || 'unknown';
    const deviceNameBytes = new TextEncoder().encode(deviceName);
    const deviceNameLength = deviceNameBytes.length;
    const data = message.data;
    const floatData = new Float32Array([
      data.left?.current || 0, data.left?.max || 0, data.left?.min || 0,
      data.right?.current || 0, data.right?.max || 0, data.right?.min || 0
    ]);
    const floatDataBytes = floatData.byteLength;
    const buffer = new ArrayBuffer(2 + deviceNameLength + floatDataBytes);
    const view = new DataView(buffer);
    let offset = 0;
    view.setUint16(offset, deviceNameLength, true);
    offset += 2;
    const nameArray = new Uint8Array(buffer, offset, deviceNameLength);
    nameArray.set(deviceNameBytes);
    offset += deviceNameLength;
    const floatArray = new Uint8Array(buffer, offset, floatDataBytes);
    floatArray.set(new Uint8Array(floatData.buffer));
    return buffer;
  }

  private static serializeJSON(message: BaseMessage): ArrayBuffer {
    const json = JSON.stringify(message);
    return new TextEncoder().encode(json).buffer;
  }

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
    if (messageType === MESSAGE_TYPES.MOTION_DATA) {
      return this.deserializeMotionData(payload, baseMessage);
    }
    if ([MESSAGE_TYPES.HEARTBEAT, MESSAGE_TYPES.PING, MESSAGE_TYPES.PONG].includes(messageType)) {
      return baseMessage;
    }
    return this.deserializeJSON(payload, baseMessage);
  }

  private static deserializeMotionData(
    payload: ArrayBuffer,
    baseMessage: BaseMessage
  ): MotionDataMessage | null {
    if (payload.byteLength < 2) return null;
    const view = new DataView(payload);
    let offset = 0;
    const deviceNameLength = view.getUint16(offset, true);
    offset += 2;
    if (payload.byteLength < 2 + deviceNameLength + 24) return null;
    const deviceNameBytes = new Uint8Array(payload, offset, deviceNameLength);
    const deviceName = new TextDecoder().decode(deviceNameBytes);
    offset += deviceNameLength;
    const floatBuffer = payload.slice(offset);
    const floatArray = new Float32Array(floatBuffer);
    const data = {
      left: { current: floatArray[0] || 0, max: floatArray[1] || 0, min: floatArray[2] || 0 },
      right: { current: floatArray[3] || 0, max: floatArray[4] || 0, min: floatArray[5] || 0 },
      timestamp: baseMessage.timestamp
    };
    return { ...baseMessage, type: MESSAGE_TYPES.MOTION_DATA, deviceName, data } as MotionDataMessage;
  }

  private static deserializeJSON(payload: ArrayBuffer, baseMessage: BaseMessage): BaseMessage | null {
    try {
      const json = new TextDecoder().decode(payload);
      const parsed = JSON.parse(json);
      return { ...baseMessage, ...parsed };
    } catch {
      return null;
    }
  }

  private static validateHeader(header: BinaryHeader): boolean {
    if (header.version !== PROTOCOL.VERSION) return false;
    if (header.payloadLength > PROTOCOL.MAX_PAYLOAD_SIZE) return false;
    return true;
  }
}
