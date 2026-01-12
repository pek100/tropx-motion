import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RecordingBuffer } from './RecordingBuffer';
import { RecordingMetadata, QuaternionSample } from './types';
import { GridSnapService } from './GridSnapService';
import { InterpolationService } from './InterpolationService';
import { QuaternionService } from '../shared/QuaternionService';

/** Export options. */
export interface ExportOptions {
    targetHz?: number;
    includeMetadata?: boolean;
    outputPath?: string;
}

/** Export result. */
export interface ExportResult {
    success: boolean;
    filePath?: string;
    fileName?: string;
    error?: string;
    sampleCount?: number;
    csv?: string;
    durationSeconds?: number;
}

/** Full sample with quaternions and all Euler angles. */
interface FullExportSample {
    t: number;
    relative_s: number;
    // Left knee quaternion
    lq_w: number;
    lq_x: number;
    lq_y: number;
    lq_z: number;
    // Right knee quaternion
    rq_w: number;
    rq_x: number;
    rq_y: number;
    rq_z: number;
    // Left knee Euler angles (degrees)
    left_x: number;
    left_y: number;
    left_z: number;
    // Right knee Euler angles (degrees)
    right_x: number;
    right_y: number;
    right_z: number;
}

/**
 * Generates CSV files from recorded quaternion data.
 * Exports both quaternions and Euler angles in a unified format.
 */
export class CSVExporter {

    /**
     * Export recording to CSV file.
     * Outputs quaternions (for import) and Euler angles (x, y, z) for analysis.
     */
    static export(options: ExportOptions = {}): ExportResult {
        const {
            targetHz,
            includeMetadata = true,
            outputPath
        } = options;

        const rawSamples = RecordingBuffer.getRawSamples();
        const metadata = RecordingBuffer.getMetadata();
        const state = RecordingBuffer.getState();

        console.log(`[CSVExporter] Export requested:`, {
            rawSampleCount: rawSamples.length,
            isRecording: state.isRecording,
            durationMs: state.durationMs,
            outputPath
        });

        if (rawSamples.length === 0) {
            console.error(`[CSVExporter] No samples to export! Buffer state:`, state);
            return { success: false, error: 'No recording data to export' };
        }

        // Get target Hz from metadata or options
        const hz = targetHz || metadata?.targetHz || 100;

        // Process raw samples: snap to grid → interpolate → relative quaternions
        const gridData = GridSnapService.snap(rawSamples, hz);

        if (gridData.gridPoints.length === 0) {
            console.error(`[CSVExporter] GridSnapService produced no grid points! Check that sensors were connected.`);
            return { success: false, error: 'Grid alignment failed - ensure sensors are connected' };
        }

        const alignedSamples = InterpolationService.interpolate(gridData);

        if (alignedSamples.length === 0) {
            console.error(`[CSVExporter] InterpolationService produced no samples!`);
            return { success: false, error: 'Interpolation failed - ensure both thigh and shin sensors are connected per joint' };
        }

        console.log(`[CSVExporter] Processed ${rawSamples.length} raw → ${alignedSamples.length} samples at ${hz}Hz`);

        // Convert to full export format with quaternions and all Euler angles
        const fullSamples = CSVExporter.toFullExportSamples(alignedSamples);

        // Generate CSV content
        const csvContent = CSVExporter.generateCSVContent(fullSamples, metadata, hz, includeMetadata);

        // Generate file path
        const fileName = CSVExporter.generateFilename();
        const resolvedOutputPath = outputPath
            ? CSVExporter.expandHomePath(outputPath)
            : CSVExporter.getDefaultExportPath();
        const filePath = path.join(resolvedOutputPath, fileName);

        console.log(`📁 [CSVExporter] Resolved path: ${filePath}`);

        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Calculate duration
        const durationSeconds = metadata
            ? (metadata.endTime - metadata.startTime) / 1000
            : fullSamples.length > 0
                ? (fullSamples[fullSamples.length - 1].t - fullSamples[0].t) / 1000
                : 0;

        // Write file
        try {
            fs.writeFileSync(filePath, csvContent, 'utf-8');
            return {
                success: true,
                filePath,
                fileName,
                sampleCount: fullSamples.length,
                csv: csvContent,
                durationSeconds
            };
        } catch (err) {
            return {
                success: false,
                error: `Failed to write file: ${err}`
            };
        }
    }

    /**
     * Convert quaternion samples to full export format with all angles.
     */
    static toFullExportSamples(samples: QuaternionSample[]): FullExportSample[] {
        if (samples.length === 0) return [];

        const startTime = samples[0].t;

        return samples.map(s => {
            const lq = s.lq || { w: 1, x: 0, y: 0, z: 0 };
            const rq = s.rq || { w: 1, x: 0, y: 0, z: 0 };

            return {
                t: s.t,
                relative_s: Math.round((s.t - startTime) / 10) / 100,
                // Left knee quaternion
                lq_w: round6(lq.w),
                lq_x: round6(lq.x),
                lq_y: round6(lq.y),
                lq_z: round6(lq.z),
                // Right knee quaternion
                rq_w: round6(rq.w),
                rq_x: round6(rq.x),
                rq_y: round6(rq.y),
                rq_z: round6(rq.z),
                // Left knee Euler angles
                left_x: round1(QuaternionService.toEulerAngle(lq, 'x')),
                left_y: round1(QuaternionService.toEulerAngle(lq, 'y')),
                left_z: round1(QuaternionService.toEulerAngle(lq, 'z')),
                // Right knee Euler angles
                right_x: round1(QuaternionService.toEulerAngle(rq, 'x')),
                right_y: round1(QuaternionService.toEulerAngle(rq, 'y')),
                right_z: round1(QuaternionService.toEulerAngle(rq, 'z')),
            };
        });
    }

    /**
     * Generate CSV content string.
     */
    static generateCSVContent(
        samples: FullExportSample[],
        metadata: RecordingMetadata | null,
        targetHz: number,
        includeMetadata: boolean
    ): string {
        const lines: string[] = [];

        // Metadata header
        if (includeMetadata && metadata) {
            const duration = ((metadata.endTime - metadata.startTime) / 1000).toFixed(1);
            lines.push('# TropX Motion Recording');
            lines.push(`# Date: ${new Date(metadata.startTime).toISOString()}`);
            lines.push(`# Duration: ${duration}s`);
            lines.push(`# Samples: ${samples.length}`);
            lines.push(`# SampleRate: ${targetHz}Hz`);
            lines.push('# Format: quaternions (w,x,y,z) + Euler angles (x,y,z in degrees)');
            lines.push('# Method: SLERP quaternion interpolation');
            lines.push('#');
        }

        // CSV header - quaternions first (for import), then Euler angles (for analysis)
        lines.push('timestamp,relative_s,lq_w,lq_x,lq_y,lq_z,rq_w,rq_x,rq_y,rq_z,left_x,left_y,left_z,right_x,right_y,right_z');

        // Data rows
        for (const s of samples) {
            lines.push([
                s.t,
                s.relative_s.toFixed(3),
                s.lq_w, s.lq_x, s.lq_y, s.lq_z,
                s.rq_w, s.rq_x, s.rq_y, s.rq_z,
                s.left_x, s.left_y, s.left_z,
                s.right_x, s.right_y, s.right_z
            ].join(','));
        }

        return lines.join('\n');
    }

    /**
     * Generate filename with timestamp.
     */
    static generateFilename(): string {
        const now = new Date();
        const parts = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, '0'),
            String(now.getDate()).padStart(2, '0'),
            String(now.getHours()).padStart(2, '0'),
            String(now.getMinutes()).padStart(2, '0'),
            String(now.getSeconds()).padStart(2, '0')
        ];
        return `recording_${parts.slice(0, 3).join('-')}_${parts.slice(3).join('-')}.csv`;
    }

    /**
     * Get default export path.
     */
    static getDefaultExportPath(): string {
        return path.join(os.homedir(), 'Documents', 'TropX', 'recordings');
    }

    /**
     * Expand ~ to home directory (Node.js doesn't do this automatically).
     * Works on Windows, macOS, and Linux.
     */
    static expandHomePath(filePath: string): string {
        if (!filePath) return filePath;

        // Handle ~/ (Unix) or ~\ (Windows)
        if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
            return path.join(os.homedir(), filePath.slice(2));
        }
        // Handle ~ alone
        if (filePath === '~') {
            return os.homedir();
        }
        // Handle ~username style (less common but possible)
        if (filePath.startsWith('~') && filePath.length > 1) {
            const sepIndex = Math.min(
                filePath.indexOf('/') === -1 ? Infinity : filePath.indexOf('/'),
                filePath.indexOf('\\') === -1 ? Infinity : filePath.indexOf('\\')
            );
            if (sepIndex !== Infinity) {
                return path.join(os.homedir(), filePath.slice(1));
            }
        }
        return filePath;
    }
}

/** Round to 6 decimal places (for quaternions). */
function round6(n: number): number {
    return Math.round(n * 1000000) / 1000000;
}

/** Round to 1 decimal place (for angles). */
function round1(n: number): number {
    return Math.round(n * 10) / 10;
}
