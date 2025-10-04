import { MESSAGE_TYPES, ERROR_CODES, PROTOCOL } from '../types/MessageTypes';
import {
  BaseMessage,
  BLEScanRequest,
  BLEConnectRequest,
  RecordStartRequest,
  MotionDataMessage,
  ErrorMessage,
} from '../types/Interfaces';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  code?: number;
}

export class MessageValidator {
  // Validate any message type
  static validate(message: unknown): ValidationResult {
    if (!this.isValidBaseStructure(message)) {
      return { valid: false, error: 'Invalid message structure', code: ERROR_CODES.INVALID_MESSAGE };
    }

    const baseMessage = message as BaseMessage;

    // Validate common fields
    const baseValidation = this.validateBaseMessage(baseMessage);
    if (!baseValidation.valid) return baseValidation;

    // Type-specific validation
    return this.validateMessageType(baseMessage);
  }

  // Validate base message structure
  private static validateBaseMessage(message: BaseMessage): ValidationResult {
    if (!Number.isInteger(message.type) || message.type < 0 || message.type > 255) {
      return { valid: false, error: 'Invalid message type', code: ERROR_CODES.INVALID_MESSAGE };
    }

    if (!Number.isInteger(message.timestamp) || message.timestamp <= 0) {
      return { valid: false, error: 'Invalid timestamp', code: ERROR_CODES.INVALID_MESSAGE };
    }

    if (message.requestId !== undefined) {
      if (!Number.isInteger(message.requestId) || message.requestId < 0 || message.requestId > PROTOCOL.MAX_REQUEST_ID) {
        return { valid: false, error: 'Invalid request ID', code: ERROR_CODES.INVALID_MESSAGE };
      }
    }

    return { valid: true };
  }

  // Type-specific validation dispatcher
  private static validateMessageType(message: BaseMessage): ValidationResult {
    switch (message.type) {
      case MESSAGE_TYPES.BLE_SCAN_REQUEST:
        return this.validateBLEScanRequest(message as BLEScanRequest);

      case MESSAGE_TYPES.BLE_CONNECT_REQUEST:
        return this.validateBLEConnectRequest(message as BLEConnectRequest);

      case MESSAGE_TYPES.BLE_DISCONNECT_REQUEST:
        return { valid: true }; // deviceId validated in base message

      case MESSAGE_TYPES.BLE_SYNC_REQUEST:
        return { valid: true }; // No additional validation needed

      case MESSAGE_TYPES.RECORD_START_REQUEST:
        return this.validateRecordStartRequest(message as RecordStartRequest);

      case MESSAGE_TYPES.RECORD_STOP_REQUEST:
        return { valid: true }; // No additional validation needed

      case MESSAGE_TYPES.MOTION_DATA:
        return this.validateMotionData(message as MotionDataMessage);

      case MESSAGE_TYPES.ERROR:
        return this.validateErrorMessage(message as ErrorMessage);

      case MESSAGE_TYPES.HEARTBEAT:
      case MESSAGE_TYPES.PING:
      case MESSAGE_TYPES.PONG:
        return { valid: true }; // No additional validation needed

      default:
        return { valid: false, error: 'Unknown message type', code: ERROR_CODES.INVALID_MESSAGE };
    }
  }

  // BLE scan request validation
  private static validateBLEScanRequest(message: BLEScanRequest): ValidationResult {
    if (!message.requestId) {
      return { valid: false, error: 'BLE scan request requires requestId', code: ERROR_CODES.INVALID_MESSAGE };
    }
    return { valid: true };
  }

  // BLE connect request validation
  private static validateBLEConnectRequest(message: BLEConnectRequest): ValidationResult {
    if (!message.requestId) {
      return { valid: false, error: 'BLE connect request requires requestId', code: ERROR_CODES.INVALID_MESSAGE };
    }

    if (!message.deviceId || typeof message.deviceId !== 'string' || message.deviceId.trim().length === 0) {
      return { valid: false, error: 'Invalid device ID', code: ERROR_CODES.INVALID_MESSAGE };
    }

    if (!message.deviceName || typeof message.deviceName !== 'string' || message.deviceName.trim().length === 0) {
      return { valid: false, error: 'Invalid device name', code: ERROR_CODES.INVALID_MESSAGE };
    }

    return { valid: true };
  }

  // Record start request validation
  private static validateRecordStartRequest(message: RecordStartRequest): ValidationResult {
    if (!message.requestId) {
      return { valid: false, error: 'Record start request requires requestId', code: ERROR_CODES.INVALID_MESSAGE };
    }

    if (!message.sessionId || typeof message.sessionId !== 'string' || message.sessionId.trim().length === 0) {
      return { valid: false, error: 'Invalid session ID', code: ERROR_CODES.INVALID_MESSAGE };
    }

    if (!message.exerciseId || typeof message.exerciseId !== 'string' || message.exerciseId.trim().length === 0) {
      return { valid: false, error: 'Invalid exercise ID', code: ERROR_CODES.INVALID_MESSAGE };
    }

    if (!Number.isInteger(message.setNumber) || message.setNumber < 1) {
      return { valid: false, error: 'Invalid set number', code: ERROR_CODES.INVALID_MESSAGE };
    }

    return { valid: true };
  }

  // Motion data validation (Float32Array specific)
  private static validateMotionData(message: MotionDataMessage): ValidationResult {
    if (!message.deviceName || typeof message.deviceName !== 'string' || message.deviceName.trim().length === 0) {
      return { valid: false, error: 'Invalid device name', code: ERROR_CODES.INVALID_MESSAGE };
    }

    if (!(message.data instanceof Float32Array)) {
      return { valid: false, error: 'Motion data must be Float32Array', code: ERROR_CODES.INVALID_MESSAGE };
    }

    if (message.data.length !== 6) {
      return { valid: false, error: 'Motion data must contain exactly 6 values', code: ERROR_CODES.INVALID_MESSAGE };
    }

    // Validate float values are not NaN or infinite
    for (let i = 0; i < message.data.length; i++) {
      if (!Number.isFinite(message.data[i])) {
        return { valid: false, error: `Invalid motion value at index ${i}`, code: ERROR_CODES.INVALID_MESSAGE };
      }
    }

    return { valid: true };
  }

  // Error message validation
  private static validateErrorMessage(message: ErrorMessage): ValidationResult {
    if (!Object.values(ERROR_CODES).includes(message.code)) {
      return { valid: false, error: 'Invalid error code', code: ERROR_CODES.INVALID_MESSAGE };
    }

    if (!message.message || typeof message.message !== 'string' || message.message.trim().length === 0) {
      return { valid: false, error: 'Invalid error message', code: ERROR_CODES.INVALID_MESSAGE };
    }

    return { valid: true };
  }

  // Check if object has valid base message structure
  private static isValidBaseStructure(message: unknown): boolean {
    if (!message || typeof message !== 'object') return false;

    const msg = message as Record<string, unknown>;
    return (
      typeof msg.type === 'number' &&
      typeof msg.timestamp === 'number' &&
      (msg.requestId === undefined || typeof msg.requestId === 'number')
    );
  }

  // Validate message size constraints
  static validateSize(buffer: ArrayBuffer): ValidationResult {
    if (buffer.byteLength > PROTOCOL.HEADER_SIZE + PROTOCOL.MAX_PAYLOAD_SIZE) {
      return { valid: false, error: 'Message exceeds maximum size', code: ERROR_CODES.INVALID_MESSAGE };
    }

    if (buffer.byteLength < PROTOCOL.HEADER_SIZE) {
      return { valid: false, error: 'Message too small', code: ERROR_CODES.INVALID_MESSAGE };
    }

    return { valid: true };
  }

  // Validate protocol version
  static validateVersion(version: number): ValidationResult {
    if (version !== PROTOCOL.VERSION) {
      return { valid: false, error: `Unsupported protocol version ${version}`, code: ERROR_CODES.INVALID_MESSAGE };
    }
    return { valid: true };
  }

  // Create validation error message
  static createErrorMessage(validation: ValidationResult, requestId?: number): ErrorMessage {
    return {
      type: MESSAGE_TYPES.ERROR,
      code: (validation.code || ERROR_CODES.INVALID_MESSAGE) as import('../types/MessageTypes').ErrorCode,
      message: validation.error || 'Unknown validation error',
      requestId,
      timestamp: Date.now(),
    };
  }
}