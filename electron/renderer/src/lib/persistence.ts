// Define the shape of our persisted state
export interface PersistedAppState {
  // UI Preferences
  deviceOrder: string[];
  smallScreenOverride: boolean | null;
  clientDisplay: 'closed' | 'modal' | 'minimized' | 'snapped-left' | 'snapped-right';

  // Session Recovery
  wasStreaming: boolean;
  streamingSessionId: string | null;
  lastConnectedDeviceIds: string[];
  streamStartTime: number | null;

  // Metadata
  lastSavedAt: number;
}

// Default state
const defaultState: PersistedAppState = {
  deviceOrder: [],
  smallScreenOverride: null,
  clientDisplay: 'closed',
  wasStreaming: false,
  streamingSessionId: null,
  lastConnectedDeviceIds: [],
  streamStartTime: null,
  lastSavedAt: Date.now(),
};

// localStorage key
const STORAGE_KEY = 'tropx-motion-state';

/**
 * Persistence Manager - handles saving and loading app state
 */
export class PersistenceManager {
  private saveDebounceTimer: NodeJS.Timeout | null = null;
  private readonly DEBOUNCE_MS = 500;

  /**
   * Load persisted state from localStorage
   */
  loadState(): PersistedAppState {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        return defaultState;
      }

      const state: PersistedAppState = JSON.parse(stored);

      // Check if state is stale (older than 24 hours)
      const now = Date.now();
      const ageMs = now - (state.lastSavedAt || 0);
      const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

      if (ageMs > MAX_AGE_MS) {
        console.log('⏰ Persisted state is stale (>24h), clearing session recovery data');
        return {
          ...state,
          wasStreaming: false,
          streamingSessionId: null,
          lastConnectedDeviceIds: [],
          streamStartTime: null,
          lastSavedAt: now,
        };
      }

      console.log('✅ Loaded persisted state from localStorage:', state);
      return state;
    } catch (error) {
      console.error('❌ Failed to load persisted state:', error);
      return defaultState;
    }
  }

  /**
   * Save state to localStorage (debounced)
   */
  saveState(partialState: Partial<PersistedAppState>): void {
    // Clear existing debounce timer
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }

    // Schedule debounced save
    this.saveDebounceTimer = setTimeout(() => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        const currentState = stored ? JSON.parse(stored) : defaultState;
        const newState: PersistedAppState = {
          ...currentState,
          ...partialState,
          lastSavedAt: Date.now(),
        };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
        console.log('💾 Saved state to localStorage:', partialState);
      } catch (error) {
        console.error('❌ Failed to save state:', error);
      }

      this.saveDebounceTimer = null;
    }, this.DEBOUNCE_MS);
  }

  /**
   * Immediately save state (skip debounce)
   * Use for critical operations like beforeunload
   */
  saveStateImmediate(partialState: Partial<PersistedAppState>): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const currentState = stored ? JSON.parse(stored) : defaultState;
      const newState: PersistedAppState = {
        ...currentState,
        ...partialState,
        lastSavedAt: Date.now(),
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
      console.log('💾 Immediately saved state to localStorage:', partialState);
    } catch (error) {
      console.error('❌ Failed to immediately save state:', error);
    }
  }

  /**
   * Update device order
   */
  saveDeviceOrder(order: string[]): void {
    this.saveState({ deviceOrder: order });
  }

  /**
   * Update screen size preference
   */
  saveScreenPreference(override: boolean | null): void {
    this.saveState({ smallScreenOverride: override });
  }

  /**
   * Update client display mode (RPi only)
   */
  saveClientDisplay(mode: 'closed' | 'modal' | 'minimized' | 'snapped-left' | 'snapped-right'): void {
    this.saveState({ clientDisplay: mode });
  }

  /**
   * Save streaming session state
   */
  saveStreamingSession(
    isStreaming: boolean,
    connectedDeviceIds: string[],
    sessionId: string | null = null,
    startTime: number | null = null
  ): void {
    this.saveStateImmediate({
      wasStreaming: isStreaming,
      lastConnectedDeviceIds: isStreaming ? connectedDeviceIds : [],
      streamingSessionId: sessionId,
      streamStartTime: startTime,
    });
  }

  /**
   * Clear session recovery data (called after successful recovery or user dismissal)
   */
  clearSessionRecovery(): void {
    this.saveStateImmediate({
      wasStreaming: false,
      streamingSessionId: null,
      lastConnectedDeviceIds: [],
      streamStartTime: null,
    });
  }

  /**
   * Reset all persisted state to defaults
   */
  resetState(): void {
    localStorage.removeItem(STORAGE_KEY);
    console.log('🔄 Reset all persisted state to defaults');
  }
}

// Export singleton instance
export const persistence = new PersistenceManager();
