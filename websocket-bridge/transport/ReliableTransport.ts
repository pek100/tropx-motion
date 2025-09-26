import { BaseMessage, PendingRequest } from '../types/Interfaces';
import { MESSAGE_TYPES, PROTOCOL } from '../types/MessageTypes';

export interface ReliableTransportConfig {
  timeout: number;
  maxRetries: number;
  retryBackoff: number;
  enableDuplicateDetection: boolean;
}

export interface TransportStats {
  messagesSent: number;
  messagesAcked: number;
  messagesTimeout: number;
  retries: number;
  duplicates: number;
}

const DEFAULT_CONFIG: ReliableTransportConfig = {
  timeout: 5000,
  maxRetries: 3,
  retryBackoff: 1000,
  enableDuplicateDetection: true,
} as const;

export class ReliableTransport {
  private pendingRequests = new Map<string, Map<number, PendingRequest>>();
  private messageIdCounter = 1;
  private processedMessages = new Set<string>(); // For duplicate detection
  private stats: TransportStats;
  private config: ReliableTransportConfig;

  private sendFunction: ((message: BaseMessage, clientId: string) => Promise<boolean>) | null = null;

  constructor(config: Partial<ReliableTransportConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = {
      messagesSent: 0,
      messagesAcked: 0,
      messagesTimeout: 0,
      retries: 0,
      duplicates: 0,
    };
  }

  // Set send function (connection to WebSocket server)
  setSendFunction(sendFn: (message: BaseMessage, clientId: string) => Promise<boolean>): void {
    this.sendFunction = sendFn;
  }

  // Send message with reliable delivery guarantee
  async sendReliable(message: BaseMessage, clientId: string): Promise<BaseMessage> {
    if (!this.sendFunction) {
      throw new Error('Send function not configured');
    }

    const requestId = this.generateRequestId();
    const messageWithId: BaseMessage = {
      ...message,
      requestId,
      timestamp: Date.now(),
    };

    return new Promise<BaseMessage>((resolve, reject) => {
      let attempts = 0;

      const attemptSend = async () => {
        if (attempts > this.config.maxRetries) {
          this.cleanup(clientId, requestId);
          this.stats.messagesTimeout++;
          reject(new Error(`Message timeout after ${this.config.maxRetries + 1} attempts`));
          return;
        }

        attempts++;
        if (attempts > 1) {
          this.stats.retries++;
        }

        try {
          const success = await this.sendFunction!(messageWithId, clientId);
          if (!success) {
            throw new Error('Send failed');
          }

          this.stats.messagesSent++;

          // Set up timeout for this attempt
          const timeout = setTimeout(() => {
            console.warn(`Attempt ${attempts} timeout for request ${requestId}`);
            attemptSend(); // Retry
          }, this.config.timeout);

          // Store pending request
          this.storePendingRequest(clientId, requestId, {
            resolve: (response) => {
              this.cleanup(clientId, requestId);
              this.stats.messagesAcked++;
              resolve(response);
            },
            reject: (error) => {
              this.cleanup(clientId, requestId);
              reject(error);
            },
            timeout,
            timestamp: Date.now(),
          });

        } catch (error) {
          // Wait before retry
          setTimeout(attemptSend, this.config.retryBackoff * attempts);
        }
      };

      attemptSend();
    });
  }

  // Handle incoming response/acknowledgment
  handleResponse(message: BaseMessage, clientId: string): boolean {
    const requestId = message.requestId;
    if (!requestId) return false;

    // Check for duplicates
    if (this.config.enableDuplicateDetection) {
      const messageKey = `${clientId}_${requestId}_${message.type}`;
      if (this.processedMessages.has(messageKey)) {
        this.stats.duplicates++;
        console.warn(`Duplicate message detected: ${messageKey}`);
        return true; // Handled (as duplicate)
      }
      this.processedMessages.add(messageKey);
    }

    const clientRequests = this.pendingRequests.get(clientId);
    if (!clientRequests) return false;

    const pendingRequest = clientRequests.get(requestId);
    if (!pendingRequest) return false;

    // Handle ACK message
    if (message.type === MESSAGE_TYPES.ACK) {
      pendingRequest.resolve(message);
      return true;
    }

    // Handle error response
    if (message.type === MESSAGE_TYPES.ERROR) {
      const errorMessage = (message as any).message || 'Unknown error';
      pendingRequest.reject(new Error(errorMessage));
      return true;
    }

    // Handle other response types
    pendingRequest.resolve(message);
    return true;
  }

  // Handle client disconnection
  handleDisconnection(clientId: string): void {
    const clientRequests = this.pendingRequests.get(clientId);
    if (!clientRequests) return;

    // Reject all pending requests for this client
    clientRequests.forEach((request) => {
      clearTimeout(request.timeout);
      request.reject(new Error('Client disconnected'));
    });

    this.pendingRequests.delete(clientId);
    console.log(`Cleaned up ${clientRequests.size} pending requests for disconnected client: ${clientId}`);
  }

  // Get transport statistics
  getStats(): TransportStats {
    return { ...this.stats };
  }

  // Get number of pending requests
  getPendingCount(clientId?: string): number {
    if (clientId) {
      return this.pendingRequests.get(clientId)?.size || 0;
    }

    let total = 0;
    this.pendingRequests.forEach((requests) => {
      total += requests.size;
    });
    return total;
  }

  // Check if request is pending
  isPending(clientId: string, requestId: number): boolean {
    return this.pendingRequests.get(clientId)?.has(requestId) || false;
  }

  // Cancel pending request
  cancelRequest(clientId: string, requestId: number): boolean {
    const clientRequests = this.pendingRequests.get(clientId);
    if (!clientRequests) return false;

    const request = clientRequests.get(requestId);
    if (!request) return false;

    clearTimeout(request.timeout);
    request.reject(new Error('Request cancelled'));
    clientRequests.delete(requestId);

    return true;
  }

  // Cleanup expired requests periodically
  performCleanup(): void {
    const now = Date.now();
    const expiredThreshold = this.config.timeout * (this.config.maxRetries + 1) * 2; // 2x total timeout

    this.pendingRequests.forEach((clientRequests, clientId) => {
      const expiredRequests: number[] = [];

      clientRequests.forEach((request, requestId) => {
        if (now - request.timestamp > expiredThreshold) {
          expiredRequests.push(requestId);
          clearTimeout(request.timeout);
          request.reject(new Error('Request expired during cleanup'));
        }
      });

      expiredRequests.forEach((requestId) => {
        clientRequests.delete(requestId);
      });

      if (clientRequests.size === 0) {
        this.pendingRequests.delete(clientId);
      }
    });

    // Cleanup processed messages (keep last 1000)
    if (this.processedMessages.size > 1000) {
      const messages = Array.from(this.processedMessages);
      this.processedMessages.clear();
      // Keep the most recent 500
      messages.slice(-500).forEach(msg => this.processedMessages.add(msg));
    }
  }

  // Reset statistics
  resetStats(): void {
    this.stats = {
      messagesSent: 0,
      messagesAcked: 0,
      messagesTimeout: 0,
      retries: 0,
      duplicates: 0,
    };
  }

  // Get configuration
  getConfig(): ReliableTransportConfig {
    return { ...this.config };
  }

  // Update configuration
  updateConfig(config: Partial<ReliableTransportConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // Generate unique request ID
  private generateRequestId(): number {
    this.messageIdCounter = (this.messageIdCounter % PROTOCOL.MAX_REQUEST_ID) + 1;
    return this.messageIdCounter;
  }

  // Store pending request
  private storePendingRequest(clientId: string, requestId: number, request: PendingRequest): void {
    let clientRequests = this.pendingRequests.get(clientId);
    if (!clientRequests) {
      clientRequests = new Map();
      this.pendingRequests.set(clientId, clientRequests);
    }

    clientRequests.set(requestId, request);
  }

  // Cleanup specific request
  private cleanup(clientId: string, requestId: number): void {
    const clientRequests = this.pendingRequests.get(clientId);
    if (!clientRequests) return;

    const request = clientRequests.get(requestId);
    if (request) {
      clearTimeout(request.timeout);
      clientRequests.delete(requestId);

      if (clientRequests.size === 0) {
        this.pendingRequests.delete(clientId);
      }
    }
  }
}