/**
 * High-performance circular buffer with O(1) operations for real-time data accumulation.
 * Prevents memory growth and eliminates array shifting operations that block processing.
 */
export class CircularBuffer {
    private buffer: Float32Array;
    private timestamps: Float64Array;
    private head: number = 0;
    private tail: number = 0;
    private count: number = 0;
    private readonly capacity: number;

    constructor(capacity: number = 5000) {
        this.capacity = capacity;
        this.buffer = new Float32Array(capacity);
        this.timestamps = new Float64Array(capacity);
    }

    /**
     * Add value to buffer - O(1) operation, never blocks
     */
    push(value: number, timestamp: number = Date.now()): void {
        this.buffer[this.head] = value;
        this.timestamps[this.head] = timestamp;

        this.head = (this.head + 1) % this.capacity;

        if (this.count < this.capacity) {
            this.count++;
        } else {
            // Buffer full - overwrite oldest data (still O(1))
            this.tail = (this.tail + 1) % this.capacity;
        }
    }

    /**
     * Get all values in chronological order - allocates new array only when needed
     */
    getValues(): number[] {
        if (this.count === 0) return [];

        const values = new Array(this.count);
        for (let i = 0; i < this.count; i++) {
            const index = (this.tail + i) % this.capacity;
            values[i] = this.buffer[index];
        }
        return values;
    }

    /**
     * Get all timestamps in chronological order
     */
    getTimestamps(): number[] {
        if (this.count === 0) return [];

        const timestamps = new Array(this.count);
        for (let i = 0; i < this.count; i++) {
            const index = (this.tail + i) % this.capacity;
            timestamps[i] = this.timestamps[index];
        }
        return timestamps;
    }

    /**
     * Get most recent value - O(1)
     */
    getLatest(): number | null {
        if (this.count === 0) return null;
        const index = this.head === 0 ? this.capacity - 1 : this.head - 1;
        return this.buffer[index];
    }

    /**
     * Get latest timestamp - O(1)
     */
    getLatestTimestamp(): number | null {
        if (this.count === 0) return null;
        const index = this.head === 0 ? this.capacity - 1 : this.head - 1;
        return this.timestamps[index];
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
     * Get statistical summary - O(n) but only called when needed
     */
    getStats(): { min: number; max: number; avg: number; count: number } {
        if (this.count === 0) {
            return { min: 0, max: 0, avg: 0, count: 0 };
        }

        let min = Infinity;
        let max = -Infinity;
        let sum = 0;

        for (let i = 0; i < this.count; i++) {
            const index = (this.tail + i) % this.capacity;
            const value = this.buffer[index];
            min = Math.min(min, value);
            max = Math.max(max, value);
            sum += value;
        }

        return {
            min,
            max,
            avg: sum / this.count,
            count: this.count
        };
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
     * Get buffer utilization percentage
     */
    getUtilization(): number {
        return (this.count / this.capacity) * 100;
    }
}