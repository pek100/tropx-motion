import { IMUData } from '../../muse_sdk/core/MuseData';
import { SYNC } from '../shared/constants';

interface SyncResult {
    correctedTimestamp: number;
    shouldProcess: boolean;
}

/**
 * Synchronizes IMU data timestamps across multiple devices to ensure temporal alignment.
 * Implements adaptive timeout strategy and baseline synchronization using latest first sample.
 * Essential for accurate joint angle calculations requiring paired device data.
 */
export class DataSyncService {
    private firstSamples = new Map<string, number>();
    private latestFirstTimestamp: number | null = null;
    private deviceOffsets = new Map<string, number>();
    private isReady = false;
    private syncTimeout: NodeJS.Timeout | null = null;
    private recordingStartTime: number | null = null;
    private isDisposed = false;

    /**
     * Processes IMU data and applies synchronization if ready, otherwise queues for sync.
     * Returns null if synchronization not yet established.
     */
    processIMUData(deviceId: string, imuData: IMUData): SyncResult | null {
        const rawTimestamp = imuData.timestamp || performance.now();

        if (!this.firstSamples.has(deviceId)) {
            this.firstSamples.set(deviceId, rawTimestamp);

            if (this.firstSamples.size === 1) {
                this.recordingStartTime = performance.now();
                this.startSyncTimeout();
            }
        }

        if (!this.isReady) {
            return null;
        }

        const offset = this.deviceOffsets.get(deviceId) || 0;
        const correctedTimestamp = rawTimestamp + offset;

        if (correctedTimestamp < this.latestFirstTimestamp!) {
            return null;
        }

        return {
            correctedTimestamp,
            shouldProcess: true
        };
    }

    /**
     * Creates synchronized IMU data with corrected timestamp.
     * Returns null if synchronization not ready or data should be filtered.
     */
    createSynchronizedIMUData(deviceId: string, originalIMU: IMUData): IMUData | null {
        const result = this.processIMUData(deviceId, originalIMU);
        if (!result) return null;

        return {
            ...originalIMU,
            timestamp: result.correctedTimestamp
        };
    }

    /**
     * Resets synchronization state for new recording session.
     * Clears all timing data and cancels pending operations.
     */
    reset(): void {
        this.isDisposed = true;

        if (this.syncTimeout) {
            clearTimeout(this.syncTimeout);
            this.syncTimeout = null;
        }

        this.firstSamples.clear();
        this.latestFirstTimestamp = null;
        this.deviceOffsets.clear();
        this.isReady = false;
        this.recordingStartTime = null;

        this.isDisposed = false;
    }

    /**
     * Returns whether synchronization baseline has been established.
     */
    isReadyForSync(): boolean {
        return this.isReady;
    }
    /**
     * Starts adaptive timeout mechanism for synchronization establishment.
     * Uses different timeout values for paired vs unpaired device scenarios.
     */
    private startSyncTimeout(): void {
        if (this.isDisposed) return;

        if (this.syncTimeout) {
            clearTimeout(this.syncTimeout);
        }

        const checkAndSync = () => {
            if (this.isDisposed) return;

            const deviceCount = this.firstSamples.size;
            const elapsedTime = performance.now() - (this.recordingStartTime || 0);
            const timeoutMs = deviceCount % 2 === 0 ? SYNC.TIMEOUT_PAIRED_MS : SYNC.TIMEOUT_UNPAIRED_MS;

            if (elapsedTime >= timeoutMs) {
                this.establishSync();
            } else {
                if (!this.isDisposed) {
                    this.syncTimeout = setTimeout(checkAndSync, SYNC.CHECK_INTERVAL_MS);
                }
            }
        };

        this.syncTimeout = setTimeout(checkAndSync, SYNC.CHECK_INTERVAL_MS);
    }

    /**
     * Establishes synchronization baseline using latest first sample timestamp.
     * Calculates offsets for all devices to align them to common temporal reference.
     */
    private establishSync(): void {
        if (this.isReady) return;

        if (this.syncTimeout) {
            clearTimeout(this.syncTimeout);
            this.syncTimeout = null;
        }

        // Use latest first sample as baseline to ensure all devices can be synchronized
        this.latestFirstTimestamp = Math.max(...this.firstSamples.values());

        this.firstSamples.forEach((firstTime, deviceId) => {
            const offset = this.latestFirstTimestamp! - firstTime;
            this.deviceOffsets.set(deviceId, offset);
        });

        this.isReady = true;
    }
}