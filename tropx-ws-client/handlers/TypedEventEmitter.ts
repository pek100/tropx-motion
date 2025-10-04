import type { EventType, EventHandler, EventPayloadMap } from '../types';

// Type-safe event emitter
export class TypedEventEmitter {
  private handlers = new Map<EventType, Set<EventHandler<any>>>();

  // Register event handler
  on<E extends EventType>(event: E, handler: EventHandler<E>): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  // Remove event handler
  off<E extends EventType>(event: E, handler: EventHandler<E>): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.handlers.delete(event);
      }
    }
  }

  // Register one-time event handler
  once<E extends EventType>(event: E, handler: EventHandler<E>): void {
    const wrappedHandler = ((payload: EventPayloadMap[E]) => {
      handler(payload);
      this.off(event, wrappedHandler);
    }) as EventHandler<E>;
    this.on(event, wrappedHandler);
  }

  // Emit event with payload
  emit<E extends EventType>(event: E, payload: EventPayloadMap[E]): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(payload);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }

  // Remove all handlers
  removeAllListeners(event?: EventType): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }

  // Get listener count
  listenerCount(event: EventType): number {
    return this.handlers.get(event)?.size || 0;
  }
}
