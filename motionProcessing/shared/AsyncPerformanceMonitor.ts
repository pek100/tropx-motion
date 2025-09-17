import { PerformanceLogger } from './PerformanceLogger';

interface PerformanceMetric {
    operation: string;
    category: string;
    duration: number;
    timestamp: number;
    jointName?: string;
}

interface PerformanceSummary {
    totalOperations: number;
    avgDuration: number;
    maxDuration: number;
    minDuration: number;
    p95Duration: number;
    operationsPerSecond: number;
    blockingOperations: number;
    asyncOperations: number;
}

/**
 * Advanced performance monitoring for async motion processing operations.
 * Tracks blocking vs non-blocking operations and provides detailed metrics.
 */
export class AsyncPerformanceMonitor {
    private static instance: AsyncPerformanceMonitor | null = null;
    private metrics: PerformanceMetric[] = [];
    private readonly maxMetrics = 1000; // Keep last 1000 operations
    private lastReportTime = 0;
    private readonly reportInterval = 10000; // Report every 10 seconds

    // Performance thresholds
    private readonly BLOCKING_THRESHOLD_MS = 5.0; // Operations >5ms considered potentially blocking
    private readonly ASYNC_TARGET_MS = 1.0; // Target <1ms for async operations

    private constructor() {
        this.startPeriodicReporting();
    }

    static getInstance(): AsyncPerformanceMonitor {
        if (!AsyncPerformanceMonitor.instance) {
            AsyncPerformanceMonitor.instance = new AsyncPerformanceMonitor();
        }
        return AsyncPerformanceMonitor.instance;
    }

    static reset(): void {
        if (AsyncPerformanceMonitor.instance) {
            AsyncPerformanceMonitor.instance.cleanup();
            AsyncPerformanceMonitor.instance = null;
        }
    }

    /**
     * Record a performance metric for async operations
     */
    recordMetric(category: string, operation: string, duration: number, jointName?: string): void {
        const metric: PerformanceMetric = {
            operation,
            category,
            duration,
            timestamp: Date.now(),
            jointName
        };

        this.metrics.push(metric);

        // Maintain circular buffer
        if (this.metrics.length > this.maxMetrics) {
            this.metrics.shift();
        }

        // Log blocking operations immediately
        if (duration > this.BLOCKING_THRESHOLD_MS) {
            PerformanceLogger.warn(
                'ASYNC_MONITOR',
                `Potentially blocking operation detected: ${category}.${operation} took ${duration.toFixed(2)}ms`,
                { jointName, duration }
            );
        }
    }

    /**
     * Time an async operation and record metrics
     */
    timeAsyncOperation<T>(
        category: string,
        operation: string,
        fn: () => Promise<T>,
        jointName?: string
    ): Promise<T> {
        const start = performance.now();
        return fn().then(
            result => {
                const duration = performance.now() - start;
                this.recordMetric(category, operation, duration, jointName);
                return result;
            },
            error => {
                const duration = performance.now() - start;
                this.recordMetric(category, `${operation}_error`, duration, jointName);
                throw error;
            }
        );
    }

    /**
     * Time a synchronous operation and record metrics
     */
    timeSyncOperation<T>(
        category: string,
        operation: string,
        fn: () => T,
        jointName?: string
    ): T {
        const start = performance.now();
        try {
            const result = fn();
            const duration = performance.now() - start;
            this.recordMetric(category, operation, duration, jointName);
            return result;
        } catch (error) {
            const duration = performance.now() - start;
            this.recordMetric(category, `${operation}_error`, duration, jointName);
            throw error;
        }
    }

    /**
     * Get performance summary for all operations
     */
    getPerformanceSummary(): PerformanceSummary {
        if (this.metrics.length === 0) {
            return {
                totalOperations: 0,
                avgDuration: 0,
                maxDuration: 0,
                minDuration: 0,
                p95Duration: 0,
                operationsPerSecond: 0,
                blockingOperations: 0,
                asyncOperations: 0
            };
        }

        const durations = this.metrics.map(m => m.duration).sort((a, b) => a - b);
        const totalDuration = durations.reduce((sum, d) => sum + d, 0);
        const blockingCount = this.metrics.filter(m => m.duration > this.BLOCKING_THRESHOLD_MS).length;

        // Calculate time span for operations per second
        const timestamps = this.metrics.map(m => m.timestamp);
        const timeSpan = Math.max(...timestamps) - Math.min(...timestamps);
        const operationsPerSecond = timeSpan > 0 ? (this.metrics.length / timeSpan) * 1000 : 0;

        // Calculate percentiles
        const p95Index = Math.floor(durations.length * 0.95);

        return {
            totalOperations: this.metrics.length,
            avgDuration: totalDuration / this.metrics.length,
            maxDuration: Math.max(...durations),
            minDuration: Math.min(...durations),
            p95Duration: durations[p95Index] || 0,
            operationsPerSecond,
            blockingOperations: blockingCount,
            asyncOperations: this.metrics.length - blockingCount
        };
    }

    /**
     * Get performance summary by category
     */
    getPerformanceByCateogory(): Map<string, PerformanceSummary> {
        const categoryMap = new Map<string, PerformanceSummary>();
        const categorySet = new Set(this.metrics.map(m => m.category));
        const categories = Array.from(categorySet);

        for (const category of categories) {
            const categoryMetrics = this.metrics.filter(m => m.category === category);
            const durations = categoryMetrics.map(m => m.duration).sort((a, b) => a - b);
            const totalDuration = durations.reduce((sum, d) => sum + d, 0);
            const blockingCount = categoryMetrics.filter(m => m.duration > this.BLOCKING_THRESHOLD_MS).length;

            const timestamps = categoryMetrics.map(m => m.timestamp);
            const timeSpan = Math.max(...timestamps) - Math.min(...timestamps);
            const operationsPerSecond = timeSpan > 0 ? (categoryMetrics.length / timeSpan) * 1000 : 0;

            const p95Index = Math.floor(durations.length * 0.95);

            categoryMap.set(category, {
                totalOperations: categoryMetrics.length,
                avgDuration: totalDuration / categoryMetrics.length,
                maxDuration: Math.max(...durations),
                minDuration: Math.min(...durations),
                p95Duration: durations[p95Index] || 0,
                operationsPerSecond,
                blockingOperations: blockingCount,
                asyncOperations: categoryMetrics.length - blockingCount
            });
        }

        return categoryMap;
    }

    /**
     * Get recent blocking operations for debugging
     */
    getRecentBlockingOperations(limit: number = 10): PerformanceMetric[] {
        return this.metrics
            .filter(m => m.duration > this.BLOCKING_THRESHOLD_MS)
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, limit);
    }

    /**
     * Get metrics for specific joint
     */
    getJointMetrics(jointName: string): PerformanceMetric[] {
        return this.metrics.filter(m => m.jointName === jointName);
    }

    /**
     * Clear all metrics
     */
    clearMetrics(): void {
        this.metrics = [];
        PerformanceLogger.info('ASYNC_MONITOR', 'Performance metrics cleared');
    }

    /**
     * Start periodic performance reporting
     */
    private startPeriodicReporting(): void {
        setInterval(() => {
            this.generatePerformanceReport();
        }, this.reportInterval);
    }

    /**
     * Generate and log performance report
     */
    private generatePerformanceReport(): void {
        const now = Date.now();
        if (now - this.lastReportTime < this.reportInterval) return;

        this.lastReportTime = now;
        const summary = this.getPerformanceSummary();

        if (summary.totalOperations === 0) return;

        const blockingPercentage = ((summary.blockingOperations / summary.totalOperations) * 100).toFixed(1);
        const asyncPercentage = ((summary.asyncOperations / summary.totalOperations) * 100).toFixed(1);

        PerformanceLogger.info('ASYNC_MONITOR',
            `Performance Report: ${summary.totalOperations} ops, ` +
            `avg: ${summary.avgDuration.toFixed(2)}ms, ` +
            `p95: ${summary.p95Duration.toFixed(2)}ms, ` +
            `max: ${summary.maxDuration.toFixed(2)}ms, ` +
            `ops/sec: ${summary.operationsPerSecond.toFixed(1)}, ` +
            `blocking: ${blockingPercentage}%, ` +
            `async: ${asyncPercentage}%`
        );

        // Log category breakdown
        const categoryStats = this.getPerformanceByCateogory();
        categoryStats.forEach((stats, category) => {
            const catBlockingPercentage = ((stats.blockingOperations / stats.totalOperations) * 100).toFixed(1);
            PerformanceLogger.info('ASYNC_MONITOR',
                `  ${category}: ${stats.totalOperations} ops, ` +
                `avg: ${stats.avgDuration.toFixed(2)}ms, ` +
                `blocking: ${catBlockingPercentage}%`
            );
        });

        // Warn about excessive blocking operations
        if (summary.blockingOperations > summary.totalOperations * 0.1) { // >10% blocking
            PerformanceLogger.warn('ASYNC_MONITOR',
                `High blocking operation rate: ${blockingPercentage}% of operations are blocking`
            );
        }
    }

    /**
     * Cleanup resources
     */
    cleanup(): void {
        this.metrics = [];
        PerformanceLogger.info('ASYNC_MONITOR', 'AsyncPerformanceMonitor cleaned up');
    }
}