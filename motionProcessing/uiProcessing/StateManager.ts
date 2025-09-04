interface SubscriberOptions {
    throttleMs?: number;
    immediate?: boolean;
}

interface SubscriberEntry {
    callback: (state: Map<string, any>) => void;
    options?: SubscriberOptions;
}

/**
 * Generic state management utility for handling application state with subscriber notifications.
 * Supports throttling and immediate notification options for flexible state update patterns.
 */
export class StateManager {
    private currentState: Map<string, any> | null = null;
    private subscribers = new Map<string, SubscriberEntry>();
    private stateVersion = 0;

    /**
     * Updates current state and notifies all subscribers.
     */
    saveState(state: Map<string, any>): void {
        this.currentState = state;
        this.stateVersion++;
        this.notifySubscribers();
    }

    /**
     * Returns current state map or null if no state has been set.
     */
    getState(): Map<string, any> | null {
        return this.currentState;
    }

    /**
     * Returns specific value from state by key, or null if not found.
     */
    getStateValue(key: string): any {
        return this.currentState?.get(key) || null;
    }

    /**
     * Subscribes to state changes with optional configuration for throttling and immediate notification.
     */
    subscribe(id: string, callback: (state: Map<string, any>) => void, options: SubscriberOptions = {}): void {
        this.subscribers.set(id, { callback, options });

        if (this.shouldNotifyImmediately(options)) {
            this.notifySubscriber(callback);
        }
    }

    /**
     * Removes subscriber by ID.
     */
    unsubscribe(id: string): void {
        this.subscribers.delete(id);
    }

    /**
     * Clears all state and subscribers.
     */
    cleanup(): void {
        this.currentState = null;
        this.subscribers.clear();
    }

    /**
     * Determines if subscriber should receive immediate notification based on options.
     */
    private shouldNotifyImmediately(options: SubscriberOptions): boolean {
        return options.immediate !== false && this.currentState !== null;
    }

    /**
     * Notifies all subscribers of current state.
     */
    private notifySubscribers(): void {
        if (!this.currentState) return;

        this.subscribers.forEach((subscriber) => {
            this.notifySubscriber(subscriber.callback);
        });
    }

    /**
     * Safely notifies individual subscriber with error handling.
     */
    private notifySubscriber(callback: (state: Map<string, any>) => void): void {
        if (!this.currentState) return;

        try {
            callback(this.currentState);
        } catch {
            // Continue execution if individual subscriber fails
        }
    }
}