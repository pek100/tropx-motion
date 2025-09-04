/**
 * Device State Machine for reliable BLE device lifecycle management
 * Implements finite state automaton with strict transition validation
 */

import { 
  DeviceState, 
  DeviceEvent, 
  StateTransition, 
  DeviceContext,
  AppError,
  ErrorContext
} from './types';
import { ERROR_CODES, PERFORMANCE_CONSTANTS } from './constants';

export class DeviceStateMachine {
  private readonly transitions: Map<string, StateTransition>;
  private readonly stateHistory: Array<{ state: DeviceState; timestamp: number }>;
  private readonly eventListeners: Map<DeviceState, Set<(context: DeviceContext) => void>>;
  
  constructor() {
    this.transitions = new Map();
    this.stateHistory = [];
    this.eventListeners = new Map();
    this.initializeTransitions();
  }

  /**
   * Initialize all valid state transitions with guards and actions
   */
  private initializeTransitions(): void {
    const transitions: StateTransition[] = [
      // From SCANNING
      {
        from: DeviceState.SCANNING,
        to: DeviceState.DISCONNECTED_AVAILABLE,
        event: DeviceEvent.DEVICE_FOUND,
      },
      {
        from: DeviceState.SCANNING,
        to: DeviceState.ERROR,
        event: DeviceEvent.ERROR_OCCURRED,
      },

      // From DISCONNECTED_AVAILABLE
      {
        from: DeviceState.DISCONNECTED_AVAILABLE,
        to: DeviceState.CONNECTING,
        event: DeviceEvent.CONNECT_REQUEST,
        guard: (context) => !!context.device,
      },
      {
        from: DeviceState.DISCONNECTED_AVAILABLE,
        to: DeviceState.SCANNING,
        event: DeviceEvent.SCAN_START,
      },

      // From CONNECTING
      {
        from: DeviceState.CONNECTING,
        to: DeviceState.CONNECTED_IDLE,
        event: DeviceEvent.CONNECTED,
        guard: (context) => !!context.connection?.server?.connected,
      },
      {
        from: DeviceState.CONNECTING,
        to: DeviceState.ERROR,
        event: DeviceEvent.ERROR_OCCURRED,
      },
      {
        from: DeviceState.CONNECTING,
        to: DeviceState.DISCONNECTED_AVAILABLE,
        event: DeviceEvent.RETRY_CONNECTION,
        guard: (context) => (context.metadata?.retryCount ?? 0) < PERFORMANCE_CONSTANTS.MAX_RETRY_ATTEMPTS,
      },

      // From CONNECTED_IDLE
      {
        from: DeviceState.CONNECTED_IDLE,
        to: DeviceState.STREAMING,
        event: DeviceEvent.STREAM_START,
        guard: (context) => !!context.connection?.characteristics?.data,
      },
      {
        from: DeviceState.CONNECTED_IDLE,
        to: DeviceState.DISCONNECTED_AVAILABLE,
        event: DeviceEvent.DISCONNECT,
      },
      {
        from: DeviceState.CONNECTED_IDLE,
        to: DeviceState.ERROR,
        event: DeviceEvent.ERROR_OCCURRED,
      },

      // From STREAMING
      {
        from: DeviceState.STREAMING,
        to: DeviceState.CONNECTED_IDLE,
        event: DeviceEvent.STREAM_STOP,
      },
      {
        from: DeviceState.STREAMING,
        to: DeviceState.DISCONNECTED_AVAILABLE,
        event: DeviceEvent.DISCONNECT,
      },
      {
        from: DeviceState.STREAMING,
        to: DeviceState.ERROR,
        event: DeviceEvent.ERROR_OCCURRED,
      },

      // From ERROR
      {
        from: DeviceState.ERROR,
        to: DeviceState.DISCONNECTED_AVAILABLE,
        event: DeviceEvent.RETRY_CONNECTION,
      },
      {
        from: DeviceState.ERROR,
        to: DeviceState.SCANNING,
        event: DeviceEvent.SCAN_START,
      },
    ];

    // Build transition lookup map for O(1) access
    transitions.forEach(transition => {
      const key = this.getTransitionKey(transition.from, transition.event);
      this.transitions.set(key, transition);
    });
  }

  /**
   * Attempt state transition with validation and side effects
   */
  async transition(
    currentState: DeviceState,
    event: DeviceEvent,
    context: DeviceContext
  ): Promise<DeviceState> {
    const key = this.getTransitionKey(currentState, event);
    const transition = this.transitions.get(key);

    if (!transition) {
      throw this.createError(
        ERROR_CODES.DEVICE_DISCONNECTED,
        `Invalid transition: ${currentState} + ${event}`,
        { currentState, event, deviceId: context.deviceId }
      );
    }

    // Validate guard condition
    if (transition.guard && !transition.guard(context)) {
      throw this.createError(
        ERROR_CODES.CONNECTION_FAILED,
        `Guard condition failed for transition: ${currentState} → ${transition.to}`,
        { currentState, event, deviceId: context.deviceId }
      );
    }

    // Execute transition action
    if (transition.action) {
      try {
        await transition.action(context);
      } catch (error) {
        throw this.createError(
          ERROR_CODES.CONNECTION_FAILED,
          `Action failed during transition: ${currentState} → ${transition.to}`,
          { currentState, event, deviceId: context.deviceId, originalError: error }
        );
      }
    }

    // Record state change
    this.recordStateChange(transition.to);
    
    // Notify listeners
    this.notifyListeners(transition.to, context);

    return transition.to;
  }

  /**
   * Check if transition is valid without executing it
   */
  canTransition(currentState: DeviceState, event: DeviceEvent, context?: DeviceContext): boolean {
    const key = this.getTransitionKey(currentState, event);
    const transition = this.transitions.get(key);
    
    if (!transition) return false;
    if (!transition.guard) return true;
    if (!context) return false;
    
    return transition.guard(context);
  }

  /**
   * Get all possible next states from current state
   */
  getPossibleTransitions(currentState: DeviceState): Array<{ event: DeviceEvent; nextState: DeviceState }> {
    const possibleTransitions: Array<{ event: DeviceEvent; nextState: DeviceState }> = [];
    
    this.transitions.forEach(transition => {
      if (transition.from === currentState) {
        possibleTransitions.push({
          event: transition.event,
          nextState: transition.to
        });
      }
    });
    
    return possibleTransitions;
  }

  /**
   * Subscribe to state change events
   */
  onStateChange(state: DeviceState, callback: (context: DeviceContext) => void): () => void {
    if (!this.eventListeners.has(state)) {
      this.eventListeners.set(state, new Set());
    }
    
    const listeners = this.eventListeners.get(state)!;
    listeners.add(callback);
    
    // Return unsubscribe function
    return () => {
      listeners.delete(callback);
      if (listeners.size === 0) {
        this.eventListeners.delete(state);
      }
    };
  }

  /**
   * Get state history for debugging and analytics
   */
  getStateHistory(): Array<{ state: DeviceState; timestamp: number }> {
    return [...this.stateHistory];
  }

  /**
   * Reset state machine (useful for testing)
   */
  reset(): void {
    this.stateHistory.length = 0;
    this.eventListeners.clear();
  }

  // Private helper methods
  private getTransitionKey(from: DeviceState, event: DeviceEvent): string {
    return `${from}:${event}`;
  }

  private recordStateChange(state: DeviceState): void {
    this.stateHistory.push({
      state,
      timestamp: performance.now()
    });
    
    // Keep only recent history to prevent memory leaks
    const maxHistorySize = 100;
    if (this.stateHistory.length > maxHistorySize) {
      this.stateHistory.splice(0, this.stateHistory.length - maxHistorySize);
    }
  }

  private notifyListeners(state: DeviceState, context: DeviceContext): void {
    const listeners = this.eventListeners.get(state);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(context);
        } catch (error) {
          console.error(`State change listener error for state ${state}:`, error);
        }
      });
    }
  }

  private createError(
    code: keyof typeof ERROR_CODES,
    message: string,
    context: ErrorContext
  ): AppError {
    return {
      code,
      message,
      timestamp: Date.now(),
      deviceId: context.deviceId,
      context,
    };
  }
}

/**
 * Singleton instance for global state machine management
 */
export const deviceStateMachine = new DeviceStateMachine();