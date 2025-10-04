import { PROTOCOL, MESSAGE_TYPES, BaseMessage, MotionDataMessage } from '../types';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export class MessageValidator {
  // Validate message size
  static validateSize(buffer: ArrayBuffer): ValidationResult {
    if (buffer.byteLength > PROTOCOL.MAX_PAYLOAD_SIZE) {
      return { valid: false, error: `Message exceeds max size: ${buffer.byteLength} > ${PROTOCOL.MAX_PAYLOAD_SIZE}` };
    }
    return { valid: true };
  }

  // Validate message content
  static validate(message: BaseMessage): ValidationResult {
    if (!message.type || !message.timestamp) {
      return { valid: false, error: 'Missing required fields: type or timestamp' };
    }
    if (message.requestId && message.requestId > PROTOCOL.MAX_REQUEST_ID) {
      return { valid: false, error: `RequestId exceeds maximum: ${message.requestId}` };
    }
    if (message.type === MESSAGE_TYPES.MOTION_DATA) {
      return this.validateMotionData(message as MotionDataMessage);
    }
    return { valid: true };
  }

  private static validateMotionData(message: MotionDataMessage): ValidationResult {
    if (!message.data) {
      return { valid: false, error: 'Motion data missing' };
    }
    const { data } = message;
    if (!data.left || !data.right ||
        typeof data.left.current !== 'number' ||
        typeof data.right.current !== 'number') {
      return { valid: false, error: 'Invalid motion data structure' };
    }
    return { valid: true };
  }
}
