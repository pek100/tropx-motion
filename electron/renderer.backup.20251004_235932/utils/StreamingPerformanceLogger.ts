/**
 * Streaming Performance Logger - Tracks specific streaming operations that cause UI blocking
 * Focuses on data flow bottlenecks during real-time motion capture
 */

interface StreamingOperation {
    type: 'data_update' | 'chart_render' | 'state_update' | 'websocket_message' | 'ipc_message';
    component: string;
    operationId: string;
    startTime: number;
    endTime?: number;
    duration?: number;
    dataSize?: number;
    metadata?: any;
}

interface StreamingStats {
    totalOperations: number;
    avgDuration: number;
    maxDuration: number;
    operationsPerSecond: number;
    blockingOperations: number;
    dataVolumePerSecond: number;
    lastResetTime: number;
}

class StreamingPerformanceLogger {
    private static instance: StreamingPerformanceLogger | null = null;
    private activeOperations = new Map<string, StreamingOperation>();
    private completedOperations: StreamingOperation[] = [];
    private stats: Map<string, StreamingStats> = new Map();

    // Circular buffer for recent operations
    private readonly MAX_COMPLETED_OPERATIONS = 500;
    private readonly STATS_RESET_INTERVAL = 10000; // 10 seconds
    private readonly BLOCKING_THRESHOLD = 16; // 16ms for 60fps

    // Real-time metrics
    private operationCounter = 0;
    private dataVolumeCounter = 0;
    private lastStatsReset = performance.now();

    private constructor() {
        this.setupPeriodicStatsReset();
    }

    static getInstance(): StreamingPerformanceLogger {
        if (!StreamingPerformanceLogger.instance) {
            StreamingPerformanceLogger.instance = new StreamingPerformanceLogger();
        }
        return StreamingPerformanceLogger.instance;
    }

    /**
     * Start tracking a streaming operation
     */
    startOperation(
        type: StreamingOperation['type'],
        component: string,
        operationId: string,
        metadata?: any
    ): string {
        const trackingId = `${component}_${operationId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const operation: StreamingOperation = {
            type,
            component,
            operationId,
            startTime: performance.now(),
            metadata
        };

        this.activeOperations.set(trackingId, operation);
        return trackingId;
    }

    /**
     * End tracking and record performance metrics
     */
    endOperation(trackingId: string, dataSize?: number): void {
        const operation = this.activeOperations.get(trackingId);
        if (!operation) {
            console.warn(`[STREAMING_LOGGER] Operation not found: ${trackingId}`);
            return;
        }

        const endTime = performance.now();
        const duration = endTime - operation.startTime;

        operation.endTime = endTime;
        operation.duration = duration;
        operation.dataSize = dataSize;

        // Remove from active operations
        this.activeOperations.delete(trackingId);

        // Add to completed operations
        this.completedOperations.push(operation);
        if (this.completedOperations.length > this.MAX_COMPLETED_OPERATIONS) {
            this.completedOperations.shift();
        }

        // Update stats
        this.updateStats(operation);

        // Log blocking operations immediately
        if (duration > this.BLOCKING_THRESHOLD) {
            const severity = duration > 50 ? 'SEVERE' : 'MODERATE';
            console.warn(`🐌 [STREAMING_BLOCKING] ${severity}: ${operation.component}.${operation.operationId} took ${duration.toFixed(2)}ms`, {
                type: operation.type,
                dataSize: operation.dataSize,
                metadata: operation.metadata
            });
        }

        // Track counters
        this.operationCounter++;
        if (dataSize) {
            this.dataVolumeCounter += dataSize;
        }
    }

    /**
     * Track a complete operation (start + end in one call)
     */
    trackOperation<T>(
        type: StreamingOperation['type'],
        component: string,
        operationId: string,
        operation: () => T,
        metadata?: any
    ): T {
        const trackingId = this.startOperation(type, component, operationId, metadata);

        try {
            const result = operation();
            this.endOperation(trackingId);
            return result;
        } catch (error) {
            this.endOperation(trackingId);
            throw error;
        }
    }

    /**
     * Track async operation
     */
    async trackAsyncOperation<T>(
        type: StreamingOperation['type'],
        component: string,
        operationId: string,
        operation: () => Promise<T>,
        metadata?: any
    ): Promise<T> {
        const trackingId = this.startOperation(type, component, operationId, metadata);

        try {
            const result = await operation();
            this.endOperation(trackingId);
            return result;
        } catch (error) {
            this.endOperation(trackingId);
            throw error;
        }
    }

    /**
     * Log WebSocket message processing
     */
    logWebSocketMessage(component: string, messageSize: number, processingTime: number): void {
        const operation: StreamingOperation = {
            type: 'websocket_message',
            component,
            operationId: 'message_process',
            startTime: performance.now() - processingTime,
            endTime: performance.now(),
            duration: processingTime,
            dataSize: messageSize
        };

        this.completedOperations.push(operation);
        this.updateStats(operation);
        this.operationCounter++;
        this.dataVolumeCounter += messageSize;

        if (processingTime > this.BLOCKING_THRESHOLD) {
            console.warn(`🌐 [WEBSOCKET_BLOCKING] Message processing took ${processingTime.toFixed(2)}ms (${messageSize} bytes)`);
        }
    }

    /**
     * Log IPC message processing
     */
    logIpcMessage(component: string, channel: string, processingTime: number, dataSize?: number): void {
        const operation: StreamingOperation = {
            type: 'ipc_message',
            component,
            operationId: `ipc_${channel}`,
            startTime: performance.now() - processingTime,
            endTime: performance.now(),
            duration: processingTime,
            dataSize,
            metadata: { channel }
        };

        this.completedOperations.push(operation);
        this.updateStats(operation);
        this.operationCounter++;
        if (dataSize) {
            this.dataVolumeCounter += dataSize;
        }

        if (processingTime > this.BLOCKING_THRESHOLD) {
            console.warn(`📡 [IPC_BLOCKING] Channel '${channel}' processing took ${processingTime.toFixed(2)}ms`);
        }
    }

    /**
     * Get performance stats for a specific operation type
     */
    getStats(operationType: string): StreamingStats | null {
        return this.stats.get(operationType) || null;
    }

    /**
     * Get all current performance stats
     */
    getAllStats(): Map<string, StreamingStats> {
        return new Map(this.stats);
    }

    /**
     * Get recent blocking operations
     */
    getRecentBlockingOperations(timeWindowMs: number = 30000): StreamingOperation[] {
        const cutoff = performance.now() - timeWindowMs;
        return this.completedOperations
            .filter(op =>
                op.startTime > cutoff &&
                op.duration &&
                op.duration > this.BLOCKING_THRESHOLD
            )
            .sort((a, b) => (b.duration || 0) - (a.duration || 0));
    }

    /**
     * Get operations by component
     */
    getOperationsByComponent(component: string, timeWindowMs: number = 30000): StreamingOperation[] {
        const cutoff = performance.now() - timeWindowMs;
        return this.completedOperations
            .filter(op => op.component === component && op.startTime > cutoff)
            .sort((a, b) => b.startTime - a.startTime);
    }

    /**
     * Update statistics for an operation
     */
    private updateStats(operation: StreamingOperation): void {
        const key = `${operation.component}_${operation.type}`;
        const existing = this.stats.get(key) || {
            totalOperations: 0,
            avgDuration: 0,
            maxDuration: 0,
            operationsPerSecond: 0,
            blockingOperations: 0,
            dataVolumePerSecond: 0,
            lastResetTime: performance.now()
        };

        existing.totalOperations++;
        existing.maxDuration = Math.max(existing.maxDuration, operation.duration || 0);

        if (operation.duration && operation.duration > this.BLOCKING_THRESHOLD) {
            existing.blockingOperations++;
        }

        // Calculate running average
        if (existing.totalOperations === 1) {
            existing.avgDuration = operation.duration || 0;
        } else {
            existing.avgDuration = (existing.avgDuration * (existing.totalOperations - 1) + (operation.duration || 0)) / existing.totalOperations;
        }

        this.stats.set(key, existing);
    }

    /**
     * Setup periodic stats reporting and reset
     */
    private setupPeriodicStatsReset(): void {
        setInterval(() => {
            this.reportCurrentStats();
            this.resetCounters();
        }, this.STATS_RESET_INTERVAL);
    }

    /**
     * Report current performance stats
     */
    private reportCurrentStats(): void {
        const elapsed = performance.now() - this.lastStatsReset;
        const operationsPerSecond = (this.operationCounter / elapsed) * 1000;
        const dataVolumePerSecond = (this.dataVolumeCounter / elapsed) * 1000;

        if (operationsPerSecond > 10) { // Only report if there's significant activity
            console.log('📊 [STREAMING_STATS] Performance Summary:', {
                operationsPerSecond: operationsPerSecond.toFixed(1),
                dataVolumePerSecond: `${(dataVolumePerSecond / 1024).toFixed(1)} KB/s`,
                activeOperations: this.activeOperations.size,
                totalCompleted: this.completedOperations.length,
                recentBlocking: this.getRecentBlockingOperations(this.STATS_RESET_INTERVAL).length
            });

            // Report top blocking operations
            const recentBlocking = this.getRecentBlockingOperations(this.STATS_RESET_INTERVAL);
            if (recentBlocking.length > 0) {
                console.log('🐌 [BLOCKING_SUMMARY] Top blocking operations:',
                    recentBlocking.slice(0, 5).map(op => ({
                        operation: `${op.component}.${op.operationId}`,
                        duration: `${(op.duration || 0).toFixed(2)}ms`,
                        type: op.type
                    }))
                );
            }
        }
    }

    /**
     * Reset performance counters
     */
    private resetCounters(): void {
        this.operationCounter = 0;
        this.dataVolumeCounter = 0;
        this.lastStatsReset = performance.now();

        // Update all stats reset times
        for (const [key, stats] of this.stats) {
            stats.lastResetTime = this.lastStatsReset;
        }
    }

    /**
     * Clear all data and reset
     */
    reset(): void {
        this.activeOperations.clear();
        this.completedOperations = [];
        this.stats.clear();
        this.resetCounters();
        console.log('🔄 [STREAMING_LOGGER] Reset all performance data');
    }

    /**
     * Export performance data for analysis
     */
    exportData(): {
        activeOperations: StreamingOperation[];
        completedOperations: StreamingOperation[];
        stats: { [key: string]: StreamingStats };
    } {
        return {
            activeOperations: Array.from(this.activeOperations.values()),
            completedOperations: [...this.completedOperations],
            stats: Object.fromEntries(this.stats)
        };
    }
}

// Create and export singleton
export const streamingLogger = StreamingPerformanceLogger.getInstance();

// Development mode auto-reporting
if (process.env.NODE_ENV === 'development') {
    console.log('📊 [STREAMING_LOGGER] Initialized for development monitoring');
}