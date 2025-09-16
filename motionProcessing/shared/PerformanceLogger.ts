/**
 * High-performance logging utility with minimal overhead.
 * Disabled by default in production, with optional sampling for development.
 */
export class PerformanceLogger {
    private static readonly enabled = process.env.NODE_ENV === 'development' && process.env.PERF_DEBUG === '1';
    private static readonly sampleRate = 0.01; // Log only 1% of operations
    private static sampleCounter = 0;

    /**
     * Log performance metrics with sampling to reduce overhead
     */
    static log(category: string, operation: string, duration: number, deviceId?: string): void {
        if (!this.enabled) return;

        this.sampleCounter++;
        if (this.sampleCounter % 100 !== 0) return; // Sample every 100th call

        const timestamp = Date.now();
        console.log(`[PERF] ${category}[${operation}]${deviceId ? ` ${deviceId}` : ''} ${duration.toFixed(2)}ms @${timestamp}`);
    }

    /**
     * Log critical errors or warnings (always enabled)
     */
    static warn(category: string, message: string, data?: any): void {
        console.warn(`[${category}] ${message}`, data || '');
    }

    /**
     * Log important events (always enabled)
     */
    static info(category: string, message: string): void {
        console.log(`[${category}] ${message}`);
    }

    /**
     * High-performance timer for critical paths
     */
    static time<T>(category: string, operation: string, fn: () => T, deviceId?: string): T {
        if (!this.enabled) return fn();

        const start = performance.now();
        const result = fn();
        const duration = performance.now() - start;

        this.log(category, operation, duration, deviceId);
        return result;
    }
}