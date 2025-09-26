import { MessageType, DELIVERY_MODES } from '../types/MessageTypes';
import { BaseMessage, MessageHandler, MessageRoute, TransportConfig } from '../types/Interfaces';

export interface RouterConfig {
  defaultTimeout: number;
  defaultRetries: number;
  enableLogging: boolean;
}

export interface RouteStats {
  messageType: MessageType;
  handleCount: number;
  errorCount: number;
  averageProcessingTime: number;
  lastProcessed: number;
}

const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  defaultTimeout: 5000,
  defaultRetries: 3,
  enableLogging: true,
} as const;

export class MessageRouter {
  private routes = new Map<MessageType, MessageRoute>();
  private routeStats = new Map<MessageType, RouteStats>();
  private config: RouterConfig;

  private fallbackHandler: MessageHandler | null = null;
  private errorHandler: ((error: Error, message: BaseMessage, clientId: string) => void) | null = null;

  constructor(config: Partial<RouterConfig> = {}) {
    this.config = { ...DEFAULT_ROUTER_CONFIG, ...config };
  }

  // Register message handler for specific message type
  register(messageType: MessageType, handler: MessageHandler, config?: Partial<TransportConfig>): void {
    const transportConfig: TransportConfig = {
      deliveryMode: DELIVERY_MODES.RELIABLE,
      timeout: this.config.defaultTimeout,
      maxRetries: this.config.defaultRetries,
      ...config,
    };

    const route: MessageRoute = {
      messageType,
      handler,
      config: transportConfig,
    };

    this.routes.set(messageType, route);
    this.initializeStats(messageType);

    if (this.config.enableLogging) {
      console.log(`Registered handler for message type: ${messageType} (${this.getMessageTypeName(messageType)})`);
    }
  }

  // Unregister handler for message type
  unregister(messageType: MessageType): boolean {
    const removed = this.routes.delete(messageType);
    this.routeStats.delete(messageType);

    if (removed && this.config.enableLogging) {
      console.log(`Unregistered handler for message type: ${messageType}`);
    }

    return removed;
  }

  // Set fallback handler for unregistered message types
  setFallbackHandler(handler: MessageHandler): void {
    this.fallbackHandler = handler;
  }

  // Set error handler for routing errors
  setErrorHandler(handler: (error: Error, message: BaseMessage, clientId: string) => void): void {
    this.errorHandler = handler;
  }

  // Route message to appropriate handler
  async route(message: BaseMessage, clientId: string): Promise<BaseMessage | void> {
    console.log(`🔀 MessageRouter.route: message type ${message.type}, clientId ${clientId}`);
    const startTime = Date.now();

    try {
      const route = this.routes.get(message.type);
      console.log(`🔀 Found route for message type ${message.type}:`, !!route);

      if (route) {
        console.log(`🔀 Executing handler for message type ${message.type}`);
        const result = await this.executeHandler(route, message, clientId);
        console.log(`🔀 Handler result for message type ${message.type}:`, !!result);
        this.updateStats(message.type, startTime, false);
        return result;
      }

      // Try fallback handler
      if (this.fallbackHandler) {
        const result = await this.fallbackHandler(message, clientId);
        this.updateStats(message.type, startTime, false);
        return result;
      }

      // No handler found
      const error = new Error(`No handler registered for message type: ${message.type}`);
      this.handleError(error, message, clientId);
      this.updateStats(message.type, startTime, true);

    } catch (error) {
      this.handleError(error as Error, message, clientId);
      this.updateStats(message.type, startTime, true);
      throw error;
    }
  }

  // Get route configuration for message type
  getRouteConfig(messageType: MessageType): TransportConfig | null {
    const route = this.routes.get(messageType);
    return route?.config || null;
  }

  // Check if message type has registered handler
  hasHandler(messageType: MessageType): boolean {
    return this.routes.has(messageType);
  }

  // Get all registered message types
  getRegisteredTypes(): MessageType[] {
    return Array.from(this.routes.keys());
  }

  // Get routing statistics
  getStats(): RouteStats[] {
    return Array.from(this.routeStats.values());
  }

  // Get statistics for specific message type
  getStatsForType(messageType: MessageType): RouteStats | null {
    return this.routeStats.get(messageType) || null;
  }

  // Clear all routes and statistics
  clear(): void {
    this.routes.clear();
    this.routeStats.clear();
    this.fallbackHandler = null;
    this.errorHandler = null;

    if (this.config.enableLogging) {
      console.log('Message router cleared');
    }
  }

  // Get total number of registered routes
  getRouteCount(): number {
    return this.routes.size;
  }

  // Check if router is configured properly
  isConfigured(): boolean {
    return this.routes.size > 0 || this.fallbackHandler !== null;
  }

  // Execute handler with timeout and retry logic
  private async executeHandler(route: MessageRoute, message: BaseMessage, clientId: string): Promise<BaseMessage | void> {
    const { handler, config } = route;

    let lastError: Error | null = null;
    let attempts = 0;

    while (attempts <= config.maxRetries) {
      try {
        // Create timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Handler timeout after ${config.timeout}ms`));
          }, config.timeout);
        });

        // Race handler execution against timeout
        const result = await Promise.race([
          handler(message, clientId),
          timeoutPromise,
        ]);

        return result;

      } catch (error) {
        lastError = error as Error;
        attempts++;

        if (attempts <= config.maxRetries) {
          const delay = this.calculateRetryDelay(attempts);
          await this.sleep(delay);

          if (this.config.enableLogging) {
            console.warn(`Handler retry ${attempts}/${config.maxRetries} for message type ${message.type}: ${lastError.message}`);
          }
        }
      }
    }

    // All retries exhausted
    throw new Error(`Handler failed after ${config.maxRetries + 1} attempts: ${lastError?.message}`);
  }

  // Calculate exponential backoff delay
  private calculateRetryDelay(attempt: number): number {
    return Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Max 5 second delay
  }

  // Sleep for specified milliseconds
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Handle routing errors
  private handleError(error: Error, message: BaseMessage, clientId: string): void {
    if (this.config.enableLogging) {
      console.error(`Routing error for message type ${message.type}:`, error);
    }

    this.errorHandler?.(error, message, clientId);
  }

  // Initialize statistics for message type
  private initializeStats(messageType: MessageType): void {
    this.routeStats.set(messageType, {
      messageType,
      handleCount: 0,
      errorCount: 0,
      averageProcessingTime: 0,
      lastProcessed: 0,
    });
  }

  // Update statistics after handler execution
  private updateStats(messageType: MessageType, startTime: number, isError: boolean): void {
    const stats = this.routeStats.get(messageType);
    if (!stats) return;

    const processingTime = Date.now() - startTime;

    if (isError) {
      stats.errorCount++;
    } else {
      stats.handleCount++;
      stats.averageProcessingTime = stats.handleCount === 1
        ? processingTime
        : (stats.averageProcessingTime * (stats.handleCount - 1) + processingTime) / stats.handleCount;
    }

    stats.lastProcessed = Date.now();
  }

  // Get human-readable message type name (for logging)
  private getMessageTypeName(messageType: MessageType): string {
    // This could be expanded to include a mapping of type codes to names
    return `0x${messageType.toString(16).padStart(2, '0')}`;
  }

  // Validate route configuration
  private validateRouteConfig(config: TransportConfig): boolean {
    if (config.timeout <= 0) return false;
    if (config.maxRetries < 0) return false;
    if (!Object.values(DELIVERY_MODES).includes(config.deliveryMode)) return false;

    return true;
  }

  // Register multiple handlers at once
  registerBatch(handlers: Array<{ type: MessageType; handler: MessageHandler; config?: Partial<TransportConfig> }>): void {
    handlers.forEach(({ type, handler, config }) => {
      this.register(type, handler, config);
    });

    if (this.config.enableLogging) {
      console.log(`Registered ${handlers.length} handlers in batch`);
    }
  }

  // Get performance summary
  getPerformanceSummary(): { totalHandled: number; totalErrors: number; averageTime: number } {
    const stats = Array.from(this.routeStats.values());

    const totalHandled = stats.reduce((sum, stat) => sum + stat.handleCount, 0);
    const totalErrors = stats.reduce((sum, stat) => sum + stat.errorCount, 0);
    const averageTime = stats.length > 0
      ? stats.reduce((sum, stat) => sum + stat.averageProcessingTime, 0) / stats.length
      : 0;

    return { totalHandled, totalErrors, averageTime };
  }
}