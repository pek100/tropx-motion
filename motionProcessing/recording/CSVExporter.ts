import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RecordingBuffer, RecordingMetadata } from './RecordingBuffer';
import { InterpolationService, InterpolatedAngleSample } from './InterpolationService';

/** Export options. */
export interface ExportOptions {
    interpolated?: boolean;
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
}

/**
 * Generates CSV files from recorded quaternion data.
 */
export class CSVExporter {

    /**
     * Export recording to CSV file.
     */
    static export(options: ExportOptions = {}): ExportResult {
        const {
            interpolated = false,
            targetHz,
            includeMetadata = true,
            outputPath
        } = options;

        const samples = RecordingBuffer.getAllSamples();
        const metadata = RecordingBuffer.getMetadata();
        const state = RecordingBuffer.getState();

        console.log(`📤 [CSVExporter] Export requested:`, {
            sampleCount: samples.length,
            isRecording: state.isRecording,
            durationMs: state.durationMs,
            interpolated,
            outputPath
        });

        if (samples.length === 0) {
            console.error(`❌ [CSVExporter] No samples to export! Buffer state:`, state);
            return { success: false, error: 'No recording data to export' };
        }

        // Get target Hz from metadata or options
        const hz = targetHz || metadata?.targetHz || 100;

        // Convert to angle samples
        const angleSamples = interpolated
            ? InterpolationService.slerpToUniformRate(samples, hz)
            : InterpolationService.toAngleSamples(samples);

        // Generate CSV content
        const csvContent = CSVExporter.generateCSVContent(angleSamples, metadata, interpolated, hz, includeMetadata);

        // Generate file path
        const fileName = CSVExporter.generateFilename(interpolated);
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

        // Write file
        try {
            fs.writeFileSync(filePath, csvContent, 'utf-8');
            return {
                success: true,
                filePath,
                fileName,
                sampleCount: angleSamples.length
            };
        } catch (err) {
            return {
                success: false,
                error: `Failed to write file: ${err}`
            };
        }
    }

    /**
     * Generate CSV content string.
     */
    static generateCSVContent(
        samples: InterpolatedAngleSample[],
        metadata: RecordingMetadata | null,
        interpolated: boolean,
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
            if (interpolated) {
                lines.push(`# Interpolated: ${targetHz}Hz (${(1000 / targetHz).toFixed(1)}ms intervals)`);
                lines.push('# Method: SLERP quaternion interpolation');
            }
            lines.push('#');
        }

        // CSV header
        lines.push('timestamp,relative_s,left_knee,right_knee');

        // Data rows
        for (const sample of samples) {
            lines.push(`${sample.t},${sample.relative_s.toFixed(3)},${sample.left},${sample.right}`);
        }

        return lines.join('\n');
    }

    /**
     * Generate filename with timestamp.
     */
    static generateFilename(interpolated: boolean = false): string {
        const now = new Date();
        const parts = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, '0'),
            String(now.getDate()).padStart(2, '0'),
            String(now.getHours()).padStart(2, '0'),
            String(now.getMinutes()).padStart(2, '0'),
            String(now.getSeconds()).padStart(2, '0')
        ];
        const suffix = interpolated ? '_interpolated' : '';
        return `recording_${parts.slice(0, 3).join('-')}_${parts.slice(3).join('-')}${suffix}.csv`;
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
            // If it's ~something/ or ~something\, expand ~ to home dir
            const sepIndex = Math.min(
                filePath.indexOf('/') === -1 ? Infinity : filePath.indexOf('/'),
                filePath.indexOf('\\') === -1 ? Infinity : filePath.indexOf('\\')
            );
            if (sepIndex !== Infinity) {
                // Has a separator - might be ~/path or ~user/path
                // For simplicity, treat ~anything/ as ~/anything (home-relative)
                return path.join(os.homedir(), filePath.slice(1));
            }
        }
        return filePath;
    }
}
