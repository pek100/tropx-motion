/**
 * Debug logger for time sync operations.
 * Writes detailed sync data to file for analysis.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface DeviceTimestampEntry {
    deviceName: string;
    deviceId: string;
    timestamp: number;
    timestampISO: string;
}

interface ClockOffsetEntry {
    deviceName: string;
    relativeOffsetMs: number;
    correctionAppliedMs: number;
    isReference: boolean;
}

interface SyncSessionSample {
    sampleIndex: number;
    deviceTimestampMs: number;
    hostTimestampMs: number;
    rttMs: number;
}

interface DeviceSyncResult {
    deviceName: string;
    deviceId: string;
    success: boolean;
    finalOffsetMs: number;
    avgRttMs: number;
    samples: SyncSessionSample[];
    error?: string;
}

interface TimeSyncLog {
    capturedAt: string;
    commonDatetimeSeconds: number;
    commonDatetimeISO: string;

    // Phase 1: Before SET_DATETIME
    timestampsBefore: DeviceTimestampEntry[];

    // Phase 2: After SET_DATETIME
    timestampsAfter: DeviceTimestampEntry[];

    // Phase 3: Relative offset calculation
    referenceDevice: string;
    referenceTimestampMs: number;
    clockOffsets: ClockOffsetEntry[];

    // Phase 4: Sync session results
    syncResults: DeviceSyncResult[];

    // Analysis
    analysis: {
        maxDeviceSpreadBeforeMs: number;
        maxDeviceSpreadAfterMs: number;
        maxDeviceSpreadAfterCorrectionMs: number;
        allDevicesSynced: boolean;
        verdict: string;
    };
}

class TimeSyncDebugLoggerClass {
    private isEnabled = true;
    private logFilePath: string;

    // Accumulated data during sync process
    private commonDatetimeSeconds = 0;
    private timestampsBefore: DeviceTimestampEntry[] = [];
    private timestampsAfter: DeviceTimestampEntry[] = [];
    private referenceDevice = '';
    private referenceTimestampMs = 0;
    private clockOffsets: ClockOffsetEntry[] = [];
    private syncResults: DeviceSyncResult[] = [];
    private syncSamples = new Map<string, SyncSessionSample[]>();

    constructor() {
        this.logFilePath = path.join(os.homedir(), 'Documents', 'TropX', 'timesync_debug.json');
    }

    /** Reset for new sync session */
    reset(): void {
        this.commonDatetimeSeconds = 0;
        this.timestampsBefore = [];
        this.timestampsAfter = [];
        this.referenceDevice = '';
        this.referenceTimestampMs = 0;
        this.clockOffsets = [];
        this.syncResults = [];
        this.syncSamples.clear();
    }

    /** Log common datetime being set */
    logCommonDatetime(timestampSeconds: number): void {
        if (!this.isEnabled) return;
        this.commonDatetimeSeconds = timestampSeconds;
    }

    /** Log device timestamp before SET_DATETIME */
    logTimestampBefore(deviceName: string, deviceId: string, timestampMs: number): void {
        if (!this.isEnabled) return;
        this.timestampsBefore.push({
            deviceName,
            deviceId,
            timestamp: timestampMs,
            timestampISO: new Date(timestampMs).toISOString()
        });
    }

    /** Log device timestamp after SET_DATETIME */
    logTimestampAfter(deviceName: string, deviceId: string, timestampMs: number): void {
        if (!this.isEnabled) return;
        this.timestampsAfter.push({
            deviceName,
            deviceId,
            timestamp: timestampMs,
            timestampISO: new Date(timestampMs).toISOString()
        });
    }

    /** Log reference device selection */
    logReferenceDevice(deviceName: string, timestampMs: number): void {
        if (!this.isEnabled) return;
        this.referenceDevice = deviceName;
        this.referenceTimestampMs = timestampMs;
    }

    /** Log clock offset calculation and correction */
    logClockOffset(deviceName: string, relativeOffsetMs: number, correctionAppliedMs: number, isReference: boolean): void {
        if (!this.isEnabled) return;
        this.clockOffsets.push({
            deviceName,
            relativeOffsetMs,
            correctionAppliedMs,
            isReference
        });
    }

    /** Log a sync session sample (RTT measurement) */
    logSyncSample(deviceId: string, sampleIndex: number, deviceTimestampMs: number, hostTimestampMs: number, rttMs: number): void {
        if (!this.isEnabled) return;

        if (!this.syncSamples.has(deviceId)) {
            this.syncSamples.set(deviceId, []);
        }
        this.syncSamples.get(deviceId)!.push({
            sampleIndex,
            deviceTimestampMs,
            hostTimestampMs,
            rttMs
        });
    }

    /** Log final sync result for a device */
    logSyncResult(deviceName: string, deviceId: string, success: boolean, finalOffsetMs: number, avgRttMs: number, error?: string): void {
        if (!this.isEnabled) return;

        const samples = this.syncSamples.get(deviceId) || [];
        this.syncResults.push({
            deviceName,
            deviceId,
            success,
            finalOffsetMs,
            avgRttMs,
            samples,
            error
        });
    }

    /** Flush all accumulated data to file */
    flush(): void {
        if (!this.isEnabled) return;
        if (this.timestampsBefore.length === 0 && this.syncResults.length === 0) {
            console.log('📊 [TimeSyncDebugLogger] No data to flush');
            return;
        }

        try {
            // Ensure directory exists
            const dir = path.dirname(this.logFilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const analysis = this.analyze();

            const output: TimeSyncLog = {
                capturedAt: new Date().toISOString(),
                commonDatetimeSeconds: this.commonDatetimeSeconds,
                commonDatetimeISO: new Date(this.commonDatetimeSeconds * 1000).toISOString(),
                timestampsBefore: this.timestampsBefore,
                timestampsAfter: this.timestampsAfter,
                referenceDevice: this.referenceDevice,
                referenceTimestampMs: this.referenceTimestampMs,
                clockOffsets: this.clockOffsets,
                syncResults: this.syncResults,
                analysis
            };

            fs.writeFileSync(this.logFilePath, JSON.stringify(output, null, 2));
            console.log(`📊 [TimeSyncDebugLogger] Wrote sync data to ${this.logFilePath}`);
        } catch (err) {
            console.error('[TimeSyncDebugLogger] Failed to write:', err);
        }
    }

    /** Analyze the sync data */
    private analyze(): TimeSyncLog['analysis'] {
        // Calculate spread before SET_DATETIME
        const beforeTimestamps = this.timestampsBefore.map(t => t.timestamp);
        const maxBefore = beforeTimestamps.length > 0 ? Math.max(...beforeTimestamps) : 0;
        const minBefore = beforeTimestamps.length > 0 ? Math.min(...beforeTimestamps) : 0;
        const spreadBefore = maxBefore - minBefore;

        // Calculate spread after SET_DATETIME
        const afterTimestamps = this.timestampsAfter.map(t => t.timestamp);
        const maxAfter = afterTimestamps.length > 0 ? Math.max(...afterTimestamps) : 0;
        const minAfter = afterTimestamps.length > 0 ? Math.min(...afterTimestamps) : 0;
        const spreadAfter = maxAfter - minAfter;

        // Calculate spread after corrections (from sync results)
        const finalOffsets = this.syncResults.filter(r => r.success).map(r => r.finalOffsetMs);
        const maxOffset = finalOffsets.length > 0 ? Math.max(...finalOffsets) : 0;
        const minOffset = finalOffsets.length > 0 ? Math.min(...finalOffsets) : 0;
        const spreadAfterCorrection = maxOffset - minOffset;

        const allSynced = this.syncResults.every(r => r.success);

        let verdict: string;
        if (!allSynced) {
            verdict = 'SYNC FAILED: Not all devices synced successfully';
        } else if (spreadAfterCorrection > 20) {
            verdict = `WARNING: Device spread after sync is ${spreadAfterCorrection.toFixed(1)}ms - may cause jitter`;
        } else if (spreadAfterCorrection > 10) {
            verdict = `ACCEPTABLE: Device spread is ${spreadAfterCorrection.toFixed(1)}ms`;
        } else {
            verdict = `GOOD: Device spread is only ${spreadAfterCorrection.toFixed(1)}ms`;
        }

        return {
            maxDeviceSpreadBeforeMs: spreadBefore,
            maxDeviceSpreadAfterMs: spreadAfter,
            maxDeviceSpreadAfterCorrectionMs: spreadAfterCorrection,
            allDevicesSynced: allSynced,
            verdict
        };
    }

    /** Get the log file path */
    getLogFilePath(): string {
        return this.logFilePath;
    }

    /** Enable/disable logging */
    setEnabled(enabled: boolean): void {
        this.isEnabled = enabled;
    }
}

export const TimeSyncDebugLogger = new TimeSyncDebugLoggerClass();
