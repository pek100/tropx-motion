/**
 * Lightweight circular buffer optimized for React UI components.
 * Prevents array spreading/slicing operations that block rendering.
 */

export interface DataPoint {
    [key: string]: any;
    time: number;
    _updateId?: number;
}

export class UICircularBuffer<T extends DataPoint> {
    private buffer: T[];
    private head: number = 0;
    private tail: number = 0;
    private count: number = 0;
    private readonly capacity: number;
    private readonly timeWindow: number;

    constructor(capacity: number = 50, timeWindowMs: number = 20000) {
        this.capacity = capacity;
        this.timeWindow = timeWindowMs;
        this.buffer = new Array(capacity);
    }

    /**
     * Add data point - O(1) operation, never blocks
     */
    push(dataPoint: T): void {
        // Add to buffer at head position
        this.buffer[this.head] = { ...dataPoint }; // Shallow copy to prevent mutations

        this.head = (this.head + 1) % this.capacity;

        if (this.count < this.capacity) {
            this.count++;
        } else {
            // Buffer full - advance tail (overwrites oldest)
            this.tail = (this.tail + 1) % this.capacity;
        }
    }

    /**
     * Get data for chart rendering - optimized for React
     * Returns array in chronological order without copying large arrays
     */
    getChartData(currentTime?: number): T[] {
        if (this.count === 0) return [];

        const cutoffTime = currentTime ? currentTime - this.timeWindow : 0;
        const result: T[] = [];

        // Iterate through buffer in chronological order
        for (let i = 0; i < this.count; i++) {
            const index = (this.tail + i) % this.capacity;
            const dataPoint = this.buffer[index];

            // Time-based filtering - only include recent data
            if (!cutoffTime || dataPoint.time >= cutoffTime) {
                result.push(dataPoint);
            }
        }

        return result;
    }

    /**
     * Get most recent data point - O(1)
     */
    getLatest(): T | null {
        if (this.count === 0) return null;
        const index = this.head === 0 ? this.capacity - 1 : this.head - 1;
        return this.buffer[index];
    }

    /**
     * Get data points within time range - optimized iteration
     */
    getTimeRangeData(startTime: number, endTime: number): T[] {
        if (this.count === 0) return [];

        const result: T[] = [];
        for (let i = 0; i < this.count; i++) {
            const index = (this.tail + i) % this.capacity;
            const dataPoint = this.buffer[index];

            if (dataPoint.time >= startTime && dataPoint.time <= endTime) {
                result.push(dataPoint);
            }
        }

        return result;
    }

    /**
     * Get current size
     */
    size(): number {
        return this.count;
    }

    /**
     * Check if buffer is full
     */
    isFull(): boolean {
        return this.count === this.capacity;
    }

    /**
     * Clear all data - O(1)
     */
    clear(): void {
        this.head = 0;
        this.tail = 0;
        this.count = 0;
    }

    /**
     * Get buffer statistics for monitoring
     */
    getStats(): {
        size: number;
        capacity: number;
        utilization: number;
        oldestTime: number | null;
        newestTime: number | null;
        timeSpan: number;
    } {
        if (this.count === 0) {
            return {
                size: 0,
                capacity: this.capacity,
                utilization: 0,
                oldestTime: null,
                newestTime: null,
                timeSpan: 0
            };
        }

        const oldest = this.buffer[this.tail];
        const newest = this.buffer[this.head === 0 ? this.capacity - 1 : this.head - 1];

        return {
            size: this.count,
            capacity: this.capacity,
            utilization: (this.count / this.capacity) * 100,
            oldestTime: oldest.time,
            newestTime: newest.time,
            timeSpan: newest.time - oldest.time
        };
    }

    /**
     * Remove old data points beyond time window - O(n) but called infrequently
     */
    trimToTimeWindow(currentTime: number): number {
        if (this.count === 0) return 0;

        const cutoffTime = currentTime - this.timeWindow;
        let removedCount = 0;

        // Remove from tail until we find recent data
        while (this.count > 0 && this.buffer[this.tail].time < cutoffTime) {
            this.tail = (this.tail + 1) % this.capacity;
            this.count--;
            removedCount++;
        }

        return removedCount;
    }

    /**
     * Force compact buffer by removing percentage of oldest data
     * Use sparingly - only when buffer is consistently full
     */
    compactBuffer(removePercentage: number = 0.2): number {
        if (this.count === 0) return 0;

        const removeCount = Math.floor(this.count * removePercentage);
        if (removeCount === 0) return 0;

        // Advance tail to remove oldest data
        this.tail = (this.tail + removeCount) % this.capacity;
        this.count -= removeCount;

        return removeCount;
    }
}