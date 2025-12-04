import { MessageType, MESSAGE_TYPES, ERROR_CODES } from '../types/MessageTypes';
import { BaseMessage, ErrorMessage } from '../types/Interfaces';

// Domain classification constants
export const MESSAGE_DOMAINS = {
  BLE: 'ble',
  STREAMING: 'streaming',
  SYSTEM: 'system',
  CLIENT_METADATA: 'client_metadata'
} as const;

export type MessageDomain = typeof MESSAGE_DOMAINS[keyof typeof MESSAGE_DOMAINS];

// Domain ranges for message classification
const DOMAIN_RANGES = {
  [MESSAGE_DOMAINS.BLE]: { min: 0x10, max: 0x2F }, // scan/connect (0x10-0x1F), recording (0x20-0x2F)
  [MESSAGE_DOMAINS.STREAMING]: { min: 0x30, max: 0x3F }, // motion (0x30), status (0x31), battery (0x32), sync (0x33-0x36)
  [MESSAGE_DOMAINS.CLIENT_METADATA]: { min: 0x60, max: 0x6F }, // client registration/actions (0x60-0x6F)
  [MESSAGE_DOMAINS.SYSTEM]: [0x01, 0x02, 0x03, 0x50, 0x51, 0x52, 0xF0, 0xF1, 0xF2]
} as const;

// Domain processor interface
export interface DomainProcessor {
  process(message: BaseMessage, clientId: string): Promise<BaseMessage | void>;
  getDomain(): MessageDomain;
}

// Unified message router using Command pattern
export class UnifiedMessageRouter {
  private processors = new Map<MessageDomain, DomainProcessor>();
  private stats = {
    totalProcessed: 0,
    errors: 0,
    domainCounts: new Map<MessageDomain, number>()
  };

  // Register domain processor
  registerProcessor(processor: DomainProcessor): void {
    this.processors.set(processor.getDomain(), processor);
    this.stats.domainCounts.set(processor.getDomain(), 0);
  }

  // Route message to appropriate domain processor
  async route(message: BaseMessage, clientId: string): Promise<BaseMessage | void> {
    const domain = this.classifyMessage(message.type);
    if (!domain) {
      this.stats.errors++;
      return this.createErrorResponse(message, 'UNKNOWN_MESSAGE_DOMAIN');
    }

    const processor = this.processors.get(domain);
    if (!processor) {
      this.stats.errors++;
      return this.createErrorResponse(message, 'NO_PROCESSOR_FOR_DOMAIN');
    }

    try {
      this.stats.totalProcessed++;
      this.incrementDomainCount(domain);

      return await processor.process(message, clientId);
    } catch (error) {
      this.stats.errors++;
      console.error(`Domain processor error [${domain}]:`, error);
      return this.createErrorResponse(message, 'PROCESSOR_ERROR');
    }
  }

  // Classify message type into domain
  private classifyMessage(messageType: MessageType): MessageDomain | null {
    // Check BLE domain (0x10-0x2F)
    const bleRange = DOMAIN_RANGES[MESSAGE_DOMAINS.BLE];
    if (messageType >= bleRange.min && messageType <= bleRange.max) {
      return MESSAGE_DOMAINS.BLE;
    }

    // Check Streaming domain (0x30-0x3F)
    const streamingRange = DOMAIN_RANGES[MESSAGE_DOMAINS.STREAMING];
    if (messageType >= streamingRange.min && messageType <= streamingRange.max) {
      return MESSAGE_DOMAINS.STREAMING;
    }

    // Check Client Metadata domain (0x60-0x6F)
    const clientMetadataRange = DOMAIN_RANGES[MESSAGE_DOMAINS.CLIENT_METADATA];
    if (messageType >= clientMetadataRange.min && messageType <= clientMetadataRange.max) {
      return MESSAGE_DOMAINS.CLIENT_METADATA;
    }

    // Check System domain (specific types)
    const systemTypes = DOMAIN_RANGES[MESSAGE_DOMAINS.SYSTEM] as readonly number[];
    if (systemTypes.includes(messageType as number)) {
      return MESSAGE_DOMAINS.SYSTEM;
    }

    return null;
  }

  // Create standardized error response
  private createErrorResponse(message: BaseMessage, errorCode: string): ErrorMessage {
    return {
      type: MESSAGE_TYPES.ERROR,
      requestId: message.requestId,
      timestamp: Date.now(),
      code: ERROR_CODES.INVALID_MESSAGE,
      message: `Message routing failed: ${errorCode}`,
      details: { messageType: message.type }
    };
  }

  // Increment domain processing count
  private incrementDomainCount(domain: MessageDomain): void {
    const current = this.stats.domainCounts.get(domain) || 0;
    this.stats.domainCounts.set(domain, current + 1);
  }

  // Get routing statistics
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  // Reset statistics
  resetStats(): void {
    this.stats.totalProcessed = 0;
    this.stats.errors = 0;
    this.stats.domainCounts.clear();
  }
}