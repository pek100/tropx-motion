/**
 * Debug logger for raw sensor timestamps.
 * Writes to file for analysis without flooding console.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface TimestampSample {
    sampleNum: number;
    deviceName: string;
    rawSensorTs: number;
    delta: number;
    assignedTs: number;
    receptionTs: number;
    receptionDelta: number;  // Time since last packet arrived (reveals BLE batching)
}

/** Pipeline debug stats for flight controller analysis */
export interface PipelineStats {
    deviceProcessor: {
        emitCounts: Record<string, number>;
        dropCounts: Record<string, number>;
        latestSampleDevices: string[];
        deviceToJoints: Record<string, string[]>;
    };
    jointSynchronizer: {
        pushCount: number;
        emitCount: number;
    };
    uiProcessor: {
        broadcastCount: number;
    };
}

class TimestampDebugLoggerClass {
    private samples: TimestampSample[] = [];
    private maxSamples = 200;
    private isEnabled = true;
    private logFilePath: string;
    private pipelineStats: PipelineStats | null = null;
    private lastReceptionTs: number = 0;  // Track arrival time for BLE batching detection

    constructor() {
        this.logFilePath = path.join(os.homedir(), 'Documents', 'TropX', 'timestamp_debug.json');
    }

    /** Set pipeline stats from motion processing components */
    setPipelineStats(stats: PipelineStats): void {
        this.pipelineStats = stats;
    }

    /** Log a timestamp sample */
    log(
        deviceName: string,
        rawSensorTs: number,
        lastSensorTs: number | null,
        assignedTs: number,
        receptionTs: number
    ): void {
        if (!this.isEnabled || this.samples.length >= this.maxSamples) {
            return;
        }

        const delta = lastSensorTs !== null ? rawSensorTs - lastSensorTs : 0;

        // Calculate time since last packet arrived (reveals BLE batching)
        const receptionDelta = this.lastReceptionTs > 0 ? receptionTs - this.lastReceptionTs : 0;
        this.lastReceptionTs = receptionTs;

        this.samples.push({
            sampleNum: this.samples.length + 1,
            deviceName,
            rawSensorTs,
            delta,
            assignedTs,
            receptionTs,
            receptionDelta
        });

        // Auto-flush when we hit the limit
        if (this.samples.length >= this.maxSamples) {
            this.flush();
            console.log(`📊 [TimestampDebugLogger] Collected ${this.maxSamples} samples, flushed to ${this.logFilePath}`);
        }
    }

    /** Reset for new session */
    reset(): void {
        this.samples = [];
        this.pipelineStats = null;
        this.lastReceptionTs = 0;
    }

    /** Flush to file */
    flush(): void {
        if (this.samples.length === 0) return;

        // Collect pipeline stats before flushing
        try {
            // Dynamic import to avoid circular dependency
            const { MotionProcessingCoordinator } = require('../motionProcessing/MotionProcessingCoordinator');
            MotionProcessingCoordinator.flushPipelineStats();
        } catch (err) {
            console.warn('[TimestampDebugLogger] Could not collect pipeline stats:', err);
        }

        try {
            // Ensure directory exists
            const dir = path.dirname(this.logFilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Analyze the data
            const analysis = this.analyze();
            const pipelineAnalysis = this.pipelineStats ? this.analyzePipeline() : null;

            const output = {
                capturedAt: new Date().toISOString(),
                totalSamples: this.samples.length,
                analysis,
                pipelineAnalysis,
                pipelineStats: this.pipelineStats,
                samples: this.samples
            };

            fs.writeFileSync(this.logFilePath, JSON.stringify(output, null, 2));
            console.log(`📊 [TimestampDebugLogger] Wrote ${this.samples.length} samples to ${this.logFilePath}`);
        } catch (err) {
            console.error('[TimestampDebugLogger] Failed to write:', err);
        }
    }

    /** Analyze the samples */
    private analyze(): object {
        if (this.samples.length < 2) {
            return { error: 'Not enough samples' };
        }

        const deltas = this.samples.slice(1).map(s => s.delta);
        const zeroDeltaCount = deltas.filter(d => d === 0).length;
        const normalDeltaCount = deltas.filter(d => d >= 8 && d <= 12).length;
        const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;

        // Find runs of duplicate timestamps
        let duplicateRuns: number[] = [];
        let currentRun = 1;
        for (let i = 1; i < deltas.length; i++) {
            if (deltas[i] === 0) {
                currentRun++;
            } else {
                if (currentRun > 1) duplicateRuns.push(currentRun);
                currentRun = 1;
            }
        }
        if (currentRun > 1) duplicateRuns.push(currentRun);

        // BLE BATCHING ANALYSIS: Check arrival time patterns
        const receptionDeltas = this.samples.slice(1).map(s => s.receptionDelta);
        const avgReceptionDelta = receptionDeltas.reduce((a, b) => a + b, 0) / receptionDeltas.length;

        // Count "burst" arrivals (packets arriving < 2ms apart = same BLE event)
        const burstArrivals = receptionDeltas.filter(d => d < 2).length;
        const evenArrivals = receptionDeltas.filter(d => d >= 8 && d <= 15).length;  // ~100Hz spacing

        // Find burst runs (consecutive packets with < 2ms gaps)
        const burstRuns: number[] = [];
        let burstRun = 1;
        for (let i = 0; i < receptionDeltas.length; i++) {
            if (receptionDeltas[i] < 2) {
                burstRun++;
            } else {
                if (burstRun > 1) burstRuns.push(burstRun);
                burstRun = 1;
            }
        }
        if (burstRun > 1) burstRuns.push(burstRun);

        const isBLEBatching = burstArrivals > receptionDeltas.length * 0.3;  // >30% burst = batching

        return {
            // Sensor timestamp analysis
            sensorTimestamps: {
                totalDeltas: deltas.length,
                zeroDeltaCount,
                zeroDeltaPercent: ((zeroDeltaCount / deltas.length) * 100).toFixed(1) + '%',
                normalDeltaCount,
                normalDeltaPercent: ((normalDeltaCount / deltas.length) * 100).toFixed(1) + '%',
                avgDelta: avgDelta.toFixed(2) + 'ms',
                duplicateRunLengths: duplicateRuns,
                maxDuplicateRun: duplicateRuns.length > 0 ? Math.max(...duplicateRuns) : 0,
            },
            // BLE arrival analysis (KEY for jitter diagnosis)
            bleArrival: {
                avgReceptionDelta: avgReceptionDelta.toFixed(2) + 'ms',
                burstArrivals,
                burstPercent: ((burstArrivals / receptionDeltas.length) * 100).toFixed(1) + '%',
                evenArrivals,
                evenPercent: ((evenArrivals / receptionDeltas.length) * 100).toFixed(1) + '%',
                burstRunLengths: burstRuns.slice(0, 10),  // First 10 burst runs
                maxBurstRun: burstRuns.length > 0 ? Math.max(...burstRuns) : 0,
                isBatching: isBLEBatching,
            },
            verdict: isBLEBatching
                ? 'BLE BATCHING DETECTED: Packets arriving in bursts - this causes square wave jitter!'
                : zeroDeltaCount > deltas.length * 0.1
                    ? 'SENSOR ISSUE: Many duplicate timestamps from sensor'
                    : 'DATA OK: Timestamps and arrival patterns normal'
        };
    }

    /** Get the log file path */
    getLogFilePath(): string {
        return this.logFilePath;
    }

    /** Analyze pipeline stats for flight controller issues */
    private analyzePipeline(): object {
        if (!this.pipelineStats) {
            return { error: 'No pipeline stats' };
        }

        const { deviceProcessor, jointSynchronizer, uiProcessor } = this.pipelineStats;

        // Check for emit imbalance between joints
        const leftEmits = deviceProcessor.emitCounts['left_knee'] || 0;
        const rightEmits = deviceProcessor.emitCounts['right_knee'] || 0;
        const totalEmits = leftEmits + rightEmits;
        const emitRatio = totalEmits > 0 ? (leftEmits / totalEmits * 100).toFixed(1) : '0';

        // Check for drops
        const totalDrops = Object.values(deviceProcessor.dropCounts).reduce((a, b) => a + b, 0);

        // Check sync efficiency
        const syncEfficiency = jointSynchronizer.pushCount > 0
            ? (jointSynchronizer.emitCount / jointSynchronizer.pushCount * 100).toFixed(1)
            : '0';

        // Identify issues
        const issues: string[] = [];

        if (Math.abs(leftEmits - rightEmits) > totalEmits * 0.2) {
            issues.push(`IMBALANCE: left_knee=${leftEmits}, right_knee=${rightEmits} (${emitRatio}% left)`);
        }

        if (totalDrops > totalEmits * 0.1) {
            issues.push(`HIGH DROPS: ${totalDrops} drops vs ${totalEmits} emits`);
        }

        if (parseFloat(syncEfficiency) < 100) {
            issues.push(`SYNC LOSS: Only ${syncEfficiency}% of pushes resulted in emits`);
        }

        return {
            emitCounts: deviceProcessor.emitCounts,
            dropCounts: deviceProcessor.dropCounts,
            leftEmitPercent: emitRatio + '%',
            totalDrops,
            syncPushCount: jointSynchronizer.pushCount,
            syncEmitCount: jointSynchronizer.emitCount,
            syncEfficiency: syncEfficiency + '%',
            uiBroadcasts: uiProcessor.broadcastCount,
            issues: issues.length > 0 ? issues : ['PIPELINE OK: No issues detected'],
            verdict: issues.length > 0 ? 'PIPELINE ISSUE: ' + issues[0] : 'PIPELINE OK'
        };
    }
}

export const TimestampDebugLogger = new TimestampDebugLoggerClass();
