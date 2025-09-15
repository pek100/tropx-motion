import { APIJoint } from "./types";
import { STATISTICS } from './constants';
import { roundToPrecision, getCurrentTimestamp } from './utils';

interface JointStats {
    min: number;
    max: number;
    count: number;
    sum: number;
    values: number[];
    startTime: number;
}

/**
 * Manages statistical tracking for joint angle measurements during recording sessions.
 * Maintains running statistics including min/max values, averages, and value history.
 */
export class JointStatisticsManager {
    private sessionStats = new Map<string, JointStats>();

    constructor(private targetHz: number) {}

    /**
     * Updates statistical data for a joint with new angle measurement.
     */
    updateStats(jointName: string, angle: number): void {
        const stats = this.getOrCreateStats(jointName, angle);
        this.updateStatsValues(stats, angle);
        this.enforceValuesLimit(stats);
    }

    /**
     * Returns comprehensive statistics report for a specific joint.
     */
    getStats(jointName: string) {
        const stats = this.sessionStats.get(jointName);
        if (!stats) return null;

        return this.calculateStatsReport(stats);
    }

    /**
     * Resets statistics for specific joint or all joints if no name provided.
     */
    resetStats(jointName?: string): void {
        if (jointName) {
            this.sessionStats.delete(jointName);
        } else {
            this.sessionStats.clear();
        }
    }

    /**
     * Creates API-compatible joint object with current statistics.
     */
    getAPIJoint(jointName: string, angle: number, timestamp: number, jointId: string): APIJoint {
        const stats = this.sessionStats.get(jointName);
        const roundedAngle = roundToPrecision(angle);
        const maxAngle = stats?.max ? roundToPrecision(stats.max) : roundedAngle;
        const minAngle = stats?.min ? roundToPrecision(stats.min) : roundedAngle;

        return {
            id: jointId,
            timestamp: new Date(timestamp).toISOString(),
            joint_name: jointName,
            interval: 1 / this.targetHz,
            max_flexion: maxAngle,
            min_flexion: minAngle,
            max_extension: minAngle,
            min_extension: maxAngle
        };
    }

    /**
     * Retrieves existing stats or creates new stats entry for joint.
     */
    private getOrCreateStats(jointName: string, angle: number): JointStats {
        const existing = this.sessionStats.get(jointName);
        if (existing) return existing;

        const newStats: JointStats = {
            min: angle,
            max: angle,
            count: 0,
            sum: 0,
            values: [],
            startTime: getCurrentTimestamp()
        };

        this.sessionStats.set(jointName, newStats);
        return newStats;
    }

    /**
     * Updates all statistical values with new angle measurement.
     */
    private updateStatsValues(stats: JointStats, angle: number): void {
        // Don't accumulate infinite arrays - just track statistics
        stats.min = Math.min(stats.min, angle);
        stats.max = Math.max(stats.max, angle);
        stats.count++;
        stats.sum += angle;

        // Keep only current value for immediate access
        stats.values = [angle];
    }

    /**
     * Maintains value history within memory limits by removing oldest values.
     */
    private enforceValuesLimit(stats: JointStats): void {
        if (stats.values.length > STATISTICS.MAX_VALUES_HISTORY) {
            stats.values = stats.values.slice(-STATISTICS.MAX_VALUES_HISTORY);
        }
    }

    /**
     * Calculates comprehensive statistics report from accumulated data.
     */
    private calculateStatsReport(stats: JointStats) {
        return {
            min: stats.min,
            max: stats.max,
            average: stats.sum / stats.count,
            rom: stats.max - stats.min,
            count: stats.count,
            duration: getCurrentTimestamp() - stats.startTime
        };
    }
}